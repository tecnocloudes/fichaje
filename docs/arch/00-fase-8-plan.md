# Plan de Fase 8 — Despliegue producción Dokploy con IONOS DNS + acme.sh

- **Estado**: PLANIFICADA — pendiente OK del operador en §15.
- **Fecha**: 2026-05-02
- **Sustituye**: plan previo del commit `7447dc4` (versión Cloudflare),
  descartado tras decisión del operador de mantener el DNS en IONOS.
- **Rama de trabajo**: `feature/saas-migration` (escritura del plan).
- **Rama de despliegue**: `production` (a crear desde `main` cuando se
  inicie la implementación).
- **ADR base**: ADR-005 — con **enmienda de dominio + DNS provider**
  (`ficha.tecnocloud.es` + Cloudflare → `empleaia.es` + IONOS). Ver
  §17 "Diferencias con ADR-005".

---

## §1. Resumen ejecutivo

Fase 8 despliega la app SaaS multi-tenant (cerrada en Fases 0–7) en
producción **bajo el dominio nuevo `empleaia.es`**, registrado y con
DNS gestionado en **IONOS**. Hospedaje: servidor Dokploy
`dockploy.tecnocloud.es` (rango `185.99.186.64/28`, IP `185.99.186.69`).

La emisión y renovación del **wildcard SSL `*.empleaia.es`** se hace
con `acme.sh` + plugin `dns_ionos` instalado **en el host del
servidor** (fuera del stack Dokploy), via DNS-01 challenge contra la
API de IONOS. Renovación cada 60 días automática. Hook post-renew
copia el cert al directorio Traefik dynamic de Dokploy y fuerza
recarga sin restart. Plan B (cert manual cada 60 días con cron + script
reload) y Plan C (migrar DNS a Cloudflare) documentados como fallback.

Stripe arranca en **modo TEST**. La transición a LIVE cuando llegue
el primer cliente real es un cambio puntual de 4 variables en Dokploy
+ webhook endpoint nuevo en dashboard Stripe modo LIVE (procedimiento
en §11).

Auto-deploy desde rama `production` con healthcheck obligatorio
(`GET /api/healthz` → 200 en ≤30s o Dokploy hace rollback automático
al container anterior).

**Cobertura**: deploy nuevo, NO migración. La app mono-tenant antigua
sigue en `ficha.tecnocloud.es` para sus clientes actuales (proyecto
separado, fuera de Fase 8). El primer cliente que se onboarda en
`empleaia.es` será un tenant nuevo.

**Tiempo estimado de implementación** (no de este plan): 8–12 commits,
2–3 sesiones de trabajo, con verificación E2E tarjeta TEST + verificación
final tarjeta REAL al pasar a LIVE.

---

## §2. Arquitectura del despliegue

```
                          INTERNET
                             │
                             ▼
                  ┌──────────────────────┐
                  │     IONOS DNS         │  zone authoritative: empleaia.es
                  │  (panel IONOS,        │  records:
                  │   gestión web)        │    A      empleaia.es              → 185.99.186.69
                  │                       │    A      app.empleaia.es          → 185.99.186.69
                  │                       │    A      admin.empleaia.es        → 185.99.186.69
                  │                       │    A      www.empleaia.es          → 185.99.186.69
                  │                       │    A      *.empleaia.es            → 185.99.186.69
                  │                       │    TXT    _acme-challenge.*        ← acme.sh API
                  └─────────┬─────────────┘
                            │
                            ▼
   ┌────────────────────────────────────────────────────────────────┐
   │       dockploy.tecnocloud.es  (185.99.186.69)  HOST            │
   │                                                                 │
   │   ┌───────────────────────────────────────────────────────────┐ │
   │   │  acme.sh  (cron diario, fuera de Dokploy)                 │ │
   │   │  ~/.acme.sh/empleaia.es/                                  │ │
   │   │   ├── empleaia.es.cer                                      │ │
   │   │   ├── empleaia.es.key                                      │ │
   │   │   ├── fullchain.cer                                         │ │
   │   │   └── ca.cer                                                │ │
   │   │  IONOS_PREFIX=*** / IONOS_SECRET=*** (env)                  │ │
   │   │  --reloadcmd ejecuta /opt/empleaia/acme-renew-hook.sh       │ │
   │   └────────────────────────┬──────────────────────────────────┘ │
   │                            │ post-renew (cada 60 días):         │
   │                            │  cp fullchain → /etc/dokploy/...   │
   │                            │  cp key       → /etc/dokploy/...   │
   │                            │  touch wildcard.yml (reload trigger)│
   │                            ▼                                     │
   │   ┌───────────────────────────────────────────────────────────┐ │
   │   │  Dokploy stack (Traefik + apps)                           │ │
   │   │                                                            │ │
   │   │  /etc/dokploy/traefik/dynamic/                             │ │
   │   │   ├── wildcard-empleaia.yml  ← apunta a los certs          │ │
   │   │   └── certs/empleaia.es/                                   │ │
   │   │       ├── fullchain.cer                                    │ │
   │   │       └── empleaia.es.key                                  │ │
   │   │                                                            │ │
   │   │  Traefik (ingress)                                         │ │
   │   │   - watcha el dir dynamic, recarga sin restart             │ │
   │   │   - cert wildcard *.empleaia.es servido para todos los     │ │
   │   │     subdominios                                             │ │
   │   │                                                            │ │
   │   │  Network: dokploy_default                                  │ │
   │   │                                                            │ │
   │   │   ┌─────────┐ ┌──────────┐ ┌───────────┐                   │ │
   │   │   │   app   │ │  worker  │ │  postgres │                   │ │
   │   │   │ next.js │ │ tsx      │ │ 16-alpine │                   │ │
   │   │   │ 16.2.3  │ │ worker.ts│ │ vol NAMED │                   │ │
   │   │   │ port    │ │ cron jobs│ │ 5432      │                   │ │
   │   │   │ 3000    │ │          │ │           │                   │ │
   │   │   └─────────┘ └──────────┘ └─────┬─────┘                   │ │
   │   └─────────────────────────────────┼────────────────────────┘ │
   │                                      │                          │
   │                                      ▼                          │
   │              ┌─────────────────────────────────┐                │
   │              │  postgres_fichaje_data (volume) │                │
   │              │  /var/lib/postgresql/data       │                │
   │              │  Sobrevive a recreaciones del   │                │
   │              │  container postgres.            │                │
   │              └─────────────────────────────────┘                │
   │                                                                 │
   │   /backups/postgres/empleaia-YYYY-MM-DD.sql.gz   ← cron diario  │
   │   rsync semanal → backup@stackscale-backup.tecnocloud.es        │
   └─────────────────────────────────────────────────────────────────┘
```

**Subdominios canónicos** (todos con cert wildcard único):

| Host                      | Función                                        | `kind` (proxy.ts) |
|---------------------------|------------------------------------------------|--------------------|
| `empleaia.es`             | Apex → 301 redirect a `app.empleaia.es`        | `apex`             |
| `www.empleaia.es`         | Alias futuro de la landing → 301 a `app.*`     | `apex` (alias)     |
| `app.empleaia.es`         | Landing, `/registro`, webhook Stripe           | `app`              |
| `admin.empleaia.es`       | Panel super-admin                              | `admin`            |
| `<slug>.empleaia.es`      | Subdominio del tenant (login + producto)       | `tenant`           |
| Custom domain del tenant  | Verificado por TXT, opcional, addon Enterprise | `custom_domain_candidate` |

---

## §3. Prerequisitos del operador

Lo que tiene que estar listo **antes** de que arranque el bloque de
implementación. Bloqueantes — sin esto no se empieza.

### 3.1 Dominio + DNS IONOS

- [ ] Dominio `empleaia.es` registrado en IONOS, panel de gestión
      DNS accesible.
- [ ] **API key IONOS DNS generada** en
      `https://developer.hosting.ionos.es/keys` (o `.de` — mismo
      panel "Developer Hosting"). La API key tiene **dos componentes**:
        - `IONOS_PREFIX` (parte pública, ~7 chars).
        - `IONOS_SECRET` (parte secreta, ~30 chars).
      La auth API se construye como `X-API-Key: $PREFIX.$SECRET`.
- [ ] Credenciales guardadas en password manager + listas para inyectar
      como env del usuario `root` (o el que ejecute acme.sh) en
      `dockploy.tecnocloud.es`.

### 3.2 Servidor Dokploy

- [ ] Acceso SSH como `root` (o usuario con sudo) a
      `dockploy.tecnocloud.es` (`185.99.186.69`).
- [ ] Acceso al panel web de Dokploy.
- [ ] **Disco con ≥50 GB libres** para `/backups/postgres` + volumen
      Postgres + imágenes Docker. Verificar con `df -h`.
