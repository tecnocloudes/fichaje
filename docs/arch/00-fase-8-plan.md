# Plan de Fase 8 — Despliegue producción Dokploy (empleaia.es)

- **Estado**: PLANIFICADA — pendiente OK del operador en §15.
- **Fecha**: 2026-05-02
- **Rama de trabajo**: `feature/saas-migration` (escritura del plan).
- **Rama de despliegue**: `production` (a crear desde `main` cuando se
  inicie la implementación).
- **ADR base**: ADR-005 — con **enmienda de dominio**
  (`ficha.tecnocloud.es` → `empleaia.es`). Ver §17 "Diferencias con
  ADR-005" para el detalle exacto.

---

## §1. Resumen ejecutivo

Fase 8 despliega la app SaaS multi-tenant (cerrada en Fases 0–7) en
producción **bajo el dominio nuevo `empleaia.es`**, hospedada en el
servidor Dokploy `dockploy.tecnocloud.es` (rango `185.99.186.64/28`).

La cobertura de esta fase es **deploy nuevo, no migración**: la app
mono-tenant antigua sigue corriendo en `ficha.tecnocloud.es` para sus
clientes actuales (proyecto separado, fuera de Fase 8). El primer
cliente que se onboarda en `empleaia.es` será un tenant nuevo, no
una migración del existente. La migración del cliente actual
(`ficha.tecnocloud.es` → `<slug>.empleaia.es`) queda como TODO Fase
9+ con su propio plan y ventana operativa.

Stripe arranca en **modo TEST**. Cuando llegue el primer cliente
real con tarjeta, se hace un cambio puntual de 4 variables en Dokploy
+ redeploy para pasar a LIVE (procedimiento documentado en §11).

Auto-deploy desde rama `production` con healthcheck obligatorio post
deploy (`GET /api/healthz` debe devolver 200 en ≤30 s o Dokploy hace
rollback automático).

**Tiempo estimado de implementación** (no de este plan): 8–12
commits, 2–3 sesiones de trabajo, con verificación E2E en tarjeta
real al final.

**Prerequisitos del operador** (§3): comprar / verificar dominio
`empleaia.es`, configurar Cloudflare como DNS authoritative para esa
zona, crear API Token Cloudflare con scope `Zone:DNS:Edit` para
`empleaia.es`, abrir cuenta de email transaccional con dominio
`empleaia.es` verificado.

---

## §2. Arquitectura del despliegue

```
                     INTERNET
                        │
                        ▼
              ┌──────────────────┐
              │   Cloudflare DNS │   Zone authoritative: empleaia.es
              │  (DNS-only mode, │   Records:
              │   sin proxy)     │     A      empleaia.es              → 185.99.186.x
              │                  │     A      app.empleaia.es          → 185.99.186.x
              │                  │     A      admin.empleaia.es        → 185.99.186.x
              │                  │     A      *.empleaia.es            → 185.99.186.x
              │                  │     TXT    _acme-challenge.*        ← Traefik DNS-01
              └────────┬─────────┘
                       │
                       ▼
          ┌────────────────────────────┐
          │   dockploy.tecnocloud.es   │   Servidor Dokploy
          │   (185.99.186.x — VPS      │   - Traefik (ingress)
          │   Stackscale)              │   - Wildcard cert *.empleaia.es
          │                            │     emitido vía Let's Encrypt
          │                            │     DNS-01 challenge contra
          │                            │     Cloudflare API Token.
          └────────────┬───────────────┘
                       │ network: dokploy_default
        ┌──────────────┼─────────────────┬───────────────┐
        │              │                 │               │
        ▼              ▼                 ▼               ▼
   ┌─────────┐   ┌──────────┐     ┌───────────┐    ┌──────────┐
   │   app   │   │  worker  │     │ postgres  │    │ pgbouncer│
   │ Next.js │   │ jobs cron│     │   16-     │    │ session  │
   │ 16.2.3  │   │ + webhook│     │   alpine  │    │ pooling  │
   │         │   │ procesador│    │           │    │ (opcional│
   │ port    │   │ (worker.ts)│   │ port 5432 │    │  Fase 8.5│
   │ 3000    │   │           │    │ vol:      │    │  ver §17)│
   │         │   │           │    │ postgres_ │    │          │
   │         │   │           │    │ fichaje_  │    │          │
   │         │   │           │    │ data      │    │          │
   └────┬────┘   └────┬──────┘    └─────┬─────┘    └─────┬────┘
        │             │                  │                │
        └─────────────┴──────────────────┴────────────────┘
                              │
                              ▼ (via volumen Docker NAMED, persistente)
                    ┌────────────────────┐
                    │ postgres_fichaje_  │   /var/lib/postgresql/data
                    │    data (volume)   │   Sobrevive a recreaciones
                    └────────────────────┘   del container postgres.

Backups (cron Dokploy):
  /backups/postgres/empleaia-YYYY-MM-DD.sql.gz       (diario 03:00 UTC)
  rsync /backups → stackscale-backup.tecnocloud.es   (semanal)
  Retención: 30 días local, 90 días remoto.
```

**Subdominios canónicos** (todos con cert wildcard único):

| Host                      | Función                                        | `kind` (proxy.ts) |
|---------------------------|------------------------------------------------|--------------------|
| `empleaia.es`             | Apex → 301 redirect a `app.empleaia.es`        | `apex`             |
| `app.empleaia.es`         | Landing, `/registro`, webhook Stripe           | `app`              |
| `admin.empleaia.es`       | Panel super-admin                              | `admin`            |
| `<slug>.empleaia.es`      | Subdominio del tenant (login + producto)       | `tenant`           |
| Custom domain del tenant  | Verificado por TXT, opcional, addon Enterprise | `custom_domain_candidate` |

---

## §3. Prerequisitos del operador

Lo que tiene que haber listo **antes** de que el bloque de
implementación arranque. El plan asume que estos puntos están
cerrados — si alguno falla, la implementación se bloquea.

### 3.1 Dominio y DNS

- [ ] Dominio `empleaia.es` registrado y bajo control del operador
      (cualquier registrar válido).
- [ ] Cuenta Cloudflare con la zona `empleaia.es` añadida y los
      nameservers de Cloudflare apuntados desde el registrar
      (`dig +short ns empleaia.es @8.8.8.8` debe devolver
      `*.cloudflare.com`).
- [ ] **API Token de Cloudflare** creado con scope **mínimo**:
        - Permissions: `Zone — DNS — Edit` (solo).
        - Zone Resources: `Include — Specific zone — empleaia.es`.
        - Client IP Address Filtering: IP pública de
          `dockploy.tecnocloud.es`.
        - TTL: sin expiración.
      Token guardado en password manager; se inyectará a Traefik
      como secret de Dokploy en §4.

### 3.2 Servidor Dokploy

- [ ] Acceso SSH al servidor `dockploy.tecnocloud.es`.
- [ ] Acceso al panel Dokploy (URL + credenciales).
- [ ] Disco con **al menos 50 GB libres** para `/backups/postgres`
      + volumen Postgres + imágenes Docker. `df -h` para verificar.
- [ ] Confirmar que **no hay otro servicio Dokploy escuchando en
      `*.empleaia.es`** (la app Ficha actual escucha en
      `ficha.tecnocloud.es`, no debería conflictuar; pero un proyecto
      paralelo con otro `*.empleaia.es` rompería el routing).

### 3.3 Stripe

- [ ] Cuenta Stripe creada (la del operador, ya usada en Fase 4 con
      keys `sk_test_*` / `pk_test_*`).
- [ ] **Productos y precios** creados en modo TEST con
      `npm run stripe:bootstrap` (Fase 4). Verificar IDs en el
      dashboard Stripe (modo TEST).
