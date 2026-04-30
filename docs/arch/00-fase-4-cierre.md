# Cierre de Fase 4 — Onboarding Stripe + webhooks

- **Estado**: CERRADA
- **Fecha**: 2026-04-30
- **Plan**: [`00-fase-4-plan.md`](./00-fase-4-plan.md)
- **ADR**: [`adr-003-billing-y-suscripciones.md`](./adr-003-billing-y-suscripciones.md)
- **Estado heredado**: feature/saas-migration con Fase 3 cerrada (HOF withTenant)

## 1. Resumen ejecutivo

Fase 4 cerrada con **19 commits** (plan estimaba 18-22). Sin sorpresas
arquitectónicas mayores; los 3 enmiendas pre-implementación (server
actions con `prismaMaster`, verificación cliente Prisma multiplexado,
`constructEvent` real en tests) se cerraron como esperado.

Funcionalidad entregada:

1. **Flow de registro** (`/registro` en subdominio `app`):
   - Form server component con planes activos.
   - Server action zod-validada que INSERT en master + crea Stripe
     Checkout Session con `client_reference_id` y trial 14 días.
   - Páginas `/registro/exito` (polling) y `/registro/cancelado`.
2. **Webhook `/api/webhooks/stripe`**:
   - Verificación firma con `constructEvent` real.
   - Idempotencia INSERT ON CONFLICT en `master.stripe_events`.
   - Dispatch a 9 handlers + default ignorado (lista blanca).
3. **9 handlers de eventos**:
   - `checkout.session.completed` con coreografía completa
     PENDING→PROVISIONING→ACTIVE.
   - `customer.subscription.updated` (resync features).
   - `customer.subscription.deleted` (suspended + features).
   - `customer.subscription.paused/resumed`.
   - `customer.subscription.trial_will_end` (email aviso).
   - `invoice.payment_succeeded` (re-activación post-dunning).
   - `invoice.payment_failed` (past_due + email).
   - `checkout.session.expired` (no-op; cleanup en job).
4. **Stripe Billing Portal** en `/admin/configuracion/facturacion`
   (solo OWNER).
5. **Worker proceso separado** (`npm run worker`) con node-cron:
   - Cleanup PENDING > 24h cada hora.
   - Detect PROVISIONING > 10 min cada 5 min con escalado a
     super-admin tras 3 errores.
6. **Eliminación legacy**: `/api/setup`, `/api/setup/reset`,
   `/setup` page.
7. **`stripe:bootstrap`** script idempotente para crear/upsert 10
   products + 13 prices en Stripe.

## 2. Criterios de aceptación

15 criterios del plan §13 (los 11 de ADR-003 §6 + 4 propios):

| # | Criterio | Estado |
|---|----------|--------|
| 1 | 4 tablas master con enums + master_role | ✅ heredado de Fase 2 |
| 2 | Webhook verifica firma con STRIPE_WEBHOOK_SECRET, rechaza 400 con manipulada | ✅ test ejercita ambos casos |
| 3 | Reentrega del mismo event.id ejecuta handler 1 sola vez | ✅ test "replay devuelve 200 sin re-procesar" |
| 4 | checkout.session.completed para PENDING ejecuta coreografía completa | ✅ test "PENDING tenant → ACTIVE" |
| 5 | customer.subscription.updated con addon → fila en subscription_items + tenant_features con source=addon | ⚠️ implementado, no testeado E2E (ADR-003 deja para parada §6) |
| 6 | customer.subscription.deleted → SUSPENDED, vacía features excepto manual_override | ✅ implementado; test E2E pendiente operador |
| 7 | invoice.payment_failed → past_due 14 días + dunning Stripe | ✅ implementado |
| 8 | tenant PENDING > 24h borrado por job | ✅ test "cleanup borra solo PENDING > 24h" |
| 9 | /configuracion/facturacion solo OWNER, MANAGER recibe 403 | ✅ implementado (denegación en página) |
| 10 | master.stripe_events registra todos los eventos | ✅ recordEventOrSkip insert ON CONFLICT |
| 11 | Handler usa solo prismaMaster + prismaApp; no prismaResolver | ✅ grep confirma |
| 12 | npm test + test:integration verdes | ✅ 145/145 verde |
| 13 | tsc + eslint exit 0 | ✅ |
| 14 | E2E manual: registro completo → checkout → webhook → login | ⚠️ pendiente operador (requiere `stripe login` y cuenta test) |
| 15 | /api/setup, /api/setup/reset eliminados; grep → 0 | ✅ verificado |

⚠️ Criterios 5, 6, 14: implementados pero no ejercitados E2E con Stripe
real en esta sesión (requieren `stripe login` interactivo + cuenta de
test del operador). Tests integration con `constructEvent` real
cubren la parte automatizable.

## 3. Enmiendas verificadas

### Enmienda 1 (server actions con `prismaMaster`)
✅ Aplicada en `src/app/(public)/registro/actions.ts`. Documentada
en AGENTS.md sección "Server actions del subdominio app".

### Enmienda 2 (cliente Prisma multiplexado tras provisionTenantSchema)
✅ Verificada empíricamente en `src/lib/tenant/provision.integration.test.ts`:

```
✓ crea schema, aplica migraciones y prismaApp.user.create funciona
✓ provisionTenantSchema es idempotente (segunda invocación no falla)
```

Mitigación implementada: `invalidateTenantClient(slug)` en
`src/lib/prisma.ts`. El handleCheckoutCompleted lo invoca antes del
paso 9 (crear OWNER en runWithTenant).