- [ ] **Puerto 443 disponible**: confirmar que ningún otro proyecto
      Dokploy expone tráfico TLS en `*.empleaia.es`. La app Ficha
      antigua escucha en `ficha.tecnocloud.es`, distinto SNI — no
      debería conflictuar (Traefik multiplexa por host).
- [ ] **Containers preexistentes en el host**: listarlos
      (`docker ps --format '{{.Names}}'`) y confirmar que ninguno
      tiene un volumen llamado `postgres_fichaje_data` (colisionaría).

### 3.3 GitHub deploy keys

- [ ] Repo `tecnocloudes/fichaje` configurado con **deploy key
      read-only** específica para Dokploy (generada con
      `ssh-keygen -t ed25519 -f ~/.ssh/dokploy_empleaia`).
- [ ] La parte pública añadida a `GitHub → Settings → Deploy keys`
      (NO write access).
- [ ] La parte privada añadida a Dokploy (`Settings → Git provider`).

### 3.4 Stripe

- [ ] Cuenta Stripe del operador, ya con productos/precios creados
      en modo TEST por `npm run stripe:bootstrap` (Fase 4).
- [ ] **Endpoint de webhook NUEVO** creado en dashboard Stripe modo
      TEST apuntando a `https://app.empleaia.es/api/webhooks/stripe`
      con eventos: `checkout.session.completed`,
      `customer.subscription.updated`,
      `customer.subscription.deleted`,
      `invoice.payment_succeeded`,
      `invoice.payment_failed`. Copiar el `whsec_*` que devuelve.

### 3.5 Email transaccional

- [ ] Cuenta **Resend** (o equivalente — ver §15.1 para confirmar).
- [ ] Dominio `empleaia.es` añadido a Resend, registros DKIM/SPF/DMARC
      configurados en panel DNS IONOS, dominio **verified** en Resend.
- [ ] API Key de Resend con permisos de envío.
- [ ] Dirección remitente confirmada: `noreply@empleaia.es`.

### 3.6 Operador

- [ ] Cuenta de email del operador para alertas de deploy
      (propuesta: `admin@empleaia.es` — confirmar §15.3).
- [ ] Contraseña fuerte para el primer super-admin de la plataforma
      en `admin.empleaia.es` (se crea con `npm run super-admin:create`
      tras el primer arranque).

---

## §4. DNS y SSL

### §4.1 Configuración DNS en IONOS

Los registros se crean **manualmente en el panel IONOS** (no via API
— la API se reserva para acme.sh y `_acme-challenge`). El panel IONOS
es Web UI, no terraform-friendly; asumimos cambios manuales.

| Tipo  | Nombre              | Destino             | TTL    | Notas                                       |
|-------|---------------------|---------------------|--------|---------------------------------------------|
| A     | `empleaia.es` (raíz)| `185.99.186.69`     | 300s   | Apex; redirect 301 → `app.*` desde la app   |
| A     | `app.empleaia.es`   | `185.99.186.69`     | 300s   | Landing + Stripe webhook                    |
| A     | `admin.empleaia.es` | `185.99.186.69`     | 300s   | Panel super-admin                           |
| A     | `www.empleaia.es`   | `185.99.186.69`     | 300s   | Alias landing → 301 `app.*`                 |
| A     | `*.empleaia.es`     | `185.99.186.69`     | 300s   | Wildcard tenants                            |
| TXT   | `empleaia.es`       | `v=spf1 include:_spf.resend.com ~all` | 3600s | SPF para Resend                |
| TXT   | `_dmarc.empleaia.es`| `v=DMARC1; p=none; rua=mailto:admin@empleaia.es` | 3600s | DMARC inicial p=none |
| MX    | `empleaia.es`       | (vacío o el del operador) | 3600s | Si quiere recibir email en empleaia.es      |
| TXT   | `_acme-challenge.*` | (vacío)             | 60s    | acme.sh los crea/borra automáticamente      |

Records DKIM (`resend._domainkey`) los proporciona Resend al añadir
el dominio (paso §3.5). Copiar y pegar en panel IONOS.

**TTL inicial bajo (300s)** durante setup para iterar rápido. Subir
a `3600s` (1h) tras estabilización. Los `_acme-challenge` quedan a
60s siempre (acme.sh los crea con TTL 60s mínimo aceptado).

**Verificación post-creación**:

```sh
dig +short app.empleaia.es @1.1.1.1        # → 185.99.186.69
dig +short *.empleaia.es @1.1.1.1          # → 185.99.186.69
dig +short cualquier.empleaia.es @1.1.1.1  # → 185.99.186.69 (wildcard)
dig +short TXT empleaia.es @1.1.1.1        # → "v=spf1 ..."
```

Propagación típica IONOS: 5–30 minutos. En extremo, hasta 24h.

### §4.2 acme.sh — setup completo

**Decisión clave**: `acme.sh` corre en el **host servidor** (no dentro
de Dokploy), como cron del usuario `root`. La razón es que Traefik en
Dokploy tiene su propio resolver ACME, pero usarlo con DNS-01 + IONOS
exige ya **plugin específico que Traefik no trae nativamente** (Traefik
soporta cloudflare, route53, gandi, etc., pero NO ionos). Alternativas
en Traefik (`exec` provider) son frágiles. Es más limpio:

1. acme.sh emite el cert (sabe IONOS API).
2. Hook copia los archivos al directorio dynamic de Traefik.
3. Traefik los sirve via dynamic config (sin ACME en Traefik).

#### §4.2.a Instalación

```sh
# Como root en dockploy.tecnocloud.es:
curl https://get.acme.sh | sh -s email=admin@empleaia.es

# Esto instala en /root/.acme.sh/, añade cron diario:
#   0 0 * * * "/root/.acme.sh"/acme.sh --cron --home "/root/.acme.sh"
# Activa autoupgrade (acme.sh se mantiene al día).
```

**Versión mínima requerida**: `>= 3.0.6` para soporte estable del
plugin `dns_ionos`. La versión que instala el script de hoy es
significativamente posterior; no debería ser un problema.

#### §4.2.b Credenciales IONOS

```sh
export IONOS_PREFIX="<prefix de §3.1>"
export IONOS_SECRET="<secret de §3.1>"
```

`acme.sh` los persiste cifrados en `/root/.acme.sh/account.conf` tras
la primera ejecución exitosa. No hay que re-exportarlos en cada cron.

**Comprobación API IONOS antes de emitir cert**:

```sh
# Test manual: lista las zonas DNS visibles para esta API key.
curl -H "X-API-Key: ${IONOS_PREFIX}.${IONOS_SECRET}" \
     "https://api.hosting.ionos.com/dns/v1/zones"
# Debe devolver JSON con la zona "empleaia.es" entre las visibles.
# Si devuelve 401: credenciales mal.
# Si devuelve 200 pero sin empleaia.es: API key sin scope sobre
# la zona. Revisar permisos en panel Developer Hosting.
```

**Rate limits IONOS**: la documentación oficial **no publica límites
explícitos** (verificado durante investigación). El plugin `dns_ionos.sh`
tampoco implementa retry/backoff. Mitigación operativa: una sola
emisión inicial + renovaciones cada 60 días. Si se abusa (debug con
muchos `--issue` consecutivos) y la API empieza a devolver 429, esperar
1h.

#### §4.2.c Emisión inicial del cert wildcard

```sh
acme.sh --set-default-ca --server letsencrypt
acme.sh --issue \
  --dns dns_ionos \
  -d empleaia.es \
  -d "*.empleaia.es" \
  --keylength ec-256
```

Resultado: `~/.acme.sh/empleaia.es_ecc/` con
`empleaia.es.cer`, `empleaia.es.key`, `fullchain.cer`, `ca.cer`.

(`--keylength ec-256` da curva ECDSA P-256, certificados pequeños y
modernos. RSA 2048 es alternativa si algún cliente legacy se queja —
no se prevé en Fase 8.)

#### §4.2.d Hook post-renew → Dokploy/Traefik

Crear `/opt/empleaia/acme-renew-hook.sh`:

```sh
#!/bin/sh
set -euo pipefail

# Source paths (acme.sh storage)
SRC=/root/.acme.sh/empleaia.es_ecc

# Destination paths (Traefik dynamic en Dokploy host)
DST=/etc/dokploy/traefik/dynamic/certs/empleaia.es
DYN_FILE=/etc/dokploy/traefik/dynamic/wildcard-empleaia.yml

mkdir -p "$DST"

# Copia atómica de los archivos de cert + key
install -m 0644 "$SRC/fullchain.cer"  "$DST/fullchain.cer.tmp"
install -m 0600 "$SRC/empleaia.es.key" "$DST/empleaia.es.key.tmp"
mv "$DST/fullchain.cer.tmp"   "$DST/fullchain.cer"
mv "$DST/empleaia.es.key.tmp" "$DST/empleaia.es.key"

# Toca el dynamic YAML para forzar a Traefik a re-leer.
# Traefik watcha el dir dynamic y recarga al detectar cambio mtime.
touch "$DYN_FILE"

logger -t acme-renew-hook "cert empleaia.es desplegado a $DST y reload disparado"
```

