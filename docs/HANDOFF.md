# Handoff — estado del proyecto a 2026-05-10 (post-auditoría)

Documento para retomar el trabajo desde otra cuenta de Claude (o
máquina). Resume lo que hay en marcha, decisiones recientes y
operativa básica. Para reglas de código permanentes ver `AGENTS.md`.

---

## 1. Qué es esto

`empleaIA` — SaaS multi-tenant de fichaje + RR.HH. Repos:

- **App**: este repo (`tecnocloudes/fichaje`), Next.js 16.2.3 +
  Prisma 7.7.0 + NextAuth v5.
- **Landing**: `tecnocloudes/empleaia-landing` (Astro), en
  `~/Claude Code/Proyectos Claude/empleaia-landing`.

Branch activa: `feature/saas-migration`. Aún sin merge a `main`.
Producción ya corre desde esta rama vía Dokploy.

## 2. Infraestructura producción

- VPS: `185.47.13.172`, SSH `root@185.47.13.172 -p 5251`.
- Orquestador: **Dokploy** + Docker Swarm + Traefik.
  - Apps registradas: `empleaia-app` (id Dokploy `kbhSgmRPJZqRLvgD8g6ps`),
    `Landing` (`N4V7HU9dcWDwt9iheOSBh`).
  - Logs deploy: `/etc/dokploy/logs/<container-name>/*.log`.
  - Repo clonado por Dokploy: `/etc/dokploy/applications/empleaia-empleaiaapp-apdwzc/code`.
  - Auto-pull desde GitHub al push, **rebuild manual no automático** —
    si el último deploy falla, hay que dispararlo desde la UI Dokploy
    o esperar al siguiente push.
- Postgres: contenedor `empleaia-empleaia-xwe3vi.1.…`, DB `empleaia`,
  usuario `empleaia`. Una sola DB para todos los tenants vía schemas.
- Dokploy Postgres aparte: `dokploy-postgres.1.…`, DB `dokploy` (lista
  applications + deployments).

### Dominios
- `empleaia.es` — landing Astro (`empleaia-landing-awz1iy`).
- `app.empleaia.es` — registro y checkout Stripe.
- `<slug>.empleaia.es` — tenant (ej. `tecnocloud.empleaia.es`).
- `admin.empleaia.es` — panel super-admin.

## 3. Multi-tenant — recordatorio breve

- 2 schemas Prisma: `prisma/schema.prisma` (control plane `master.*`,
  cliente `prismaMaster`/`prismaRuntime`) y `prisma/schema-tenant.prisma`
  (producto `tenant_<slug>.*`, cliente `prismaApp` — Proxy multiplexado
  por tenant via `runWithTenant`).
- Tenants activos en prod: `tecnocloud`, `ucm`.
- Usuario de prueba: `info@tecnocloud.es / K@l@YL=k32o26*` (lo dio el
  propietario para debugging).
- Ver `AGENTS.md` — incluye reglas críticas (handlers usan
  `withTenant`, pages usan `withTenantPage`, no `fetch` interno entre
  rutas, etc.).

## 4. Lo último que hicimos (sesión 2026-05-08 → 2026-05-10)

Commits relevantes en `feature/saas-migration` (más reciente arriba):

- `1a21efc` feat(objetivos): implementar módulo OKRs (pro+enterprise).
  Modelo `Objetivo` + endpoints + UI grid de cards con slider de
  progreso. Lazy migration añade tabla. Reactiva la feature `objetivos`
  en BD para pro+enterprise.
- `82269cc` feat(informes): split básico/avanzado gateado por
  `informes_avanzados`. Listado de fichajes en todos los planes (RD
  8/2019); resumen + gráficos + ausencias/turnos solo pro+.
- `d13df5d` chore(pricing): saneamiento de la pricing table —
  `plan-pricing.ts` ahora solo promete features que funcionan
  (eliminadas las 14 latentes).
- `cf9a154` docs(handoff): documentar gating de planes y cierre de 4
  gates.
- `b972fc6` feat(plans): cerrar 4 gates de plan que usaban toggles
  locales en lugar de `hasFeature()`. Detalle en §5.6 abajo.
- `386c70c` docs(handoff): cerrar auditoría (cron de purga activo).
- `f48c093` chore(deploy): trigger redeploy para inyectar
  `CRON_SECRET` (commit empty para forzar build con env nuevo en
  Dokploy).
