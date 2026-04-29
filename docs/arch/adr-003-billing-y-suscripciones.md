# ADR-003 — Billing y suscripciones: Stripe como Customer = tenant, una subscription con N items, webhooks idempotentes y feature flags derivadas

- **Estado**: Accepted
- **Fecha**: 2026-04-29
- **Decisores**: Daniel Sánchez (`@tecnocloudes`)
- **Spec maestra**: [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md)
- **Visión**: [ADR-000](./adr-000-vision-saas.md)
- **Bounded contexts afectados**: `billing`, `control-plane`, `fichaje`, `super-admin`
- **Sucede a**: [ADR-001](./adr-001-aislamiento-multi-tenant.md), [ADR-002](./adr-002-resolucion-tenant.md)
- **Bloquea a**: ADR-004 (feature flags y addons), ADR-005 (deployment + TLS, claves Stripe en Dokploy), Fases 2, 4 y 5

---

## 1. Contexto

ADR-001 cerró el aislamiento (schema-per-tenant) y dejó referenciado en
§5.4 el "worker dual-rol" que coreografía la provisión de un nuevo tenant.
ADR-002 cerró cómo se identifica y se enruta cada request al schema
correcto. Falta cerrar **el cómo paga el tenant**: qué se modela en
Stripe, qué se persiste en `master`, qué eventos accionan la coreografía
ya descrita, y cómo las features y addons del catálogo §11 de la auditoría
acaban siendo `tenant_features` consultables desde código.

Cinco preguntas que ADR-003 responde:

1. **Modelo de productos en Stripe**: el catálogo §11 tiene 3 planes
   (`starter`/`pro`/`enterprise`) y un puñado de addons (`api_access`,
   `dominio_personalizado`, `integraciones_nomina`, etc.). ¿Cómo se
   representan en Stripe? ¿Una subscription por cliente con N items o N
   subscriptions independientes?
2. **Persistencia en el control plane**: `master.subscriptions` ya estaba
   anunciada en ADR-001 §5.4. Hay que cerrar el shape exacto, las tablas
   de items y la tabla de eventos (idempotencia).
3. **Coreografía de eventos Stripe**: `checkout.session.completed`,
   `customer.subscription.*`, `invoice.payment_*`. Qué procesamos, qué
   ignoramos, cómo encadenamos con la coreografía de provisión de ADR-001
   §5.4.
4. **Onboarding y trial**: ¿permitimos trial? ¿con tarjeta o sin? ¿qué
   pasa con tenants que abandonan el checkout?
5. **Aplicación en runtime**: cómo el evento de Stripe acaba siendo un
   `tenant.hasFeature('export_csv')` que el código del producto consulta
   en cada request, manteniendo además un canal `manual_override` para
   cortesías y soporte.

Tres restricciones operativas vienen de ADRs anteriores:

- **Worker dual-rol** (ADR-001 §5.4): el worker mantiene `prismaMaster`
  (con `master_role`) y `prismaApp` (con `app_role`). Elige por la tabla
  destino. **`prismaResolver` (con `tenant_resolver_role`) NO se usa en
  el worker** —es exclusivo del middleware HTTP (ADR-002 §3.6)— porque
  el worker tiene acceso completo al control plane vía `master_role`.
- **Coreografía de provisión** (ADR-001 §5.4): el orden es `master`
  (insertar `tenants`, `subscriptions`) → crear schema con
  `prismaMaster` → ejecutar migraciones → primer OWNER con `prismaApp`.
  ADR-003 es el sitio donde esa secuencia se ata al evento de Stripe que
  la dispara.
- **Estados del tenant** (ADR-002 §2.4): `active`/`suspended`/`pending`/
  `deleted`. ADR-003 define qué eventos transicionan entre ellos.

Hay una restricción legal añadida que pesa en este ADR: **RD 8/2019**
obliga a conservar el registro horario 4 años. Si un tenant cancela su
suscripción, los datos del schema `tenant_<slug>` no pueden eliminarse al
día siguiente: la cancelación NO es DELETE. El estado por defecto tras una
cancelación es `suspended` con retención larga, y el `DELETE` real lo
gobierna un proceso aparte (Fase 5+, fuera de este ADR).

---

## 2. Decisión

Adoptamos nueve decisiones encadenadas que cierran la capa de billing en
la app.

### 2.1 Modelo de productos en Stripe

- **Stripe Customer = tenant**, relación 1:1.
  - En Stripe: `customer.metadata.tenant_id = "<tenant-id>"` y
    `customer.metadata.tenant_slug = "<slug>"` para soporte/búsqueda
    desde el dashboard.
  - En BD: `master.tenants.stripe_customer_id` (NULLable hasta que se
    completa el primer checkout). Doble vínculo para idempotencia y
    debugging.
- **Stripe Product = plan**: tres productos (`Plan starter`, `Plan pro`,
  `Plan enterprise`).
- **Stripe Price por producto y billing period**: dos prices por plan
  (`monthly`, `yearly`). En total 6 prices iniciales.
- **Cada addon = Stripe Product separado**: `addon_dominio_personalizado`,
  `addon_api_access`, `addon_integraciones_nomina`,
  `addon_firma_electronica`, `addon_people_analytics`,
  `addon_storage_extra` (medido en bloques de 1 GB), `addon_emails_extra`
  (medido en bloques de 1.000 envíos/mes). Cada uno con su Stripe Price
  por billing period.