Permisos: `chmod 0700 /opt/empleaia/acme-renew-hook.sh`, owner `root`.

#### §4.2.e Configurar acme.sh para usar el hook

```sh
acme.sh --install-cert -d empleaia.es \
  --ecc \
  --reloadcmd "/opt/empleaia/acme-renew-hook.sh"
```

`--install-cert` registra el hook en `account.conf`. A partir de aquí,
**cada renovación automática** dispara el hook. La primera ejecución
también copia los archivos.

#### §4.2.f Cron de renovación

`acme.sh` instala su propio cron al instalarse (§4.2.a):

```
0 0 * * * "/root/.acme.sh"/acme.sh --cron --home "/root/.acme.sh"
```

A las 00:00 cada día acme.sh comprueba todos los certs gestionados.
Si alguno está a <30 días de expirar, lo renueva. Cert emitido a 90
días → renovación intentada a partir del día 60. Margen de 30 días
para reaccionar si la renovación falla.

**No hay que tocar este cron**. Si se quiere ver actividad:
`tail -f /root/.acme.sh/acme.sh.log`.

### §4.3 Integración con Dokploy/Traefik

#### §4.3.a Dynamic config: `/etc/dokploy/traefik/dynamic/wildcard-empleaia.yml`

```yaml
# Wildcard cert empleaia.es — cargado desde disco, renovado por
# acme.sh en cron. NO usar Traefik ACME para este dominio.
tls:
  certificates:
    - certFile: /etc/dokploy/traefik/dynamic/certs/empleaia.es/fullchain.cer
      keyFile:  /etc/dokploy/traefik/dynamic/certs/empleaia.es/empleaia.es.key
      stores:
        - default
```

Traefik watcha `/etc/dokploy/traefik/dynamic/`. Cualquier cambio
mtime en ese dir o en archivos referenciados por config dynamic
provoca recarga sin restart.

#### §4.3.b Etiquetas Docker en el servicio app (compose Dokploy)

```yaml
services:
  app:
    # ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.empleaia.rule=HostRegexp(`{subdomain:[a-z0-9-]+}.empleaia.es`) || Host(`empleaia.es`)"
      - "traefik.http.routers.empleaia.entrypoints=websecure"
      - "traefik.http.routers.empleaia.tls=true"
      # NO certresolver — el cert lo provee el dynamic config (§4.3.a).
      - "traefik.http.services.empleaia.loadbalancer.server.port=3000"
      - "traefik.http.services.empleaia.loadbalancer.healthcheck.path=/api/healthz"
      - "traefik.http.services.empleaia.loadbalancer.healthcheck.interval=30s"
      - "traefik.http.services.empleaia.loadbalancer.healthcheck.timeout=10s"
```

Sin `tls.certresolver`, Traefik no intenta emitir cert por sí mismo
para este router; usa el `default store` que apunta al cert wildcard
del dynamic config. Si llega un host que no matcha el regex (ej.
`foo.bar.empleaia.es` con doble subnivel), Traefik responde con cert
default → 404.

#### §4.3.c Plan B — fallback si la integración acme.sh + Dokploy falla

Si por motivos imprevistos (permisos del FS Dokploy, paths que cambien
entre versiones de Dokploy, conflicto con otra config dynamic, etc.)
la integración acme.sh + Traefik dynamic NO recarga limpiamente:

1. Renovación manual cada 55 días (margen) con script:
   ```sh
   #!/bin/sh
   acme.sh --cron --home /root/.acme.sh
   /opt/empleaia/acme-renew-hook.sh
   docker exec dokploy-traefik traefik reload   # o restart si reload no existe
   ```
2. Cron `0 3 1 */2 *` (día 1 cada 2 meses, 03:00) ejecuta este
   script.
3. Operador chequea logs de cron mensualmente.

Plan B reduce automatización pero garantiza que el cert se renueve
con intervención humana mínima. Se documenta como **opción de
contingencia**, no como objetivo.

#### §4.3.d Plan C — fallback si el plan B también falla

Si tras setup en producción se descubre que la API IONOS tiene
limitaciones que rompen acme.sh (ej. zone discovery falla, TXT records
no propagan a tiempo), o que la integración con Traefik exige cambios
mayores en Dokploy:

- Migrar la zona DNS de `empleaia.es` a Cloudflare (delegación NS desde
  el registrar IONOS). Cloudflare ofrece API DNS robusta + Traefik
  trae plugin nativo `cloudflare`.
- Coste: requiere abrir cuenta Cloudflare y delegar la zona — ~30 min
  setup, sin impacto en clientes existentes (DNS sigue resolviendo
  durante la migración).
- Beneficio: integración wildcard SSL via Traefik built-in, sin script
  externo.

Este plan C **no se pre-implementa**. Solo se ejecuta si A y B fallan.
Queda como TODO documental hasta entonces.

### §4.4 Custom domains de tenants (Fase 6, ya implementado)

Cuando un tenant Enterprise contrata el addon `dominio_personalizado`
y añade su dominio (ej. `fichaje.cliente1.com`):

1. Tenant crea record TXT `_fichaje-verify.fichaje.cliente1.com` =
   `<token>` (devuelto por `/api/configuracion/dominio`).
2. Operador (o cron Fase 9) verifica TXT y marca
   `master.tenants.customDomainVerified = true`.
3. Tenant apunta `fichaje.cliente1.com` a `185.99.186.69` (CNAME o A).
4. **Cert para custom domain**: emisión vía Dokploy (HTTP-01) o vía
   acme.sh con `dns_*` plugin del DNS del cliente. La integración
   detallada se cierra cuando aparezca el primer cliente real con
   custom domain — Fase 8 deja el código (Fase 6) listo pero el
   cert para custom domain queda como tarea operativa puntual.

---

## §5. Estructura de archivos a crear / modificar

Lista de los artefactos que el bloque de implementación tocará. NO se
tocan en este plan.

### 5.1 `Dockerfile` (modificar)

El actual (`./Dockerfile` líneas 1–48) es multi-stage con
`node:22-alpine` y `output: 'standalone'`. Cambios a aplicar:

- Añadir `entrypoint.sh` que ejecute migraciones antes de arrancar.
- Confirmar `output: 'standalone'` en `next.config.ts`.
- Añadir `ARG GIT_SHA` y `ENV GIT_SHA=$GIT_SHA` para inyectar SHA en build.
- Cambiar `CMD ["node", "server.js"]` a
  `CMD ["/app/entrypoint.sh", "node", "server.js"]`.
- Mantener usuario no-root `nextjs:1001`.
- Instalar `postgresql-client` en la imagen runner (necesario para
  que entrypoint.sh ejecute psql).

### 5.2 `docker-compose.production.yml` (NUEVO — o configurar UI Dokploy)

El compose actual (`./docker-compose.yml`) es para dev local
(postgres + app + migrate). Para producción, alternativas:

- **Opción A (preferida)**: configurar 3 servicios directamente en la
  UI Dokploy (`app`, `worker`, `postgres`) sin compose.yml. Más fácil
  de gestionar desde Dokploy.
- **Opción B**: `docker-compose.production.yml` versionado en repo,
  Dokploy lo despliega con `compose up`. Más reproducible.

Decidir en bloque de implementación. Preferimos B por reproducibilidad.

Servicios:
- `app`: build del repo, `command: ["entrypoint.sh", "node", "server.js"]`,
  port 3000, depends_on postgres healthy.
- `worker`: mismo build, `command: ["npx", "tsx", "scripts/worker.ts"]`,
  sin port expuesto, depends_on postgres healthy.
- `postgres`: `postgres:16-alpine`, volumen NAMED `postgres_fichaje_data`,
  password como secret Dokploy.

Decisiones técnicas:
- **Volumen NAMED** `postgres_fichaje_data` (no bind mount). Asegura
  que `docker-compose down` sin `-v` NO borra datos.
- **Postgres password en secret de Dokploy**, no en compose.
- `restart: unless-stopped` en los 3 servicios.
- Healthcheck en cada servicio (§8).
- Network `dokploy_default` — los containers se ven entre sí por
  nombre.

### 5.3 `scripts/entrypoint.sh` (NUEVO)

