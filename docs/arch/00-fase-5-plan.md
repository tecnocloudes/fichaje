# Plan de Fase 5 — Feature flags productivos (HOFs `withFeature`/`withQuota` + `<FeatureGate>`)

- **Estado**: PROPUESTO (pendiente de aprobación antes de tocar código)
- **Fecha**: 2026-05-01
- **Spec maestra**: [`../specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md), apartado "Fase 5 — Feature flags en uso"
- **ADR de referencia**: [`adr-004-feature-flags-y-addons.md`](./adr-004-feature-flags-y-addons.md) (es el ADR de esta fase)
- **Otros ADRs aplicables**: 002 (§2.4 status → HTTP), 003 (§2.9 prioridad manual_override > addon > plan), 008 (§5.1 verificar que HOFs respetan suspended/deleted)
- **Estado heredado**: `feature/saas-migration` con Fase 4 cerrada + 5 fixes E2E ([`00-fase-4-cierre.md`](./00-fase-4-cierre.md)). Tenant `test1` provisionado vía Stripe Checkout real. `dev:all` con worker activo. ADR-008 escrito (lifecycle SUSPENDED → DELETED).

## 0. Objetivo

Aplicar las features que solo son **datos en master** (32 entries en `tenant_features` por tenant) a **comportamiento real** en runtime:

1. **HOF server-side `withFeature(key, handler)`**: rechaza con 402 si la feature no está activa en el tenant.
2. **HOF server-side `withQuota(key, n, handler)`**: consume `consumeQuota` atómico (Fase 3 commit 16) antes de ejecutar el handler. Mapea `period_unavailable`/`limit_reached` a 429 con `Retry-After`.
3. **Componente `<FeatureGate feature key fallback={…}>`**: oculta UI cuando la feature no está activa. NO es seguridad — solo UX.
4. **Endpoint `GET /api/me/features`**: devuelve la matriz {booleans, limits, quotas} para el front.
5. **Refactor de endpoints/UI** que dependen de plan: `export_csv/excel/pdf`, `geofencing`, `api_access`, `dominio_personalizado`, `max_employees` (advisory lock), etc.
6. **Regla ESLint `no-feature-gate-on-core`**: prohíbe envolver `registro_jornada_legal` (RD 8/2019).
7. **Test runner `npm run test:feature-coverage`**: verifica que cada feature del catálogo §11.4 está cubierta por al menos un `withFeature(...)`.

Fuera del alcance (ver §12): UI de configuración por tenant (Fase 6), panel super-admin (Fase 7), Stripe Elements embebido (no, Fase 4 ya usa Checkout alojado), cutover producción (Fase 8).

ADR-004 cierra el qué y por qué; este plan cierra el cómo y en qué orden.

---

## 1. Decisiones ya cerradas en ADR-004 (recap)

Para que el plan sea autocontenido sin reescribir el ADR:

- **Helpers** (§2.1): `hasFeature(key) → bool`, `getLimit(key) → number|null`, `consumeQuota(key, n) → ConsumeQuotaResult`. Lectura desde `currentTenant().features` (Map cargado por el HOF `withTenant` en Fase 3).
- **Roles Postgres** (§2.2): `tenant_runtime_role` (lectura de master) + `quota_writer_role` (UPDATE atómico tenant_quota_usage). Disjuntos.
- **Modelo de quotas** (§2.3): `master.tenant_quota_usage` con `(tenant_id, feature_key, period_start)` UNIQUE. UPDATE atómico con `consumed + n <= max` en WHERE.
- **Precarga de features** (§2.4): el middleware HTTP (Fase 3, ahora HOF withTenant + withTenantPage) precarga `currentTenant().features: Map<key, ResolvedFeature>` al inicio del request.
- **Atomicidad consumeQuota** (§2.5 + §2.5 enmienda 3): `UPDATE … WHERE consumed + ${n} <= max RETURNING …`. Resultado discriminado: `{ok:true,remaining,resetAt}`, `{ok:false,reason:"period_unavailable"}`, `{ok:false,reason:"limit_reached",used,max,resetAt}`.
- **Endpoint `/api/me/features`** (§2.6): respuesta JSON con booleans + limits (`current` opt-in con flag) + quotas (`used`, `max`, `resetAt`). Caché en `sessionStorage`.
- **`<FeatureGate>`** (§2.7): server o client component (decidir en §3 abajo). UX defensiva, NO seguridad.
- **HOFs server-side** (§2.8): `withFeature(key, handler)` y `withQuota(key, n, handler)`. Composables. Códigos HTTP: 402 (feature no contratada), 429+Retry-After (quota).
- **`registro_jornada_legal` CORE** (§2.9): 3 salvaguardas — convención de rutas, lint custom, test E2E. RD 8/2019.
- **Race `max_employees`** (§2.10): `pg_advisory_xact_lock(hashtextextended('tenant:max_employees:<id>', 0))` dentro de `prismaApp.$transaction`.

---

## 2. HOFs server-side `withFeature` y `withQuota`

> **Importante (enmienda 1 pre-implementación)**: `hasFeature(key)`,
> `getLimit(key)`, `getQuotaConfig(key)` y cualquier helper de lectura
> leen **EXCLUSIVAMENTE** del Map `currentTenant().features` precargado
> por `withTenant` (Fase 3) o `withTenantPage` (Fase 4 fix). **NO
> consultan BD**. Cualquier `getLimit`/`hasFeature` que tuviera que
> tocar BD sería un bug.
>
> `consumeQuota(key, n)` es el **ÚNICO** helper que toca BD (UPDATE
> atómico `master.tenant_quota_usage` con `quota_writer_role`). Es el
> más caro; se invoca dentro de `withQuota` **DESPUÉS** de que
> `withFeature` haya validado contratación.

### 2.1 Composabilidad con `withTenant` y `withTenantPage`

Tres HOFs apilables. Orden obligatorio:

```ts
// Pipeline: withTenant (Fase 3) → withFeature → withQuota → handler
export const POST = withTenant(
  withFeature("export_csv",
    withQuota("exports_mes", 1, async (req) => {
      const csv = await generarCsv(...);
      return new Response(csv, { headers: { "Content-Type": "text/csv" } });
    })
  )
);
```

**Por qué este orden**:

1. `withTenant` (más externo) resuelve host → tenant → `runWithTenant` + status check. Si `status != active`, responde 402/503/410 ANTES de evaluar features.
2. `withFeature` ejecuta DENTRO del runWithTenant (puede llamar `hasFeature(key)` que lee `currentTenant().features`). Si la feature no está, responde 402 ANTES de tocar quota.
3. `withQuota` ejecuta DENTRO de feature OK. Llama `consumeQuota` (incrementa contador atómicamente). Si falla, responde 429 ANTES de ejecutar el handler real.
4. Handler corre solo si las 3 barreras pasan.

**Cumplimiento de ADR-008 §5.1**: el `withTenant` (Fase 3) ya rechaza tenants `suspended` (402) y `deleted` (410). `withFeature`/`withQuota` solo se ejecutan para tenants `active`. **No hay re-check de status redundante**.

### 2.2 Manejo de errores

| Caso | Status | Body | Header |
|---|---|---|---|
| Feature no contratada (`hasFeature(key) === false`) | **402 Payment Required** | `{ error: "feature_required", feature_key, upgrade_url: "/admin/configuracion/facturacion?upgrade=KEY" }` | — |
| Quota period unavailable (sin fila vigente — el handler de Stripe aún no creó el periodo, raro) | **429 Too Many Requests** | `{ error: "quota_period_unavailable", feature_key, message: "Reintenta en unos segundos" }` | `Retry-After: 30` |
| Quota limit reached (consumed + n > max) | **429 Too Many Requests** | `{ error: "quota_exceeded", feature_key, used, max, reset_at }` | `Retry-After: secondsUntil(reset_at)` |
| Quota OK | (handler decide) | (handler) | — |

**Decisión 402 vs 403**: ADR-004 §2.8 elige **402** porque "Payment Required" comunica intent comercial (upgrade plan), mientras que 403 sería "no tienes permisos". El navegador no actúa diferente; el front sí (puede mostrar UpsellCTA).

### 2.3 ¿`withFeaturePage` para server components?

ADR-004 §2.8 solo define HOFs para route handlers. Para **server components y layouts del subdominio tenant** (Bug 4 cerrado por `withTenantPage`), las features se chequean **dentro del componente** con `hasFeature(key)`:

```tsx
// src/app/(dashboard)/admin/api-tokens/page.tsx
async function ApiTokensPage() {
  if (!hasFeature("api_access")) {
    return <UpsellCTA feature="api_access" />;
  }
  // ... resto del componente
}
export default withTenantPage(ApiTokensPage);
```

**No hay `withFeaturePage` separado** — el component renderiza el upsell inline. Más control sobre el render del fallback (puede ser un layout entero, una sección, o una redirect).

**Excepción para páginas que solo existen si la feature está**: `withFeaturePage` HOF declarado en §15 como punto a confirmar.

---

## 3. Componente `<FeatureGate>` (UI)

### 3.1 Server component vs client component

**Recomendación: server component** (decisión revisable en §15).

- Lee `currentTenant().features` directamente (estamos dentro del runWithTenant gracias a `withTenantPage`).
- Sin dependencias cliente (no usa `useFeatures()` que pegue al endpoint `/api/me/features`).
- Render decidido server-side: el cliente nunca ve el children oculto.

```tsx
// src/components/feature-gate.tsx
import { hasFeature, getLimit } from "@/lib/tenant/features";
import type { ReactNode } from "react";

export function FeatureGate({
  feature,
  fallback,
  children,
}: {
  feature: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  if (hasFeature(feature)) return <>{children}</>;
  return <>{fallback ?? null}</>;
}
```

**Trade-off**: el cliente no puede toggle dinámicamente sin re-fetch de la página. Para casos donde se necesita toggle inmediato sin recarga (raros — typical: tras pagar el upgrade), se hace `router.refresh()`.

**Versión client `<FeatureGateClient>`** opcional: lee de `useFeatures()` que consume `/api/me/features` cacheado. Útil dentro de pages cliente. Pendiente de §15.

> **Restricción importante (enmienda 3 pre-implementación)**:
> `<FeatureGate>` es **server component**, por lo que **NO puede ser
> hijo directo de un client component** (uno con `'use client'` o un
> componente cliente como `<Dialog>`, `<Modal>`). Next 16 lanzará
> error en build/runtime.
>
> Si necesitas un gate dentro de UI cliente, usa `<FeatureGateClient>`
> (helper opcional definido en §15.1 como server por defecto +
> client opt-in) que consume el hook `useFeatures()`.
>
> **Patrón recomendado**: hacer el gate en el **server component
> padre** y NO renderear el client component hijo si la feature está
> OFF. Eso garantiza que NUNCA se envía al navegador código JS de
> features que el cliente no puede usar (mejor para bundle size y
> para evitar leaks de UI por inspección).
>
> ```tsx
> // ✓ Recomendado: gate server-side antes del client component.
> <FeatureGate feature="api_access" fallback={<UpsellCTA feature="api_access" />}>
>   <ApiTokensClientPanel />   {/* client, solo si gate OK */}
> </FeatureGate>
>
> // ✗ NO funciona: <FeatureGate> dentro de un client component.
> "use client";
> export function ClientPanel() {
>   return (
>     <FeatureGate feature="api_access">  {/* error en runtime */}
>       <Inner />
>     </FeatureGate>
>   );
> }
> ```

### 3.2 `<UpsellCTA>` y patrón de fallback

```tsx
// src/components/upsell-cta.tsx
import Link from "next/link";

export function UpsellCTA({ feature, message }: { feature: string; message?: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
      <p className="text-sm">
        {message ?? "Esta función está disponible en planes superiores o como addon."}
      </p>
      <Link
        href={`/admin/configuracion/facturacion?upgrade=${feature}`}
        className="mt-2 inline-block text-sm font-medium text-amber-700 hover:underline"
      >
        Ver opciones →
      </Link>
    </div>
  );
}
```

Uso:

```tsx
<FeatureGate feature="export_csv" fallback={<UpsellCTA feature="export_csv" />}>
  <ExportCsvButton />
</FeatureGate>
```

**El link a `/admin/configuracion/facturacion`** existe desde Fase 4 commit 16 (`facturacion/page.tsx`). El query param `?upgrade=KEY` es declarativo — la página de facturación puede usarlo para abrir Stripe Billing Portal con `flow_data.subscription_update` apuntando al price del plan que incluye esa feature (ampliación opcional Fase 9).

---

## 4. Endpoint `GET /api/me/features`

### 4.1 Implementación

`src/app/api/me/features/route.ts`:

```ts
import { withTenant } from "@/lib/tenant/with-tenant";
import { currentTenant } from "@/lib/tenant/context";
import { prismaApp, prismaRuntime } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const GET = withTenant(async () => {
  const ctx = currentTenant();
  const { booleans, limits, quotas } = await composeFeaturesResponse(ctx);
  return NextResponse.json({ booleans, limits, quotas });
});
```

`composeFeaturesResponse(ctx)` recorre `ctx.features` (Map ya cargado) + opcionalmente cuenta `current` para limits con flag (§4.2) + lee `tenant_quota_usage` para quotas.

### 4.2 `current` opt-in para limits

Solo los limits con cálculo `current` definido emiten la clave:

| Feature key | `current` cómo se calcula |
|---|---|
| `max_employees` | `prismaApp.user.count({ where: { activo: true } })` |
| `max_tiendas` | `prismaApp.tienda.count({ where: { activa: true } })` |
| `historial_meses` | NO (es límite de visibilidad, no contabilizable) |
| `max_storage_mb` | NO (requiere `SUM(size)` sobre Documento — Fase 9 con vista materializada) |

```ts
const LIMIT_CURRENT_LOADERS: Partial<Record<string, () => Promise<number>>> = {
  max_employees: () => prismaApp.user.count({ where: { activo: true } }),
  max_tiendas: () => prismaApp.tienda.count({ where: { activa: true } }),
  // Sin entrada → no se incluye `current`.
};
```

### 4.3 Quotas

Lee `master.tenant_quota_usage` con `prismaRuntime` (rol read-only sobre 4 tablas master, ADR-001 §2.3 + ADR-002 §3.6):

```ts
const usage = await prismaRuntime.tenantQuotaUsage.findMany({
  where: {
    tenantId: ctx.tenantId,
    periodStart: { lte: new Date() },
    periodEnd: { gt: new Date() },
  },
});
```

Mapeo a `{ used, max, resetAt }` en respuesta.

### 4.4 Caché en frontend

`sessionStorage` con clave `features:${tenantSlug}` (no `localStorage` — invalida al cerrar tab).
- Invalidar al logout.
- Invalidar al cargar `/admin/configuracion/facturacion` (paths que pueden cambiar features).

Implementado en `src/lib/hooks/use-features.ts` (cliente). El hook devuelve `{ booleans, limits, quotas, refresh }`. `refresh()` fuerza re-fetch.

---

## 5. Refactor de endpoints/UIs aristas críticas

### 5.1 Inventario por feature key

| Feature | Endpoint(s) | Componente UI | Tipo |
|---|---|---|---|
| `export_csv` | `/api/informes/exportar?format=csv` | `<ExportCsvButton>` en `/admin/informes` | boolean |
| `export_excel` | `/api/informes/exportar?format=xlsx` | `<ExportExcelButton>` en `/admin/informes` | boolean |
| `export_pdf` | `/api/informes/exportar?format=pdf` | `<ExportPdfButton>` en `/admin/informes` | boolean |
| `geofencing` | `/api/fichajes` (POST con lat/lon validation) | `<GeofenceSwitch>` en `/admin/configuracion`, validación cliente en `/empleado/fichaje` | boolean |
| `fichaje_movil` | (UI cliente — desactiva botón fichaje en móvil) | `<MobileFichajeBlock>` en empleado | boolean |
| `fichaje_tablet` | idem para tablet | idem | boolean |
| `api_access` | `/api/v1/**` (todos) — middleware con check global | `<ApiTokensPage>` muestra UpsellCTA si false | boolean |
| `dominio_personalizado` | (no endpoint — settings UI) | `<DomainSettings>` en branding | boolean (addon) |
| `firma_electronica` | `/api/firmas/**` | `<FirmaButton>` en documentos | boolean (addon) |
| `integraciones_nomina` | `/api/integraciones/nomina/**` | `<IntegracionesPage>` | boolean (addon) |
| `people_analytics` | `/api/analytics/**` | `<AnalyticsPage>` | boolean (addon) |
| `max_employees` | `/api/empleados POST` (advisory lock) | (UI muestra cuántos quedan) | limit |
| `max_tiendas` | `/api/tiendas POST` | idem | limit |
| `historial_meses` | `/api/fichajes GET` (filtro `from >= now - N months`) | (UI restringe selector fecha) | limit |
| `max_storage_mb` | `/api/documentos POST` (sum check) | (UI muestra GB usados) | limit |
| `emails_mes` | (cualquier `sendEmail()` consume 1) | — | quota |
| `pushs_mes` | (cualquier push consume 1) | — | quota |
| `exports_mes` | `/api/informes/exportar` (consume 1 por export) | — | quota |
| `api_calls_dia` | `/api/v1/**` (consume 1 por call) | — | quota |

**Total endpoints a tocar**: ~12 (los del catálogo §11.4 ADR-002).

### 5.2 Listado exhaustivo tras grep

A ejecutar al inicio de Fase 5:

```sh
# Todos los exports/informes:
ls src/app/api/informes/

# Todos los endpoints que escriben Documento/Fichaje:
grep -rln "prismaApp\.documento\.\|prismaApp\.fichaje\." src/app/api/

# Todos los componentes con texto "Exportar" / "Descargar":
grep -rln -E "Exportar|Descargar" src/components/ src/app/
```

El plan de tarea incluye este grep como primer commit (commit 0 de inventario).

### 5.3 Pattern de refactor por endpoint

```ts
// ANTES (Fase 3):
export const GET = withTenant(async (req) => {
  const csv = await generarCsv(req);
  return new Response(csv, { ... });
});

// DESPUÉS (Fase 5):
export const GET = withTenant(
  withFeature("export_csv",
    withQuota("exports_mes", 1, async (req) => {
      const csv = await generarCsv(req);
      return new Response(csv, { ... });
    })
  )
);
```

Cambio mecánico. La regla ESLint `route-must-use-withTenant` (TODO Fase 3 cierre §11) ahora también verifica que endpoints listados en `feature-guard.ts` tienen `withFeature` o `withQuota` asociado.

### 5.4 Pattern de refactor por componente UI

```tsx
// ANTES:
<ExportCsvButton />

// DESPUÉS:
<FeatureGate feature="export_csv" fallback={<UpsellCTA feature="export_csv" />}>
  <ExportCsvButton />
</FeatureGate>
```

### 5.5 `max_employees` con advisory lock (caso especial)

```ts
// src/app/api/empleados/route.ts
export const POST = withTenant(async (req) => {
  const { tenantId } = currentTenant();
  return prismaApp.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      `tenant:max_employees:${tenantId}`,
    );
    const max = getLimit("max_employees");
    const count = await tx.user.count({ where: { activo: true } });
    if (max !== null && count >= max) {
      throw new HttpError(402, {
        error: "limit_reached",
        feature_key: "max_employees",
        current: count,
        max,
        upgrade_url: "/admin/configuracion/facturacion?upgrade=max_employees",
      });
    }
    return tx.user.create({ data: { ... } });
  });
});
```

Sin `withFeature` ni `withQuota` envolviendo — `max_employees` es **limit** (no boolean ni quota). El check + creación va inline en transacción con advisory lock.

---

## 6. Reglas ESLint custom

### 6.1 `no-feature-gate-on-core` (NUEVA — Fase 5)

Prohíbe `hasFeature/withFeature/getLimit/consumeQuota` en archivos bajo:
- `src/app/api/fichajes/**`
- `src/app/api/empleado/fichajes/**`
- `src/app/api/empleado/registro/**`
- `src/app/api/fichaje/registro-legal/**` (nuevo en Fase 5)

Razón: RD 8/2019 obliga a que el registro de jornada SEA SIEMPRE accesible; ningún plan/addon puede deshabilitarlo. Si un dev olvida y aplica `withFeature` por inercia, el lint falla CI.

Implementación: extender `eslint.config.mjs` con regla custom (mismo patrón del plugin local de Fase 3 commit 18).

### 6.2 `no-quota-writer-leak` (verificar que existe)

ADR-004 §2.2 menciona esta regla pero no la encontré en `eslint.config.mjs`. **Acción Fase 5**: implementarla. Prohíbe `import { prismaQuotaWriter } from "@/lib/prisma"` fuera de `src/lib/tenant/features.ts`.

### 6.3 `route-must-use-withTenant` (TODO Fase 3 cierre §11)

Aplazado en Fase 3 cierre. **Acción Fase 5**: implementar como complemento del refactor masivo. Verifica que cada `export const GET/POST/...` en `src/app/api/**` (excepto whitelist) está envuelto con `withTenant(...)`. La whitelist se mantiene en `eslint.config.mjs` y refleja la lista del proxy + new endpoints.

**Decisión**: incluir en Fase 5 (no Fase 3 retro). El refactor de §5 ya toca cada endpoint, así que añadir la regla detecta los olvidos.

---

## 7. Tests

### 7.1 Unit (`src/lib/tenant/features*.test.ts`)

Ya existen 21 tests de Fase 2 + 7 tests runtime de Fase 3. Añadir:

- **`hasFeature` con catalog stub** (existente — verificar cobertura).
- **`getLimit` con plan + addon (sumas)** (existente).
- **`consumeQuota` mock**: cubierto en `features.runtime.test.ts`. Añadir caso `period_unavailable`.

**Tests del orden de composición (enmienda 2 pre-implementación)** —
cierran posibilidad de invertir HOFs por error:

1. **`withFeature` aplicado fuera de `withTenant` lanza error
   descriptivo**:

   ```ts
   const handler = withFeature("api_access", mockHandler); // sin withTenant
   await expect(handler(req)).rejects.toThrow(
     /currentTenant is undefined.*falta withTenant/i,
   );
   ```

   Esto verifica que `hasFeature(key)` (que lee `currentTenant()`)
   lanza con mensaje útil cuando se invoca sin contexto, en lugar de
   un cryptic `Cannot read properties of undefined (reading 'features')`.

2. **Orden invertido `withQuota → withFeature` consume quota
   innecesariamente** (TEST DE REGRESIÓN):

   ```ts
   // Setup: tenant SIN export_csv en plan (booleana false).
   //        tenant_quota_usage con consumed=0.
   const handler = withTenant(
     withQuota("exports_mes", 1,
       withFeature("export_csv", mockHandler), // ← ORDEN INVERTIDO
     ),
   );
   const res = await handler(req);
   expect(res.status).toBe(402); // feature_required

   // CRÍTICO: consumed NO debe haber aumentado. Si aumentó, es bug
   // del orden invertido — el HOF de quota consumió antes de validar
   // feature.
   const row = await prismaMaster.tenantQuotaUsage.findFirst({...});
   expect(Number(row.consumed)).toBe(0);
   ```

   El test pasa solo si los HOFs respetan la semántica de "validar
   antes de consumir". Si en el futuro alguien cambia la implementación
   y el orden invertido empieza a consumir, este test lo detecta.

   Estos tests verifican que el orden recomendado en §2.1 es el correcto
   y que invertir falla con mensaje útil (no cryptic).

### 7.2 Integration de `consumeQuota` con concurrencia

`src/lib/tenant/quota-concurrency.integration.test.ts` (nuevo):

```ts
it("100 concurrent consume → exactamente max sucesos OK", async () => {
  // Setup: tenant_features con max=50 para "exports_mes".
  // Tenant_quota_usage con consumed=0, max=50, period actual.
  
  const promises = Array.from({ length: 100 }, () =>
    runWithTenant(ctx, () => consumeQuota("exports_mes", 1)),
  );
  const results = await Promise.all(promises);
  const oks = results.filter((r) => r.ok).length;
  const errs = results.filter((r) => !r.ok).length;
  expect(oks).toBe(50);
  expect(errs).toBe(50);
  
  // Verificar consumed exacto en BD.
  const row = await prismaMaster.tenantQuotaUsage.findFirst({...});
  expect(Number(row.consumed)).toBe(50);
});
```

Verifica que el UPDATE atómico de §2.5 (`consumed + n <= max`) soporta carrera real de 100 promises sin race.

### 7.3 E2E del `<FeatureGate>` con dos tenants

Setup: provisionar `tenant_starter` (sin `api_access`) y `tenant_enterprise` (con `api_access`).

```
GET /admin/api-tokens en tenant_starter → 200 con UpsellCTA ("Ver opciones")
GET /admin/api-tokens en tenant_enterprise → 200 con la página real (token list)
```

### 7.4 Test E2E del CORE (`registro_jornada_legal`)

Tenant Starter con TODAS las features booleanas a `false` (excepto las CORE). Debe poder:
- `POST /api/fichajes` → 201.
- `GET /api/fichajes?fecha=...` → 200.
- `GET /api/fichaje/registro-legal?desde=...&hasta=...` → 200 con XML/PDF.

### 7.5 `npm run test:feature-coverage`

Script en `scripts/test-feature-coverage.ts`:
- Lee el catálogo `prisma/seeds/master.ts` (32 features).
- Grep en `src/app/api/**` por `withFeature("KEY"` y `withQuota("KEY"`.
- Para cada feature de tipo `boolean` o `quota`: debe haber al menos un match.
- Para cada feature de tipo `limit`: debe aparecer en algún `getLimit("KEY")` (caso `max_employees`, `max_tiendas`, etc.).
- CI falla si una feature del catálogo NO aparece envuelta.

Excepciones declaradas: features CORE (`registro_jornada_legal`) — la regla `no-feature-gate-on-core` ya lo cubre.

---

## 8. Verificación que ADR-008 §5.1 se cumple

ADR-008 §5.1 exige:

> Verificar que `withFeature(key)` y `withQuota(key, n)` respetan `tenant.status='suspended'` y `'deleted'` (ADR-002 §2.4 ya devuelve 402 y 410 respectivamente).
>
> Sin impacto directo en Fase 5: las features solo se evalúan para tenants `active` (el proxy/HOF responden antes con 402/410 para los demás).

**Verificación a añadir en commit de tests**:

```ts
// Test de integración (puede ir en src/lib/tenant/with-tenant.test.ts existente):

it("withFeature NO se ejecuta si tenant está suspended (proxy ya rechazó)", async () => {
  // El proxy (Fase 3) responde 402 antes de llegar al handler.
  // withFeature nunca se invoca. Test E2E con tenant suspended.
});

it("withQuota NO se ejecuta si tenant está deleted", async () => {
  // El proxy responde 410 antes.
});
```

Estos tests verifican el contrato — no añaden lógica nueva. Si el proxy se modifica accidentalmente y deja pasar tenants suspended, los tests fallan.

---

## 9. Estructura de ficheros y commits

Estimación: **12-18 commits** en 5 bloques.

### 9.1 Bloque infraestructura HOFs (commits 1-4)

1. `feat(feature-guard): inventario en src/lib/feature-guard/coverage.ts (mapping endpoint→features)` — tabla declarativa que usa `test:feature-coverage`.
2. `feat(feature-guard): withFeature(key, handler) HOF + tests`.
3. `feat(feature-guard): withQuota(key, n, handler) HOF + tests` — incluye mapping period_unavailable/limit_reached → 429.
4. `feat(feature-guard): HttpError class + helper para responses estandarizadas (402/429)`.

### 9.2 Bloque UI components (commits 5-7)

5. `feat(components): <FeatureGate feature fallback> server component`.
6. `feat(components): <UpsellCTA feature> con link a /admin/configuracion/facturacion?upgrade=...`.
7. `feat(hooks): use-features.ts (client) + sessionStorage caché + invalidación`.

### 9.3 Bloque endpoint /api/me/features (commit 8)

8. `feat(api): GET /api/me/features con booleans + limits (current opt-in) + quotas`. Tests integration.

### 9.4 Bloque refactor de endpoints (commits 9-13)

9. `refactor(api/informes): withFeature(export_csv|excel|pdf) + withQuota(exports_mes)`.
10. `refactor(api/empleados): advisory lock + getLimit(max_employees) + 402 si limit_reached`.
11. `refactor(api/tiendas): getLimit(max_tiendas)`.
12. `refactor(api/fichajes): geofencing check con hasFeature("geofencing") en POST` (CORE-safe: solo modifica el comportamiento de validación lat/lon, no rechaza el fichaje en sí — RD 8/2019).
13. `refactor(api/v1, api/firmas, api/integraciones, api/analytics): withFeature por feature (api_access, firma_electronica, etc.)`.

### 9.5 Bloque UI refactor (commits 14-15)

14. `refactor(ui): envolver botones de export/api/firma con <FeatureGate>`.
15. `refactor(ui): mostrar uso vs límite en /admin/configuracion (max_employees, max_tiendas)`.

### 9.6 Bloque tests + lint + cierre (commits 16-18)

16. `feat(eslint): regla custom no-feature-gate-on-core + no-quota-writer-leak + route-must-use-withTenant`.
17. `test: feature-coverage + concurrency (100 promises) + CORE test (Starter sin export_csv puede fichar)`.
18. `docs(arch): cierre Fase 5 con criterios de §6 ADR-004 verificados`.

---

## 10. Puntos de revisión

Cinco paradas con reporte:

1. **Tras commit 4 (HOFs base)**: tests unit verde, tsc OK. Probar manualmente con un endpoint de prueba que devuelve 402 cuando feature está OFF.
2. **Tras commit 8 (`/api/me/features`)**: invocar el endpoint con `tenant_test1` (Stripe Starter desde Fase 4) y verificar shape JSON. Validar `current` opt-in solo para `max_employees` y `max_tiendas`.
3. **Tras commit 13 (refactor endpoints)**: cada feature del catálogo §11.4 cubierta. `npm run test:feature-coverage` verde.
4. **Tras commit 16 (lint custom)**: las 3 reglas (`no-feature-gate-on-core`, `no-quota-writer-leak`, `route-must-use-withTenant`) en CI.
5. **Tras commit 18 (cierre)**: 11+ criterios §6 ADR-004 verificados; suite tests verde; E2E con `tenant_test1` (api_access OFF) y `tenant_dev` (provisionado manualmente — features según seed).

---

## 11. Riesgos identificados

### 11.1 `consumeQuota` race en `prismaQuotaWriter`

ADR-004 §2.5 cierra la atomicidad con `WHERE consumed + n <= max RETURNING`. **Test §7.2** verifica empíricamente. Si falla (UPDATE no es atómico bajo carga real), considerar `SERIALIZABLE` isolation o lock advisory por feature.

### 11.2 Endpoint sin `withFeature`/`withQuota` (regresión)

`npm run test:feature-coverage` lo previene en CI. Pero el operador puede saltar el check en local. **Mitigación**: regla ESLint complementaria `route-must-use-withTenant` (incluye chequeo opcional vs `feature-guard/coverage.ts`).

### 11.3 `<FeatureGate>` server vs client divergencia

Si la versión client (`useFeatures()`) y la server divergen en su semántica (e.g. cache obsoleto cliente vs server actualizado), el render puede mostrar diferentes cosas según contexto. **Mitigación**: cliente invalida caché al cargar `/admin/configuracion/facturacion` (página donde se hacen los upgrades).

### 11.4 `max_storage_mb` sin `current` calculado

Limit declarado pero sin calcular `current` (Fase 9 cuando vista materializada). El usuario no ve cuánto storage le queda. **Mitigación**: documentar en UI ("Espacio: límite 5GB; consumo aproximado") + TODO explícito Fase 9.

### 11.5 Coexistencia con `tenant_test1` (Stripe Starter)

`test1` se aprovisionó en Fase 4 con plan Starter. Tras Fase 5, sus endpoints pueden empezar a devolver 402 si el seed inicial NO incluye todas las features Starter. **Mitigación**: verificar seed `prisma/seeds/master.ts` con catálogo §11.4 y los 32 features de Starter (24 booleans con valores específicos + 4 limits + 4 quotas).

### 11.6 Worker no consume quotas

ADR-001 §5.4: el worker (jobs cron Fase 4) puede invocar `sendEmail` (que es quota `emails_mes`). **Mitigación**: el worker NO invoca quotas — solo envía emails fuera de cuota (no son del tenant, son de operación super-admin: cleanup tenants, alerta provisioning stuck). Documentar en comment del worker.

---

## 12. Lo que NO se hace en Fase 5

- ❌ UI de configuración por tenant (Fase 6: branding, zona horaria, festivos).
- ❌ Panel super-admin (Fase 7; ADR-007 propuesto).
- ❌ `master.audit_log` materializado (Fase 7).
- ❌ Vista materializada para `max_storage_mb.current` (Fase 9).
- ❌ Cutover producción (Fase 8).
- ❌ E2E con Playwright (TODO consolidado — ver `00-todos-consolidados.md`).
- ❌ BullMQ + Redis (ADR-003: solo si Trigger A o B).
- ❌ Stripe Billing Portal `flow_data.subscription_update` con prefill del addon (Fase 9 enhancement; el link a `?upgrade=KEY` ya existe pero la página de facturación ignora el query param hoy).

---

## 13. Criterios de aceptación

Heredamos los criterios de **ADR-004 §6** (11 puntos) + 4 propios:

| # | Criterio |
|---|---|
| 1-11 | 11 criterios de §6 ADR-004 (tabla `tenant_quota_usage`, roles, helpers, etc.) |
| 12 | `npm test` + `test:integration` verdes (incluye concurrency test §7.2) |
| 13 | `tsc --noEmit` exit 0 + `npx eslint src/app/api` 0 violaciones |
| 14 | E2E con `tenant_test1` (Starter): respuesta `/api/me/features` con shape correcto. `<FeatureGate>` oculta export en plan inferior |
| 15 | `npm run test:feature-coverage` verde (32 features cubiertas con `withFeature`/`withQuota`/`getLimit`) |

---

## 14. Coexistencia con `tenant_dev` y `tenant_test1`

- **`tenant_dev`**: provisionado manualmente vía `npm run dev:seed-tenant`. Plan Starter. Tras Fase 5 verá 402 en endpoints como `/api/v1/*` si los implementamos. Para desarrollo, el operador puede:
  - Editar `master.tenant_features` directamente con SQL para activar features puntuales.
  - O ejecutar un nuevo `dev:seed-features <slug> <feature_key>` (CLI helper, opcional Fase 5).

- **`tenant_test1`**: provisionado vía Stripe Checkout Fase 4. Plan Starter real. Cuando el operador navegue a `/admin/api-tokens` verá `<UpsellCTA>` (api_access no incluido en Starter).

- **Test cycle**: cambiar de plan en `tenant_test1` se hace via Stripe Billing Portal (`/admin/configuracion/facturacion`), Stripe envía `customer.subscription.updated`, el handler de Fase 4 commit 9 recompone `tenant_features`.

---

## 15. Puntos a confirmar antes de empezar — RESPUESTAS DEL OPERADOR

Las 9 decisiones quedaron cerradas en aprobación del plan
(2026-05-01). Las respuestas vinculan la implementación.

### 15.1 ✅ Server por defecto + `<FeatureGateClient>` opt-in

**Decisión**: `<FeatureGate>` es **server component** (recomendado).
Se añade `<FeatureGateClient>` con hook `useFeatures()` como helper
opcional para casos cliente. **Implementar en commit 7**.

### 15.2 ✅ Opción B (FeatureGate inline). Opción A diferida

**Decisión**: por defecto se usa `<FeatureGate>` inline en el
componente con `<UpsellCTA>` como fallback. La página existe siempre
pero su contenido está bloqueado.

`withFeaturePage` (opción A) — helper para casos donde la URL no
debería existir — **NO se implementa en Fase 5**. Aplazado a futuro
si surge necesidad real.

### 15.3 ✅ `current` solo para `max_employees` y `max_tiendas`

**Decisión**: solo esos 2 limits llevan `current` calculado. Los
otros (`historial_meses`, `max_storage_mb`) se exponen sin
`current`; la UI muestra solo `max`. TODO Fase 9 con vista
materializada para storage (registrado en
`00-todos-consolidados.md` §9.2).

### 15.4 ✅ Worker no consume quotas (operativos del super-admin)

**Decisión**: los emails que envían los jobs cron del worker
(`cron:cleanup-pending-tenants`, `cron:detect-provisioning-stuck`,
`cron:notify-tenant-purge-imminent`) **NO consumen `emails_mes`**.
Son operativos del super-admin, no del tenant.

**Acción concreta**: documentar en `scripts/worker.ts` con un
comentario explícito:

```ts
// NOTA: los emails que envían los jobs cron son operativos del
// super-admin, NO del tenant. NO consumen quota emails_mes.
// Cualquier sendEmail() invocado desde estos handlers va al provider
// directamente (Resend o mock console) sin pasar por consumeQuota.
```

### 15.5 ✅ `test:feature-coverage` falla CI si feature no envuelta

**Decisión**: sí. El script `npm run test:feature-coverage` lee
las 32 features del catálogo §11.4 y verifica que cada una aparece
en al menos un `withFeature(...)` / `withQuota(...)` /
`getLimit(...)`. Si falta alguna → exit code != 0 → CI rojo.

Excepción declarada: `registro_jornada_legal` y CORE features de
§2.9 ADR-004 (la regla `no-feature-gate-on-core` lo cubre).

### 15.6 ✅ Orden inviolable: `withTenant → withFeature → withQuota → handler`

**Decisión**: este orden es OBLIGATORIO. Tests de la enmienda 2
(§7.1) verifican que invertir falla con mensaje útil y que orden
invertido `withQuota → withFeature` consume quota indebidamente
(test de regresión).

### 15.7 ✅ `dev:seed-tenant` con plan `enterprise` por defecto

**Decisión**: cambiar `scripts/dev-seed-tenant.ts` para asignar plan
**`enterprise`** al tenant `dev` (todas las features activas). Razón:
desarrollo no debe tener rozamiento.

`tenant_test1` (Stripe Starter desde Fase 4) cubre el caso "cliente
real con plan limitado" para tests visuales del FeatureGate /
UpsellCTA.

**Acción concreta**: editar línea 41 de `scripts/dev-seed-tenant.ts`:

```ts
// ANTES:  const DEV_PLAN = "starter";
// DESPUÉS: const DEV_PLAN = "enterprise";
```

Quien quiera testear con plan limitado en dev: usar `tenant_test1`
o crear un segundo tenant manual.

### 15.8 ✅ Reglas ESLint separadas

**Decisión**: dos reglas custom independientes:

- `route-must-use-withTenant`: aplica a TODOS los handlers en
  `src/app/api/**` (excepto whitelist `/api/auth`, `/api/webhooks`,
  `/api/admin`, `/api/onboarding`).
- `route-must-use-withFeature`: aplica solo a handlers listados en
  `src/lib/feature-guard/coverage.ts`. Verifica que tienen
  `withFeature` o `withQuota`.

Más simples de mantener (cada regla con un único objetivo).

### 15.9 ✅ `pg_advisory_xact_lock` con `app_role`: verificar empíricamente

**Decisión**: postgres default permite `pg_advisory_xact_lock` a
cualquier rol con CONNECT. Verificar empíricamente al inicio del
**bloque commit 10** (max_employees + advisory lock).

Si NO funciona: alternativas declaradas en orden de preferencia:

1. `SERIALIZABLE` isolation level en la transacción.
2. `SELECT ... FOR UPDATE` sobre una fila sentinela en
   `master.tenants` (tenta de bloqueo cross-schema).
3. GRANT EXECUTE ON FUNCTION `pg_advisory_xact_lock` a `app_role`
   (manual, requiere superuser una sola vez).

Verificación: query de smoke al inicio del commit 10:

```sql
-- Como app_role
SELECT pg_advisory_xact_lock(hashtextextended('test', 0));
-- Si lanza: error de permisos → activar plan B/C/D.
```

---

---

## 16. Resumen ejecutivo

- **12-18 commits** en 6 bloques: HOFs → UI → endpoint /api/me/features → refactor endpoints → refactor UI → lint+tests+cierre.
- ADR-004 cierra el qué; este plan cierra el cómo.
- Composabilidad estricta: `withTenant → withFeature → withQuota → handler`.
- `<FeatureGate>` server component lee `currentTenant().features`. UpsellCTA con link a billing portal.
- `/api/me/features` con `current` opt-in solo para `max_employees`/`max_tiendas`.
- 3 reglas ESLint custom: `no-feature-gate-on-core`, `no-quota-writer-leak`, `route-must-use-withTenant`.
- `npm run test:feature-coverage` falla CI si una feature del catálogo no está envuelta.
- ADR-008 §5.1 se cumple: HOFs se ejecutan solo para `active` (proxy ya rechaza suspended/deleted).
- 9 puntos a confirmar en §15 antes de arrancar el commit 1.
