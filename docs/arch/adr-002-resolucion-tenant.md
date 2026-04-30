# ADR-002 — Resolución de tenant: subdominios, contexto por query, caché in-memory y JWT vinculado al host

- **Estado**: Accepted
- **Fecha**: 2026-04-29
- **Decisores**: Daniel Sánchez (`@tecnocloudes`)
- **Spec maestra**: [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md)
- **Visión**: [ADR-000](./adr-000-vision-saas.md)
- **Bounded contexts afectados**: `tenant-resolution`, `control-plane`, `fichaje`, `super-admin`
- **Sucede a**: [ADR-001](./adr-001-aislamiento-multi-tenant.md)
- **Bloquea a**: ADR-005 (deployment + TLS, refleja pgbouncer session pooling), ADR-007 (auth super-admin), Fases 3 y 4

---

## 1. Contexto

ADR-001 fija que el aislamiento de datos se hace por **schema-per-tenant** con
`SET search_path` y dos roles Postgres. Falta cerrar el **cómo se elige el
tenant correcto en cada request**: cómo se identifica, cómo se inyecta en el
contexto del proceso, cómo se aplica `SET search_path` sin abrir vectores de
fuga, cómo se cachea, qué pasa cuando un tenant está suspendido o no existe, y
cómo amarra la sesión del usuario al tenant correcto.

Cinco preguntas que ADR-002 responde:

1. **Identificación del tenant**: por subdominio (decisión recogida de la
   spec, apartado 2). Pero la spec no fija qué subdominios están reservados,
   ni dónde se validan.
2. **Lifecycle del contexto en la request**: cómo viaja el slug del tenant
   desde el middleware HTTP hasta el `$extends({ query })` de Prisma sin
   acoplar firmas de funciones, sin headers propagados manualmente, y sin
   riesgo de heredar contexto entre requests.
3. **Caché de la resolución host→tenant**: la spec descartó Redis desde el
   día 1 (§10.4 auditoría), pero no cerró estructura, TTL, ni —sobre todo—
   cómo se invalida cuando el panel super-admin suspende un tenant y hay
   varias instancias de la app detrás de Traefik.
4. **Estados del tenant y comportamiento de respuesta**: `active`,
   `suspended`, `pending`, `deleted` no son sólo estados de BD; cada uno
   tiene un código HTTP, una página y un comportamiento distinto.
5. **Auth multi-tenant**: cómo el JWT que emite NextAuth en un subdominio
   queda atado a ese tenant y no permite suplantar otros, y por qué la
   cookie debe estar en scope del subdominio específico.

Las decisiones operan sobre dos restricciones ya cerradas:

- **§2.5 de ADR-001** define `quoteSchemaName(slug)` con regex
  `^[a-z][a-z0-9_]{2,30}$`. ADR-002 no repite esa validación, **se apoya en
  ella**: cualquier flujo que termine en un `SET search_path` pasa antes por
  esa función.
- **pgbouncer en session pooling** (§5.3 ADR-001 y futura ADR-005). Esto
  obliga a que el `SET search_path` se aplique con un patrón
  `SET → query → RESET` para no contaminar conexiones liberadas al pool.

Existe un acoplamiento mono-tenant del repo actual que esta decisión empieza
a desmontar: `src/middleware.ts` redirige por rol (`SUPERADMIN/MANAGER/
EMPLEADO`), pero **no** mira el host. La spec deja claro que el middleware
debe ser el primer punto de resolución de tenant.

---

## 2. Decisión

Adoptamos cinco decisiones encadenadas que cierran la capa de resolución de
tenant en la app Next.js.

### 2.1 Estructura del subdominio y slugs reservados

El espacio de subdominios bajo `ficha.tecnocloud.es` se reparte así:

| Host                              | Destino                                          |
|-----------------------------------|--------------------------------------------------|
| `<slug>.ficha.tecnocloud.es`      | App de un tenant. `<slug>` debe existir en `master.tenants` y estar `active` |
| `admin.ficha.tecnocloud.es`       | Panel super-admin. Auth independiente (ADR-007). Conexión con `master_role` |
| `app.ficha.tecnocloud.es`         | Landing pública, registro, checkout Stripe. Accede a `master.tenants` solo para crear filas, sin lectura de schemas tenant |
| `ficha.tecnocloud.es` (apex)      | Redirect 301 a `app.ficha.tecnocloud.es` para no servir contenido directamente desde el dominio raíz |

La lista de **slugs reservados** vive en una tabla del control plane,
**`master.reserved_slugs`**, no como constraint estática. Razón: la lista
crecerá con el tiempo (nuevos subdominios técnicos, marcas, productos
adicionales) y queremos poder añadir reservados desde el panel super-admin
sin migración.

```sql
CREATE TABLE master.reserved_slugs (
  slug         text PRIMARY KEY CHECK (slug = lower(slug)),
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

Un trigger BEFORE INSERT/UPDATE en `master.tenants` rechaza un slug presente
en `reserved_slugs`:

```sql
CREATE FUNCTION master.check_slug_not_reserved() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM master.reserved_slugs WHERE slug = NEW.slug) THEN
    RAISE EXCEPTION 'Slug reservado: %', NEW.slug
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tenants_slug_not_reserved
  BEFORE INSERT OR UPDATE OF slug ON master.tenants
  FOR EACH ROW EXECUTE FUNCTION master.check_slug_not_reserved();
