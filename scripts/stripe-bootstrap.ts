#!/usr/bin/env node
/**
 * stripe:bootstrap — crea/actualiza productos + prices en Stripe (modo
 * test). Idempotente: usa metadata.fichaje_key como identificador
 * estable; si el product ya existe con esa key, lo reutiliza.
 *
 * Catálogo:
 *   3 productos (starter, pro, enterprise) × 2 prices (monthly, yearly)
 *   = 6 prices de planes.
 *   7 productos addon × 1 price (monthly) = 7 prices de addons.
 *   Total: 10 productos + 13 prices.
 *
 * Modelo de planes Fase 8 — pricing per-seat con mínimo mensual:
 *   starter:    4 €/empleado/mes,  mínimo 39 €/mes
 *   pro:        5 €/empleado/mes,  mínimo 49 €/mes
 *   enterprise: 6 €/empleado/mes,  mínimo 99 €/mes
 *
 * IMPORTANTE: este script crea precios `flat` placeholder que dejan
 * la configuración inicial en Stripe; el operador ajusta luego en
 * dashboard.stripe.com a `unit_amount + transform_quantity` para
 * facturar per-employee con mínimo. Ver docs/arch/billing.md (TODO).
 *
 * Al finalizar, emite a stdout las env vars STRIPE_PRICE_* listas para
 * copiar al .env.
 *
 * Uso:
 *   STRIPE_SECRET_KEY=sk_test_... npm run stripe:bootstrap
 *
 * Requisitos: cuenta Stripe en modo test. NUNCA correr con sk_live.
 */

import "dotenv/config";
import { stripe } from "@/lib/stripe/client";
import type Stripe from "stripe";

type ProductDef = {
  fichajeKey: string;
  name: string;
  description: string;
  prices: { lookupKey: string; amountCents: number; interval: "month" | "year" }[];
};

const PRODUCTS: ProductDef[] = [
  // Planes — los `amountCents` son los **mínimos mensuales**
  // (placeholder en Stripe). En dashboard.stripe.com el operador
  // ajusta a per-seat con `unit_amount = pricePerEmployeeCents` y
  // `transform_quantity` o `tiers` para honrar el mínimo.
  // Anualidad: 10 meses (descuento implícito de 2 meses).
  {
    fichajeKey: "plan_starter",
    name: "Plan Starter",
    description: "Para equipos pequeños — 4 €/empleado/mes (mín. 39 €/mes). Hasta 10 empleados, 1 sede.",
    prices: [
      { lookupKey: "plan_starter_monthly", amountCents: 3900, interval: "month" },
      { lookupKey: "plan_starter_yearly", amountCents: 39000, interval: "year" },
    ],
  },
  {
    fichajeKey: "plan_pro",
    name: "Plan Pro",
    description: "Para empresas en crecimiento — 5 €/empleado/mes (mín. 49 €/mes). Hasta 50 empleados, 5 sedes, turnos, geofencing.",
    prices: [
      { lookupKey: "plan_pro_monthly", amountCents: 4900, interval: "month" },
      { lookupKey: "plan_pro_yearly", amountCents: 49000, interval: "year" },
    ],
  },
  {
    fichajeKey: "plan_enterprise",
    name: "Plan Enterprise",
    description: "Para empresas grandes — 6 €/empleado/mes (mín. 99 €/mes). Empleados ilimitados, branding, dominio, API, SSO, SLA.",
    prices: [
      { lookupKey: "plan_enterprise_monthly", amountCents: 9900, interval: "month" },
      { lookupKey: "plan_enterprise_yearly", amountCents: 99000, interval: "year" },
    ],
  },
  {
    fichajeKey: "addon_dominio_personalizado",
    name: "Addon — Dominio personalizado",
    description: "Subdominio propio para el tenant.",
    prices: [{ lookupKey: "addon_dominio_personalizado", amountCents: 1500, interval: "month" }],
  },
  {
    fichajeKey: "addon_api_access",
    name: "Addon — Acceso API",
    description: "API REST con tokens y rate limit.",
    prices: [{ lookupKey: "addon_api_access", amountCents: 2900, interval: "month" }],
  },
  {
    fichajeKey: "addon_integraciones_nomina",
    name: "Addon — Integraciones nómina",
    description: "Conexión con A3, Sage, Holded.",
    prices: [{ lookupKey: "addon_integraciones_nomina", amountCents: 3900, interval: "month" }],
  },
  {
    fichajeKey: "addon_firma_electronica",
    name: "Addon — Firma electrónica",
    description: "Firma digital de documentos del empleado.",
    prices: [{ lookupKey: "addon_firma_electronica", amountCents: 1900, interval: "month" }],
  },
  {
    fichajeKey: "addon_people_analytics",
    name: "Addon — People analytics",
    description: "Dashboard avanzado de RRHH.",
    prices: [{ lookupKey: "addon_people_analytics", amountCents: 2900, interval: "month" }],
  },
  {
    fichajeKey: "addon_storage_extra",
    name: "Addon — Storage extra (10 GB)",
    description: "10 GB adicionales para documentos y fotos.",
    prices: [{ lookupKey: "addon_storage_extra", amountCents: 900, interval: "month" }],
  },
  {
    fichajeKey: "addon_emails_extra",
    name: "Addon — Emails extra (10k/mes)",
    description: "10.000 emails adicionales al mes.",
    prices: [{ lookupKey: "addon_emails_extra", amountCents: 900, interval: "month" }],
  },
];

