# ADR-005 — Deployment y TLS: Cloudflare DNS-01 wildcard, servicios Dokploy, pgbouncer en session pooling y plan de cutover

- **Estado**: Accepted
- **Fecha**: 2026-04-29
- **Decisores**: Daniel Sánchez (`@tecnocloudes`)
- **Spec maestra**: [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md)
- **Visión**: [ADR-000](./adr-000-vision-saas.md)
- **Bounded contexts afectados**: todos (transversal)
- **Sucede a**: [ADR-001](./adr-001-aislamiento-multi-tenant.md), [ADR-002](./adr-002-resolucion-tenant.md), [ADR-003](./adr-003-billing-y-suscripciones.md), [ADR-004](./adr-004-feature-flags-y-addons.md)
- **Bloquea a**: Fases 4 (worker, claves Stripe en Dokploy), 8 (cutover) y 9 (observabilidad)

---

## 1. Contexto

ADR-001 a ADR-004 cerraron el qué (aislamiento, resolución, billing,
features). ADR-005 cierra el **cómo se monta todo en producción**:
HTTPS para `*.ficha.tecnocloud.es`, qué servicios viven en Dokploy,
qué variables de entorno consolidadas necesitan, cómo se aplican
migraciones en arranque, cómo se valida que la app está sana, qué
pipeline CI/CD entrega los cambios y cómo se hace el cutover de la
app actual.

Cinco preguntas que ADR-005 responde:

1. **TLS**: ya pre-aprobada la opción A (Cloudflare DNS-01 wildcard)
   en ADR-001 §5.4 y referenciada en spec. Falta cerrar **los pasos
   concretos**: delegación desde paginalia, configuración Cloudflare,
   API Token con scope mínimo, integración con Traefik en Dokploy,
   certificados wildcard + apex.
2. **Topología de servicios**: cuántos servicios Dokploy, qué hace
   cada uno, dónde encaja pgbouncer (¿servicio independiente o
   sidecar?), por qué Redis no entra día 1.
3. **Configuración**: lista consolidada de variables de entorno (las
   que han ido apareciendo en los 4 ADRs anteriores), cuáles son
   secretas, qué valor `NEXTAUTH_URL` con multi-subdominio.
4. **Operativa de despliegue**: entrypoint.sh con migraciones del
   control plane y de cada tenant, manejo de fallos, healthcheck,
   pipeline CI/CD, branch protection.
5. **Cutover**: pasos concretos para migrar la app actual
   (`ficha.tecnocloud.es` mono-tenant) al estado SaaS multi-tenant
   con el cliente actual reubicado a su `tenant_<slug>` siguiendo el
   guion de ADR-004 §5.4. Plan de rollback. Ventana operativa.

Restricciones que vienen de ADRs anteriores y no se reabren:

- **Una sola app Docker** en Dokploy, no contenedor por tenant (spec).
- **Dominio raíz `ficha.tecnocloud.es`**, no se registra dominio nuevo.
- **TLS opción A** (Cloudflare DNS-01 wildcard): ADR-001 §5.4 y spec.
- **pgbouncer en SESSION pooling**, no transaction: ADR-001 §5.3 +
  ADR-002 §2.2.
- **Cuatro roles Postgres** (`master_role`, `app_role`,
  `tenant_runtime_role`, `quota_writer_role`) y sus URLs en `.env`:
  ADR-001 §2.3 + ADR-002 §3.6 + ADR-004 §2.2.
- **Worker dual-rol** con `prismaMaster` y `prismaApp`: ADR-001 §5.4 y
  ADR-003 §5.2.
- **Backups**: master prioritario (cadencia 2×, retención 4 años,
  restore mensual): ADR-001 §5.5; tenants `pg_dump --schema`
  diariamente.

---

## 2. Decisión

Adoptamos ocho decisiones encadenadas que cierran la capa operativa.

### 2.1 TLS — opción A: Cloudflare DNS-01 wildcard sobre subzona delegada

Estrategia confirmada de ADR-001 §5.4: **delegar la subzona
`ficha.tecnocloud.es` a Cloudflare**. El resto de zonas de
`tecnocloud.es` siguen en paginalia (`ns1.paginalia.es`,
`ns2.paginalia.es`).

#### 2.1.a Configuración DNS

**En paginalia** (zona `tecnocloud.es`), añadir registros NS para
delegar la subzona:

```
ficha.tecnocloud.es.   IN NS   <ns1>.cloudflare.com.
ficha.tecnocloud.es.   IN NS   <ns2>.cloudflare.com.
```

Los `<ns1>.cloudflare.com.` y `<ns2>.cloudflare.com.` los asigna
Cloudflare al añadir la zona; son distintos por cuenta y por zona.

**En Cloudflare** (dashboard):

1. Add Site → introducir `ficha.tecnocloud.es` como zona (no la zona
   raíz `tecnocloud.es`).
2. Cloudflare devuelve los dos NS específicos para esta zona; copiar
   en el registro NS de paginalia.
3. Verificar propagación (`dig ns ficha.tecnocloud.es @8.8.8.8`).
4. Añadir registros DNS:

   | Tipo  | Nombre                  | Destino                      | Proxy   |
   |-------|--------------------------|------------------------------|---------|
   | A     | `ficha.tecnocloud.es`    | `<IP pública VPS Dokploy>`   | DNS only |
   | A     | `app.ficha.tecnocloud.es`| `<IP pública VPS Dokploy>`   | DNS only |
   | A     | `admin.ficha.tecnocloud.es`| `<IP pública VPS Dokploy>` | DNS only |
   | A     | `*.ficha.tecnocloud.es`  | `<IP pública VPS Dokploy>`   | DNS only |

   **DNS only** (no proxy naranja): Cloudflare CDN no se usa porque
   Traefik ya hace TLS terminación y la app es interactiva con
   PostgreSQL detrás (no se beneficia de cache CDN). Mantener "DNS
   only" simplifica el debugging y evita doble TLS.

#### 2.1.b API Token Cloudflare con scope mínimo

Crear un **API Token específico** en Cloudflare para Traefik:

- Zone Resources: `Include — Specific zone — ficha.tecnocloud.es`.
- Permissions: `Zone — DNS — Edit` (solo). Sin `Zone — Settings —
  Edit`, sin `Account` permissions.
- Client IP Address Filtering: la IP pública de la VPS Dokploy.
- TTL: sin expiración (Traefik renueva certs cada 60 días).

El token es **secret**: solo Traefik en Dokploy lo conoce. Nunca se
commitea ni se mete en un .env de la app.

#### 2.1.c Traefik en Dokploy

Dokploy expone Traefik como ingress. Configuración relevante para
DNS-01 wildcard (`traefik.yml` o equivalente, gestionado por
Dokploy):

```yaml
certificatesResolvers:
  cloudflare:
    acme:
      email: admin@tecnocloud.es
      storage: /letsencrypt/acme.json
      dnsChallenge:
        provider: cloudflare
        resolvers:
          - "1.1.1.1:53"
          - "8.8.8.8:53"
```

Variable de entorno de Traefik (no de la app):

- `CLOUDFLARE_DNS_API_TOKEN` = el token de §2.1.b.

