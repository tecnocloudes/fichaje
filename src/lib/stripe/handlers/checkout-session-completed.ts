/**
 * handleCheckoutCompleted — coreografía PENDING → PROVISIONING → ACTIVE.
 * ADR-003 §2.6.
 *
 * Disparado por Stripe `checkout.session.completed` tras un registro en
 * `/registro` con redirect a Stripe Checkout (commit 14-16). Pasos:
 *
 *  1. Lookup tenant por session.client_reference_id.
 *  2. Status guards:
 *     - active|suspended → 200 silencioso (replay tras provisión OK).
 *     - provisioning → 200 silencioso (otra ejecución en curso).
 *     - pending → procede.
 *  3. UPDATE pending → provisioning (atomic).
 *  4. UPDATE stripe_customer_id.
 *  5. Recuperar subscription completa con expand=items.data.price.
 *  6. persistSubscription (subscriptions + items).
 *  7. recomposeTenantFeatures (plan + addons; preserva manual_override).
 *  8. provisionTenantSchema (CREATE SCHEMA + GRANTs + migraciones).
 *  9. Invalidar cliente Prisma cacheado para el slug (Enmienda 2).
 * 10. Crear primer OWNER en runWithTenant (sin password; resetToken).
 * 11. UPDATE provisioning → active.
 * 12. Email de bienvenida con link de set-password.
 *
 * Idempotencia: cada UPDATE con WHERE status=... filtra retries.
 * El INSERT inicial en stripe_events (idempotency.ts) es la primera
 * barrera; estos UPDATE condicionales son la segunda.
 */

import type Stripe from "stripe";
import crypto from "node:crypto";
import { prismaMaster, prismaApp, invalidateTenantClient } from "@/lib/prisma";
import { stripe } from "../client";
import { runWithTenant, type TenantContext } from "@/lib/tenant/context";
import { provisionTenantSchema } from "@/lib/tenant/provision";
import { runMigrations } from "@/lib/migrate";
import {
  persistSubscription,
  recomposeTenantFeatures,
} from "../feature-resolver";
import { sendEmail } from "@/lib/email/send";
import {
  bienvenidaSubject,
  bienvenidaHtml,
  bienvenidaText,
} from "@/lib/email-templates/bienvenida";

const RESET_TOKEN_TTL_HOURS = 24;

