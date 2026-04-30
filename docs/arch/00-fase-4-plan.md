# Plan de Fase 4 — Onboarding Stripe + webhooks

- **Estado**: PROPUESTO (pendiente de aprobación antes de tocar código)
- **Fecha**: 2026-04-30
- **Spec maestra**: [`../specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md), apartado "Fase 4 — Onboarding y auth"
- **ADR de referencia**: [`adr-003-billing-y-suscripciones.md`](./adr-003-billing-y-suscripciones.md) (es el ADR de esta fase)
- **Otros ADRs aplicables**: 001 (§5.4 worker dual-rol), 002 (§2.4 estados, §3.5 enmienda 6 whitelist), 005 (§2.3.b vars Stripe)
- **Estado heredado**: `feature/saas-migration` con Fase 3 cerrada (riesgo §11.3 resuelto, [00-fase-3-cierre.md](./00-fase-3-cierre.md)). Container `fichaje_postgres` (5433) levantado, `tenant_dev` provisionado.

## 0. Objetivo

Sustituir el flow legacy `/api/setup` por **registro real con Stripe**:

1. Página de registro pública (`app.localhost/registro` en dev,
   `app.ficha.tecnocloud.es/registro` en producción) con selección de plan,
   captura de datos del tenant y redirect a Stripe Checkout.
2. Webhook `/api/webhooks/stripe` que recibe los eventos, verifica firma,
   garantiza idempotencia y ejecuta la coreografía PENDING → PROVISIONING
   → ACTIVE.
3. Página `/configuracion/facturacion` (subdominio del tenant) que abre
   el Stripe Billing Portal del tenant (autoservicio: cambiar plan,
   actualizar tarjeta, cancelar).
4. Jobs programados de cleanup: PENDING > 24h → DELETE; PROVISIONING > 10 min
   → reintento o alerta super-admin.
5. Eliminación del legacy `/api/setup` y `/api/setup/reset`.

Fuera del alcance: panel super-admin completo (Fase 7), despliegue producción (Fase 8), TLS por tenant (Fase 8), feature flags en uso productivo (Fase 5).

ADR-003 cierra el qué-decir-y-por-qué; este plan cierra el cómo-y-en-qué-orden.

---

## 1. Decisiones ya cerradas en ADR-003 (recapitulación)

Para que el plan sea autocontenido sin reescribir el ADR:

- **Modelo Stripe** (§2.1): 1 Customer por tenant + 1 Subscription con N items (1 plan + N addons), no N subscriptions.
- **Tablas master** (§2.2): `subscriptions`, `subscription_items`, `stripe_events`, `tenant_features`. Ya creadas en Fase 2.
- **Eventos procesados** (§2.3.a): 9 eventos en lista blanca. El resto se registran sin side-effect (§2.3.b).
- **Endpoint webhook** (§2.3.c): `POST /api/webhooks/stripe`, sin auth NextAuth, sin `withTenant`. Tenant resuelto desde `event.data.object.customer` → lookup `stripe_customer_id`.
- **Idempotencia** (§2.4): INSERT en `stripe_events` con `ON CONFLICT (event_id) DO NOTHING RETURNING`. Si gana CONFLICT, devolver 200 sin reentrar.
- **Verificación de firma** (§2.5): `req.text()` raw + `stripe.webhooks.constructEvent`. `STRIPE_WEBHOOK_SECRET` distinto por entorno.
- **Coreografía** (§2.6): 4 pasos atómicos en orden estricto (CREATE SCHEMA → GRANTs → migraciones del producto → primer OWNER en `prismaApp`).
- **Trial** (§2.7): 14 días con tarjeta upfront. Reversible por env `STRIPE_TRIAL_REQUIRES_CARD=true`.
- **Worker dual-rol** (ADR-001 §5.4): `prismaMaster` + `prismaApp`. NO `prismaRuntime` ni `prismaQuotaWriter` aquí.
- **Procesamiento síncrono** dentro del handler hasta cumplir Trigger A (p50 > 10s, 7 días) o Trigger B (>3 errors/semana). Cuando se cumpla, mover a BullMQ (no antes — §5.2 ADR-003).

---

## 2. Flow de registro

### 2.1 Páginas necesarias en el subdominio `app`

| Ruta                                | Tipo                  | Función                                                                              |
|-------------------------------------|-----------------------|---------------------------------------------------------------------------------------|
| `app/(public)/registro/page.tsx`    | Server component      | Formulario: plan, nombre empresa, email OWNER, slug. Al submit → server action.      |
| `app/(public)/registro/exito/page.tsx` | Server component   | Página tras Checkout exitoso. Muestra "Estamos preparando tu cuenta". URL final: `<slug>.localhost:3000/login` (o producción equivalente). Recibe `?session_id=...` |
| `app/(public)/registro/cancelado/page.tsx` | Server component | Cancelación voluntaria del Checkout. CTA volver a /registro.                          |

Server action `registrarTenantAction(formData)`:
1. Parse + validar (zod):
   - `nombre`: string 2-80.
   - `email`: email RFC 5322.
   - `slug`: regex `^[a-z][a-z0-9_]{2,30}$` (igual que `quoteSchemaName`).
   - `planKey`: enum `starter | pro | enterprise`.
   - `billingPeriod`: enum `monthly | yearly`.
2. Verificar `slug` no en `master.reserved_slugs` ni ya existe en `master.tenants`. Si choca → error de formulario.
3. **Insertar con `prismaMaster`**: `prismaMaster.tenant.create({ data: { slug, name, email, status: 'pending' } })`. La server action de `/registro` corre en el subdominio `app` (no es endpoint de tenant), por lo que **NO se envuelve con `withTenant`** y **NO usa `prismaApp`**. Cualquier acceso a BD desde aquí es a `master.*` vía `prismaMaster`. Si la constraint UNIQUE(slug) lanza P2002 → error de formulario con sugerencias (§15.10). **Sin schema `tenant_<slug>` todavía** — eso lo crea la coreografía tras `checkout.session.completed`.

> **Convención (enmienda 1 pre-implementación)**: las server actions del
> subdominio `app` (registro, futuro checkout, futuro webhook callback)
> usan `prismaMaster`, **NO `prismaApp`**. `prismaApp` solo funciona
> dentro de `runWithTenant` aplicado por `withTenant`, y el subdominio
> `app` no tiene tenant en contexto. Esta convención queda documentada
> también en `AGENTS.md` (sección "server actions").
4. `stripe.checkout.sessions.create({...})` con:
   - `mode: "subscription"`.
   - `line_items`: `[{ price: STRIPE_PRICE_<PLAN>_<PERIOD>, quantity: 1 }]`.
   - `client_reference_id: tenants.id` (resuelve el tenant en webhook).
   - `metadata: { tenant_id, tenant_slug }` (auditoría).
   - `subscription_data.metadata: { tenant_id, tenant_slug }`.
   - `subscription_data.trial_period_days: STRIPE_TRIAL_DAYS` (si `STRIPE_TRIAL_REQUIRES_CARD=true`).
   - `customer_creation: "always"` (Stripe crea el Customer en este checkout).
   - `customer_email: email` (pre-rellena el campo).
   - `success_url: STRIPE_CHECKOUT_SUCCESS_URL`.
   - `cancel_url: STRIPE_CHECKOUT_CANCEL_URL`.
5. `redirect(session.url!)` → el navegador del usuario va a Stripe Checkout.

### 2.2 Validación de slug — race condition

Entre el paso 2 (verificación) y el paso 3 (INSERT) puede colarse otro registro. Mitigación: el INSERT confía en la **constraint UNIQUE (slug)** de `master.tenants`. Si lanza `P2002` (Prisma) → error de formulario "ese subdominio acaba de ocuparse, elige otro". Sin lock pesimista.

### 2.3 UI: librería de componentes

Reutilizar los `@radix-ui/*` ya presentes en `package.json`. No introducir Stripe Elements en `/registro` — el Checkout se hace fuera (página alojada por Stripe). Eso simplifica auth/PCI scope a coste de ~1 click extra.

---

## 3. Webhook `/api/webhooks/stripe`

### 3.1 Router

`src/app/api/webhooks/stripe/route.ts` con `export async function POST(req)`.
**Sin `withTenant`** (whitelist ADR-002 §3.5 enmienda 6 ya documentada). Sin `auth()`. Tenant se resuelve internamente.

### 3.2 Estructura del handler (transcripción del ADR-003 §2.5 + §2.4)

```ts
import Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { recordEventOrSkip } from "@/lib/stripe/idempotency";
import { dispatchEvent } from "@/lib/stripe/dispatch";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const body = await req.text(); // RAW, NO json()
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body, sig, process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const fresh = await recordEventOrSkip(event); // INSERT ON CONFLICT
  if (!fresh) return new Response(null, { status: 200 }); // replay

  try {
    await dispatchEvent(event);
    await markProcessed(event.id);
    return new Response(null, { status: 200 });
  } catch (err) {
    await markErrored(event.id, err);
    throw err; // 500 → Stripe reintenta
  }
}
```

### 3.3 Módulos a crear

```
src/lib/stripe/
├── client.ts              # singleton stripe = new Stripe(SECRET, { apiVersion })
├── idempotency.ts         # recordEventOrSkip, markProcessed, markErrored
├── dispatch.ts            # switch sobre event.type → handler concreto
├── handlers/
│   ├── checkout-session-completed.ts
│   ├── customer-subscription-updated.ts
│   ├── customer-subscription-deleted.ts
│   ├── customer-subscription-paused.ts
│   ├── customer-subscription-resumed.ts
│   ├── customer-subscription-trial-will-end.ts
│   ├── invoice-payment-succeeded.ts
│   ├── invoice-payment-failed.ts
│   └── checkout-session-expired.ts
├── feature-resolver.ts    # recompose tenant_features desde subscription items + addons
└── price-catalog.ts       # mapping Stripe price ID → { planKey, billingPeriod, addonKey }
```

`dispatch.ts`:

```ts
export async function dispatchEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":      return handleCheckoutCompleted(event);
    case "customer.subscription.updated":    return handleSubscriptionUpdated(event);
    case "customer.subscription.deleted":    return handleSubscriptionDeleted(event);
    case "customer.subscription.paused":     return handleSubscriptionPaused(event);
    case "customer.subscription.resumed":    return handleSubscriptionResumed(event);
    case "customer.subscription.trial_will_end": return handleTrialWillEnd(event);
    case "invoice.payment_succeeded":       return handlePaymentSucceeded(event);
    case "invoice.payment_failed":          return handlePaymentFailed(event);
    case "checkout.session.expired":        return handleCheckoutExpired(event);
    default: return; // §2.3.b: ignorado intencional
  }
}
```

### 3.4 Mapping de eventos → comportamiento (resumen del ADR-003 §2.3.a)

| Evento                                  | Acción master                                             | Acción tenant                                      |
|------------------------------------------|------------------------------------------------------------|----------------------------------------------------|
| `checkout.session.completed`             | PENDING → PROVISIONING → ACTIVE; insertar subscription + items + features | Crear schema + GRANTs + migrar + crear primer OWNER |
| `customer.subscription.updated`          | Sync subscriptions + items; recalcular tenant_features    | Ninguna (efecto en siguiente request)              |
| `customer.subscription.deleted`          | sub.status='canceled'; tenant.status=SUSPENDED; vaciar features (excepto manual_override) | Ninguna; datos persisten           |
| `customer.subscription.paused/resumed`   | Sync. paused → SUSPENDED                                  | Ninguna                                             |
| `customer.subscription.trial_will_end`   | Email aviso 3 días antes                                  | Ninguna                                             |
| `invoice.payment_succeeded`              | Si era past_due → tenant ACTIVE                           | Ninguna                                             |
| `invoice.payment_failed`                 | sub.status=past_due; email OWNER. Sin suspender (dunning Stripe) | Ninguna                                             |
| `checkout.session.expired`               | Solo log (cleanup lo hace job horario)                    | Ninguna                                             |

Lo demás (charges, customers no-subscription, payment_methods, payouts, prices, products, radar, reviews, disputes) se registra con `processed_at = NULL` sin side-effect (§2.3.b).

---

## 4. Coreografía de provisión

Dispara `handleCheckoutCompleted`. Pasos transcritos del ADR-003 §2.6:

```ts
async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const tenantId = session.client_reference_id; // viene de §2.1 paso 4
  if (!tenantId) throw new Error("client_reference_id ausente");

  // 1. Lookup en master.tenants — SELECT FOR UPDATE para evitar race con
  //    re-entrega de Stripe.
  const tenant = await prismaMaster.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`tenant ${tenantId} no existe`);

  // 2. Status no-procesable → 200 sin más.
  if (tenant.status === "active" || tenant.status === "suspended") return;
  if (tenant.status === "provisioning") return; // otra ejecución en curso

  // 3. PENDING → PROVISIONING (UPDATE condicional).
  const claimed = await prismaMaster.tenant.updateMany({
    where: { id: tenantId, status: "pending" },
    data: { status: "provisioning", updatedAt: new Date() },
  });
  if (claimed.count === 0) return; // otra ejecución la cogió

  // 4. Persistir Stripe Customer.
  await prismaMaster.tenant.update({
    where: { id: tenantId },
    data: { stripeCustomerId: session.customer as string },
  });

  // 5. Recuperar subscription completa con la API.
  const subscription = await stripe.subscriptions.retrieve(
    session.subscription as string,
    { expand: ["items.data.price"] },
  );

  // 6. INSERT subscriptions + subscription_items.
  await persistSubscription(tenant.id, subscription);

  // 7. Recomponer tenant_features (plan + addons).
  await recomposeTenantFeatures(tenant.id, subscription);

  // 8. Coreografía SQL (orden estricto).
  await provisionTenantSchema(tenant.slug); // wraps tenants:provision logic

  // 9. Primer OWNER en el schema del tenant.
  await runWithTenant(/* ctx tenant */, async () => {
    await prismaApp.user.create({
      data: {
        email: tenant.email,
        nombre: ..., apellidos: ..., rol: "OWNER",
        // password: NULL — se setea por email de bienvenida con setResetToken.
      },
    });
  });

  // 10. PROVISIONING → ACTIVE (UPDATE condicional).
  await prismaMaster.tenant.updateMany({
    where: { id: tenantId, status: "provisioning" },
    data: { status: "active" },
  });

  // 11. Email de bienvenida con set-password link.
  await sendBienvenidaEmail(tenant);
}
```

**Idempotencia interna**: cada paso 3, 6, 7, 8, 9, 10 es UPSERT/UPDATE condicional. Si el handler se reentrega (Stripe retry) entre pasos, los UPDATE con `WHERE status=...` filtran. El INSERT idempotente del envoltorio (§3.2) es la primera barrera; estos `WHERE status` son la segunda.

**Reuso de código de Fase 3**: `provisionTenantSchema(slug)` se extrae del actual `scripts/tenants-provision.ts` a un módulo `src/lib/tenant/provision.ts` para que webhook handler y CLI lo compartan. Idempotente: si el schema ya existe, no falla.

### 4.1 El primer OWNER no tiene password

Por seguridad, el primer OWNER se crea con `password = NULL` y un `resetToken` de un solo uso. El email de bienvenida lleva `https://<slug>.localhost:3000/set-password?token=...`. El usuario establece su password antes del primer login. Ya hay endpoint `/api/auth/set-password` (Fase 0) que se reaprovecha (refactorizado en Fase 3 con withTenant).