Etiquetas Docker en el servicio principal de la app (Dokploy las
genera al configurar dominio + wildcard):

```yaml
- "traefik.http.routers.fichaje.rule=HostRegexp(`{subdomain:[a-z0-9-]+}.ficha.tecnocloud.es`) || Host(`ficha.tecnocloud.es`)"
- "traefik.http.routers.fichaje.tls=true"
- "traefik.http.routers.fichaje.tls.certresolver=cloudflare"
- "traefik.http.routers.fichaje.tls.domains[0].main=ficha.tecnocloud.es"
- "traefik.http.routers.fichaje.tls.domains[0].sans=*.ficha.tecnocloud.es"
```

Esto pide a Traefik **dos certs**:

- `ficha.tecnocloud.es` (apex).
- `*.ficha.tecnocloud.es` (wildcard).

Let's Encrypt los emite vía DNS-01 (Traefik crea TXT records
temporales en Cloudflare con el token, espera propagación, valida).
Renovación automática cada 60 días.

#### 2.1.d Reproducibilidad ante migración de VPS

Si la VPS Dokploy se cambia (otra IP), los pasos son:

1. En Cloudflare: actualizar los 4 registros A con la IP nueva.
2. En Cloudflare: actualizar el "Client IP Address Filtering" del
   API Token.
3. En la VPS nueva: levantar Dokploy + Traefik + restaurar
   `acme.json` desde backup (acelera la primera renovación; si no
   está, Traefik los emite de nuevo).
4. En paginalia: NO se toca nada (los NS apuntan a Cloudflare, no a
   la VPS).

Documentación operativa exhaustiva en
`docs/deploy/dokploy.md` (Fase 8, no este ADR).

### 2.2 Topología de servicios en Dokploy

Cuatro servicios Docker en el mismo proyecto Dokploy
(`fichaje-prueba-qlhel6`):

| Servicio              | Imagen / build                                     | Comando                       | Roles Prisma usados                     |
|-----------------------|----------------------------------------------------|--------------------------------|------------------------------------------|
| **app**               | Build del repo (Dockerfile)                        | `node server.js`               | `tenant_runtime_role`, `app_role`, `quota_writer_role` |
| **worker**            | Build del repo (mismo Dockerfile)                  | `node dist/worker.js`          | `master_role`, `app_role`                |
| **postgres** (existente)| Postgres oficial (Dokploy gestiona)                | —                              | —                                        |
| **pgbouncer**         | `edoburu/pgbouncer` o `bitnami/pgbouncer` oficial  | (default del image)            | —                                        |

**No** hay servicio Redis día 1 (ADR-002 §3.4 y ADR-003 §5.2). Cuando
entre, será un quinto servicio.

#### 2.2.a Servicio `app`

- Single Next.js app (App Router).
- Sirve `<slug>.ficha.tecnocloud.es`, `app.ficha.tecnocloud.es`,
  `admin.ficha.tecnocloud.es` y el apex `ficha.tecnocloud.es` (este
  último redirige 301 a `app.*` según ADR-002 §2.1).
- Conectado a pgbouncer (no directo a Postgres) en las cuatro URLs
  de roles.
- Healthcheck `/api/health` (§2.6).
- **Depende de `pgbouncer` con `condition: service_healthy`**. La
  app no arranca hasta que pgbouncer esté healthy. Cadena de
  arranque tras reboot de la VPS: `postgres` healthy → `pgbouncer`
  healthy → `app` arranca.
- Réplicas: 1 inicial, configurables en Dokploy. Con sticky sessions
  desactivadas (no hace falta: el contexto del tenant es por request,
  ADR-002 §2.2).

#### 2.2.b Servicio `worker`

- Mismo build que `app`, distinto comando.
- Procesa:
  - Webhooks Stripe (ADR-003 §2.3.c) si se mueven a cola (TODO ADR-003
    §5.2). Hasta entonces, los webhooks los recibe `app` directamente.
  - **Jobs programados**:
    - Cleanup de tenants `PENDING > 24h` (ADR-003 §2.6).
    - Detección de tenants `PROVISIONING > 10 min` (ADR-003 §5.2).
    - Reseteo de quotas en transición de periodo (cuando llegue
      `invoice.payment_succeeded` se hace en el handler; un job de
      seguridad detecta gaps cada hora — TODO).
- Cron interno con `node-cron` o equivalente.
- **No** abre `prismaRuntime` ni `prismaQuotaWriter`: esos son del
  middleware HTTP (ADR-002 §3.6, ADR-004 §2.2). El worker tiene
  acceso completo al control plane vía `master_role`.
- Healthcheck `/health` interno (puerto 3001) cada 30 s que verifica
  las conexiones que usa (`master_role`, `app_role`).
- **Depende de `pgbouncer` con `condition: service_healthy`**.
  Misma cadena de arranque que `app`.
- **NO se expone públicamente**. No tiene labels Traefik que
  enruten tráfico HTTP. Los webhooks de Stripe los recibe el
  servicio `app` (que tiene endpoint dedicado con verificación de
  firma, ADR-003 §2.5); cuando el procesamiento se mueva a cola
  asíncrona (TODO ADR-003 §5.2), `app` encolará en Redis y el
  worker consumirá de la cola **sin exponer endpoint propio**.
  Hasta entonces, el worker corre solo jobs programados con cron
  interno (cleanup `PENDING`, detección `PROVISIONING` huérfanos).
  El healthcheck del puerto 3001 es accesible solo desde la red
  interna de Dokploy. Esta restricción de no-exposición pública es
  importante porque el worker tiene **la mayor superficie de
  privilegios Postgres del sistema** (`master_role` + `app_role`):
  un endpoint HTTP expuesto sería el vector preferente de escalada
  ante un compromiso del proceso.

#### 2.2.c Servicio `postgres`

- El ya existente del proyecto Dokploy. **No se reinstala**.
- Configuración:
  - `max_connections = 200` (suficiente para 4 roles × 4 servicios ×
    pool de 10 = 160, con margen).
  - `shared_preload_libraries`: sin cambios respecto al estado
    actual, salvo que se necesite alguna extensión documentada
    (ninguna prevista de los ADRs).
- **Healthcheck**: `pg_isready -U master_role -d fichaje` cada 10 s,
  5 reintentos, timeout 5 s. Reutiliza la receta del CI (§2.7) con
  el mismo flag `--health-cmd pg_isready`. Dokploy lo usa para gating
  de los servicios que dependen de postgres (`pgbouncer`).
- Backups: `pg_dump --schema=master` diario + 12h adicionales (ADR-001
  §5.5), `pg_dump --schema=tenant_<slug>` por tenant diario.
  Estrategia operativa concreta en `docs/deploy/dokploy.md` (Fase 8).

#### 2.2.d Servicio `pgbouncer`

Decisión en §3.1: **servicio independiente en Dokploy**, no sidecar
de Postgres.

Configuración (`pgbouncer.ini`):

