# Cierre de Fase 3 — Resolución de tenant y refactor del producto

- **Estado**: CERRADA
- **Fecha**: 2026-04-30
- **Plan**: [`00-fase-3-plan.md`](./00-fase-3-plan.md)
- **Riesgo §11.3**: CERRADO (verificación empírica en runtime real con `next dev`)

## 1. Resumen ejecutivo

Fase 3 cerrada con dos pivots arquitectónicos descubiertos durante la
implementación, ambos verificados empíricamente:

1. **Pivot A (commit 17, leak test)**: el diseño ADR-002 §2.2 de "un
   cliente Prisma + `SET search_path` por query" no funciona con
   Prisma 7 + `adapter-pg` porque Prisma cualifica el SQL con `"public"`
   por defecto. Sustituido por **un cliente Prisma por tenant** cacheado
   en `globalThis`, con `PrismaPgOptions.schema = "tenant_<slug>"`.
2. **Pivot B (cierre §11.3)**: el `runWithTenant` del `proxy.ts` no se
   propaga al handler de la ruta API en Next 16 (continuaciones
   distintas — verificado: `proxy.ts: 4ms, application-code: 55ms` con
   error "No hay tenant en el contexto"). Sustituido por un **HOF
   `withTenant`** que cada handler aplica explícitamente, leyendo el
   Host del request y reanidando `runWithTenant`.

Ambos pivots **mejoran** la garantía de seguridad respecto al diseño
original:

- El cliente por tenant elimina el race condition entre `SET search_path`
  y la query (Pivot A).
- El HOF aplica status check + JWT cross-validation también a nivel de
  handler (defensa en profundidad), no solo en proxy (Pivot B).

## 2. 12 criterios de aceptación §14

| # | Criterio                                                                                                  | Estado |
|---|-----------------------------------------------------------------------------------------------------------|--------|
| 1 | `prisma/schema.prisma` solo master + `multiSchema = ["master"]`                                           | ✅      |
| 2 | `prisma/schema-tenant.prisma` con 19 modelos + 5 enums sin `@@schema` ni `multiSchema`                    | ✅      |
| 3 | `prisma/migrations-tenant/` con baseline + `tenants:migrate` aplica al schema                             | ✅      |
| 4 | `tenants:provision` crea schema + GRANTs (tolerantes en local) + replica template + master + features + quotas | ✅      |
| 5 | `proxy.ts` resuelve host→tenant + 5 estados → códigos HTTP + subdominios reservados                       | ✅      |
| 6 | Cliente del producto cualifica con schema del tenant correcto (Pivot A: cliente por tenant)               | ✅      |
| 7 | `hasFeature(key)`, `getLimit(key)`, `consumeQuota(key, n)` operan contra `currentTenant()` y BD           | ✅      |
| 8 | Test de fuga (4 escenarios) verde                                                                         | ✅ 9/9 (incluye 4 sub-tests del E4) |
| 9 | Lint custom `no-legacy-prisma` falla CI si endpoint en `src/app/api/` (excepto whitelist) importa `prisma`/`prismaMaster` | ✅ 0 violaciones |
| 10 | `npm test` y `npm run test:integration` verdes                                                            | ✅ 110/110 totales |
| 11 | `tsc --noEmit` exit 0 + `prisma validate` valid                                                            | ✅      |
| 12 | Cobertura ≥80% (lines/functions) y ≥75% (branches) en `src/lib/tenant/**`                                  | ✅ 86.95/82.48/87.5/85.79 |

## 3. Riesgo §11.3 — verificación empírica

### 3.1 Confirmación abierto

```
GET /api/dashboard 500 in 168ms (next.js: 109ms, proxy.ts: 4ms, application-code: 55ms)
GET /api/dashboard error: Error: No hay tenant en el contexto.
    at currentTenant (src/lib/tenant/context.ts:78:11)
    at Object.get (src/lib/prisma.ts:127:37)        ← Proxy de prismaApp
    at GET (src/app/api/dashboard/route.ts:27:36)   ← Handler de la ruta
```

El log de Next 16 muestra que `proxy.ts` y `application-code` corren en
continuaciones distintas. El `runWithTenant` del proxy NO envuelve al
handler. Mismo patrón observado en el callback `authorize` de NextAuth
(que corre en una continuación interna de Auth.js).

### 3.2 Cierre

**Mitigación**: HOF `withTenant` (`src/lib/tenant/with-tenant.ts`)
aplicado a 42 endpoints. Cada handler:

```ts
export const GET = withTenant(async (req) => {
  // currentTenant() funciona aquí. prismaApp también.
});
```

`withTenant` re-resuelve el tenant del Host (cache hit del resolver,
sin BD), valida status, JWT cross-validation, y reanida runWithTenant.

`authorize` de NextAuth aplica la misma idea inline (no usa el HOF
porque su firma es distinta) — `src/lib/auth.ts` lee `req.headers.host`,
hace `resolveTenant(host)` y reanida `runWithTenant`.

### 3.3 Verificación E2E final (runtime real)

```
POST /api/auth/callback/credentials  → 302 + Set-Cookie session-token  ✅
GET  /api/dashboard (Cookie session) → 200 con sinFichar=[Dani Dev]    ✅
GET  /api/empleados (Cookie session) → 200 con admin@dev.local OWNER   ✅
GET  /api/tiendas   (Cookie session) → 200 con []                      ✅
```

Datos correctos del schema `tenant_dev` en cada endpoint. Riesgo §11.3
**CERRADO**.