```sh
#!/bin/sh
set -euo pipefail

echo "[entrypoint] $(date -u +%Y-%m-%dT%H:%M:%SZ) Fichaje SaaS arrancando — SHA=$GIT_SHA"

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
echo "[entrypoint] Seed master..."
DATABASE_URL="$MASTER_DATABASE_URL" \
  npx tsx prisma/seeds/master.ts

echo "[entrypoint] Migraciones OK. Arrancando: $@"
exec "$@"
```

**Manejo de fallos**: `set -e` aborta el script con exit ≠ 0 si
cualquier paso falla → Dokploy mantiene el container anterior (rollback
automático). Política heredada de ADR-005 §2.5.

**Migraciones backward-compatible obligatorias** (ADR-005 §2.5.a). Sin
esto, una migración fallida a mitad deja tenants en estado
inconsistente.

### 5.4 `src/app/api/healthz/route.ts` (NUEVO)

Endpoint público (sin auth, sin tenant check) que verifica BD master.

```ts
// Pseudocódigo — el bloque de implementación lo materializa.
import { NextResponse } from "next/server";
import { prismaMaster } from "@/lib/prisma";

let stripeReadyAtBoot: boolean | null = null;
async function checkStripeAtBoot() {
  // Llamar 1 vez al arranque, cachear. NO en cada healthcheck.
}

export async function GET() {
  const checks: Record<string, unknown> = {
    version: process.env.GIT_SHA ?? "unknown",
  };

  try {
    await prismaMaster.$queryRaw`SELECT 1`;
    checks.db_master = true;
  } catch {
    checks.db_master = false;
  }

  if (stripeReadyAtBoot === null) await checkStripeAtBoot();
  checks.stripe_boot = stripeReadyAtBoot;

  const ok = checks.db_master === true;
  return NextResponse.json(
    { status: ok ? "ok" : "error", checks },
    { status: ok ? 200 : 503 }
  );
}
```

Decisiones:
- **NO chequea Stripe en cada request**: smoke test al arranque,
  cachea en variable de módulo.
- **NO chequea tenants individuales**: healthcheck del servicio app,
  no de cada tenant.
- **Excluido del proxy.ts withTenant**: añadir a la whitelist de
  endpoints exentos.

### 5.5 `scripts/backup.sh` (NUEVO)

```sh
#!/bin/sh
set -euo pipefail

BACKUP_DIR="/backups/postgres"
RETENTION_DAYS=30
TIMESTAMP=$(date -u +%Y-%m-%d-%H%M%S)
DEST="$BACKUP_DIR/empleaia-$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

docker exec fichaje_postgres \
  pg_dump -U fichaje_admin -d fichaje | gzip > "$DEST"

test -s "$DEST" || { echo "[backup] FALLO: dump vacío"; exit 1; }

# Rotación: borrar dumps > 30 días.
find "$BACKUP_DIR" -type f -name "empleaia-*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "[backup] OK — $DEST ($(du -h "$DEST" | cut -f1))"

# Sync remoto a Stackscale (semanal: domingo).
if [ "$(date -u +%w)" -eq 0 ]; then
  rsync -av --delete \
    -e "ssh -i /etc/dokploy/backup-key.id_rsa" \
    "$BACKUP_DIR/" \
    backup@stackscale-backup.tecnocloud.es:/backups/empleaia/
  echo "[backup] sync remoto OK"
fi
```

Cron en host: `0 3 * * * /opt/empleaia/backup.sh >> /var/log/empleaia-backup.log 2>&1`.

**SSH key dedicada**: `backup-key.id_rsa` (ed25519), restringida con
`command="rsync --server"` en authorized_keys de Stackscale.

### 5.6 `scripts/acme-renew-hook.sh` (NUEVO)

Ya documentado en §4.2.d. Va al host (`/opt/empleaia/`), no al repo.
**Excepción**: si queremos versionarlo en el repo, vive en
`scripts/host/acme-renew-hook.sh`. El `host/` indica que se despliega
en el host, no en el container.

### 5.7 `.env.production.example` (NUEVO)

Plantilla con todas las variables de §6 sin valores reales.

### 5.8 `.github/workflows/ci.yml` (NUEVO)

CI con lint + typecheck + tests + feature-coverage en cada PR a `main`
y a `production`. Bloquea merge si falla.

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

E2E nightly queda como TODO Fase 9 (no bloqueante para Fase 8).

### 5.9 `next.config.ts` (modificar)

Verificar `output: 'standalone'`. Si no está, añadirlo. Necesario para
que el Dockerfile copie solo `/.next/standalone`.

### 5.10 Scripts ya existentes que se reutilizan

- `scripts/sql/00-roles.sql` — crea los 4 roles Postgres (idempotente).
- `scripts/sql/01-tenant-template.sql` — provisión schema tenant_<slug>.
- `scripts/super-admin-create.ts` — crea super-admin (Fase 7).
- `scripts/tenants-migrate.ts` — migra schemas tenant_*.
- `prisma/seeds/master.ts` — seed plans/features/reserved_slugs.

---

## §6. Variables de entorno producción

Lista exhaustiva. Todas las **secret** se almacenan en gestor de
secrets de Dokploy (NO repo, NO logs). Las **public** pueden ir
con placeholder en `.env.production.example`.

### 6.1 App (Next.js)

| Variable             | Tipo    | Cómo obtener / valor propuesto                                |
|----------------------|---------|----------------------------------------------------------------|
| `NODE_ENV`           | public  | `production`                                                    |
| `NEXTAUTH_URL`       | public  | `https://app.empleaia.es`                                       |
| `AUTH_SECRET`        | secret  | `openssl rand -hex 32` (o `--base64 32`)                        |
| `NEXTAUTH_SECRET`    | secret  | Igual al `AUTH_SECRET` (compatibilidad NextAuth v5)             |
| `AUTH_TRUST_HOST`    | public  | `true` (multi-host requiere esto en NextAuth v5)                |
| `ADMIN_JWT_SECRET`   | secret  | `openssl rand -hex 32` (separado de AUTH_SECRET)                |
| `TENANT_CACHE_TTL_MS`| public  | `60000`                                                         |
| `GIT_SHA`            | build   | inyectado en build (`docker build --build-arg GIT_SHA=...`)     |

### 6.2 Database (4 roles Postgres)

| Variable                       | Tipo   | Valor propuesto                                                                |
|--------------------------------|--------|---------------------------------------------------------------------------------|
| `MASTER_DATABASE_URL`          | secret | `postgresql://master_role:****@postgres:5432/fichaje?schema=master`             |
| `APP_DATABASE_URL`             | secret | `postgresql://app_role:****@postgres:5432/fichaje`                              |
| `TENANT_RUNTIME_DATABASE_URL`  | secret | `postgresql://tenant_runtime_role:****@postgres:5432/fichaje?schema=master`     |
| `QUOTA_WRITER_DATABASE_URL`    | secret | `postgresql://quota_writer_role:****@postgres:5432/fichaje?schema=master`       |
| `APP_ROLE_PASSWORD`            | secret | (random ≥32 chars, `openssl rand -base64 24`)                                   |
| `TENANT_RUNTIME_ROLE_PASSWORD` | secret | (idem)                                                                          |
| `QUOTA_WRITER_ROLE_PASSWORD`   | secret | (idem)                                                                          |
| `POSTGRES_PASSWORD` (master)   | secret | (idem; rol master_role + superuser del container postgres)                      |

`entrypoint.sh` recibe los 3 `*_ROLE_PASSWORD` y los inyecta a
`00-roles.sql` con `psql -v`. En desarrollo local se usa un único
superuser y los 4 clientes Prisma comparten URL; en producción los 4
roles separados son obligatorios (ADR-001 §5.3).

### 6.3 Stripe

| Variable                                          | Tipo    | Valor propuesto                                                |
|---------------------------------------------------|---------|----------------------------------------------------------------|
| `STRIPE_SECRET_KEY`                               | secret  | `sk_test_...` (cambiar a `sk_live_...` en migración LIVE, §11) |
| `STRIPE_PUBLISHABLE_KEY`                          | public  | `pk_test_...`                                                  |
| `STRIPE_WEBHOOK_SECRET`                           | secret  | `whsec_...` del endpoint creado en §3.4 (modo TEST)            |
| `STRIPE_PRICE_STARTER_MONTHLY`                    | public  | `price_...` (de `npm run stripe:bootstrap` modo TEST)          |
| `STRIPE_PRICE_STARTER_YEARLY`                     | public  | `price_...`                                                    |
| `STRIPE_PRICE_PRO_MONTHLY`                        | public  | `price_...`                                                    |
| `STRIPE_PRICE_PRO_YEARLY`                         | public  | `price_...`                                                    |
| `STRIPE_PRICE_ENTERPRISE_MONTHLY`                 | public  | `price_...`                                                    |
| `STRIPE_PRICE_ENTERPRISE_YEARLY`                  | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_DOMINIO_PERSONALIZADO`        | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_API_ACCESS`                   | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_INTEGRACIONES_NOMINA`         | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_FIRMA_ELECTRONICA`            | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_PEOPLE_ANALYTICS`             | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_STORAGE_EXTRA`                | public  | `price_...`                                                    |
| `STRIPE_PRICE_ADDON_EMAILS_EXTRA`                 | public  | `price_...`                                                    |
| `STRIPE_TRIAL_DAYS`                               | public  | `14`                                                           |
| `STRIPE_TRIAL_REQUIRES_CARD`                      | public  | `true`                                                         |
| `STRIPE_PORTAL_RETURN_URL`                        | public  | `https://app.empleaia.es/cuenta/billing`                       |
| `STRIPE_CHECKOUT_SUCCESS_URL`                     | public  | `https://app.empleaia.es/registro/exito?session_id={CHECKOUT_SESSION_ID}` |
| `STRIPE_CHECKOUT_CANCEL_URL`                      | public  | `https://app.empleaia.es/registro?canceled=1`                  |

