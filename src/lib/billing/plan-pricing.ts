/**
 * Catálogo de precios y posicionamiento UI de los 3 planes empleaIA.
 *
 * IMPORTANTE: las cantidades reales que cobra Stripe viven en el dashboard
 * de Stripe (price IDs declarados via STRIPE_PRICE_*). Este módulo declara:
 *   - los **precios canónicos** que la UI muestra al cliente,
 *   - el **rango de empleados** de cada plan (no se solapan),
 *   - el **mínimo mensual** facturable.
 *
 * Modelo (rangos no solapados + suelo razonable):
 *   - `pricePerEmployeeCents`: facturación por empleado activo y mes.
 *   - `minEmployees` / `maxEmployees`: rango exclusivo del plan
 *     (`maxEmployees=null` → sin tope, solo Enterprise).
 *   - `monthlyMinimumCents`: el cliente paga MAX(empleados × per_employee,
 *     monthly_minimum). En Pro y Enterprise el mínimo coincide con
 *     `minEmployees × pricePerEmployee` (no se cobra menos del rango).
 *     En Starter hay un suelo más bajo para no regalar el plan a equipos
 *     de 1-2 personas (cubre coste mínimo de infra).
 *
 * Sin solapes: el techo de un plan (`maxEmployees × pricePerEmployee`)
 * nunca cuesta más que el suelo del siguiente.
 *   Starter techo  = 10 × 4 € = 40 €/mes
 *   Pro suelo      = 11 × 5 € = 55 €/mes
 *   Pro techo      = 50 × 5 € = 250 €/mes
 *   Enterprise sue = 51 × 6 € = 306 €/mes
 *
 * El operador es el responsable de configurar los Stripe Prices con
 * `billing_scheme=per_unit`. La quantity la calcula el backend
 * (`calculateQuantity` en `checkout.ts`) respetando `monthlyMinimumCents`.
 */

export type PlanKey = "starter" | "pro" | "enterprise";

export interface PlanPricing {
  key: PlanKey;
  displayName: string;
  tagline: string;
  /** Precio por empleado activo y mes, en céntimos de €. */
  pricePerEmployeeCents: number;
  /** Mínimo mensual a facturar (cliente paga MAX(empleados×price, mínimo)). */
  monthlyMinimumCents: number;
  /** Mínimo de empleados que aplica a este plan (inclusivo). */
  minEmployees: number;
  /** Máximo de empleados que aplica a este plan (inclusivo). null=ilimitado. */
  maxEmployees: number | null;
  /** Marcado como "Más popular" en la UI (típico patrón de pricing tables). */
  popular: boolean;
  /** Orden visual de izquierda a derecha. */
  sortOrder: number;
  /** Bullets de marketing visibles en la pricing table de la app. */
  highlights: string[];
}

export const PLAN_PRICING: Record<PlanKey, PlanPricing> = {
  starter: {
    key: "starter",
    displayName: "Starter",
    tagline: "Para equipos pequeños",
    pricePerEmployeeCents: 400,
    monthlyMinimumCents: 1900,
    minEmployees: 1,
    maxEmployees: 10,
    popular: false,
    sortOrder: 10,
    highlights: [
      "Fichaje web, móvil y tablet",
      "1-10 empleados",
      "1 sede",
      "Ausencias y vacaciones",
      "Exportaciones PDF y Excel",
      "Soporte por email",
    ],
  },
  pro: {
    key: "pro",
    displayName: "Pro",
    tagline: "Para empresas en crecimiento",
    pricePerEmployeeCents: 500,
    monthlyMinimumCents: 5500,
    minEmployees: 11,
    maxEmployees: 50,
    popular: true,
    sortOrder: 20,
    highlights: [
      "Todo lo de Starter, y además:",
      "11-50 empleados",
      "Hasta 5 sedes",
      "Turnos y planificación",
      "Geolocalización y geofencing",
      "Soporte prioritario",
    ],
  },
  enterprise: {
    key: "enterprise",
    displayName: "Enterprise",
    tagline: "Para empresas grandes",
    pricePerEmployeeCents: 600,
    monthlyMinimumCents: 30600,
    minEmployees: 51,
    maxEmployees: null,
    popular: false,
    sortOrder: 30,
    highlights: [
      "Todo lo de Pro, y además:",
      "Desde 51 empleados, sin tope",
      "Sedes ilimitadas",
      "Branding personalizado",
      "Dominio personalizado",
      "API REST y Webhooks",
      "SSO / SAML",
      "Firma electrónica",
      "SLA 99,9% y soporte dedicado",
    ],
  },
};

export const PLAN_ORDER: PlanKey[] = ["starter", "pro", "enterprise"];

/**
 * Formatea un importe en céntimos a "39 €" / "4,50 €" según haga falta.
 * Localización fija a es-ES por simplicidad — la app no soporta
 * multi-locale en Fase 8.
 */
export function formatEuros(cents: number, options: { compact?: boolean } = {}): string {
  const value = cents / 100;
  if (options.compact && Number.isInteger(value)) {
    return `${value} €`;
  }
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Calcula el coste mensual de un plan dado un número de empleados,
 * aplicando el mínimo. Devuelve céntimos.
 */
export function computeMonthlyCostCents(plan: PlanKey, employees: number): number {
  const p = PLAN_PRICING[plan];
  const variable = Math.max(0, employees) * p.pricePerEmployeeCents;
  return Math.max(variable, p.monthlyMinimumCents);
}

/**
 * Devuelve true si el número de empleados encaja en el rango del plan.
 * El rango es inclusivo (`minEmployees ≤ n ≤ maxEmployees`).
 */
export function isPlanCompatible(plan: PlanKey, employees: number): boolean {
  const p = PLAN_PRICING[plan];
  if (employees < p.minEmployees) return false;
  if (p.maxEmployees !== null && employees > p.maxEmployees) return false;
  return true;
}

/**
 * Devuelve el plan que corresponde a un número de empleados según el rango.
 * Si no hay coincidencia exacta (e.g. 0 empleados) devuelve el plan más
 * pequeño que pueda absorberlo (`starter`).
 */
export function recommendedPlan(employees: number): PlanKey {
  if (employees <= 0) return "starter";
  for (const key of PLAN_ORDER) {
    if (isPlanCompatible(key, employees)) return key;
  }
  return "enterprise";
}

/**
 * Texto humano del rango de empleados del plan (para la UI).
 *   starter    → "1-10 empleados"
 *   pro        → "11-50 empleados"
 *   enterprise → "Desde 51 empleados"
 */
export function rangeLabel(plan: PlanKey): string {
  const p = PLAN_PRICING[plan];
  if (p.maxEmployees === null) return `Desde ${p.minEmployees} empleados`;
  return `${p.minEmployees}-${p.maxEmployees} empleados`;
}
