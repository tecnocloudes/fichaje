# ADR-001 — Aislamiento multi-tenant: schema-per-tenant en una sola DB con dos roles Postgres

- **Estado**: Accepted
- **Fecha**: 2026-04-29
- **Decisores**: Daniel Sánchez (`@tecnocloudes`)
- **Spec maestra**: [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md)
- **Visión**: [ADR-000](./adr-000-vision-saas.md)
- **Bounded contexts afectados**: `control-plane`, `tenant-resolution`, `fichaje`, `super-admin`
- **Sucede a**: ninguno
- **Bloquea a**: ADR-002 (resolución de tenant), ADR-005 (deployment + TLS), Fases 2, 3, 8

---

## 1. Contexto

El producto `fichaje` es hoy una aplicación **mono-tenant**, con un único schema
PostgreSQL (`public`) y un único cliente Prisma. La migración a SaaS exige un
mecanismo de **aislamiento de datos entre tenants** que cumpla tres requisitos:

1. **Cero fuga cross-tenant** garantizada por construcción, no por convención
   en código de aplicación.
2. **Operaciones GDPR/RGPD** simples (borrado completo de un cliente, export
   de sus datos).
3. **Backups por tenant**, dado que las restauraciones puntuales son habituales
   en producto laboral (incidentes con datos de nóminas, errores de admin de
   tenant, pruebas de inspección).

El estado actual del repositorio condiciona la decisión. La auditoría de Fase 0
(`docs/arch/00-auditoria.md`) inventarió **46 endpoints** en `src/app/api/` que
ejecutan queries Prisma directamente, sin ninguna noción de tenant. Migrar a un
modelo `shared schema` con columna `tenant_id` implicaría revisar todas esas
queries y añadirles un `where: { tenantId }`. Cualquier olvido —en una nueva
ruta, en un script, en un job— produce **fuga inmediata** entre tenants. Prisma
no aplica automáticamente RLS de Postgres, así que la barrera de RLS exige
trabajo extra en cada conexión (`SET app.tenant_id` por request) que el repo no
hace hoy. Añadir `tenantId` a las ~50 queries afectadas es viable pero propenso
a errores: un solo `where` olvidado fuga datos cross-tenant. Schema-per-tenant
elimina esa clase de bug por construcción —no se puede "olvidar el filtro"
cuando el filtro es el schema en el que la conexión está apuntando.

El volumen previsto es **10–100 tenants en los primeros 12 meses**. Este número
es importante: descarta soluciones pensadas para miles de tenants (donde
schema-per-tenant satura el catálogo de Postgres) y permite asumir el coste
operativo de aplicar migraciones DDL a N schemas. Es también el rango en el que
no compensa escalar a varias instancias de Postgres ni a contenedores
dedicados por tenant.

La infraestructura ya existente (Dokploy + un Postgres provisionado en el
mismo proyecto) es otro condicionante. Provisionar una segunda instancia de
Postgres dedicada al control plane introduce complejidad operativa adicional
(otro backup, otra HA, otra red interna) sin ganancia clara a este volumen.

Finalmente, hay un riesgo de seguridad latente que esta decisión debe
considerar: el `super_admins` del control plane tendrá, por necesidad, acceso
de lectura a los datos de cualquier tenant para dar soporte. Si la app del
producto y el control plane comparten el mismo rol Postgres, una fuga en la
app del producto compromete también el control plane (datos de suscripción,
métricas internas, otros tenants). La separación de roles es por tanto **una
decisión de seguridad**, no solo un detalle de DBA.

La decisión **no es obvia**. Schema-per-tenant tiene contras reales (DDL × N,
caveats de pgbouncer, roles Postgres a gestionar) que se asumen explícitamente.

---

## 2. Decisión

Adoptamos cuatro decisiones encadenadas que conforman la postura de
aislamiento del producto en su versión SaaS:

### 2.1 Aislamiento de datos: **schema-per-tenant**

