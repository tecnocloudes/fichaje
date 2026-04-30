/**
 * Mapping bidireccional entre Stripe price IDs y el catálogo del producto.
 *
 * Cada plan (starter/pro/enterprise) tiene 2 prices (monthly/yearly).
 * Cada addon tiene 1 price (suele facturarse mensual).
 *
 * Las IDs reales vienen de las env vars STRIPE_PRICE_*. Si una env falta,
 * el lookup correspondiente devuelve undefined y el handler decide qué
 * hacer (típicamente: log warning + ignorar el item, no es seguro
 * suspender al tenant porque podría ser una env mal configurada en
 * deploy).
 *
 * El script `npm run stripe:bootstrap` (commit 1 también) crea/actualiza
 * los products + prices en Stripe y emite a stdout las env vars para
 * que el operador las copie a .env. Idempotente por nombre.
 */

export type PlanKey = "starter" | "pro" | "enterprise";
export type BillingPeriod = "monthly" | "yearly";

export type AddonKey =
  | "dominio_personalizado"
  | "api_access"
  | "integraciones_nomina"
  | "firma_electronica"
  | "people_analytics"
  | "storage_extra"
  | "emails_extra";

export type PriceMatch =
  | { kind: "plan"; planKey: PlanKey; billingPeriod: BillingPeriod }
  | { kind: "addon"; addonKey: AddonKey };

const PLAN_ENV_KEY: Record<PlanKey, Record<BillingPeriod, string>> = {
  starter: {
    monthly: "STRIPE_PRICE_STARTER_MONTHLY",
    yearly: "STRIPE_PRICE_STARTER_YEARLY",
  },
  pro: {
    monthly: "STRIPE_PRICE_PRO_MONTHLY",
    yearly: "STRIPE_PRICE_PRO_YEARLY",
  },
  enterprise: {
    monthly: "STRIPE_PRICE_ENTERPRISE_MONTHLY",
    yearly: "STRIPE_PRICE_ENTERPRISE_YEARLY",
  },
};

const ADDON_ENV_KEY: Record<AddonKey, string> = {
  dominio_personalizado: "STRIPE_PRICE_ADDON_DOMINIO_PERSONALIZADO",
  api_access: "STRIPE_PRICE_ADDON_API_ACCESS",
  integraciones_nomina: "STRIPE_PRICE_ADDON_INTEGRACIONES_NOMINA",
  firma_electronica: "STRIPE_PRICE_ADDON_FIRMA_ELECTRONICA",
  people_analytics: "STRIPE_PRICE_ADDON_PEOPLE_ANALYTICS",
  storage_extra: "STRIPE_PRICE_ADDON_STORAGE_EXTRA",
  emails_extra: "STRIPE_PRICE_ADDON_EMAILS_EXTRA",
};

/**
 * Devuelve el Stripe price ID para un plan dado, o `undefined` si la
 * env var no está configurada.
 */
export function getPlanPriceId(
  plan: PlanKey,
  period: BillingPeriod,
): string | undefined {
  const v = process.env[PLAN_ENV_KEY[plan][period]];
  return v && v.length > 0 ? v : undefined;
}

/**
 * Devuelve el Stripe price ID para un addon, o `undefined` si la env
 * var no está configurada.
 */
export function getAddonPriceId(addon: AddonKey): string | undefined {
  const v = process.env[ADDON_ENV_KEY[addon]];
  return v && v.length > 0 ? v : undefined;
}

/**
 * Mapping inverso: dado un Stripe price ID, devuelve qué plan/addon
 * representa, o `undefined` si no corresponde a ninguno conocido.
 *
 * Lo usa el handler de `customer.subscription.updated` para
 * recomponer `tenant_features` desde los items recibidos en el webhook.
 */
export function matchPriceId(priceId: string): PriceMatch | undefined {
  for (const plan of ["starter", "pro", "enterprise"] as const) {
    for (const period of ["monthly", "yearly"] as const) {
      if (getPlanPriceId(plan, period) === priceId) {
        return { kind: "plan", planKey: plan, billingPeriod: period };
      }
    }
  }
  for (const addon of Object.keys(ADDON_ENV_KEY) as AddonKey[]) {
    if (getAddonPriceId(addon) === priceId) {
      return { kind: "addon", addonKey: addon };
    }
  }
  return undefined;
}

/**
 * Lista todas las env vars de price IDs requeridas. Útil para tests
 * de smoke que verifican que el deploy tiene la configuración completa.
 */
export function allPriceEnvKeys(): string[] {
  const keys: string[] = [];
  for (const plan of Object.values(PLAN_ENV_KEY)) {
    keys.push(plan.monthly, plan.yearly);
  }
  for (const k of Object.values(ADDON_ENV_KEY)) keys.push(k);
  return keys;
}