```ini
[databases]
fichaje = host=postgres port=5432 dbname=fichaje

[pgbouncer]
listen_port = 6432
listen_addr = 0.0.0.0
auth_type = scram-sha-256
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = session                  ; OBLIGATORIO (ADR-001 §5.3, ADR-002 §2.2)
max_client_conn = 1000
default_pool_size = 25               ; conexiones físicas a Postgres por (db, user)
reserve_pool_size = 5
server_lifetime = 3600
server_idle_timeout = 600
```

`auth_file` (`userlist.txt`) contiene los 4 roles con sus hashes
SCRAM. Se genera al provisionar la VPS y se monta como secret en
Dokploy.

Las 4 URLs de la app apuntan a pgbouncer (puerto 6432), no a Postgres
directamente:

```
MASTER_DATABASE_URL=postgresql://master_role:****@pgbouncer:6432/fichaje
APP_DATABASE_URL=postgresql://app_role:****@pgbouncer:6432/fichaje
TENANT_RUNTIME_DATABASE_URL=postgresql://tenant_runtime_role:****@pgbouncer:6432/fichaje
QUOTA_WRITER_DATABASE_URL=postgresql://quota_writer_role:****@pgbouncer:6432/fichaje
```

`pool_mode = session` es **obligatorio**. Es lo que permite a
ADR-002 §2.2 hacer `SET search_path` por query con la garantía de que
la conexión persiste durante toda la transacción.

**Healthcheck**: `psql -h localhost -p 6432 -U pgbouncer -d pgbouncer -c 'SHOW VERSION'`
cada 10 s. Si la base administrativa `pgbouncer` no responde, el
servicio se marca unhealthy y Dokploy no envía tráfico desde `app`
ni `worker`. Alternativa más simple si el image base no trae `psql`:
`nc -z localhost 6432`.

**Depende de `postgres` con `condition: service_healthy`**. No
arranca hasta que postgres esté healthy. Cadena completa de
arranque tras reboot de VPS: `postgres` healthy → `pgbouncer`
healthy → `app` y `worker` arrancan en paralelo.

### 2.3 Variables de entorno consolidadas

Lista exhaustiva de las `env` que aparecen en los 5 ADRs y la
configuración actual del repo. Tres categorías: **secret** (toggle
"secret" en Dokploy, no se loggean), **public** (visibles por la app
y a veces por el front), **build-time** (afectan el build, no el
runtime).

#### 2.3.a Aplicación

| Variable                               | Tipo    | Default                                     | Origen ADR / fuente              |
|----------------------------------------|---------|---------------------------------------------|----------------------------------|
| `NODE_ENV`                             | public  | `production`                                | infra estándar                   |
| `NEXTAUTH_URL`                         | public  | `https://app.ficha.tecnocloud.es`           | §2.4 + §3.2                      |
| `AUTH_SECRET`                          | secret  | (generado con `openssl rand -base64 32`)    | NextAuth v5, repo actual         |
| `MASTER_DATABASE_URL`                  | secret  | (URL completa con password)                 | ADR-001 §5.3                     |
| `APP_DATABASE_URL`                     | secret  | (URL completa)                              | ADR-001 §5.3                     |
| `TENANT_RUNTIME_DATABASE_URL`          | secret  | (URL completa)                              | ADR-002 §3.6 (renombrada en ADR-004 §2.2) |
| `QUOTA_WRITER_DATABASE_URL`            | secret  | (URL completa)                              | ADR-004 §2.2                     |
| `TENANT_CACHE_TTL_MS`                  | public  | `60000`                                     | ADR-002 §2.3                     |

#### 2.3.b Stripe

| Variable                               | Tipo    | Default          | Origen ADR              |
|----------------------------------------|---------|------------------|-------------------------|
| `STRIPE_SECRET_KEY`                    | secret  | `sk_test_...`    | ADR-003 §5.4            |
| `STRIPE_PUBLISHABLE_KEY`               | public  | `pk_test_...`    | ADR-003 §5.4            |
| `STRIPE_WEBHOOK_SECRET`                | secret  | `whsec_...`      | ADR-003 §2.5            |
| `STRIPE_PRICE_STARTER_MONTHLY`         | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_STARTER_YEARLY`          | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_PRO_MONTHLY`             | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_PRO_YEARLY`              | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_ENTERPRISE_MONTHLY`      | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_ENTERPRISE_YEARLY`       | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_ADDON_DOMINIO_PERSONALIZADO` | public | `price_...`   | ADR-003 §5.4            |
| `STRIPE_PRICE_ADDON_API_ACCESS`        | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_ADDON_INTEGRACIONES_NOMINA` | public | `price_...`    | ADR-003 §5.4            |
| `STRIPE_PRICE_ADDON_FIRMA_ELECTRONICA` | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_ADDON_PEOPLE_ANALYTICS`  | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_ADDON_STORAGE_EXTRA`     | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_PRICE_ADDON_EMAILS_EXTRA`      | public  | `price_...`      | ADR-003 §5.4            |
| `STRIPE_TRIAL_DAYS`                    | public  | `14`             | ADR-003 §2.7            |
| `STRIPE_TRIAL_REQUIRES_CARD`           | public  | `true`           | ADR-003 §2.7 (enmienda) |
| `STRIPE_PORTAL_RETURN_URL`             | public  | (template)       | ADR-003 §5.4            |
| `STRIPE_CHECKOUT_SUCCESS_URL`          | public  | (URL completa)   | ADR-003 §5.4            |
| `STRIPE_CHECKOUT_CANCEL_URL`           | public  | (URL completa)   | ADR-003 §5.4            |

#### 2.3.c Traefik (no la app)

| Variable                       | Tipo    | Default           | Origen      |
|--------------------------------|---------|-------------------|-------------|
| `CLOUDFLARE_DNS_API_TOKEN`     | secret  | (token Cloudflare)| §2.1.b      |

`CLOUDFLARE_DNS_API_TOKEN` solo lo conoce Traefik. La app **no** lo
recibe. Si entra por error en `app` o `worker`, no rompe nada (la
app no llama a la API Cloudflare), pero contradice el principio de
mínimo privilegio: no propagar.

#### 2.3.d Build-time

| Variable                       | Tipo        | Default | Origen                |
|--------------------------------|-------------|---------|-----------------------|
| `NEXT_TELEMETRY_DISABLED`      | build-time  | `1`     | repo actual (Dockerfile)|

#### 2.3.e Política

- Toda variable `secret` se marca con el toggle correspondiente en
  Dokploy y no aparece en logs.
- `.env.example` en el repo lista todas las variables sin valores
  reales, con comentarios sobre qué ADR las introdujo.
- En CI no se necesitan los secrets reales; los tests usan stubs
  (Stripe modo test con cuenta dedicada, Postgres en container con
  passwords arbitrarias).

### 2.4 `NEXTAUTH_URL` en multi-subdominio

NextAuth v5 espera una URL canónica para construir callback URLs y
verificar el origen. En multi-tenant cada tenant tiene su propio
host, así que un único `NEXTAUTH_URL` no puede cubrir todos.

**Decisión**:

- `NEXTAUTH_URL = https://app.ficha.tecnocloud.es` (el subdominio de
  la landing/registro, donde **no** vive el flow de login del
  tenant). Sirve de "anchor" canónico para construcciones internas
  de NextAuth y para la verificación que NextAuth hace del origen del
  request.
