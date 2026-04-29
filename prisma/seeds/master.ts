/**
 * Seed del control plane (schema master).
 *
 * Idempotente: cada upsert por `key`/`slug`. Re-ejecutable sin duplicar.
 *
 * Catálogo según §11.3 + §11.4 de docs/arch/00-auditoria.md:
 *   - 3 planes (starter, pro, enterprise).
 *   - 32 features (4 limits + 24 booleans + 4 quotas).
 *   - 96 plan_features (3 × 32, todos los planes con todas las features
 *     explícitamente; las que "no aplican" llevan valor 0/false para que
 *     getLimit/hasFeature sean predecibles).
 *   - 45 reserved_slugs.
 *
 * super_admins: tabla queda vacía. Se crea con `npm run super-admin:create`.
 */

import { PrismaClient } from "../../src/generated/prisma/client";

type FeatureType = "boolean" | "limit" | "quota";

type FeatureDef = {
  key: string;
  name: string;
  type: FeatureType;
  quotaPeriod?: "mes" | "dia";
  description?: string;
};

const PLANS = [
  {
    key: "starter",
    name: "Plan Starter",
    description: "Empresa pequeña, 1 local, hasta 10 empleados.",
    sortOrder: 10,
  },
  {
    key: "pro",
    name: "Plan Pro",
    description: "Multi-tienda, turnos, bolsa de horas, exportaciones.",
    sortOrder: 20,
  },
  {
    key: "enterprise",
    name: "Plan Enterprise",
    description: "Sin límites, integraciones, dominio propio, API.",
    sortOrder: 30,
  },
] as const;

const FEATURES: FeatureDef[] = [
  // ─── Limits (4) ────────────────────────────────────────────────────────────
  { key: "max_employees", name: "Máximo de empleados activos", type: "limit" },
  { key: "max_tiendas", name: "Máximo de tiendas activas", type: "limit" },
  { key: "historial_meses", name: "Meses de histórico accesibles", type: "limit" },
  { key: "max_storage_mb", name: "Almacenamiento (MB)", type: "limit" },

  // ─── Booleans — funcionalidad (13) ─────────────────────────────────────────
  { key: "multi_tienda", name: "Multi-tienda (>1 ubicación)", type: "boolean" },
  { key: "geofencing", name: "Geofencing por GPS", type: "boolean" },
  { key: "fichaje_movil", name: "Fichaje desde móvil/PWA", type: "boolean" },
  { key: "fichaje_tablet", name: "Fichaje desde tablet compartida", type: "boolean" },
  { key: "bolsa_horas", name: "Bolsa de horas", type: "boolean" },
  { key: "turnos_publicacion", name: "Planificación y publicación de turnos", type: "boolean" },
  { key: "ausencias_aprobacion", name: "Flujo de aprobación de ausencias", type: "boolean" },
  { key: "onboarding_offboarding", name: "Onboarding y offboarding", type: "boolean" },
  { key: "comunicados", name: "Comunicados internos", type: "boolean" },
  { key: "articulos", name: "Base de conocimiento", type: "boolean" },
  { key: "documentos", name: "Gestión documental por empleado", type: "boolean" },
  { key: "notificaciones_email", name: "Notificaciones por email", type: "boolean" },
  { key: "notificaciones_push", name: "Notificaciones push", type: "boolean" },

  // ─── Booleans — exportación e integración (7) ──────────────────────────────
  { key: "export_csv", name: "Exportar a CSV", type: "boolean" },
  { key: "export_excel", name: "Exportar a Excel (XLSX)", type: "boolean" },
  { key: "export_pdf", name: "Exportar a PDF", type: "boolean" },
  { key: "api_access", name: "API REST pública", type: "boolean" },
  { key: "webhooks", name: "Webhooks salientes", type: "boolean" },
  { key: "integraciones_nomina", name: "Integraciones con software de nómina", type: "boolean" },
  { key: "firma_electronica", name: "Firma electrónica de documentos", type: "boolean" },

  // ─── Booleans — branding y operaciones (4) ─────────────────────────────────
  { key: "branding_personalizado", name: "Branding personalizado", type: "boolean" },
  { key: "dominio_personalizado", name: "Dominio personalizado (CNAME)", type: "boolean" },
  { key: "auditoria_avanzada", name: "Auditoría avanzada", type: "boolean" },
  { key: "people_analytics", name: "People Analytics", type: "boolean" },

  // ─── Quotas (4) ────────────────────────────────────────────────────────────
  { key: "emails_mes", name: "Emails enviables por mes", type: "quota", quotaPeriod: "mes" },
  { key: "pushs_mes", name: "Notificaciones push por mes", type: "quota", quotaPeriod: "mes" },
  { key: "exports_mes", name: "Exportaciones por mes", type: "quota", quotaPeriod: "mes" },
  { key: "api_calls_dia", name: "Llamadas API por día", type: "quota", quotaPeriod: "dia" },
];

