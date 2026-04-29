# Plan de Fase 2 — Control plane

- **Estado**: PROPUESTO (pendiente de aprobación antes de tocar código)
- **Fecha**: 2026-04-30
- **Spec maestra**: [`../specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md), apartado "Fase 2 — Control plane"
- **ADRs aplicables**: 001, 002, 003, 004, 005

## 0. Objetivo

Crear el **modelo de datos del control plane** en el schema `master` de
PostgreSQL, los **roles Postgres** que las capas siguientes (middleware
HTTP, app del producto, helper `consumeQuota`) van a usar, las **seeds**
con catálogo de planes/features y slugs reservados, los **helpers**
funcionales (`getTenantBySlug`, `hasFeature`, `getLimit`) y sus **tests
unitarios**.

Fuera del alcance de Fase 2:

- `consumeQuota` (necesita `AsyncLocalStorage`, que llega en Fase 3).
- Middleware de resolución de tenant (Fase 3).
- Webhook de Stripe (Fase 4).
- UI super-admin (Fase 7).
- `master.audit_log` (la tabla la cierra ADR-007 antes de Fase 7).
- Migración de roles real en VPS (Fase 8 cutover).

---

## 1. Configuración de Prisma multi-schema

Prisma 7.x soporta multi-schema estable. Cambio en
`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["master", "public"]
}
```

- Los modelos del control plane llevan `@@schema("master")`.
- Los modelos del producto actuales (User, Tienda, Fichaje, …) **se
  quedan en `public`** durante Fase 2. Su movimiento a `tenant_<slug>`
  es trabajo de Fase 3 (refactor del producto).
- Migraciones aplicadas con `prisma migrate deploy` usando
  `DATABASE_URL = MASTER_DATABASE_URL` (o la URL local del dev). Se
  documenta en `prisma.config.ts`.

---

## 2. Enums (5)

| Enum                  | Schema   | Valores                                                                     | Origen ADR                |
|-----------------------|----------|------------------------------------------------------------------------------|---------------------------|
| `TenantStatus`        | `master` | `pending`, `provisioning`, `active`, `suspended`, `deleted`                  | ADR-002 §2.4 (con enmienda PROVISIONING) |
| `SubscriptionStatus`  | `master` | `trialing`, `active`, `past_due`, `unpaid`, `canceled`, `paused`, `incomplete`, `incomplete_expired` | ADR-003 §2.2              |
| `FeatureSource`       | `master` | `plan`, `addon`, `manual_override`                                           | ADR-003 §2.9, ADR-004 §2.9 |
| `FeatureType`         | `master` | `boolean`, `limit`, `quota`                                                  | §11.1 auditoría            |
| `PlatformRol`         | `master` | `SUPER_ADMIN`, `SUPPORT`                                                     | ADR-001 §5.1               |

Ningún cambio al enum existente `Rol` (`OWNER`, `MANAGER`, `EMPLEADO`)
de Fase 0.5 — sigue en `public` (luego se moverá a `tenant_<slug>` en
Fase 3).

---

## 3. Tablas a crear en schema `master` (10)

Todas con `id text PRIMARY KEY` generado con `cuid()` salvo donde se
indique. Todas con `@@schema("master")`. Convención de nombres en BD:
`snake_case` (vía `@map`); en TS: `PascalCase`/`camelCase`.

### 3.1 `master.tenants` — núcleo del control plane

| Columna                | Tipo                        | Constraints                                                                 | Notas |
|------------------------|-----------------------------|------------------------------------------------------------------------------|-------|
| `id`                   | `text`                      | PK                                                                            | cuid  |
| `slug`                 | `text`                      | UNIQUE NOT NULL, `CHECK (slug ~ '^[a-z][a-z0-9_]{2,30}$')`                   | ADR-001 §2.5 + ADR-002 §2.1 |
| `name`                 | `text`                      | NOT NULL                                                                      | Razón social / nombre legible para listados |
| `email`                | `text`                      | NOT NULL                                                                      | Email de contacto del OWNER inicial |
| `status`               | `master.TenantStatus`       | NOT NULL DEFAULT `'pending'`                                                  | ADR-002 §2.4 |
| `stripe_customer_id`   | `text`                      | UNIQUE NULL                                                                   | Sentinel `cus_manual_*` para cutover (ADR-004 §5.4) |
| `created_at`           | `timestamptz`               | NOT NULL DEFAULT `now()`                                                      |       |
| `updated_at`           | `timestamptz`               | NOT NULL DEFAULT `now()`                                                      | trigger `touch_updated_at` |

Índices: `slug` (UNIQUE implícito), `(status)` para listados rápidos.

### 3.2 `master.reserved_slugs`

| Columna       | Tipo                  | Constraints                              |
|---------------|-----------------------|-------------------------------------------|
| `slug`        | `text`                | PK, `CHECK (slug = lower(slug))`          |
| `reason`      | `text`                | NOT NULL                                  |
| `created_at`  | `timestamptz`         | NOT NULL DEFAULT `now()`                  |

### 3.3 `master.plans`

| Columna       | Tipo               | Constraints                       | Notas                                   |
|---------------|--------------------|------------------------------------|-----------------------------------------|
| `id`          | `text`             | PK                                 | cuid                                    |
| `key`         | `text`             | UNIQUE NOT NULL                    | `'starter'`, `'pro'`, `'enterprise'`    |
| `name`        | `text`             | NOT NULL                           | "Plan Starter"                          |
| `description` | `text`             | NULL                                |                                         |
| `active`      | `boolean`          | NOT NULL DEFAULT `true`            |                                         |
| `sort_order`  | `int`              | NOT NULL DEFAULT `0`               |                                         |
| `created_at`  | `timestamptz`      | NOT NULL DEFAULT `now()`           |                                         |
| `updated_at`  | `timestamptz`      | NOT NULL DEFAULT `now()`           | trigger `touch_updated_at`              |

**Sin precios**: los precios viven en Stripe (vars
`STRIPE_PRICE_*` de ADR-005 §2.3.b). Aquí solo metadatos para UI de
selección de plan en `app.ficha.tecnocloud.es/registro`.

### 3.4 `master.features` — catálogo

| Columna         | Tipo                 | Constraints                 | Notas                                        |
|-----------------|----------------------|------------------------------|----------------------------------------------|
| `id`            | `text`               | PK                           | cuid                                         |
| `key`           | `text`               | UNIQUE NOT NULL              | `'export_csv'`, `'max_employees'`, etc.      |
| `name`          | `text`               | NOT NULL                     | "Exportar a CSV"                             |
| `description`   | `text`               | NULL                          |                                              |
| `type`          | `master.FeatureType` | NOT NULL                     | `boolean` / `limit` / `quota`                |
| `quota_period`  | `text`               | NULL, `CHECK (...)`          | Para `quota`: `'mes'` o `'dia'`. NULL en otros |
| `active`        | `boolean`            | NOT NULL DEFAULT `true`      |                                              |
| `created_at`    | `timestamptz`        | NOT NULL DEFAULT `now()`     |                                              |
| `updated_at`    | `timestamptz`        | NOT NULL DEFAULT `now()`     | trigger `touch_updated_at`                   |

`CHECK`: `(type = 'quota' AND quota_period IS NOT NULL) OR (type != 'quota' AND quota_period IS NULL)`.

### 3.5 `master.plan_features` — qué features tiene cada plan

| Columna       | Tipo               | Constraints                                          |
|---------------|--------------------|-------------------------------------------------------|
| `id`          | `text`             | PK                                                    |
| `plan_id`     | `text`             | FK → `master.plans(id)` ON DELETE CASCADE             |
| `feature_key` | `text`             | NOT NULL (sin FK explícita; ver nota ADR-003 §2.2)    |
| `value`       | `jsonb`            | NOT NULL                                              |
| `created_at`  | `timestamptz`      | NOT NULL DEFAULT `now()`                              |

Constraint UNIQUE `(plan_id, feature_key)`.

`value` codifica:
- `boolean`: `true` o `false`
- `limit`: número entero o `null` (unlimited)
- `quota`: número entero o `null` (unlimited)

### 3.6 `master.tenant_features` — features resueltas por tenant

| Columna         | Tipo                    | Constraints                                            |
|-----------------|-------------------------|---------------------------------------------------------|
| `id`            | `text`                  | PK                                                      |
| `tenant_id`     | `text`                  | FK → `master.tenants(id)` ON DELETE CASCADE             |
| `feature_key`   | `text`                  | NOT NULL                                                |
| `value`         | `jsonb`                 | NOT NULL                                                |
| `source`        | `master.FeatureSource`  | NOT NULL                                                |
| `expires_at`    | `timestamptz`           | NULL                                                    |
| `reason`        | `text`                  | NULL (NOT NULL CHECK si `source = 'manual_override'`)   |
| `created_at`    | `timestamptz`           | NOT NULL DEFAULT `now()`                                |
| `updated_at`    | `timestamptz`           | NOT NULL DEFAULT `now()`                                |

Constraint UNIQUE `(tenant_id, feature_key, source)` — ADR-003 §2.9.

`CHECK`:
`(source = 'manual_override' AND reason IS NOT NULL AND length(reason) >= 10) OR (source != 'manual_override')`.

### 3.7 `master.subscriptions`

Shape definido en ADR-003 §2.2. Resumen:

| Columna                   | Tipo                          |
|---------------------------|-------------------------------|
| `id`                      | `text` PK                     |
| `tenant_id`               | FK tenants ON DELETE CASCADE  |
| `stripe_subscription_id`  | `text` UNIQUE NOT NULL        |
| `stripe_customer_id`      | `text` NOT NULL               |
| `plan_key`                | `text` NOT NULL               |
| `status`                  | `master.SubscriptionStatus`   |
| `current_period_start`    | `timestamptz` NOT NULL        |
| `current_period_end`      | `timestamptz` NOT NULL        |
| `cancel_at_period_end`    | `boolean` NOT NULL DEFAULT `false` |
| `trial_end`               | `timestamptz` NULL            |
| `raw_event_id_last`       | `text` NULL                   |
| `created_at`, `updated_at`| `timestamptz`                 |

Índices: `(tenant_id)`, `(status)`.

### 3.8 `master.subscription_items`

| Columna           | Tipo            | Constraints                                                  |
|-------------------|-----------------|---------------------------------------------------------------|
| `id`              | `text`          | PK                                                            |
| `subscription_id` | `text`          | FK → `master.subscriptions(id)` ON DELETE CASCADE             |
| `stripe_item_id`  | `text`          | UNIQUE NOT NULL                                               |
| `feature_key`     | `text`          | NOT NULL                                                      |
| `quantity`        | `int`           | NOT NULL DEFAULT `1`                                          |
| `created_at`      | `timestamptz`   | NOT NULL DEFAULT `now()`                                      |

### 3.9 `master.stripe_events` — idempotencia de webhooks

Definido en ADR-003 §2.2:

| Columna             | Tipo            |
|---------------------|-----------------|
| `event_id`          | `text` PK (de Stripe) |
| `type`              | `text` NOT NULL  |
| `api_version`       | `text` NOT NULL  |
| `created_at`        | `timestamptz` NOT NULL  |
| `received_at`       | `timestamptz` NOT NULL DEFAULT `now()` |
| `processed_at`      | `timestamptz` NULL |
| `processing_error`  | `text` NULL |
| `payload`           | `jsonb` NOT NULL |

Índices: `(type)`, `(received_at)`.

### 3.10 `master.tenant_quota_usage`

Definido en ADR-004 §2.3:

| Columna         | Tipo            | Constraints                                                  |
|-----------------|-----------------|---------------------------------------------------------------|
| `id`            | `text`          | PK                                                            |
| `tenant_id`     | `text`          | FK → `master.tenants(id)` ON DELETE CASCADE                   |
| `feature_key`   | `text`          | NOT NULL                                                      |
| `period_start`  | `timestamptz`   | NOT NULL                                                      |
| `period_end`    | `timestamptz`   | NOT NULL                                                      |
| `consumed`      | `bigint`        | NOT NULL DEFAULT `0`                                          |
| `max`           | `bigint`        | NULL (NULL = unlimited)                                       |
| `created_at`    | `timestamptz`   | NOT NULL DEFAULT `now()`                                      |
| `updated_at`    | `timestamptz`   | NOT NULL DEFAULT `now()`                                      |

UNIQUE `(tenant_id, feature_key, period_start)`. Índice
`(tenant_id, feature_key, period_end)` para resolver "fila vigente".

### 3.11 `master.super_admins`

| Columna       | Tipo                     | Constraints                              |
|---------------|---------------------------|-------------------------------------------|
| `id`          | `text`                    | PK                                        |
| `email`       | `text`                    | UNIQUE NOT NULL                           |
| `password`    | `text`                    | NOT NULL                                  |
| `name`        | `text`                    | NOT NULL                                  |
| `role`        | `master.PlatformRol`      | NOT NULL DEFAULT `SUPER_ADMIN`            |
| `active`      | `boolean`                 | NOT NULL DEFAULT `true`                   |
| `last_login`  | `timestamptz`             | NULL                                      |
| `created_at`  | `timestamptz`             | NOT NULL DEFAULT `now()`                  |
| `updated_at`  | `timestamptz`             | NOT NULL DEFAULT `now()`                  |

`password` es hash bcrypt (mismo método que `User.password` actual).

### 3.12 Tablas que NO se crean en Fase 2

- `master.audit_log` — ADR-007 (auth super-admin) la define antes de
  Fase 7. Se documenta en este plan como TODO.
- Ninguna tabla `tenant_*` — esas son de Fase 3.

### 3.13 Funciones y triggers SQL

**Función `master.touch_updated_at()`**: trigger genérico
`BEFORE UPDATE` que setea `NEW.updated_at = now()`. Aplicada a:
`tenants`, `plans`, `features`, `tenant_features`, `subscriptions`,
`tenant_quota_usage`, `super_admins`.

**Función `master.check_slug_not_reserved()`**: ADR-002 §2.1. Trigger
`BEFORE INSERT OR UPDATE OF slug` en `master.tenants` que rechaza
slugs presentes en `master.reserved_slugs` con código de error
`23514`.

---

## 4. Roles Postgres (4 en total)

| Rol                    | Estado        | Permisos                                                                                       |
|------------------------|---------------|-------------------------------------------------------------------------------------------------|
| `master_role`          | Ya existe     | Owner del schema `master`. Crea/modifica todas las tablas y enums. Único que aplica DDL.        |
| `app_role`             | NUEVO Fase 2  | `USAGE` sobre futuros schemas `tenant_*` (Fase 3). En Fase 2 se crea sin permisos sobre `master`. Permisos sobre tenant_* se aplican con `DEFAULT PRIVILEGES` cuando Fase 3 cree el primer schema. |
| `tenant_runtime_role`  | NUEVO Fase 2  | `USAGE` schema master + `SELECT` en `tenants`, `reserved_slugs`, `tenant_features`, `tenant_quota_usage`. Sin escritura. |
| `quota_writer_role`    | NUEVO Fase 2  | `USAGE` schema master + `SELECT, INSERT, UPDATE` solo en `tenant_quota_usage`. Sin acceso a otras tablas. |

SQL de creación (idempotente, en `scripts/sql/00-roles.sql`):

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
    CREATE ROLE app_role LOGIN PASSWORD :app_role_password;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_runtime_role') THEN
    CREATE ROLE tenant_runtime_role LOGIN PASSWORD :tenant_runtime_role_password;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quota_writer_role') THEN
    CREATE ROLE quota_writer_role LOGIN PASSWORD :quota_writer_role_password;
  END IF;
END $$;

GRANT USAGE ON SCHEMA master TO tenant_runtime_role;
GRANT SELECT ON master.tenants            TO tenant_runtime_role;
GRANT SELECT ON master.reserved_slugs     TO tenant_runtime_role;
GRANT SELECT ON master.tenant_features    TO tenant_runtime_role;
GRANT SELECT ON master.tenant_quota_usage TO tenant_runtime_role;

GRANT USAGE ON SCHEMA master TO quota_writer_role;
GRANT SELECT, INSERT, UPDATE ON master.tenant_quota_usage TO quota_writer_role;

REVOKE ALL ON SCHEMA master FROM PUBLIC;
REVOKE ALL ON SCHEMA master FROM app_role;
```