- `trustHost: true` ya está activo en `lib/auth.config.ts` del repo
  actual. Permite que NextAuth valide cualquier host de los
  configurados (Traefik solo enruta hosts bajo `*.ficha.tecnocloud.es`).
- El callback de login en cada subdominio de tenant funciona porque
  NextAuth resuelve la URL en runtime usando el host del request,
  no `NEXTAUTH_URL`. Verificado contra documentación NextAuth v5
  beta.

Justificación detallada y alternativas en §3.2.

### 2.5 Migraciones aplicadas en arranque

`entrypoint.sh` (en el Dockerfile, antes del CMD final):

```sh
#!/bin/sh
set -euo pipefail

echo "[entrypoint] Aplicando migraciones del control plane (master)..."
DATABASE_URL="$MASTER_DATABASE_URL" npx prisma migrate deploy --schema=prisma/schema.prisma

echo "[entrypoint] Aplicando migraciones a schemas tenant_*..."
DATABASE_URL="$MASTER_DATABASE_URL" node scripts/migrate-tenants.js

echo "[entrypoint] Migraciones completadas. Arrancando app..."
exec "$@"
```

`scripts/migrate-tenants.js` (Fase 3 lo materializa, ADR-001 §5.2):

1. Conecta con `MASTER_DATABASE_URL` (master_role).
2. Lista tenants con `status IN ('ACTIVE', 'SUSPENDED')` (no
   `PENDING` ni `DELETED`).
3. Para cada tenant en orden cronológico (`created_at ASC`):
   - `SET search_path TO "tenant_<slug>", public`.
   - Ejecuta `prisma migrate deploy` apuntando al schema del tenant.
   - Si falla: imprime el slug, hace `RAISE` y **aborta el script**
     con exit code 1.
4. Si todos pasan: exit 0.

**Manejo de fallos**: abortar al primer fallo (no continuar con los
siguientes tenants). Justificación en §3.3.

Si `entrypoint.sh` retorna exit ≠ 0, Dokploy:

1. No marca el deployment como exitoso.
2. Mantiene la versión anterior corriendo.
3. Marca el rollout como fallido.

El operador (super-admin) ve la alerta, investiga el slug que falló
en sus logs y decide:

- Arreglar el tenant problemático manualmente y reintentar.
- Hacer rollback del deploy entero y revisar la migración.

**Comando CLI manual**: `npm run tenants:migrate -- <slug>` y
`npm run tenants:migrate:all` están disponibles fuera del entrypoint
para operaciones puntuales (Fase 3, ADR-001 §5.2).

#### 2.5.a Convención obligatoria: migraciones backward-compatible

El "abortar al primer fallo" de §3.3 es necesario pero no
suficiente. Caso real: la migración pasa a `tenant_uno` y
`tenant_dos` antes de fallar en `tenant_tres`. Dokploy mantiene la
**versión anterior del código** corriendo, pero los schemas de
`tenant_uno` y `tenant_dos` ya tienen estructura nueva. El código
viejo no entiende los schemas nuevos → drift parcial real, no
teórico.

La mitigación es estructural: cada migración Prisma incluida en una
PR **debe ser compatible con la versión del código inmediatamente
anterior en `main`**. Patrones obligatorios:

- **Añadir columna `NOT NULL`**: NUNCA en una sola migración.
  Primero añadir como `NULL` + backfill en una PR. Después, una
  segunda PR marca `NOT NULL` cuando todo el código ya la rellena.
- **Renombrar columna**: NUNCA en una sola migración. Primero
  crear la nueva como `NULL` + escribir en ambas + leer de la nueva
  con fallback a la vieja. En otra PR, borrar la vieja.
- **Eliminar columna**: NUNCA en una sola migración. Primero la PR
  deja de leerla y de escribirla. Después de un deploy estable,
  otra PR la borra.
- **Cambiar tipo de columna**: idéntico patrón a renombrar (nueva
  columna, doble escritura, lectura con fallback, borrar vieja).

Justificación: si la migración rompe a mitad de aplicarla a N
tenants, los tenants ya migrados los sirve la app vieja (Dokploy
mantiene el deploy anterior). Una migración no-backward-compatible
deja a esos tenants en estado inconsistente hasta que el operador
resuelva manualmente schema por schema. Backward-compatibility
convierte el escenario de "cutover roto" en una degradación parcial
recuperable: la app vieja sigue funcionando sobre los schemas
nuevos porque los nuevos siguen aceptando lo que ella escribía.

**Plantilla de PR** (`.github/pull_request_template.md`, Fase 8):

```markdown
## Cambios
<descripción>

## Migraciones Prisma
- [ ] Esta PR contiene migraciones Prisma.
- [ ] Si sí, son backward-compatibles con `main` (sí/no/justificar).
      Reglas en ADR-005 §2.5.a.

## Tests
- [ ] `npm test` pasa.
- [ ] `npm run test:feature-coverage` pasa (ADR-004).
- [ ] Tests E2E nightly verdes (último run).
```

El check de backward-compatibility **no se puede automatizar de
forma fiable**; queda como responsabilidad del autor de la PR y del
revisor. La regla ESLint custom `migrations-must-be-additive`
(Fase 9) puede detectar los casos típicos (`DROP COLUMN`,
`ALTER COLUMN ... NOT NULL` sin paso intermedio) y lanzar warning,
pero no sustituye al check humano.

### 2.6 Healthcheck `/api/health`

Endpoint Next.js que verifica las dependencias críticas:

```ts
// src/app/api/health/route.ts (Fase 5)
export async function GET() {
  const checks = await Promise.allSettled([
    pingMaster(),       // SELECT 1 con master_role
    pingApp(),          // SELECT 1 con app_role (set search_path a un schema arbitrario, p.ej. master)
    pingRuntime(),      // SELECT 1 con tenant_runtime_role
    pingQuotaWriter(),  // SELECT 1 con quota_writer_role
  ]);

  const stripeOk = stripeReadyAtBoot;  // boolean cacheado al arranque

  const results = {
    master:        checks[0].status === "fulfilled",
    app:           checks[1].status === "fulfilled",
    runtime:       checks[2].status === "fulfilled",
    quota_writer:  checks[3].status === "fulfilled",
    stripe:        stripeOk,
  };

  const allOk = Object.values(results).every(Boolean);
  return Response.json(results, { status: allOk ? 200 : 503 });
}
```

- **200** si las 4 conexiones Postgres y Stripe están OK.
- **503** si alguna falla. Dokploy no envía tráfico mientras esté en
  503.
- **Stripe smoke test** (`stripe.products.list({ limit: 1 })`) se
  hace **al arranque**, no en cada healthcheck. El resultado se
  cachea en `stripeReadyAtBoot`. Ejecutarlo en cada healthcheck
  saturaría la API de Stripe y añadiría latencia.

Etiquetas Docker en Dokploy:

```yaml
- "traefik.http.services.fichaje.loadbalancer.healthcheck.path=/api/health"
- "traefik.http.services.fichaje.loadbalancer.healthcheck.interval=30s"
- "traefik.http.services.fichaje.loadbalancer.healthcheck.timeout=5s"
```