Cada tenant tiene su propio schema PostgreSQL `tenant_<slug>` con la totalidad
de las tablas del producto (todos los modelos hoy en `prisma/schema.prisma`,
excepto los que vivan en el control plane).

La consulta de un tenant se enruta a su schema vía `SET search_path`
(mecanismo concreto en ADR-002). El tenant ve únicamente su schema; el código
del producto no lleva ni propaga `tenant_id` por las queries.

### 2.2 Topología de base de datos: **una sola DB con `master` + `tenant_<slug>`**

Una única instancia PostgreSQL alberga el schema `master` (control plane:
`tenants`, `plans`, `features`, `plan_features`, `tenant_features`,
`subscriptions`, `super_admins`, `webhook_events`, `audit_log`) y todos los
schemas `tenant_<slug>`.

No se separa en dos DBs (`fichaje_master` + `fichaje_app`). Una sola DB
permite reaprovechar la instancia ya provisionada, simplifica backups,
permite transacciones cross-schema en operaciones de provisión (insertar en
`master.tenants` y `CREATE SCHEMA tenant_<slug>` en la misma transacción) y
opera con un único pool de conexiones.

### 2.3 Dos roles Postgres: **`master_role`** y **`app_role`**

Se crean dos roles disjuntos en la instancia Postgres:

- **`master_role`**: propietario del schema `master`. Lectura/escritura
  exclusiva sobre el control plane. **Sin** `USAGE` automático sobre los
  schemas `tenant_*`. El acceso de soporte (impersonación, auditoría) a
  schemas de tenant se concede explícitamente por operación, no de forma
  permanente.
- **`app_role`**: rol con `USAGE` y `CRUD` sobre cualquier schema `tenant_*`,
  presente y futuro. **Sin** `USAGE` ni `SELECT` sobre el schema `master`. La
  app del producto se conecta exclusivamente con este rol.

Implementación con `DEFAULT PRIVILEGES`:

```sql
-- Al crear un nuevo schema tenant
CREATE SCHEMA "tenant_acme" AUTHORIZATION master_role;
GRANT USAGE ON SCHEMA "tenant_acme" TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "tenant_acme"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA "tenant_acme"
  GRANT USAGE, SELECT ON SEQUENCES TO app_role;

-- master queda fuera del alcance de app_role
REVOKE ALL ON SCHEMA master FROM PUBLIC;
GRANT USAGE ON SCHEMA master TO master_role;
```

La app del producto recibe `APP_DATABASE_URL` con credenciales de `app_role`.
El panel super-admin (Fase 7) recibe `MASTER_DATABASE_URL` con credenciales
de `master_role`. Ambos URL en el mismo Postgres físico, distintos roles.

### 2.4 Aceptación: **test de fuga obligatorio en Fase 3**

Antes de cerrar Fase 3 debe existir un test de integración —no unitario, no
mock— que verifique con dos schemas reales que:

- Una query ejecutada **sin tenant en contexto** (sin haberse aplicado el
  `SET search_path` correspondiente) **falla** o devuelve 0 filas, **nunca**
  filas de otro tenant.
- Una query del tenant A **no** ve datos del tenant B aunque ambos schemas
  contengan registros con los mismos identificadores naturales (mismo email,
  mismo DNI).
- Un endpoint del producto invocado con un JWT cuyo `tenant_id` no coincide
  con el host del request **no** ejecuta ninguna query (rechazado en
  middleware antes de llegar a Prisma).
- **Escenario 4 — Inyección por slug malicioso**: un slug con caracteres
  fuera de la regex (ej: `tenant_; DROP SCHEMA public CASCADE; --`) debe ser
  rechazado en validación. El test inserta directamente en `master.tenants`
  un slug malicioso bypaseando la API, intenta resolverlo, y verifica que
  la función de resolución lanza error **antes** de llegar al `SET`.
  Severidad: bloqueante para release.