// Cuadro §11.4 de la auditoría. Valores explícitos por plan; null = unlimited.
// Un valor 0 en quota api_calls_dia cuando api_access=false significa "no
// aplica": la quota nunca se consume porque el endpoint está cerrado.
type PlanFeatureValue = boolean | number | null;

const PLAN_FEATURE_VALUES: Record<string, Record<string, PlanFeatureValue>> = {
  starter: {
    max_employees: 10,
    max_tiendas: 1,
    historial_meses: 6,
    max_storage_mb: 500,
    multi_tienda: false,
    geofencing: true,
    fichaje_movil: true,
    fichaje_tablet: false,
    bolsa_horas: false,
    turnos_publicacion: false,
    ausencias_aprobacion: true,
    onboarding_offboarding: false,
    comunicados: true,
    articulos: false,
    documentos: true,
    notificaciones_email: true,
    notificaciones_push: false,
    export_csv: false,
    export_excel: false,
    export_pdf: true,
    api_access: false,
    webhooks: false,
    integraciones_nomina: false,
    firma_electronica: false,
    branding_personalizado: false,
    dominio_personalizado: false,
    auditoria_avanzada: false,
    people_analytics: false,
    emails_mes: 200,
    pushs_mes: 1000,
    exports_mes: 5,
    api_calls_dia: 0,
  },
  pro: {
    max_employees: 50,
    max_tiendas: 5,
    historial_meses: 36,
    max_storage_mb: 5000,
    multi_tienda: true,
    geofencing: true,
    fichaje_movil: true,
    fichaje_tablet: true,
    bolsa_horas: true,
    turnos_publicacion: true,
    ausencias_aprobacion: true,
    onboarding_offboarding: true,
    comunicados: true,
    articulos: true,
    documentos: true,
    notificaciones_email: true,
    notificaciones_push: true,
    export_csv: true,
    export_excel: true,
    export_pdf: true,
    api_access: false,
    webhooks: false,
    integraciones_nomina: false,
    firma_electronica: false,
    branding_personalizado: true,
    dominio_personalizado: false,
    auditoria_avanzada: true,
    people_analytics: false,
    emails_mes: 5000,
    pushs_mes: null,
    exports_mes: 100,
    api_calls_dia: 0,
  },
  enterprise: {
    max_employees: null,
    max_tiendas: null,
    historial_meses: 120,
    max_storage_mb: 50000,
    multi_tienda: true,
    geofencing: true,
    fichaje_movil: true,
    fichaje_tablet: true,
    bolsa_horas: true,
    turnos_publicacion: true,
    ausencias_aprobacion: true,
    onboarding_offboarding: true,
    comunicados: true,
    articulos: true,
    documentos: true,
    notificaciones_email: true,
    notificaciones_push: true,
    export_csv: true,
    export_excel: true,
    export_pdf: true,
    api_access: true,
    webhooks: true,
    integraciones_nomina: true,
    firma_electronica: true,
    branding_personalizado: true,
    dominio_personalizado: true,
    auditoria_avanzada: true,
    people_analytics: true,
    emails_mes: null,
    pushs_mes: null,
    exports_mes: null,
    api_calls_dia: 10000,
  },
};

