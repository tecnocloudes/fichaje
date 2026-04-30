# Plan de Fase 3 — Resolución de tenant y refactor del producto

- **Estado**: PROPUESTO (pendiente de aprobación antes de tocar código)
- **Fecha**: 2026-04-30
- **Spec maestra**: [`../specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md), apartado "Fase 3"
- **ADRs aplicables**: 001 (§2.3, §2.5, §5.4), 002 (todo), 004 (§2.2, §2.4, §2.5), 005 (§2.5.a)

## 0. Objetivo

Esta es **la fase grande**: el producto deja de ser mono-tenant. El
schema `public` con sus 19 modelos pasa a ser **una plantilla**; cada
cliente vive en su propio schema `tenant_<slug>` y todas las queries
del producto se enrutan dinámicamente vía `SET search_path`.

Cinco bloques de trabajo:

1. **Movimiento del schema del producto**: del actual `public` a un
   "tenant template" que se replica por cada `tenant_<slug>`.
2. **Middleware HTTP** (`src/middleware.ts`) reescrito para resolver
   `host → tenant`, validar status, cachear, inyectar contexto via
   `AsyncLocalStorage`.
3. **Cliente Prisma del producto** (`prismaApp`) con
   `$extends({ query })` que aplica `SET search_path` por query.
4. **Helpers refinados** (`hasFeature`, `getLimit`, `consumeQuota`)
   que leen `currentTenant()` directamente.
5. **Comandos CLI reales** (`tenants:provision`, `tenants:migrate`,
   `tenants:migrate:all`) y el **test de fuga obligatorio** que
   bloquea el cierre de la fase (ADR-001 §2.4 con 4 escenarios).

Fuera del alcance (ver §13): onboarding Stripe (Fase 4), webhooks
(Fase 4), panel super-admin (Fase 7), cutover del cliente actual
(Fase 8).

---

## 1. Decisión arquitectónica clave: cómo Prisma maneja schema dinámico

Esta es la decisión que el resto de la fase depende de. **Es punto
de confirmación obligatorio antes de empezar** (ver §15).

### 1.1 El problema

Prisma 7 con `multiSchema = ["master", "public"]` (el estado tras
Fase 2) **siempre cualifica el schema en el SQL generado**. Si un
modelo lleva `@@schema("public")`, las queries serán
`SELECT … FROM "public"."User"`. **`SET search_path` no afecta** a
queries que ya tienen el schema cualificado.

Para que `SET search_path TO "tenant_<slug>", public` funcione
(ADR-002 §2.2), Prisma debe **NO cualificar** el schema en el SQL
de los modelos del producto. Eso requiere que esos modelos no
tengan `@@schema(...)` y que `multiSchema` esté apagado en el
cliente que los maneja.

Como el cliente del control plane sí necesita `multiSchema` para
distinguir `master.tenants` de otras tablas, **un solo cliente no
sirve**.

### 1.2 Opciones consideradas

| Opción                                                                                | Pro                                                              | Contra                                                                                                              |
|---------------------------------------------------------------------------------------|------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Cliente único con multiSchema y rewrite del SQL via `$extends`                        | Una sola fuente Prisma                                           | Requiere reescribir SQL antes de ejecutarlo (frágil, no soportado oficialmente). Descartado                         |
| Cliente único sin `@@schema` en modelos del producto                                  | Una sola fuente Prisma                                           | `multiSchema` requiere `@@schema` en TODOS los modelos. Inviable                                                    |
| **Dos clientes Prisma separados, dos archivos `schema.prisma`** (recomendada)         | Cada cliente con su semántica. Patrón documentado por Prisma para multi-tenant SaaS schema-per-tenant. SQL del producto sin cualificar → `SET search_path` funciona | Dos directorios de migraciones, dos clientes generados, dos `output`. Convención de mantenimiento estricta          |
| Schema "template" + pg_dump/restore por tenant en provisión                           | Migraciones más simples (Prisma toca solo `tenant_template`)     | Provisión tarda (dump+restore). Drift entre tenants si una migración manual rompe `tenant_template`                 |
| Connection string distinta por tenant (`?schema=tenant_<slug>`)                       | Patrón sencillo                                                  | Un cliente Prisma por tenant en runtime → conexiones × N. Inviable a 10–100 tenants. Descartado                     |

**Recomendación: opción "Dos clientes Prisma"**. Justificación:

- Aísla semánticamente master (con `multiSchema`) del producto (sin
  `multiSchema`).
- El cliente del producto genera SQL **sin cualificar schema**, lo
  que permite que `SET search_path` lo dirija a `tenant_<slug>` en
  runtime.
- Las migraciones del producto se aplican contra un schema "espejo"
  (`tenant_template` mientras Fase 3 desarrolla; en Fase 8 se replica
  el template a `tenant_<slug>` del cliente actual). El comando
  `tenants:migrate <slug>` aplica el SQL al schema del tenant con
  `search_path` apuntando allí.
- Prisma 7 soporta múltiples archivos `schema.prisma` con `--schema
  <path>` y `output` distinto en `generator client`. La doc oficial
  documenta el patrón.

### 1.3 Diseño propuesto

**Dos archivos de schema Prisma**:

#### `prisma/schema.prisma` (existente — solo control plane)

- Contiene **solo** los modelos master (Tenant, ReservedSlug, Plan,
  Feature, PlanFeature, TenantFeature, Subscription, SubscriptionItem,
  StripeEvent, TenantQuotaUsage, SuperAdmin) + sus enums.
- `multiSchema = ["master"]` (cambiamos de `["master", "public"]`).
- Genera `src/generated/prisma`.
- Lo usan: `prismaMaster`, `prismaRuntime`, `prismaQuotaWriter`.

#### `prisma/schema-tenant.prisma` (nuevo)

- Contiene **solo** los 19 modelos del producto + sus 5 enums (`Rol`,
  `TipoFichaje`, `MetodoFichaje`, `EstadoAusencia`, `EstadoTurno`).
- **Sin `multiSchema`**, **sin `@@schema(...)` en ningún modelo**.
- Genera `src/generated/prisma-tenant`.
- Lo usa: `prismaApp` con `$extends({ query })` que aplica `SET
  search_path TO "tenant_<slug>", public`.

#### Mantenimiento de los 19 modelos

Inevitablemente los 19 modelos se mueven de `prisma/schema.prisma` a
`prisma/schema-tenant.prisma`. **No hay duplicación**: existen en
exactamente un sitio (el nuevo). El primer commit que lo haga es
crítico — verificación con grep que ningún modelo del producto queda
en `schema.prisma`.

Después del cutover (Fase 8), el schema `public` real se vacía
(sus datos se mueven a `tenant_<slug>` del cliente actual). Antes
del cutover, el schema `public` **mantiene los datos del cliente
actual** y la app legacy sigue sirviéndolos. Ver §13.

#### Migraciones

Dos directorios:

- `prisma/migrations/` — migraciones del control plane (Fase 2 ya
  generadas). Sigue usándose con `--schema=prisma/schema.prisma`.
- `prisma/migrations-tenant/` — migraciones del producto. Generadas
  con `--schema=prisma/schema-tenant.prisma`. Cada una se aplica
  ESCALADA por todos los `tenant_<slug>` activos vía
  `tenants:migrate:all`.

#### Plantilla `tenant_template`

- Schema fijo en la BD: `tenant_template`.
- Prisma migra el SQL de `prisma/migrations-tenant/` contra él vía
  un cliente con `?schema=tenant_template`.
- `tenants:provision <slug>` copia la estructura de `tenant_template`
  a `tenant_<slug>` con `pg_dump --schema=tenant_template + sed +
  psql`. Atómico.
- Las migraciones nuevas se aplican primero a `tenant_template`,
  después se replican a cada `tenant_<slug>` con `tenants:migrate:all`.

---

## 2. Middleware HTTP

Archivo: `src/middleware.ts` reescrito.

### 2.1 Flow

```
Request → middleware:
  1. Extraer host. Determinar slug.
     - host = "telecom.ficha.tecnocloud.es" → slug = "telecom"
     - host = "app.ficha.tecnocloud.es" → ROUTE = "app" (landing)
     - host = "admin.ficha.tecnocloud.es" → ROUTE = "admin" (panel)
     - host = "ficha.tecnocloud.es" → 301 a app.ficha.tecnocloud.es
     - host con slug fuera de regex → 404
  2. Si slug es subdominio reservado (admin/app/www/api), saltar
     a su routing específico (sin runWithTenant).
  3. Lookup en cache: Map<host, CachedTenant> con TTL 60s
     (TENANT_CACHE_TTL_MS).
  4. Si miss: prismaRuntime.tenant.findUnique({ where: { slug } }) +
     loadFeaturesFor(tenantId). Cachear.
     Si no existe: cachear negativa con TTL ≤5s para evitar fuerza
     bruta sobre subdominios.
  5. Validar status (5 valores ADR-002 §2.4):
     - active → continuar.
     - pending → 503 + Retry-After: 30 + página "esperando pago".
     - provisioning → 503 + Retry-After: 30 + página "preparando
       cuenta".
     - suspended → 402 + página explicativa.
     - deleted → 410.
     - inexistente → 404 indistinguible.
  6. Si JWT presente: validar tenantSlug del JWT vs slug del host.
     Mismatch → 401, no 403 (no revelar existencia).
  7. runWithTenant({ slug, tenantId, status, features }, () =>
     NextResponse.next());
```

### 2.2 Estructura de archivos

- `src/lib/tenant/context.ts` — `AsyncLocalStorage` + `runWithTenant`
  + `currentTenant()`. Tipos `TenantContext` con `features:
  Map<string, ResolvedFeature>`.
- `src/lib/tenant/cache.ts` — `Map<host, CachedTenant>` con `expiresAt`
  + función `resolveTenant(host)` que mira cache → fallback a
  `prismaRuntime` → cache.
- `src/lib/tenant/host.ts` — `parseHost(host)` que devuelve `{ kind:
  "tenant" | "app" | "admin" | "apex" | "invalid", slug?: string }`.
- `src/middleware.ts` — orquesta los anteriores.

### 2.3 Subdominios reservados — routing distinto

| Host                         | Comportamiento                                                                                  |
|------------------------------|--------------------------------------------------------------------------------------------------|
| `app.ficha.tecnocloud.es`    | NO `runWithTenant`. Sirve `/registro`, `/login` (cuando aplique global), checkout. Endpoint `/api/webhooks/stripe` (Fase 4) |
| `admin.ficha.tecnocloud.es`  | NO `runWithTenant`. Auth super-admin (ADR-007 cierra Fase 7). En Fase 3, devuelve 503 "panel pendiente" |
| `ficha.tecnocloud.es` (apex) | 301 a `app.ficha.tecnocloud.es`                                                                 |
| `<slug>.ficha.tecnocloud.es` | `runWithTenant` con contexto resuelto                                                           |

Las rutas que viven bajo subdominios reservados deben **excluirse**
del wrapping `runWithTenant`. Implementación: el middleware detecta
el host y decide aplicar o no. Las rutas internas (`src/app/api/*`)
asumen que si llegan, hay tenant en contexto.

---

## 3. Prisma `$extends({ query })` — SET search_path por query

### 3.1 Implementación

```ts
// src/lib/prisma.ts (Fase 3, refactor)
import { PrismaClient as PrismaClientTenant } from "@/generated/prisma-tenant/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { currentTenant } from "@/lib/tenant/context";
import { quoteSchemaName } from "@/lib/tenant/quote";

function createTenantClient(connectionString: string) {
  const adapter = new PrismaPg({ connectionString });
  const base = new PrismaClientTenant({ adapter });

  return base.$extends({
    query: {
      $allOperations: async ({ args, query }) => {
        const { slug } = currentTenant();
        const schemaIdent = quoteSchemaName(slug); // ADR-001 §2.5
        try {
          await base.$executeRawUnsafe(
            `SET search_path TO ${schemaIdent}, public`,
          );
          return await query(args);
        } finally {
          await base.$executeRawUnsafe("RESET search_path");
        }
      },
    },
  });
}

export const prismaApp = lazyClient(/* APP_DATABASE_URL */);
```

### 3.2 quoteSchemaName

Archivo nuevo: `src/lib/tenant/quote.ts`. Implementa la función ya
diseñada en ADR-001 §2.5 con doble validación regex + comillas
dobles.

### 3.3 Garantías

- Si `currentTenant()` lanza (no hay store), la query falla **antes**
  de tocar BD. Esto cierra el escenario 1 del test de fuga (§7).
- `RESET search_path` en `finally` garantiza que la conexión vuelve
  al pool en estado neutro. Defensa en profundidad si alguien escribe
  código fuera del middleware.
- Un solo cliente `prismaApp` por proceso (no pool por tenant).

---

## 4. Helpers refinados

Refactor de `src/lib/tenant/features.ts` (Fase 2 los hizo "puros"
sobre Map; Fase 3 los hace leer `currentTenant()` directamente).

### 4.1 Firmas finales

```ts
// Lectura directa del contexto (no recibe Map como argumento).
export function hasFeature(key: string): boolean;
export function getLimit(key: string): number | null;

