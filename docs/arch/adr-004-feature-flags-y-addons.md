# ADR-004 — Feature flags y addons en uso: helpers, quotas con reset, server-side enforcement y CORE no desactivable

- **Estado**: Accepted
- **Fecha**: 2026-04-29
- **Decisores**: Daniel Sánchez (`@tecnocloudes`)
- **Spec maestra**: [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md)
- **Visión**: [ADR-000](./adr-000-vision-saas.md)
- **Bounded contexts afectados**: `control-plane`, `fichaje`, `super-admin`
- **Sucede a**: [ADR-001](./adr-001-aislamiento-multi-tenant.md), [ADR-002](./adr-002-resolucion-tenant.md), [ADR-003](./adr-003-billing-y-suscripciones.md)
- **Bloquea a**: ADR-007 (panel super-admin: UI de manual_override y endpoint de overrides), Fases 3, 5 y 8

---

## 1. Contexto

ADR-003 cerró cómo Stripe alimenta `master.tenant_features` con tres
fuentes (`plan`, `addon`, `manual_override`) y reglas de combinación
(manual_override gana, máximo entre plan/addons para limits, suma para
quotas). Falta cerrar el **cómo se consume eso desde el código del
producto y el front del tenant**.

Cinco preguntas que ADR-004 responde:

1. **Helpers de runtime**: ¿qué firma tienen `hasFeature`, `getLimit` y
   `consumeQuota`? ¿Desde dónde leen el tenant en contexto? ¿Cómo se
   garantiza que `consumeQuota` no tiene races?
2. **Modelo de datos para quotas**: las quotas tienen periodo de reset
   (mensual, alineado con `current_period_end` de la subscription).
   `master.tenant_features` no sirve para guardar el contador porque
   ADR-003 §2.9 lo reescribe en cada `customer.subscription.updated`.
   Hace falta una tabla aparte.
3. **UI**: cómo el front del tenant recibe la lista de features activas
   y cómo monta gates condicionales (`<FeatureGate>`).
4. **Server-side enforcement**: cómo cada endpoint que requiere una
   feature la chequea antes de la lógica real. Y cómo no repetir el
   patrón en 46 endpoints.
5. **Salvaguardas**: cómo se asegura que el `registro_jornada_legal`
   (CORE no desactivable, §11.2 auditoría) no acaba detrás de un
   `hasFeature` por error de un dev distraído.

Tres restricciones operativas vienen de ADRs anteriores y hay que
respetar:

- **ADR-001 §2.3** prohíbe a `app_role` acceder a `master`. Los
  helpers de runtime, que viven en la app del producto, **no pueden
  consultar `master.tenant_features` con `app_role`**. Hay que
  resolver con qué rol Postgres se hace, y se hace en este ADR.
- **ADR-002 §2.2** introdujo `AsyncLocalStorage` para el contexto del
  tenant (`currentTenant()`). Los helpers leen de ahí, no reciben
  argumentos.
- **ADR-002 §3.6** introdujo `tenant_resolver_role` para que el
  middleware HTTP consulte `master.tenants` y `master.reserved_slugs`.
  ADR-004 amplía la responsabilidad de ese rol y lo renombra
  (decisión §2.2). El cambio queda como TODO en ADR-002.

Hay además una restricción de producto: `registro_jornada_legal` es
CORE por RD 8/2019 (§11.2 auditoría). Cualquier endpoint del flujo de
fichaje, consulta de fichajes propios y export del registro legal
**no** se chequea con feature flags. Esto exige convención + lint +
test, no solo confianza en el dev.

---

## 2. Decisión

Adoptamos nueve decisiones encadenadas que cierran la capa de runtime
del feature gating.

### 2.1 Helpers de runtime: `hasFeature`, `getLimit`, `consumeQuota`

Tres funciones colgadas del módulo `src/lib/tenant/features.ts` que
todos los handlers del producto pueden importar:

```ts
// src/lib/tenant/features.ts (Fase 5)
export async function hasFeature(key: string): Promise<boolean>;
export async function getLimit(key: string): Promise<number | null>; // null = unlimited
export async function consumeQuota(
  key: string,
  amount: number = 1
): Promise<
  | { ok: true; remaining: number | null; resetAt: Date }
  | { ok: false; used: number; max: number; resetAt: Date | null }
>;
```

**Contrato común**:

- Las tres funciones leen `currentTenant()` (ADR-002 §2.2). Si no hay
  tenant en contexto, lanzan (igual que cualquier otro consumidor del
  contexto). No reciben `tenantId` como argumento.
- `hasFeature` y `getLimit` consultan **el contexto del tenant** —no
  `master`— gracias al precarga descrita en §2.4. Cero round-trip a
  master en runtime.
- `consumeQuota` es la única que toca master en cada llamada (UPDATE
  atómico sobre `master.tenant_quota_usage`). Detalle de atomicidad en
  §2.5.

**Cache por request**: `currentTenant().features` es el snapshot
cargado en el middleware HTTP. Vive lo que dura la request (el
`AsyncLocalStorage` se cierra al terminar). Sin invalidación dentro de
la request: si el OWNER hace upgrade en mitad de la sesión, los
cambios se reflejan en la siguiente request, no en la actual.

### 2.2 `tenant_runtime_role`: ampliación del `tenant_resolver_role` de ADR-002

