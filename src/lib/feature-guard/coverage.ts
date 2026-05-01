/**
 * Tabla declarativa endpoint → features. Fase 5 ADR-004 §2.8.
 *
 * Esta tabla declara qué features cubre cada endpoint del producto.
 * Sirve dos propósitos:
 *
 *  1. Auditoría: revisar de un vistazo qué endpoints están bajo qué
 *     feature gate.
 *  2. Test runner `npm run test:feature-coverage`: verifica que cada
 *     feature del catálogo §11.4 (32 entries) tiene al menos un
 *     endpoint que la usa via `withFeature` / `withQuota` / `getLimit`.
 *
 * **Convención**: un endpoint puede aparecer en múltiples filas si
 * combina varias features (e.g. `/api/informes/exportar` chequea
 * `export_csv` Y consume `exports_mes`).
 *
 * **CORE excluido**: features marcadas como CORE (registro_jornada_legal)
 * NO aparecen aquí. La regla ESLint `no-feature-gate-on-core` lo enforce.
 */

export type CoverageEntry = {
  /** Patrón de path del endpoint (relativo a src/app/api/). Glob simple. */
  endpointGlob: string;
  /** Feature key del catálogo §11.4. */
  featureKey: string;
  /** Tipo de check aplicado. */
  guard: "withFeature" | "withQuota" | "getLimit" | "hasFeature";
  /** Para withQuota: cantidad consumida por request. */
  quotaAmount?: number;
  /**
   * Endpoint declarado pero AÚN no implementado en código (Fase 6+).
   * El test:feature-coverage no exige que el archivo exista en este caso
   * — solo registra la cobertura prevista.
   */
  deferred?: boolean;
};