- [ ] **Endpoint de webhook NUEVO** creado en el dashboard Stripe
      modo TEST apuntando a `https://app.empleaia.es/api/webhooks/stripe`
      con eventos `checkout.session.completed`,
      `customer.subscription.updated`,
      `customer.subscription.deleted`,
      `invoice.payment_succeeded`,
      `invoice.payment_failed`. Copiar el `whsec_*` que devuelve.

### 3.4 Email transaccional

- [ ] Cuenta **Resend** (o equivalente) creada.
- [ ] Dominio `empleaia.es` añadido a Resend, registros DKIM/SPF/DMARC
      configurados en Cloudflare, dominio **verified** en Resend.
- [ ] API Key de Resend con permisos de envío.
- [ ] Dirección remitente del sistema confirmada:
      `noreply@empleaia.es` (propuesta — confirmar en §15.1).

### 3.5 Operador

- [ ] Cuenta de email del operador para alertas de deploy
      (propuesta: `dansanch@tecnocloud.es` — confirmar en §15.2).
- [ ] Contraseña fuerte para el primer super-admin de la plataforma
      en `admin.empleaia.es` (se crea con `npm run super-admin:create`
      en el primer arranque del container).

---

## §4. DNS y Cloudflare

Configuración de la zona `empleaia.es` en Cloudflare.

### 4.1 Records DNS

Todos los records con **proxy desactivado** (gris, "DNS only"). El
proxy naranja de Cloudflare introduce TLS adicional y rompe el
DNS-01 challenge de Traefik si está en modo full strict — se
gestiona el TLS íntegramente en el origen.

| Tipo  | Nombre              | Destino             | Proxy   | TTL  |
|-------|---------------------|---------------------|---------|------|
| A     | `empleaia.es`       | `<IP VPS Dokploy>`  | DNS only | Auto |
| A     | `app.empleaia.es`   | `<IP VPS Dokploy>`  | DNS only | Auto |
| A     | `admin.empleaia.es` | `<IP VPS Dokploy>`  | DNS only | Auto |
| A     | `*.empleaia.es`     | `<IP VPS Dokploy>`  | DNS only | Auto |
| TXT   | `empleaia.es`       | `v=spf1 include:_spf.resend.com ~all` | — | Auto |
| TXT   | `_dmarc.empleaia.es`| `v=DMARC1; p=none; rua=mailto:dansanch@tecnocloud.es` | — | Auto |
| MX    | `empleaia.es`       | (vacío o el del operador) | — | Auto |

Records DKIM y `resend._domainkey` los proporciona Resend al añadir
el dominio (paso §3.4). Copiar y pegar.

**TTL inicial bajo (1 min)** durante setup para iterar rápido sobre
errores DNS. Subir a Auto (5 min) cuando esté estable.

### 4.2 Wildcard SSL con DNS-01

Traefik en Dokploy emite el cert wildcard automáticamente. Receta
ya documentada en ADR-005 §2.1.c — se aplica al pie de la letra,
solo cambia el dominio.

```yaml
# Configuración Traefik en Dokploy (gestionado por la UI):
certificatesResolvers:
  cloudflare:
    acme:
      email: dansanch@tecnocloud.es
      storage: /letsencrypt/acme.json
      dnsChallenge:
        provider: cloudflare
        resolvers: ["1.1.1.1:53", "8.8.8.8:53"]

# Variable de entorno de Traefik (NO de la app):
CLOUDFLARE_DNS_API_TOKEN = <token de §3.1>
```

Etiquetas Docker en el servicio `app` (Dokploy las genera al
configurar dominio + wildcard):

```yaml
- "traefik.http.routers.empleaia.rule=HostRegexp(`{subdomain:[a-z0-9-]+}.empleaia.es`) || Host(`empleaia.es`)"
- "traefik.http.routers.empleaia.tls=true"
- "traefik.http.routers.empleaia.tls.certresolver=cloudflare"
- "traefik.http.routers.empleaia.tls.domains[0].main=empleaia.es"
- "traefik.http.routers.empleaia.tls.domains[0].sans=*.empleaia.es"
```

Resultado: dos certs emitidos automáticamente:

- `empleaia.es` (apex).
- `*.empleaia.es` (wildcard, válido para `app.*`, `admin.*` y todos
  los `<slug>.*`).