- `0bfcc87` chore(seguridad): auditoría — 9 vulnerabilidades cerradas
  (HIGH×5 + MEDIUM×4). Face ID client-trust → token HMAC single-use,
  IDOR en tareas/comunicados/articulos, rate limit + lockout en login
  y face verify, AES-GCM authTagLength, Cache-Control no-store en
  biometría, cron de purga RGPD, deps (nodemailer fuera +
  xlsx→exceljs). Detalle en §5.5 abajo.
- `cfc598d` fix: toggle no se comprime con labels largos (shrink-0).
- `5394296` feat(face-id): **snapshot cifrado al fichar** (toggle por
  empresa). RGPD art. 9. AES-256-GCM con `IA_ENCRYPTION_KEY`.
- `d475895` feat(informes): filtros sede + empleado, vista detalle de
  fichajes con geolocalización (link a Google Maps).
- `5db94a3` fix(build): separar `detectDeviceTypeFromUA` en módulo
  server-safe. Caso recurrente: importar desde `@/lib/device` (que
  exporta `useDeviceType` con React) desde un route handler hace
  caer todo el build con Turbopack.
- `ba721ee` device gating server-side (móvil/tablet) + emails
  ausencias con branding del tenant.
- `064c76e` ausencias: emails de solicitud (a managers + OWNERs) y
  resolución (al empleado). Face ID obligatorio funciona de verdad.
- `bab1fa9` fix: hidratar listas con array directo (los GET de
  `/api/ausencias` y `/api/ausencias/tipos` devuelven array, no
  `{tipos:[...]}` como leían los clientes).
- `9c8e163` fix: lazy migrate cualifica schema (los ALTER iban a
  `public`, fallaban con `relation does not exist`). Tipos de
  ausencia editar/borrar.
- `5b3c7bc` runMigrations cacheada por slug + llamada en PUT
  configuracion y POST fichajes.
- `5f79fed` trial banner solo OWNER + geo se refresca al permitirla.
- `5bcf2ac` /perfil + toggles geo/face id + sidebar limpio por plan.

## 5. Convenciones aprendidas en esta sesión (importantes)

### 5.1. SQL crudo en lazy migrations
`prisma.$executeRawUnsafe(...)` NO usa el `schema:` configurado en
`PrismaPg`, aunque sí lo usan las queries del modelo. **Siempre
cualificar** con `"tenant_<slug>"."Tabla"`. Ver `src/lib/migrate.ts`.
Búsquedas en `pg_constraint` deben filtrar por `nspname` para no
pisar entre tenants.

### 5.2. Endpoints que devuelven arrays
Varios GET (`/api/ausencias`, `/api/ausencias/tipos`, etc.) devuelven
`Response.json(array)` directo, no `{items:[...]}`. El cliente debe
usar `Array.isArray(data) ? data : (data?.items ?? [])`.

### 5.3. Server vs client en `lib/`
Si un archivo de `src/lib/` exporta un hook React (incluye
`useEffect/useState`), Turbopack lo marca como client-only. Si lo
importa un route handler, **el build entero peta**. Patrón: separar
funciones puras a `lib/<modulo>-server.ts` (o `-ua.ts`, etc.). Caso
de referencia: `device.ts` (cliente), `device-ua.ts` (server),
`device-types.ts` (tipo compartido).

### 5.4. Aplicar SQL urgente en producción
Cuando un deploy aún no está y el bug bloquea producción, se aplica
ALTER manualmente:

```bash
ssh -p 5251 root@185.47.13.172 \
  "docker exec empleaia-empleaia-xwe3vi.1.<id> \
     psql -U empleaia -d empleaia -c '<SQL>'"
```

Lista contenedores con `docker ps`, busca el de Postgres del producto
(no `dokploy-postgres`).

### 5.5. Auditoría de seguridad (cambios estructurales)

#### Face ID server-side
- Antes: `POST /api/fichajes` confiaba en `body.faceVerified: boolean`
  del cliente. Bypasseable enviando `{faceVerified: true}` sin pasar
  Face ID. Ahora: `POST /api/face/verify` emite `faceVerifyToken`
  (HMAC-SHA256 firmado con `IA_ENCRYPTION_KEY`, TTL 60s, single-use
  vía nonce in-memory). El cliente lo manda a `/api/fichajes` que
  llama `consumeFaceToken(token, userId, slug)`. Si falla, 400.
- Helpers: `src/lib/face/token.ts` (`issueFaceToken`/`consumeFaceToken`).
- Single-use sobrevive 90s (margen sobre el TTL 60s) en
  `globalThis._faceTokenNonces`. Si se escala a varias réplicas,
  migrar a Redis.

#### Rate limit + lockout
- `src/lib/rate-limit.ts` — store in-memory en `globalThis`. APIs:
  `checkRate(key, limit, windowMs)`, `isLocked(key)`,
  `recordFailure(key, threshold, lockoutMs)`, `clearFailures(key)`.