### 4.2 Email de bienvenida

`src/lib/email-templates/bienvenida.ts` con HTML simple. Resend ya configurado en `.env` (vacío en local; en local se logguea por consola via `RESEND_API_KEY=""` → fallback). Decisión a confirmar (§11): ¿enviar real con cuenta de test de Resend o solo log a consola en dev?

---

## 5. Jobs programados

ADR-003 §5.2 los pide. Dos jobs:

### 5.1 `cron:cleanup-pending-tenants` — cada hora

```sql
DELETE FROM master.tenants
 WHERE status = 'pending' AND created_at < now() - interval '24 hours';
```

El slug queda libre. `checkout.session.expired` también se registra (§2.3.a) pero no dispara DELETE (la lógica vive solo aquí).

### 5.2 `cron:detect-provisioning-stuck` — cada 5 minutos

```sql
SELECT id, slug FROM master.tenants
 WHERE status = 'provisioning' AND updated_at < now() - interval '10 minutes';
```

Para cada uno:
- Contar reintentos previos en `stripe_events.processing_error` para ese `subscription_id`.
- Si <3 → re-encolar la coreografía (re-ejecuta `handleCheckoutCompleted` idempotentemente).
- Si ≥3 → email super-admin + log `audit_log` con `severity='critical'`. El tenant se queda en `provisioning` hasta intervención manual.

