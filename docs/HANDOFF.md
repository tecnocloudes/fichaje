# Handoff — estado del proyecto a 2026-05-10

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

## 7. Pendiente (en el momento del handoff)

Nada urgente abierto. Posibles próximos pasos:

- Reforzar Face ID: `faceVerified` actualmente es client-trust. Para
  hacerlo robusto, emitir token corto (single-use, TTL 60 s) en
  `/api/face/verify` y consumirlo en `/api/fichajes`.
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