### Enmienda 3 (`constructEvent` REAL en tests)
✅ Aplicada en `src/app/api/webhooks/stripe/route.integration.test.ts`.
5 tests con `stripe.webhooks.constructEvent` real +
`stripe.webhooks.generateTestHeaderString`. Solo
`stripe.subscriptions.retrieve` mockeado (requiere API real).

## 4. Suite de tests final

```
npm test (unit)           → 111/111 verde
npm run test:integration  → 145/145 verde
  - leak.integration            (4 escenarios + diagnóstico, Fase 3)
  - super-admin.integration     (Fase 2)
  - provision.integration       (Enmienda 2 — Fase 4)
  - idempotency.integration     (6 escenarios — Fase 4)
  - route.integration (webhook) (5 escenarios — Fase 4)
  - jobs.integration            (5 escenarios — Fase 4)

npx tsc --noEmit          → exit 0
npx eslint src/app/api    → 0 violaciones de fichaje/no-legacy-prisma
```

## 5. TODOs nuevos descubiertos

1. **ADR-008 lifecycle SUSPENDED → DELETED** (RD 8/2019 vs GDPR art. 17).
   Pendiente antes de Fase 5.
2. **Audit log master** (master.audit_log) para escalado de tenants
   PROVISIONING stuck. Hoy log a console; Fase 7 lo materializa.
3. **Email super-admin** cuando `stuck_tenant.retryCount ≥ 3`. Hoy
   `console.error`; Fase 4 final cuando exista al menos 1 super-admin
   con email.
4. **BullMQ + Redis** si Trigger A (p50 > 10s) o B (>3 errors/sem)
   se cumplen. Métrica `received_at → processed_at` ya en
   master.stripe_events; falta dashboard.
5. **E2E real con Stripe CLI** del operador (criterio 14):
   ```
   stripe login
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   # En otra terminal:
   npm run dev:all
   # Visitar http://app.localhost:3000/registro
   ```
6. **`stripe:bootstrap`** ejecución del operador para sembrar 10
   products + 13 prices en cuenta Stripe test antes del primer
   registro real.
7. **Test E2E del flow completo** (commit 14-22) con Playwright
   o equivalente. Aplazado — la suite integration cubre las piezas;
   el flow visual queda para verificación manual.

## 6. git log de Fase 4 (19 commits)

```
chore(legacy): eliminar /api/setup, /api/setup/reset, página /setup
feat(worker): cron node-cron + cleanup-pending + detect-provisioning-stuck
feat(facturacion): página /admin/configuracion/facturacion → Stripe Billing Portal
feat(registro): páginas exito (polling) + cancelado + endpoint status
feat(registro): página /registro con formulario zod + server action
test(stripe): integration con constructEvent REAL (parada 2 — Enmienda 3)
feat(stripe): handlers paused/resumed/trial-will-end/checkout-expired
feat(stripe): handlePaymentSucceeded + handlePaymentFailed
feat(stripe): handleSubscriptionDeleted (suspended + vaciar features)
feat(stripe): handleSubscriptionUpdated — sync subscriptions + items + features
test(tenant): provision integration verifica Enmienda 2 (parada 1)
feat(stripe): handleCheckoutCompleted — coreografía PENDING→PROVISIONING→ACTIVE
feat(stripe): persistSubscription + recomposeTenantFeatures
refactor(tenant): extraer provisionTenantSchema a src/lib/tenant/provision.ts
feat(api): /api/webhooks/stripe con firma + idempotencia + dispatch
feat(stripe): dispatch.ts con switch + 9 stubs de handlers
feat(stripe): idempotency layer (recordEventOrSkip + markProcessed)
feat(stripe): cliente singleton + price catalog + script stripe:bootstrap
docs(arch): plan Fase 4 — 3 enmiendas pre-implementación
```

## 7. Tiempo estimado

Sesión continua: ~1h45m wall-clock. Calibración para futuras fases:
~1h-1h30m por fase si no hay sorpresas arquitectónicas. Las dos
paradas obligatorias (Enmienda 2 + Enmienda 3) cerraron sin
incidentes — patrones claros desde Fase 3 ayudan.

## 8. E2E manual pendiente (operador)

Para cerrar criterio 14, el operador debe:

```bash
# 1. Cuenta Stripe en modo test, sk_test_... y pk_test_... en .env.
# 2. Sembrar productos + prices:
STRIPE_SECRET_KEY=sk_test_... npm run stripe:bootstrap
# Copiar las STRIPE_PRICE_* a .env.

# 3. En una terminal: stripe listen.
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# Copiar el whsec_... que emite a STRIPE_WEBHOOK_SECRET en .env.

# 4. En otra terminal: arrancar Next + worker.
npm run dev:all

# 5. Ir a http://app.localhost:3000/registro
# Llenar form: nombre="Acme", email="test@example.com",
# slug="acme1", plan starter, monthly.
# → Redirige a Stripe Checkout. Tarjeta de test 4242 4242 4242 4242.
# → Tras pagar: /registro/exito polling → redirect a
#   http://acme1.localhost:3000/login.
# → Email mock en consola con set-password URL. Click → set-password.
# → Login con la nueva password.

# Verificación SQL:
docker exec fichaje_postgres psql -U fichaje_admin -d fichaje_db -c \
  "SELECT slug, status, stripe_customer_id FROM master.tenants WHERE slug='acme1'"
# Debe mostrar status=active, stripe_customer_id=cus_...
```

Si todo verde, criterio 14 cerrado y Fase 4 lista para mergear a main.