### 5.3 Implementación

`node-cron` ya en `package.json` (no, no está — añadir). Alternativa: `node-schedule`. Decisión técnica simple: **`node-cron`**.

Worker proceso separado: `npm run worker` que importa los jobs y los registra. En desarrollo: `concurrently` corre `dev` + `worker` en paralelo. En producción Fase 8: dos servicios Dokploy (app y worker) compartiendo `.env` (ADR-005).

**Decisión a confirmar (§11)**: ¿desde día 1 con `node-cron` o stub que solo registra en `master.audit_log` "TODO Fase 4 final"?

---

## 6. Stripe Billing Portal — `/configuracion/facturacion`

Página `app/(dashboard)/configuracion/facturacion/page.tsx` (subdominio del tenant). Solo OWNER:

```tsx
export default async function Page() {
  const session = await auth();
  if (session?.user?.rol !== "OWNER") return forbidden();

  const tenant = currentTenant();
  // Lookup stripe_customer_id en master.
  const t = await prismaMaster.tenant.findUnique({
    where: { id: tenant.tenantId },
    select: { stripeCustomerId: true },
  });
  if (!t?.stripeCustomerId) return errorPage("Sin Stripe customer");

  const portal = await stripe.billingPortal.sessions.create({
    customer: t.stripeCustomerId,
    return_url: `${process.env.STRIPE_PORTAL_RETURN_URL}`.replace("<slug>", tenant.slug),
  });
  redirect(portal.url);
}
```