**Una subscription por tenant con N subscription items** (no N
subscriptions independientes):

- El plan ocupa el primer `subscription_item` (`price` apunta al price
  del plan).
- Cada addon es un `subscription_item` adicional dentro de la misma
  subscription.
- Razón: una sola `current_period_end`, una sola invoice por periodo,
  proration unificada cuando el cliente añade/quita addons. Es el
  patrón idiomático de Stripe SaaS y evita tener N facturas
  desincronizadas.
- Argumento detallado en §3.1.

Identificadores en metadata:

- `subscription_item.metadata.feature_key` apunta a la feature_key de
  `master.features` (ej: `dominio_personalizado`). Es lo que permite al
  webhook recomponer `tenant_features` sin tener que mapear price IDs en
  código duro.

### 2.2 Persistencia en el control plane

Tres tablas nuevas en el schema `master`, propiedad de `master_role`.

```sql
CREATE TYPE master.subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'unpaid',
  'canceled', 'paused', 'incomplete', 'incomplete_expired'
);

CREATE TABLE master.subscriptions (
  id                       text PRIMARY KEY,            -- cuid del control plane
  tenant_id                text NOT NULL REFERENCES master.tenants(id) ON DELETE CASCADE,
  stripe_subscription_id   text NOT NULL UNIQUE,        -- "sub_..."
  stripe_customer_id       text NOT NULL,               -- "cus_..."
  plan_key                 text NOT NULL,               -- "starter" | "pro" | "enterprise"
  status                   master.subscription_status NOT NULL,
  current_period_start     timestamptz NOT NULL,
  current_period_end       timestamptz NOT NULL,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  trial_end                timestamptz,
  raw_event_id_last        text,                        -- "evt_..." del último evento aplicado
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_tenant ON master.subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON master.subscriptions(status);

CREATE TABLE master.subscription_items (
  id                       text PRIMARY KEY,            -- cuid del control plane
  subscription_id          text NOT NULL REFERENCES master.subscriptions(id) ON DELETE CASCADE,
  stripe_item_id           text NOT NULL UNIQUE,        -- "si_..."
  feature_key              text NOT NULL,               -- "starter_plan", "addon_api_access", etc.
  quantity                 integer NOT NULL DEFAULT 1,  -- relevante para addons medidos (storage, emails)
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_items_subscription ON master.subscription_items(subscription_id);

CREATE TABLE master.stripe_events (
  event_id                 text PRIMARY KEY,            -- "evt_..." de Stripe
  type                     text NOT NULL,               -- "checkout.session.completed", etc.
  api_version              text NOT NULL,
  created_at               timestamptz NOT NULL,        -- timestamp del evento Stripe
  received_at              timestamptz NOT NULL DEFAULT now(),
  processed_at             timestamptz,                 -- NULL = ignorado intencionalmente o pendiente
  processing_error         text,                        -- llenado si el handler lanzó
  payload                  jsonb NOT NULL
);

CREATE INDEX idx_stripe_events_type ON master.stripe_events(type);
CREATE INDEX idx_stripe_events_received ON master.stripe_events(received_at);
```

Notas:

- Ninguna FK desde `subscription_items.feature_key` a `master.features`
  porque las features evolucionan vía migraciones; un mismatch entre
  `feature_key` y `master.features` se detecta en el handler y se
  reporta, pero no se bloquea (un evento "atrasado" con una feature
  retirada se registra sin acción).
- `raw_event_id_last` permite al worker descartar eventos fuera de orden
  cuando Stripe reintrega un evento más antiguo después de uno más
  nuevo: comparar `payload.created` con la fila actual.
- `master.stripe_events.processed_at = NULL` distingue eventos
  registrados-pero-ignorados (los listados en §2.3.b) de eventos
  procesados. Importante para auditoría sin gastar storage en payloads
  inútiles (en Fase 9 se puede añadir un job que purga payloads > 90
  días para eventos ignorados).

### 2.3 Coreografía de eventos Stripe

Stripe emite ~80 tipos de eventos. Política: registrar **todos** los
recibidos en `master.stripe_events` (auditoría completa), pero solo
**procesar** un subconjunto cerrado.

#### 2.3.a Eventos procesados