ADR-002 §3.6 introdujo `tenant_resolver_role` con `SELECT` exclusivo
sobre `master.tenants` y `master.reserved_slugs` para que el middleware
HTTP resolviera el slug. Para implementar §2.4 (precarga de features
en el contexto) y §2.5 (consumo atómico de quotas) ese rol no basta:
necesita además `SELECT` sobre `master.tenant_features` y
`SELECT/INSERT/UPDATE` sobre `master.tenant_quota_usage`.

**Decisión**: renombramos `tenant_resolver_role` → **`tenant_runtime_role`**
con permisos:

```sql
GRANT USAGE ON SCHEMA master TO tenant_runtime_role;
GRANT SELECT ON master.tenants            TO tenant_runtime_role;
GRANT SELECT ON master.reserved_slugs     TO tenant_runtime_role;
GRANT SELECT ON master.tenant_features    TO tenant_runtime_role;
GRANT SELECT, INSERT, UPDATE ON master.tenant_quota_usage TO tenant_runtime_role;

-- nada más. Sin acceso a subscriptions, stripe_events, super_admins,
-- audit_log, ni a ningún otro objeto de master.
```

Justificación de **ampliar** (vs crear un cuarto rol distinto):

- El middleware HTTP, que ya tiene visibilidad sobre `master.tenants`,
  no aumenta su superficie de ataque materialmente al ganar
  `tenant_features` y `tenant_quota_usage`. Esas tablas son de su
  responsabilidad lógica (cargar contexto del tenant, contabilizar
  uso). El blast radius extra es: dos tablas más en lectura y un
  contador en escritura.
- Crear un cuarto rol `tenant_quota_role` añade otra URL en `.env`,
  otro pool de conexiones en la app, otro cliente Prisma, sin
  beneficio claro.
- Las tablas a las que no debería acceder (`subscriptions`,
  `stripe_events`, `audit_log`, `super_admins`) siguen prohibidas. La
  separación con `master_role` se mantiene íntegra.

**Variable de entorno**: `TENANT_RUNTIME_DATABASE_URL` (renombra
`TENANT_RESOLVER_DATABASE_URL` propuesta por ADR-002 §5.4). El cliente
Prisma asociado pasa de `prismaResolver` a **`prismaRuntime`**.

> **TODO en ADR-002**: ADR-002 §3.6 y §5.4 deben actualizarse con el
> nombre `tenant_runtime_role` y los permisos ampliados. No se edita
> ADR-002 desde aquí; queda como pendiente del próximo bloque de
> enmiendas a ADR-002.

### 2.3 Modelo de datos para quotas: `master.tenant_quota_usage`

Las quotas (`emails_mes`, `pushs_mes`, `exports_mes`, `api_calls_dia`)
necesitan un contador con periodo de reset. No caben en
`master.tenant_features` porque esa tabla se reescribe en bloque en
cada `customer.subscription.updated` (ADR-003 §2.9).

```sql
CREATE TABLE master.tenant_quota_usage (
  id            text PRIMARY KEY,                    -- cuid
  tenant_id     text NOT NULL REFERENCES master.tenants(id) ON DELETE CASCADE,
  feature_key   text NOT NULL,                       -- "emails_mes", "exports_mes", ...
  period_start  timestamptz NOT NULL,
  period_end    timestamptz NOT NULL,
  consumed      bigint NOT NULL DEFAULT 0,
  max           bigint,                              -- snapshot del límite vigente al inicio del periodo. NULL = unlimited
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_tenant_quota_period
  ON master.tenant_quota_usage(tenant_id, feature_key, period_start);

CREATE INDEX idx_quota_active
  ON master.tenant_quota_usage(tenant_id, feature_key, period_end);

CREATE TRIGGER tenant_quota_usage_updated_at
  BEFORE UPDATE ON master.tenant_quota_usage
  FOR EACH ROW EXECUTE FUNCTION master.touch_updated_at();
```

**Reset (apertura de nuevo periodo)**: el handler de
`invoice.payment_succeeded` (ADR-003 §2.3.a) inserta una fila nueva
por cada feature de tipo quota del tenant con:

- `period_start = subscription.current_period_start` (el nuevo).
- `period_end = subscription.current_period_end` (el nuevo).
- `consumed = 0`.
- `max` = snapshot del límite vigente para esa feature según
  `tenant_features` + addons.