Las contraseñas son parámetros (`:rol_password`) que se inyectan al
ejecutar el script desde un wrapper Node con secrets reales. Nunca en
el repo.

> En Fase 2 **no se ejecuta** este SQL contra una BD productiva. El
> archivo se versiona y se aplica a la BD local del dev y al CI. La
> aplicación a producción es Fase 8 (cutover) según ADR-005 §5.4 paso
> (d).

---

## 5. Seeds

Archivo: `prisma/seed.ts` (extendido sobre el existente).

### 5.1 `master.plans` — 3 filas

| key          | name              | sort_order |
|--------------|-------------------|------------|
| `starter`    | Plan Starter      | 10         |
| `pro`        | Plan Pro          | 20         |
| `enterprise` | Plan Enterprise   | 30         |

### 5.2 `master.features` — 30 filas (catálogo §11.3 + §11.4)

**Booleans (22)**: `multi_tienda`, `geofencing`, `fichaje_movil`,
`fichaje_tablet`, `bolsa_horas`, `turnos_publicacion`,
`ausencias_aprobacion`, `onboarding_offboarding`, `comunicados`,
`articulos`, `documentos`, `notificaciones_email`,
`notificaciones_push`, `branding_personalizado`,
`dominio_personalizado`, `export_csv`, `export_excel`, `export_pdf`,
`api_access`, `webhooks`, `integraciones_nomina`,
`firma_electronica`, `auditoria_avanzada`, `people_analytics`.
(24 con `evaluaciones`/`objetivos` futuros — los **excluyo** de seed
inicial para no contaminar; se añadirán cuando se implementen).

