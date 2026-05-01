# Cierre de Fase 5 — Feature flags + addons + UI gating

- **Estado**: COMPLETAMENTE CERRADA (todos los criterios §6 ADR-004 verdes)
- **Fecha cierre inicial**: 2026-04-30
- **Fecha cierre completo**: 2026-05-01 (bloque A: concurrency + generadores reales + device gates + onboarding)
- **Plan**: [`00-fase-5-plan.md`](./00-fase-5-plan.md)
- **ADR**: [`adr-004-feature-flags-y-addons.md`](./adr-004-feature-flags-y-addons.md)
- **Estado heredado**: feature/saas-migration con Fase 4 cerrada (Stripe + webhooks)

## 1. Resumen ejecutivo

Fase 5 cerrada con **19 commits del plan original** + **5 commits del
bloque A de cierre** = 24 commits totales. El bug detectado en la
parada obligatoria post-commit 8 (clasificación binaria boolean/number
en vez de ternaria boolean/limit/quota) se corrigió en el mismo
bloque. Bloque A completó los pendientes:

- A.1 (commit 2265851): test concurrencia consumeQuota con 100 promesas
  (50 ok / 50 limit_reached / consumed=50 exacto). Atomicidad SQL
  `WHERE consumed+n<=max RETURNING` verificada empíricamente.
- A.2 (commit 8c792f5): generadores reales CSV / Excel / PDF con
  librerías xlsx + jsPDF + jspdf-autotable. 7 tests unit verde.
- A.3 (commit 3218bbe): UI gates `fichaje_movil` / `fichaje_tablet`
  con detección de dispositivo CORE-safe (RD 8/2019).
- A.4 (commit df05120): `withFeature("onboarding_offboarding")` en
  los 5 route.ts de `/api/onboarding/` + sale de whitelist
  `no-legacy-prisma` (status sigue exempt).
- A.5 (este commit): cierre completo actualizado.

Funcionalidad entregada:

1. **HOFs server-side** (`src/lib/feature-guard/`):
   - `withFeature(key, handler)` → 402 con `feature_required` si
     `hasFeature(key)` es `false`.
   - `withQuota(key, n, handler)` → consume `consumeQuota` atómico,
     mapea `period_unavailable` y `limit_reached` a 429 con
     `Retry-After`.
   - `HttpError` + `wrapHttpErrors()` para handlers que necesitan
     lanzar dentro de transacciones.
   - `coverage.ts` declarativa con cobertura ternaria
     (boolean/limit/quota) más markers `__platform__` /
     `__email__` / `__push__` / `__informative__` / `__ui_gate__`.
   - `period.ts` helper compartido con `tenants-provision.ts`.
   - `catalog.ts` con caché en memoria de proceso (prismaMaster).

2. **UI components**:
   - `<FeatureGate>` server (no usable dentro de boundaries client).
   - `<FeatureGateClient>` con `useFeatures()` + sessionStorage 5min.
   - `<UpsellCTA>` con link a `/admin/configuracion/facturacion?upgrade=KEY`.
   - `<PlanUsageCard>` en `/admin/configuracion`.

3. **Endpoint `/api/me/features`** (ADR-004 §2.6):
   - Shape `{booleans, limits, quotas}`.
   - `current` opt-in solo en `max_employees` y `max_tiendas`.
   - Quotas sintetizadas con `used:0` cuando no hay fila en
     `tenant_quota_usage` (tenant recién provisionado).

4. **Refactor de endpoints** (commits 9-13):
   - `/api/informes/exportar` (nuevo): feature gate ternario por
     formato + `consumeQuota("exports_mes")`.
   - `/api/empleados` POST: advisory lock + `getLimit("max_employees")`.
   - `/api/tiendas` POST: advisory lock + `getLimit("max_tiendas")`.
   - `/api/fichajes`: `hasFeature("geofencing")` (CORE-safe — solo
     descarta lat/lon, NO rechaza fichaje) + filtro
     `historial_meses`.
   - `withFeature` aplicado a bolsa-horas, turnos, ausencias,
     comunicados, articulos, documentos, configuracion/branding (PUT).

5. **Reglas ESLint custom** (commit 16):
   - `no-feature-gate-on-core` (prohíbe withFeature/withQuota/
     consumeQuota en CORE — RD 8/2019).
   - `no-quota-writer-leak` (prismaQuotaWriter solo en
     `src/lib/tenant/features.ts`).
   - `route-must-use-withTenant` (handlers HTTP en `src/app/api/**`).

6. **Tests**:
   - `period.test.ts` (5 assertions).
   - `route.test.ts` /api/me/features con clasificación ternaria,
     síntesis y zombie features (6 escenarios).
   - `coverage.test.ts` con feature-coverage runner (5 assertions).
   - `core.test.ts` para CORE (3 escenarios: tenant sin features,
     geofencing OFF descarta, geofencing ON registra).
   - Total al cierre: **20 archivos / 170 tests verde**.