| Evento Stripe                          | Acción en control plane                                                                 | Acción en tenant schema                                              |
|----------------------------------------|------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| `checkout.session.completed`           | Si `tenant.status = PENDING`: dispara coreografía de provisión (ver §2.6). Inserta `subscriptions` y `subscription_items`. Setea `tenant.stripe_customer_id`. | Crear schema `tenant_<slug>` con `prismaMaster`, aplicar migraciones, crear primer OWNER con `prismaApp`. Tras éxito: `tenant.status = ACTIVE` |
| `checkout.session.expired`             | Registrado para auditoría. El cleanup lo hace el job de §2.6.                            | Ninguna                                                              |
| `customer.subscription.created`        | Generalmente cubierto por `checkout.session.completed`. Si llega solo: idempotente — upsert en `subscriptions`. | Ninguna                                                              |
| `customer.subscription.updated`        | Sincroniza `subscriptions.status`, `current_period_*`, `plan_key`, `cancel_at_period_end`. Recompone `subscription_items` desde `event.data.object.items`. Recalcula `tenant_features` (§2.9). | Ninguna directa. Las nuevas features surten efecto en la siguiente request |
| `customer.subscription.deleted`        | `subscription.status = canceled`. `tenant.status = SUSPENDED` (no DELETED — retención RD 8/2019). `tenant_features` se vacía en bloque excepto `manual_override`. | Ninguna. Los datos del schema permanecen                             |
| `customer.subscription.trial_will_end` | Email al OWNER 3 días antes del fin del trial (vía notificaciones de tenant)             | Ninguna                                                              |
| `invoice.payment_succeeded`            | Si `subscription.status` era `past_due` y vuelve a `active`: `tenant.status = ACTIVE` (re-activación tras dunning). | Ninguna                                                              |
| `invoice.payment_failed`               | `subscription.status = past_due`. **No** suspender inmediatamente; iniciar dunning de Stripe (reintentos automáticos durante 14 días). Email al OWNER. | Ninguna inmediata                                                    |
| `customer.subscription.paused` / `resumed` | Sincroniza `subscriptions.status`. `paused` → `tenant.status = SUSPENDED` con código distinto (planeado para soporte/test, no flujo cliente final). | Ninguna                                                              |

**Dunning**: si tras 14 días de reintentos automáticos de Stripe la
factura sigue impagada, Stripe emite `customer.subscription.deleted` (o
`customer.subscription.paused` según configuración del producto en
Stripe). En cualquiera de los dos casos, el handler suspende el tenant.
La duración del dunning es configurable en el dashboard de Stripe; el
ADR fija **14 días** como valor inicial (alineado con el Smart Retries
por defecto). Justificación en §3.4.

#### 2.3.b Eventos registrados-pero-ignorados

Lista explícita de familias que se registran en `master.stripe_events`
con `processed_at = NULL` (auditoría) pero **no** disparan nada:

- `charge.*` (cubierto por `invoice.*` para nuestros propósitos).
- `customer.created`, `customer.updated`, `customer.deleted` (excepto
  `customer.subscription.*`, que sí entran en §2.3.a).
- `payment_method.*` (Stripe gestiona el ciclo de vida de las tarjetas).
- `payout.*`, `balance.*`, `transfer.*` (no aplica al modelo).
- `price.*`, `product.*` (los gestionamos por código y migración, no
  desde el dashboard de Stripe).
- `radar.*`, `review.*` (Stripe gestiona la prevención de fraude).
- `charge.dispute.*`, `charge.refunded` (a tratar en operación, no
  transicionan estados de tenant; si se necesita acción, se hace
  manualmente en panel super-admin con audit log).
- Cualquier otro tipo no listado en §2.3.a. La política es **lista
  blanca**: lo que no aparece en §2.3.a se registra sin side-effect.

#### 2.3.c Endpoint receptor

- **Ruta**: `POST /api/webhooks/stripe`. Vive en
  `app.ficha.tecnocloud.es` (no en un subdominio de tenant).
- **Sin auth NextAuth, sin middleware de tenant**: el tenant se resuelve
  desde `event.data.object.customer` → lookup en `master.tenants` por
  `stripe_customer_id`.
- **Verificación de firma**: ver §2.5.
- **Procesamiento**: síncrono dentro del handler para los eventos de §2.3.a;
  el handler usa `prismaMaster` (master_role). Si la coreografía completa
  (§2.6) tarda más que el timeout de Stripe (~30s), responder 200
  inmediatamente tras registrar en `stripe_events` y delegar el
  procesamiento real a un job en cola (BullMQ + Redis, lo añade Fase 4).
  Hasta que Redis entre, el handler es síncrono y el riesgo de timeout
  se mitiga porque la operación más cara (creación de schema +
  migraciones) tarda <5s para 19 modelos.

### 2.4 Idempotencia de webhooks

Stripe puede reentregar el mismo evento (timeouts, fallos de red, retries
del propio Stripe). Patrón de idempotencia obligatorio en cada request al
endpoint:

```ts
async function handleWebhook(event: Stripe.Event) {
  // 1. Insertar en stripe_events. PK = event.id.
  const inserted = await prismaMaster.$queryRaw<{ event_id: string }[]>`
    INSERT INTO master.stripe_events (
      event_id, type, api_version, created_at, payload
    )
    VALUES (
      ${event.id}, ${event.type}, ${event.api_version},
      to_timestamp(${event.created}), ${event}::jsonb
    )
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;

  // 2. Si ON CONFLICT: ya procesado o en curso, devolver 200.
  if (inserted.length === 0) {
    return new Response(null, { status: 200 });
  }

  // 3. Procesar dentro de transacción separada del INSERT
  //    (la transacción del INSERT ya commitó: marcamos "recibido" antes
  //    de procesar para que un retry de Stripe no relance el handler).
  try {
    await dispatchEvent(event);
    await prismaMaster.stripeEvent.update({
      where: { event_id: event.id },
      data: { processed_at: new Date() },
    });
  } catch (err) {
    await prismaMaster.stripeEvent.update({
      where: { event_id: event.id },
      data: { processing_error: String(err) },
    });
    // Devolver 500 hace que Stripe reintente. El INSERT idempotente
    // del paso 1 garantizará que un retry no duplique side-effects.
    throw err;
  }

  return new Response(null, { status: 200 });
}
```

Tres propiedades garantizadas:

1. **El mismo `event.id` nunca dispara dos veces** la coreografía. La
   primera inserción gana; las siguientes ven `ON CONFLICT` y devuelven
   200.
2. **Una caída del worker entre el INSERT y el `processed_at`** queda
   marcada con `processing_error` o `processed_at = NULL` y es
   detectable con un job de monitorización: filas con `received_at <
   now() - interval '5 minutes' AND processed_at IS NULL AND
   processing_error IS NULL` son candidatas a re-enqueue manual.
3. **Eventos ignorados** (§2.3.b) se registran con `processed_at = NULL`
   intencionalmente; se distinguen de los caídos por la columna `type`
   (no aparece en la lista blanca).

### 2.5 Verificación de firma del webhook

```ts
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text(); // raw body, NO json()
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return new Response("Invalid signature", { status: 400 });
  }

  return handleWebhook(event);
}
```

Notas:

- **`req.text()`, no `req.json()`**: la firma se calcula sobre el cuerpo
  raw exacto. Cualquier reserialización rompe la verificación.
- `STRIPE_WEBHOOK_SECRET` distinto por entorno (test/live) y distinto si
  se usa Stripe CLI en local.
- En desarrollo, `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
  emite un secret efímero que se inyecta en `.env.local`.