**Limits (4)**: `max_employees`, `max_tiendas`, `historial_meses`,
`max_storage_mb`.

**Quotas (4)**: `emails_mes` (period `mes`), `pushs_mes` (`mes`),
`exports_mes` (`mes`), `api_calls_dia` (`dia`).

Total: 22 booleans + 4 limits + 4 quotas = **30 features**.

`max_owners` **no entra** en este seed (es cap operativo en código,
§11.3 auditoría).

`registro_jornada_legal` **no entra** (es CORE no desactivable,
§11.2 auditoría — no se chequea con `hasFeature`).

### 5.3 `master.plan_features` — 3 × 30 = 90 filas (con limits/quotas válidos)

Mapping exacto del cuadro §11.4 auditoría. Lista verbose disponible en
el archivo de seed; resumen:

| Plan       | Filas insertadas (features incluidas) |
|------------|----------------------------------------|
| starter    | 30 filas (todas las del catálogo, con valor según §11.4: ej. `max_employees=10`, `geofencing=true`, `api_access=false`, etc.) |
| pro        | 30 filas (con valores Pro: `max_employees=50`, `api_access=false`, `dominio_personalizado=false` aunque haya addon)         |
| enterprise | 30 filas (con valores Enterprise: muchos `unlimited`/`null`, `api_access=true`, `dominio_personalizado=true`)               |