Stripe gestiona: actualizar tarjeta, cambiar plan, cancelar, ver facturas. Cada cambio dispara `customer.subscription.updated` que el webhook procesa.

---

## 7. Eliminación legacy `/api/setup` y `/api/setup/reset`

Plan: eliminarlos en el ÚLTIMO commit de Fase 4 cuando el flow Stripe esté verde end-to-end. Archivos:

- `src/app/api/setup/route.ts`.
- `src/app/api/setup/reset/route.ts`.
- `src/app/(public)/setup/**` si existe (página).
- Referencias en `src/proxy.ts` (`isSetupPage`).
- Whitelist ESLint (`/api/setup/`) en `eslint.config.mjs`.

Verificación post-eliminación:
- `grep -rln "/api/setup" src/` → 0 resultados.
- `npm test` + `test:integration` verde.
- E2E del flow Stripe completo verde.

---

## 8. Manejo de errores explícito

### 8.1 Pago rechazado en Checkout

Stripe redirige a `cancel_url` → `/registro/cancelado`. El tenant en `master.tenants` queda PENDING. El job §5.1 lo borra a las 24h.

### 8.2 Webhook que llega antes del callback de éxito

Stripe puede entregar `checkout.session.completed` ANTES de que el navegador del usuario llegue a `success_url`. Eso es la norma, no la excepción. La lógica:
- El webhook ejecuta la coreografía.
- Cuando el usuario llega a `/registro/exito`, la página hace polling (`useSWR` con interval 2s) a `GET /api/onboarding/status?session_id=...` que devuelve `{ status: 'pending' | 'provisioning' | 'active' }`.
- Cuando llega `active`, redirect a `<slug>.localhost:3000/login`.