async function upsertProduct(def: ProductDef): Promise<Stripe.Product> {
  // Buscar por metadata.fichaje_key.
  const list = await stripe.products.search({
    query: `metadata['fichaje_key']:'${def.fichajeKey}'`,
    limit: 1,
  });
  if (list.data.length > 0) {
    const existing = list.data[0]!;
    if (existing.name !== def.name || existing.description !== def.description) {
      return stripe.products.update(existing.id, {
        name: def.name,
        description: def.description,
      });
    }
    return existing;
  }
  return stripe.products.create({
    name: def.name,
    description: def.description,
    metadata: { fichaje_key: def.fichajeKey },
  });
}

async function upsertPrice(
  product: Stripe.Product,
  def: ProductDef["prices"][number],
): Promise<Stripe.Price> {
  // Buscar por lookup_key (Stripe lo permite como "alias" único).
  const existing = await stripe.prices.list({
    lookup_keys: [def.lookupKey],
    limit: 1,
  });
  if (existing.data.length > 0) {
    const p = existing.data[0]!;
    if (
      p.unit_amount === def.amountCents &&
      p.recurring?.interval === def.interval &&
      p.product === product.id
    ) {
      return p;
    }
    // El price es inmutable en Stripe — si cambian los importes, hay que
    // crear uno nuevo y desactivar el anterior. Por simplicidad de Fase
    // 4 inicial, lanzamos para que el operador decida.
    throw new Error(
      `Price con lookup_key ${def.lookupKey} ya existe con valores distintos. ` +
        `Stripe no permite editar prices; cambia el lookup_key o desactiva ` +
        `el anterior manualmente.`,
    );
  }
  return stripe.prices.create({
    product: product.id,
    unit_amount: def.amountCents,
    currency: "eur",
    recurring: { interval: def.interval },
    lookup_key: def.lookupKey,
    metadata: { fichaje_key: def.lookupKey },
  });
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    console.error("Falta STRIPE_SECRET_KEY.");
    process.exit(2);
  }
  if (secret.startsWith("sk_live_")) {
    console.error(
      "ERROR: este script NO debe correrse con sk_live. Use modo test.",
    );
    process.exit(2);
  }

  const out: Record<string, string> = {};

  for (const def of PRODUCTS) {
    console.log(`→ ${def.fichajeKey}`);
    const product = await upsertProduct(def);
    for (const priceDef of def.prices) {
      const price = await upsertPrice(product, priceDef);
      const envKey = lookupKeyToEnvVar(priceDef.lookupKey);
      out[envKey] = price.id;
      console.log(`   ${envKey}=${price.id}`);
    }
  }

  console.log("\n─── Copia estas líneas a tu .env ───");
  for (const [k, v] of Object.entries(out)) {
    console.log(`${k}="${v}"`);
  }
}

function lookupKeyToEnvVar(lookupKey: string): string {
  // plan_starter_monthly → STRIPE_PRICE_STARTER_MONTHLY
  // addon_api_access     → STRIPE_PRICE_ADDON_API_ACCESS
  return "STRIPE_PRICE_" + lookupKey.toUpperCase().replace(/^PLAN_/, "");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