### 6.4 Email transaccional

| Variable             | Tipo    | Valor propuesto                                  |
|----------------------|---------|---------------------------------------------------|
| `RESEND_API_KEY`     | secret  | (de §3.5, dashboard Resend)                       |
| `EMAIL_FROM_ADDRESS` | public  | `noreply@empleaia.es`                             |
| `EMAIL_FROM_NAME`    | public  | `Empleaia`                                         |
| `SYSTEM_ALERT_EMAIL` | public  | `admin@empleaia.es`                               |

Las claves SMTP por tenant (Fase 5) se almacenan en
`tenant_<slug>.ConfiguracionEmpresa.smtpApiKey` — esto cubre solo
los emails transaccionales del **sistema**.

### 6.5 IONOS (NO en la app — solo en host)

| Variable        | Dónde     | Valor                            |
|-----------------|-----------|----------------------------------|
| `IONOS_PREFIX`  | host root | (de §3.1, en `~/.acme.sh/account.conf` tras primera ejecución) |
| `IONOS_SECRET`  | host root | (idem)                            |

**SOLO los conoce acme.sh en el host**. La app NO los recibe ni los
necesita. Si entran por error en `app` o `worker`, no rompe nada
(la app no llama a IONOS API), pero contradice el principio de mínimo
privilegio: no propagar.

### 6.6 Build-time

| Variable                  | Tipo        | Valor                            |
|---------------------------|-------------|----------------------------------|
| `NEXT_TELEMETRY_DISABLED` | build-time  | `1`                              |
| `GIT_SHA`                 | build-time  | (inyectado en `docker build`)    |

### 6.7 Política de secrets

- Toda variable `secret` se carga desde el gestor de secrets de Dokploy.
  Nunca aparecen en compose, nunca se commitean.
- `.env.production.example` lista todas las variables sin valores
  reales (placeholders tipo `<paste from dokploy secrets>`).
- En logs nunca aparecen secrets. La app usa `process.env.X` y NO
  imprime el valor — la única excepción es `GIT_SHA` que sí va a logs
  y healthcheck.
- Rotación de Postgres role passwords: runbook ADR-005 §5.2.a.

---

## §7. Migraciones BD en despliegue

### 7.1 Estrategia

`entrypoint.sh` (§5.3) ejecuta TODAS las migraciones **antes** de
arrancar Next.js, en este orden:

1. `psql -f scripts/sql/00-roles.sql` — crea roles si no existen.
2. `prisma migrate deploy --schema=prisma/schema.prisma` — master.
3. `npx tsx scripts/tenants-migrate.ts -- --all` — itera tenants
   `active`/`suspended` y aplica migraciones a cada `tenant_<slug>`.
4. `npx tsx prisma/seeds/master.ts` — seed idempotente.

Si CUALQUIERA falla → exit ≠ 0 → Dokploy mantiene container anterior
→ rollback automático.

### 7.2 Primer arranque (BD virgen)

Ningún tenant existe — paso 3 itera lista vacía. Paso 1 crea los 3
roles desde cero (master_role ya viene del setup Postgres). Pasos 2
y 4 crean schema master con todas sus tablas + seed (3 planes + 32
features + 45 reserved_slugs).

Verificación tras primer arranque:

```sql
\dt master.*
SELECT count(*) FROM master.plans;          -- 3
SELECT count(*) FROM master.features;       -- 32
SELECT count(*) FROM master.reserved_slugs; -- 45
SELECT count(*) FROM master.tenants;        -- 0
```

### 7.3 Deploys subsiguientes (con tenants existentes)

Cada deploy aplica migraciones a master + a cada tenant. Si una
migración tenant falla, script aborta (ADR-005 §3.3) y Dokploy
mantiene container anterior.

Convención obligatoria: **migraciones backward-compatible** (ADR-005
§2.5.a).

### 7.4 Rollback de migración fallida

1. Si `entrypoint.sh` falla → Dokploy auto-rollback al container
   anterior (sin tocar BD).
2. La BD queda con migración aplicada parcialmente. Operador investiga:
   - Si el fallo fue por datos: arregla datos y reintenta deploy.
   - Si fallo fue por la migración: revierte migración manualmente con
     SQL ad-hoc en tenants afectados, abre PR con migración corregida.
3. En último caso: restaurar dump de la noche anterior (§9).

Documentar procedimiento en `docs/operacion/runbook-migracion-fallida.md`
durante implementación.

---

## §8. Healthcheck

### 8.1 Endpoint `/api/healthz`

Implementado en §5.4. Responde:

- **200 OK**: `{ "status": "ok", "checks": { "db_master": true, "stripe_boot": true, "version": "<git_sha>" } }`
- **503 Service Unavailable**: `db_master` falla.

**Sin auth, sin tenant context** — accesible desde el load balancer
sin cookies. Excluido de `withTenant`.

### 8.2 Configuración Dokploy

```yaml
labels:
  - "traefik.http.services.empleaia.loadbalancer.healthcheck.path=/api/healthz"
  - "traefik.http.services.empleaia.loadbalancer.healthcheck.interval=30s"
  - "traefik.http.services.empleaia.loadbalancer.healthcheck.timeout=10s"

healthcheck:
  test: ["CMD-SHELL", "wget -q --spider http://localhost:3000/api/healthz || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

`start_period: 60s` da margen para que entrypoint.sh termine migraciones
antes del primer healthcheck.

### 8.3 Política de rollback automático

Tras un deploy:

1. Container nuevo arranca → entrypoint.sh migra → Next.js inicia.
2. Dokploy espera `start_period` (60s) — si tras eso el healthcheck no
   pasa **3 veces seguidas** (90s adicionales), considera deploy fallido.
3. Acción: container nuevo se mata, Dokploy revierte al container
   anterior, este retoma el tráfico.
4. Notificación al operador (§10.3) — webhook al email
   `admin@empleaia.es`.

**Total** desde push a rollback automático si todo va mal: ~3 min.

### 8.4 Healthcheck del worker

Worker no es servicio HTTP. Healthcheck via process check:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pgrep -f 'tsx scripts/worker.ts' || exit 1"]
  interval: 30s
  timeout: 5s
  retries: 3
```

Más fino (endpoint HTTP interno) → TODO Fase 9, no bloqueante.

---

## §9. Backups

### 9.1 Estrategia

- **Backup diario completo** del Postgres a `/backups/postgres/` en
  el host, retención **30 días local**.
- **Sync semanal** a `stackscale-backup.tecnocloud.es` por rsync,
  retención **90 días remoto**.
- **Verificación mensual**: cron que restaura último dump a BD efímera
  y comprueba que master tiene filas esperadas.

### 9.2 Cron (host)

```
# Backup diario 03:00 UTC
0 3 * * *   /opt/empleaia/backup.sh >> /var/log/empleaia-backup.log 2>&1

# Verificación mensual día 1, 04:00 UTC
0 4 1 * *   /opt/empleaia/backup-verify.sh >> /var/log/empleaia-backup-verify.log 2>&1
```

`scripts/backup.sh` es el de §5.5. `scripts/backup-verify.sh` se
materializa en Fase 9 — primer mes verificación manual con
`pg_restore` a BD efímera.

### 9.3 Backups del primer cliente real

Cuando llegue, además del dump global:

- `pg_dump --schema=master` (control plane).
- `pg_dump --schema=tenant_<slug>` por tenant.

Política heredada de ADR-001 §5.5 y ADR-005 §2.2.c.

### 9.4 Disaster recovery

Si servidor Dokploy se pierde:

1. Provisionar VPS nueva (Stackscale, misma IP si posible — si no,
   actualizar registros A en panel IONOS).