El servicio **worker** tiene su propio `/health` interno (puerto
3001) que verifica las conexiones que usa (`master_role`,
`app_role`).

### 2.7 CI/CD GitHub Actions

`.github/workflows/ci.yml` (Fase 8 lo materializa):

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: fichaje_test
        ports: [5432:5432]
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npx tsc --noEmit
      - run: npm run lint                       # incluye no-feature-gate-on-core, no-quota-writer-leak
      - run: npm test
      - run: npm run test:feature-coverage      # ADR-004 §2.8
      # Test E2E NO bloquea: corre en nightly (ver workflow aparte)
```

`.github/workflows/e2e-nightly.yml`:

```yaml
name: E2E nightly
on:
  schedule:
    - cron: '0 3 * * *'   # 03:00 UTC todos los días
  workflow_dispatch:       # permite lanzar manualmente

jobs:
  e2e:
    # Postgres + Stripe modo test + Playwright contra la app
    # Si falla, abre issue automático etiquetado bug:nightly.
```

**Branch protection en `main`** (configurado en GitHub Settings):

- PRs obligatorias.
- Status check `build-and-test` debe pasar.
- 1 review aprobada (cuando haya equipo; en solo-dev, opt-in).
- No push directo.
- No force push.

**Auto-deploy a Dokploy**: webhook configurado en Dokploy escucha
push a `main` y lanza el build.

### 2.8 Observabilidad mínima día 1

Aceptable para Fase 8 (cutover): **logs estructurados en Dokploy +
alertas por email del worker**. Sin Prometheus/Grafana día 1.

#### 2.8.a Logs

- Formato JSON estructurado con `pino` (o equivalente, decisión de
  implementación de Fase 5).
- Cada log lleva: `timestamp`, `level`, `message`, `tenant_id` (si
  aplica), `tenant_slug` (si aplica), `request_id`,
  `route` (si aplica), `duration_ms` (si aplica).
- Stdout/stderr → Dokploy los recoge automáticamente.
- Acceso: Dokploy → app → Logs. Filtrado por substring (no full-text
  search día 1; aceptable a 10–100 tenants).

#### 2.8.b Métricas que importan

Sin sistema de métricas en producción día 1. Las métricas se
extraen ad-hoc del log con grep/jq cuando hagan falta:

- Requests por tenant (count `tenant_slug` en logs de la última
  hora).
- Errores 5xx por tenant.
- Latencia p50/p95 por endpoint (extraído de `duration_ms`).
- Conexiones Postgres por rol (visible en pgbouncer `SHOW POOLS`).

Cuando este volumen no se gestione bien con grep (Fase 9 o cuando
crucemos N=20 tenants), evaluar Prometheus + Grafana o servicio
SaaS (Better Stack, Grafana Cloud).

#### 2.8.c Alertas mínimas

El worker tiene un job programado que detecta condiciones críticas y
envía email al super-admin:

- **Tenant en `PROVISIONING > 10 min`** (ADR-003 §5.2): ya generaba
  un evento en `master.audit_log`; añadimos email.
- **Error rate > 5% en 5 min** (extraído de logs de stdout: contar
  status >= 500 sobre total): job cada 5 min.
- **Healthcheck 503 sostenido > 1 min**: notificación de Dokploy al
  email del proyecto.
- **PR con `bug:nightly` abierto**: GitHub mailing por defecto.

Email destino: `admin@tecnocloud.es` (o el email del super-admin
configurado en `master.super_admins`).

Cuando entre Slack/Telegram bot, las alertas se duplican allí. No
día 1.

---

## 3. Opciones consideradas

### 3.1 pgbouncer: servicio independiente o sidecar de Postgres

| Opción                                         | A favor                                                              | En contra                                                                                                |
|------------------------------------------------|-----------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| **Servicio independiente en Dokploy** (elegida)| Configuración aislada (su propio `pgbouncer.ini`). Escala independiente. Reemplazable sin tocar Postgres. UI Dokploy lo trata como cualquier otro servicio | Otro servicio que mantener. El path del `userlist.txt` con hashes SCRAM hay que sincronizar             |
| Sidecar de Postgres (mismo container/pod)      | Conexión local Unix socket (más rápida)                              | Dokploy no facilita sidecars; requiere docker-compose ad-hoc del Postgres existente, lo que rompe el modelo Dokploy |
| Sin pgbouncer (conexiones directas a Postgres) | Una pieza menos                                                       | Sin pooling, las conexiones por rol × servicio × réplica saturan `max_connections` rápidamente. Y el `SET search_path` por query desperdicia setup TLS por conexión |

### 3.2 `NEXTAUTH_URL` en multi-subdominio

| Opción                                                                                                | A favor                                                                                | En contra                                                                                                       |
|-------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------|
| **`NEXTAUTH_URL = https://app.ficha.tecnocloud.es` + `trustHost: true`** (elegida)                    | URL canónica para el flow de registro/checkout (que vive en `app.*`). `trustHost` permite que cada subdominio de tenant haga login | NextAuth v5 documenta `NEXTAUTH_URL` como la URL del **deployment**. Usar `app.*` es semánticamente correcto para "deployment público" |
| `NEXTAUTH_URL` no seteada, solo `trustHost: true`                                                     | Flexibilidad máxima                                                                     | Algunos paths internos de NextAuth fallan al no tener URL canónica (especialmente en server actions y emails)   |
| `NEXTAUTH_URL` por subdominio (vía wildcard environment)                                              | Cada tenant tiene su propia URL                                                          | No soportado por Dokploy ni por NextAuth nativamente. Habría que parchear el config en runtime, frágil          |

### 3.3 Migración fallida a un tenant: abortar o continuar

| Opción                                                                          | A favor                                                                          | En contra                                                                                                |
|---------------------------------------------------------------------------------|-----------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| **Abortar al primer fallo, mantener versión anterior** (elegida)                | Drift cero. El operador investiga el caso concreto sin presión                   | Un tenant problemático bloquea el deploy de todos los demás                                              |
| Continuar, marcar el tenant como `DEGRADED` y seguir                            | El deploy sigue                                                                  | Drift parcial: unos tenants en versión nueva, otros en vieja. Bugs cross-tenant difíciles de reproducir  |
| Migrar todos en una transacción                                                  | Atómico                                                                           | Imposible: `prisma migrate deploy` no es transaccional cross-schema                                      |

**Argumento decisivo**: drift parcial entre tenants es la peor de las
clases de bug — síntomas distintos en distintos clientes, código que
hace queries que no encajan con el schema. Mejor parar y reparar.

### 3.4 Tests E2E en CI: por PR, nightly o manual

| Opción                                       | A favor                                                                  | En contra                                                                                  |
|----------------------------------------------|---------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| E2E en cada PR                                | Detección temprana                                                       | Costo de infraestructura: levantar Postgres + Stripe modo test + Playwright en cada push   |
| **E2E nightly + manual con `workflow_dispatch`** (elegida) | Coste contenido. Cobertura suficiente para 10–100 tenants. Permite reproducir incidencias bajo demanda | Hasta 24h de retraso en detectar regresiones E2E                                            |
| E2E solo manual                              | Coste mínimo                                                              | Se olvidan. Inviable en producto comercial                                                  |