### 8.3 Slug taken race condition

Documentado en §2.2.

### 8.4 `checkout.session.completed` sin tenant en master

Sucede si alguien apunta su Stripe webhook a nuestro endpoint con un evento de otra cuenta. La firma falla → 400. Defensa adicional: si la firma pasa pero el `client_reference_id` no resuelve a un tenant, log + 200 (no reintentar — no es un bug nuestro).

### 8.5 Coreografía falla a mitad

ADR-003 §2.6 lo cierra: tenant queda en PROVISIONING + `processing_error` en `stripe_events`. Job §5.2 reintenta. Después de 3 intentos, alerta super-admin.

### 8.6 Stripe CLI vs Stripe real (desarrollo)

`stripe listen --forward-to localhost:3000/api/webhooks/stripe` emite un secret efímero. En `.env` local el desarrollador setea ese secret. La verificación de firma usa el secret de la sesión actual de la CLI. Documentar en CLAUDE.md/AGENTS.md.

---

## 9. Estructura de ficheros y commits

Estimación: **18-22 commits** en 5 bloques.

### 9.1 Bloque infraestructura Stripe (commits 1-4)

1. `feat(stripe): cliente singleton + price catalog`
   - `src/lib/stripe/client.ts` con `new Stripe(secret, { apiVersion })`.
   - `src/lib/stripe/price-catalog.ts` mapping Stripe price IDs ↔ planKey/period/addonKey.
2. `feat(stripe): idempotency layer (recordEventOrSkip + markProcessed)`
   - Reusa `master.stripe_events`.
3. `feat(stripe): module dispatch.ts con switch + stubs de los 9 handlers`
   - Cada handler tira `throw new Error("Pendiente commit X")` para que dispatch compile.
4. `feat(api): /api/webhooks/stripe con firma + idempotencia + dispatch`
   - El endpoint completo. Cada handler pendiente lanza, pero el shape del endpoint pasa firma + idempotencia.

### 9.2 Bloque coreografía (commits 5-8)

5. `refactor(tenant): extraer provisionTenantSchema de scripts a src/lib/tenant/provision.ts`
   - Reusable desde CLI y webhook.
6. `feat(stripe): handleCheckoutCompleted — coreografía PENDING→PROVISIONING→ACTIVE`
   - Llama provisionTenantSchema + crea primer OWNER + marca ACTIVE.
7. `feat(stripe): persistSubscription + recomposeTenantFeatures`
   - Lee subscription items, mapea con price catalog, calcula features (plan + addons) según ADR-003 §2.9.
8. `feat(email): bienvenida con setResetToken para primer OWNER`
   - Template + envío. En dev sin RESEND_API_KEY → log a consola.

### 9.3 Bloque eventos restantes (commits 9-13)