2. Instalar Dokploy + Traefik.
3. Re-instalar acme.sh con credenciales IONOS guardadas (§3.1).
4. Restaurar último dump desde `stackscale-backup`:
   ```sh
   gunzip -c /backups/empleaia-YYYY-MM-DD.sql.gz | psql -U master_role -d fichaje
   ```
5. Reconfigurar app en Dokploy con todos los secrets.
6. Push a `production` para disparar deploy.
7. Verificar `https://app.empleaia.es/api/healthz` → 200.
8. Notificar a clientes del incidente.

RTO objetivo: 4h. RPO: 24h (último dump diario).

---

## §10. Estrategia auto-deploy

### 10.1 Modelo de ramas

```
main           ← trabajo durante Fases 8+ y siguientes.
                 Recibe merges de feature/* tras review.
                 CI corre en cada PR.

production     ← rama de despliegue. Recibe merges de main cuando
                 el operador confirma estable.
                 PROTEGIDA: no push directo, no force push, requiere
                 CI verde.

feature/saas-migration  ← rama actual. Cuando se cierre Fase 8,
                          merge a main → merge a production.
```

### 10.2 Workflow concreto

1. Trabajo en `feature/<nombre>` o `main` (según tamaño).
2. PR a `main` (o push directo si solo-dev autorizado). CI corre
   automáticamente. Bloquea si falla.
3. Cuando `main` está estable y operador quiere desplegar:
   ```sh
   git checkout production
   git merge main --no-ff
   git push origin production
   ```
4. Push a `production` dispara webhook Dokploy → auto-deploy.
5. Dokploy build imagen → arranca container nuevo → entrypoint.sh migra
   → Next.js arranca → healthcheck.
6. **Healthcheck pasa en 60s+90s = ~150s**: Dokploy promueve container
   nuevo y termina viejo.
7. **Healthcheck falla**: auto-rollback. Container viejo sigue. Notificación.

### 10.3 Notificación de fallos

Mecanismo propuesto (a confirmar §15.3): webhook Dokploy → script en
host que envía email a `admin@empleaia.es` con:

- Status del deploy (success/failure).
- SHA del commit.
- Logs de los últimos 100s.
- Link al panel Dokploy.

Alternativa: Slack/Telegram bot — TODO Fase 9 si lo decide el operador.

### 10.4 Branch protection en GitHub

`Settings → Branches → production`:

- [ ] Require pull request before merging (1 review opt-in en solo-dev).
- [ ] Require status checks: `build-and-test`.
- [ ] Require branches up to date.
- [ ] Restrict who can push: solo el operador durante Fase 8.
- [ ] No force push.
- [ ] No delete.

`main` con protection mínima: status check + no force push.

### 10.5 Pre-checks de seguridad antes del primer push a production

- [ ] Todas las variables §6 cargadas en Dokploy secrets.
- [ ] DNS IONOS propagado (`dig +short app.empleaia.es @1.1.1.1`).
- [ ] acme.sh emisión inicial OK (cert wildcard en disco).
- [ ] Traefik dynamic config carga el cert (verificar logs Traefik).
- [ ] Volumen `postgres_fichaje_data` creado (`docker volume ls`).
- [ ] Cron de backup configurado en host.
- [ ] Webhook Stripe TEST creado (§3.4).
- [ ] Resend dominio verified (§3.5).
- [ ] Email de alertas configurado.

Sin checklist completo, NO se hace primer push a production.

### 10.6 TODO N22 — GitHub Actions pre-merge avanzado

Día 1 con CI básico. Mejoras futuras (TODO):

- Tests E2E nightly contra Postgres + Stripe TEST + Playwright.
- Validación de migraciones backward-compat (regla custom ESLint).
- Integration tests en cada PR (con Testcontainers).

Estas mejoras son TODO Fase 9, no bloquean Fase 8.

---

## §11. Migración Stripe TEST → LIVE

Procedimiento para activar pagos reales cuando llegue el primer
cliente real con tarjeta.

### 11.1 Prerequisitos

- [ ] Cuenta Stripe **verified** (Stripe pide datos fiscales, cuenta
      bancaria, etc. — proceso 1–3 días).
- [ ] Productos y precios creados en modo LIVE
      (`npm run stripe:bootstrap` apuntando a la API key live).
- [ ] **Webhook endpoint NUEVO** en dashboard Stripe modo LIVE (NO
      reutilizar el de TEST). Misma URL
      (`https://app.empleaia.es/api/webhooks/stripe`), distinto
      `whsec_*`.

### 11.2 Cambios en Dokploy secrets — exactamente 4 variables

| Variable                 | Antes                | Después             |
|--------------------------|----------------------|---------------------|
| `STRIPE_SECRET_KEY`      | `sk_test_...`        | `sk_live_...`       |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...`        | `pk_live_...`       |
| `STRIPE_WEBHOOK_SECRET`  | `whsec_*` (test)     | `whsec_*` (live)    |
| `STRIPE_PRICE_*` (×16)   | precios test         | precios live        |

Total: 4 variables principales + 16 price IDs = **20 variables a
actualizar**. Hacerlas TODAS en una operación y pulsar "Redeploy"
una sola vez.

### 11.3 Ventana operativa

- 10–15 min.
- Fuera de horario laboral del primer cliente.
- Maintenance mode opcional (probablemente innecesario — solo flow
  de checkout y webhook se ven afectados).

### 11.4 Verificación post-migración

1. `https://app.empleaia.es/registro` → completar registro con email
   del operador.
2. Checkout con **tarjeta REAL** del operador (1€ test, plan Starter
   mensual).
3. Verificar en dashboard Stripe LIVE: aparece customer + subscription.
4. Verificar webhook llegó (logs container app):
   `[stripe] checkout.session.completed received`.
5. Verificar tenant en `master.tenants` con `status = active` y
   `tenant_<slug>` provisionado.
6. **Refund inmediato** del cobro de 1€ desde dashboard Stripe.
7. Cancel subscription desde portal cliente.

### 11.5 Rollback (si algo falla)

Cambiar las 4 variables Stripe de vuelta a `sk_test_*` y redeploy.
Customer/subscription creados en LIVE quedan huérfanos en Stripe
(refund + cancel manualmente).

---

## §12. Verificación E2E con tarjeta real

Tras el primer despliegue exitoso (modo TEST), antes de migrar a LIVE:

### 12.1 Smoke test platform

1. **DNS**: `dig +short app.empleaia.es @1.1.1.1` devuelve `185.99.186.69`.
2. **TLS**: `curl -I https://app.empleaia.es` devuelve 200 con cert
   válido (CN/SAN incluye `*.empleaia.es`).
3. **Wildcard**: `curl -I https://random123.empleaia.es` devuelve
   404/503 desde la app (no error de cert).
4. **Healthcheck**: `curl https://app.empleaia.es/api/healthz` devuelve
   `{ "status": "ok", "checks": { "db_master": true } }`.

### 12.2 Onboarding completo (modo TEST)

5. `https://app.empleaia.es/registro` carga la landing.
6. Completar formulario: empresa "Empleaia Test", email
   `admin@empleaia.es`, slug `test1`, plan Starter mensual.
7. Stripe Checkout TEST: tarjeta `4242 4242 4242 4242`, CVV 123,
   fecha futura.
8. Verificar redirect a `https://app.empleaia.es/registro/exito`.
9. Verificar email de bienvenida en inbox del operador (puede ir a
   spam si Resend recién activado).
10. Verificar tenant en `master.tenants`:
    ```sql
    SELECT slug, status, plan_key FROM master.tenants WHERE slug = 'test1';
    \dn tenant_test1
    ```

### 12.3 Producto del tenant

11. `https://test1.empleaia.es/login` con credenciales del email.
12. Crear sede + empleado.
13. Fichar entrada (botón "Iniciar jornada").
14. Esperar 1 min, fichar salida.
15. Tab Informes → exportar PDF y Excel.
16. Tab Configuración → 6 sub-tabs visibles.

### 12.4 Panel super-admin

17. Crear super-admin via SSH al container:
    ```sh
    docker exec -it fichaje_app \
      npm run super-admin:create -- admin@empleaia.es "Operador" "<pass>"
    ```
18. Login en `https://admin.empleaia.es/admin/login`.
19. Verificar `/admin/dashboard` muestra métricas (1 tenant, 1 sub).
20. `curl https://admin.empleaia.es/api/admin/tenants -H "Cookie: <admin-session>"`
    devuelve `test1`.

### 12.5 API pública v1

21. Desde tenant test1, crear API token:
    ```sh
    curl -X POST -H "Cookie: <session>" \
      -H "content-type: application/json" \
      -d '{"name":"e2e-test"}' \
      https://test1.empleaia.es/api/me/api-tokens
    ```