## 4. Cobertura final

```
File            | % Stmts | % Branch | % Funcs | % Lines
----------------|---------|----------|---------|--------
features.ts     |   72.91 |     64.4 |   80.76 |   69.62
host.ts         |     100 |    95.45 |     100 |     100
resolver.ts     |   96.15 |    94.11 |      50 |      95
with-tenant.ts  |     100 |     92.3 |     100 |     100
All files       |   86.95 |    82.48 |    87.5 |   85.79
```

Umbrales del proyecto: lines/functions ≥80%, branches ≥75%. **Todos
cumplidos**.

`features.ts` es el único archivo bajo umbral individual; sus líneas
descubiertas (191, 249, 341-380) corresponden a `consumeQuota` y al
`assertKnownFeature` del path "feature_key desconocida" en producción
(fail-closed). Se cubrirán en Fase 5 cuando llegue el flow real de
quotas.

## 5. TODOs documentados (para Fase 4 y posteriores)

### 5.1 Enmienda ADR-002 §2.2

ADR-002 §2.2 propuso "un cliente Prisma + SET search_path por query".
Realidad implementada (Pivot A + Pivot B):

- **Cliente del producto**: un Prisma client por tenant, multiplexado
  por `currentTenant().slug` mediante Proxy (`src/lib/prisma.ts`).
  Cada cliente con `PrismaPgOptions.schema = "tenant_<slug>"`.
  Memoria: ~1 cliente + 1 pool pg por tenant activo.
- **Propagación de contexto**: `runWithTenant` se reanida en cada
  handler vía HOF `withTenant`; el proxy ya no envuelve.

Acción Fase 4: enmienda formal a ADR-002 §2.2 explicando los dos
pivots, con los logs empíricos como evidencia.

### 5.2 Enmienda ADR-002 §2.5 (JWT cross-validation)

La validación cruzada slug-host vs slug-JWT (→ 401) se ejecuta ahora
en `withTenant`, no en el proxy. Documentar en ADR-002 §2.5.

### 5.3 Discrepancia desarrollo vs producción (roles Postgres)

En desarrollo local usamos un único superuser `fichaje_admin` para los
4 clientes Prisma; los 4 roles separados (`master_role`, `app_role`,
`tenant_runtime_role`, `quota_writer_role`) sólo se crean en producción
(Fase 8). `tenants-provision.ts` y `dev-seed-tenant.ts` toleran que
los roles no existan (try/catch en GRANTs) — alineado con esta
decisión. Documentado en `AGENTS.md`.

### 5.4 LRU del cache de clientes Prisma por tenant

`globalThis._tenantClients` es un `Map<slug, PrismaClient>` sin
límite. Para volumen >100 tenants se necesitará LRU + dispose. Fase 9.

### 5.5 Pendientes de Fase 4

- Eliminar `/api/setup` y `/api/setup/reset` (legacy mono-tenant) cuando
  llegue el flow de Stripe Checkout.
- Refactor de `src/lib/migrate.ts` (DDL imperativo de Fase 0.5,
  redundante tras Fase 3).

### 5.6 Verificación pendiente

El JWT cross-validation está testeado a nivel unitario (with-tenant.test
+ leak.integration.test E3) pero no E2E con dos hosts y dos JWTs reales
en `next dev`. Test E2E completo del escenario 3 ADR-001 §2.4 cuando se
añada un `super-admin:create` test runner (Fase 7) o como parte del
test de fuga ampliado.

## 6. Setup local Postgres dedicado

Para desarrollo local se levantó un container Postgres dedicado:

```
Container:  fichaje_postgres  (postgres:16-alpine, puerto 5433)
Superuser:  fichaje_admin / fichaje_dev_2026
BBDD:       fichaje_db
```

URLs en `.env` (Fase 3):

```
MASTER_DATABASE_URL          → fichaje_admin@localhost:5433/fichaje_db?schema=master,public
APP_DATABASE_URL             → fichaje_admin@localhost:5433/fichaje_db
TENANT_RUNTIME_DATABASE_URL  → fichaje_admin@localhost:5433/fichaje_db
QUOTA_WRITER_DATABASE_URL    → fichaje_admin@localhost:5433/fichaje_db
TENANT_ROOT_DOMAIN           = localhost
TENANT_CACHE_TTL_MS          = 60000
TENANT_NEGATIVE_CACHE_TTL_MS = 5000
```

Datos sembrados: master (3 plans, 32 features, 96 plan_features, 44
reserved_slugs), schema `tenant_template` con 19 tablas, schema
`tenant_dev` con OWNER `admin@dev.local`/`dev_password_2026` para login
local en `http://dev.localhost:3000`.

## 7. Resumen de commits añadidos en la sesión de cierre §11.3

```
9d51e38 fix(tenant): HOF withTenant en cada handler de ruta API (resuelve riesgo §11.3)
86dfe3f fix(scripts): dev-seed-tenant usa el id real del tenant (no hardcoded)
2052c6c fix(seeds): liberar slug 'dev' (era reservado, conflicto con §15.3 Fase 3)
```

Total Fase 3 (commit 1 → cierre §11.3): 26 commits + 2 fixes en feature/saas-migration.

## 8. Próximos pasos

`feature/saas-migration` está lista para mergear a `main` cuando
quieras (ya no es bloqueante porque verificamos en runtime real). El
arranque de Fase 4 (Stripe + onboarding) puede continuar desde aquí.