Este test es el criterio bloqueante de aceptación de Fase 3. Sin él Fase 4 no
arranca. Tooling concreto se cierra en Fase 9 (propuesta provisional: Vitest
+ `@testcontainers/postgresql` para Postgres efímero por suite).

### 2.5 Construcción segura del schema name

`SET search_path TO tenant_${slug}` es un vector de inyección SQL si el slug
llega desde input no validado al constructor del SQL. La decisión §2.1 obliga
a que el slug forme parte del nombre de un identificador SQL —no de un
literal— y los identificadores no pueden parametrizarse con `$1`. Para
neutralizar el riesgo aplicamos tres reglas, las tres obligatorias:

**Regla 1 — Validación de slug al insertar en `master.tenants`**

El slug debe satisfacer la regex `^[a-z][a-z0-9_]{2,30}$`:

- Empieza por letra minúscula (no por número, no por guion).
- Solo `[a-z0-9_]` en el resto (sin mayúsculas, sin guiones, sin
  caracteres no ASCII, sin `;`, sin espacios).
- Longitud 3–31 caracteres.

La validación se aplica en **dos capas**:

- A nivel de **constraint** en la tabla `master.tenants`
  (`CHECK (slug ~ '^[a-z][a-z0-9_]{2,30}$')`) para que ninguna inserción
  directa en BD pueda saltársela.
- A nivel de **API** (zod o equivalente) en el flujo de registro, antes de
  llegar a Prisma.

**Regla 2 — Verificación de existencia antes de cualquier `SET search_path`**

Antes de emitir un `SET search_path` con un slug, la función de resolución
de tenant **siempre** verifica que el slug existe en `master.tenants` y está
en estado activo. Si no existe → 404. **Nunca** se emite un `SET` con un
slug arbitrario obtenido del request, ni siquiera si pasa la regex. La
caché host→tenant (ADR-002) opera sobre slugs ya verificados.

**Regla 3 — Quoting del identificador en el SQL emitido**

El SQL final no se construye por interpolación de string. Se usa
`Prisma.sql` con `Prisma.raw(quoteIdent(slug))` o equivalente, donde
`quoteIdent` es una función dedicada que:

1. Re-valida la regex antes de devolver nada (defensa en profundidad).
2. Devuelve el identificador con comillas dobles (`"tenant_acme"`),
   escapando las dobles internas si las hubiera (en la práctica, la regex
   ya las prohíbe).

Implementación de referencia (vive en Fase 3, en `lib/tenant/quote.ts` o
similar):