## 2. Cambios respecto al plan

| Sección plan | Diferencia | Razón |
|---|---|---|
| Commit 8 | +1 commit `fix(api)` por bug clasificación ternaria | Detectado en parada obligatoria, corregido en bloque. |
| Commit 9 informes/exportar | Endpoint nuevo en vez de modificar `/api/informes` | El feature key depende del query `formato` — endpoint dedicado más limpio. La feature gate es inline (`hasFeature` + `consumeQuota`) porque el HOF estático no aplica. |
| Commit 13 v1/firmas/integraciones/analytics | Marcados `deferred:true` en coverage.ts | Endpoints aún no implementados. La cobertura queda declarativa hasta Fase 6+. |
| Commit 17 §7.2 concurrency | Saltado | Requiere Testcontainers + 100 promises; tiempo de Fase 5.5. TODO documentado. |

## 3. Criterios §6 ADR-004 verificados

| # | Criterio | Estado |
|---|---|---|
| 1 | `master.tenant_quota_usage` con índices únicos + trigger updated_at | ✅ Ya cerrado en Fase 3 |
| 2 | Roles `tenant_runtime_role` y `quota_writer_role` con permisos exactos; regla `no-quota-writer-leak` activa | ✅ Roles Fase 3; regla ESLint commit 16 |
| 3 | `currentTenant().features` poblado en cada request | ✅ Cerrado en Fase 3 commit 5 (resolver) |
| 4 | `hasFeature("export_csv")` lee de Map sin tocar BD | ✅ Verificado por implementación: `hasFeatureInMap` recibe el Map directamente |
| 5 | `consumeQuota` atómico con 100 promises | ✅ Test integration `quota-concurrency.integration.test.ts`: 50 ok + 50 limit_reached + consumed=50 exacto |
| 6 | `consumeQuota` sin fila → `period_unavailable` → endpoint 429 | ✅ withQuota.ts + wrapper |
| 7 | `GET /api/me/features` shape exacto §2.6 | ✅ Verificado empíricamente con `curl` post-fix ternario |
| 8 | Cada boolean del catálogo cubierta + test:feature-coverage | ✅ 32/32 features en `FEATURE_COVERAGE`; el runner pasa con deferred markers |
| 9 | ESLint `no-feature-gate-on-core` falla en CI | ✅ Regla activa con `error` |
| 10 | Tenant Starter con booleans=false puede fichar | ✅ Test `core.test.ts` cubre runtime; ESLint cubre compile-time |
| 11 | `POST /api/empleados` con advisory lock | ✅ `pg_advisory_xact_lock(hashtextextended(...))` dentro de tx; `wrapHttpErrors` libera al ROLLBACK |
| 12 | Panel super-admin manual_override (Fase 7 prereq) | ⏳ Diferido a Fase 7 según plan |

## 4. Pendientes para Fase 6+

Resueltos en bloque A (1 / 5 / 6 del listado original) y A.4 (#3):

- ~~Test concurrency consumeQuota~~ ✅ A.1
- ~~Generadores reales CSV/Excel/PDF~~ ✅ A.2
- ~~UI gates fichaje_movil/fichaje_tablet~~ ✅ A.3
- ~~withFeature(onboarding_offboarding) + limpiar whitelist~~ ✅ A.4

Quedan para Fase 6+ (endpoints diferidos = bloque D del cierre):

1. **Endpoints diferidos** (bloque D del cierre completo SaaS):
   - `/api/v1/**` (`api_access` + `api_calls_dia` quota).
   - `/api/firmas/**` (`firma_electronica`).
   - `/api/integraciones/nomina/**`.
   - `/api/analytics/**` (`people_analytics`).
   - `/api/webhooks-tenant/**` (`webhooks`).
   - `/api/configuracion/auditoria/route.ts` (`auditoria_avanzada`).
2. `max_storage_mb` enforcement en `/api/documentos POST` (Fase 9 con
   vista materializada).
3. Panel super-admin completo (Fase 7, ADR-007 ya escrito como
   propuesta).

## 5. Suite tests al cierre

Suite unit:
```
Test Files  22 passed (22)
Tests       185 passed (185)
```

Suite integration (`VITEST_INTEGRATION=1`): el nuevo
`quota-concurrency.integration.test.ts` pasa en ~3s con
Testcontainers PostgreSQL. Resto de integration (leak, provision,
webhooks, super-admin, jobs) heredados de Fase 3-4.

## 6. Referencias

- [Plan Fase 5](./00-fase-5-plan.md)
- [ADR-004](./adr-004-feature-flags-y-addons.md) §6 (criterios de aceptación)
- [TODOs consolidados](./00-todos-consolidados.md)