const RESERVED_SLUGS: Array<{ slug: string; reason: string }> = [
  { slug: "admin", reason: "subdominio del panel super-admin" },
  { slug: "app", reason: "subdominio público (landing, registro, checkout)" },
  { slug: "www", reason: "alias clásico del apex" },
  { slug: "api", reason: "reservado para API pública futura" },
  { slug: "status", reason: "reservado para status page" },
  { slug: "docs", reason: "reservado para documentación" },
  { slug: "mail", reason: "subdominio técnico de correo" },
  { slug: "blog", reason: "reservado para blog" },
  { slug: "ftp", reason: "subdominio técnico FTP" },
  { slug: "smtp", reason: "subdominio técnico SMTP" },
  { slug: "ns", reason: "subdominio reservado DNS" },
  { slug: "ns1", reason: "subdominio reservado DNS" },
  { slug: "ns2", reason: "subdominio reservado DNS" },
  { slug: "root", reason: "reservado por convención" },
  { slug: "support", reason: "reservado para soporte" },
  { slug: "help", reason: "reservado para ayuda" },
  { slug: "login", reason: "reservado para flujo de login global" },
  { slug: "signup", reason: "reservado para registro" },
  { slug: "register", reason: "reservado para registro" },
  { slug: "billing", reason: "reservado para facturación" },
  { slug: "security", reason: "reservado para seguridad/contacto" },
  { slug: "abuse", reason: "reservado por estándar (abuse@dominio)" },
  { slug: "webmaster", reason: "reservado por estándar" },
  { slug: "postmaster", reason: "reservado por estándar" },
  { slug: "hostmaster", reason: "reservado por estándar" },
  { slug: "hostinfo", reason: "reservado por estándar" },
  { slug: "no-reply", reason: "reservado por convención email" },
  { slug: "noreply", reason: "reservado por convención email" },
  { slug: "info", reason: "reservado para información de contacto" },
  { slug: "contact", reason: "reservado para contacto" },
  { slug: "sales", reason: "reservado para ventas" },
  { slug: "legal", reason: "reservado para legal" },
  { slug: "privacy", reason: "reservado para política de privacidad" },
  { slug: "terms", reason: "reservado para términos de servicio" },
  { slug: "dashboard", reason: "reservado por convención" },
  { slug: "panel", reason: "reservado por convención" },
  { slug: "control", reason: "reservado por convención" },
  { slug: "master", reason: "reservado para evitar confusión con el control plane" },
  { slug: "public", reason: "reservado para evitar confusión con el schema public" },
  { slug: "test", reason: "reservado para entornos de test" },
  { slug: "dev", reason: "reservado para entornos de desarrollo" },
  { slug: "staging", reason: "reservado para entorno de staging" },
  { slug: "prod", reason: "reservado para entorno de producción" },
  { slug: "production", reason: "reservado para entorno de producción" },
  { slug: "demo", reason: "reservado para entornos de demostración" },
];

export async function seedMaster(prisma: PrismaClient): Promise<void> {
  // 1. Plans (3 upserts).
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      create: { key: plan.key, name: plan.name, description: plan.description, sortOrder: plan.sortOrder },
      update: { name: plan.name, description: plan.description, sortOrder: plan.sortOrder },
    });
  }

  // 2. Features (32 upserts).
  for (const f of FEATURES) {
    await prisma.feature.upsert({
      where: { key: f.key },
      create: {
        key: f.key,
        name: f.name,
        type: f.type,
        quotaPeriod: f.quotaPeriod ?? null,
        description: f.description ?? null,
      },
      update: {
        name: f.name,
        type: f.type,
        quotaPeriod: f.quotaPeriod ?? null,
        description: f.description ?? null,
      },
    });
  }

  // 3. PlanFeatures (96 upserts: 3 planes × 32 features).
  for (const [planKey, featureValues] of Object.entries(PLAN_FEATURE_VALUES)) {
    const plan = await prisma.plan.findUniqueOrThrow({ where: { key: planKey } });
    for (const [featureKey, value] of Object.entries(featureValues)) {
      await prisma.planFeature.upsert({
        where: { planId_featureKey: { planId: plan.id, featureKey } },
        create: { planId: plan.id, featureKey, value: value as never },
        update: { value: value as never },
      });
    }
  }

  // 4. ReservedSlugs (45 upserts).
  for (const r of RESERVED_SLUGS) {
    await prisma.reservedSlug.upsert({
      where: { slug: r.slug },
      create: { slug: r.slug, reason: r.reason },
      update: { reason: r.reason },
    });
  }

  // Verificación visual.
  const counts = {
    plans: await prisma.plan.count(),
    features: await prisma.feature.count(),
    planFeatures: await prisma.planFeature.count(),
    reservedSlugs: await prisma.reservedSlug.count(),
  };
  console.log("[seed master]", counts);
}