### 2.6 Onboarding y limpieza de PENDING

Flujo:

1. **Registro en formulario** (en `app.ficha.tecnocloud.es/registro`):
   - Validación del slug: regex (ADR-001 §2.5) + verificación contra
     `master.reserved_slugs` (ADR-002 §2.1).
   - INSERT en `master.tenants` con `status = PENDING`,
     `stripe_customer_id = NULL`, `created_at = now()`.
   - Sin schema `tenant_<slug>` todavía.
2. **Stripe Checkout Session**:
   - El servidor crea la session con
     `client_reference_id = tenants.id`,
     `metadata = { tenant_id, tenant_slug }`,
     `subscription_data.metadata = { tenant_id, tenant_slug }`,
     `customer_creation = "always"` para que se cree el Stripe Customer.
   - Redirección del usuario a la URL de la session.
3. **`checkout.session.completed`**:
   - Resolver `tenant_id` desde `session.client_reference_id` (no desde
     metadata: el `client_reference_id` es exactamente para esto).
   - Si `tenant.status != PENDING` → ya estaba provisto (replay del
     evento), responder 200.
   - Setear `tenant.stripe_customer_id = session.customer`.
   - Recuperar `subscription` con la API y crear la fila en
     `master.subscriptions` y los `subscription_items`.
   - Recomponer `tenant_features` (§2.9).
   - **Coreografía de provisión** (orden estricto, ADR-001 §5.4):
     a. `prismaMaster.$executeRawUnsafe('CREATE SCHEMA "tenant_<slug>" AUTHORIZATION master_role')` con `quoteSchemaName` (ADR-001 §2.5).
     b. `prismaMaster` ejecuta los `GRANT` y `ALTER DEFAULT PRIVILEGES`
        para `app_role` (ADR-001 §2.3).
     c. `prismaMaster` aplica las migraciones del producto al nuevo
        schema vía `tenants:migrate <slug>` (Fase 3).
     d. `prismaApp.$executeRawUnsafe('SET search_path TO "tenant_<slug>", public')`
        y `prismaApp.user.create(...)` para el primer OWNER (datos del
        formulario de registro).
   - Si todo OK: `tenant.status = ACTIVE`. Email de bienvenida con URL
     `<slug>.ficha.tecnocloud.es`.
4. **Si el usuario abandona el checkout** (cierra el navegador,
   cancela): el tenant queda en `PENDING` indefinidamente. Lo resuelve un
   **job programado**:
   - Cada 1 hora: `DELETE FROM master.tenants WHERE status = 'PENDING'
     AND created_at < now() - interval '24 hours'`.
   - El slug queda libre para que cualquier otro registro lo use.
   - `checkout.session.expired` (Stripe lo emite al expirar la session a
     las 24h) se registra en `stripe_events` para auditoría pero no
     dispara el DELETE; deja que el job lo haga uniformemente para no
     duplicar lógica.
5. **Email distinto** del registrante intentando reusar slug: si llega
   un INSERT en `master.tenants` con un slug ya usado por un PENDING, la
   constraint UNIQUE (slug) lanza. La API debe devolver mensaje claro
   "ese subdominio está pendiente de confirmación; espera 24 horas o
   contacta soporte".

### 2.7 Trial: 14 días con tarjeta upfront

**Decisión**: trial de **14 días sobre el plan elegido por el cliente**,
**con tarjeta requerida** en el checkout. Stripe cobra automáticamente al
día 15 si la tarjeta sigue siendo válida.

- En el checkout: `subscription_data.trial_period_days = 14`.
- En la subscription: `status = trialing` durante el trial. El tenant
  está `ACTIVE` desde el primer minuto.
- `customer.subscription.trial_will_end` (3 días antes) → email aviso.
- Al final del trial:
  - Si la tarjeta cobra → `invoice.payment_succeeded` → tenant sigue
    `ACTIVE`, sub pasa a `active`.
  - Si la tarjeta falla → `invoice.payment_failed` → dunning (§2.3.a).