```ts
const SLUG_RE = /^[a-z][a-z0-9_]{2,30}$/;

export function quoteSchemaName(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Slug inválido: ${JSON.stringify(slug)}`);
  }
  return `"tenant_${slug}"`;
}
```

Cualquier código que construya un `SET search_path` y que **no** pase por
`quoteSchemaName` (o equivalente) es un bug bloqueante. El test del
Escenario 4 (§2.4) verifica que la cadena protege contra slugs maliciosos
sembrados directamente en `master.tenants` saltándose la API.

---

## 3. Opciones consideradas

### 3.1 Aislamiento de datos

| Opción                              | A favor                                                                                          | En contra                                                                                                                                   | Encaja para 10–100 tenants |
|-------------------------------------|--------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|----------------------------|
| Shared schema con `tenant_id`       | 1 sola tabla por entidad, 1 migración, queries cross-tenant para informes globales sin FDW       | Fuga = un olvido. Hay 46 endpoints sin filtro hoy. RLS exige `SET app.tenant_id` por conexión que Prisma no hace; soporte manual frágil    | ❌                         |
| **Schema-per-tenant** (elegida)     | Aislamiento por construcción. GDPR `DROP SCHEMA`. Backup `pg_dump --schema=`. Cero refactor de queries de producto | DDL × N schemas. pgbouncer en session pooling (no transaction). Catálogo Postgres crece. Roles Postgres a gestionar                          | ✅                         |
| DB-per-tenant                       | Aislamiento total. Escalado horizontal natural                                                    | Provisión por tenant (otro Postgres por cliente). Backups N veces. Complejidad de routing y deploy. Justificable a partir de 1.000+ tenants | ⚠️ sobreingeniería         |
| Container-per-tenant                | Aislamiento de proceso, no solo de datos                                                          | Coste de cómputo lineal en N tenants. Operación inviable para SaaS multi-tenant comercial pequeño                                            | ❌                         |

**Argumento decisivo**: el delta sobre el código actual. Schema-per-tenant
permite que la lógica del producto (`prisma.fichaje.findMany({...})`) **siga
siendo la que es**. La barrera la pone Postgres, no Prisma ni el desarrollador.

### 3.2 Topología

| Opción                                       | A favor                                                                                                  | En contra                                                                                                  |
|----------------------------------------------|----------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| **Una DB con `master` + `tenant_*`** (elegida)| Reaprovecha Postgres existente. Backup unitario. Transacciones cross-schema en provisión. Pool único     | El control plane y la app comparten WAL, locks, conexiones. Mitigación: roles Postgres separados (§2.3)    |
| Dos DBs (`fichaje_master` + `fichaje_app`)   | Aislamiento más fuerte. Escalado independiente futuro                                                     | Provisión adicional. Pool por DB. Imposible transacción cross-DB sin 2PC. No justificable a este volumen   |
| Postgres compartido entre productos          | (No aplica: solo hay un producto)                                                                         | —                                                                                                          |

**Plan B**: si en 18+ meses el control plane crece (alta cardinalidad de
métricas, eventos de Stripe, audit log voluminoso), separar a una segunda DB
es una operación reversible (un `pg_dump` del schema master, restaurar en
otra DB, reapuntar `MASTER_DATABASE_URL`). No quemamos puentes.

### 3.3 Roles Postgres

| Opción                                  | A favor                                                                                  | En contra                                                                                                                          |
|-----------------------------------------|------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Un único rol con todos los permisos     | Simplicidad operativa: una credencial, un pool, un usuario en `.env`                      | Una fuga en la app del producto compromete el control plane. Inaceptable para datos laborales y de suscripción                     |
| **Dos roles `master_role` / `app_role`**| Aislamiento de privilegios. La app del producto no puede leer `master` ni siquiera por error. Auditable: queries a master vienen *solo* del super-admin | Dos URLs en `.env`. Grants explícitos al provisionar nuevo tenant (mitigado con `DEFAULT PRIVILEGES`)                              |
| Rol por tenant (`tenant_acme_role`, …)  | Aislamiento aún mayor: una fuga en un tenant no compromete a otros                        | Pool por rol → conexiones × N. Login switching por request. Inviable a este volumen sin pgbouncer multi-pool                       |

**Argumento decisivo**: la separación `master_role` / `app_role` es la mínima
necesaria para que el control plane sea inmune a errores de la app del
producto. Una segregación más fina (rol por tenant) escalaría mal y no aporta
contra el riesgo realista del proyecto (errores en código aplicación), que ya
queda mitigado por schema-per-tenant.

### 3.4 Test de fuga

| Opción                                  | A favor                                                                | En contra                                                                                       |
|-----------------------------------------|------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Sin test                                | Avanza más rápido                                                       | El refactor de Fase 3 es a ciegas. Imposible firmar la decisión de aislamiento como cumplida    |
| Test unitario con mocks                 | Rápido, no depende de Postgres                                          | No prueba el aislamiento real. Si Prisma o pgbouncer cambian comportamiento, el test no detecta |
| **Test de integración con dos schemas** | Demuestra el aislamiento real, end-to-end, contra Postgres              | Requiere infra (Testcontainers o equivalente). Más lento                                        |

**No hay opción razonable**: el test de integración es obligatorio. Es el
único que firma la decisión.

---

## 4. Consecuencias

### 4.1 Positivas

- **Aislamiento por construcción**. Una query del producto sin contexto de
  tenant no devuelve datos de ningún tenant. La barrera está en Postgres, no
  en código de aplicación.
- **GDPR/RGPD operacionalmente trivial**. Un `DROP SCHEMA tenant_<slug>
  CASCADE` borra todo lo del cliente en una transacción.
- **Backups y restores granulares**. `pg_dump --schema=tenant_<slug>` permite
  restaurar un cliente sin tocar al resto.
- **Cero refactor de queries del producto**. Ninguna de las 46 rutas API
  necesita propagar `tenantId`. La lógica del fichaje sigue siendo la que es;
  solo cambia el contexto en el que corre.
- **Roles Postgres como segunda barrera**. La app del producto no puede leer
  el control plane aunque alguien escriba `prisma.tenant.findMany()` por
  error: el rol no tiene permisos.
- **Auditabilidad**. Cualquier query a `master` viene del panel super-admin
  por definición (otro rol Postgres, otra credencial). Trazable.

### 4.2 Negativas (asumidas)

- **Migraciones DDL × N schemas**. Cada cambio de schema del producto se
  aplica a todos los schemas `tenant_*`. Necesita orquestación
  (`tenants:migrate <slug>` y `tenants:migrate:all`, descritos en Fase 3 de
  la spec). Mitigación: el SQL de cada migración es el mismo; solo cambia el
  `search_path`. Riesgo de drift entre schemas si una migración falla a
  medias — el comando debe ser idempotente y reportar fallos por tenant.
- **pgbouncer en session pooling**. El uso de `SET search_path` por
  query/sesión obliga a configurar pgbouncer en **session mode**, no en
  transaction mode. Esto reduce la eficiencia teórica del pool a N
  conexiones simultáneas. A 10–100 tenants no es problema; documentado y
  reflejado en ADR-005.
- **Gestión de permisos al provisionar tenant**. Crear un schema requiere
  ejecutar varios `GRANT` y `ALTER DEFAULT PRIVILEGES` con `master_role`. Es
  trabajo del worker de provisión (Fase 4) y debe estar encapsulado en una
  función SQL o procedimiento idempotente.
- **Doble URL en `.env`**. La app del producto y el panel super-admin
  necesitan credenciales distintas. Mayor superficie de error en
  configuración de Dokploy. Mitigación: `.env.example` con los dos
  documentados y healthcheck que valide ambos al arranque.
- **Comando `prisma migrate deploy` no aplica nativamente a N schemas**. El
  `prisma migrate deploy` estándar trabaja contra una `DATABASE_URL` con un
  `search_path`. Hay que envolver: por cada tenant, settear `search_path` y
  ejecutar `migrate deploy`. Lo aborda la Fase 3 de la spec.

### 4.3 Neutras

- **Catálogo Postgres crece**. 100 schemas × 19 tablas ≈ 1.900 entradas en
  `pg_class`. Postgres lo maneja sin degradación; clientes GUI (DataGrip,
  DBeaver) sí se ralentizan al cargar el árbol de objetos. No afecta a la
  app.
- **Conexiones Postgres**. Con un único pool y `SET search_path` por query,
  el coste de conexiones es **independiente** del número de tenants. Lo que
  sí escala con tenants es el espacio en `pg_class`/`pg_attribute`, no el
  pool.
- **Cross-tenant analytics**. Informes del estilo "número total de fichajes
  agregados de toda la plataforma" requieren consultar los N schemas y
  agregar en el control plane. Es responsabilidad del bounded context
  `super-admin` y queda explícitamente fuera de la app del producto.

---

## 5. Implicaciones para fases siguientes

### 5.1 Fase 2 — Control plane

- El control plane se crea como **schema `master`** en la DB existente,
  propiedad de `master_role`.
- Tablas del control plane: `tenants`, `plans`, `features`, `plan_features`,
  `tenant_features`, `subscriptions`, `super_admins`, `webhook_events`,
  `audit_log`. La estructura concreta se cierra en su propia migración Prisma
  durante Fase 2.
- `app_role` recibe `REVOKE ALL ON SCHEMA master FROM app_role` (idempotente
  con la creación inicial de roles).
- Los super-admins de plataforma viven en `master.super_admins` con su
  propio `enum PlatformRol { SUPER_ADMIN, SUPPORT }` (declarado aquí; creado
  en Fase 2).

### 5.2 Fase 3 — Resolución de tenant y refactor del producto

- **Mecanismo de resolución**: middleware Prisma `$extends({ query })` que,
  al inicio de **cada query**, ejecuta `SET search_path TO "tenant_<slug>",
  public` con el slug obtenido del contexto del request. El detalle se cierra
  en ADR-002. Lo crítico aquí es que el contexto se aplica a nivel de **query**
  (no de request), para no depender de que un endpoint olvide invocar al
  middleware: si no hay slug en contexto, la query falla antes de tocar BD.
- **Test de fuga** (§2.4) es el criterio de aceptación bloqueante de la fase.
- Se elimina `src/lib/migrate.ts` cuando todas las DDL vivan en
  `prisma/migrations/` y el comando `tenants:migrate:all` esté operativo.
- El comando `tenants:migrate <slug>` corre las mismas migraciones que el
  esquema base aplicándolas en el `search_path` del tenant. Las migraciones
  son **las mismas SQL** en todos los schemas — la única variabilidad es el
  search_path al ejecutar.

### 5.3 Fase 8 — Migración del despliegue Dokploy

- **pgbouncer en session pooling**, no transaction. Reflejado y justificado
  en ADR-005.
- Variables de entorno en Dokploy:
  - `MASTER_DATABASE_URL` — credenciales de `master_role`. Usado por el panel
    super-admin (Fase 7) y por los scripts de provisión de tenant.
  - `APP_DATABASE_URL` — credenciales de `app_role`. Usado por la app del
    producto (servicio principal Dokploy) y por el worker (Fase 4) cuando
    actúe sobre datos de tenant. Para webhooks de Stripe que afectan al
    control plane el worker usa `MASTER_DATABASE_URL`. La operativa
    dual-rol del worker se detalla en §5.4.
- Healthcheck endpoint debe verificar **ambas** conexiones (master y app).
- Backups: `pg_dump --schema=master` para control plane;
  `pg_dump --schema=tenant_<slug>` por cliente para snapshots
  individuales. Estrategia agregada (rolling daily + retention) se cierra en
  Fase 8 (ver también §5.5 sobre prioridad del backup de master).

### 5.4 Fase 4 — Worker dual-rol

El worker que procesa los webhooks de Stripe y la provisión de tenants
escribe en **dos zonas distintas**: `master.*` (suscripciones, eventos,
auditoría) y `tenant_*.*` (creación inicial del schema, primer OWNER). La
operativa concreta:

El worker mantiene **dos clientes Prisma en proceso**:

- `prismaMaster` — conectado con `MASTER_DATABASE_URL` (credenciales de
  `master_role`). Se usa exclusivamente para tablas en `master.*`.
- `prismaApp` — conectado con `APP_DATABASE_URL` (credenciales de
  `app_role`). Se usa exclusivamente para tablas en `tenant_*.*`, tras
  aplicar `SET search_path` al slug correspondiente (mismo mecanismo de
  ADR-002 + §2.5 de este ADR).

La elección entre uno u otro se hace **por la tabla destino de cada
operación**, no por el tipo de evento ni por el endpoint. **No se mezclan
roles en una misma conexión**: una conexión que ya ha hecho `SET
search_path` a un schema de tenant no se reutiliza para escribir en
`master`, ni viceversa.

> ADR-003 (billing y suscripciones) debe recoger esta restricción al
> diseñar el worker de Stripe: el handler de cada tipo de evento declara
> explícitamente con qué cliente Prisma escribe, y la provisión de un
> nuevo tenant es una transacción coreografiada que toca primero `master`
> (insertar `tenants` y `subscriptions`, crear schema con `prismaMaster`),
> aplica las migraciones del producto en el nuevo schema, y por último
> crea el primer OWNER con `prismaApp`.

### 5.5 Prioridad de backup del control plane

El backup de `master` es **prioritario** sobre los de `tenant_*`. Pérdida
de `master` = pérdida de la capacidad de identificar a qué cliente
pertenecen los datos de los schemas de tenant: los schemas siguen ahí,
pero sin el control plane no se sabe cuál es de quién, qué plan tenían,
qué suscripción los respalda. Un restore parcial de tenants sin master es
inútil.

ADR-005 debe definir, al cerrar la estrategia de backups:

- **Cadencia para `master`**: como mínimo el doble de frecuente que la de
  los schemas `tenant_*` (si los tenants se respaldan diariamente, master
  cada 12 h o más frecuente).
- **Retención para `master`**: como mínimo **4 años**. El RD 8/2019 obliga
  a conservar el registro horario 4 años; sin `master` no se puede
  atribuir el registro recuperado al cliente correcto, así que la
  retención efectiva del registro queda limitada por la del control
  plane. Igualar ambas no basta: el control plane debe sobrevivir a
  cualquier `tenant_*`.
- **Verificación**: backups de master con prueba de restauración mensual
  (verificación operativa) en una DB efímera, no solo verificación de
  hash o tamaño.

---

## 6. Criterios de aceptación

Esta decisión se considera implementada cuando, al término de Fase 3, todos
los siguientes son ciertos:

1. Existe el schema `master` propiedad de `master_role` con las tablas del
   control plane creadas vía `prisma migrate deploy`.
2. Existe el script de provisión que, dado un slug, crea
   `tenant_<slug>` con permisos correctos para `app_role` y aplica todas las
   migraciones del producto.
3. `app_role` no tiene ningún privilegio sobre `master`. Verificado con un
   test que ejecuta `SELECT * FROM master.tenants` con `app_role` y espera
   `permission denied for schema master`.
4. El middleware Prisma aplica `SET search_path` al inicio de cada query con
   el slug del request, y rechaza cualquier query cuyo contexto no tenga
   slug.
5. El test de fuga (§2.4) pasa contra Postgres real con dos schemas
   sembrados.
6. `pg_dump --schema=tenant_<slug>` produce un dump funcional restaurable en
   otro Postgres.
7. `DROP SCHEMA tenant_<slug> CASCADE` ejecutado por `master_role` borra
   todos los datos del tenant sin afectar al resto.

---

## 7. Referencias

- [`docs/arch/00-auditoria.md`](./00-auditoria.md), §10.1 (schema-per-tenant
  vs shared schema), §10.2 (una DB vs dos), §10.3 (search_path vs pool por
  tenant), §7 (acoplamientos mono-tenant detectados).
- [ADR-000](./adr-000-vision-saas.md) — visión SaaS y bounded contexts.
- [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md),
  apartado 1 (Aislamiento de datos), apartado 7 (Despliegue Dokploy), Fases
  2, 3 y 8.
- ADR-002 (resolución de tenant) — pendiente, cierra el "cómo" del
  `SET search_path` y la caché host→tenant.
- ADR-005 (deployment + TLS) — pendiente, cierra pgbouncer en session
  pooling y la opción TLS-A (Cloudflare DNS-01 wildcard).
- PostgreSQL docs: [search_path](https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-SEARCH-PATH),
  [DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html).
- Real Decreto-ley 8/2019 de 8 de marzo (registro horario obligatorio): la
  obligación legal afecta al **producto**, no a la decisión de aislamiento;
  se menciona aquí porque condiciona los requisitos de retención (4 años) que
  los backups por tenant deben respetar.