22. Usar plainToken devuelto:
    ```sh
    curl -H "Authorization: Bearer <plainToken>" \
      https://test1.empleaia.es/api/v1/empleados
    ```
    Devuelve JSON con empleado del paso 12.

### 12.6 Cleanup post-test

23. Refund cobro 1€ en dashboard Stripe.
24. Cancel subscription en portal cliente.
25. Eliminar tenant test1 manualmente:
    ```sql
    DROP SCHEMA tenant_test1 CASCADE;
    DELETE FROM master.subscriptions WHERE tenant_id = '<id>';
    DELETE FROM master.tenants WHERE slug = 'test1';
    ```

### 12.7 Tarjeta REAL (post-migración LIVE)

Repetir pasos 5–10 con tarjeta real y plan Starter mensual (precio
mínimo, ej. 9€/mes). Refund + cancel inmediatamente. Valida la cadena
LIVE completa antes de abrir a clientes reales.

---

## §13. Riesgos identificados

### §13.1 DNS IONOS — propagación inicial

- IONOS DNS típicamente propaga en 5–30 min. En extremo, hasta 24h
  en algunos resolvers.
- Mitigación: TTL inicial 300s durante setup, subir a 3600s tras
  estabilización.
- Bloquea `acme.sh --issue` si TXT `_acme-challenge.*` no propaga →
  acme.sh espera 60s entre creación TXT y validación; suele bastar.

### §13.2 IONOS API — rate-limit no documentado

- La documentación oficial de IONOS DNS API **no publica límites
  explícitos**. El plugin acme.sh `dns_ionos.sh` no implementa
  retry/backoff (confirmado en código fuente).
- Riesgo: si en debug se hacen muchos `--issue` consecutivos, podría
  hitear un 429 silencioso.
- Mitigación operativa: emisión inicial 1 vez + renovaciones cada 60
  días. Si aparece 429, esperar 1h y reintentar.

### §13.3 Wildcard SSL — renovación automática crítica

- Si la API IONOS devuelve errores en la fecha de renovación (60 días),
  acme.sh reintenta. Si tras 30 días sigue fallando → cert expira a
  los 90 días → app cae con TLS error en TODOS los subdominios.
- Mitigación: monitorear logs `tail -f /root/.acme.sh/acme.sh.log`.
  Alerta si la última entrada exitosa es > 14 días vieja → operador
  investiga.
- Tarea operativa Fase 9 (TODO N30): cron que verifique el cert y
  envíe email si quedan < 30 días para expirar.

### §13.4 Migrations BD — assumptions de dev

- Migraciones que pasan en dev (con datos test) pueden fallar en
  producción (con datos reales del cliente migrado). Especialmente:
  zona horaria del servidor distinta, charset Postgres distinto,
  case-sensitivity diferente.
- Mitigación: dev local con Postgres mismo image (`postgres:16-alpine`)
  + zona horaria UTC explícita. Migraciones backward-compat (ADR-005
  §2.5.a).

### §13.5 acme.sh + Dokploy — integración no trivial

- Dokploy versiona Traefik y la estructura `/etc/dokploy/traefik/`.
  Cambios en versiones de Dokploy podrían cambiar paths o invalidar
  el dynamic config setup.
- Mitigación: documentar versión de Dokploy usada en el primer deploy.
  Plan B (§4.3.c): renovación manual cada 55 días con cron + script
  reload manual. Plan C (§4.3.d): migrar zona DNS a Cloudflare.
- Test de fumar antes del primer push a production: ejecutar
  `acme.sh --renew --force -d empleaia.es` y verificar que el dynamic
  config apunta a los nuevos archivos sin restart de Traefik.

### §13.6 Postgres en Docker — volumen mal montado

- Si por error se monta como bind o anonymous volume, un
  `docker-compose down -v` borra los datos. O un `docker volume prune`
  agresivo.
- Mitigación: volumen NAMED `postgres_fichaje_data` con declaración
  explícita en compose. Verificar `docker volume inspect
  postgres_fichaje_data` antes del primer deploy.
- Backup diario (§9) cubre el caso peor (pérdida total volumen).

### §13.7 Auto-deploy — bug runtime no detectado en CI

- Bug que pasa tsc + tests pero rompe en producción (ej. variable
  env mal nombrada, dependencia de FS no portable). Healthcheck
  detecta y rollback.
- Mitigación adicional: política operativa "no merge a production
  en horario laboral del cliente principal". E2E nightly (TODO N22).

### §13.8 Webhook Stripe — secret incorrecto

- `whsec_*` mal copiado a Dokploy secrets → handler rechaza por firma
  inválida → checkout completed pero tenant nunca se crea. Cliente
  cobrado sin servicio.
- Mitigación: verificar `whsec_*` antes del primer cliente real (paso
  §12.2 con cuenta de test del operador). Si falla, error visible en
  logs.

### §13.9 Email Resend — dominio no verificado / quota agotada

- Resend dominio `empleaia.es` no verificado → emails rebotan.
- Plan free Resend: 100 emails/día, 3000/mes. Suficiente con 1–10
  tenants iniciales.
- Mitigación: verificación en §3.5 antes del primer cliente. Upgrade
  plan Resend cuando crezca.

---

## §14. Lo que NO hace Fase 8

Excluido del alcance:

- **Migración del cliente actual** de `ficha.tecnocloud.es` (mono-tenant)
  al SaaS multi-tenant en `empleaia.es/<slug>`. Proyecto separado,
  posterior a Fase 8, con su propio plan y ventana operativa. La app
  antigua sigue en `ficha.tecnocloud.es` durante toda Fase 8.
- **MFA TOTP super-admin** (TODO N9 — Fase 9).
- **Archivado audit_log** > 7 años (TODO N10).
- **MRR real desde Stripe** (TODO N12 — métrica está en `null`).
- **Dispatch real de webhooks tenant** (TODO N15 — endpoint registro
  existe, dispatch no).
- **Providers nómina reales** (TODO N16 — solo stubs).
- **pgbouncer**: día 1 sin pgbouncer. Postgres con `max_connections=200`
  y N clientes Prisma directos. Cuando crucemos ~30 tenants y veamos
  `connection limit exceeded`, añadir pgbouncer (TODO N23).
- **Postgres dedicado fuera del stack Dokploy** (TODO Fase 9 cuando
  primer cliente real lo justifique por SLA).
- **Monitoreo / alertas avanzado**: Sentry, Better Stack, Grafana
  Cloud. Día 1 solo logs Dokploy + email del operador (TODO N25).
- **CI/CD avanzado**: E2E en cada PR, deploy preview por branch,
  staging environment. Día 1 solo CI básico + auto-deploy (TODO N22).
- **Migración DNS a Cloudflare**: solo si plan A (acme.sh + IONOS) y
  plan B (manual) fallan en producción. Plan C documental.
- **WAF / rate limiting global / bot protection**: TODO N28.
- **Cert para custom domains de tenants**: la lógica está en código
  (Fase 6), pero el cert por custom domain se gestiona puntualmente
  cuando llegue primer cliente con la feature.

---

## §15. Puntos a confirmar antes de implementar

7 preguntas concretas. **El operador debe responder antes** de que el
bloque de implementación arranque.

### §15.1 Email transaccional

- **Provider propuesto**: Resend (free tier 100 emails/día, 3000/mes,
  escalable a planes pagos cuando crezca).
- Alternativas: SendGrid, AWS SES, Postmark, postal (self-hosted).
- Resend ya se integra en código (Fase 5 lo usa). Cambiar a otro
  provider requiere mínimo refactor en `src/lib/email.ts`.
- ¿Confirmas Resend o prefieres otro?

### §15.2 API key IONOS

- ¿Generada ya en `developer.hosting.ionos.es/keys`? Si no, generarla
  ahora — es bloqueante.
- Verificar permisos: la API key debe tener acceso a la zona
  `empleaia.es` (no a otras zonas, principio de mínimo privilegio).

### §15.3 Email para notificaciones deploy fallido

- **Propuesto**: `admin@empleaia.es` (cuenta nueva, forwarded al
  operador).
- Alternativa: `dansanch@tecnocloud.es` (cuenta personal).
- ¿Cuál?

### §15.4 dockploy.tecnocloud.es — containers preexistentes

- Confirmar que **no hay otros containers escuchando puerto 443** en
  el host. Ejecutar:
  ```sh
  ss -tlnp | grep ':443'
  docker ps --format '{{.Names}}\t{{.Ports}}' | grep '443'
  ```
- Confirmar que la app antigua Ficha (en `ficha.tecnocloud.es`)
  comparte Traefik con el SaaS nuevo (mismo Dokploy) sin colisionar
  por host (Traefik multiplexa). ¿OK?

### §15.5 Capacidad disco /backups