- Login (`src/lib/auth.ts` `authorize`): 10 intentos/min por IP +
  lockout tras 5 fallos en 15 min con key `login:slug:email:ip`
  (clave compuesta para evitar que un atacante desde otra IP bloquee
  al usuario legítimo).
- Face verify: 10 intentos/min por `user:ip`.
- Limitación: in-memory NO se comparte entre réplicas. Single-replica
  en Dokploy actual basta. Si se escala horizontalmente, migrar a
  Redis con la misma API.

#### IDOR cerrado en tareas/comunicados/articulos
- Antes: PUT/DELETE de `/api/tareas/[id]`, `/api/comunicados/[id]`,
  `/api/articulos/[id]` solo verificaban autenticación → cualquier
  EMPLEADO podía editar/borrar recursos ajenos del tenant.
- Ahora: comunicados y articulos requieren OWNER, MANAGER o
  `recurso.autorId === userId`. Tareas igual + caso especial: el
  empleado asignado puede marcar `completada` (y solo eso).

#### Purga biométrica RGPD
- Endpoint: `POST /api/cron/purge-biometrics` con
  `Authorization: Bearer ${CRON_SECRET}`. Itera `master.tenants`
  status=active, para cada uno reanida `runWithTenant` y borra
  `Fichaje.fotoSnapshotEnc` con `timestamp < now - retencionFotosDias`.
- Nuevo campo `ConfiguracionEmpresa.retencionFotosDias` (Int default
  90) — lazy migration en `migrate.ts`. Configurable por tenant en el
  futuro UI; por ahora 90 días para todos.
- ESLint whitelist: `/api/cron/` exento de `no-legacy-prisma` y
  `route-must-use-withTenant` (el patrón es de plataforma, no del
  tenant — usa `prismaMaster` para iterar tenants).
- **Acción operativa pendiente**: definir `CRON_SECRET` en Dokploy y
  programar cron externo (Dokploy/cron-job.org) que llame al endpoint
  diario. Hasta entonces los snapshots no se purgan.

#### Hardening menor
- AES-GCM (`src/lib/crypto/aes-gcm.ts`): `createDecipheriv` con
  `{ authTagLength: 16 }` — defensa en profundidad contra tags
  acortados.
- `/api/fichajes/[id]/foto`: `Cache-Control: private, no-store`
  (antes `max-age=300` permitía caché de navegador 5 min sobre dato
  biométrico).

#### Deps
- `nodemailer` y `@types/nodemailer` eliminados — no se usaba (el
  proyecto envía emails con Resend, ver `src/lib/email.ts`).
- `xlsx` → `exceljs` en `src/lib/informes/generators.ts`. `xlsx` tenía
  CVEs sin fix oficial (Prototype Pollution + ReDoS). El uso del
  proyecto era solo generación, no parsing, así que riesgo real bajo,
  pero exceljs es mantenido. **`generarExcel` ahora es async** — el
  caller (`/api/informes/exportar`) ya hace `await`.
- ExcelJS rechaza nombres de hoja duplicados case-insensitive: si
  `payload.tipo === "resumen"` la hoja extra de stats se llama
  "Estadísticas" (no "Resumen") para evitar colisión.

### 5.6. Gating de planes — feature en BD vs toggle local

Hay **dos capas de gating** distintas y no intercambiables:

1. **Feature de plan** (`master.features` + `master.plan_features`):
   controla qué módulos están disponibles según el plan contratado.
   Se consulta con `hasFeature("key")` o `withFeature("key", handler)`.
   Si el plan no la incluye → el módulo NO existe para ese tenant.
2. **Toggle local** (`ConfiguracionEmpresa.<flag>`): controla
   *comportamiento* dentro de un módulo ya contratado. P.ej., un
   OWNER del plan pro puede activar `faceIdObligatorio` para forzar
   Face ID en todos los empleados; otro OWNER del plan pro puede
   tenerlo apagado.

**Regla**: el toggle local SOLO debe respetarse si la feature del
plan está ON. Si la feature está OFF, el toggle se ignora (la UI lo
oculta y el backend hace como si estuviera apagado).

Auditoría 2026-05-11 encontró 4 features con módulo implementado
pero **sin chequeo de `hasFeature`** — un cliente "starter" podía
usarlas sin pagar. Fixed en `b972fc6`:

| Feature | Gate añadido |
|---|---|
| `face_id` | `withFeature("face_id")` en `/api/face/verify` y `/api/face/enroll`. `/api/face/status` devuelve `featureEnabled: false` si el plan no la tiene (no 402 — la pantalla de fichaje debe cargar). `/api/face/template/[userId]` DELETE permanece sin gate (derecho RGPD a borrar datos biométricos). En `/api/fichajes` el toggle `faceIdObligatorio` y `faceIdGuardarFoto` se ignoran si la feature está OFF. |
| `fichaje_movil` | En `/api/fichajes`: el toggle `fichajeMovilActivo=false` solo rechaza si `hasFeature("fichaje_movil")`. Sin feature, cualquier canal acepta el fichaje (RD 8/2019). |
| `fichaje_tablet` | Idem con `fichajeTabletActivo`. |
| `tareas` | `withFeature("tareas")` en `/api/tareas` (GET/POST) y `/api/tareas/[id]` (PUT/DELETE). |

Estado tras commits `82269cc` + `1a21efc`:
- `informes_avanzados`: **✅ cerrado** (`82269cc`). Split:
  - **Básico (todos los planes)**: `tipo=fichajes` + `tipo=presencia`.
    Cubre RD 8/2019.
  - **Avanzado (pro+enterprise)**: `tipo=resumen`, `tipo=ausencias`,
    `tipo=turnos`, `tipo=presencia-global`. Devuelven 402 en `/api/
    informes` y `/api/informes/exportar` si la feature está OFF.
  - UI: banner "Análisis avanzado disponible en plan Pro" cuando OFF.
    Bloques de stats/chart/tabla resumen ocultos; tabla plana de
    fichajes en su lugar.
  - **Afinamiento BD (2026-05-11)**: `plan_features.informes_avanzados`
    era `true` en starter por error histórico — el código gate-aba
    igual por TIPOS_AVANZADOS, pero el UI no sabía que iba a recibir
    402 y mostraba bloques avanzados rotos. Cambiado a `false` en
    starter (`true` en pro+enterprise). Ahora flag y comportamiento
    coinciden.
- `sso_saml`: deferred a Fase 9 (no hay endpoints aún).

**Patrón aprendido** — cuando añadas una feature nueva al catálogo
master, comprueba SIEMPRE que su gate `hasFeature("...")` aparece en
el handler real, no solo el toggle local en `ConfiguracionEmpresa`.

## 6. Toggles de tenant añadidos (Configuración → General)

- `geoObligatoria` — rechaza fichaje si no hay GPS (RD 8/2019: el
  fichaje no DEBERÍA bloquearse, pero si el OWNER lo decide se hace).
- `faceIdObligatorio` — los empleados con `FaceTemplate` deben pasar
  Face ID; los que no, ven CTA "Registrar Face ID" en `/empleado`.
- `faceIdGuardarFoto` — si se activa, al fichar con Face ID se
  almacena un snapshot 150×150 JPEG cifrado AES-GCM (key
  `IA_ENCRYPTION_KEY`) en `Fichaje.fotoSnapshotEnc`. Visible en
  `/admin/informes` (vista detalle empleado, columna Foto). Servido
  por `GET /api/fichajes/[id]/foto` (OWNER cualquier fichaje, MANAGER
  solo de su sede).
- `fichajeMovilActivo` / `fichajeTabletActivo` — gating server-side
  por User-Agent en `POST /api/fichajes`.
- `retencionFotosDias` (Int, default 90) — días de retención del
  snapshot biométrico antes de que el cron lo purgue. RGPD
  art. 5.1.e (minimización). No tiene UI todavía; se cambia con un
  UPDATE manual a `ConfiguracionEmpresa` por tenant si hace falta.

## 7. Pendiente (en el momento del handoff)

### Operativa post-auditoría (estado final)
- ✅ **`CRON_SECRET` configurado en Dokploy** (env var de
  `empleaia-app`). Backup del env pre-cambio en local:
  `/tmp/dokploy-backups/empleaia-app-env-pre-cron-secret.txt`.
- ✅ **Schedule `purge-biometrics-rgpd` activo en Dokploy**
  (`scheduleId=8RYAH18d1o88zy41`, cron `0 3 * * *` Europe/Madrid,
  type `dokploy-server`). Ejecuta el `script.sh` en
  `/etc/dokploy/schedules/empleaia-app/script.sh` (un curl con Bearer
  al endpoint de purga). Verificado manualmente: log produce
  `{"ok":true,"tenantsProcesados":2,"totalPurgado":0,...}`.
- ✅ **Lazy migrate aplicada** en tecnocloud + ucm — la primera
  llamada al cron disparó `runMigrations()` por cada tenant y añadió
  `retencion_fotos_dias` con defecto 90.