---

## 4. Consecuencias

### 4.1 Positivas

- **TLS sin rate limits de Let's Encrypt**: wildcard DNS-01 emite un
  cert que cubre infinitos subdominios. Onboarding de tenants
  ilimitado sin tocar Traefik.
- **Subzona delegada acotada a Cloudflare**: el resto de
  `tecnocloud.es` sigue en paginalia. Riesgo operativo aislado.
- **API Token Cloudflare con scope mínimo**: si se filtra, el
  atacante solo puede modificar DNS de `ficha.tecnocloud.es`. No
  puede tocar otras zonas ni otras configuraciones de la cuenta.
- **pgbouncer en session pooling** habilita el patrón
  `SET search_path` de ADR-002 §2.2 y los advisory locks de ADR-004
  §2.10.
- **Migraciones en arranque con abort** garantizan que el código
  desplegado coincide con el schema en master y en todos los tenants
  vivos.
- **CI/CD con auto-deploy y branch protection** elimina el push
  directo a main como vector de error.
- **Observabilidad mínima día 1** funcional sin sobre-ingeniería:
  logs estructurados + alertas email cubren los casos críticos a este
  volumen.

### 4.2 Negativas (asumidas)

- **Cuatro servicios en Dokploy**: app, worker, postgres, pgbouncer.
  Más superficie operativa que con un solo servicio. Aceptable: cada
  uno tiene una responsabilidad clara.
- **`pgbouncer.userlist.txt` mantenido manualmente**: cuando se
  rota una contraseña de rol Postgres, hay que regenerar el hash
  SCRAM y actualizar el archivo. Documentar como runbook en
  `docs/deploy/`.
- **Sin métricas centralizadas día 1**: investigar incidencias
  complejas (ej. degradación de latencia en algunos endpoints) se
  hace con grep sobre Dokploy logs. Funcional a 10–100 tenants;
  insuficiente al cruzar.
- **E2E con 24h de delay**: una regresión introducida en una PR no
  se detecta hasta el run nightly. Mitigación: tests unitarios y de
  integración en cada PR cubren la mayoría de regresiones; el E2E
  detecta solo las que se escapan a esos.
- **Migración fallida bloquea el deploy entero**: un bug de
  migración en un tenant retrasa el deploy de features para todos.
  Mitigación: tests de migraciones en CI con dos schemas en
  paralelo, parte del test de fuga (ADR-001 §2.4).
- **Drift parcial entre tenants ya migrados y tenants pendientes**:
  si la migración pasa a varios tenants antes de fallar, los ya
  migrados están en estructura nueva mientras Dokploy mantiene la
  app vieja. La convención de migraciones backward-compatible
  (§2.5.a) **mitiga**, pero no **elimina** el riesgo: si por error
  se introduce una migración no-compat (ej. `DROP COLUMN` en un
  solo paso) y el deploy falla a mitad, los tenants ya migrados
  rompen con la app vieja. La revisión humana de la PR es la
  última barrera. La regla ESLint
  `migrations-must-be-additive` (Fase 9) detectará los casos
  típicos pero no sustituye al check humano.
- **Ventana de cutover** (§5.4) implica downtime breve. Mitigación:
  comunicación previa al cliente y horario fuera de jornada laboral.

### 4.3 Neutras

- **Cloudflare gratuito** cubre DNS-01 + ratelimits razonables. No
  hay coste recurrente añadido.
- **Renovación de certs automática**: Traefik la maneja. Si falla,
  hay 30 días de margen entre renovación intentada (60 días desde
  emisión) y expiración (90 días).
- **`acme.json` de Traefik** es un punto único de fallo si se
  pierde. Backup en cada deploy de Dokploy o en cron diario.
  Recreable: si se pierde, Traefik emite los certs de nuevo (puede
  tocar rate limits si se hace en un día con muchas emisiones).
- **Dokploy webhook → push a main → auto-deploy**: el ciclo full
  desde merge a producción es de minutos. El cambio se ve rápido,
  los errores también.

---

## 5. Implicaciones para fases siguientes

### 5.1 Fase 4 — Onboarding y worker

- El servicio `worker` se levanta en Dokploy con el mismo build que
  `app`, comando `node dist/worker.js`.
- Conexiones del worker: `MASTER_DATABASE_URL` y
  `APP_DATABASE_URL` (no `TENANT_RUNTIME_DATABASE_URL` ni
  `QUOTA_WRITER_DATABASE_URL`).
- Endpoint `/api/webhooks/stripe` de la app (ADR-003 §2.5)
  configurado en Stripe dashboard como webhook endpoint:
  `https://app.ficha.tecnocloud.es/api/webhooks/stripe`.

### 5.2 Fase 8 — Despliegue Dokploy

Esta fase consume todo lo de §2 + §6 (cutover). La documentación
operativa de detalle vive en `docs/deploy/dokploy.md`,
`docs/deploy/cloudflare.md` y `docs/deploy/cutover.md` (a redactar
en Fase 8).

#### 5.2.a Runbook: rotación de contraseña de un rol Postgres

`docs/deploy/rotate-postgres-password.md` (Fase 8) cierra los pasos
con detalle. Esquema de la operación con cero downtime:

1. Generar el nuevo hash SCRAM con la utilidad de pgbouncer
   (`pgbouncer -mkauth` o equivalente con `psql`).
2. **Añadir** el nuevo password al `userlist.txt` **sin quitar el
   viejo**. Ambos quedan válidos transitoriamente.
3. `pgbouncer -R` (reload sin restart) para que pgbouncer relea el
   archivo sin cortar las conexiones existentes.
4. `ALTER ROLE <rol> PASSWORD '<nueva>'` en Postgres como
   `master_role`.
5. Actualizar el secret correspondiente en Dokploy
   (`MASTER_DATABASE_URL`, `APP_DATABASE_URL`,
   `TENANT_RUNTIME_DATABASE_URL` o `QUOTA_WRITER_DATABASE_URL`).
   Dokploy hace rolling restart de los servicios afectados con la
   nueva URL.
6. Esperar a que las conexiones existentes terminen su ciclo por
   `server_lifetime` (3600 s configurado en §2.2.d). Mientras
   tanto, las nuevas conexiones usan ya la nueva contraseña.
7. **Eliminar** el password viejo del `userlist.txt` y `pgbouncer -R`
   final.

**Garantía**: cero downtime durante la rotación si los pasos se
siguen en orden. Si se invierte (eliminar el viejo antes de añadir
el nuevo en `userlist.txt`, o `ALTER ROLE` antes del paso 2), las
conexiones existentes mueren y los servicios reciben errores de
auth durante la ventana — operación destructiva.

El runbook detallado incluirá comandos exactos, validaciones tras
cada paso (`SELECT version()` con la nueva conexión, `SHOW POOLS`
en pgbouncer) y el rollback ante fallo a mitad.

### 5.3 Fase 9 — Calidad y observabilidad avanzada

Cuando crucemos ~20 tenants en producción o cuando alguna métrica
necesite agregación cross-tenant en tiempo real, evaluar:

- **Prometheus + Grafana** o **Better Stack** o **Grafana Cloud**.
- Endpoint `/metrics` en Prometheus exposition format en `app` y
  `worker`.
- Dashboards: requests/s por tenant, latencia p95, conexiones
  Postgres por rol y por servicio, estado de jobs del worker.

Esto es **Fase 9**, no parte del cutover.

### 5.4 Fase 8 — Plan de cutover paso a paso

El cutover migra el estado actual (mono-tenant en `public` schema,
servido directamente por `ficha.tecnocloud.es`) al estado SaaS
(multi-tenant con cliente actual en `tenant_<slug>`, control plane
en `master`, subdominio dedicado).

#### Pre-requisitos

- Rama `feature/saas-migration` lista, todos los ADRs cerrados,
  todos los criterios de aceptación cumplidos.
- Cliente notificado con la ventana operativa estimada (mínimo 48 h
  de antelación).
- VPS Dokploy actualizada con Cloudflare DNS-01 ya operativo (§2.1).
- Backup completo de Postgres verificado (restaurable en una DB
  efímera).

#### Ventana operativa estimada: 1–2 horas

- 30 min cutover técnico (pasos a–i).
- 30 min validación (paso i).
- 30 min margen de rollback si algo falla.

Recomendación: ejecutar en sábado por la mañana o festivo, fuera de
jornada laboral del cliente.

#### Pasos del cutover

**a. Backup completo**

```sh
# Desde Dokploy CLI o ssh a VPS
pg_dump -Fc -d fichaje > /backups/cutover-precheck-$(date +%Y%m%d-%H%M%S).dump
# Verificar restore en BD efímera
pg_restore -d fichaje_verify_$(date +%s) /backups/cutover-precheck-*.dump
```

**b. Maintenance mode**

Activar en Traefik (Dokploy): redirigir `ficha.tecnocloud.es` y
todos sus subdominios a una página estática "mantenimiento, vuelve
en 1 hora". La app actual queda desconectada del tráfico.

**c. Desplegar `feature/saas-migration` en Dokploy**

Merge a `main` de `feature/saas-migration` → push → auto-deploy.

`entrypoint.sh` ejecutará `prisma migrate deploy` al control plane
(crear `master`, todas sus tablas, los 4 enums). Como aún no hay
tenants registrados, `migrate-tenants.js` no hace nada.

**d. Crear los 4 roles Postgres**

Vía script SQL ejecutado con psql (`master_role` ya viene del setup
inicial; los otros 3 se crean ahora):

```sql
-- master_role: ya existe, propietario de master
CREATE ROLE app_role           LOGIN PASSWORD '****';
CREATE ROLE tenant_runtime_role LOGIN PASSWORD '****';
CREATE ROLE quota_writer_role  LOGIN PASSWORD '****';

GRANT USAGE ON SCHEMA master TO tenant_runtime_role;
GRANT SELECT ON master.tenants            TO tenant_runtime_role;
GRANT SELECT ON master.reserved_slugs     TO tenant_runtime_role;
GRANT SELECT ON master.tenant_features    TO tenant_runtime_role;
GRANT SELECT ON master.tenant_quota_usage TO tenant_runtime_role;

GRANT USAGE ON SCHEMA master TO quota_writer_role;
GRANT SELECT, INSERT, UPDATE ON master.tenant_quota_usage TO quota_writer_role;
```

`pgbouncer.userlist.txt` se actualiza con los hashes SCRAM de los 4
roles. Reload pgbouncer (no restart).

**e. Crear el schema `tenant_<slug>` y aplicar migraciones del producto**

Decidir el `<slug>` del cliente actual. Sugerencia: nombre corto
del cliente (ej: `telecom`, `acme`).

```sh
# Desde Dokploy CLI
DATABASE_URL="$MASTER_DATABASE_URL" \
  npm run tenants:provision -- telecom enterprise
```

Esto inserta el tenant en `master.tenants` con `status = ACTIVE`,
`plan_key = enterprise`, sentinels `cus_manual_<id>` /
`sub_manual_<id>` (ADR-004 §5.4), crea `master.subscriptions` y
`master.subscription_items`, y aplica las migraciones del producto
al schema `tenant_telecom`.

Insertar también features de Enterprise en `master.tenant_features`
con `source = 'plan'` y filas iniciales en `master.tenant_quota_usage`
(ADR-004 §5.4).

**f. Migrar datos del schema `public` actual al schema `tenant_<slug>`**

```sh
# 1. Dump del schema public actual a un archivo
pg_dump -Fp --schema=public -d fichaje > /tmp/public-data.sql

# 2. Renombrar todos los "public." a "tenant_telecom." con sed
sed -i 's/public\./tenant_telecom./g' /tmp/public-data.sql

# 3. Eliminar las DDL de creación de tablas (ya las hizo migrate)
# y dejar solo los COPY/INSERT
grep -E '^(COPY|INSERT)' /tmp/public-data.sql > /tmp/data-only.sql

# 4. Aplicar al schema del tenant
psql -d fichaje -f /tmp/data-only.sql
```

**Mapeo de tablas**:

- **Todas las tablas del schema `public` actual** (User, Tienda,
  Fichaje, Turno, Ausencia, etc. — los 19 modelos) van a
  `tenant_telecom`.
- **Ninguna tabla del actual va a `master`**. `ConfiguracionEmpresa`
  del actual queda en `tenant_telecom.ConfiguracionEmpresa`
  (configuración de su empresa); `master.tenants`/`subscriptions`/
  etc. son de plataforma y se rellenan en el paso (e).

**g. Verificación de integridad de datos**

```sql
-- Comparar counts entre public original y tenant_telecom nuevo
SELECT
  (SELECT count(*) FROM public.user) AS users_public,
  (SELECT count(*) FROM tenant_telecom.user) AS users_tenant,
  (SELECT count(*) FROM public.fichaje) AS fichajes_public,
  (SELECT count(*) FROM tenant_telecom.fichaje) AS fichajes_tenant;
-- Deben ser iguales fila a fila para todas las tablas.
```

Si los counts no coinciden, rollback (paso k).

**h. Configurar el subdominio del cliente y apex**

DNS ya cubierto por wildcard (§2.1). El cliente puede acceder
desde `telecom.ficha.tecnocloud.es` inmediatamente.

Para el apex (`ficha.tecnocloud.es`):

- **Decisión**: redirect 301 a `app.ficha.tecnocloud.es` (la
  landing del SaaS), no al subdominio del cliente. Justificación:
  el apex es de plataforma, no del cliente. Otros clientes futuros
  usan sus subdominios; el apex sirve marketing/registro.
- **Excepción opcional durante el cutover**: si el cliente accedía
  a `ficha.tecnocloud.es` y queremos minimizar fricción los
  primeros días, redirigir el apex a `telecom.ficha.tecnocloud.es`
  durante 7 días. Tras ese plazo, redirigir a
  `app.ficha.tecnocloud.es` permanentemente. Configurable con un
  middleware Next.js.

**i. Quitar maintenance mode + verificación funcional**

Desactivar el redirect de Traefik. El cliente accede al nuevo
subdominio.

Checklist de verificación (script automatizable):