Los **addons** comercializados (§11.4 columna Addon) **no se siembran**
en `plan_features`: son productos Stripe separados que insertan en
`tenant_features` con `source = 'addon'` cuando un tenant los compra
(ADR-003 §2.9).

### 5.4 `master.reserved_slugs` — 45 filas (lista §2.1 ADR-002)

```
admin, app, www, api, status, docs, mail, blog, ftp, smtp,
ns, ns1, ns2, root, support, help, login, signup, register,
billing, security, abuse, webmaster, postmaster, hostmaster,
hostinfo, no-reply, noreply, info, contact, sales, legal,
privacy, terms, dashboard, panel, control, master, public,
test, dev, staging, prod, production, demo
```

Cada fila con `reason` informativo (p. ej. "subdominio técnico
plataforma", "subdominio reservado para soporte", "ambiente").

### 5.5 `master.super_admins` — 0 filas

El seed **no crea** ningún super-admin. Se introducirá vía un comando
CLI dedicado:

```sh
npm run super-admin:create -- --email=admin@tecnocloud.es --name="Daniel Sánchez"
```

Pide la contraseña por stdin (no por argumento). Hashea con bcrypt.
Inserta con `role = 'SUPER_ADMIN'`. Idempotente: si el email existe,
actualiza `name` y `last_login` opcionalmente; no resetea password
salvo flag explícito `--reset-password`.

### 5.6 Idempotencia de los seeds

Todos los seeds usan upsert por `key` o `slug`:

```ts
await prisma.plan.upsert({
  where: { key: 'starter' },
  create: { key: 'starter', name: 'Plan Starter', sort_order: 10 },
  update: { name: 'Plan Starter', sort_order: 10 },
});
```

Permite ejecutar `npm run db:seed` múltiples veces sin duplicar.

---

## 6. Helpers de Fase 2

Archivo: `src/lib/tenant/features.ts` (nuevo).

### 6.1 Tipo `ResolvedFeature`

```ts
export type ResolvedFeature = {
  key: string;
  type: "boolean" | "limit" | "quota";
  value: boolean | number | null;          // null = unlimited (limit/quota); para boolean siempre true/false
  source: "plan" | "addon" | "manual_override";
  expiresAt: Date | null;
};
```

### 6.2 `getTenantBySlug(slug)`

```ts
export async function getTenantBySlug(slug: string): Promise<Tenant | null>;
```

- Lee de `master.tenants` con `prismaMaster` (Fase 2 solo tiene
  `prismaMaster`; los demás clientes vienen en Fase 3 y Fase 4-5).
- Devuelve `null` si no existe.
- **No** valida `status` aquí — el caller decide qué hacer con cada
  status. La validación + mapping a HTTP es trabajo del middleware
  (Fase 3).

### 6.3 `loadFeaturesFor(tenantId)`

```ts
export async function loadFeaturesFor(
  tenantId: string,
): Promise<Map<string, ResolvedFeature>>;
```

- Lee `master.tenant_features` (todas las filas del tenant, con
  `expires_at IS NULL OR expires_at > now()`).
- Aplica la prioridad `manual_override > addon > plan` (ADR-003 §2.9
  enmendado, ADR-004 §2.4) y devuelve un Map `feature_key →
  ResolvedFeature`.
- Para `limit` y `quota`: agrega máximo entre `plan` y `addons`,
  excepto si hay `manual_override` activo (que gana).
- Devuelve Map vacío si no hay features (caso normal en tenant
  recién creado en `pending`).

### 6.4 `hasFeature(features, key)` y `getLimit(features, key)`

```ts
export const FEATURE_CATALOG: Set<string> = new Set([...]);  // cargado desde master.features al arranque

export function hasFeature(
  features: Map<string, ResolvedFeature>,
  key: string,
): boolean;

export function getLimit(
  features: Map<string, ResolvedFeature>,
  key: string,
): number | null;
```

- **Funciones puras síncronas** sobre el Map. No tocan BD.
- Aplican `assertKnownFeature(key)` (ADR-004 §2.4 enmendado): throw
  en dev/test, log + fail-closed en prod si la key no está en el
  catálogo.
- En Fase 3 se añadirá un wrapper que lee `currentTenant().features`
  y delega a estas funciones puras. Las firmas evolucionarán pero la
  lógica interna queda intacta.

### 6.5 `consumeQuota` se aplaza

`consumeQuota` necesita `prismaQuotaWriter` y un contexto de tenant
en `AsyncLocalStorage`. Ambos llegan en **Fase 3** (middleware) y
**Fase 5** (helpers de runtime con contexto). En Fase 2 documentamos
el stub:

```ts
// src/lib/tenant/features.ts
// TODO Fase 3: implementar consumeQuota cuando AsyncLocalStorage esté
// en su sitio. Por ahora no se exporta para evitar uso prematuro.
```

---

## 7. Tests unitarios

Archivo: `src/lib/tenant/features.test.ts` (nuevo).

Stack de testing: **Vitest** + **Testcontainers Postgres** (decisión
ADR-001 §2.4 propuesta provisional). Esta elección se ratifica en
Fase 2 instalando solo `vitest` y `@testcontainers/postgresql` cuando
hagan falta tests de integración. Para Fase 2 los tests son
**mayoritariamente puros** (sobre el Map), pero `getTenantBySlug` y
`loadFeaturesFor` requieren BD — Postgres efímero por suite.

### 7.1 Tests puros (no requieren BD)

| Test                                        | Verifica                                                                                                |
|---------------------------------------------|----------------------------------------------------------------------------------------------------------|
| `hasFeature` con key no aprovisionada       | Devuelve `false`                                                                                         |
| `hasFeature` con feature `plan` true        | Devuelve `true`                                                                                          |
| `hasFeature` con `manual_override = false` y `plan = true` | Devuelve `false` (override gana)                                                                  |
| `hasFeature` con `manual_override` expirado | Ignora override; usa el siguiente nivel                                                                  |
| `hasFeature` con key fuera del catálogo (dev) | Lanza Error                                                                                              |
| `hasFeature` con key fuera del catálogo (prod) | Devuelve `false` y log (mock)                                                                            |
| `getLimit` con `plan = 10` y `addon = 5`    | Devuelve `15` (suma para limits es agregación máxima del plan + suma de addons; ver nota ADR-004 §2.9)   |
| `getLimit` con `manual_override = 100`      | Devuelve `100` (override gana, puede subir o bajar)                                                      |
| `getLimit` con `manual_override = 0` y `plan = 50` | Devuelve `0` (override puede bajar; ADR-004 §2.9)                                                  |
| `getLimit` con `value = null` (unlimited)   | Devuelve `null`                                                                                          |

> **Nota sobre agregación de limits**: ADR-004 §2.9 enmendado dice
> "máximo entre plan y addons" para limits y "suma" para quotas. Esta
> regla se respeta literalmente en los tests. `max_storage_mb`
> + addon `storage_extra` se suma porque el catálogo trata
> `max_storage_mb` como limit, pero la semántica del addon es
> incremental (bloques de 1 GB). En el seed, el addon
> `addon_storage_extra` insertará una fila extra con
> `feature_key = 'max_storage_mb'`, `value = 1000` (1 GB en MB),
> `source = 'addon'`. La agregación máxima dentro de cada source y
> luego suma plan + addon (regla acordada con el usuario en ADR-004
> §2.9 — confirmar al revisar este plan, ver §11 abajo).

### 7.2 Tests con BD efímera (Testcontainers)

| Test                                                              | Verifica                                                                |
|-------------------------------------------------------------------|--------------------------------------------------------------------------|
| `getTenantBySlug('inexistente')`                                  | Devuelve `null`                                                          |
| `getTenantBySlug('telecom')` con tenant ACTIVE en BD              | Devuelve el tenant correcto                                              |
| `getTenantBySlug('TELECOM')` (mayúsculas)                         | Devuelve `null` (slug es lowercase por CHECK)                            |
| Insertar tenant con slug `'admin'`                                | Falla por trigger `tenants_slug_not_reserved`                            |
| Insertar tenant con slug `'a'` (corto)                            | Falla por CHECK del slug                                                 |
| Insertar tenant con slug `'1abc'` (empieza por número)            | Falla por CHECK del slug                                                 |
| Insertar tenant con slug `'tenant-malicioso; DROP …'`             | Falla por CHECK del slug (cierra Escenario 4 del test de fuga ADR-001 §2.4) |
| `loadFeaturesFor` con tenant que tiene plan + addon               | Map contiene ambos con `source` correcto                                  |
| `loadFeaturesFor` con `manual_override` expirado                  | El override expirado **no** aparece en el Map                            |
| Insertar `tenant_features` con `source='manual_override'` y `reason=NULL` | Falla por CHECK                                                          |
| Insertar `tenant_features` con `source='manual_override'` y `reason='corto'` (8 chars) | Falla por CHECK (mínimo 10 chars)                                  |
| Conectar con `tenant_runtime_role` e intentar `INSERT INTO master.tenant_quota_usage` | Falla `permission denied` |
| Conectar con `tenant_runtime_role` e intentar `SELECT * FROM master.subscriptions`    | Falla `permission denied` |
| Conectar con `quota_writer_role` e intentar `SELECT * FROM master.tenants`            | Falla `permission denied` |
| Conectar con `app_role` e intentar `SELECT * FROM master.tenants`                     | Falla `permission denied` |

Los cuatro tests anteriores son **obligatorios**. Sin ellos, una
regresión en los `GRANT` del SQL de roles (§4) pasa desapercibida hasta
producción. Cierran el criterio 6 de §13 con verificación automática
en CI.

### 7.3 Tests del seed

| Test                                            | Verifica                                          |
|-------------------------------------------------|----------------------------------------------------|
| Ejecutar seed dos veces consecutivas            | No duplica filas (idempotencia)                    |
| `master.plans` tiene 3 filas tras seed          | Counts                                             |
| `master.features` tiene 30 filas tras seed      | Counts                                             |
| `master.plan_features` tiene 90 filas           | 3 planes × 30 features                             |
| `master.reserved_slugs` tiene 45 filas          | Counts                                             |
| Plan starter tiene `max_employees = 10`         | Lectura cruzada plan_features × features           |

---

## 8. Comandos npm a añadir

En `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "eslint",
    "postinstall": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:generate": "prisma generate",
    "db:seed": "npx tsx prisma/seed.ts",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "test": "vitest run",
    "test:watch": "vitest",
    "super-admin:create": "npx tsx scripts/super-admin-create.ts",
    "tenants:list":      "npx tsx scripts/tenants-list.ts",
    "tenants:provision": "npx tsx scripts/tenants-provision.ts",
    "tenants:migrate":   "npx tsx scripts/tenants-migrate.ts"
  }
}
```

### 8.1 `super-admin:create` — implementado en Fase 2

Argumentos: `--email`, `--name`, `--reset-password` (opcional). Pide
password por stdin. Hashea con bcrypt. Inserta o actualiza en
`master.super_admins`.

### 8.2 `tenants:list` — implementado en Fase 2

Lista tenants en `master.tenants` con su `slug`, `name`, `status`,
`created_at`. Para soporte y debugging.

### 8.3 `tenants:provision` — STUB en Fase 2, implementación Fase 4

Stub que documenta:

```ts
// scripts/tenants-provision.ts
console.error("tenants:provision se implementa en Fase 4 (onboarding) y se usará en Fase 8 (cutover).");
console.error("Ver ADR-003 §2.6 (coreografía) y ADR-004 §5.4 (cutover del cliente actual).");
process.exit(1);
```

### 8.4 `tenants:migrate` y `tenants:migrate:all` — STUB en Fase 2, implementación Fase 3

Stubs equivalentes que apuntan a ADR-001 §5.2 y ADR-005 §2.5.

---

## 9. Variables de entorno nuevas en Fase 2

Añadir a `.env.example` (ADR-005 §2.3):

```sh
# === Control plane ===
# Acceso pleno al schema master. Usado por migraciones, seeds, worker (Fase 4) y
# el panel super-admin (Fase 7). No usar desde la app del producto.
MASTER_DATABASE_URL=postgresql://master_role:****@localhost:5432/fichaje?schema=master,public

# Read-only sobre master.tenants, master.reserved_slugs, master.tenant_features,
# master.tenant_quota_usage. Usado por el middleware HTTP (Fase 3) y
# helpers hasFeature/getLimit. ADR-002 §3.6 + ADR-004 §2.2.
TENANT_RUNTIME_DATABASE_URL=postgresql://tenant_runtime_role:****@localhost:5432/fichaje

# SELECT/INSERT/UPDATE solo sobre master.tenant_quota_usage. Usado
# EXCLUSIVAMENTE por consumeQuota (Fase 3-5). ADR-004 §2.2.
QUOTA_WRITER_DATABASE_URL=postgresql://quota_writer_role:****@localhost:5432/fichaje

# Usado por la app del producto en cada tenant_<slug> (Fase 3+).
APP_DATABASE_URL=postgresql://app_role:****@localhost:5432/fichaje

# Configuración de runtime
TENANT_CACHE_TTL_MS=60000
```

`DATABASE_URL` legacy del repo actual queda como **alias de
`MASTER_DATABASE_URL`** durante la transición, para que `prisma migrate
deploy` siga funcionando como hoy. Se elimina en Fase 8.

---

## 10. Convenciones a seguir

### 10.1 Migraciones backward-compatible (ADR-005 §2.5.a)

**Obligatorio** en cada PR de Fase 2:

- Añadir columna `NOT NULL`: dos pasos (primero `NULL` + backfill,
  después `NOT NULL`).
- Renombrar/eliminar/cambiar tipo: dos pasos con doble escritura
  intermedia.

Para Fase 2 las tablas son **nuevas**: no aplica el patrón backward-
compat sobre tablas existentes (solo aplica desde el segundo cambio
en adelante). Pero sí para `prisma/schema.prisma` (que ya tiene los
modelos del producto en `public`): cualquier modificación a un modelo
existente aplica las reglas.

### 10.2 Naming

- **Modelos Prisma (TS)**: `PascalCase` (`Tenant`, `Plan`,
  `Feature`, `PlanFeature`, `TenantFeature`, `Subscription`,
  `SubscriptionItem`, `StripeEvent`, `TenantQuotaUsage`,
  `ReservedSlug`, `SuperAdmin`).
- **Tablas en BD**: `snake_case` plural (`tenants`, `plans`,
  `tenant_features`, etc.) vía `@@map`.
- **Columnas en BD**: `snake_case` (`stripe_customer_id`,
  `current_period_end`) vía `@map`.
- **Campos en TS**: `camelCase` (`stripeCustomerId`,
  `currentPeriodEnd`).
- **Términos de negocio del producto** (en `tenant_*`): castellano
  (`Tienda`, `Fichaje`, `Empleado`). Se mantiene la convención del
  repo actual.
- **Términos técnicos / control plane**: inglés (`Tenant`, `Plan`,
  `Feature`).
- **`@@map` explícito en todos los modelos del schema master**. Todos
  los 11 modelos del control plane llevan `@@map('snake_case_plural')`
  aunque Prisma genere un nombre similar por defecto. La pluralización
  automática de Prisma es inglesa y puede sorprender (`super_admins`
  vs `superAdmins`, `tenant_features` vs `tenantFeatures`,
  `reserved_slugs` vs `reservedSlugs`). Explícito > implícito.
  Ejemplo: `@@map("tenant_quota_usage")`. Misma regla para `@map` en
  cada columna con `snake_case` en BD.

### 10.3 Comentarios e idioma de logs

- **Comentarios JSDoc**: castellano.
- **Mensajes de log**: castellano (`logger.info("Tenant provisionado: %s", slug)`).
- **Mensajes de error API**: castellano para el cliente final.
- **Mensajes de error de programación** (lanzados con `throw new Error(...)`):
  inglés (consumidos por desarrolladores y herramientas).
- **Commits**: castellano, formato convencional (`feat:`, `fix:`,
  `refactor:`, `docs:`, `chore:`, `test:`).

### 10.4 Tests

- **Vitest** como runner.
- Tests puros: `*.test.ts` junto al código (`features.test.ts` al lado
  de `features.ts`).
- Tests con BD: `*.integration.test.ts` con tag explícito
  (`vitest --tag=integration`).
- Cobertura mínima esperada para los helpers: 80% líneas, 100% ramas
  de la lógica de prioridad de `source`.

---

## 11. Decisión de agregación de limits — cerrada

Confirmada **opción 2**: enmendar ADR-004 §2.9 para aclarar que los
addons se **suman** al limit del plan. La regla refinada queda así:

| Caso                          | Regla                                                                |
|-------------------------------|----------------------------------------------------------------------|
| Solo plan                     | `value` del plan                                                     |
| Plan + N addons               | `plan_value + sum(addons)`. **NO** máximo                            |
| `manual_override` activo      | Gana siempre, ignora plan y addons (puede subir O bajar)             |

Justificación: addons de bloques incrementales (`storage_extra`,
`emails_extra`) tienen semántica "incrementan el límite del plan". La
regla "máximo" del ADR original era para casos sin coexistencia.
Aclarar evita debate en Fase 5.

Esta enmienda se aplica como **commit independiente antes** del
commit 1 de Fase 2:

```
docs(arch): ADR-004 §2.9 — aclarar agregación de limits (suma plan + addons, override gana)
```

Edita ADR-004 §2.9 reescribiendo la tabla de combinación de fuentes
con la regla anterior. Mantiene lo demás de §2.9 igual. Tras aplicar
la enmienda, el seed y el helper `getLimit` de Fase 2 ya respetan la
regla correcta sin necesidad de retoques posteriores.

---

## 12. Orden de commits propuesto

Atómicos, cada uno con tests cuando aplique. 12 commits:

1. **`feat(prisma): habilitar multiSchema y declarar enums del control plane`**
   `prisma/schema.prisma`: añadir `schemas = ["master", "public"]` al
   datasource, los 5 enums en schema master. Ningún modelo todavía. La
   migración resultante es solo `CREATE TYPE`.

2. **`feat(prisma-master): tablas tenants y reserved_slugs + trigger slug reservado`**
   Modelos Prisma `Tenant` y `ReservedSlug`. Funciones SQL
   `master.touch_updated_at()` y `master.check_slug_not_reserved()`.
   Trigger `tenants_slug_not_reserved`. CHECK del slug regex.

3. **`feat(prisma-master): tablas plans, features y plan_features`**
   Modelos `Plan`, `Feature`, `PlanFeature`. UNIQUE
   `(plan_id, feature_key)`. CHECK de `quota_period`.

4. **`feat(prisma-master): tabla tenant_features con source enum`**
   Modelo `TenantFeature`. UNIQUE `(tenant_id, feature_key, source)`.
   CHECK de `reason` obligatorio para `manual_override`.

5. **`feat(prisma-master): tablas subscriptions y subscription_items`**
   Modelos `Subscription` y `SubscriptionItem`. Índices
   `(tenant_id)`, `(status)` en subscriptions.

6. **`feat(prisma-master): tabla stripe_events para idempotencia`**
   Modelo `StripeEvent`. Índices `(type)`, `(received_at)`.

7. **`feat(prisma-master): tabla tenant_quota_usage`**
   Modelo `TenantQuotaUsage`. UNIQUE
   `(tenant_id, feature_key, period_start)`. Índice
   `(tenant_id, feature_key, period_end)`.

8. **`feat(prisma-master): tabla super_admins`**
   Modelo `SuperAdmin`. UNIQUE `email`.

9. **`feat(roles): scripts SQL idempotentes para crear app/runtime/quota_writer`**
   `scripts/sql/00-roles.sql` y wrapper Node `scripts/sql/apply.ts`
   que lee passwords de env y ejecuta el SQL con `master_role`.
   Documentado en `README` y en `docs/deploy/dokploy.md` (TODO).

10. **`feat(prisma): clientes prismaMaster, prismaApp, prismaRuntime, prismaQuotaWriter`**
    `src/lib/prisma.ts` reescrito con los 4 clientes (los 3 nuevos
    son lazy: solo se instancian cuando se importan). Mantiene la
    export `prisma = prismaMaster` por compat con código de Fase 0,
    se renombrará en Fase 3.

11. **`feat(seeds): planes, features, plan_features, reserved_slugs + super-admin:create`**
    `prisma/seed.ts` extendido con upserts. `scripts/super-admin-create.ts`.
    Verificable con `npm run db:seed` + `npm run super-admin:create`.

12. **`feat(helpers): getTenantBySlug, loadFeaturesFor, hasFeature, getLimit + tests`**
    `src/lib/tenant/features.ts` con tipos, FEATURE_CATALOG cargado
    al arranque, y los 4 helpers. `src/lib/tenant/features.test.ts`
    con los tests puros y de integración. `npm test` en CI.

13. **`feat(scripts): comandos npm tenants:list/provision/migrate (stubs)`**
    `scripts/tenants-list.ts` (implementado), `tenants-provision.ts`
    y `tenants-migrate.ts` (stubs documentados que exit 1).

14. **`chore(env): .env.example actualizado con vars de Fase 2`**
    Añade `MASTER_DATABASE_URL`, `APP_DATABASE_URL`,
    `TENANT_RUNTIME_DATABASE_URL`, `QUOTA_WRITER_DATABASE_URL`,
    `TENANT_CACHE_TTL_MS`. Documenta el alias `DATABASE_URL` →
    `MASTER_DATABASE_URL` durante la transición.

(14 commits en realidad, no 12; cada uno reducido a un cambio
coherente y revisable.)

---

## 13. Criterios de aceptación de Fase 2

Esta fase se considera completada cuando todos los siguientes son
ciertos:

1. `npm run db:migrate:deploy` aplica todas las migraciones nuevas
   contra una BD limpia sin errores.
2. `npm run db:seed` siembra 3 planes, 30 features, 90 plan_features y
   45 reserved_slugs. Re-ejecutable sin duplicar.
3. `npm run super-admin:create -- --email=test@example.com --name=Test`
   crea una cuenta de super-admin. Idempotente.
4. `npm run tenants:list` lista los tenants existentes (en Fase 2 → 0).
5. `npm test` ejecuta los tests puros y de integración con
   Testcontainers, todos verdes. Cobertura ≥ 80% en
   `src/lib/tenant/features.ts`.
6. SQL de roles aplicado: `tenant_runtime_role` recibe
   `permission denied` al `INSERT INTO master.tenant_quota_usage`;
   `quota_writer_role` recibe `permission denied` al `SELECT * FROM master.tenants`.
7. Los CHECK constraints rechazan: slug inválido, slug reservado,
   `manual_override` sin reason o reason corto, `quota_period`
   inconsistente con `type`.
8. `tsc --noEmit` pasa.
9. `npm run lint` pasa.
10. ADRs 001–005 sin TODOs nuevos abiertos en Fase 2 (los TODOs
    pendientes son los de Fase 3+ ya documentados).

---

## 14. TODOs que arrastra Fase 2 a Fase 3+

| TODO                                                                                          | Destino |
|-----------------------------------------------------------------------------------------------|---------|
| Implementar `consumeQuota` con `prismaQuotaWriter` y `AsyncLocalStorage`                      | Fase 3-5 |
| Wrapper `hasFeature(key)` que lee `currentTenant().features`                                   | Fase 3   |
| Comando `tenants:provision` real (coreografía de ADR-003 §2.6)                                | Fase 4   |
| Comando `tenants:migrate <slug>` real (ADR-001 §5.2)                                          | Fase 3   |
| Mover modelos del producto de `public` a `tenant_<slug>`                                      | Fase 3   |
| `master.audit_log` (decisión cerrada por ADR-007)                                             | Antes Fase 7 |
| Middleware HTTP que precarga features en `currentTenant().features`                           | Fase 3   |
| Endpoint `GET /api/me/features`                                                                | Fase 5   |
| Confirmar regla de agregación de limits en ADR-004 §2.9 (§11 abajo)                           | Antes de empezar Fase 2 |

---

## 15. Resumen ejecutivo (para revisión rápida)

- **5 enums**, **10 tablas nuevas** en schema `master`, **4 roles
  Postgres** (3 nuevos).
- **Seeds**: 3 planes, 30 features, 90 plan_features, 45
  reserved_slugs. Super-admin se crea con comando aparte.
- **4 clientes Prisma** (3 nuevos): `prismaMaster`, `prismaApp`,
  `prismaRuntime`, `prismaQuotaWriter`.
- **3 helpers**: `getTenantBySlug`, `loadFeaturesFor`,
  `hasFeature`/`getLimit` (`consumeQuota` se aplaza a Fase 3-5).
- **14 commits atómicos** propuestos.
- **Punto de confirmación antes de arrancar**: §11 — regla de
  agregación de limits en addons (¿enmienda a ADR-004 §2.9 con regla
  "incremental"?).
- **Sin tocar**: producto en `public`, middleware, webhooks Stripe,
  panel super-admin, audit_log.

Cuando apruebes el plan (con o sin enmienda a §11), arranco Fase 2.