- ✅ **Face ID en producción verificado** — sesión 2026-05-10 con
  el usuario dueño: `/api/face/verify` emite token, `/api/fichajes`
  lo consume, snapshot cifrado guardado. Score 0.94, fichaje
  `cmp0b47pj000307nxj95wyvwx`.
- ✅ **Gates de plan cerrados** (commit `b972fc6`): 4 features que
  estaban "abiertas" para todos los planes ahora respetan el
  contrato. Detalle en §5.6.
- ⚠️ **Detalle Dokploy a recordar**: si en el futuro se crean
  schedules vía SQL directo (no UI), hay que crear manualmente el
  `script.sh` en `/etc/dokploy/schedules/<appName>/`. La UI lo
  regenera al guardar; el SQL puro no. Comprobado al insertar el
  schedule de purga.

### Hallazgos de auditoría sin atacar
- Los ~21 errores `no-explicit-any` que reporta ESLint en
  `src/app/api/fichajes/[id]/route.ts`, `tareas/route.ts`,
  `fichajes/route.ts` y otros — son `(session.user as any).rol`
  preexistentes. No son regresión. Limpieza tipográfica pendiente.
- 14 vulns transitivas npm restantes — cadena `next-pwa → workbox →
  serialize-javascript`, `dompurify`, `fast-uri`, `hono` (vía
  `@prisma/dev`), `@babel/plugin-transform-modules-systemjs`. Ninguna
  en el path crítico; se resuelven en upgrades futuros.
- Marketing-only features (6 restantes tras batch sesión
  2026-05-11): `retribucion_flex`, `prenomina`, `multi_empresa`,
  `chat`, `whatsapp_bot`, `marketplace`. En BD están a `false`
  en TODOS los planes. Se quedan así porque:
  - `chat` y `whatsapp_bot` requieren infraestructura realtime /
    WhatsApp Business API (costes externos).
  - `marketplace` requiere catálogo de integraciones (esfuerzo
    grande sin demanda comprobada).
  - `multi_empresa` cambio estructural (modelo Tenant → Empresas).
  - `prenomina` y `retribucion_flex` requieren conocimiento fiscal
    específico de España + conexión con software de nómina externo.
- 1 ⚠️ gate sin cerrar: `sso_saml` (Fase 9, sin endpoints).

### Pendiente externo
- ✅ **Landing Astro** alineada — commit `16170d7` en
  `tecnocloudes/empleaia-landing` saneó `src/components/Precios.astro`
  con los mismos bullets que `plan-pricing.ts`. Dokploy auto-pull
  desplegará `empleaia.es` con la versión correcta. El resto del
  repo (Funcionalidades, Soluciones, Hero, FAQ, legales) NO tenía
  menciones a features latentes — verificado por grep.

### Mejoras opcionales
- Limpiar `wallet` de tenants existentes en producción (la feature
  fue retirada, ya se borró de tecnocloud + ucm pero ojo si hay
  tenants nuevos):
  ```sql
  DELETE FROM master.tenant_features WHERE feature_key='wallet';
  DELETE FROM master.plan_features  WHERE feature_key='wallet';
  DELETE FROM master.features        WHERE key='wallet';
  ```
- Migrar la lógica lazy de `migrate.ts` a migraciones formales en
  `prisma/migrations-tenant/` cuando haya un momento tranquilo.
- Migrar `rate-limit.ts` y face token nonces a Redis si se escala
  horizontalmente (hoy single-replica en Dokploy → in-memory basta).
- UI para `retencionFotosDias` en Configuración → General.

## 8. Cómo retomar

1. `cd "/Users/dani/Claude Code/Proyectos Claude/fichaje"`.
2. `git status` — debería estar limpio en `feature/saas-migration`.
3. `git pull` por si hubo cambios externos.
4. Lee `AGENTS.md` (reglas estructurales) y este `docs/HANDOFF.md`.
5. Si vas a desplegar: `git push` → Dokploy auto-pull. Si el deploy
   falla, lo ves en la UI o con:
   ```
   docker exec dokploy-postgres.1.<id> psql -U dokploy -d dokploy \
     -c "SELECT \"createdAt\", status FROM deployment \
         WHERE \"applicationId\"='kbhSgmRPJZqRLvgD8g6ps' \
         ORDER BY \"createdAt\" DESC LIMIT 5;"
   ```
6. Para desarrollo local hay un seed: `NODE_ENV=development npm run dev:seed-tenant`
   crea `tenant_dev` con OWNER `admin@dev.local / dev_password_2026`.
   Después `npm run dev` y abre `http://dev.localhost:3000/login`.