1. `https://telecom.ficha.tecnocloud.es` carga y redirige a /login.
2. Login con credenciales del OWNER del cliente actual funciona.
3. Dashboard muestra el "Who's in" con datos reales.
4. Crear un fichaje (entrada) funciona.
5. Histórico de fichajes muestra los datos migrados.
6. Export del registro legal (CORE) funciona.
7. `/api/me/features` devuelve features de Enterprise.
8. `https://app.ficha.tecnocloud.es/registro` muestra la landing
   nueva (signup).
9. `https://admin.ficha.tecnocloud.es` muestra el panel super-admin
   (login con cuenta de plataforma).
10. Healthcheck `/api/health` devuelve 200.

**j. Comunicación al cliente**

Email al OWNER del cliente:

- "El servicio está disponible en
  `https://telecom.ficha.tecnocloud.es`".
- "Si tenías guardada la URL antigua, los próximos 7 días te
  redirigimos automáticamente. A partir del [fecha], sustituye la
  URL en tus marcadores."
- "Cualquier incidencia, contacta a
  [admin@tecnocloud.es](mailto:admin@tecnocloud.es)".

#### Plan de rollback

Si **cualquier paso entre (b) y (i)** falla y no se resuelve en
≤30 min:

**k. Rollback**

```sh
# 1. Apagar la versión nueva en Dokploy (rollback al deploy anterior)
# 2. Reactivar la app actual en su estado pre-cutover
# 3. Restaurar el backup del paso (a) si la BD se ha tocado de forma
#    irreversible (no debería: los pasos (d), (e), (f) son aditivos —
#    crear schemas, no borrarlos)
pg_restore -d fichaje --clean --if-exists /backups/cutover-precheck-*.dump

# 4. Quitar maintenance mode
# 5. Cliente accede normalmente en ficha.tecnocloud.es como antes
```

Comunicación: email al cliente "se aborta el mantenimiento, todo
sigue como estaba; nueva ventana programada el [fecha]".

Las claves Postgres creadas en (d) y los schemas (e) pueden quedar
o eliminarse:

```sql
DROP SCHEMA tenant_telecom CASCADE;
DROP SCHEMA master CASCADE;
DROP ROLE app_role, tenant_runtime_role, quota_writer_role;
```

El backup de (a) es la red de seguridad principal.

---

## 6. Criterios de aceptación

Esta decisión se considera implementada cuando, al término de Fase 8,
todos los siguientes son ciertos:

1. `dig +short ns ficha.tecnocloud.es` devuelve los NS de Cloudflare
   (no los de paginalia).
2. `curl -I https://acme.ficha.tecnocloud.es` devuelve cert válido
   `*.ficha.tecnocloud.es` con CN/SAN apropiado, sin warnings.
3. `curl -I https://ficha.tecnocloud.es` devuelve cert válido
   distinto (cert apex).
4. Los 4 servicios (`app`, `worker`, `postgres`, `pgbouncer`) están
   `running` en el panel Dokploy. Sin Redis.
5. `psql -h pgbouncer -p 6432 -U app_role -d fichaje -c "SHOW
   POOL_MODE"` devuelve `session`.
6. Las 4 conexiones Postgres a través de pgbouncer funcionan con su
   rol respectivo (test de aislamiento de roles ya en ADR-004 §6).
7. `entrypoint.sh` aplica migraciones al control plane y a todos
   los schemas `tenant_*` antes de arrancar la app. Si una falla,
   el arranque aborta y Dokploy mantiene el deploy anterior.
8. `GET /api/health` devuelve 200 cuando todo está OK y 503 cuando
   alguna conexión falla. Verificado con un test que apaga
   pgbouncer y observa el 503.
9. CI/CD: PR a `main` ejecuta lint + typecheck + test +
   `test:feature-coverage` + lints custom; los E2E corren nightly y
   abren issue automático ante fallo.
10. Branch protection en `main`: PR obligatoria, no force push, no
    push directo. Verificado en GitHub Settings.
11. El cutover (§5.4) se ejecuta sin intervención manual entre
    pasos (a)–(i). Todos los datos del cliente original están
    accesibles desde su nuevo subdominio.
12. El apex `ficha.tecnocloud.es` redirige 301 a
    `app.ficha.tecnocloud.es` (o, durante el periodo transicional,
    al subdominio del cliente).
13. Logs estructurados JSON visibles en Dokploy con `tenant_slug` y
    `request_id` en cada línea.
14. Alertas email funcionan: simular un PROVISIONING > 10 min y
    verificar que llega el email a `admin@tecnocloud.es`.

---

## 7. Referencias

- [`docs/arch/00-auditoria.md`](./00-auditoria.md):
  - §5 (despliegue actual: Dokploy, Postgres provisionado, dominio
    `ficha.tecnocloud.es`, TLS Let's Encrypt HTTP-01).
  - §6 (tests existentes: 0% — Fase 9 monta infra de testing).
- [ADR-000](./adr-000-vision-saas.md) — visión SaaS.
- [ADR-001](./adr-001-aislamiento-multi-tenant.md), §2.3 (cuatro
  roles Postgres tras enmiendas), §5.3 (pgbouncer session pooling),
  §5.4 (TLS opción A pre-confirmada), §5.5 (backup master prioritario).
- [ADR-002](./adr-002-resolucion-tenant.md), §2.1 (subdominios y
  apex), §2.2 (search_path por query), §3.4 (Redis no día 1), §3.6
  (`tenant_resolver_role` → renombrado en ADR-004).
- [ADR-003](./adr-003-billing-y-suscripciones.md), §2.3 (webhook
  endpoint), §2.5 (firma webhook), §5.4 (claves Stripe en Dokploy),
  §5.2 (worker dual-rol).
- [ADR-004](./adr-004-feature-flags-y-addons.md), §2.2 (dos roles
  Postgres tenant_runtime_role + quota_writer_role), §5.4 (cutover
  del cliente actual a Enterprise con sentinels).
- [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md),
  apartado 7 (Despliegue Dokploy), Fase 8.
- Cloudflare docs:
  [Add a site (subzone)](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/),
  [API Tokens — Zone DNS Edit](https://developers.cloudflare.com/api/tokens/create/),
  [DNS Challenge — Traefik integration](https://doc.traefik.io/traefik/https/acme/#dnschallenge).
- pgbouncer docs:
  [Pool modes](https://www.pgbouncer.org/usage.html#pool-modes),
  [SCRAM auth](https://www.pgbouncer.org/config.html#auth_type).
- Dokploy docs:
  [Services](https://dokploy.com/docs/services),
  [Healthchecks](https://dokploy.com/docs/healthchecks),
  [Webhooks](https://dokploy.com/docs/webhooks).
- NextAuth v5 docs:
  [`trustHost` option](https://authjs.dev/reference/core#trusthost),
  [Multiple domains](https://authjs.dev/getting-started/deployment#multiple-domains).
- ADR-007 (auth super-admin) — pendiente, cierra el flow del panel
  `admin.*`.
- ADR-008 (lifecycle del tenant) — pendiente, cierra
  `SUSPENDED → DELETED`.
- Real Decreto-ley 8/2019 de 8 de marzo: condiciona la retención de
  4 años (relevante para backups).