Renovación cada 60 días (Let's Encrypt expira a los 90).

### 4.3 Custom domains de tenants (Fase 6)

Si un tenant Enterprise contrata el addon `dominio_personalizado` y
añade su dominio (ej. `fichaje.cliente1.com`):

1. Tenant crea record TXT `_fichaje-verify.fichaje.cliente1.com` =
   `<token>` (devuelto por `/api/configuracion/dominio`).
2. El operador (o cron Fase 9) verifica el TXT y marca
   `master.tenants.customDomainVerified = true`.
3. El tenant apunta `fichaje.cliente1.com` al servidor Dokploy con
   un `CNAME` o `A`.
4. Dokploy / Traefik emite cert HTTP-01 para ese dominio
   (configurado vía API Dokploy o etiqueta Docker dinámica).

Esta lógica ya está en el código (Fase 6). Lo que **Fase 8 verifica**
es que la emisión HTTP-01 funciona en producción para custom domains
(además del DNS-01 wildcard).

---

## §5. Estructura de archivos a crear / modificar

Lista de los artefactos que el bloque de implementación tocará. NO
se tocan en este plan — solo se documentan.

### 5.1 `Dockerfile` (modificar)

El Dockerfile actual (`./Dockerfile`) ya es multi-stage con
`node:22-alpine` y output standalone (ver `Dockerfile` actual líneas
1–48). Cambios a aplicar:

- Añadir `entrypoint.sh` que ejecute migraciones antes de arrancar.
- Confirmar `output: 'standalone'` en `next.config.ts`.
- Añadir `CMD ["/app/entrypoint.sh", "node", "server.js"]`.
- Mantener usuario no-root `nextjs:1001`.

### 5.2 `docker-compose.yml` (modificar / reescribir)

El actual (`./docker-compose.yml` líneas 1–60) es para **dev local**:
postgres + app + migrate. Para producción se necesita un
`docker-compose.production.yml` (o configurar directamente en
Dokploy desde su UI):

- Servicio `app` (build del repo, command `entrypoint.sh node server.js`).
- Servicio `worker` (mismo build, command `npx tsx scripts/worker.ts`).
- Servicio `postgres` (image `postgres:16-alpine`, volumen NAMED
  `postgres_fichaje_data`).
- (Opcional Fase 8.5) Servicio `pgbouncer` (image
  `edoburu/pgbouncer`) — ver §17. **Fase 8 día 1: sin pgbouncer**.

Decisiones técnicas:

- **Volumen NAMED** `postgres_fichaje_data` (no bind mount). Esto
  asegura que `docker-compose down` sin `-v` NO borra los datos.
- Postgres password en **secret de Dokploy** (no en compose).
- `restart: unless-stopped` en los 3 servicios.
- Healthcheck en cada servicio (§8).
- Network interna `dokploy_default` — los containers se ven entre
  sí por nombre (`postgres`, `app`, `worker`).

### 5.3 `scripts/entrypoint.sh` (NUEVO)

```sh
#!/bin/sh
set -euo pipefail

echo "[entrypoint] $(date -u +%Y-%m-%dT%H:%M:%SZ) — Fichaje SaaS arrancando..."

# 1. Crear roles Postgres si no existen (master_role, app_role,
#    tenant_runtime_role, quota_writer_role).
echo "[entrypoint] Creando roles Postgres (idempotente)..."
psql "$MASTER_DATABASE_URL" \
  -v app_role_password="$APP_ROLE_PASSWORD" \
  -v tenant_runtime_role_password="$TENANT_RUNTIME_ROLE_PASSWORD" \
  -v quota_writer_role_password="$QUOTA_WRITER_ROLE_PASSWORD" \
  -f /app/scripts/sql/00-roles.sql

# 2. Migraciones del control plane (master.*).
echo "[entrypoint] Aplicando migraciones master..."
DATABASE_URL="$MASTER_DATABASE_URL" \
  npx prisma migrate deploy --schema=prisma/schema.prisma

# 3. Migraciones a todos los tenants existentes.
#    En arranque inicial no hay tenants — el script termina rápido.
echo "[entrypoint] Aplicando migraciones a tenants existentes..."
DATABASE_URL="$MASTER_DATABASE_URL" \
  npx tsx scripts/tenants-migrate.ts -- --all

# 4. Seed inicial de plans/features/reserved_slugs (idempotente).
echo "[entrypoint] Seed master (plans + features + reserved_slugs)..."
DATABASE_URL="$MASTER_DATABASE_URL" \
  npx tsx prisma/seeds/master.ts

echo "[entrypoint] Migraciones OK. Arrancando servicio: $@"
exec "$@"
```

**Manejo de fallos**: si una migración falla, `set -e` aborta el
script con exit ≠ 0 → Dokploy no marca el deploy como exitoso →
mantiene el container anterior (rollback automático). Política
heredada de ADR-005 §2.5 (abortar al primer fallo, drift cero).

**Migraciones backward-compatible obligatorias** (ADR-005 §2.5.a):
no se añaden columnas NOT NULL en una sola migración, no se borran
columnas en una sola migración. Cada PR con migración debe ser
compatible con la versión inmediatamente anterior de `main`.

### 5.4 `src/app/api/healthz/route.ts` (NUEVO)

Endpoint público (sin auth, sin tenant check) que verifica
dependencias críticas:

```ts
// Pseudocódigo — el bloque de implementación lo materializa.
import { NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";

export async function GET() {
  const checks: Record<string, boolean | string> = {};

  // Master DB
  try {
    await prismaMaster.$queryRaw`SELECT 1`;
    checks.db_master = true;
  } catch {
    checks.db_master = false;
  }

  // Versión (commit SHA inyectado en build)
  checks.version = process.env.GIT_SHA ?? "unknown";

  const ok = checks.db_master === true;
  return NextResponse.json(
    { status: ok ? "ok" : "error", checks },
    { status: ok ? 200 : 503 }
  );
}
```

Decisiones:

- **NO chequea Stripe en cada request** (ADR-005 §2.6): smoke test
  al arranque, cachea el resultado en una variable de módulo. La
  app no falla en healthcheck si Stripe está caído brevemente.
- **NO chequea conectividad a tenants individuales**: el healthcheck
  es del servicio app, no de cada tenant.
- **Excluido del proxy.ts withTenant**: añadir a la whitelist (ya
  cubierta por la convención `/api/healthz` no requiere tenant
  context).
- Endpoint Traefik: `traefik.http.services.empleaia.loadbalancer.healthcheck.path=/api/healthz`,
  interval 30s, timeout 10s, unhealthy_threshold 3.

### 5.5 `scripts/backup.sh` (NUEVO)

```sh
#!/bin/sh
set -euo pipefail

BACKUP_DIR="/backups/postgres"
RETENTION_DAYS=30
TIMESTAMP=$(date -u +%Y-%m-%d-%H%M%S)
DEST="$BACKUP_DIR/empleaia-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

# pg_dump con compresión gzip.
docker exec fichaje_postgres \
  pg_dump -U fichaje_admin -d fichaje | gzip > "$DEST"

# Verificación: archivo creado y > 1 KB.
test -s "$DEST" || { echo "[backup] FALLO: dump vacío"; exit 1; }

# Rotación: borrar dumps > 30 días.
find "$BACKUP_DIR" -type f -name "empleaia-*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "[backup] OK — $DEST ($(du -h "$DEST" | cut -f1))"

# Sync remoto a Stackscale (semanal: día 0 = domingo).
if [ "$(date -u +%w)" -eq 0 ]; then
  rsync -av --delete \
    -e "ssh -i /etc/dokploy/backup-key.id_rsa" \
    "$BACKUP_DIR/" \
    backup@stackscale-backup.tecnocloud.es:/backups/empleaia/
  echo "[backup] sync remoto OK"
fi
```

Configuración Dokploy: cron diario `0 3 * * *` (03:00 UTC) ejecuta
este script.

**SSH key dedicada**: generar `backup-key.id_rsa` (ed25519) específica
para este sync, autorizada solo para `backup@stackscale-backup` con
`command=` restringido a `rsync --server`. Guardar en
`/etc/dokploy/backup-key.id_rsa` con permisos 0600 owned by root.

### 5.6 `.env.production.example` (NUEVO)

Plantilla con TODAS las variables, sin valores reales. Documentado
en §6. Va al repo (no es secret).

### 5.7 `.github/workflows/ci.yml` (NUEVO)

CI que corre lint + typecheck + tests en cada PR a `main` y a
`production`. **Bloquea merge a `production` si falla** (branch
protection en GitHub Settings).

```yaml
name: CI
on:
  pull_request:
    branches: [main, production]
  push:
    branches: [main, production]

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
        options: --health-cmd pg_isready --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test
      - run: npm run test:feature-coverage
```

E2E nightly se queda como TODO Fase 9 (no bloquea Fase 8).

### 5.8 `next.config.ts` (modificar)

Verificar que tiene:

```ts
output: 'standalone',
```

Si no está, añadirlo. Es lo que permite que el Dockerfile copie solo
`/.next/standalone` y la imagen final sea ~150 MB en lugar de ~800 MB.

### 5.9 Scripts ya existentes que se reutilizan

- `scripts/sql/00-roles.sql` — crea los 4 roles Postgres
  (idempotente, ya escrito en Fase 4-5).
- `scripts/sql/01-tenant-template.sql` — provisión de schema
  `tenant_<slug>` (idempotente).
- `scripts/super-admin-create.ts` — crea super-admin (Fase 7).
- `scripts/tenants-migrate.ts` — migra schemas tenant_* (Fase 3).
- `prisma/seeds/master.ts` — seed plans + features + reserved_slugs.

---

## §6. Variables de entorno en producción

Lista exhaustiva. Todas las marcadas **secret** se almacenan en el
gestor de secrets de Dokploy (NO en el repo, NO en logs). Las
**public** pueden estar en `.env.production.example` con placeholder.

### 6.1 App (Next.js)

| Variable                 | Tipo    | Cómo obtener / valor propuesto                              |
|--------------------------|---------|--------------------------------------------------------------|
| `NODE_ENV`               | public  | `production`                                                  |
| `NEXTAUTH_URL`           | public  | `https://app.empleaia.es`                                     |
| `AUTH_SECRET`            | secret  | `openssl rand -base64 32`                                     |
| `AUTH_TRUST_HOST`        | public  | `true` (multi-host requiere esto en NextAuth v5)              |
| `ADMIN_JWT_SECRET`       | secret  | `openssl rand -base64 32` (separado de AUTH_SECRET)           |
| `TENANT_CACHE_TTL_MS`    | public  | `60000`                                                       |
| `GIT_SHA`                | build   | inyectado en build (`docker build --build-arg GIT_SHA=...`)   |

### 6.2 Database (4 roles Postgres)

| Variable                            | Tipo   | Valor propuesto                                                              |
|-------------------------------------|--------|-------------------------------------------------------------------------------|
| `MASTER_DATABASE_URL`               | secret | `postgresql://master_role:****@postgres:5432/fichaje?schema=master`           |
| `APP_DATABASE_URL`                  | secret | `postgresql://app_role:****@postgres:5432/fichaje`                            |
| `TENANT_RUNTIME_DATABASE_URL`       | secret | `postgresql://tenant_runtime_role:****@postgres:5432/fichaje?schema=master`   |
| `QUOTA_WRITER_DATABASE_URL`         | secret | `postgresql://quota_writer_role:****@postgres:5432/fichaje?schema=master`     |
| `APP_ROLE_PASSWORD`                 | secret | (random ≥32 chars, generar con `openssl rand -base64 24`)                     |
| `TENANT_RUNTIME_ROLE_PASSWORD`      | secret | (idem)                                                                         |
| `QUOTA_WRITER_ROLE_PASSWORD`        | secret | (idem)                                                                         |
| `POSTGRES_PASSWORD` (master_role)   | secret | (idem)                                                                         |

Notas:

- `entrypoint.sh` recibe los 3 passwords (`*_ROLE_PASSWORD`) como env
  y los inyecta a `00-roles.sql` con `psql -v`.
- En desarrollo local se usa un único superuser
  (`fichaje_admin`) y los 4 clientes Prisma usan la misma URL. En
  producción los 4 roles separados son obligatorios (ADR-001 §5.3).

### 6.3 Stripe

| Variable                                       | Tipo    | Valor propuesto                                                |
|------------------------------------------------|---------|----------------------------------------------------------------|
| `STRIPE_SECRET_KEY`                            | secret  | `sk_test_...` (cambiar a `sk_live_...` en migración LIVE, §11) |
| `STRIPE_PUBLISHABLE_KEY`                       | public  | `pk_test_...` (cambiar a `pk_live_...` en migración LIVE)      |
| `STRIPE_WEBHOOK_SECRET`                        | secret  | `whsec_...` del endpoint creado en §3.3 (modo TEST)            |
| `STRIPE_PRICE_STARTER_MONTHLY`                 | public  | `price_...` (del bootstrap modo TEST)                          |
| `STRIPE_PRICE_STARTER_YEARLY`                  | public  | `price_...`                                                    |
| `STRIPE_PRICE_PRO_MONTHLY`                     | public  | `price_...`                                                    |
| `STRIPE_PRICE_PRO_YEARLY`                      | public  | `price_...`                                                    |
| `STRIPE_PRICE_ENTERPRISE_MONTHLY`              | public  | `price_...`                                                    |
| `STRIPE_PRICE_ENTERPRISE_YEARLY`               | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_DOMINIO_PERSONALIZADO`     | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_API_ACCESS`                | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_INTEGRACIONES_NOMINA`      | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_FIRMA_ELECTRONICA`         | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_PEOPLE_ANALYTICS`          | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_STORAGE_EXTRA`             | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_EMAILS_EXTRA`              | public  | `price_...`                                                    |
| `STRIPE_TRIAL_DAYS`                            | public  | `14`                                                           |
| `STRIPE_TRIAL_REQUIRES_CARD`                   | public  | `true`                                                         |
| `STRIPE_PORTAL_RETURN_URL`                     | public  | `https://app.empleaia.es/cuenta/billing`                       |
| `STRIPE_CHECKOUT_SUCCESS_URL`                  | public  | `https://app.empleaia.es/registro/exito?session_id={CHECKOUT_SESSION_ID}` |
| `STRIPE_CHECKOUT_CANCEL_URL`                   | public  | `https://app.empleaia.es/registro?canceled=1`                  |

Cómo obtener los `price_*`: ejecutar `npm run stripe:bootstrap`
contra la cuenta Stripe modo TEST (Fase 4 ya lo tiene). Copiar los
IDs devueltos al gestor de secrets de Dokploy.

### 6.4 Email transaccional

| Variable                | Tipo    | Valor propuesto                                  |
|-------------------------|---------|--------------------------------------------------|
| `RESEND_API_KEY`        | secret  | (de §3.4, dashboard Resend)                       |
| `EMAIL_FROM_ADDRESS`    | public  | `noreply@empleaia.es`                             |
| `EMAIL_FROM_NAME`       | public  | `Empleaia`                                         |
| `SYSTEM_ALERT_EMAIL`    | public  | `dansanch@tecnocloud.es` (alertas internas)       |

Las claves SMTP por tenant (Fase 5) se almacenan en
`tenant_<slug>.ConfiguracionEmpresa.smtpApiKey` — esto cubre solo
los emails transaccionales del **sistema** (registro, recuperación
password, alertas a operador).

### 6.5 Cloudflare (solo Traefik)

| Variable                       | Tipo    | Valor propuesto                          |
|--------------------------------|---------|------------------------------------------|
| `CLOUDFLARE_DNS_API_TOKEN`     | secret  | (de §3.1, scope `Zone:DNS:Edit`)         |

**SOLO se inyecta a Traefik**, no a la app ni al worker.

### 6.6 Build-time

| Variable                       | Tipo        | Valor                            |
|--------------------------------|-------------|----------------------------------|
| `NEXT_TELEMETRY_DISABLED`      | build-time  | `1`                              |
| `GIT_SHA`                      | build-time  | (inyectado en `docker build`)    |

### 6.7 Política de secrets

- Toda variable marcada `secret` se carga desde el gestor de secrets
  de Dokploy. Nunca aparecen en `docker-compose.production.yml`,
  nunca se commitean.
- `.env.production.example` lista TODAS las variables sin valores
  reales (placeholders tipo `<paste from dokploy secrets>`).
- En logs nunca aparecen secrets. La app usa `process.env.X` y NO
  imprime el valor — la única excepción es el `GIT_SHA` que sí va
  a logs y healthcheck.
- Rotación: la rotación de Postgres role passwords sigue el runbook
  de ADR-005 §5.2.a (rolling sin downtime). Stripe key rotation se
  hace cuando Stripe lo requiera (rara).

---

## §7. Migraciones BD en despliegue

### 7.1 Estrategia

`entrypoint.sh` (§5.3) ejecuta TODAS las migraciones **antes** de
arrancar Next.js, en este orden:

1. `psql -f scripts/sql/00-roles.sql` — crea roles si no existen.
2. `prisma migrate deploy --schema=prisma/schema.prisma` — master.
3. `npx tsx scripts/tenants-migrate.ts -- --all` — itera todos los
   tenants en `master.tenants` (status `active`/`suspended`) y
   aplica migraciones a cada `tenant_<slug>`.
4. `npx tsx prisma/seeds/master.ts` — seed idempotente de plans /
   features / reserved_slugs.

Si CUALQUIERA falla, exit code ≠ 0 → Dokploy mantiene el container
anterior corriendo → rollback automático.

### 7.2 Primer arranque (BD virgen)

Ningún tenant existe — el paso 3 hace iteración sobre lista vacía.
El paso 1 crea los 3 roles desde cero (master_role ya existe del
setup Postgres). Pasos 2 y 4 crean el schema master con todas sus
tablas + seed de 3 planes + 32 features + 45 reserved_slugs.

Tras el primer arranque exitoso:

```sql
-- Verificación manual:
\dt master.*
SELECT count(*) FROM master.plans;          -- 3
SELECT count(*) FROM master.features;       -- 32
SELECT count(*) FROM master.reserved_slugs; -- 45
SELECT count(*) FROM master.tenants;        -- 0 (todavía sin clientes)
```

### 7.3 Deploys subsiguientes (con tenants existentes)

Cada deploy aplica migraciones a master + a cada tenant. Si una
migración tenant falla:

- El script aborta al primer fallo (ADR-005 §3.3).
- Dokploy mantiene el container anterior.
- El tenant problemático se investiga manualmente.

Convención obligatoria: **migraciones backward-compatible** (ADR-005
§2.5.a). Sin esto, un deploy a mitad puede dejar tenants en estado
inconsistente.

### 7.4 Rollback de migración fallida

No es trivial — Prisma migrate deploy aplica forward, no down. Plan
de rollback:

1. Si `entrypoint.sh` falla, Dokploy auto-rollback al container
   anterior (sin tocar BD).
2. La BD queda con la migración aplicada parcialmente (solo en los
   tenants que pasaron antes del fallo). El operador investiga:
   - Si el fallo fue por datos: arregla los datos y reintenta deploy.
   - Si el fallo fue por la migración misma: revierte la migración
     manualmente con SQL ad-hoc en los tenants afectados, abre PR
     con la migración corregida.
3. En último caso: restaurar el dump de la noche anterior (§9).

Documentar el procedimiento en `docs/operacion/runbook-migracion-fallida.md`
durante la implementación.

---

## §8. Healthcheck

### 8.1 Endpoint `/api/healthz`

Implementado en §5.4. Responde:

- **200 OK**: `{ "status": "ok", "checks": { "db_master": true, "version": "<git_sha>" } }`
- **503 Service Unavailable**: cualquier check falla.

**Sin auth, sin tenant context** — accesible desde el load balancer
sin cookies ni cabeceras especiales. Excluido de `withTenant`.

### 8.2 Configuración Dokploy

```yaml
labels:
  - "traefik.http.services.empleaia.loadbalancer.healthcheck.path=/api/healthz"
  - "traefik.http.services.empleaia.loadbalancer.healthcheck.interval=30s"
  - "traefik.http.services.empleaia.loadbalancer.healthcheck.timeout=10s"
```

Dokploy también soporta healthcheck a nivel container. Configuración
recomendada:

```yaml
healthcheck:
  test: ["CMD-SHELL", "wget -q --spider http://localhost:3000/api/healthz || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s   # 60s de gracia para que entrypoint.sh termine migraciones.
```

### 8.3 Política de rollback automático

Tras un deploy:

1. Container nuevo arranca (`entrypoint.sh` migra → Next.js inicia).
2. Dokploy espera `start_period` (60s) — si en ese plazo el
   healthcheck no pasa 3 veces seguidas, considera el deploy fallido.
3. Acción: container nuevo se mata, Dokploy revierte a la imagen
   anterior, esta retoma el tráfico.
4. Notificación al operador (§10.3) — webhook al email
   `dansanch@tecnocloud.es`.

### 8.4 Healthcheck del worker

El worker no es un servicio HTTP. Healthcheck via process check:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pgrep -f 'tsx scripts/worker.ts' || exit 1"]
  interval: 30s
  timeout: 5s
  retries: 3
```

Si quieres healthcheck más fino (verificar que el cron está corriendo
sin colgarse), Fase 9 puede añadir un endpoint HTTP interno en el
worker (puerto 3001, no expuesto fuera). Día 1 con `pgrep` es
suficiente.

---

## §9. Backups

### 9.1 Estrategia

- **Backup diario completo** del Postgres a `/backups/postgres/` (en
  el servidor Dokploy), retención **30 días local**.
- **Sync semanal** a `stackscale-backup.tecnocloud.es` por rsync,
  retención **90 días remoto**.
- **Verificación mensual**: cron que restaura el último dump a una
  BD efímera y comprueba que las tablas master tienen filas
  esperadas. Si falla, alerta al operador.

### 9.2 Cron (Dokploy)

```
# Backup diario 03:00 UTC
0 3 * * *   /scripts/backup.sh >> /var/log/backup.log 2>&1

# Verificación mensual día 1, 04:00 UTC
0 4 1 * *   /scripts/backup-verify.sh >> /var/log/backup-verify.log 2>&1
```

`scripts/backup.sh` es el de §5.5. `scripts/backup-verify.sh` se
materializa en Fase 9 (no bloqueante para Fase 8 — primer mes
verificación manual con `pg_restore` a BD efímera).

### 9.3 Backups del primer cliente real

Cuando llegue el primer cliente real, además del dump global:

- `pg_dump --schema=master` (tabla maestra de tenants).
- `pg_dump --schema=tenant_<slug>` por tenant.
- Esto facilita restore granular si un cliente pierde datos sin
  afectar al resto.

Política heredada de ADR-001 §5.5 y ADR-005 §2.2.c.

### 9.4 Disaster recovery

Si el servidor Dokploy se pierde por completo:

1. Provisionar VPS nueva en el mismo rango Stackscale (misma IP si
   posible — si no, actualizar registros A en Cloudflare).
2. Instalar Dokploy + Traefik.
3. Restaurar `acme.json` desde backup (acelera certs).
4. Restaurar el último dump de `stackscale-backup`:
   ```sh
   gunzip -c /backups/empleaia-YYYY-MM-DD.sql.gz | psql -U master_role -d fichaje
   ```
5. Reconfigurar app en Dokploy con todos los secrets.
6. Push a `production` para disparar deploy.
7. Verificar `https://app.empleaia.es/api/healthz` → 200.
8. Notificar a clientes del incidente.

RTO objetivo: 4 horas. RPO: 24 horas (último dump diario).

---

## §10. Estrategia de auto-deploy

### 10.1 Modelo de ramas

```
main           ←  donde se trabaja durante Fases 8+ y siguientes.
                  Recibe merges de feature/* tras review (cuando
                  haya equipo) o auto (en solo-dev).
                  CI corre en cada PR.

production     ←  rama de despliegue. Recibe merges de main cuando
                  el operador confirma que main está estable.
                  PROTEGIDA: no push directo, no force push, requiere
                  CI verde.

feature/saas-migration  ←  rama actual donde se desarrolla la fase 8.
                            Cuando se cierre, merge a main → merge a
                            production.
```

### 10.2 Workflow concreto

1. Trabajo en `feature/<nombre>` o directamente en `main` (según
   tamaño del cambio).
2. PR a `main` (o push directo si es solo-dev autorizado). CI corre
   automáticamente. Bloquea si falla.
3. Cuando `main` está estable y el operador quiere desplegar:
   ```sh
   git checkout production
   git merge main --no-ff
   git push origin production
   ```
4. Push a `production` dispara webhook Dokploy → auto-deploy.
5. Dokploy construye imagen → arranca container nuevo →
   `entrypoint.sh` migra → Next.js arranca → healthcheck.
6. **Si healthcheck pasa en 60s**: Dokploy promueve el container
   nuevo a producción y termina el viejo.
7. **Si healthcheck falla**: Dokploy auto-rollback. Container viejo
   sigue sirviendo tráfico. Notificación al operador.

### 10.3 Notificación de fallos

Mecanismo propuesto (a confirmar §15.3): webhook Dokploy → script
que envía email a `dansanch@tecnocloud.es` con:

- Status del deploy (success/failure).
- SHA del commit.
- Logs de los últimos 100 segundos.
- Link al panel Dokploy del proyecto.

Alternativa: integrar con Slack/Telegram bot si el operador tiene
uno operativo (no asumido — TODO Fase 9 si decide usarlos).

### 10.4 Branch protection en GitHub

Configurar en `Settings → Branches → production`:

- [ ] Require pull request before merging (al menos 1 review cuando
      haya equipo; opt-in en solo-dev).
- [ ] Require status checks to pass before merging:
      - `build-and-test` (CI de §5.7).
- [ ] Require branches to be up to date before merging.
- [ ] Restrict who can push to matching branches: solo el operador
      durante Fase 8.
- [ ] Do not allow bypassing the above settings.
- [ ] No force push.
- [ ] No delete.

Branch `main` también con protection mínima:

- [ ] Require status checks (`build-and-test`).
- [ ] No force push.

### 10.5 Pre-checks de seguridad antes del primer push a production

El primer merge `main → production` activa el primer deploy real.
Antes de ese push, el operador verifica:

- [ ] Todas las variables de §6 cargadas en Dokploy secrets.
- [ ] DNS (§4) propagado (`dig +short app.empleaia.es @8.8.8.8`).
- [ ] `acme.json` montado como volumen persistente en Traefik.
- [ ] `postgres_fichaje_data` volumen creado (`docker volume ls`).
- [ ] Cron de backup configurado.
- [ ] Webhook Stripe TEST creado (§3.3).
- [ ] Resend dominio verificado (§3.4).
- [ ] Email de alertas configurado (§10.3).

Sin el checklist completo, NO se hace el primer push a production.

---

## §11. Migración Stripe TEST → LIVE

Procedimiento para activar pagos reales cuando llegue el primer
cliente real con tarjeta.

### 11.1 Prerequisitos

- [ ] Cuenta Stripe **verified** (Stripe pide datos fiscales,
      cuenta bancaria, etc. — proceso de Stripe que tarda 1–3 días).
- [ ] Productos y precios creados en modo LIVE (re-ejecutar
      `npm run stripe:bootstrap` apuntando a la API key live).
- [ ] **Webhook endpoint NUEVO** en dashboard Stripe modo LIVE
      (NO reutilizar el de TEST). Misma URL
      (`https://app.empleaia.es/api/webhooks/stripe`), distinto
      `whsec_*`.

### 11.2 Cambios en Dokploy secrets

Cambiar **exactamente 4 variables** en Dokploy (no más):

| Variable                 | Antes                | Después             |
|--------------------------|----------------------|---------------------|
| `STRIPE_SECRET_KEY`      | `sk_test_...`        | `sk_live_...`       |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...`        | `pk_live_...`       |
| `STRIPE_WEBHOOK_SECRET`  | `whsec_*` (test)     | `whsec_*` (live)    |
| `STRIPE_PRICE_*` (×16)   | precios test         | precios live        |

Total: 4 variables principales + 16 price IDs = 20 variables a
actualizar. **Hacerlas todas en una operación** y pulsar "Redeploy"
una sola vez.

### 11.3 Ventana operativa

- Ventana estimada: 10–15 minutos.
- Fuera de horario laboral del primer cliente.
- Maintenance mode opcional (probablemente innecesario — solo el
  flow de checkout y webhook se ven afectados).

### 11.4 Verificación post-migración

1. `https://app.empleaia.es/registro` → completar registro con
   email del operador.
2. Checkout con tarjeta REAL del operador (1€ test simbólico, plan
   Starter mensual).
3. Verificar en dashboard Stripe modo LIVE que aparece el customer
   + subscription.
4. Verificar que el webhook llegó (logs del container app:
   `[stripe] checkout.session.completed received`).
5. Verificar que el tenant se creó en `master.tenants` con status
   `active` y schema `tenant_<slug>` provisionado.
6. **Refund inmediato** del cobro de 1€ desde el dashboard Stripe.
7. Cancelar la subscription test desde el portal del cliente.

### 11.5 Rollback (si algo falla)

Cambiar las 4 variables Stripe de vuelta a `sk_test_*` y redeploy.
El customer/subscription creados en modo LIVE quedan huérfanos en
Stripe (refund + cancel manualmente).

---

## §12. Verificación E2E con tarjeta real

Tras el primer despliegue exitoso (modo TEST), antes de migrar a
LIVE:

### 12.1 Smoke test platform

1. **DNS**: `dig +short app.empleaia.es` devuelve la IP correcta.
2. **TLS**: `curl -I https://app.empleaia.es` devuelve 200 con cert
   válido (CN/SAN incluye `*.empleaia.es`).
3. **Wildcard**: `curl -I https://random123.empleaia.es` devuelve
   404 / 503 desde la app (no error de cert).
4. **Healthcheck**: `curl https://app.empleaia.es/api/healthz`
   devuelve `{ "status": "ok", "checks": { "db_master": true } }`.

### 12.2 Onboarding completo (modo TEST)

5. `https://app.empleaia.es/registro` carga la landing.
6. Completar formulario: empresa "Empleaia Test", email
   `dansanch@tecnocloud.es`, slug `test1`, plan Starter mensual.
7. Stripe Checkout TEST: tarjeta `4242 4242 4242 4242`, CVV cualquier
   3 dígitos, fecha futura.
8. Verificar redirect a `https://app.empleaia.es/registro/exito` con
   `session_id`.
9. Verificar email de bienvenida en la inbox del operador (puede ir
   a spam si Resend recién activado).
10. Verificar tenant en `master.tenants` con status `active` y schema
    `tenant_test1` provisionado:
    ```sql
    SELECT slug, status, plan_key FROM master.tenants WHERE slug = 'test1';
    \dn tenant_test1
    ```

### 12.3 Producto del tenant

11. Acceder a `https://test1.empleaia.es/login` con las credenciales
    del email de bienvenida.
12. Crear sede + empleado.
13. Fichar entrada (botón "Iniciar jornada").
14. Esperar 1 minuto, fichar salida.
15. Tab "Informes" → exportar PDF y Excel — descarga real.
16. Tab "Configuración" → 6 sub-tabs visibles (General, Tipos
    ausencia, Notificaciones, Branding, Calendario, Dominio).

### 12.4 Panel super-admin

17. Crear super-admin via SSH al container (primera vez):
    ```sh
    docker exec -it fichaje_app \
      npm run super-admin:create -- admin@empleaia.es "Operador" "<password>"
    ```
18. Login en `https://admin.empleaia.es/admin/login`.
19. Verificar `/admin/dashboard` carga métricas globales (1 tenant
    activo, 1 subscription).
20. `curl -X GET https://admin.empleaia.es/api/admin/tenants -H "Cookie: <admin-session>"` devuelve list con `test1`.

### 12.5 API pública v1

21. Desde el tenant `test1`, crear API token:
    ```sh
    curl -X POST -H "Cookie: <session>" \
      -H "content-type: application/json" \
      -d '{"name":"e2e-test"}' \
      https://test1.empleaia.es/api/me/api-tokens
    ```
22. Usar el `plainToken` devuelto:
    ```sh
    curl -H "Authorization: Bearer <plainToken>" \
      https://test1.empleaia.es/api/v1/empleados
    ```
    Devuelve JSON con el empleado creado en paso 12.

### 12.6 Cleanup post-test

23. Refund cobro 1€ en dashboard Stripe.
24. Cancel subscription en portal cliente.
25. Eliminar tenant `test1` con CLI (Fase 9 implementa el comando real
    — Fase 8 día 1 lo hace manualmente):
    ```sql
    DROP SCHEMA tenant_test1 CASCADE;
    DELETE FROM master.subscriptions WHERE tenant_id = '<id>';
    DELETE FROM master.tenants WHERE slug = 'test1';
    ```

### 12.7 Tarjeta REAL (post-migración LIVE)

Repetir pasos 5–10 con tarjeta real del operador y plan Starter
mensual (precio mínimo, ej. 9€/mes). Refund + cancel inmediatamente.
Esto valida la cadena LIVE completa antes de abrir a clientes
reales.

---

## §13. Riesgos identificados

### 13.1 DNS

- **Propagación inicial**: hasta 24h en algunos resolvers (raro;
  típico 1–2h con Cloudflare). Mitigación: TTL 60s durante setup,
  subir a 300s tras estabilización.
- **NS apuntan a Cloudflare**: si el operador no actualiza los NS
  en el registrar, Cloudflare nunca recibirá las queries y los
  records no se aplican.
- **API Token Cloudflare revocado**: si se revoca por error, Traefik
  no puede renovar wildcard SSL → certs expiran a 90 días → app cae
  con TLS error en todos los subdominios. Mitigación: monitorear
  cada renovación (logs Traefik), notificar si falla.

### 13.2 SSL

- **Wildcard cert solo cubre 1 nivel** (`*.empleaia.es` cubre
  `app.empleaia.es` pero NO `foo.bar.empleaia.es`). Decisión: la
  app no soporta sub-sub-dominios → no es problema.
- **acme.json corrupto**: punto único de fallo. Mitigación: backup
  diario en `/backups/dokploy/acme.json` (rotación 30 días).

### 13.3 Postgres en Docker

- **Volumen no NAMED**: si por error se monta como bind o anonymous,
  un `docker-compose down -v` borra los datos. Mitigación: usar
  exclusivamente volumen NAMED `postgres_fichaje_data` con
  `external: true` o declaración explícita.
- **Postgres muere y no reinicia**: `restart: unless-stopped` lo
  cubre. Si está corrupto a nivel de volumen, restore desde backup.
- **Performance bajo carga**: Postgres en Docker en el mismo host
  comparte CPU/RAM con la app. Aceptable a 10–100 tenants. Migrar
  a Postgres dedicado (TODO Fase 9) cuando la latencia degrade.

### 13.4 Migraciones

- **Migración no backward-compatible**: si una PR introduce
  `DROP COLUMN` o `ALTER COLUMN ... NOT NULL` en un solo paso, y
  el deploy falla a mitad, los tenants ya migrados rompen con la
  app vieja. Mitigación: revisión humana + regla ESLint
  `migrations-must-be-additive` (TODO Fase 9).
- **Migración tarda mucho**: con N tenants × N tablas, el
  `entrypoint.sh` puede tardar minutos. `start_period: 60s` puede
  ser insuficiente. Mitigación: monitorear duración y subir
  `start_period` cuando crucemos N=20 tenants.

### 13.5 Auto-deploy

- **Bug runtime no detectado por tsc/build/tests**: pasa el CI,
  rompe en producción. Healthcheck post-deploy lo detecta y hace
  rollback. Mitigación adicional: E2E nightly (TODO Fase 9).
- **Deploy en hora punta**: aunque haya rollback automático, el
  servicio puede tener degradación 30s. Mitigación: política
  operativa (no merge a `production` en horario laboral del
  cliente principal).

### 13.6 Stripe

- **Webhook con secret incorrecto**: el handler rechaza por firma
  inválida → checkout completed pero tenant nunca se crea. Cliente
  cobrado sin servicio. Mitigación: verificar `whsec_*` antes del
  primer cliente real (paso §12.2 con cuenta de test del operador).
- **Stripe modo TEST → LIVE olvidando alguna variable**: webhook
  apunta a TEST mientras la app cobra en LIVE → drift. Mitigación:
  cambiar las 4 variables en una operación (§11.2).

### 13.7 Email

- **Resend dominio no verificado**: emails van a spam o son
  rechazados. Mitigación: verificación previa en §3.4 antes de
  primer cliente.
- **Quota Resend agotada**: el plan free de Resend tiene límite. Con
  1–10 tenants es suficiente. Cuando crezca, upgrade a plan pago.

---

## §14. Lo que NO hace Fase 8

Excluido del alcance:

- **Migración del cliente actual** de `ficha.tecnocloud.es` (mono-tenant)
  al SaaS multi-tenant en `empleaia.es/<slug>`. Este es un proyecto
  separado, posterior a Fase 8, con su propio plan y ventana
  operativa. La app antigua sigue corriendo en
  `ficha.tecnocloud.es` durante toda Fase 8.
- **MFA TOTP super-admin** (TODO N9 — Fase 9).
- **Archivado audit_log** > 7 años (TODO N10).
- **MRR real desde Stripe** (TODO N12 — métrica está en `null`).
- **Dispatch real de webhooks tenant** (TODO N15 — endpoint de
  registro existe, dispatch no).
- **Providers nómina reales** (TODO N16 — solo stubs).
- **pgbouncer**: día 1 sin pgbouncer. Postgres con `max_connections=200`
  y N clientes Prisma directos. Cuando crucemos ~30 tenants y veamos
  `connection limit exceeded`, añadir pgbouncer (TODO N23 §17).
- **Postgres dedicado fuera del stack Dokploy** (TODO N24 — Fase 9
  cuando primer cliente real lo justifique por SLA o escalado).
- **Monitoreo / alertas avanzado**: Sentry, Better Stack, Grafana
  Cloud. Día 1 solo logs en Dokploy + email del operador (TODO N25
  Fase 9).
- **CI/CD avanzado**: E2E en cada PR, deploy preview por branch,
  staging environment. Día 1 solo CI básico + auto-deploy a
  production (TODO N26 — Fase 9).
- **CDN / cache**: Cloudflare en modo proxy naranja, cache de assets.
  Día 1 sin CDN (DNS only). Tráfico bajo no lo justifica (TODO N27
  cuando crezca).
- **Web Application Firewall (WAF)**: rate limiting global, bot
  protection. Día 1 sin WAF (TODO N28 cuando aparezcan bots).

---

## §15. Puntos a confirmar antes de implementar

Lista de preguntas concretas con valores propuestos. **El operador
debe confirmar / corregir antes** de que el bloque de implementación
arranque.

### 15.1 Email transaccional

- **Provider propuesto**: Resend (ya usado en Fase 5 para emails
  por tenant).
- **Dirección remitente**: `noreply@empleaia.es`.
- **Plan Resend**: free tier (3000 emails/mes) suficiente para
  primer mes; upgrade cuando >5 tenants.
- ¿Confirmas Resend o prefieres otro provider (SES, Postmark,
  SendGrid)?

### 15.2 Email del operador para alertas

- **Propuesto**: `dansanch@tecnocloud.es` (el del usuario).
- **Alternativa sugerida**: crear `admin@empleaia.es` o `alertas@empleaia.es`
  forwarded al operador para separar inboxes.
- ¿Cuál prefieres?

### 15.3 Mecanismo de notificación de deploy fallido

- **Propuesto**: webhook Dokploy → script en el servidor que envía
  email vía Resend al operador.
- **Alternativas**:
  - Slack webhook (si tienes workspace operativo).
  - Telegram bot (más simple si lo usas habitualmente).
  - Solo logs Dokploy (sin notificación push) — implica que el
    operador chequea el panel manualmente.
- ¿Cuál?

### 15.4 Servidor Dokploy

- **IP propuesta**: `185.99.186.x` (rango Stackscale, a confirmar
  IP exacta del operador).
- **¿Hay otro proyecto Dokploy en el mismo servidor?** Sí (la app
  Ficha actual en `ficha.tecnocloud.es`). Confirmar que no compite
  por puertos 80/443 (Traefik los multiplexa).
- **Disco /backups**: confirmar que tiene >50 GB libres
  (`df -h /backups`).
- **Confirmas IP exacta del servidor para los registros DNS?**

### 15.5 Slugs de tenant

- **Propuestos**: 45 reservados ya en `prisma/seeds/master.ts`
  incluyendo `app, admin, www, api, mail, ftp, blog, status,
  billing, help, docs, support, login, dashboard` y 31 más.
- **Confirmas que la lista actual cubre todos los subdominios que
  quieres reservados** o quieres añadir alguno más antes del
  primer deploy?

### 15.6 IP filtering del API Token Cloudflare

- Restringir el token a la IP del servidor Dokploy reduce el blast
  radius si el token se filtra. Pero si la IP del servidor cambia
  (migración VPS), el token deja de funcionar y los certs no
  renuevan.
- **Propuesto**: con IP filtering activo. Documentar en runbook que
  ante migración de VPS hay que actualizar el token.
- ¿De acuerdo o prefieres token sin IP filtering por simplicidad?

### 15.7 Auto-deploy: rama `production`

- **Propuesto**: rama `production` con branch protection
  (no force push, no push directo, requiere CI verde).
- ¿Confirmas el nombre `production` o prefieres otro
  (ej. `release`, `live`, `prod`)?

### 15.8 Vencimiento del plan

Una vez confirmados §15.1–§15.7, el operador da OK y arranca el
bloque de implementación. El plan estima **8–12 commits** para
cubrir todo lo de §16.

---

## §16. Estructura de commits estimada

Lista ordenada de los commits que hará el bloque de implementación
(orden propuesto; ajustable según necesidades emergentes):

1. **`feat(deploy): Dockerfile multi-stage con entrypoint`** — añadir
   `entrypoint.sh`, ajustar `CMD`, build args para `GIT_SHA`.
2. **`feat(deploy): docker-compose.production.yml con app + worker + postgres`** —
   3 servicios, volumen NAMED, secrets desde env, healthchecks.
3. **`feat(deploy): scripts/entrypoint.sh con migraciones idempotentes`** —
   00-roles + prisma migrate deploy + tenants:migrate:all + seed.
4. **`feat(api/healthz): endpoint /api/healthz para Dokploy`** — verifica
   db_master + version + cache stripe boot.
5. **`feat(deploy): scripts/backup.sh con pg_dump + rotación + rsync`** —
   cron diario, retención 30d local, sync semanal.
6. **`feat(deploy): .env.production.example documentado`** — todas las
   variables de §6 sin valores reales.
7. **`ci(github): workflow lint+test+build pre-deploy`** —
   `.github/workflows/ci.yml`, branch protection en `production`.
8. **`docs(deploy): runbook empleaia.es completo`** —
   `docs/deploy/dokploy.md`, `docs/deploy/cloudflare.md`,
   `docs/deploy/stripe-test-to-live.md`.
9. **`docs(arch): ADR-005 enmienda dominio empleaia.es`** —
   actualizar ADR-005 con la decisión de cambio de dominio.
10. **`feat(deploy): scripts/migrate-tenants.ts con --all`** — wrapper
    sobre `tenants-migrate.ts` para entrypoint (verificar que ya
    funciona vía `npm run tenants:migrate:all`).
11. **`docs(arch): cierre Fase 8 tras verificación E2E`** — runbook
    real con resultados, lista de TODOs derivados.
12. (Opcional) **`feat(deploy): pgbouncer service con session pooling`** —
    si en §15 el operador decide incluirlo desde día 1.

Cada commit con mensaje en castellano, formato convencional, sin
emojis en el texto del commit.

---

## §17. Diferencias con ADR-005

ADR-005 ("Deployment y TLS") fue escrito asumiendo dominio
`ficha.tecnocloud.es` y un cutover de la app mono-tenant existente
al SaaS. Esta Fase 8 introduce **enmiendas** que se documentan
explícitamente para no contradecir el ADR sin trazabilidad:

### 17.1 Cambio de dominio

- **ADR-005 §2.1**: dominio `ficha.tecnocloud.es` con subzona
  delegada a Cloudflare.
- **Fase 8 (decisión operador 2026-05-02)**: dominio
  `empleaia.es` con la zona completa en Cloudflare (NO subzona
  delegada — el dominio es nuevo, no delegado de paginalia).
- **Acción**: emitir **enmienda a ADR-005** en el commit
  `docs(arch): ADR-005 enmienda dominio empleaia.es` (commit 9 de
  §16) que documente: nuevo dominio principal, app antigua
  sigue en `ficha.tecnocloud.es` como deploy paralelo
  (independiente, fuera de Fase 8), migración del cliente antiguo
  programada como proyecto separado posterior.

### 17.2 Cutover

- **ADR-005 §5.4**: cutover paso a paso del cliente actual
  mono-tenant a multi-tenant, en el mismo dominio.
- **Fase 8**: SIN cutover. Dominio nuevo, deploy nuevo. Cliente
  actual queda intacto en `ficha.tecnocloud.es`. La migración del
  cliente antiguo a `empleaia.es/<slug>` es un proyecto separado
  posterior (TODO N29 — Fase 8.5 o Fase 9), con su propio plan,
  ventana operativa y comunicación al cliente.

### 17.3 pgbouncer

- **ADR-005 §2.2.d**: pgbouncer obligatorio en session pooling.
- **Fase 8 día 1**: SIN pgbouncer. Justificación: con N=1–5 tenants
  iniciales y `max_connections=200` en Postgres, las conexiones
  directas de los Prisma clients caben sobradamente. pgbouncer
  añade complejidad operativa (`userlist.txt` con SCRAM hashes,
  reload tras rotación, monitoreo separado) que no aporta valor
  hasta crecer.
- **Trigger para añadir pgbouncer**: cuando `SELECT count(*) FROM
  pg_stat_activity` regularmente cruce 150 conexiones, o cuando
  añadamos el ~20º tenant. Hasta entonces: TODO N23.
- **Coste de añadirlo después**: bajo. Solo cambia la URL de los 4
  clientes Prisma (de `postgres:5432` a `pgbouncer:6432`) y se añade
  el servicio pgbouncer al compose. Sin downtime si se hace en
  ventana de mantenimiento.

### 17.4 CI/CD

- **ADR-005 §2.7**: CI completo + E2E nightly + branch protection.
- **Fase 8**: CI básico (lint + typecheck + tests + feature
  coverage). E2E nightly y reglas custom adicionales quedan como
  TODO N26.

### 17.5 Observabilidad

- **ADR-005 §2.8**: logs estructurados JSON con `pino` + alertas
  email mínimas.
- **Fase 8**: logs Dokploy stdout (no estructurados con `pino`
  todavía), alertas email por deploy fallido. JSON estructurado
  con `pino` + alertas avanzadas quedan como TODO N25.

### 17.6 Cuatro roles Postgres

- **ADR-005 §2.2**: 4 roles obligatorios (`master_role`, `app_role`,
  `tenant_runtime_role`, `quota_writer_role`).
- **Fase 8**: respeta los 4 roles. `entrypoint.sh` los crea via
  `00-roles.sql`. **Sin pgbouncer**, los 4 clientes Prisma se
  conectan directamente a Postgres con sus credenciales
  respectivas — el aislamiento de privilegios sigue intacto.

---

## §18. Cómo verificar el plan tras el commit

```sh
git checkout feature/saas-migration
git log --oneline -3
# Esperado: HEAD = "docs(arch): plan de Fase 8 — despliegue Dokploy ..."

# El plan está en:
ls -la docs/arch/00-fase-8-plan.md

# Conteo aproximado:
wc -l docs/arch/00-fase-8-plan.md
```

---

## §19. Referencias

- [ADR-005 — Deployment y TLS](./adr-005-deployment-y-tls.md)
- [ADR-002 — Resolución de tenant](./adr-002-resolucion-tenant.md)
- [ADR-003 — Billing y suscripciones](./adr-003-billing-y-suscripciones.md)
- [ADR-007 — Panel super-admin](./adr-007-panel-super-admin.md)
- [Estado del proyecto 2026-05-02](./00-estado-proyecto-2026-05-02.md)
- [TODOs consolidados](./00-todos-consolidados.md)
- [Plan maestro SaaS migration](../specs/00-saas-migration-master-plan.md), §Fase 8
- Cloudflare DNS-01 con Traefik:
  https://doc.traefik.io/traefik/https/acme/#dnschallenge
- Dokploy Healthchecks: https://dokploy.com/docs/healthchecks
- Dokploy Webhooks: https://dokploy.com/docs/webhooks
- Resend Domains: https://resend.com/docs/dashboard/domains/introduction
- Stripe Test → Live: https://stripe.com/docs/keys#test-live-modes

---

**Estado**: PLAN ESCRITO. Esperando OK del operador con respuestas a
§15.1–§15.7 antes de arrancar el bloque de implementación.