9. `feat(stripe): handleSubscriptionUpdated`
10. `feat(stripe): handleSubscriptionDeleted (vacía features, mantiene manual_override)`
11. `feat(stripe): handlePaymentSucceeded + handlePaymentFailed`
12. `feat(stripe): handleSubscriptionPaused/Resumed/TrialWillEnd/CheckoutExpired`
13. `test(stripe): integration con Stripe en modo test (constructEvent + dispatch)`
   - Testcontainers Postgres + Stripe API en mode test (NO live).
   - **Enmienda 3 pre-implementación**: los tests usan
     `stripe.webhooks.constructEvent` REAL contra un
     `STRIPE_WEBHOOK_SECRET` de test conocido (p. ej.
     `whsec_test_dummy_secret_for_unit_tests` en `.env.test`). Los
     payloads se firman con
     `stripe.webhooks.generateTestHeaderString({ payload, secret })` para
     producir el header `stripe-signature` válido. Esto verifica que la
     verificación de firma funciona end-to-end. **NO mockear
     `constructEvent` ni la verificación de firma** — mockearla
     invalida el test de seguridad más importante del webhook (un
     atacante con curl + payload arbitrario podría suplantar Stripe).
   - El `STRIPE_WEBHOOK_SECRET` de tests se aísla del de Stripe CLI
     local (que el desarrollador setea en `.env`).

### 9.4 Bloque UI registro (commits 14-16)

14. `feat(registro): página /registro con formulario + zod`
   - Bajo subdominio app (proxy.ts ya enruta).
15. `feat(registro): server action con stripe.checkout.sessions.create`
16. `feat(registro): páginas /registro/exito (polling) + /registro/cancelado`

### 9.5 Bloque billing portal (commit 17)

17. `feat(facturacion): página /configuracion/facturacion solo OWNER`

### 9.6 Bloque jobs (commits 18-19)

18. `feat(worker): cron node-cron + scripts/worker.ts entry point`
19. `feat(worker): cleanup-pending-tenants + detect-provisioning-stuck`

### 9.7 Bloque cierre (commits 20-22)

20. `feat(api): /api/onboarding/status para polling de /registro/exito`
21. `chore(legacy): eliminar /api/setup, /api/setup/reset, página /setup`
   - Whitelist ESLint actualizada.
22. `docs(arch): cierre Fase 4 con criterios de §6 ADR-003 verificados`

---

## 10. Puntos de revisión

Cinco paradas con reporte:

1. **Tras commit 4 (webhook con firma + idempotencia)**: con `stripe trigger checkout.session.completed --add tenant_id=...` → registro en `master.stripe_events` correcto. Replay → `processed_at` no se duplica.
2. **Tras commit 8 (coreografía completa)**: registro real desde `/registro` → checkout en modo test → webhook → tenant_<slug> creado, OWNER con resetToken, email logueado en consola. **Verificación empírica obligatoria del cliente Prisma multiplexado (enmienda 2 pre-implementación)**: tras `provisionTenantSchema(slug)`, el cliente Prisma cacheado en `globalThis._tenantClients` debe abrir correctamente el schema recién creado en su primera conexión. Test:
   1. Limpiar `globalThis._tenantClients` antes de la coreografía (asegurar que el cliente para ese slug no existe en cache).
   2. Ejecutar coreografía completa para un `tenant_test_<random>` recién creado.
   3. Confirmar que el paso 9 (`prismaApp.user.create` dentro de `runWithTenant`) no falla con `schema "tenant_test_<random>" does not exist` ni con `permission denied`.
   4. Si falla, **paro y reporto**. Posible mitigación: invalidar la entrada del Map para el slug recién provisionado antes del paso 9 (`globalThis._tenantClients?.delete(slug)`), o forzar reconexión del pool del adapter.
   Esto bloquea avance a commit 9 — equivalente a parada §11.3 de Fase 3.
3. **Tras commit 13 (eventos restantes + tests)**: Stripe CLI con `trigger` para cada uno de los 9 eventos; verificar side-effects en master con SQL directo.
4. **Tras commit 19 (jobs)**: provocar PENDING > 24h y PROVISIONING > 10 min en BD; verificar que los jobs los recogen.
5. **Tras commit 22 (cierre)**: 11 criterios §6 ADR-003 todos verde + suite tests + lint + tsc + e2e con `next dev` + `dev.localhost`.

---

## 11. Riesgos identificados

### 11.1 Webhook llega antes del callback de éxito

Mitigado con polling en `/registro/exito` (§8.2). Riesgo bajo.

### 11.2 Slug race condition

Mitigado con UNIQUE constraint y reintento del usuario (§8.3). Riesgo bajo.

### 11.3 Stripe products/prices manuales en dashboard