Configurable por env `STRIPE_TRIAL_DAYS=14`. Poner a `0` desactiva el
trial.

Razón de elegir **con tarjeta** y no sin tarjeta:

- Producto B2B (fichaje para empresas). El "comprador serio" no tiene
  problema en poner tarjeta para empezar.
- Reduce drásticamente el abuso: registros desechables, fake emails,
  scraping de funcionalidad. A 10–100 tenants previstos en 12 meses, un
  registro abusivo cuesta más que uno legítimo.
- El proceso de checkout es uno solo, sin un "checkout final" tras el
  trial que añadiría una segunda fricción.
- Stripe permite cancelar dentro del trial sin coste, así que la
  protección al consumidor está cubierta.

Argumento detallado y alternativas en §3.2.

### 2.8 Cambio de plan y autoservicio

- **Upgrade** (starter → pro, pro → enterprise, añadir addon): inmediato.
  Stripe calcula la proration y la suma a la siguiente factura. `tenant_features`
  refleja la nueva configuración en el siguiente
  `customer.subscription.updated`.
- **Downgrade** (pro → starter, quitar addon): se aplica al final del
  periodo en curso (`cancel_at_period_end` style para el item, o
  `proration_behavior = "none"` con efecto al renovar). El tenant
  conserva las features hasta `current_period_end`.
- **Cancelación**: igual que downgrade, al final del periodo.

**Autoservicio vía Stripe Billing Portal**:

- El OWNER del tenant accede al portal desde la app
  (`<slug>.ficha.tecnocloud.es/configuracion/facturacion`) que emite
  un link al portal con `return_url` apuntando a la app del tenant.
- El portal permite: cambiar de plan, añadir/quitar addons, actualizar
  método de pago, ver invoices, descargar facturas, cancelar
  suscripción.
- **Solo OWNERs**: la página `/configuracion/facturacion` está
  restringida en código por `currentUser().rol === "OWNER"`. MANAGERs y
  EMPLEADOs no la ven en sidebar ni pueden acceder por URL directa.
- El super-admin de plataforma también puede operar el portal de
  cualquier tenant desde el panel `admin.ficha.tecnocloud.es`, con
  audit log (ADR-007).

### 2.9 Aplicación de feature flags y addons en runtime

Tabla `master.tenant_features` con resolución por `source`:

```sql
CREATE TYPE master.feature_source AS ENUM (
  'plan',             -- viene del plan (subscription_item del plan)
  'addon',            -- viene de un addon (subscription_item con feature_key)
  'manual_override'   -- alta manual desde panel super-admin (cortesía, soporte)
);

CREATE TABLE master.tenant_features (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES master.tenants(id) ON DELETE CASCADE,
  feature_key   text NOT NULL,
  value         jsonb NOT NULL,                 -- bool true/false, integer (limit), integer (quota)
  source        master.feature_source NOT NULL,
  expires_at    timestamptz,                    -- NULL = sin expiración
  reason        text,                           -- obligatorio para manual_override
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_tenant_feature_source
  ON master.tenant_features(tenant_id, feature_key, source);
```

**Lógica de sincronización Stripe → tenant_features**:

Al recibir `customer.subscription.updated` (o `created`, o `deleted`):

1. **Borrar todas las filas con `source IN ('plan', 'addon')`** del
   tenant. Las filas con `source = 'manual_override'` **no** se tocan.
2. Para el `subscription_item` del plan (identificado por
   `metadata.feature_key = "<plan>_plan"` o por price ID): insertar las
   features del plan según el catálogo §11.4.
3. Para cada `subscription_item` de addon: insertar la(s) feature(s) que
   activa, con `quantity` cuando aplica (storage extra, emails extra).

**Resolución en runtime**:

```ts
async function hasFeature(tenantId: string, key: string): Promise<boolean> {
  const rows = await prismaMaster.tenantFeature.findMany({
    where: {
      tenant_id: tenantId,
      feature_key: key,
      OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
    },
    orderBy: { source: "desc" }, // manual_override > plan > addon (depende del enum order; en SQL usar CASE)
  });
  // manual_override gana siempre si existe y no ha expirado.
  const overrideRow = rows.find((r) => r.source === "manual_override");
  if (overrideRow) return overrideRow.value === true;
  return rows.some((r) => r.value === true);
}
```

Nota sobre el orden: `manual_override > addon > plan` para booleans.
Para limits y quotas, la regla es **el máximo entre todas las fuentes**
(un addon `storage_extra` con `quantity = 5` se suma al `max_storage_mb`
del plan; un manual_override puede aumentar puntualmente). La función
`getLimit` y `getQuota` implementan esa agregación.

**Manual override desde panel super-admin** (ADR-007):

- El super-admin puede insertar una fila con `source = manual_override`
  con `expires_at` opcional y `reason` obligatorio.