export async function consumeQuota(
  key: string,
  amount: number = 1,
): Promise<
  | { ok: true; remaining: number | null; resetAt: Date }
  | { ok: false; reason: "period_unavailable" }
  | { ok: false; reason: "limit_reached"; used: number; max: number; resetAt: Date }
>;
```

### 4.2 Compatibilidad

- Las funciones puras de Fase 2 (`resolveFeatureRows`,
  `loadFeaturesFor`) **no cambian** (siguen siendo internas).
- Los wrappers `hasFeature(key)` y `getLimit(key)` ahora delegan
  internamente a las puras pasándoles `currentTenant().features`.
- Tests existentes de Fase 2 (21 puros) **siguen verdes** porque
  inyectan `_setFeatureCatalogForTest` y operan sobre Map directo.
  Se añaden tests nuevos que verifican la integración con
  `runWithTenant`.

### 4.3 `consumeQuota`

Nueva implementación (no existía en Fase 2). Usa `prismaQuotaWriter`
(rol `quota_writer_role`, ADR-004 §2.2 + §2.5).

```ts
export async function consumeQuota(key, amount = 1) {
  if (!assertKnownFeature(key, "consumeQuota"))
    return { ok: false, reason: "period_unavailable" };
  const { tenantId } = currentTenant();
  const now = new Date();
  const rows = await prismaQuotaWriter.$queryRaw`
    UPDATE master.tenant_quota_usage
       SET consumed = consumed + ${amount}, updated_at = now()
     WHERE tenant_id = ${tenantId}
       AND feature_key = ${key}
       AND period_start <= ${now} AND period_end > ${now}
       AND (max IS NULL OR consumed + ${amount} <= max)
     RETURNING consumed, max, period_end
  `;
  // … resto según ADR-004 §2.5
}
```

---

## 5. Comandos CLI reales

### 5.1 `tenants:provision <slug> <plan_key>`

Hasta Fase 4, la coreografía completa de ADR-003 §2.6 incluye Stripe
Customer + subscription. Fase 3 deja eso en stub y solo hace la parte
de BD:

1. Validar slug (regex + reserved_slugs).
2. Validar plan (existe en `master.plans`).
3. **Crear schema** `tenant_<slug>` con `prismaMaster` (master_role).
4. **Aplicar GRANTs** (`USAGE` + DEFAULT PRIVILEGES) a `app_role` sobre
   el nuevo schema (ADR-001 §2.3).
5. **Replicar estructura** de `tenant_template` a `tenant_<slug>` con
   `pg_dump --schema=tenant_template | sed s/tenant_template/tenant_<slug>/g | psql`.
6. **Insertar** en `master.tenants` con `status='ACTIVE'`,
   sentinels `cus_manual_<id>` / `sub_manual_<id>` para Fase 4 que
   los reemplazará con datos Stripe reales.
7. **Insertar** features del plan en `tenant_features` con
   `source='plan'`.
8. **Insertar** filas iniciales en `tenant_quota_usage` para las
   quotas del plan.

Idempotente: si se ejecuta dos veces con el mismo slug:
- Si tenant ya existe en `master.tenants` con status=ACTIVE → exit 0
  con mensaje "ya existe".
- Si tenant existe en status=PROVISIONING → continuar desde donde se
  quedó (ADR-003 §5.2).

Para Fase 8 cutover: el comando se invoca con `cutover_telecom enterprise`
con un script extra que migra datos del cliente actual de `public` a
`tenant_telecom`.

### 5.2 `tenants:migrate <slug>`

1. Verificar que `tenant_<slug>` existe en `master.tenants`.
2. Conectar a la BD con search_path apuntando a `tenant_<slug>`.
3. Ejecutar `prisma migrate deploy` con
   `--schema=prisma/schema-tenant.prisma` y la connection string
   modificada con `?schema=tenant_<slug>` (Prisma respeta esto para
   migraciones).
4. Loguear resultado.

### 5.3 `tenants:migrate:all`

Itera tenants con `status IN ('ACTIVE', 'SUSPENDED')` ordenados por
`created_at ASC` y aplica `tenants:migrate <slug>` a cada uno.

**Manejo de fallos**: aborta al primer fallo (ADR-005 §3.3). El
estado parcial queda como riesgo aceptado (la convención de
migraciones backward-compatible de ADR-005 §2.5.a lo mitiga).

Esto se invoca también desde `entrypoint.sh` en arranque de la app
(Fase 8 cutover; en Fase 3 no hay tenants productivos).

### 5.4 `tenants:list`

Ya existe desde Fase 2. Se actualiza con la columna nueva `features
count` para diagnóstico.

---

## 6. Refactor de los 46 endpoints

### 6.1 Categorización

Los 46 endpoints en `src/app/api/**/route.ts` se dividen en:

- **TENANT** (40+): operan sobre datos del tenant. Requieren
  `currentTenant()` en contexto. Ejemplo: `POST /api/fichajes`,
  `GET /api/empleados`, `GET /api/dashboard`.
- **PLATAFORMA** (3-5): no son de tenant. Ejemplo (futuros):
  `POST /api/webhooks/stripe` (Fase 4), `POST /api/admin/*` (Fase 7).
  Hoy no existen pero los reservamos.
- **APP** (raíces): bajo `app.ficha.tecnocloud.es`. `POST /api/setup`,
  `POST /api/setup/reset` que se eliminarán por completo (ADR-002
  §3.1, ADR-003 §2.6).

### 6.2 Patrón de refactor para endpoints TENANT

Cada endpoint pasa de:

```ts
// Antes (mono-tenant)
import { prisma } from "@/lib/prisma";
export async function GET() {
  const data = await prisma.user.findMany();
  return Response.json(data);
}
```

A:

```ts
// Después (multi-tenant)
import { prismaApp } from "@/lib/prisma";  // cliente con $extends search_path
export async function GET() {
  const data = await prismaApp.user.findMany();
  return Response.json(data);
}
```

**Único cambio**: `prisma` → `prismaApp`. El middleware ya garantiza
`runWithTenant`. El `$extends` ya garantiza `SET search_path`. La
lógica del endpoint **no cambia**.

Excepción: endpoints que leen `master.*` (como `getTenantBySlug`)
siguen usando `prismaMaster` o `prismaRuntime`.

### 6.3 Cómo aseguramos que TODOS están refactorizados

Tres barreras:

1. **Lint custom** `eslint-plugin-fichaje/no-legacy-prisma`: regla
   que falla CI si en `src/app/api/**/route.ts` (excepto subdominios
   reservados) se importa `prisma` o `prismaMaster`. Solo se permite
   `prismaApp`, `prismaRuntime` (raras), `prismaQuotaWriter` (solo en
   `features.ts`).
2. **Test de cobertura del refactor**: script que parsea cada
   endpoint y verifica que importa `prismaApp` (excepto los listados
   como exentos en una whitelist).
3. **Test E2E del fuga** (§7): si algún endpoint olvida envolverse,
   `currentTenant()` lanza al primer query y el test lo detecta.

### 6.4 Endpoints exentos (whitelist explícita)

Mantenida en `src/lib/tenant-exempt-routes.ts`:

```ts
export const TENANT_EXEMPT_ROUTES = [
  // Plataforma — viven en app.ficha.tecnocloud.es
  "/api/webhooks/stripe",     // Fase 4
  "/api/me/features",         // Fase 5 — pero usa runWithTenant igualmente
  "/api/admin/**",            // Fase 7

  // Endpoints que se eliminan en Fase 4 (legacy mono-tenant)
  "/api/setup",
  "/api/setup/reset",
] as const;
```

La regla ESLint y el script de cobertura consultan esta whitelist.

### 6.5 Cuántos archivos se tocan

Estimación: ~40 endpoints en `src/app/api/**/route.ts` cambian
`prisma` → `prismaApp`. ~5 más cambian `prisma` → `prismaMaster` o
`prismaRuntime` (los que ya leen master, p. ej. branding).

Cambio mecánico, casi sed. Riesgo bajo. Hace falta un test
exhaustivo (E2E del fuga) que cierre la garantía.

---

## 7. Test de fuga obligatorio

ADR-001 §2.4 cierra los 4 escenarios. El test **bloquea el cierre
de Fase 3** según el criterio de aceptación.

Archivo: `src/lib/tenant/leak.integration.test.ts` con Testcontainers
+ Postgres real.

### 7.1 Setup

1. Levantar Postgres efímero.
2. Aplicar migraciones del control plane (`prisma/migrations`).
3. Aplicar SQL `00-roles.sql` (de Fase 2).
4. Crear schema `tenant_template` y aplicar migraciones del producto.
5. Provisionar 2 tenants: `acme` y `umbrella`. Sembrar datos:
   ambos tenant tienen un usuario `alice@example.com` con DNI
   `12345678A` (mismos identificadores naturales).

### 7.2 Escenarios

#### Escenario 1 — Query sin tenant en contexto debe fallar

```ts
// SIN runWithTenant
expect(() => prismaApp.user.findMany()).rejects.toThrow(/No hay tenant/);
```

#### Escenario 2 — Tenant A no ve datos del tenant B

```ts
const acmeUsers = await runWithTenant({ slug: "acme", ... }, () =>
  prismaApp.user.findMany({ where: { email: "alice@example.com" } }),
);
expect(acmeUsers).toHaveLength(1);
expect(acmeUsers[0].tenantId).toBeUndefined(); // no hay tenantId en User; el aislamiento es por schema
// Verificación cross-schema: ningún registro de umbrella debe aparecer.
```

#### Escenario 3 — JWT con `tenant_id` distinto del host devuelve 401

Test E2E con Next contra dos hosts (`acme.ficha.tecnocloud.es` y
`umbrella.ficha.tecnocloud.es`):
- Login en acme → JWT con `tenantSlug: "acme"`.
- Hacer request a `umbrella.ficha.tecnocloud.es/api/dashboard` con
  ese JWT. El middleware debe responder 401 (no 403, ADR-002 §2.5).

#### Escenario 4 — Slug malicioso rechazado por validación

```ts
const malicious = `tenant_; DROP SCHEMA public CASCADE; --`;
await expect(prismaMaster.tenant.create({
  data: { id: "x", slug: malicious, name: "Bad", email: "x@x.com" }
})).rejects.toThrow(/violates check constraint/);
```

(Esto ya está cubierto por el CHECK constraint de Fase 2, pero el
test de fuga lo verifica explícitamente como contrato de seguridad.)

### 7.3 Criterio bloqueante

Sin los 4 escenarios verdes, **Fase 3 no se cierra**. ADR-001 §2.4
y ADR-002 §6 criterio 5.

---

## 8. Idioma y naming (sin renombrar producto)

- **Modelos del producto en castellano**: `User`, `Tienda`, `Fichaje`,
  `Turno`, `Ausencia`, `Comunicado`, etc. **NO se renombran** en
  Fase 3 (sería un cambio cosmético independiente que merece su
  propio ADR si se quisiera). El plan original respetaba esta
  convención.
- **Modelos del control plane en inglés**: `Tenant`, `Plan`,
  `Feature`, `Subscription` — coherente con Fase 2.
- **Comentarios en castellano** (todo el código nuevo de Fase 3).
- **Errores de programación en inglés**, mensajes de UI en
  castellano (igual que Fase 2).
- **Logs estructurados con `tenant_slug`** y `request_id` (ADR-005
  §2.8.a).

---

## 9. Orden de commits propuesto

Estimación: **18-22 commits**. Bloques agrupados.

### 9.1 Bloque infraestructura (commits 1-7)

1. `feat(prisma): nuevo schema-tenant.prisma con modelos del producto sin @@schema`
   — crea `prisma/schema-tenant.prisma` copiando los 19 modelos. Mantiene
   también `prisma/schema.prisma` actual. Configura `prisma.config.ts`
   con dos schemas. Genera `src/generated/prisma-tenant/`.
2. `feat(prisma): retirar modelos del producto de schema.prisma`
   — los 19 modelos pasan a vivir SOLO en `schema-tenant.prisma`.
   `multiSchema = ["master"]`. Migración nueva en
   `prisma/migrations` que NO toca tablas del producto (Prisma
   detectará "drift": deja schema `public` con tablas existentes
   pero no las gestiona).
3. `feat(prisma): clientes prismaMaster/Runtime/QuotaWriter solo con master`
   — `src/lib/prisma.ts` refactorizado: importa el cliente master
   desde `@/generated/prisma`. Sigue siendo lazy.
4. `feat(prisma): nuevo cliente prismaApp con $extends SET search_path`
   — `src/lib/prisma.ts` añade `prismaApp` con `quoteSchemaName` y
   `$extends`. Importa `currentTenant`.
5. `feat(tenant): AsyncLocalStorage runWithTenant + currentTenant`
   — `src/lib/tenant/context.ts` con tipos.
6. `feat(tenant): cache host→tenant + parseHost + resolveTenant`
   — `src/lib/tenant/cache.ts`, `src/lib/tenant/host.ts`,
   `src/lib/tenant/resolver.ts`.
7. `feat(tenant): quoteSchemaName con regex + tests puros`
   — `src/lib/tenant/quote.ts` + 5 tests (ADR-001 §2.5).

### 9.2 Bloque middleware (commits 8-9)

8. `refactor(middleware): src/middleware.ts reescrito con resolución host→tenant`
   — middleware nuevo. Subdominios reservados routing distinto.
   5 estados de tenant mapeados a códigos HTTP.
9. `feat(tenant): JWT validation cruzada slug del host vs JWT.tenantSlug`
   — `src/lib/auth.config.ts` modificado para añadir `tenantId`
   y `tenantSlug` al callback. Middleware lo verifica.

### 9.3 Bloque migraciones del producto + tenant_template (commits 10-12)

10. `feat(prisma-tenant): migraciones del producto en migrations-tenant/`
    — primer baseline de las migraciones del producto generadas
    desde `schema-tenant.prisma`. Carpeta `prisma/migrations-tenant/`
    con su propio `migration_lock.toml`.
11. `feat(scripts): sql para crear tenant_template + aplicar migraciones`
    — `scripts/sql/01-tenant-template.sql` que crea el schema
    `tenant_template` y aplica las migraciones del producto.
12. `feat(scripts): tenants-provision.ts real (sin Stripe)`
    — implementación del comando: validate slug + crear schema +
    GRANTs + replicar template + insertar tenant + features +
    quotas. Stripe sigue como sentinel.

### 9.4 Bloque CLI tenants:migrate (commits 13-14)

13. `feat(scripts): tenants-migrate.ts aplica migraciones a un tenant`
    — implementación.
14. `feat(scripts): tenants-migrate:all itera tenants ACTIVE/SUSPENDED`
    — abort-on-first-fail.

### 9.5 Bloque helpers refinados (commits 15-16)

15. `refactor(tenant): hasFeature y getLimit leen currentTenant() directamente`
    — wrappers en `src/lib/tenant/features.ts`. Tests Fase 2 siguen
    verdes.
16. `feat(tenant): consumeQuota con prismaQuotaWriter atómico`
    — UPDATE condicional con RETURNING (ADR-004 §2.5).

### 9.6 Bloque test de fuga (commit 17)

17. `test(tenant): leak integration test con 4 escenarios + Testcontainers`
    — tests de los 4 escenarios. Verde es el criterio bloqueante de
    Fase 3.

### 9.7 Bloque refactor endpoints (commits 18-21)

18. `feat(lint): eslint-plugin-fichaje/no-legacy-prisma`
    — regla custom + tests + configuración en `eslint.config.mjs`.
19. `refactor(api): endpoints fichajes/empleados/tiendas a prismaApp`
    — primer subset (~10 endpoints).
20. `refactor(api): endpoints ausencias/turnos/notificaciones a prismaApp`
    — segundo subset (~15 endpoints).
21. `refactor(api): resto de endpoints (configuracion, branding, etc.) a prismaApp`
    — completar los 40+ endpoints. Lint pasa: ningún `prisma` legacy
    en `src/app/api/`.

### 9.8 Cierre (commit 22)

22. `docs(arch): cerrar Fase 3 con criterios verificados`
    — actualizar `docs/arch/00-fase-3-plan.md` con el estado final.
    Reportar test:feature-coverage + test:integration verdes.

---

## 10. Puntos de revisión

Cinco paradas con reporte:

1. **Tras commit 7 (infraestructura)**: clientes Prisma, AsyncLocalStorage,
   resolver de host, quoteSchemaName con tests. `tsc` y `npm test`
   verdes. Antes del middleware.
2. **Tras commit 12 (provision real)**: provisionar `tenant_acme` en
   BD efímera, verificar que su schema existe con la estructura del
   producto, que app_role tiene grants correctos, que tenant_features
   y tenant_quota_usage tienen filas iniciales del plan.
3. **Tras commit 14 (CLI migrate)**: aplicar una migración nueva a
   `tenant_template` y verificar que `tenants:migrate:all` la
   replica a `tenant_acme`.
4. **Tras commit 17 (test de fuga)**: los 4 escenarios verdes.
5. **Tras commit 22 (cierre)**: `npm run test:integration` verde
   (incluye fuga + super-admin existente). `npm test` verde con
   cobertura ≥80% en `tenant/**`.

---

## 11. Riesgos identificados

### 11.1 Riesgo arquitectónico: dos clientes Prisma duplican modelos

- **Descripción**: si en el futuro se añade un campo a `User`, hay
  que recordar añadirlo en `schema-tenant.prisma` (no en
  `schema.prisma`).
- **Mitigación**: la regla ESLint `no-legacy-prisma` ya impide
  importar `prisma` legacy en `api/`. Documentar en CLAUDE.md /
  AGENTS.md que el schema fuente es `schema-tenant.prisma`.
  `schema.prisma` actual queda solo con master tras commit 2.

### 11.2 Performance de SET search_path por query

- **Descripción**: cada query del producto paga 2 round-trips
  adicionales (SET + RESET).
- **Mitigación**: aceptado en ADR-002 §3.3 con coste despreciable
  frente a la latencia de la query real. Punto de optimización
  Fase 9: batch SET por transacción cuando se mide contención.

### 11.3 AsyncLocalStorage en server actions de Next 16

- **Descripción**: server actions corren en un contexto distinto al
  middleware. El `runWithTenant` del middleware podría no propagar
  al server action.
- **Mitigación**: probar específicamente en commit 7 con un test
  E2E. Si no propaga, opciones: (a) reanidar `runWithTenant` en
  cada server action via wrapper, (b) usar headers propagados
  como fallback. Documentar al final de Fase 3.

### 11.4 Migraciones backward-compatible que cambian @@schema

- **Descripción**: cualquier migración que toque `@@schema(...)` o
  `multiSchema` no es backward-compatible: la app vieja con el cliente
  generado anterior no entiende la BD nueva.
- **Mitigación**: el commit 2 (retirar modelos del producto de
  `schema.prisma`) ES backward-incompatible por construcción. Se
  acepta porque ya estamos en feature/saas-migration y el cliente
  actual de producción sigue en main hasta cutover (Fase 8).
  Documentar como nota en la migración.

### 11.5 Comando `tenants:migrate:all` rompe a mitad

- **Descripción**: si la migración pasa a tenant_uno, tenant_dos y
  falla en tenant_tres, los dos primeros quedan con schema nuevo y
  el resto con schema viejo. La app vieja servirá mal a los
  migrados.
- **Mitigación**: convención backward-compatible (ADR-005 §2.5.a).
  Reglas obligatorias:
  - Añadir columna NOT NULL: 2 PRs.
  - Renombrar columna: 2 PRs con doble escritura intermedia.
  - Eliminar columna: 2 PRs.
  Plantilla de PR (ADR-005 §2.5.a) ya documentada.

---

## 12. Lo que NO se hace en Fase 3

- ❌ Onboarding de nuevos tenants vía Stripe Checkout (Fase 4).
- ❌ Webhooks de Stripe (Fase 4).
- ❌ Endpoint `/api/me/features` (Fase 5).
- ❌ Componente `<FeatureGate>` (Fase 5).
- ❌ HOFs `withFeature` y `withQuota` para route handlers (Fase 5).
- ❌ Lint rule `no-feature-gate-on-core` (Fase 5).
- ❌ Endpoint `/api/fichaje/registro-legal` (Fase 5).
- ❌ Advisory lock en `max_employees` (Fase 5).
- ❌ Configuración por tenant UI (Fase 6).
- ❌ Panel super-admin (Fase 7).
- ❌ Tabla `master.audit_log` (ADR-007, antes de Fase 7).
- ❌ Cutover del cliente actual (Fase 8). Durante Fase 3, los datos
  reales del cliente actual permanecen en `public` y la app legacy
  los sirve desde `main` (no desde feature/saas-migration).

---

## 13. Coexistencia durante Fase 3

Esto es delicado y merece su sección.

- La rama `feature/saas-migration` desarrolla Fase 3.
- La rama `main` sigue sirviendo al cliente actual desde `public`.
- Durante Fase 3, el cliente actual NO se ve afectado: no se mergea a
  `main` hasta el cutover (Fase 8).
- Cualquier hotfix urgente al cliente actual va directo a `main` y se
  cherry-pickea a `feature/saas-migration` si aplica.
- El despliegue Dokploy actual (`fichaje-prueba-qlhel6`) sigue
  apuntando a `main`. Solo el cutover de Fase 8 cambia eso.

Implicación: durante Fase 3, las pruebas de integración se hacen
con BD efímera (Testcontainers) + tenants de prueba. La BD real de
producción no se toca hasta Fase 8.

---

## 14. Criterios de aceptación

Fase 3 se considera completada cuando todos los siguientes son
ciertos:

1. `prisma/schema.prisma` contiene **solo** modelos master + 5 enums
   master. `multiSchema = ["master"]`. Verificable con grep.
2. `prisma/schema-tenant.prisma` contiene los 19 modelos del producto
   + sus 5 enums **sin `@@schema`** y **sin `multiSchema`**.
3. `prisma/migrations-tenant/` tiene un baseline funcional. `npm run
   tenants:migrate -- acme` aplica las migraciones del producto al
   schema `tenant_acme` previamente creado.
4. `npm run tenants:provision -- acme starter` crea el schema, aplica
   GRANTs, replica `tenant_template`, inserta tenant en master, sembra
   features y quotas. Verificable con `tenants:list` y SQL directo.
5. `src/middleware.ts` resuelve host→tenant con cache, valida los 5
   estados, mapea a códigos HTTP correctos (200/402/503/410/404),
   inyecta `runWithTenant`. Subdominios reservados (app/admin/www)
   no entran en `runWithTenant`.
6. `prismaApp` ejecuta `SET search_path` por query con
   `quoteSchemaName(slug)`. RESET en `finally`. Sin `currentTenant()`,
   la query falla antes de tocar BD.
7. `hasFeature(key)`, `getLimit(key)`, `consumeQuota(key, n)` operan
   contra `currentTenant().features` y `master.tenant_quota_usage`.
8. **Test de fuga** (4 escenarios) verde:
   - Sin tenant → throw.
   - Tenant A no ve B.
   - JWT cross-tenant → 401.
   - Slug malicioso → CHECK rechaza.
9. **Lint custom** `no-legacy-prisma` falla CI si un endpoint en
   `src/app/api/` (excepto whitelist) importa `prisma` o
   `prismaMaster`.
10. `npm test` (unit) y `npm run test:integration` verdes.
11. `tsc --noEmit` exit 0. `prisma validate` valid en cada commit.
12. Cobertura ≥80% en `src/lib/tenant/**` (lines/functions; branches
    ≥75%).

---

## 15. Puntos a confirmar antes de empezar

### 15.1 Decisión arquitectónica: dos clientes Prisma

§1 propone **dos archivos `schema.prisma`** y **dos clientes Prisma
generados**. La alternativa más cercana sería el "schema template +
pg_dump/restore al provisionar" (opción C de §1.2).

Recomiendo opción **dos clientes** por:

- Patrón documentado oficialmente para multi-tenant SaaS Prisma.
- `SET search_path` funciona limpiamente (queries sin schema
  cualificado).
- Las migraciones del producto se aplican con Prisma (no con SQL
  manual).
- Aislamiento semántico claro: cliente master vs cliente tenant.

**Confirmación necesaria**: ¿adelante con dos clientes Prisma como en
§1.3?

### 15.2 ¿Mantener `tenant_template` como schema dedicado en BD?

§1.3 propone un schema fijo `tenant_template` donde Prisma aplica
las migraciones del producto. Después `tenants:provision <slug>`
copia su estructura a `tenant_<slug>`.

Alternativa: aplicar migraciones directamente a cada `tenant_<slug>`
sin pasar por template. Más simple pero más lento de provisionar
(cada tenant nuevo paga el coste de aplicar todas las migraciones
históricas en orden).

**Recomendación**: con template. La provisión copia estructura al
vuelo (1-2 segundos para 19 tablas) en lugar de aplicar N
migraciones. Para volumen 10-100 tenants es el patrón correcto.

**Confirmación necesaria**: ¿template `tenant_template`?

### 15.3 ¿Dónde vive el slug del cliente actual durante Fase 3?

Durante Fase 3 el cliente actual NO se mueve (sus datos siguen en
`public`). Pero el código de la rama `feature/saas-migration`
exige `runWithTenant`. ¿Cómo testeamos manualmente la app durante
desarrollo?

Propuestas:

- **A**: en desarrollo local, provisionar un tenant `dev` con datos
  semilla y usar `dev.localhost` como host de prueba.
- **B**: añadir un flag `DEV_FAKE_TENANT` en `.env.development` que
  el middleware respete inyectando un tenant fijo para todas las
  requests sin host válido. Útil para `localhost` directo.

**Recomendación**: combinar A y B. A es lo "real" y limpio para
pruebas integradas; B útil para desarrollo rápido sin tocar
`/etc/hosts`.

**Confirmación necesaria**: ¿ambas?

### 15.4 ¿Mantener `prisma` (alias compat de Fase 0.5) o eliminarlo?

Fase 2 mantiene `export const prisma = prismaMaster` para compat con
código mono-tenant. Fase 3 lo reemplaza progresivamente por
`prismaApp`. ¿Mantenemos el alias hasta el final del refactor o lo
eliminamos en commit 1 forzando que cada endpoint use el cliente
correcto desde el principio?

**Recomendación**: eliminarlo en commit 3 (cuando se introducen los
clientes nuevos). Reemplazo masivo controlado: `prisma.X` →
`prismaApp.X` en `src/app/api/**` y `prismaMaster.X` en
`src/lib/email.ts`, etc. Más limpio que un periodo largo de
coexistencia.

**Confirmación necesaria**: ¿eliminar alias `prisma` en commit 3 o
mantenerlo hasta commit 21?

### 15.5 ¿`/api/setup` y `/api/setup/reset` se eliminan o se exoneran?

`POST /api/setup` permite crear el primer SUPERADMIN si
`prisma.user.count() === 0` (legado mono-tenant, ADR-002 §3.1
recomienda eliminar). `POST /api/setup/reset` borra todos los datos.

Opciones:

- **A**: eliminar ambos en Fase 3 (limpieza temprana).
- **B**: dejarlos en la whitelist de exentos durante Fase 3, eliminar
  en Fase 4 cuando llegue el flow de Stripe Checkout que los
  reemplaza.

**Recomendación**: B. No eliminamos código que aún sirve durante el
desarrollo. En Fase 4 se eliminan junto con la introducción del
checkout.

**Confirmación necesaria**: ¿exonerar setup hasta Fase 4?

### 15.6 ¿Renombrar `Rol.OWNER` → `Rol.OWNER` queda como está?

Fase 0.5 renombró `SUPERADMIN` → `OWNER`. El plan §8 dice "no
renombrar" en Fase 3. Solo confirmo: el enum sigue siendo
`OWNER | MANAGER | EMPLEADO`. Sin cambios.

**Confirmación necesaria**: trivial, solo aclarar.

### 15.7 Cobertura de tests con BD efímera

Los tests de integración (super-admin de Fase 2 + fuga de Fase 3) usan
Testcontainers. Cada test levanta un Postgres efímero. **Coste**:
~10s por test en CI.

Propuesta: agrupar todos los tests de integración en una **única
suite** que levanta Postgres una vez al inicio. Beneficios: menos
setup, menos tiempo total.

**Recomendación**: refactorizar el setup actual para tener un
`beforeAll` global que comparta container entre todos los
`*.integration.test.ts`.

**Confirmación necesaria**: ¿refactor del setup (sí) o cada test
levanta su propio container (no, por simplicidad)?

---

## 16. Resumen ejecutivo (para revisión rápida)

- **18-22 commits atómicos** en 7 bloques (infra → middleware →
  migrations-tenant → CLI → helpers → test fuga → refactor endpoints).
- **Decisión arquitectónica clave**: dos clientes Prisma (uno con
  multiSchema y modelos master, otro sin multiSchema y modelos del
  producto). Punto de confirmación §15.1.
- **5 puntos de revisión** durante el desarrollo.
- **5 riesgos identificados** con mitigación documentada.
- **Test de fuga con 4 escenarios** como criterio bloqueante de
  cierre de Fase 3.
- **Refactor mecánico de ~40 endpoints** (`prisma` →
  `prismaApp`) con regla ESLint que falla CI si se olvida alguno.
- **Sin tocar**: producto en `public` (datos reales del cliente
  actual), Stripe, panel super-admin, audit_log, cutover.
- **7 puntos abiertos** en §15 que necesitan tu confirmación antes
  de arrancar el commit 1.

Cuando apruebes los puntos de §15 (con o sin enmiendas), arranco
Fase 3.