export async function handleCheckoutCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const tenantId = session.client_reference_id;
  if (!tenantId) {
    throw new Error(
      "client_reference_id ausente en checkout.session.completed",
    );
  }

  // 1. Lookup tenant.
  const tenant = await prismaMaster.tenant.findUnique({
    where: { id: tenantId },
  });
  if (!tenant) {
    // §8.4 del plan: firma OK pero tenant desconocido. Log + 200
    // (no es bug nuestro, es webhook desviado de otra cuenta Stripe).
    console.warn(
      `[stripe] tenant ${tenantId} no existe en master.tenants; ignorando`,
    );
    return;
  }

  // 2. Status guards.
  if (tenant.status === "active" || tenant.status === "suspended") return;
  if (tenant.status === "provisioning") return;

  // 3. PENDING → PROVISIONING (atomic).
  const claimed = await prismaMaster.tenant.updateMany({
    where: { id: tenantId, status: "pending" },
    data: { status: "provisioning", updatedAt: new Date() },
  });
  if (claimed.count === 0) return; // otra ejecución la cogió

  // 4. Persistir Stripe Customer.
  const stripeCustomerId = session.customer as string;
  await prismaMaster.tenant.update({
    where: { id: tenantId },
    data: { stripeCustomerId },
  });

  // 5. Recuperar subscription completa.
  if (!session.subscription) {
    throw new Error("session.subscription ausente");
  }
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  });

  // 6. Persist subscription + items.
  await persistSubscription(tenantId, subscription);

  // 7. Recompose tenant_features.
  await recomposeTenantFeatures(tenantId, subscription);

  // 8. Provisionar el schema del tenant.
  await provisionTenantSchema(tenant.slug);

  // 9. Invalidar cualquier cliente Prisma cacheado para este slug
  //    (Enmienda 2 del plan de Fase 4).
  invalidateTenantClient(tenant.slug);

  // 10. Crear primer OWNER en el schema del tenant.
  const ctx: TenantContext = {
    tenantId: tenant.id,
    slug: tenant.slug,
    status: "active", // Para entrar al runWithTenant; el UPDATE final
    // sincroniza master.tenants.status = active.
    features: new Map(),
  };
  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetTokenExpiry = new Date(
    Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000,
  );
  await runWithTenant(ctx, async () => {
    // Aplicar lazy migrations (ALTER TABLE … IF NOT EXISTS de features
    // introducidas tras las migraciones formales: empresaId, Conversacion,
    // WhatsappConfig, Integracion, DeclaracionFlex, etc.). Sin esto el
    // primer INSERT del OWNER falla con ColumnNotFound porque el cliente
    // Prisma actual incluye columnas que la última migración formal no
    // creó. Idempotente; el cache MIGRATED evita reejecuciones.
    await runMigrations();

    // El email puede haber tenido espacios o variaciones; normalizamos.
    const email = tenant.email.trim().toLowerCase();
    const [nombre, ...rest] = (tenant.name ?? email.split("@")[0]).split(" ");
    const apellidos = rest.join(" ") || "";
    await prismaApp.user.upsert({
      where: { email },
      create: {
        email,
        nombre: nombre || "Owner",
        apellidos,
        rol: "OWNER",
        password: null,
        resetToken,
        resetTokenExpiry,
        activo: true,
      },
      update: {
        rol: "OWNER",
        resetToken,
        resetTokenExpiry,
        activo: true,
      },
    });

    // Sembrar `ConfiguracionEmpresa` con el nombre que el cliente
    // introdujo en /registro. Si ya existe (improbable en provisioning,
    // pero idempotente por defensa), lo actualizamos para que aparezca
    // correctamente en emails de invitación, login, etc. — sin esto
    // se queda con el default "Mi Empresa" del schema.
    if (tenant.name) {
      // Usamos id fijo 'singleton' para evitar duplicados (la UI de
      // configuración usa el mismo id). Sin esto, el provisioning crea
      // una fila con cuid y la UI crea otra con id='singleton',
      // dejando dos filas — el findFirst del template puede coger la
      // equivocada (la sin logo del provisioning).
      await prismaApp.configuracionEmpresa.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", nombre: tenant.name },
        update: { nombre: tenant.name },
      });
    }
  });

  // 11. PROVISIONING → ACTIVE.
  await prismaMaster.tenant.updateMany({
    where: { id: tenantId, status: "provisioning" },
    data: { status: "active" },
  });

  // 12. Email de bienvenida.
  const setPasswordUrl = buildSetPasswordUrl(tenant.slug, resetToken);
  await sendEmail({
    to: tenant.email,
    from: process.env.EMAIL_FROM ?? "no-reply@ficha.tecnocloud.es",
    subject: bienvenidaSubject({
      ownerEmail: tenant.email,
      ownerName: tenant.name,
      tenantSlug: tenant.slug,
      setPasswordUrl,
      appName: "Fichaje",
    }),
    html: bienvenidaHtml({
      ownerEmail: tenant.email,
      ownerName: tenant.name,
      tenantSlug: tenant.slug,
      setPasswordUrl,
      appName: "Fichaje",
    }),
    text: bienvenidaText({
      ownerEmail: tenant.email,
      ownerName: tenant.name,
      tenantSlug: tenant.slug,
      setPasswordUrl,
      appName: "Fichaje",
    }),
  });
}

function buildSetPasswordUrl(slug: string, token: string): string {
  const root = process.env.TENANT_ROOT_DOMAIN ?? "ficha.tecnocloud.es";
  const proto = root === "localhost" ? "http" : "https";
  const port = root === "localhost" ? ":3000" : "";
  return `${proto}://${slug}.${root}${port}/set-password?token=${token}`;
}
