/**
 * Persiste la subscription Stripe en master + recompone tenant_features.
 *
 * ADR-003 §2.6 + §2.9.
 *
 * Estrategia para tenant_features:
 *  - Ante un evento (checkout.completed o subscription.updated), se
 *    REEMPLAZAN todas las filas con `source IN ('plan','addon')` por
 *    las que reflejan el estado actual de la subscription.
 *  - Las filas con `source='manual_override'` se preservan intactas
 *    (resolverFeatureRows aplica la prioridad en lectura).
 *
 * Lógica:
 *  1. Para cada item de subscription.items.data:
 *     - matchPriceId(item.price.id) → { plan, period } | { addon }.
 *     - Si plan: cargar PlanFeatures del plan y emitir N filas con
 *       source='plan'.
 *     - Si addon: emitir 1 fila con source='addon' y feature_key igual
 *       al addonKey (en este modelo el addon = una feature directa;
 *       ADR-003 §2.9).
 *  2. DELETE filas plan|addon previas.
 *  3. INSERT las nuevas (transacción).
 */

import type Stripe from "stripe";
import { prismaMaster } from "@/lib/prisma";
import { matchPriceId } from "./price-catalog";

/**
 * INSERT/UPSERT en master.subscriptions + master.subscription_items.
 *
 * Idempotente por stripeSubscriptionId (UNIQUE) y por subscription_items
 * (UPSERT por stripeItemId UNIQUE).
 */
export async function persistSubscription(
  tenantId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  const stripeSubId = subscription.id;
  const stripeCustId = subscription.customer as string;
  const planKey = inferPlanKey(subscription);
  const status = subscription.status; // trialing/active/past_due/...
  const currentPeriodStart = new Date(
    (subscription as unknown as { current_period_start: number })
      .current_period_start * 1000,
  );
  const currentPeriodEnd = new Date(
    (subscription as unknown as { current_period_end: number })
      .current_period_end * 1000,
  );
  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : null;

  await prismaMaster.subscription.upsert({
    where: { stripeSubscriptionId: stripeSubId },
    create: {
      tenantId,
      stripeSubscriptionId: stripeSubId,
      stripeCustomerId: stripeCustId,
      planKey,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      trialEnd,
    },
    update: {
      status,
      planKey,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      trialEnd,
    },
  });

  // Recomponer subscription_items.
  const subRow = await prismaMaster.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubId },
    select: { id: true },
  });
  if (!subRow) throw new Error("subscription row no encontrada tras upsert");

  for (const item of subscription.items.data) {
    const priceId =
      typeof item.price === "string" ? item.price : item.price.id;
    const match = matchPriceId(priceId);
    const featureKey =
      match?.kind === "plan"
        ? `__plan__${match.planKey}`
        : match?.kind === "addon"
          ? match.addonKey
          : `__unknown__${priceId}`;

    await prismaMaster.subscriptionItem.upsert({
      where: { stripeItemId: item.id },
      create: {
        subscriptionId: subRow.id,
        stripeItemId: item.id,
        featureKey,
        quantity: item.quantity ?? 1,
      },
      update: {
        featureKey,
        quantity: item.quantity ?? 1,
      },
    });
  }
}

function inferPlanKey(subscription: Stripe.Subscription): string {
  // Buscamos el primer item que matchee como "plan".
  for (const item of subscription.items.data) {
    const priceId =
      typeof item.price === "string" ? item.price : item.price.id;
    const m = matchPriceId(priceId);
    if (m?.kind === "plan") return m.planKey;
  }
  return "unknown";
}

/**
 * Recompone master.tenant_features para el tenant. Borra todas las
 * filas con source IN ('plan', 'addon') y emite las nuevas a partir de
 * la subscription actual. Las filas con source='manual_override' se
 * preservan.
 */
export async function recomposeTenantFeatures(
  tenantId: string,
  subscription: Stripe.Subscription,
): Promise<void> {
  // 1. Determinar plan + addons.
  const planKey = inferPlanKey(subscription);
  const addonKeys: string[] = [];
  for (const item of subscription.items.data) {
    const priceId =
      typeof item.price === "string" ? item.price : item.price.id;
    const m = matchPriceId(priceId);
    if (m?.kind === "addon") addonKeys.push(m.addonKey);
  }

  // 2. PlanFeatures del plan (32 entradas tras Fase 2 seed).
  const plan = await prismaMaster.plan.findUnique({
    where: { key: planKey },
    include: { planFeatures: true },
  });
  if (!plan) {
    // Plan unknown: dejamos el tenant sin features-por-plan. Es un
    // problema de configuración (price no mapea a plan); el operador
    // debe revisar STRIPE_PRICE_*. No lanzamos para no bloquear el
    // webhook y dejar al tenant en limbo.
    return;
  }

  // 3. Catalogo de features para resolver el `value` de los addons.
  // En ADR-003 §2.9, los addons tienen un valor por feature_key —
  // típicamente boolean true para los toggle-ones (api_access, etc.)
  // o numérico para "extra" (storage_extra, emails_extra). Esa
  // configuración no está en master.plans, sino que es una propiedad
  // del addon. Para Fase 4 inicial, asumimos: addon → feature boolean
  // true. Refinar en Fase 5 cuando addons numéricos lleguen.
  const featureCatalog = await prismaMaster.feature.findMany({
    where: { key: { in: addonKeys }, active: true },
  });
  const addonFeatureMap = new Map(featureCatalog.map((f) => [f.key, f]));

  // 4. Borrar filas plan/addon previas (preserva manual_override).
  await prismaMaster.tenantFeature.deleteMany({
    where: { tenantId, source: { in: ["plan", "addon"] } },
  });

  // 5. INSERT plan features.
  for (const pf of plan.planFeatures) {
    await prismaMaster.tenantFeature.create({
      data: {
        tenantId,
        featureKey: pf.featureKey,
        value: pf.value as never,
        source: "plan",
      },
    });
  }

  // 6. INSERT addon features (boolean true por defecto en Fase 4).
  for (const addonKey of addonKeys) {
    if (!addonFeatureMap.has(addonKey)) continue; // addon no en catálogo
    await prismaMaster.tenantFeature.create({
      data: {
        tenantId,
        featureKey: addonKey,
        value: true as never,
        source: "addon",
      },
    });
  }
}