Cada vez que se cambien planes o precios, hay que actualizar 6+ env vars (`STRIPE_PRICE_*`). Si alguien añade un price y olvida añadirlo a `price-catalog.ts`, el webhook ignora addons silenciosamente. **Mitigación**: tests de smoke que comparan `price-catalog.ts` con la lista de envs necesarias y rompen si falta alguna. Documentar en runbook (Fase 8).

### 11.4 Coreografía síncrona dentro del handler timeout

Stripe espera 200 en ≤30s. La coreografía toca BD ~6 veces + crea schema (~2-3s en local). En producción con red lenta podría aproximar 30s. **Mitigación**: medir `received_at → processed_at` en `master.stripe_events`. Trigger A (p50 > 10s, 7 días) → mover a BullMQ. Hasta entonces, síncrono.

### 11.5 Desarrollo local con Stripe CLI

`stripe listen` requiere autenticación previa (`stripe login`). Cada desarrollador necesita su Stripe test account. Documentado en CLAUDE.md/AGENTS.md.

### 11.6 SET search_path eliminado pero `provisionTenantSchema` tiene que SET para crear tablas

`provisionTenantSchema` ejecuta SQL directo con `pg.Client` (no Prisma) — el `SET search_path` ahí es legítimo, no afecta a queries Prisma del producto. Lo reusamos del Fase 3.

---

## 12. Lo que NO se hace en Fase 4

- ❌ Panel super-admin (Fase 7).
- ❌ Despliegue producción Dokploy (Fase 8).
- ❌ TLS por tenant (Fase 8 cuando se migre a opción B; ahora opción A wildcard).
- ❌ Feature flags productivos (Fase 5: `withFeature`/`withQuota` HOFs, `<FeatureGate>` UI).
- ❌ ADR-007 panel super-admin auth.
- ❌ ADR-008 lifecycle SUSPENDED → DELETED (preguntas abiertas, ver ADR-003 §5.5).
- ❌ Internacionalización del email de bienvenida (sólo castellano).
- ❌ Múltiples métodos de pago (solo tarjeta de Stripe Checkout).
- ❌ Facturación manual fuera de Stripe.
- ❌ BullMQ + Redis (a meter solo si trigger A o B se cumple).

---

## 13. Criterios de aceptación

Heredamos los 11 criterios de §6 ADR-003 + 4 propios:

| #   | Criterio                                                                                   |
|-----|---------------------------------------------------------------------------------------------|
| 1-11 | Los 11 criterios de §6 ADR-003 (firma, idempotencia, coreografía completa, etc.).        |
| 12  | `npm test` + `test:integration` verdes (incluye nuevos tests de Stripe en mode test).     |
| 13  | `tsc --noEmit` exit 0 + `npx eslint src/app/api` 0 violaciones.                            |
| 14  | E2E manual: registro completo desde `app.localhost/registro` → Stripe Checkout (test mode) → webhook → `<slug>.localhost/login` → set-password → login OK. |
| 15  | `/api/setup` y `/api/setup/reset` eliminados; grep en repo → 0 resultados.                |

---

## 14. Coexistencia con Fase 3 actual

El tenant `dev` provisionado en Fase 3 (con OWNER `admin@dev.local` sin Stripe) seguirá funcionando porque la coreografía de provisión solo se dispara desde `checkout.session.completed`. Tenant `dev` queda como tenant "manual" sin subscription en Stripe — útil para desarrollo. En producción Fase 8 cutover, el cliente actual también será un tenant "manual" sin Stripe customer hasta que decida pagar.

Implicación: el script `dev:seed-tenant` se mantiene tal cual. NO interfiere con el flow Stripe.

---

## 15. Puntos a confirmar antes de empezar

Igual que §15 de Fase 3. Cosas no cubiertas por ADRs o que merecen confirmación explícita:

### 15.1 Configuración Stripe dashboard — ¿manual o vía API?

Para arrancar Fase 4 hace falta que existan en Stripe:
- 3 products: Starter, Pro, Enterprise.
- 6 prices: cada plan × {monthly, yearly}.
- 7 prices addon: dominio_personalizado, api_access, integraciones_nomina, firma_electronica, people_analytics, storage_extra, emails_extra.
- 1 webhook endpoint: en local apunta a Stripe CLI; en producción a `https://app.ficha.tecnocloud.es/api/webhooks/stripe`.

**Opciones**:
- (A) Manual en dashboard de Stripe modo test. Tú creas, copias los IDs a `.env`.
- (B) Script `npm run stripe:bootstrap` que crea productos+prices vía API y emite los IDs. Ventaja: reproducible. Contra: si lo ejecutas dos veces sin idempotencia → duplicados.
- (C) Híbrido: script idempotente que `upsert` por nombre/key.