Las filas de periodos viejos **no se borran**: son auditables ("¿cuánto
gastó este cliente el mes pasado?"). Un job de Fase 9 puede archivarlas
o purgarlas tras N meses (TBD).

**Edge case: no hay fila de quota vigente**

Casos en que el periodo activo no está creado:

- Trial recién iniciado y el handler de `customer.subscription.created`
  con status `trialing` aún no insertó la fila inicial.
- Worker caído o atrasado durante una transición de periodo (gap entre
  `period_end` viejo e inicio del nuevo).
- Bug del handler que falló al crear la fila.

**Decisión: fail-closed**. Si `consumeQuota(key, n)` no encuentra fila
vigente para `tenant_id, key`, devuelve
`{ ok: false, used: 0, max: 0, resetAt: null }` y el endpoint
responde **429 Too Many Requests**. Argumento:

- El principio de menor riesgo es no permitir consumo sin
  contabilidad. Si el contador no existe, cualquier número que
  devolvamos como `remaining` es inventado.
- La probabilidad real es baja: la coreografía de provisión inserta la
  primera fila de quota dentro del mismo handler que crea la
  subscription (síncrona, ADR-003 §2.6). El job de detección de
  PROVISIONING huérfanos (ADR-003 §5.2) recupera fallos.
- El error que ve el cliente es un 429 con mensaje "no hay periodo de
  cuota activo, reintenta en unos segundos". Reintentos posteriores
  funcionarán cuando el handler haya completado.

`getLimit('emails_mes')` (que devuelve el `max`) sí puede leer de
`tenant_features`; solo el contador (`consumed`, `remaining`) requiere
la fila de periodo. Si la fila no existe, `consumeQuota` falla
fail-closed pero `getLimit` sigue funcionando.

### 2.4 Precarga de features en el contexto del tenant

El middleware HTTP (Fase 3, ADR-002 §5.2) extiende su lookup: además
de resolver `host → tenant`, carga las features del tenant en el
mismo viaje. Pseudocódigo:

```ts
// src/middleware.ts (Fase 3)
const tenant = await resolveTenant(host);                      // lookup en master.tenants (cache TTL 60s)
const features = await loadFeaturesFor(tenant.id);             // lookup en master.tenant_features
return runWithTenant(
  { ...tenant, features: indexFeatures(features) },
  () => continueRequest()
);
```

`loadFeaturesFor(tenantId)` agrupa las filas de `master.tenant_features`
con la prioridad `manual_override > addon > plan` (ADR-003 §2.9
enmendado) y devuelve un `Map<feature_key, ResolvedFeature>` que cabe
en el contexto.

`hasFeature(key)` y `getLimit(key)` leen de ese Map sin tocar BD:

```ts
export async function hasFeature(key: string): Promise<boolean> {
  const features = currentTenant().features;
  return features.get(key)?.value === true;
}

export async function getLimit(key: string): Promise<number | null> {
  const f = currentTenant().features.get(key);
  if (!f) return 0;                       // feature no aprovisionada → tope 0
  return f.value === null ? null : Number(f.value);
}
```

La caché host→tenant del ADR-002 §2.3 cachea ahora también las
features (mismo TTL de 60s). Cualquier cambio vía
`customer.subscription.updated` o `manual_override` surte efecto en
≤60 segundos en cada instancia.

### 2.5 Atomicidad de `consumeQuota`

Race condition obvia: dos requests del mismo tenant gastando la
última unidad simultáneamente. Solución: **UPDATE condicional con
RETURNING**.

```ts
export async function consumeQuota(key: string, amount: number = 1) {
  const { tenantId } = currentTenant();
  const now = new Date();

  const rows = await prismaRuntime.$queryRaw<
    { consumed: number; max: number | null; period_end: Date }[]
  >`
    UPDATE master.tenant_quota_usage
       SET consumed = consumed + ${amount},
           updated_at = now()
     WHERE tenant_id = ${tenantId}
       AND feature_key = ${key}
       AND period_start <= ${now}
       AND period_end > ${now}
       AND (max IS NULL OR consumed + ${amount} <= max)
     RETURNING consumed, max, period_end
  `;

  if (rows.length === 0) {
    // O no había fila vigente, o la suma excedería el límite.
    // Distinguir con un SELECT separado para el mensaje de error.
    const current = await prismaRuntime.tenantQuotaUsage.findFirst({
      where: { tenant_id: tenantId, feature_key: key,
               period_start: { lte: now }, period_end: { gt: now } },
    });
    if (!current) {
      return { ok: false as const, used: 0, max: 0, resetAt: null };
    }
    return {
      ok: false as const,
      used: Number(current.consumed),
      max: Number(current.max ?? 0),
      resetAt: current.period_end,
    };
  }

  const row = rows[0];
  return {
    ok: true as const,
    remaining: row.max === null ? null : Number(row.max - row.consumed),
    resetAt: row.period_end,
  };
}
```

Propiedades:

- **Sin race**: el `UPDATE … WHERE consumed + amount <= max` es
  atómico a nivel de fila en Postgres. Dos requests concurrentes con
  `amount = 1` cuando queda 1 unidad: la primera ve `consumed + 1 <= max`,
  incrementa y devuelve `{ok: true, remaining: 0}`; la segunda ve la fila
  ya con `consumed = max`, la condición falla, no afecta filas y
  devuelve `{ok: false}`.
- **Sin transacción explícita**: `UPDATE` con `WHERE` es transaccional
  por defecto en Postgres. No necesita `BEGIN/COMMIT` envolvente.
- **Compatible con `app_role` que no toca master**: el cliente Prisma
  para esta operación es `prismaRuntime` (con `tenant_runtime_role`,
  §2.2), no `prismaApp`.

### 2.6 Endpoint `GET /api/me/features` y caché en frontend

El front del tenant pide las features activas en una sola llamada al
cargar la app:

```http
GET /api/me/features
Authorization: Bearer <jwt>

200 OK
{
  "booleans": {
    "geofencing": true,
    "fichaje_movil": true,
    "export_csv": true,
    "api_access": false,
    ...
  },
  "limits": {
    "max_employees": { "current": 12, "max": 50 },
    "max_tiendas":   { "current": 2,  "max": 5 }
  },
  "quotas": {
    "emails_mes":   { "used": 230,  "max": 5000,      "resetAt": "2026-05-15T00:00:00Z" },
    "pushs_mes":    { "used": 1245, "max": null,      "resetAt": "2026-05-15T00:00:00Z" },
    "exports_mes":  { "used": 5,    "max": 100,       "resetAt": "2026-05-15T00:00:00Z" }
  }
}
```

- `current` para limits (ej. `max_employees`) requiere `count` sobre el
  schema del tenant (`prismaApp.user.count()` con `SET search_path`).
- `null` en `max` significa unlimited.
- `quotas[*].used` viene de `tenant_quota_usage`.

**Caché en cliente**:

- Persistir respuesta en `sessionStorage` con clave por tenant.
- Invalidar **al logout** y **al cargar `/configuracion/facturacion`**
  (página donde el OWNER hace upgrades; cualquier visita asume que el
  estado puede haber cambiado).
- No invalidar en cambios de ruta normales: el coste del re-fetch en
  cada navegación es desproporcionado.

### 2.7 Componente `<FeatureGate>` y `<UpsellCTA>`

Componente envoltorio que muestra/oculta UI según features, con CTA de
upsell opcional cuando la feature existe en el catálogo pero el tenant
no la tiene:

```tsx
// src/components/feature-gate.tsx (Fase 5)
type Props = {
  feature: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

export function FeatureGate({ feature, fallback, children }: Props) {
  const { booleans } = useFeatures();
  if (booleans[feature]) return <>{children}</>;
  return <>{fallback ?? null}</>;
}

// src/components/upsell-cta.tsx
export function UpsellCTA({ feature }: { feature: string }) {
  return (
    <div className="rounded-xl border bg-amber-50 p-4 text-amber-900">
      <p>Esta función está disponible en planes superiores o como addon.</p>
      <Link href="/configuracion/facturacion?upgrade={feature}">
        Ver opciones →
      </Link>
    </div>
  );
}
```

Uso típico en una página del tenant:

```tsx
<FeatureGate feature="export_csv" fallback={<UpsellCTA feature="export_csv" />}>
  <ExportButton />
</FeatureGate>
```

**Importante**: `<FeatureGate>` es UX defensiva. **No es seguridad**.
La barrera real está en el server-side enforcement (§2.8).

### 2.8 Server-side enforcement: `withFeature` y `withQuota`

Cada endpoint que requiere una feature **debe** chequearla en el
servidor. Sin excepciones. Para no repetir el patrón en 46 endpoints,
HOFs (higher-order functions) que envuelven el handler:

```ts
// src/lib/feature-guard.ts (Fase 5)

type RouteHandler = (req: NextRequest, ctx: RouteCtx) => Promise<Response>;

export function withFeature(key: string, handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    if (!(await hasFeature(key))) {
      return Response.json(
        {
          error: "feature_required",
          feature_key: key,
          upgrade_url: "/configuracion/facturacion?upgrade=" + key,
        },
        { status: 402 }
      );
    }
    return handler(req, ctx);
  };
}

export function withQuota(key: string, amount: number = 1, handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    const result = await consumeQuota(key, amount);
    if (!result.ok) {
      return Response.json(
        {
          error: "quota_exceeded",
          feature_key: key,
          used: result.used,
          max: result.max,
          reset_at: result.resetAt?.toISOString() ?? null,
        },
        { status: 429, headers: { "Retry-After": secondsUntil(result.resetAt) } }
      );
    }
    return handler(req, ctx);
  };
}
```

Uso típico:

```ts
// src/app/api/informes/exportar/route.ts (Fase 5)
export const GET = withFeature("export_csv",
  withQuota("exports_mes", 1, async (req) => {
    const csv = await generarInforme(...);
    return new Response(csv, { headers: { "Content-Type": "text/csv" } });
  })
);
```

**Códigos HTTP** y payload JSON estandarizados:

- **402 Payment Required**: feature no incluida en el plan/addons
  actuales. Payload: `{ error, feature_key, upgrade_url }`. El front
  puede usarlo para abrir el FeatureGate o redirigir al portal.
- **429 Too Many Requests** + `Retry-After`: quota excedida. Payload:
  `{ error, feature_key, used, max, reset_at }`. El cliente sabe
  cuándo reintentar.

**Patrón obligatorio para Fase 5**:

- Cada endpoint de la app que dependa de una feature de §11.4 (booleana
  o quota) debe envolverse con `withFeature` y/o `withQuota`. La lista
  concreta se mantiene en `src/lib/feature-guard.ts` como tabla
  `endpoint → features` para auditoría.
- **Test obligatorio**: por cada feature boolean del catálogo §11.4,
  existe un endpoint que la requiere y un test E2E que verifica `402`
  cuando el tenant no la tiene. La cobertura se mide con un script
  `npm run test:feature-coverage` que falla en CI si una feature de
  §11.4 no aparece en ningún `withFeature(...)` del código.

### 2.9 `registro_jornada_legal` CORE: lint + test

§11.2 de la auditoría declara que la **existencia** del registro de
jornada y su **consulta por el empleado** son CORE no desactivables
(RD 8/2019 obliga). En la práctica: ningún endpoint que lleve a esos
flujos puede tener `withFeature` o `hasFeature` en su body.

**Tres salvaguardas**:

1. **Convención de rutas reservadas** (CORE): bajo
   - `src/app/api/fichajes/**`
   - `src/app/api/empleado/fichajes/**`
   - `src/app/api/empleado/registro/**`
   - `src/app/api/fichaje/registro-legal/**` (nuevo en Fase 5: export
     en formato exigido por inspección)
   No puede aparecer ningún `hasFeature(`, `withFeature(`,
   `getLimit(` ni `consumeQuota(`.
2. **Lint rule custom** (`eslint-plugin-fichaje/no-feature-gate-on-core`):
   regla ESLint que falla CI si en cualquier archivo bajo esas rutas
   se importa de `src/lib/tenant/features.ts` o de
   `src/lib/feature-guard.ts`. Implementación de referencia en
   `eslint.config.mjs` con un plugin local.
3. **Test E2E**: un tenant sembrado con plan Starter y todas las
   features booleanas a `false` (excepto las CORE) debe poder:
   - `POST /api/fichajes` con `tipo: "ENTRADA"` → 201.
   - `GET /api/fichajes?fecha=...` → 200 con su propio histórico.
   - `GET /api/fichaje/registro-legal?desde=...&hasta=...` → 200 con
     export en formato XML/PDF según RD 8/2019.

   El test debe pasar **incluso si el tenant tiene `export_csv = false`**.

**Endpoint nuevo `/api/fichaje/registro-legal`**: distinto de
`/api/informes/exportar` (que es el que aplica `export_csv`,
`export_excel`). Genera el registro en el formato exigido por la
inspección de trabajo. **No** chequea `export_csv` ni `export_excel`.
Es CORE.

### 2.10 Race en `max_employees` con advisory lock

Crear el empleado nº `max + 1` requiere chequear el límite antes y
crear después. Race obvia: dos `POST /api/empleados` simultáneos
cuando queda 1 hueco.

**Decisión: PostgreSQL advisory lock por tenant + feature**.

```ts
// src/app/api/empleados/route.ts (Fase 5)
export const POST = withFeature("max_employees", async (req) => {
  const data = await req.json();
  const { tenantId } = currentTenant();

  return prismaApp.$transaction(async (tx) => {
    // Lock por (tenant, feature). Se libera al commit/rollback.
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      `tenant:max_employees:${tenantId}`
    );

    const max = await getLimit("max_employees");
    const count = await tx.user.count({ where: { activo: true } });

    if (max !== null && count >= max) {
      throw new HttpError(402, {
        error: "limit_reached",
        feature_key: "max_employees",
        current: count,
        max,
        upgrade_url: "/configuracion/facturacion?upgrade=max_employees",
      });
    }

    return tx.user.create({ data });
  });
});
```

Argumento (alternativas en §3.3):

- **Advisory lock** (`pg_advisory_xact_lock`): scope local a la
  sesión, lock-free (no toca tablas), libre al final de la
  transacción. La hash de `"tenant:max_employees:<id>"` lo hace
  por-tenant: dos tenants distintos no se bloquean entre sí.
- **Compatible con `SET search_path`**: el advisory lock vive en la
  conexión completa, no en un schema. Funciona dentro de la
  transacción del tenant sin interferencia.
- **Coste**: una llamada `pg_advisory_xact_lock` por crear-empleado.
  Despreciable.

### 2.11 UI de `manual_override` en panel super-admin

Página `/admin/tenants/<id>/features` en `admin.ficha.tecnocloud.es`
(panel super-admin, ADR-007 cierra el panel completo; aquí solo el
flow de override):

- Lista las features del tenant con su `value` actual y `source`.
- Botón "Add override" que abre formulario:
  - `feature_key`: select del catálogo §11.3 con buscador.
  - `value`: input según tipo declarado en `master.features`
    (boolean toggle, integer input para limit/quota, etc.).
  - `expires_at`: date+time picker, opcional. Por defecto 30 días.
  - `reason`: textarea, **obligatorio**, mínimo 10 caracteres.
- Submit:
  - `POST /api/admin/tenants/:id/feature-overrides`.
  - Auth super-admin (ADR-007).
  - Inserta `master.tenant_features` con `source = 'manual_override'`.
  - Inserta `master.audit_log` con `actor = super_admin.id`,
    `tenant_id`, `feature_key`, `previous_value`, `new_value`,
    `reason`, `expires_at`.
  - Si ya hay un override activo para esa `feature_key` del tenant: el
    UI lo muestra y la operación es UPSERT; el `audit_log` registra
    `previous_value`.

El endpoint y la auditoría se materializan en Fase 7 con el resto del
panel.

---

## 3. Opciones consideradas

### 3.1 Acceso a `master.tenant_features` desde la app del tenant

| Opción                                                                                       | A favor                                                                                                | En contra                                                                                                              |
|----------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Pasar `app_role` a tener `SELECT` sobre `master.tenant_features`                             | Un solo cliente Prisma                                                                                  | Viola ADR-001 §2.3: `app_role` no toca `master`. Un bug en producto leería suscripciones de otros tenants               |
| Crear un cuarto rol Postgres `tenant_quota_role` separado del resolver                       | Separación máxima de responsabilidades                                                                  | Cuarto rol, cuarta URL, cuarto cliente Prisma. Operativa más cara sin beneficio                                        |
| **Ampliar `tenant_resolver_role` → `tenant_runtime_role`** (elegida)                         | Un solo cliente extra (`prismaRuntime`). La superficie crece muy poco (2 tablas en lectura, 1 en update). Coherente con que la responsabilidad lógica es la misma capa | TODO de actualizar ADR-002. Cambio de nombre a propagar en docs y `.env`                                                |
| Cargar features en middleware HTTP (ya elegido en §2.4) **+** consumeQuota delegado al worker vía cola | App del producto sin acceso a master                                                                    | Latencia: cada `consumeQuota` espera a que el worker procese. UX peor. Rompe el flow síncrono `request → respuesta`     |

La elegida combina **carga en middleware** (para hasFeature/getLimit
sin tocar BD por request) **con cliente Prisma propio** (para
`consumeQuota` atómico).

### 3.2 Edge case "no hay fila de quota vigente"

| Opción                                       | A favor                                                                          | En contra                                                                                  |
|----------------------------------------------|-----------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| **Fail-closed** (429 sin contador) (elegida) | Conservador. No permite consumo sin contabilidad. Compatible con auditoría legal | UX: cliente recibe 429 transitorio si el handler tarda en crear la fila inicial             |
| Fail-open (permitir, sin contar)             | UX: cliente nunca ve 429 raro                                                    | Riesgo: si el handler nunca crea la fila por bug, el cliente consume infinito sin facturar |
| Fail-open con contador en memoria            | UX y cierta protección                                                           | Contador in-memory no sobrevive deploy ni reinicio. Inconsistente entre instancias          |

### 3.3 Race en `max_employees`

| Opción                          | A favor                                                                  | En contra                                                                                                |
|---------------------------------|---------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| `SERIALIZABLE` transaction      | Detección automática por Postgres                                         | Lanza `serialization_failure`; obliga a reintentos en aplicación. Complica el handler                    |
| **Advisory lock por tenant** (elegida) | Lock local a la sesión, libre al commit. Sin reintentos. Por-tenant     | Hay que recordar usarlo; convención que documentar. Si se olvida, race posible                           |
| Eventual consistency con cleanup | Inserta primero, chequea después                                          | Estado inconsistente transitorio (count > max durante ms). Cleanup propenso a errores                    |
| Constraint en BD (`CHECK`)      | Postgres garantiza por construcción                                        | `CHECK` no puede consultar otras filas de la misma tabla con `count(*)`. Habría que usar trigger; complejo |

### 3.4 Server-side enforcement: HOF, decorator o middleware

| Opción                                  | A favor                                                                | En contra                                                                                          |
|-----------------------------------------|-------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| **HOF `withFeature` / `withQuota`** (elegida) | Idiomático en Next App Router (export const GET = withX(handler)). Composable. Tipos TS correctos | Cada export del route handler tiene que envolverse explícitamente |
| Decorators (TS5 stage 3)                | `@requireFeature("...")` lee bien                                       | Decorators en `function`-style API routes no son estables aún. Acoplamiento con TS específico       |
| Middleware Next.js global               | Una sola declaración para todos los endpoints                            | El middleware Next no puede leer `master` (sin cliente Prisma allí). Habría que pasar el chequeo a los handlers de todas formas |

---

## 4. Consecuencias

### 4.1 Positivas

- **Cero round-trip a master por `hasFeature`/`getLimit`** en runtime
  del producto. Las features están en `currentTenant().features` desde
  el middleware HTTP. El coste de ese único lookup se amortiza con la
  caché host→tenant de ADR-002 §2.3.
- **`consumeQuota` sin race** por construcción, con un único `UPDATE`
  condicional.
- **Server-side enforcement obligatorio** y trazable: `withFeature` /
  `withQuota` están en el route handler, no en helpers escondidos. El
  test de cobertura garantiza que ninguna feature del catálogo se
  queda sin gating.
- **`registro_jornada_legal` CORE protegido por tres barreras**:
  convención + lint + test E2E. Un dev distraído no puede meter por
  error un `withFeature` en la ruta del fichaje.
- **`max_employees` sin race** con advisory lock localizado por tenant.
- **`manual_override` con audit trail** completo desde el panel
  super-admin.

### 4.2 Negativas (asumidas)

- **`tenant_runtime_role` con permisos ampliados respecto a `tenant_resolver_role`**.
  El blast radius del middleware HTTP crece dos tablas en lectura y un
  contador en escritura. Aceptable: sigue sin tocar `subscriptions`,
  `stripe_events`, `audit_log`, `super_admins`.
- **Convención + lint para CORE no es a prueba de balas**. Un dev que
  desactive el lint y meta un `hasFeature` rompe la garantía. El test
  E2E es la última barrera: si pasa, el flujo está libre de gating.
- **Caché de features con TTL 60s** (heredada de ADR-002 §2.3): un
  upgrade del OWNER tarda hasta 60s en propagarse a todas las
  instancias. Mismo trade-off ya aceptado en ADR-002 §3.4.
- **`consumeQuota` requiere round-trip a master en cada uso**. No
  cacheable por request porque el contador cambia. Coste: una query
  UPDATE por endpoint de quota. Aceptable a 10–100 tenants.
- **Edge case fail-closed** puede generar 429 raros en arranque del
  trial si el handler de subscription se retrasa. Mitigación: el job
  de PROVISIONING huérfanos (ADR-003 §5.2) recupera, y el reintento
  del cliente funciona pasados unos segundos.

### 4.3 Neutras

- **`<FeatureGate>` no es seguridad**, es UX. La seguridad está en
  `withFeature`. Esto se documenta en el JSDoc del componente y en el
  README de Fase 5.
- **Endpoint `/api/me/features` consulta tres fuentes**:
  `tenant_features` (boolean/limit max), schema del tenant (limit
  current via count), `tenant_quota_usage` (quotas). Es el endpoint
  más caro por carga útil; el front lo cachea en sessionStorage para
  amortizar.
- **Filas viejas en `tenant_quota_usage`** crecen ~K filas por tenant
  por mes (K = número de quotas). Para 100 tenants × 4 quotas × 24
  meses = 9.600 filas. Sin necesidad de purgar en años. Job de
  archivado a Fase 9 si crece.
- **Cliente actual (cutover Fase 8)** no tiene `tenant_quota_usage`
  hasta que se le asigne plan. Documentado en §5.4.

---

## 5. Implicaciones para fases siguientes

### 5.1 Fase 2 — Control plane

- Migración Prisma para `master.tenant_quota_usage` con sus índices y
  el trigger `touch_updated_at` (pequeña función `RETURNS trigger`
  utilitaria).
- Seed de `master.features` con la lista del catálogo §11.3 categorizada
  por tipo (`boolean` / `limit` / `quota`).
- Crear `tenant_runtime_role` con los permisos de §2.2 (renombra y
  amplía `tenant_resolver_role` propuesto en ADR-002 §3.6).

> **TODO en ADR-002**: actualizar §3.6 y §5.4 con
> `tenant_runtime_role` (nombre nuevo, permisos ampliados a
> `master.tenant_features` SELECT y `master.tenant_quota_usage`
> SELECT/INSERT/UPDATE) y la env `TENANT_RUNTIME_DATABASE_URL`. Queda
> como pendiente del próximo bloque de enmiendas a ADR-002.

### 5.2 Fase 3 — Resolución de tenant y refactor del producto

- `src/middleware.ts` precarga features además del lookup de tenant.
  El contexto pasa de `{ slug, tenantId, status }` a
  `{ slug, tenantId, status, features: Map<string, ResolvedFeature> }`.
- `src/lib/prisma.ts` añade `prismaRuntime` con
  `TENANT_RUNTIME_DATABASE_URL`.
- Test de fuga (ADR-001 §2.4) extendido: una request con `currentTenant().features`
  manualmente vacío debe seguir fallando-cerrado en `consumeQuota`.

### 5.3 Fase 5 — Feature flags en uso

- Implementar `src/lib/tenant/features.ts` con `hasFeature`,
  `getLimit`, `consumeQuota` (firmas de §2.1, atomicidad de §2.5).
- Implementar `src/lib/feature-guard.ts` con `withFeature`,
  `withQuota`. Tabla `endpoint → features` mantenida aquí.
- Implementar `src/components/feature-gate.tsx` y
  `src/components/upsell-cta.tsx`.
- Implementar `GET /api/me/features` en el route handler del subdominio
  del tenant.
- Implementar la regla ESLint `no-feature-gate-on-core`. Configurar el
  plugin local en `eslint.config.mjs`.
- Endpoint `GET /api/fichaje/registro-legal` (CORE) y test E2E que
  verifica que un Starter con todas las features booleanas a false
  puede llamarlo.
- Aplicar `withFeature` / `withQuota` a los endpoints del catálogo
  §11.4. Tabla de cobertura en `src/lib/feature-guard.ts`.
- `npm run test:feature-coverage` que falla en CI si una feature
  declarada en §11.4 no aparece envuelta en ningún
  `withFeature(...)`/`withQuota(...)`.

### 5.4 Fase 8 — Cutover del cliente actual

El primer tenant en producción (la app `Ficha` actual con sus 15
tiendas según `DESPLIEGUE.md`) **no pasa por checkout Stripe**: ya
está en producción y ya paga (o no) por contrato externo.

**Plan asignado: `enterprise`**. Justificación:

- 15 tiendas supera el tope de Pro (`max_tiendas = 5`).
- Sin sub-cap explícita en el contrato externo, tomamos el plan más
  alto del catálogo para garantizar que todas las features que ya usa
  siguen disponibles.
- Si futuro downgrade a Pro fuera deseable, el cambio es una
  operación reversible desde el panel super-admin.

**Guion concreto del cutover** (en `Fase 8`, se materializa con un
script SQL aplicado tras el primer `migrate deploy` con las migraciones
de Fase 2 ya creadas):

1. Crear el `master.tenants` con `id` predefinido, `slug` =
   subdominio elegido, `status = 'ACTIVE'`, `created_at` =
   timestamp del cutover.
2. **Sin Stripe Customer real**: insertar
   `stripe_customer_id = 'cus_manual_<tenant_id>'` (sentinel; los
   `customer.metadata.tenant_id` reales empiezan por `cus_`, así que
   el prefijo `cus_manual_` no colisiona con clientes Stripe reales).
3. Insertar `master.subscriptions` con
   `stripe_subscription_id = 'sub_manual_<tenant_id>'`,
   `plan_key = 'enterprise'`, `status = 'active'`,
   `current_period_start = now()`,
   `current_period_end = now() + interval '1 year'`,
   `cancel_at_period_end = false`,
   `raw_event_id_last = NULL`.
4. Insertar `master.subscription_items` con un único item
   `feature_key = 'enterprise_plan'` y `quantity = 1`.
5. Insertar todas las features de Enterprise (§11.4) en
   `master.tenant_features` con `source = 'plan'` y la value
   correspondiente (boolean true / limit value / etc.).
6. **Si el cliente tenía features adicionales fuera del catálogo**
   (ej: branding extra, una feature pre-existente en el código actual
   que no encaja en ningún plan): insertar con
   `source = 'manual_override'`,
   `reason = 'cutover Fase 8 - features pre-existentes'`,
   `expires_at = NULL`.
7. Insertar las filas iniciales de `master.tenant_quota_usage` para
   las quotas de Enterprise con `consumed = 0`,
   `period_start = now()`, `period_end = now() + interval '1 month'`.

El script de cutover es idempotente (todos los INSERTs con `ON
CONFLICT DO NOTHING`), de forma que se puede ejecutar dos veces sin
duplicar.

> Decisión a confirmar en Fase 8 (no aquí): si el cliente actual
> migra a un Stripe Customer real (con cobro automático) o se queda
> con sentinel `manual_*`. Si lo segundo, las renovaciones del periodo
> y los reseteos de quota deben hacerse manualmente con un job
> programado o por el panel super-admin.

---

## 6. Criterios de aceptación

Esta decisión se considera implementada cuando, al término de Fase 5,
todos los siguientes son ciertos:

1. `master.tenant_quota_usage` existe en master con índices únicos y el
   trigger `updated_at`.
2. `tenant_runtime_role` existe con los permisos exactos de §2.2 y
   `tenant_resolver_role` ya no se usa (verificado con `\du` en psql y
   con grep en `src/lib/prisma.ts`).
3. `currentTenant().features` está poblado en cada request de tenant
   active. Verificado con un test que asierta el contenido tras un
   `runWithTenant`.
4. `hasFeature("export_csv")` devuelve `true` para un tenant con plan
   Pro y `false` para un Starter, sin tocar BD en runtime (verificado
   con un counter de queries Prisma).
5. `consumeQuota("emails_mes", 1)` con dos llamadas concurrentes
   cuando queda 1 unidad: una devuelve `{ok:true}`, la otra `{ok:false}`.
   Verificado con test de carrera con `Promise.all` ×100.
6. `consumeQuota` con tenant sin fila vigente devuelve
   `{ok:false, used:0, max:0}` y el endpoint retorna 429.
7. `GET /api/me/features` devuelve el shape exacto de §2.6.
8. Para cada feature boolean del catálogo §11.4, existe un endpoint
   envuelto con `withFeature(key)` y un test que verifica 402 cuando
   el tenant no la tiene (`npm run test:feature-coverage` pasa).
9. La regla ESLint `no-feature-gate-on-core` falla en CI si se
   introduce un `withFeature` o `hasFeature` en alguna ruta CORE
   (verificado con un fixture que viola la regla).
10. Un tenant Starter con todas las features booleanas a `false`
    (excepto las CORE) puede hacer `POST /api/fichajes`,
    `GET /api/fichajes`, `GET /api/fichaje/registro-legal` sin recibir
    402 (test E2E).
11. `POST /api/empleados` con `max_employees = N` y `count(User) = N`
    desde dos requests simultáneas: una devuelve 201, la otra 402. El
    advisory lock se libera al commit (verificado con `pg_locks` antes
    y después).
12. El panel super-admin (Fase 7, prerequisito de este criterio) puede
    crear un `manual_override` con `reason` obligatorio que aparece
    inmediatamente en `tenant_features` y en `audit_log`. Para Fase 5,
    se valida que el INSERT directo en BD funciona como espera el
    helper `hasFeature`.

---

## 7. Referencias

- [`docs/arch/00-auditoria.md`](./00-auditoria.md):
  - §11.1 (tipos boolean/limit/quota).
  - §11.2 (`registro_jornada_legal` CORE).
  - §11.3 (catálogo de features).
  - §11.4 (mapping starter/pro/enterprise + addons).
- [ADR-000](./adr-000-vision-saas.md) — visión SaaS y bounded contexts.
- [ADR-001](./adr-001-aislamiento-multi-tenant.md), §2.3 (roles
  Postgres), §2.4 (test de fuga), §2.5 (`quoteSchemaName`).
- [ADR-002](./adr-002-resolucion-tenant.md), §2.2 (`AsyncLocalStorage`),
  §2.3 (caché host→tenant), §3.6 (`tenant_resolver_role` —
  renombrado y ampliado en este ADR).
- [ADR-003](./adr-003-billing-y-suscripciones.md), §2.2 (tablas
  `subscriptions`/`subscription_items`/`stripe_events`/`tenant_features`),
  §2.3 (handlers Stripe), §2.9 (resolución `manual_override > addon >
  plan` con `PRIORITY` map), §5.2 (job PROVISIONING huérfanos).
- [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md),
  apartado 4 (Sistema de planes y features), Fases 5 y 8.
- ADR-007 (auth super-admin) — pendiente, cierra la auth y el endpoint
  `POST /api/admin/tenants/:id/feature-overrides`, además de la tabla
  `master.audit_log`.
- ADR-008 (lifecycle del tenant) — pendiente, define cómo se purgan
  filas viejas de `tenant_quota_usage` cuando un tenant pasa a
  `DELETED`.
- Real Decreto-ley 8/2019 de 8 de marzo: condiciona que el registro de
  jornada y su consulta sean CORE no desactivables.
- PostgreSQL docs:
  [advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS),
  [`hashtextextended`](https://www.postgresql.org/docs/current/functions-binarystring.html).
- Next.js docs: [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers).
