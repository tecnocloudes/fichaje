/**
 * Catálogo de precios y posicionamiento UI de los 3 planes empleaIA.
 *
 * IMPORTANTE: las cantidades reales que cobra Stripe viven en el dashboard
 * de Stripe (price IDs declarados via STRIPE_PRICE_*). Este módulo solo
 * declara los **precios canónicos** que la UI muestra al cliente y los
 * **mínimos mensuales** del modelo per-seat.
 *
 * Modelo:
 *   - `pricePerEmployeeCents`: facturación por empleado activo y mes.
 *   - `monthlyMinimumCents`: el cliente paga MAX(empleados × per_employee,
 *     monthly_minimum). Bajo el mínimo equivale a un "early-employee
 *     discount" inverso: para equipos muy pequeños el coste por empleado
 *     equivale al mínimo.
 *
 * El operador es el responsable de configurar los Stripe Prices con
 * `billing_scheme=per_unit` + `transform_quantity` o un `flat_amount`
 * mínimo según haga falta. Ver `scripts/stripe-bootstrap.ts`.
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
    monthlyMinimumCents: 3900,
    popular: false,
    sortOrder: 10,
    highlights: [
      "Fichaje web, móvil y tablet",
      "Hasta 10 empleados",
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
    monthlyMinimumCents: 4900,
    popular: true,
    sortOrder: 20,
    highlights: [
      "Todo lo de Starter, y además:",
      "Hasta 50 empleados",
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
    monthlyMinimumCents: 9900,
    popular: false,
    sortOrder: 30,
    highlights: [
      "Todo lo de Pro, y además:",
      "Empleados y sedes ilimitados",
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