**Recomendación**: (C). Inversión inicial ~50 líneas que ahorra problemas. Confirmar.

### 15.2 Trial — `STRIPE_TRIAL_REQUIRES_CARD=true` o `false` por defecto en Fase 4

ADR-003 §2.7 pone default `true`. Confirmar.

### 15.3 Worker — ¿desde día 1 con `node-cron` o stub que loggea y aplaza?

Mi recomendación: desde día 1. El cleanup PENDING > 24h y la detección de PROVISIONING > 10 min son críticas para no acumular basura en master. Sin worker, el primer registro fallido contamina la BD. Confirmar.

### 15.4 Email de bienvenida — Resend real o log consola en dev

Resend gratis hasta 3000 emails/mes. Si tienes cuenta de test, podemos usarla. Si no, fallback a log consola en dev (`console.log("[email mock] enviado a X")`).

**Recomendación**: ambos. Si `RESEND_API_KEY` está → real. Si no → mock. Confirmar.

### 15.5 Procesamiento síncrono o async desde día 1

ADR-003 §5.2 dice síncrono hasta cumplir Trigger A (p50 > 10s) o B (3 errors/sem). Mi recomendación: respetar ADR-003 — síncrono, sin BullMQ. Confirmar.

### 15.6 Eliminación de `/api/setup` — primer commit o último

Mi recomendación: ÚLTIMO commit (commit 21). Mientras Fase 4 se desarrolla, `/api/setup` sigue estando para casos de emergencia. Una vez el flow Stripe está verde, se elimina. Confirmar.

### 15.7 Página `/registro` — server actions o REST API

Server actions (Next 16 las soporta) reduce código y elimina endpoint adicional. CON: testing E2E ligeramente más complejo. Recomendación: server actions. Confirmar.

### 15.8 Decisión grande no cubierta por ADRs — Stripe Checkout vs Stripe Elements

ADR-003 menciona "Checkout" implícitamente pero no descarta Elements. Ambos ofrecen lo mismo en términos de funcionalidad. **Checkout** (página alojada por Stripe) es lo más simple — minimizes PCI scope, es URL externa, sin frontend Stripe. **Elements** (formulario embebido) es más controlable estéticamente.

Mi recomendación: **Checkout** (es lo que el ADR-003 §2.6 implica con `client_reference_id` y `subscription_data.metadata`, y simplifica el frontend Fase 4). Confirmar.

### 15.9 Decisión grande no cubierta por ADRs — Worker dedicado o monolítico

ADR-003 §5.2 dice "worker dual-rol" pero no pre-cierra si es proceso separado o el mismo de Next. En Fase 4 con jobs cron, lo natural es proceso separado: `npm run worker` corre `node-cron` + handlers. En producción Dokploy: dos servicios.

Pero también podríamos correr los crons dentro del proceso Next (los inicializa una vez al arranque). Más simple en local pero no escala.

**Recomendación**: proceso separado desde día 1. Concurrently en dev. Dos services en Dokploy. Confirmar.

### 15.10 Validación slug en `/registro` — pre-flight o solo en INSERT

Pre-flight con `GET /api/onboarding/check-slug?slug=...` mejora UX (feedback inmediato), pero abre un oracle de "ese slug ya existe". 

**Mitigación común**: rate-limit y devolver siempre `{ available: bool }` solo si el solicitante completó el formulario y el server hace el check en server action. Inviable como GET público.

**Recomendación**: solo en INSERT del server action. Si el slug está tomado, error con sugerencia "prueba acme2, acme-madrid, etc.". Mejor UX que un oracle. Confirmar.

---

## 16. Resumen ejecutivo (para revisión rápida)

- **18-22 commits** en 5 bloques: infra Stripe → coreografía → eventos restantes → UI registro → billing portal → jobs → cierre.
- 9 eventos Stripe procesados (lista §3.4); resto registrados sin side-effect (ADR-003 §2.3.b).
- Coreografía PENDING → PROVISIONING → ACTIVE en `handleCheckoutCompleted`, idempotente por UPDATE condicional.
- Worker separado con `node-cron` para 2 jobs (cleanup PENDING + detect PROVISIONING stuck).
- `/api/setup` eliminado en commit 21 (último).
- 5 puntos de revisión.
- 6 riesgos documentados con mitigación.
- 10 puntos abiertos en §15 que necesitan tu confirmación antes de arrancar el commit 1.
- Tenant `dev` actual preservado (no interfiere con flow Stripe).

Cuando apruebes los puntos de §15 (con o sin enmiendas), arranco Fase 4.