- **Propuesto**: 50 GB iniciales en `/backups/postgres`.
- Verificar `df -h /backups`. Si < 50 GB, montar volumen adicional o
  usar otra ruta.
- ¿Está disponible / hay que provisionar?

### §15.6 GitHub deploy keys

- Repo `tecnocloudes/fichaje` es **público** o **privado**?
- Si privado: generar deploy key read-only y configurar en Dokploy
  (§3.3). Si público: Dokploy puede clonar sin auth.
- ¿Cuál es el caso?

### §15.7 NEXTAUTH_SECRET / AUTH_SECRET

- **Propuesto**: generar nuevo con `openssl rand -hex 32`.
- Usar el MISMO valor para `AUTH_SECRET` y `NEXTAUTH_SECRET`
  (compatibilidad NextAuth v5).
- Generar también `ADMIN_JWT_SECRET` con otro `openssl rand -hex 32`
  (separado).
- ¿OK con la propuesta o prefieres reutilizar secrets existentes de
  algún entorno previo?

---

## §16. Estructura de commits estimada

Lista ordenada de los commits que hará el bloque de implementación
(orden propuesto; ajustable):

1. **`feat(deploy): Dockerfile multi-stage con entrypoint`** — añadir
   `entrypoint.sh`, ajustar `CMD`, build args para `GIT_SHA`, instalar
   `postgresql-client` en runner.
2. **`feat(deploy): docker-compose.production.yml con app + worker + postgres`** —
   3 servicios, volumen NAMED, secrets desde env, healthchecks.
3. **`feat(deploy): scripts/entrypoint.sh con migraciones idempotentes`** —
   00-roles + prisma migrate deploy + tenants:migrate:all + seed.
4. **`feat(api/healthz): endpoint /api/healthz para Dokploy`** — verifica
   db_master + version + cache stripe boot.
5. **`feat(deploy): scripts/backup.sh + acme-renew-hook.sh`** — backup
   diario con rotación + sync semanal + hook acme.sh post-renew.
6. **`feat(deploy): .env.production.example documentado`** — todas las
   variables §6 sin valores reales.
7. **`ci(github): workflow lint+test+build pre-deploy`** —
   `.github/workflows/ci.yml`, branch protection en `production`.
8. **`docs(deploy): runbook empleaia.es completo`** —
   `docs/deploy/dokploy.md`, `docs/deploy/ionos.md` (acme.sh setup),
   `docs/deploy/stripe-test-to-live.md`.
9. **`docs(arch): ADR-005 enmienda dominio + DNS IONOS`** —
   actualizar ADR-005 con cambio de dominio y de DNS provider.
10. **`feat(deploy): Traefik dynamic config wildcard-empleaia.yml`** —
    config en host, no en repo (excepto plantilla en
    `scripts/host/wildcard-empleaia.yml.example`).
11. **`docs(arch): cierre Fase 8 tras verificación E2E`** — runbook
    real con resultados, lista de TODOs derivados.
12. (Opcional) **`feat(deploy): backup-verify.sh + cron mensual`** —
    si se prioriza sobre TODO Fase 9.

Cada commit con mensaje en castellano, formato convencional, sin
emojis en el texto del commit.

---

## §17. Diferencias con ADR-005

ADR-005 ("Deployment y TLS") fue escrito asumiendo dominio
`ficha.tecnocloud.es` con subzona delegada a Cloudflare + Traefik
DNS-01 nativo. Esta Fase 8 introduce **enmiendas explícitas** que se
documentan para no contradecir el ADR sin trazabilidad:

### §17.1 Cambio de dominio

- **ADR-005 §2.1**: `ficha.tecnocloud.es` con subzona Cloudflare.
- **Fase 8**: dominio nuevo `empleaia.es` registrado y gestionado
  íntegramente en IONOS.
- **Acción**: emitir **enmienda a ADR-005** en commit
  `docs(arch): ADR-005 enmienda dominio + DNS IONOS` (commit 9).

### §17.2 DNS provider y SSL

- **ADR-005 §2.1**: Cloudflare DNS + Traefik DNS-01 con plugin
  cloudflare nativo.
- **Fase 8**: IONOS DNS + acme.sh externo con plugin dns_ionos +
  Traefik dynamic config con cert pre-generado. Más complejidad
  operativa pero mantiene IONOS (donde el operador ya gestiona el
  dominio).
- Plan B/C documentados (§4.3.c, §4.3.d).

### §17.3 Cutover

- **ADR-005 §5.4**: cutover paso a paso del cliente actual mono-tenant
  a multi-tenant en mismo dominio.
- **Fase 8**: SIN cutover. Dominio nuevo, deploy nuevo. Cliente actual
  intacto en `ficha.tecnocloud.es`. Migración del cliente antiguo a
  `empleaia.es/<slug>` es proyecto separado posterior (TODO N29 — Fase
  8.5 o Fase 9).

### §17.4 pgbouncer

- **ADR-005 §2.2.d**: pgbouncer obligatorio en session pooling.
- **Fase 8 día 1**: SIN pgbouncer. Justificación: con N=1–5 tenants
  iniciales y `max_connections=200`, los Prisma clients caben
  sobradamente. pgbouncer añade complejidad operativa
  (`userlist.txt` SCRAM, reload tras rotación) sin valor hasta crecer.
- Trigger para añadirlo: ~150 conexiones activas o ~20 tenants. TODO
  N23.
- Coste de añadirlo después: bajo. Solo cambia URL de los 4 clientes
  Prisma de `postgres:5432` a `pgbouncer:6432`. Sin downtime con
  ventana de mantenimiento.

### §17.5 CI/CD

- **ADR-005 §2.7**: CI completo + E2E nightly + reglas custom + branch
  protection.
- **Fase 8**: CI básico (lint + typecheck + tests + feature coverage).
  E2E nightly y reglas custom adicionales → TODO N22.

### §17.6 Observabilidad

- **ADR-005 §2.8**: logs estructurados JSON con `pino` + alertas email
  mínimas.
- **Fase 8**: logs Dokploy stdout (no estructurados con `pino`),
  alertas email por deploy fallido. JSON estructurado con `pino` +
  alertas avanzadas → TODO N25.

### §17.7 Cuatro roles Postgres

- **ADR-005 §2.2**: 4 roles obligatorios (`master_role`, `app_role`,
  `tenant_runtime_role`, `quota_writer_role`).
- **Fase 8**: respeta los 4 roles. `entrypoint.sh` los crea via
  `00-roles.sql`. **Sin pgbouncer**, los 4 clientes Prisma se conectan
  directamente a Postgres con sus credenciales — el aislamiento de
  privilegios sigue intacto.

---

## §18. Cómo verificar el plan tras el commit

```sh
git checkout feature/saas-migration
git log --oneline -3
# Esperado: HEAD = "docs(arch): plan de Fase 8 — despliegue Dokploy con IONOS DNS + acme.sh"

# Plan en:
ls -la docs/arch/00-fase-8-plan.md

# Conteo:
wc -l docs/arch/00-fase-8-plan.md
```

---

## §19. Referencias

### Internas

- [ADR-005 — Deployment y TLS](./adr-005-deployment-y-tls.md)
- [ADR-002 — Resolución de tenant](./adr-002-resolucion-tenant.md)
- [ADR-003 — Billing y suscripciones](./adr-003-billing-y-suscripciones.md)
- [ADR-007 — Panel super-admin](./adr-007-panel-super-admin.md)
- [Estado del proyecto 2026-05-02](./00-estado-proyecto-2026-05-02.md)
- [TODOs consolidados](./00-todos-consolidados.md)
- [Plan maestro SaaS migration](../specs/00-saas-migration-master-plan.md), Fase 8

### Externas (verificadas durante investigación previa al plan)

- IONOS DNS API: `https://api.hosting.ionos.com/dns/v1/zones`. Auth
  header `X-API-Key: $PREFIX.$SECRET`. Credenciales en
  `https://developer.hosting.ionos.es/keys`. Rate-limit no documentado.
- acme.sh dns_ionos plugin:
  https://github.com/acmesh-official/acme.sh/blob/master/dnsapi/dns_ionos.sh
- acme.sh wiki dnsapi (sección 129 — IONOS):
  https://github.com/acmesh-official/acme.sh/wiki/dnsapi
- Dokploy Certificates: https://docs.dokploy.com/docs/core/certificates
- Dokploy + Traefik wildcard SSL guide (DNS-01 con Cloudflare como
  referencia de patrón, adaptado a IONOS):
  https://www.naps62.com/posts/wildcard-ssl-in-dokploy
- Traefik ACME Resolver: https://doc.traefik.io/traefik/https/acme/

---

**Estado**: PLAN ESCRITO. Esperando OK del operador con respuestas a
§15.1–§15.7 antes de arrancar el bloque de implementación.