- Casos típicos: cortesía a un cliente VIP (`api_access` por 30 días),
  soporte ("activamos `dominio_personalizado` mientras se configura
  DNS"), pruebas internas.
- Toda alta de manual_override genera una fila en `master.audit_log`
  (ADR-007) con `actor`, `tenant_id`, `feature_key`, `value`, `reason`.

---

## 3. Opciones consideradas

### 3.1 Modelo de Stripe products: una subscription o varias

| Opción                                                        | A favor                                                                                       | En contra                                                                                                |
|---------------------------------------------------------------|------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| **Una subscription con N items** (elegida)                    | Una sola `current_period_end`. Una sola invoice por periodo. Proration unificada. Patrón idiomático Stripe. Stripe Billing Portal lo soporta nativamente | Si quisiéramos trials independientes por addon, no encaja. No es nuestro caso                            |
| Una subscription por plan + una por cada addon                | Trials independientes. Cancelar un addon es independiente del plan                              | N invoices distintas con periodos posiblemente desincronizados. UX mala. Stripe Billing Portal hace malabares |
| Productos plan-con-addons-incluidos (un Product por combinación) | Un solo Stripe Product, una sola Price. Simple                                                | 3 planes × 2 períodos × 2^7 combinaciones de addons = 768 productos. Inviable                            |

### 3.2 Trial: con tarjeta, sin tarjeta, sin trial

| Opción                                | A favor                                                                          | En contra                                                                                                 |
|---------------------------------------|-----------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Sin trial (pago inmediato)            | Cero abuso. Cliente "serio" desde el minuto 1                                     | Fricción alta para evaluar. Conversión baja en B2B donde el comprador típico quiere probar antes          |
| Trial sin tarjeta (14 días)           | Fricción mínima. Mejor conversión "interesado → activo"                            | Abuso: registros desechables, fake emails, scraping. A 10–100 tenants/año, una tasa de abuso del 30% es ruidosa |
| **Trial con tarjeta upfront (14 días)** (elegida) | Fricción aceptable para B2B. Reduce drásticamente abuso. Un solo flow de checkout, no dos | Pierde a algún interesado que no quiere poner tarjeta. Aceptable: el target del producto es comprador empresarial |

### 3.3 Cleanup de PENDING

| Opción                                                                      | A favor                                                  | En contra                                                                            |
|-----------------------------------------------------------------------------|-----------------------------------------------------------|---------------------------------------------------------------------------------------|
| **Job programado horario que DELETE WHERE status = PENDING AND age > 24h** (elegida) | Lógica única, predecible, idempotente                  | Slug ocupado durante hasta 24h aunque el usuario abandone en 5 min                   |
| `checkout.session.expired` dispara DELETE inmediato                         | Slug libre antes (Stripe expira la session a 24h también) | Lógica duplicada con el job. Hay PENDINGs que nunca llegaron a checkout (registró pero abandonó la página antes de redirigir) que el evento no cubre |
| Mantener PENDING indefinidamente, mostrar "completar registro" si vuelve     | Cero pérdida de datos                                    | Slugs reservados de por vida sin compromiso. Atacable con squatting de subdominios   |

### 3.4 Días de dunning antes de suspender

| Días | A favor                                          | En contra                                                              |
|------|--------------------------------------------------|------------------------------------------------------------------------|
| 7    | Recuperación rápida del impago                   | Cliente con problema temporal de tarjeta puede perder acceso por error |
| **14** (elegida) | Alineado con Smart Retries de Stripe por defecto. Cubre fines de semana, vacaciones | Latencia en cobrar al cliente "moroso real"                            |
| 30   | Margen máximo para el cliente                    | Riesgo de impago acumulado mayor; cliente "moroso real" usa el servicio gratis |

### 3.5 Eventos Stripe: lista blanca o lista negra

| Opción                                                       | A favor                                                                  | En contra                                                                                              |
|--------------------------------------------------------------|---------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| **Lista blanca** (procesar lo de §2.3.a, ignorar el resto) (elegida) | Seguro: nuevos eventos de Stripe no introducen side-effects sin revisión | Hay que actualizar la lista al añadir features (ej: usage-based billing más adelante)                  |
| Lista negra (procesar todo excepto los listados como ignorados) | "Listo para futuro": cualquier evento nuevo de Stripe se procesa         | Riesgo: un evento nuevo (ej: `entitlements.active_entitlement_summary.updated` que Stripe añadió en 2024) podría disparar lógica imprevista |

---

## 4. Consecuencias

### 4.1 Positivas

- **Una factura por periodo** para el cliente, suma de plan + addons.
  UX limpia, contabilidad simple.
- **Idempotencia garantizada por construcción**. El INSERT con
  `ON CONFLICT (event_id) DO NOTHING` blinda contra retries de Stripe.
- **Auditoría completa de lo que llega de Stripe**. Todo evento queda
  en `master.stripe_events`, procesado o no. Investigar incidencias
  ("¿por qué este tenant pasó a past_due?") es trivial.
- **Stripe Billing Portal** cubre el 90% del autoservicio
  (cambio de plan, addons, método de pago, descarga de facturas) sin
  código propio.
- **Trial con tarjeta** reduce abuso al mínimo y mantiene el flow
  comercial de un solo checkout.
- **Manual override** da al super-admin una palanca para soporte sin
  romper la fuente de verdad de Stripe.
- **Compatibilidad con RD 8/2019**: la cancelación NO borra datos. El
  schema sobrevive 4 años por defecto (lo gestiona un proceso aparte
  fuera de este ADR).

### 4.2 Negativas (asumidas)

- **Acoplamiento con Stripe**. Si en algún momento queremos cambiar de
  proveedor (Paddle, Lemon Squeezy, etc.), hay que reescribir el worker
  y la mitad de las tablas. Aceptable: Stripe es el estándar de facto en
  SaaS y el coste de cambiar es razonable comparado con el coste de no
  delegar billing.
- **Webhooks como SPOF**. Si Stripe está caído o el endpoint falla, el
  control plane se desincroniza. Mitigación: Stripe reintenta hasta 3
  días y registramos todos los eventos en `stripe_events` para
  reprocesar manualmente si hace falta. El tenant sigue funcionando
  porque `tenant_features` sigue válida hasta el próximo evento.
- **Latencia en re-activación tras impago**. Si un cliente paga la
  factura tras 10 días de `past_due`, el `invoice.payment_succeeded`
  llega y reactiva, pero la latencia entre pago y reactivación depende
  de cuándo Stripe procesa el reintento (puede ser horas).
- **Cleanup de PENDING ocupa slug 24h**. Un usuario que registra `acme`,
  abandona el checkout y vuelve 1h después intentando el mismo slug
  recibe error. Mitigación: el mensaje propone "vuelve a intentarlo en
  24h o contacta soporte", el super-admin puede borrar el PENDING
  manualmente.
- **`tenant_features` se reescribe en bloque** en cada
  `customer.subscription.updated`. Las filas con `source IN ('plan',
  'addon')` se borran y se vuelven a insertar. Inserts repetidos en una
  tabla pequeña (decenas de filas por tenant) — coste irrisorio.
- **Eventos ignorados ocupan storage** en `master.stripe_events`.
  Mitigación: job de Fase 9 que purga payloads de eventos ignorados
  antiguos (> 90 días); mantiene fila con `payload = NULL`.

### 4.3 Neutras

- **Stripe modo test vs live**: dos sets de claves (test/live) y dos
  webhook secrets. El código no distingue: la clave inyectada al cliente
  Stripe define el modo. Documentado en §5.4.
- **Trials configurables**: `STRIPE_TRIAL_DAYS=0` desactiva el trial.
  Permite hacer pruebas con cuentas de prueba sin trial.
- **Migración del cliente actual**: el primer tenant (cutover de Fase 8)
  no pasa por checkout: se crea su fila en `tenants` y `subscriptions`
  manualmente con un `stripe_customer_id` ya creado fuera del flujo
  normal, o sin Stripe en absoluto si ese cliente ya paga por contrato
  externo. Lo cierra Fase 8.
- **Webhook endpoint sin tenant context**: el handler usa exclusivamente
  `prismaMaster` y `prismaApp`. No hay riesgo de fuga porque el handler
  no responde con datos de un tenant a otro: solo escribe en master y
  hace operaciones DDL en el schema correcto. El test de fuga (ADR-001
  §2.4) no aplica al webhook.

---

## 5. Implicaciones para fases siguientes

### 5.1 Fase 2 — Control plane

- Migraciones para crear `master.subscriptions`, `master.subscription_items`,
  `master.stripe_events`, `master.tenant_features`, enums
  `master.subscription_status` y `master.feature_source`.
- Seed con los 3 planes y los addons del catálogo §11.4 (Stripe se
  configura en paralelo en su dashboard, con price IDs almacenados en una
  tabla `master.stripe_prices` — opcional, o vía env vars con
  `STRIPE_PRICE_*` por plan/billing period).

### 5.2 Fase 4 — Onboarding, worker, webhooks

- Endpoint `POST /api/webhooks/stripe` con verificación de firma.
- Worker dual-rol (ADR-001 §5.4): `prismaMaster` y `prismaApp`. **No**
  abrir `prismaResolver` aquí (ADR-002 §3.6: ese rol es del middleware
  HTTP).
- Handler de cada evento de §2.3.a en módulo separado
  (`src/lib/stripe/handlers/checkout-session-completed.ts`, etc.).
- Página `/registro` en `app.ficha.tecnocloud.es` con validación de
  slug.
- Página `/configuracion/facturacion` en `<slug>.ficha.tecnocloud.es`
  para abrir el Billing Portal.
- Job programado horario para `DELETE PENDING > 24h` (en el mismo
  worker; cron por `node-cron` o equivalente).
- Si el handler tarda >25s en producción, considerar mover el
  procesamiento a una cola (BullMQ + Redis). Hasta entonces, síncrono.

### 5.3 Fase 5 — Feature flags en uso

- Implementar `tenant.hasFeature(key)`, `tenant.getLimit(key)`,
  `tenant.getQuota(key)` consultando `master.tenant_features` con la
  resolución de §2.9 (`manual_override > addon > plan` para booleans;
  agregación máxima para limits/quotas).
- Cachear resultado por request en el contexto del tenant
  (`AsyncLocalStorage`, ADR-002 §2.2) para evitar consultar master en
  cada `hasFeature` de la misma request.
- Endpoint `GET /api/me/features` que devuelve las features activas del
  tenant para que el front oculte/muestre opciones.

### 5.4 Fase 8 — Despliegue Dokploy

Variables de entorno nuevas en Dokploy:

- `STRIPE_SECRET_KEY` — `sk_test_...` en staging, `sk_live_...` en
  prod.
- `STRIPE_PUBLISHABLE_KEY` — `pk_test_...` / `pk_live_...`.
- `STRIPE_WEBHOOK_SECRET` — `whsec_...` distinto por endpoint y entorno.
- `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_YEARLY`,
  `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`,
  `STRIPE_PRICE_ENTERPRISE_MONTHLY`, `STRIPE_PRICE_ENTERPRISE_YEARLY`.
- `STRIPE_PRICE_ADDON_*` por addon.
- `STRIPE_TRIAL_DAYS=14` (default; configurable por entorno).
- `STRIPE_PORTAL_RETURN_URL=https://<slug>.ficha.tecnocloud.es/configuracion`
  (con `<slug>` resuelto en runtime, no env).
- `STRIPE_CHECKOUT_SUCCESS_URL=https://app.ficha.tecnocloud.es/registro/exito?session_id={CHECKOUT_SESSION_ID}`.
- `STRIPE_CHECKOUT_CANCEL_URL=https://app.ficha.tecnocloud.es/registro/cancelado`.

Healthcheck de la app:

- Verificar conexión a `master_role` y `app_role` (ya en ADR-001 §5.3).
- Añadir `tenant_resolver_role` (ADR-002 §5.4).
- Verificar que `STRIPE_SECRET_KEY` está presente y que el SDK puede
  hacer un `stripe.products.list({ limit: 1 })` (smoke test, no en cada
  health check sino al arranque).

---

## 6. Criterios de aceptación

Esta decisión se considera implementada cuando, al término de Fase 4,
todos los siguientes son ciertos:

1. Las 4 tablas (`subscriptions`, `subscription_items`, `stripe_events`,
   `tenant_features`) existen en `master` con los enums correspondientes
   y están propiedad de `master_role`.
2. El endpoint `POST /api/webhooks/stripe` verifica firma con
   `STRIPE_WEBHOOK_SECRET` y rechaza con 400 una request manipulada
   (test).
3. Reentregar el mismo `event.id` dos veces ejecuta el handler una sola
   vez (verificado con test de integración: insertar evento, replay,
   contar side-effects en master = 1).
4. `checkout.session.completed` para un tenant en `PENDING` ejecuta la
   coreografía completa (master → schema → migraciones → primer OWNER) y
   deja el tenant en `ACTIVE`. Verificado con test E2E con Stripe en
   modo test.
5. `customer.subscription.updated` con un addon añadido crea la fila
   correspondiente en `subscription_items` y aparece en `tenant_features`
   con `source = 'addon'`. La feature es visible desde
   `tenant.hasFeature(key)` en la siguiente request.
6. `customer.subscription.deleted` deja el tenant en `SUSPENDED`, vacía
   `tenant_features` con `source IN ('plan', 'addon')` y mantiene las
   filas con `source = 'manual_override'` intactas.
7. Tras `invoice.payment_failed`, el tenant queda en `past_due` durante
   14 días con dunning de Stripe activo. Si paga en ese plazo, el
   `invoice.payment_succeeded` lo devuelve a `ACTIVE`. Si no,
   `customer.subscription.deleted` (o `paused`) lo suspende.
8. Un tenant `PENDING` con `created_at > 24h` es eliminado por el job
   horario y su slug queda libre para reuso.
9. La página `/configuracion/facturacion` solo es accesible para
   `OWNER`. Verificado con test que un MANAGER recibe 403.
10. `master.stripe_events` registra **todos** los eventos recibidos
    (procesados e ignorados) con sus respectivos `processed_at`.
11. El handler usa `prismaMaster` y `prismaApp` exclusivamente (verificado
    con grep en `src/lib/stripe/`); ninguna referencia a `prismaResolver`.

---

## 7. Referencias

- [`docs/arch/00-auditoria.md`](./00-auditoria.md), §11 (catálogo de
  planes y features), §11.2 (registro_jornada_legal CORE),
  §10.4 (Redis no día 1).
- [ADR-000](./adr-000-vision-saas.md) — visión SaaS y bounded contexts.
- [ADR-001](./adr-001-aislamiento-multi-tenant.md), §2.3 (roles
  Postgres), §2.5 (quoteSchemaName), §5.4 (worker dual-rol),
  §5.5 (prioridad backup master).
- [ADR-002](./adr-002-resolucion-tenant.md), §2.1 (subdominios y
  reserved_slugs), §2.4 (estados del tenant), §3.6 (tres roles
  Postgres), §2.5 (cookie host-only).
- [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md),
  apartado 5 (Billing: Stripe), apartado 4 (Sistema de planes y
  features), Fases 2, 4 y 5.
- ADR-004 (feature flags y addons en uso) — pendiente, cierra el "cómo"
  del `tenant.hasFeature` y la UI condicionada por features.
- ADR-005 (deployment + TLS) — pendiente, refleja claves Stripe en
  Dokploy y opción TLS-A.
- ADR-007 (auth super-admin) — pendiente, cierra el panel y el
  `audit_log` de manual_override.
- Stripe docs:
  [Subscriptions](https://docs.stripe.com/billing/subscriptions/overview),
  [Webhooks signatures](https://docs.stripe.com/webhooks/signature),
  [Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries),
  [Customer Portal](https://docs.stripe.com/customer-management),
  [Trials](https://docs.stripe.com/billing/subscriptions/trials).
- Real Decreto-ley 8/2019: condiciona la retención de datos de tenants
  cancelados a 4 años — el flow de `customer.subscription.deleted` pasa
  el tenant a `SUSPENDED`, no a `DELETED`.