export const FEATURE_COVERAGE: readonly CoverageEntry[] = [
  // ─── Booleans — operaciones del producto ─────────────────────────────────
  // multi_tienda: flag informativo (la UI puede mostrar/ocultar selector
  // de tiendas). El control real lo hace max_tiendas (limit). No hay
  // handler que llame hasFeature('multi_tienda') porque max_tiendas=1
  // ya implica plan sin multi-tienda. Marker para el coverage check.
  { endpointGlob: "__informative__", featureKey: "multi_tienda", guard: "hasFeature" },
  { endpointGlob: "fichajes/route.ts", featureKey: "geofencing", guard: "hasFeature" },
  // fichaje_movil / fichaje_tablet: gates de UI (desactivar botón
  // según dispositivo). Plan §5.1. No hay endpoint dedicado — el
  // POST /api/fichajes es CORE (RD 8/2019, no se puede gatear).
  { endpointGlob: "__ui_gate__", featureKey: "fichaje_movil", guard: "hasFeature" },
  { endpointGlob: "__ui_gate__", featureKey: "fichaje_tablet", guard: "hasFeature" },
  { endpointGlob: "bolsa-horas/**/route.ts", featureKey: "bolsa_horas", guard: "withFeature" },
  { endpointGlob: "turnos/**/route.ts", featureKey: "turnos_publicacion", guard: "withFeature" },
  { endpointGlob: "ausencias/**/route.ts", featureKey: "ausencias_aprobacion", guard: "withFeature" },
  { endpointGlob: "onboarding/**/route.ts", featureKey: "onboarding_offboarding", guard: "withFeature" },
  { endpointGlob: "comunicados/**/route.ts", featureKey: "comunicados", guard: "withFeature" },
  { endpointGlob: "articulos/**/route.ts", featureKey: "articulos", guard: "withFeature" },
  { endpointGlob: "documentos/**/route.ts", featureKey: "documentos", guard: "withFeature" },

  // ─── Booleans — exportación e integración ────────────────────────────────
  { endpointGlob: "informes/exportar/route.ts", featureKey: "export_csv", guard: "hasFeature" },
  { endpointGlob: "informes/exportar/route.ts", featureKey: "export_excel", guard: "hasFeature" },
  { endpointGlob: "informes/exportar/route.ts", featureKey: "export_pdf", guard: "hasFeature" },
  // api_access, webhooks, integraciones_nomina, firma_electronica:
  // endpoints planeados Fase 6+. Cobertura declarativa hasta entonces.
  { endpointGlob: "v1/**/route.ts", featureKey: "api_access", guard: "withFeature" },
  { endpointGlob: "webhooks-tenant/route.ts", featureKey: "webhooks", guard: "withFeature" },
  { endpointGlob: "integraciones/nomina/route.ts", featureKey: "integraciones_nomina", guard: "withFeature" },
  { endpointGlob: "firmas/route.ts", featureKey: "firma_electronica", guard: "withFeature" },

  // ─── Booleans — branding y meta ──────────────────────────────────────────
  { endpointGlob: "configuracion/branding/route.ts", featureKey: "branding_personalizado", guard: "withFeature" },
  // dominio_personalizado: gestionado por OWNER del tenant en Fase 6.
  // /api/configuracion/dominio + /verify usan withFeature.
  { endpointGlob: "configuracion/dominio/route.ts", featureKey: "dominio_personalizado", guard: "withFeature" },
  { endpointGlob: "configuracion/auditoria/route.ts", featureKey: "auditoria_avanzada", guard: "withFeature" },
  { endpointGlob: "analytics/route.ts", featureKey: "people_analytics", guard: "withFeature" },

  // ─── Limits ───────────────────────────────────────────────────────────────
  { endpointGlob: "empleados/route.ts", featureKey: "max_employees", guard: "getLimit" },
  { endpointGlob: "tiendas/route.ts", featureKey: "max_tiendas", guard: "getLimit" },
  { endpointGlob: "fichajes/route.ts", featureKey: "historial_meses", guard: "getLimit" },
  { endpointGlob: "documentos/route.ts", featureKey: "max_storage_mb", guard: "getLimit" },

  // ─── Quotas ──────────────────────────────────────────────────────────────
  { endpointGlob: "informes/exportar/route.ts", featureKey: "exports_mes", guard: "withQuota", quotaAmount: 1 },
  // emails_mes: consumido por src/lib/email/send.ts (no un endpoint).
  // Se marca con __email__ para excluir del check de paths.
  { endpointGlob: "__email__", featureKey: "emails_mes", guard: "withQuota", quotaAmount: 1 },
  // pushs_mes: idem para push.
  { endpointGlob: "__push__", featureKey: "pushs_mes", guard: "withQuota", quotaAmount: 1 },
  { endpointGlob: "v1/**/route.ts", featureKey: "api_calls_dia", guard: "withQuota", quotaAmount: 1 },

  // ─── Notificaciones (sin endpoint dedicado) ──────────────────────────────
  // N17 cerrado: src/lib/email.ts:sendEmail y src/lib/push.ts:sendPush
  // chequean hasFeature + consumeQuota antes de enviar.
  { endpointGlob: "__email__", featureKey: "notificaciones_email", guard: "hasFeature" },
  { endpointGlob: "__push__", featureKey: "notificaciones_push", guard: "hasFeature" },

  // ─── Limit sin enforcement directo (Fase 9 vista materializada) ──────────
  // max_storage_mb: declarativo. /api/documentos POST debería sumar
  // tamaños y rechazar si excede; Fase 9 con vista materializada.
];

/**
 * Devuelve las features cubiertas por la coverage map. Las CORE
 * (registro_jornada_legal) NO aparecen aquí — la regla ESLint
 * no-feature-gate-on-core las exonera.
 */
export function coveredFeatureKeys(): Set<string> {
  return new Set(FEATURE_COVERAGE.map((c) => c.featureKey));
}

/**
 * Features CORE que NO se chequean (RD 8/2019). Tampoco aparecen en
 * el catálogo §11.4 actual; este array sirve solo si en el futuro se
 * añade una feature CORE explícita.
 */
export const CORE_FEATURES: readonly string[] = [];