```

Validación en API (zod en el flujo de registro) consulta también la tabla.
Doble capa, igual que la regex de ADR-001.

**Lista inicial** (insertada en seed de Fase 2):

```
admin, app, www, api, status, docs, mail, blog, ftp, smtp,
ns, ns1, ns2, root, support, help, login, signup, register,
billing, security, abuse, webmaster, postmaster, hostmaster,
hostinfo, no-reply, noreply, info, contact, sales, legal,
privacy, terms, dashboard, panel, control, master, public,
test, dev, staging, prod, production, demo
```

El trigger se replica para los **subdominios reservados de uso técnico**
(`admin`, `app`, `www`, `api`) que también están en `reserved_slugs` por
seguridad.

### 2.2 Lifecycle del contexto de tenant en la request

El slug del tenant viaja desde el middleware HTTP hasta el `$extends({ query
})` de Prisma vía **`AsyncLocalStorage` de Node.js**, no por headers
propagados ni por argumentos de función.

Justificación:

- `AsyncLocalStorage` (`node:async_hooks`) preserva el store a lo largo de
  toda la cadena de async/await iniciada dentro del `run`. No depende de que
  cada función reciba el slug como argumento.
- Funciona homogéneamente en route handlers, server components, server
  actions y dentro del middleware Prisma. Una sola fuente de verdad.
- Headers propagados (`x-tenant-slug`) son frágiles: Next puede clonar
  `Headers` entre layers, los server components no acceden a `request`
  directamente, y el middleware Prisma no tiene acceso al `request` de Next.

Implementación de referencia (vive en `src/lib/tenant/context.ts` en Fase 3):

```ts
import { AsyncLocalStorage } from "node:async_hooks";

type TenantContext = {
  slug: string;
  tenantId: string;
  status: TenantStatus;
};

const tenantStore = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStore.run(ctx, fn);
}

export function currentTenant(): TenantContext {
  const ctx = tenantStore.getStore();
  if (!ctx) {
    throw new Error("No hay tenant en contexto. ¿Olvidaste runWithTenant?");
  }
  return ctx;
}
```

**Aplicación de `SET search_path` por query, no por request**

El `SET search_path` lo emite un middleware Prisma `$extends({ query })` que
lee `currentTenant().slug` al inicio de cada query, lo enruta vía
`quoteSchemaName(slug)` (definido en §2.5 ADR-001) y emite la sentencia con
`Prisma.$executeRawUnsafe`. Crítico: **el `SET` se hace por query, nunca por
request**. Razón: si una request olvida invocar al middleware (porque alguien
hace una query desde un cron, un health check, un test mal escrito), no
hereda contexto de la request anterior — falla.

Si `currentTenant()` lanza porque no hay store, la query falla antes de
tocar BD. Esa es la propiedad que cierra ADR-001 §2.4 (el test de fuga
verifica este caso).

**RESET `search_path` al final de cada query: SÍ**

Patrón obligatorio: `SET → query → RESET` dentro de un `try/finally` en el
extend, con el RESET siempre ejecutándose aunque la query falle.

```ts
prisma.$extends({
  query: {
    $allOperations: async ({ args, query }) => {
      const { slug } = currentTenant();
      const schemaIdent = quoteSchemaName(slug); // §2.5 ADR-001
      try {
        await prisma.$executeRawUnsafe(
          `SET search_path TO ${schemaIdent}, public`
        );
        return await query(args);
      } finally {
        await prisma.$executeRawUnsafe("RESET search_path");
      }
    },
  },
});
```

Argumento del RESET:

- **Sin RESET**: la conexión que ejecutó la query queda devuelta al pool con
  `search_path` apuntando al schema del tenant. La siguiente request que
  recoja esa conexión y olvide pasar por el middleware (caso bug) hereda el
  contexto. Si esa request es de otro tenant, ahí está la fuga.
- **Con RESET**: cada conexión vuelve al pool en estado neutro (`public`).
  La siguiente query que la recoja siempre tiene que `SET` de nuevo, y si no
  pasa por el middleware, falla en `currentTenant()` antes de tocar BD.
- **Coste**: `RESET search_path` es prácticamente gratis (operación local en
  Postgres, sin I/O). La penalización de latencia es despreciable frente al
  beneficio en seguridad.

El patrón es defensa en profundidad. La barrera principal sigue siendo
`currentTenant()` falla si no hay store; el RESET es el cinturón de
seguridad.

> **ENMIENDA 5 (Fase 3 commit 17 — pivot del cliente del producto)**
>
> El diseño anterior ("un cliente Prisma único + `SET search_path` por
> query") **no funciona** con Prisma 7 + `@prisma/adapter-pg`. Verificado
> empíricamente en commit 17 (leak test) con log directo del SQL emitido:
>
> ```
> prisma:query SET search_path TO "tenant_acme", public   -- OK, ejecuta
> prisma:error permission denied for table User           -- falla aquí
> prisma:query RESET search_path                          -- OK
> ```
>
> Y la query SQL que Prisma envió:
>
> ```sql
> SELECT "public"."User"."id", "public"."User"."email", … FROM "public"."User"
> ```
>
> Aunque el modelo no lleve `@@schema(...)` y `multiSchema` esté apagado,
> el adapter cualifica con `"public"."User"` — `SET search_path` no
> afecta a queries con schema cualificado. Las opciones para no
> cualificar (sin `@@schema` y sin `multiSchema`) tampoco son fiables:
> Prisma 7 sigue inyectando un default que el adapter usa.
>
> **Pivot implementado** (`src/lib/prisma.ts`):
>
> - `prismaApp` es un **Proxy** sobre `PrismaClientTenant` que en cada
>   acceso de propiedad (`prismaApp.user`, `prismaApp.tienda`, …) lee
>   `currentTenant().slug` y devuelve el **cliente Prisma del tenant
>   correspondiente**, cacheado en `globalThis._tenantClients:
>   Map<slug, PrismaClientTenant>`.
> - Cada cliente se construye con `new PrismaPg(pool, { schema:
>   "tenant_<slug>" })`. El SQL emitido será
>   `SELECT … FROM "tenant_<slug>"."User"` — sin race con SET, sin
>   contaminación entre tenants concurrentes.
> - `getTenantSchemaName(slug)` invoca `quoteSchemaName(slug)` (ADR-001
>   §2.5) para validar el regex antes de pasar el schema literal a
>   `PrismaPgOptions`. Defensa en profundidad equivalente.
> - El `$extends({ query })` con `SET search_path` se ELIMINA. El
>   `RESET search_path` también — innecesario porque el SQL ya cualifica.
>
> **Implicaciones**:
>
> - **Memoria**: ~1 cliente Prisma + 1 pool `pg` por tenant activo en el
>   proceso. Para 10–100 tenants es manejable. A volumen >100 se añade
>   LRU + dispose (TODO Fase 9). Hasta entonces, el `Map` crece sin
>   límite — aceptable a 10–50 tenants.
> - **Concurrencia inter-tenant**: cada cliente tiene su propio pool, no
>   hay race condition entre tenants. Mejora respecto al diseño previo.
> - **Defensa escenario 1 del test de fuga (ADR-001 §2.4)**: el Proxy
>   llama `currentTenant()` en el `get` síncrono. Si no hay store, lanza
>   antes de devolver la propiedad — más temprano que con `$extends`.
>
> **Diseño funcionante de referencia** (commit 17 → cierre Fase 3):
>
> ```ts
> // Pseudocódigo simplificado de src/lib/prisma.ts
> function buildPrismaAppProxy(): PrismaClientTenant {
>   return new Proxy({} as PrismaClientTenant, {
>     get(_t, prop) {
>       const { slug } = currentTenant(); // lanza si no hay store
>       const cache = getTenantClientCache();
>       let client = cache.get(slug);
>       if (!client) {
>         const pool = new pg.Pool({ connectionString: APP_DATABASE_URL });
>         const adapter = new PrismaPg(pool, {
>           schema: getTenantSchemaName(slug), // valida con quoteSchemaName
>         });
>         client = new PrismaClientTenant({ adapter });
>         cache.set(slug, client);
>       }
>       const value = Reflect.get(client, prop);
>       return typeof value === "function" ? value.bind(client) : value;
>     },
>   });
> }
> ```
>
> Esta enmienda **sustituye** los párrafos de "Aplicación de SET
> search_path por query" y "RESET search_path al final de cada query"
> arriba para el cliente del producto. El resto de §2.2 (lifecycle del
> contexto via AsyncLocalStorage, `runWithTenant`/`currentTenant`)
> permanece válido — pero la propagación al handler tiene su propia
> enmienda en §3.5.

### 2.3 Caché in-memory de la resolución host→tenant

Estructura:

```ts
type CachedTenant = {
  tenantId: string;
  slug: string;
  status: "active" | "suspended" | "pending" | "deleted";
  expiresAt: number; // epoch ms
};

