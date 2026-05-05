/**
 * Catálogo de precios y posicionamiento UI de los 3 planes empleaIA.
 *
 * Modelo (Sesame-like, sin rangos por nº de empleados):
 *   - Cualquier empresa puede contratar cualquier plan independientemente
 *     de su tamaño. Los planes se diferencian por **features**, no por
 *     cuántos empleados tienen.
 *   - `pricePerEmployeeCents`: facturación por empleado activo y mes.
 *   - Mínimo facturable global: `MIN_BILLABLE_SEATS` usuarios en TODOS
 *     los planes. El cliente paga MAX(empleados, MIN_BILLABLE_SEATS) ×
 *     pricePerEmployee. Si tiene menos empleados que el mínimo, se le
 *     facturan los seats del mínimo.
 *   - El mínimo monetario por plan se deriva: 15 × precio_unitario.
 *     Starter    4 €/emp · mínimo 60 €/mes  (15 × 4)
 *     Pro        5 €/emp · mínimo 75 €/mes  (15 × 5)
 *     Enterprise 6 €/emp · mínimo 90 €/mes  (15 × 6)
 *
 * El operador es el responsable de configurar los Stripe Prices con
 * `billing_scheme=per_unit`. La quantity la calcula el backend
 * (`calculateQuantity` en `checkout.ts`) respetando MIN_BILLABLE_SEATS.
 */

export type PlanKey = "starter" | "pro" | "enterprise";

/**
 * Mínimo de usuarios facturables en cualquier plan.
 * Si el tenant tiene menos empleados activos que este mínimo, se le
 * factura igualmente este nº de seats. Inspirado en el modelo Sesame.
 */
export const MIN_BILLABLE_SEATS = 15;

export interface PlanPricing {
  key: PlanKey;
  displayName: string;
  tagline: string;
  /** Precio por empleado activo y mes, en céntimos de €. */
  pricePerEmployeeCents: number;
  /** Mínimo mensual a facturar = MIN_BILLABLE_SEATS × pricePerEmployeeCents. */
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
    monthlyMinimumCents: 400 * MIN_BILLABLE_SEATS, // 60 €
    popular: false,
    sortOrder: 10,
    highlights: [
      "Fichaje web, móvil, tablet y Face ID",
      "Empleados y sedes ilimitados",
      "Multi-empresa (varios CIF)",
      "Ausencias, vacaciones y turnos",
      "Bolsa de horas",
      "Gestor de tareas y organigrama",
      "Reclutamiento (5 ofertas activas)",
      "Documentos (4 GB) y firma electrónica (3/año)",
      "Preparación y envío de nóminas",
      "Formación (LMS)",
      "Canal de denuncias (Ley 2/2023)",
      "Marketplace de integraciones",
      "Soporte por email",
    ],
  },
  pro: {
    key: "pro",
    displayName: "Pro",
    tagline: "Para empresas en crecimiento",
    pricePerEmployeeCents: 500,
    monthlyMinimumCents: 500 * MIN_BILLABLE_SEATS, // 75 €
    popular: true,
    sortOrder: 20,
    highlights: [
      "Todo lo de Starter, y además:",
      "Geolocalización y geofencing",
      "Onboarding y offboarding",
      "Evaluaciones del desempeño",
      "Encuestas de clima laboral",
      "Gestión de objetivos (OKRs)",
      "Chat interno",
      "Reserva de espacios y hot-desking",
      "Control de gastos y retribución flexible",
      "Wallet (tarjetas para empleados)",
      "Reclutamiento (25 ofertas activas)",
      "Documentos (6 GB) y firma (4/año)",
      "Peticiones personalizadas",
      "People Analytics y auditoría avanzada",
      "Soporte prioritario",
    ],
  },
  enterprise: {
    key: "enterprise",
    displayName: "Enterprise",
    tagline: "Para empresas grandes",
    pricePerEmployeeCents: 600,
    monthlyMinimumCents: 600 * MIN_BILLABLE_SEATS, // 90 €
    popular: false,
    sortOrder: 30,
    highlights: [
      "Todo lo de Pro, y además:",
      "Asistente IA empleaIA",
      "Asistente WhatsApp",
      "Reclutamiento ilimitado",
      "Documentos (10 GB) y firma ilimitada",
      "Branding personalizado",
      "Dominio personalizado (CNAME)",
      "API REST y Webhooks",
      "SSO / SAML",
      "SLA 99,9 % y soporte dedicado",
    ],
  },
};

export const PLAN_ORDER: PlanKey[] = ["starter", "pro", "enterprise"];

/**
 * Formatea un importe en céntimos a "60 €" / "4,50 €" según haga falta.
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
 * aplicando el mínimo global de 15 usuarios. Devuelve céntimos.
 */
export function computeMonthlyCostCents(plan: PlanKey, employees: number): number {
  const p = PLAN_PRICING[plan];
  const billableSeats = Math.max(MIN_BILLABLE_SEATS, Math.max(0, employees));
  return billableSeats * p.pricePerEmployeeCents;
}