const tenantCache = new Map<string, CachedTenant>();
const TTL_MS = parseInt(process.env.TENANT_CACHE_TTL_MS ?? "60000", 10);
```

Clave de la caché: el **host completo** (`acme.ficha.tecnocloud.es`), no
solo el slug. Razón: la extracción del slug a partir del host ya es trabajo
del middleware; cachear por host evita repetirla y permite tener slugs
reservados (`admin`, `app`) cuyos hosts saltan la caché y van a su propia
ruta.

**Política de cache**:

- Cache hit con `expiresAt > now` → uso directo.
- Cache miss o expirado → query a `master.tenants WHERE slug = $1` con
  `master_role` (en realidad: con un rol de solo lectura sobre `master`,
  `app_role` no puede; ver §5.1). Validar status. Cachear resultado.
- Si el tenant **no existe** en `master.tenants`, cachear con un valor
  centinela `{ status: "deleted" }` y TTL más corto (`Math.min(TTL_MS, 5000)`)
  para no martillear la BD ante ataques de fuerza bruta sobre subdominios
  inexistentes.

**Invalidación entre instancias**: solo TTL. Es decir, si el panel
super-admin suspende un tenant, la suspensión surte efecto en **hasta 60
segundos** en cada instancia. Justificación:

| Opción                             | A favor                                                | En contra                                                                                      |
|------------------------------------|---------------------------------------------------------|------------------------------------------------------------------------------------------------|
| **TTL puro de 60s** (elegida)      | Simple. Cero infraestructura. Determinista              | Latencia de hasta 60s entre suspensión y bloqueo efectivo en todas las instancias              |
| `LISTEN`/`NOTIFY` de Postgres      | Sin Redis. Casi instantáneo                             | Conexión Postgres dedicada por instancia. Reconexión y errores a gestionar. Complejidad operativa |
| Pub/sub Redis                      | Diseño estándar                                         | Redis no quería entrar día 1 (§10.4 auditoría). Trae HA, backup, monitoring                    |
| Broadcast HTTP entre instancias    | Sin infra extra                                         | Hay que descubrir las instancias detrás de Traefik. Frágil                                     |

Para 10–100 tenants y 2–4 instancias detrás de Traefik, una latencia de 60s
en la suspensión es **operativamente aceptable**: la suspensión no es una
acción frecuente, y el panel super-admin puede mostrar "los cambios surten
efecto en hasta un minuto". Cuando llegue Fase 4 con worker, si Redis entra
para queues, se reconsidera (TODO en §5.3).

Configurable vía `TENANT_CACHE_TTL_MS` en `.env` por si se quiere bajar
puntualmente para soporte.

### 2.4 Estados del tenant y respuesta HTTP

El campo `master.tenants.status` es un enum con **cinco** valores. Cada
uno implica un comportamiento distinto en el middleware **antes** de
llegar a la app del producto. Orden cronológico del lifecycle del tenant:

| Estado          | HTTP             | Comportamiento                                                                                    |
|-----------------|------------------|---------------------------------------------------------------------------------------------------|
| `pending`       | **503 Service Unavailable** + `Retry-After: 30` | Tenant insertado en `master.tenants` pero sin checkout completado. Página "esperando confirmación de pago" |
| `provisioning`  | **503 Service Unavailable** + `Retry-After: 30` | Subscription en Stripe creada, worker aplicando la coreografía de provisión. Página "Estamos preparando tu cuenta, vuelve en unos segundos" |
| `active`        | (continúa)       | Continúa la request normalmente. `runWithTenant({ slug, tenantId, status })` envuelve la handler |
| `suspended`     | **402 Payment Required** | Página explicativa (impago, suspensión manual). **No** se accede al schema del tenant. **No** se ejecuta `runWithTenant` |
| `deleted`       | **410 Gone**     | El tenant fue borrado. Schema sigue existiendo hasta que el job de borrado lo limpie. **Sin** `Retry-After`. Definitivo |

`provisioning` (introducido por ADR-003 §2.6) significa que la subscription
en Stripe se ha creado y el worker está aplicando la coreografía de
provisión (crear schema, aplicar migraciones, crear primer OWNER). El 503
con `Retry-After: 30` hace que navegadores y clientes HTTP reintenten
automáticamente cada 30 segundos. La duración típica es <5 segundos para
19 modelos; si supera 10 minutos, el job de detección de PROVISIONING
huérfanos (ADR-003 §5.2) escala al super-admin. Ver ADR-003 §1 y §2.6
para el contexto completo de este estado.

Para hosts cuyo slug **no existe** en `master.tenants` (incluyendo subdominios
inventados), el middleware responde **404 Not Found** sin distinguir entre
"nunca existió" y "fue borrado y purgado". No revelar la existencia o
historia de tenants.

Para hosts reservados (`admin`, `app`, `www`), el middleware no consulta
`master.tenants`: enruta directamente al destino correspondiente.

### 2.5 JWT con `tenant_id` validado contra el host

NextAuth (v5 beta) emite el JWT en el flujo de login del subdominio del
tenant. El callback `jwt` añade dos claims:

```ts
async jwt({ token, user }) {
  if (user) {
    token.tenantId = currentTenant().tenantId;
    token.tenantSlug = currentTenant().slug;
    // ...resto: id, rol, etc.
  }
  return token;
}
```

**Validación cruzada en el middleware**, en cada request autenticada:

- `token.tenantSlug !== resolvedSlug` → **401 Unauthorized**, no 403.
- Razón: 403 revelaría que el otro tenant existe. 401 dice "esta sesión no
  vale aquí" sin información lateral.

**Cookie scope: subdominio específico, NO dominio raíz**

NextAuth por defecto pone la cookie de sesión con `domain` igual al host.
Lo dejamos así: `acme.ficha.tecnocloud.es` recibe cookie host-only, no
visible desde `otrocliente.ficha.tecnocloud.es`. Configuración explícita en
`auth.config.ts`:

```ts
cookies: {
  sessionToken: {
    name: "__Host-next-auth.session-token",
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      // domain omitido → cookie host-only
    },
  },
},
```

Con prefijo `__Host-`: el navegador rechaza cualquier cookie con `domain`
distinto del host actual. Doble cinturón.

Implicación: una sesión iniciada en `acme.ficha.tecnocloud.es` **no** es
visible desde `otra.ficha.tecnocloud.es`. Cada tenant tiene sus propias
sesiones aisladas.

> El **panel super-admin** (`admin.ficha.tecnocloud.es`) tiene su propia
> auth, su propio JWT con `aud: "platform"` y su propia cookie con scope
> `admin.ficha.tecnocloud.es`. Eso queda fuera de este ADR; lo cierra
> ADR-007 (auth super-admin). Aquí solo se menciona para que conste que
> NextAuth del producto **no** emite tokens válidos para el panel.

---

## 3. Opciones consideradas

### 3.1 Almacenamiento de slugs reservados

| Opción                                    | A favor                                              | En contra                                                                       |
|-------------------------------------------|------------------------------------------------------|---------------------------------------------------------------------------------|
| `CHECK` constraint con regex hardcoded    | Sin tabla extra. Estático y rápido                   | Cambiar la lista exige migración. No editable desde panel super-admin           |
| **Tabla `master.reserved_slugs` + trigger** | Editable runtime. Auditable. Razón asociada por slug  | Trigger BEFORE INSERT mira otra tabla → coste muy bajo en una operación rara    |
| Validación solo en API (zod)              | Cero acoplamiento BD                                 | No protege contra inserción directa en BD                                       |

Elegida la tabla por flexibilidad. Doble validación (API + trigger BD) es la
misma estrategia de defensa en profundidad de §2.5 ADR-001.

### 3.2 Inyección del contexto de tenant

| Opción                              | A favor                                                            | En contra                                                                                |
|-------------------------------------|---------------------------------------------------------------------|------------------------------------------------------------------------------------------|
| **`AsyncLocalStorage`** (elegida)   | Nativo Node. Funciona en server components, route handlers, $extends sin propagación manual | Requiere `runWithTenant` envolviendo el handler. Patrón a documentar para todos los devs |
| Headers propagados (`x-tenant-slug`)| Sin async hooks                                                      | Frágil entre layers de Next. No accesible desde middleware Prisma                        |
| Argumento explícito en cada función | 100% explícito                                                       | Inviable: 46 endpoints + N libs. Cambio masivo, propenso a errores                       |

### 3.3 RESET search_path

| Opción                  | A favor                                                  | En contra                                                                                                |
|-------------------------|----------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| Sin RESET               | La query siguiente del mismo tenant evita un round-trip  | Conexiones devueltas al pool quedan con search_path heredado. Una query bug fuera del middleware → fuga  |
| **Con RESET** (elegida) | Conexiones siempre limpias en el pool                     | Cada query paga un `RESET`. Operación local en Postgres sin I/O, despreciable frente a la latencia de cualquier query real |

### 3.4 Invalidación de la caché entre instancias

| Opción                          | Latencia tras suspensión | Complejidad operativa     | Decisión                  |
|---------------------------------|---------------------------|---------------------------|---------------------------|
| **TTL puro de 60s** (elegida)   | Hasta 60s                 | Cero                      | Sí, día 1                 |
| `LISTEN`/`NOTIFY` Postgres      | <1s                       | Conexión dedicada por instancia, manejo de reconexión | TODO Fase 4–5 si hace falta |
| Pub/sub Redis                   | <100ms                    | Redis con HA y backup     | No día 1 (§10.4 auditoría) |
| Broadcast HTTP entre instancias | Variable                  | Discovery de instancias   | Descartada                 |

### 3.5 Validación JWT vs host

| Opción           | A favor                                  | En contra                                                                |
|------------------|-------------------------------------------|--------------------------------------------------------------------------|
| **401** (elegida) | No revela existencia del otro tenant     | El usuario puede confundirse con "credenciales mal" cuando es slot wrong |
| 403              | Más preciso semánticamente                | Filtra que el otro tenant existe                                         |
| Redirect al subdominio correcto | UX cómoda           | Convierte un cross-tenant en un tenant-discovery oracle                  |

> **ENMIENDA 6 (Fase 3 cierre §11.3 — propagación de contexto + JWT)**
>
> Verificación empírica en runtime real (`next dev` + `dev.localhost`)
> demostró que **Next 16 NO propaga `AsyncLocalStorage` del `proxy.ts`
> al handler de la ruta API** (continuaciones distintas). El log de
> Next lo confirma:
>
> ```
> GET /api/dashboard 500 in 168ms (proxy.ts: 4ms, application-code: 55ms)
> Error: No hay tenant en el contexto.
>     at currentTenant
>     at Object.get (prismaApp Proxy)
>     at GET (src/app/api/dashboard/route.ts)
> ```
>
> El `runWithTenant` que el proxy.ts envolvía no llegaba al handler.
> Mismo patrón observado con `authorize` de NextAuth (corre en una
> continuación interna de Auth.js que tampoco hereda el store).
>
> **Pivot implementado**:
>
> - **Cada handler de ruta API** se envuelve con un HOF
>   `withTenant` (`src/lib/tenant/with-tenant.ts`):
>
>   ```ts
>   import { withTenant } from "@/lib/tenant/with-tenant";
>   export const GET = withTenant(async (req) => {
>     // currentTenant() funciona aquí. prismaApp también.
>   });
>   ```
>
>   `withTenant` lee `req.headers.get("host")`, ejecuta
>   `resolveTenant(host)` (cache hit del resolver, sin BD si el proxy
>   ya lo cacheó), valida status (404/503/402/410), JWT
>   cross-validation, y reanida `runWithTenant`.
>
> - **`proxy.ts` mantiene** `resolveTenant` + cache + status check +
>   redirect 301 apex→app + auth wrapping para el redirect /login en
>   páginas (defensa en profundidad — el handler también valida).
>
> - **`proxy.ts` ELIMINA**: el `runWithTenant` envolvente (no
>   propagaba) y el JWT cross-validation (movido al HOF).
>
> - **JWT cross-validation** se ejecuta dentro del HOF: `getToken({
>   req, secret: AUTH_SECRET })` → si `token.tenantSlug` existe y no
>   coincide con `ctx.slug` → 401 (mantenemos la decisión de §3.5
>   tabla arriba: 401, no 403).
>
> - **Endpoints exentos** (no usan `withTenant`):
>   - `/api/auth/[...nextauth]` — NextAuth gestiona su propio handler.
>   - `/api/setup`, `/api/setup/reset` — legacy mono-tenant,
>     eliminados en Fase 4.
>   - `/api/webhooks/**` — Fase 4, no son de tenant.
>   - `/api/admin/**` — Fase 7, panel super-admin con su propio
>     contexto.
>
>   Whitelist explícita en `eslint.config.mjs` (regla `fichaje/no-legacy-prisma`).
>
> - **`authorize` de NextAuth (caso especial)**: corre en continuación
>   interna fuera del flujo del proxy y de los handlers. Mitigación
>   local en `src/lib/auth.ts`:
>
>   ```ts
>   async authorize(credentials, req) {
>     const host = req.headers?.get("host") ?? "";
>     const resolved = await resolveTenant(host);
>     if (resolved.kind !== "tenant" || resolved.ctx.status !== "active") return null;
>     return await runWithTenant(resolved.ctx, async () => {
>       // prisma.user.findUnique, bcrypt.compare, return { …, tenantId, tenantSlug }
>     });
>   }
>   ```
>
> **Verificación E2E** (cierre Fase 3):
>
> ```
> POST /api/auth/callback/credentials  → 302 + session-token cookie ✅
> GET  /api/dashboard (cookie session) → 200 con datos del tenant_dev ✅
> GET  /api/empleados (cookie session) → 200 con admin@dev.local ✅
> GET  /api/tiendas   (cookie session) → 200 con [] ✅
> ```
>
> Esta enmienda **complementa** la decisión §3.5 sobre el código HTTP
> (401) — solo cambia **dónde** se aplica la validación (HOF en lugar
> de proxy).

### 3.6 Cómo accede el middleware a `master.tenants` para resolver el slug — y quién escribe contadores de quota

ADR-001 §2.3 fija dos roles Postgres (`master_role`, `app_role`) con
permisos disjuntos: la app del producto se conecta con `app_role`, que
**no tiene** acceso a `master`. Pero el middleware HTTP necesita resolver
`host → tenant` consultando `master.tenants` (y, tras ADR-004, también
precargar features y consumir quotas). ¿Con qué rol o roles?

| Opción                                                                                                                                       | Pro                                                                                                                          | Contra                                                                                                                                                          |
|----------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Dos roles separados: `tenant_runtime_role` (lectura) + `quota_writer_role` (escritura)** (elegida)                                          | Menor privilegio estricto. El middleware HTTP **solo lee**. La escritura sobre `tenant_quota_usage` está aislada en un rol que solo se usa desde `consumeQuota` (ADR-004 §2.5) | Tres URLs en `.env` (master, runtime, quota_writer). Tres clientes Prisma adicionales sobre `app_role`. Regla ESLint custom para evitar uso indebido del writer  |
| Un solo rol con read+write (lo que ADR-002 inicialmente proponía como `tenant_resolver_role` ampliado)                                       | Una URL menos                                                                                                                | Vector DoS: un compromiso del middleware permitiría poner `consumed = max` en quotas de competidores. ADR-004 §3.1 lo descarta con argumento explícito          |
| `master_role` para todo el lookup                                                                                                            | 2 roles, no 3-4                                                                                                              | El lookup corre con un rol que puede escribir en todo `master`. Compromiso del middleware → escala a control plane completo                                     |
| Función SQL `master.resolve_tenant(slug)` con `SECURITY DEFINER`, `app_role` invoca                                                          | 2 roles, sin URL extra                                                                                                        | Stored procedure que mantener fuera de Prisma, complica testing y migraciones. Cierra `consumeQuota` con menos garantías de atomicidad sobre el contador        |
| Vista `master.public_tenants` con `GRANT SELECT` a `app_role`                                                                                | 2 roles, sin cliente Prisma extra                                                                                             | Acopla `app_role` a `master`. Viola el espíritu de aislamiento de ADR-001 §2.3: el principio era `app_role` **no** toca `master`                                |

**Argumento decisivo**: el middleware HTTP es el componente con mayor
superficie de ataque del sistema. Si se compromete, el rol Postgres con
el que opera define el blast radius. `tenant_runtime_role` limita ese
radio a `SELECT` sobre 4 tablas concretas (`master.tenants`,
`master.reserved_slugs`, `master.tenant_features`,
`master.tenant_quota_usage`). La escritura sobre `tenant_quota_usage`
—vector de DoS contra competidores específicos— vive en
`quota_writer_role` aislado, usado solo desde el helper `consumeQuota`
(ADR-004 §2.5). Cualquier alternativa que reutilice `master_role` o que
dé acceso de `app_role` a `master` amplía el radio sin compensación.

> **Nota histórica**: este ADR-002 introdujo originalmente un único
> `tenant_resolver_role` con `SELECT` sobre 2 tablas. ADR-004 §2.2
> amplió los permisos necesarios y separó lectura y escritura en dos
> roles. Esta sección refleja el estado final tras esa enmienda.

---

## 4. Consecuencias

### 4.1 Positivas

- **Resolución determinista por host**. Un tenant existe si y solo si el
  middleware lo encuentra `active` en `master.tenants`. Cualquier otro
  estado tiene una respuesta HTTP definida y una página propia.
- **Contexto inmutable durante la request**. `AsyncLocalStorage` garantiza
  que ninguna parte del código pueda "saltar" a otro tenant a mitad de la
  request: `currentTenant()` devuelve siempre el mismo valor.
- **Cero infra adicional día 1**. Caché in-memory + TTL es código puro, sin
  Redis, sin Postgres pub/sub. Encaja con la decisión §10.4 auditoría.
- **Sesiones aisladas por tenant**. Cookie host-only + `__Host-` prefix +
  validación cruzada en middleware: tres barreras antes de poder suplantar
  otro tenant con un JWT.
- **Defensa en profundidad sobre el SQL**. La validación del slug viene
  cerrada de §2.5 ADR-001; aquí se ejecuta sobre slugs ya verificados que
  existen en `master.tenants`.

### 4.2 Negativas (asumidas)

- **Latencia de hasta 60s en una suspensión**. Si el panel super-admin
  suspende un tenant, una instancia con la entrada en caché seguirá
  sirviendo durante hasta TTL_MS. Mitigación documentada: el panel muestra
  "los cambios pueden tardar hasta un minuto en surtir efecto en todas las
  instancias". Plan B con `LISTEN`/`NOTIFY` queda como TODO.
- **Cada query paga `SET → RESET`** sobre `search_path`. Coste local en
  Postgres sin I/O, despreciable frente a la latencia de cualquier query
  real (round-trip al pgbouncer + a Postgres son órdenes de magnitud
  mayores). Si medimos contención real en producción, queda como punto de
  optimización para Fase 9: batch SET por transacción para múltiples
  queries del mismo tenant —SET una vez al inicio, RESET una vez al final
  de la transacción— en lugar de por query individual.
- **`AsyncLocalStorage` impone un patrón de programación**. Toda lógica de
  acceso a BD del tenant debe correr **dentro** de un `runWithTenant`. Si
  alguien añade un cron, un job, un script CLI que ejecute queries del
  producto, debe envolver. Documentado, pero hay riesgo de olvido.
- **Cookie host-only complica el SSO entre tenants**. No es un caso
  buscado: cada tenant es una empresa distinta, no se comparten sesiones.
  Se documenta como "feature, no bug".
- **Slugs reservados consumen espacio del namespace**. `acme` no puede
  llamarse `app`, `www`, `admin`, `api`, etc. Lista pública en docs para
  que onboarding lo valide en el formulario antes de llegar a checkout.

### 4.3 Neutras

- **Caché por host (no por slug)**. Tiene la ventaja de evitar parsear el
  host dos veces, pero significa que `acme.ficha.tecnocloud.es` y
  `acme.staging.tecnocloud.es` (si algún día existe staging multi-tenant)
  son entradas independientes. Coherente con que cada despliegue tiene su
  propio control plane.
- **Estado `deleted` mantiene el schema en BD**. Hasta que el job de borrado
  lo procese (Fase 5+ probablemente), el espacio sigue ocupado. No es coste
  significativo para 10–100 tenants.
- **El apex (`ficha.tecnocloud.es` sin subdominio) hace 301 a
  `app.ficha.tecnocloud.es`**. Esto rompe la URL "limpia" actual del único
  tenant en producción. El plan de cutover (Fase 8) gestiona la transición:
  durante un periodo el apex puede servir el tenant primigenio; tras el
  switch, redirect al landing.

---

## 5. Implicaciones para fases siguientes

### 5.1 Fase 2 — Control plane

- Tabla `master.reserved_slugs` con la lista inicial sembrada.
- Trigger `tenants_slug_not_reserved` en `master.tenants`.
- Enum `TenantStatus { ACTIVE, SUSPENDED, PENDING, DELETED }` en master.
- La opción elegida en §3.6 (cuatro roles Postgres en total) se
  materializa en Fase 3 con dos roles adicionales sobre `master_role` y
  `app_role`:
  - `tenant_runtime_role`: `SELECT` sobre `master.tenants`,
    `master.reserved_slugs`, `master.tenant_features` y
    `master.tenant_quota_usage` (read-only).
  - `quota_writer_role`: `SELECT/INSERT/UPDATE` solo sobre
    `master.tenant_quota_usage` (escritura aislada, usada
    exclusivamente desde el helper `consumeQuota` de ADR-004 §2.5).

  La app abre dos clientes Prisma adicionales: **`prismaRuntime`** (para
  el lookup HTTP, precarga de features y `getLimit`) y
  **`prismaQuotaWriter`** (para `consumeQuota` exclusivamente). El uso
  indebido de `prismaQuotaWriter` fuera de `src/lib/tenant/features.ts`
  se vigila con la regla ESLint custom `no-quota-writer-leak` (ADR-004
  §2.2).

### 5.2 Fase 3 — Resolución de tenant y refactor del producto

- `src/middleware.ts` reescrito: extracción de host, lookup en caché,
  fallback a `prismaRuntime`, validación de status, validación cruzada
  con JWT, despacho con `runWithTenant`.
- `src/lib/tenant/context.ts` con `runWithTenant` y `currentTenant`.
- `src/lib/tenant/cache.ts` con la `Map<host, CachedTenant>` y limpieza
  perezosa al hit (entradas expiradas se eliminan al consultarlas).
- `src/lib/prisma.ts` reescrito con `$extends({ query })` que aplica
  `SET → query → RESET` con `quoteSchemaName(currentTenant().slug)`.
- Test de fuga (§2.4 ADR-001) con los 4 escenarios.

### 5.3 Fase 4 — Onboarding, worker y revisión de invalidación de caché

- El flujo de registro inserta en `master.tenants` con `status = PENDING` y
  validación de slug en doble capa (zod + trigger BD + lookup en
  `reserved_slugs`).
- El webhook `checkout.session.completed` cambia `status` a `ACTIVE` tras
  provisión completa (schema creado, migraciones aplicadas, primer OWNER
  insertado). Las instancias verán el cambio en la siguiente expiración de
  caché (≤ 60s).
- **Revisión de la decisión §2.3**: si en Fase 4 entra Redis para queues
  (BullMQ para webhooks Stripe), reconsiderar usar el mismo Redis para
  invalidación de caché de tenant (pub/sub). El TODO se cierra entonces, no
  ahora.

### 5.4 Fase 8 — Migración del despliegue Dokploy

- pgbouncer en **session pooling** (cerrado en ADR-005, refleja también
  desde ADR-001 §5.3). El patrón `SET → RESET` por query asume sesión
  estable durante la query, no transaction-level pooling.
- Variables `.env` nuevas:
  - `TENANT_CACHE_TTL_MS=60000` (configurable por entorno).
  - `TENANT_RUNTIME_DATABASE_URL=postgresql://tenant_runtime_role:…@…/…`
    (rol de **solo lectura** sobre `master.tenants`,
    `master.reserved_slugs`, `master.tenant_features` y
    `master.tenant_quota_usage`).
  - `QUOTA_WRITER_DATABASE_URL=postgresql://quota_writer_role:…@…/…`
    (rol con `SELECT/INSERT/UPDATE` **solo** sobre
    `master.tenant_quota_usage`).
- SQL de creación con permisos finales (los `GRANT` van con
  `master_role`):

  ```sql
  CREATE ROLE tenant_runtime_role LOGIN PASSWORD '****';
  GRANT USAGE ON SCHEMA master TO tenant_runtime_role;
  GRANT SELECT ON master.tenants            TO tenant_runtime_role;
  GRANT SELECT ON master.reserved_slugs     TO tenant_runtime_role;
  GRANT SELECT ON master.tenant_features    TO tenant_runtime_role;
  GRANT SELECT ON master.tenant_quota_usage TO tenant_runtime_role;

  CREATE ROLE quota_writer_role LOGIN PASSWORD '****';
  GRANT USAGE ON SCHEMA master TO quota_writer_role;
  GRANT SELECT, INSERT, UPDATE ON master.tenant_quota_usage TO quota_writer_role;
  -- Sin acceso a tenants, reserved_slugs, tenant_features, subscriptions,
  -- stripe_events, super_admins, audit_log, ni a ningún otro objeto.
  ```

- Clientes Prisma asociados:
  - `prismaRuntime` con `TENANT_RUNTIME_DATABASE_URL`. Lo usa el
    middleware HTTP, `hasFeature`, `getLimit`, `GET /api/me/features`.
  - `prismaQuotaWriter` con `QUOTA_WRITER_DATABASE_URL`. Lo usa
    **exclusivamente** `consumeQuota` (ADR-004 §2.5).
- Healthcheck endpoint: verificación de las dos conexiones nuevas
  (`tenant_runtime_role`, `quota_writer_role`) además de las dos de
  ADR-001 (`master_role`, `app_role`). Total: 4 conexiones validadas en
  `/api/health` (ADR-005 §2.6).

---

## 6. Criterios de aceptación

Esta decisión se considera implementada cuando, al término de Fase 3, todos
los siguientes son ciertos:

1. Existe `master.reserved_slugs` con la lista inicial sembrada y el
   trigger en `master.tenants` rechaza inserts cuyo slug coincida.
2. `tenant_runtime_role` y `quota_writer_role` existen con los permisos
   exactos de §3.6 y §5.4. Verificado con dos tests negativos:
   `tenant_runtime_role` recibe `permission denied` al intentar
   `INSERT INTO master.tenant_quota_usage` y al intentar
   `SELECT * FROM master.subscriptions`; `quota_writer_role` recibe
   `permission denied` al intentar `SELECT * FROM master.tenants`.
   `prismaQuotaWriter` solo se importa desde `src/lib/tenant/features.ts`
   (verificado con la regla ESLint `no-quota-writer-leak`).
3. `runWithTenant({ slug, tenantId, status }, fn)` envuelve el route
   handler en cada request a un host de tenant. Sin él, `currentTenant()`
   lanza.
4. El middleware Prisma `$extends({ query })` aplica `SET search_path TO
   "tenant_<slug>", public` al inicio de cada query y `RESET search_path`
   en el `finally`. La aplicación del SET pasa por `quoteSchemaName`
   (§2.5 ADR-001).
5. El test de fuga (§2.4 ADR-001) pasa con los 4 escenarios contra
   Postgres real con dos schemas sembrados.
6. El middleware HTTP responde **404** para slug inexistente, **402** para
   `suspended`, **503** + `Retry-After: 30` para `pending`, **410** para
   `deleted`, sin filtrar la diferencia entre "nunca existió" y "purgado".
7. Una sesión iniciada en `acme.ficha.tecnocloud.es` no es enviada por el
   navegador a `otra.ficha.tecnocloud.es` (verificado con cookie con
   prefijo `__Host-` y sin atributo `domain`).
8. Un JWT con `tenantSlug = "acme"` invocado contra
   `otra.ficha.tecnocloud.es` recibe **401** (no 403 ni redirect).
9. La caché in-memory expira a `TENANT_CACHE_TTL_MS`. Test de integración
   verifica: cambiar `tenants.status` a `SUSPENDED` desde fuera, comprobar
   que la siguiente request con caché viva sigue pasando; tras el TTL, la
   request recibe 402.
10. La consulta de un slug **no existente** queda en caché negativa con TTL
    corto (≤ 5s), evitando martilleo al BD.

---

## 7. Referencias

- [`docs/arch/00-auditoria.md`](./00-auditoria.md), §10.3 (search_path por
  query), §10.4 (Redis no día 1), §7 acoplamientos del middleware actual.
- [ADR-000](./adr-000-vision-saas.md) — visión SaaS.
- [ADR-001](./adr-001-aislamiento-multi-tenant.md), §2.3 (roles Postgres),
  §2.4 (test de fuga, escenario 4 inyección por slug), §2.5 (construcción
  segura del schema name), §5.4 (worker dual-rol).
- [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md),
  apartado 2 (identificación por subdominio), apartado 3 (resolución de
  contexto), Fases 3 y 4.
- ADR-005 (deployment + TLS) — pendiente, cierra pgbouncer en session
  pooling y la opción TLS-A (Cloudflare DNS-01 wildcard).
- ADR-007 (auth super-admin) — pendiente, cierra el panel
  `admin.ficha.tecnocloud.es` con su propio cookie scope y JWT con
  `aud: "platform"`.
- Node.js docs:
  [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html#class-asynclocalstorage).
- Prisma docs:
  [client extensions](https://www.prisma.io/docs/orm/prisma-client/client-extensions),
  [`$extends` query](https://www.prisma.io/docs/orm/prisma-client/client-extensions/query).
- MDN:
  [`__Host-` cookie prefix](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes).
- PostgreSQL docs:
  [`LISTEN`/`NOTIFY`](https://www.postgresql.org/docs/current/sql-listen.html)
  (referencia para el TODO de invalidación).
