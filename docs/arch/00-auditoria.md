# Fase 0 — Auditoría del repo `fichaje` para migración a SaaS multi-tenant

- **Estado**: borrador para revisión
- **Fecha**: 2026-04-28
- **Rama**: `feature/saas-migration`
- **Spec maestra**: [`docs/specs/00-saas-migration-master-plan.md`](../specs/00-saas-migration-master-plan.md)
- **Visión**: [`docs/arch/adr-000-vision-saas.md`](./adr-000-vision-saas.md)
- **Alcance**: solo lectura. No se ha tocado código, ni ejecutado builds, tests ni migraciones.

---

## 0. Resumen ejecutivo

El repo es una app **Next.js 16.2.3** mono-tenant funcional, con **un único schema PostgreSQL** (`public`), **19 modelos Prisma**, **NextAuth v5 beta + JWT**, branding/configuración global cargado desde una fila singleton en `ConfiguracionEmpresa`, **sin tests propios** y **sin carpeta `prisma/migrations/`**. El deploy en Dokploy reaprovecha el Postgres del proyecto y aplica DDL **de forma perezosa** desde código (`src/lib/migrate.ts`), no desde un workflow de migraciones Prisma. Esto último —no `db:push` como decía el contexto pre-recopilado— es el riesgo operativo más grave hoy.

Los acoplamientos mono-tenant están concentrados en seis puntos: (1) `prisma.configuracionEmpresa.findFirst()` esparcido por libs y rutas (email, push, notificaciones, layouts, branding, login, set-password), (2) `User.email` y `User.dni` con `@unique` global, (3) `id: "singleton"` como ancla de la única fila de configuración, (4) `lib/prisma.ts` con un único cliente y connection string, (5) `middleware.ts` que protege por rol pero no resuelve tenant por host, y (6) el rol `SUPERADMIN` que en este código designa al admin de la empresa, no al super-admin de la plataforma — choque de nomenclatura crítico para Fase 7. Hay además un bug de seguridad pre-existente: `GET /api/empleados` filtra `password` y `resetToken` en el `select`.

**Top 3 riesgos antes de Fase 1**:

1. **Migraciones**: hoy el código depende de un `runMigrations()` lazy con `executeRawUnsafe` invocado solo desde un par de rutas. Hay que congelar el estado actual a una migración Prisma "baseline" antes de tocar nada multi-tenant, o quedará drift entre lo que dice el schema y la BD viva.
2. **Renombrado del rol `SUPERADMIN`**: cualquier ADR de auth o panel super-admin chocará con esta enum si no se renombra primero. Propuesta: `OWNER` (admin del tenant) y reservar `SUPERADMIN` o `PLATFORM_ADMIN` para el control plane.
3. **Estrategia TLS**: el DNS de `tecnocloud.es` está en paginalia sin DNS-01. Recomendación: opción A (delegar la zona `ficha.tecnocloud.es` a Cloudflare) — argumentado en §10 y bloqueante para Fase 8.

**Decisiones que el usuario debe tomar antes de Fase 1**: (a) ¿una DB con muchos schemas o dos DBs (master + app)? (b) ¿`SET search_path` por request o connection pool por tenant? (c) ¿Redis desde el día 1? (d) ¿renombramos `SUPERADMIN` ya o en Fase 4? (e) ¿Stripe modo test desde Fase 2 o entra en Fase 4?

---

## 1. Stack y estructura

### 1.1 Stack (versiones tomadas de `package.json`)

| Capa | Tecnología | Versión |
|---|---|---|
| Runtime | Node | `>=22.0.0` (`.nvmrc` = `22`) |
| Framework | Next.js (App Router) | `16.2.3` |
| UI | React | `19.2.4` |
| Estilos | Tailwind | `^4` (con `@tailwindcss/postcss`) + Radix |
| ORM | Prisma | `^7.7.0` con `@prisma/adapter-pg` `^7.7.0` y `pg` `^8.20.0` |
| Auth | `next-auth` | `5.0.0-beta.30` (Credentials + JWT) |
| Hash passwords | `bcryptjs` | `^3.0.3` |
| Validación | `zod` | `^4.3.6` (+ `@hookform/resolvers`) |
| Forms | `react-hook-form` | `^7.72.1` |
| Estado cliente | `zustand` | `^5.0.12` |
| PWA | `next-pwa` | `^5.6.0` (+ `public/sw.js` propio) + `web-push` `^3.6.7` |
| Email | `resend` `^6.10.0` + `nodemailer` `^7.0.13` |
| Charts | `recharts` `^3.8.1` |
| Export | `jspdf` `^4.2.1`, `jspdf-autotable` `^5.0.7`, `xlsx` `^0.18.5` |
| Realtime | `socket.io` + `socket.io-client` `^4.8.3` (declarados pero **no integrados en código**) |
| Linter | ESLint `^9` + `eslint-config-next` `16.2.3` |
| Tooling | `tsx` `^4.21.0`, `dotenv` `^17.4.1`, TS `^5` |

Gestor de paquetes: **npm** (hay `package-lock.json`, no `pnpm-lock.yaml` ni `yarn.lock`). Linter: ESLint 9 con `defineConfig` (`eslint.config.mjs`). Formatter: **no hay** Prettier ni equivalente en `package.json`.

### 1.2 Convenciones del repo

- Alias TS: `@/*` → `./src/*` (`tsconfig.json:21-23`).
- Cliente Prisma generado fuera de `node_modules`: `output = "../src/generated/prisma"` (`prisma/schema.prisma:3`). Está en `.gitignore` (`.gitignore:45`).
- Route groups Next: `(auth)` y `(dashboard)` para separar layouts sin afectar al path público.
- Archivos `.env`/`.env.local` ignorados (`.gitignore:34-36`); `.env.example` tracked.
- Idioma del producto: castellano (modelos en español: `Tienda`, `Fichaje`, `Turno`, `Ausencia`, etc.).
- ESLint 9 con `globalIgnores` añadidos sobre los del preset (`eslint.config.mjs:9-15`).
- TypeScript estricto (`"strict": true`), `target: "ES2017"`, `moduleResolution: "bundler"` (`tsconfig.json`).
- `prisma.config.ts` declara `migrations: { path: "prisma/migrations" }` aunque la carpeta **no existe** — Prisma simplemente la creará cuando se invoque por primera vez `prisma migrate dev`.

### 1.3 Árbol resumido

```
fichaje/
├── prisma/
│   ├── schema.prisma            # 19 modelos, 5 enums
│   └── seed.ts                  # 15 tiendas, superadmin, managers, empleados
├── src/
│   ├── middleware.ts            # NextAuth + redirección por rol
│   ├── lib/
│   │   ├── auth.ts              # NextAuth full (con Credentials + Prisma)
│   │   ├── auth.config.ts       # Config Edge-safe (sin Prisma) para middleware
│   │   ├── prisma.ts            # Cliente único global con PrismaPg
│   │   ├── email.ts             # Resend, lee config singleton
│   │   ├── push.ts              # web-push, lee config singleton
│   │   ├── notificaciones.ts    # Orquestador in-app/email/push
│   │   ├── migrate.ts           # DDL "lazy" (executeRawUnsafe IF NOT EXISTS)
│   │   ├── email-templates.ts
│   │   └── utils.ts
│   ├── generated/prisma/        # Cliente Prisma generado (gitignored)
│   ├── components/              # ui/, layout/, providers, etc.
│   ├── hooks/
│   └── app/
│       ├── layout.tsx           # Root layout (lee branding del singleton)
│       ├── manifest.ts          # PWA manifest (TelecomFichaje hardcoded)
│       ├── globals.css
│       ├── (auth)/login | set-password | setup
│       ├── (dashboard)/
│       │   ├── layout.tsx       # Lee branding del singleton
│       │   ├── admin/           # 26 sub-rutas
│       │   ├── manager/         # 9 sub-rutas
│       │   └── empleado/        # 10 sub-rutas
│       └── api/                 # 46 archivos route.ts
│           ├── auth/[...nextauth]/route.ts
│           ├── auth/set-password/route.ts
│           ├── setup/{,reset}
│           ├── empleados/{,[id]/{,reenviar-invitacion}}
│           ├── tiendas/{,[id]}
│           ├── fichajes/{,estado,[id]}
│           ├── turnos/{,[id]}
│           ├── ausencias/{,tipos,[id]}
│           ├── tareas/{,[id]}
│           ├── comunicados/{,[id]}
│           ├── articulos/{,[id]}
│           ├── documentos/{,[id]}
│           ├── bolsa-horas/{,[id]}
│           ├── onboarding/{,plantillas/{,[id]},[id]/tareas}
│           ├── notificaciones/{,[id],preferencias}
│           ├── push/{generar-vapid,subscripcion,vapid-public-key}
│           ├── branding/{,favicon}
│           ├── configuracion/{,branding,test-email}
│           ├── dashboard/
│           ├── informes/
│           └── festivos/
├── public/
│   ├── sw.js                    # Service Worker propio (PWA)
│   ├── icons/                   # Iconos PWA (192/512)
│   └── *.svg
├── Dockerfile                   # Multi-stage Node 20 alpine + standalone
├── docker-compose.yml           # postgres + app + migrate (perfil)
├── nixpacks.toml                # Solo declara nodejs_22
├── DESPLIEGUE.md                # Guía Dokploy
├── README.md                    # Boilerplate de create-next-app (no útil)
├── AGENTS.md / CLAUDE.md        # Instrucciones agentes
└── docs/
    ├── arch/adr-000-vision-saas.md
    └── specs/00-saas-migration-master-plan.md
```

**Discrepancia 1 vs contexto pre-recopilado**: el contexto dice "~40 endpoints"; en realidad son **46 archivos `route.ts`** bajo `src/app/api/`. No cambia la conclusión, pero conviene corregirlo.

**Discrepancia 2**: el contexto dice "el repo trabaja con `db:push`". Es a medias. El script `db:push` está en `package.json:18` y se usaría en local; **el contenedor de producción NO ejecuta `db:push` ni `migrate deploy`**. El Dockerfile (`Dockerfile:18,22`) solo hace `prisma generate` + `next build` y arranca `node server.js` (`Dockerfile:47`). Las DDL incrementales viven en `src/lib/migrate.ts:7-134` y se aplican lazily al primer hit de `GET /api/configuracion` o `PUT /api/configuracion/branding`. Es un patrón **frágil** y conviene reportarlo como tal: si nadie pisa esos endpoints después de un deploy con cambios de schema, la BD queda desactualizada.

---

## 2. Modelo de datos actual

### 2.1 Resumen de modelos

19 modelos, 5 enums (`Rol`, `TipoFichaje`, `MetodoFichaje`, `EstadoAusencia`, `EstadoTurno`). PK `cuid()` en todos. Tabla resumen agrupada por área funcional:

| Área | Modelo | Notas / `@unique` / FKs relevantes |
|---|---|---|
| Tenant (mono) | `ConfiguracionEmpresa` | Singleton implícito (una sola fila). Almacena horarios, tolerancia, geofencing, SMTP/Resend, VAPID, branding (favicon, colorPrimario, colorSidebar, appNombre). PK manual `id: "singleton"` se ve en upserts del código. |
| Identidad | `User` | `email @unique` GLOBAL, `dni @unique` GLOBAL, `resetToken @unique`. Rol enum, FK opcional a `Tienda`. Tiene relaciones a casi todo. |
| Locales (multi-tienda intra-tenant) | `Tienda` | Lat/lng + `radio` para geofencing. |
| Control horario | `Fichaje` | FK a `User` y `Tienda` (nullable). Indexada por `userId`, `tiendaId`, `timestamp`. |
| Planificación | `Turno` | FK a `User` + `Tienda` (NOT NULL). |
| Ausencias | `TipoAusencia`, `Ausencia` | `Ausencia.aprobadoPorId` → `User`. |
| Comunicación interna | `Notificacion`, `Comunicado`, `Articulo` | |
| Preferencias | `PreferenciasNotificacion` | `userId @unique`, cascada al borrar User. |
| Push | `PushSubscripcion` | `endpoint @unique` GLOBAL, cascada al borrar User. |
| RRHH adicional | `Tarea`, `Documento`, `BolsaHoras`, `Festivo` | |
| Onboarding | `ProcesoOnboarding`, `TareaOnboarding`, `PlantillaTareaOnboarding` | |

### 2.2 Constraints `@unique` problemáticas en multi-tenant

| Constraint | Archivo:línea | Por qué bloquea | Fix propuesto |
|---|---|---|---|
| `User.email @unique` | `prisma/schema.prisma:64` | Dos tenants no podrán tener el mismo email. Real: ocurre constantemente (un mismo email en dos empresas). | En schema-per-tenant: el `@unique` por defecto pasa a ser por schema, problema resuelto. En shared schema: convertir a `@@unique([tenantId, email])`. |
| `User.dni @unique` | `prisma/schema.prisma:70` | Idéntico problema. Más grave: dos contratos a la misma persona en empresas distintas son legítimos. | Igual que email. |
| `User.resetToken @unique` | `prisma/schema.prisma:66` | Compatible si schema-per-tenant. Si shared: combinar con `tenantId` o usar UUID global. | Mantener si schema-per-tenant. |
| `PushSubscripcion.endpoint @unique` | `prisma/schema.prisma:256` | El endpoint del navegador es global, así que ya es único cross-tenant — no es bloqueante, pero conviene revisar que no haya leak entre tenants si reusa el mismo navegador. | Mantener; añadir `tenantId` para auditar. |
| `ConfiguracionEmpresa` singleton | `prisma/schema.prisma:191-225` + `id: "singleton"` en upserts | Es la **definición** del mono-tenant: una empresa = una fila. | En multi-tenant: o (a) se mueve a `tenants` + `tenant_settings` por schema, o (b) se mantiene una fila singleton **por schema**. |

### 2.3 Estado de migraciones (CRÍTICO)

- **No existe** `prisma/migrations/`. Verificado con `find . -maxdepth 4 -type d -name migrations` (sólo aparecen rutas de `node_modules`).
- `prisma.config.ts:9` apunta a `prisma/migrations` pero la carpeta no se ha creado nunca.
- El histórico de cambios de schema vive en **dos sitios desacoplados**:
  1. `prisma/schema.prisma` — la fuente declarativa.
  2. `src/lib/migrate.ts:7-134` — DDL imperativo (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `DO $$ BEGIN … END $$` para constraints/FK condicionales).
- `runMigrations()` se invoca desde `src/app/api/configuracion/route.ts:9` (GET) y `src/app/api/configuracion/branding/route.ts:27` (PUT). En cualquier otra ruta no se ejecuta.
- Conclusión: en producción, los cambios de schema solo se aplican si (a) alguien entra a configuración después del deploy, o (b) alguien ejecuta `npx prisma db push` manual desde la terminal de Dokploy.

**Implicación para Fase 8**: hay que crear una **migración baseline** con `prisma migrate diff --from-empty --to-schema-datamodel` o `prisma migrate dev --create-only` y resolverla contra el estado vivo de la BD antes de tocar nada multi-tenant. Si no, la ejecución de `migrate deploy` sobre la BD de producción intentará crear tablas que ya existen.

---

## 3. Sistema de auth

### 3.1 Cómo está montado

- **NextAuth v5 beta** (`next-auth@5.0.0-beta.30`) con `strategy: "jwt"` y un único provider `Credentials` (`src/lib/auth.ts:14-58`).
- `src/lib/auth.config.ts` exporta una config "Edge-safe" que se importa desde el middleware (`src/middleware.ts:2`); `src/lib/auth.ts` extiende esa config añadiendo Prisma y bcrypt en el server runtime, igual que el split que recomienda NextAuth v5 para que el middleware corra en Edge.
- `trustHost: true` en `auth.config.ts:4` — necesario para Dokploy detrás de Traefik, pero peligroso si se expone a wildcard sin validar el host.
- Login: `email + password`, valida con `zod` (`auth.ts:8-11`), busca con `prisma.user.findUnique({ where: { email } })`, compara con bcrypt. Si `!user.activo` o no hay password, retorna null.
- Endpoint NextAuth: `src/app/api/auth/[...nextauth]/route.ts` (un wrapper de 2 líneas alrededor de `handlers`). Hay un **directorio duplicado** `src/app/api/auth/\[...nextauth\]` (con backslashes literales en el nombre) que parece basura del editor — vale la pena limpiarlo cuando lo toquemos.
- JWT callbacks (`auth.config.ts:10-30`): se inyectan `id`, `rol`, `tiendaId`, `nombre`, `apellidos` en el token. La sesión los expone en `session.user`.

### 3.2 Cómo se protegen las rutas

- `src/middleware.ts:1-46` ejecuta `NextAuth(authConfig).auth(req => …)` y aplica:
  - Las rutas `/api` se dejan pasar sin checks aquí.
  - `/setup` siempre accesible (el guard server-side está en `/api/setup/status` vía `count() === 0`).
  - Si no hay sesión y no es `/login`, redirige a `/login`.
  - Si hay sesión y es `/login`, redirige según `rol`: `SUPERADMIN→/admin`, `MANAGER→/manager`, default→/empleado`.
  - Si la ruta empieza por `/admin` y el rol no es `SUPERADMIN`, devuelve a `/empleado`.
  - Si empieza por `/manager` y no es `MANAGER` ni `SUPERADMIN`, idem.
- En cada endpoint API se vuelve a validar la sesión y el rol explícitamente (ej. `src/app/api/empleados/route.ts:10-21` y `:77-85`, `src/app/api/configuracion/route.ts:11-23`). El middleware **no** se ocupa de la API.
- El scoping intra-tenant de hoy se hace **por `tiendaId`**: un MANAGER solo ve empleados/fichajes/turnos de su tienda. Visible en `src/app/api/empleados/route.ts:30-36`, `src/app/api/fichajes/route.ts:25-34`, `src/app/api/turnos/route.ts:21-30` y similares.

### 3.3 Cómo se registran usuarios

- **Primer admin del sistema**: vía `/setup` (página) → `POST /api/setup` (endpoint) que **solo funciona si `prisma.user.count() === 0`** (`src/app/api/setup/route.ts:19-21`). Crea el primer `SUPERADMIN` y opcionalmente la primera `Tienda`. No requiere autenticación.
- **Resto de usuarios**: el SUPERADMIN llama a `POST /api/empleados` (`src/app/api/empleados/route.ts:75-185`). Esa ruta:
  1. Crea el `User` con `resetToken` aleatorio + `resetTokenExpiry = now + 7d` (`:121-122`).
  2. Si `ConfiguracionEmpresa.emailActivo`, manda un email con `invitacionTemplate` y URL `${NEXTAUTH_URL}/set-password?token=${resetToken}`.
  3. El usuario abre el enlace → página `/set-password?token=…` → `POST /api/auth/set-password` valida el token, hashea password y limpia `resetToken`/`resetTokenExpiry` (`src/app/api/auth/set-password/route.ts`).
- Hay un endpoint adicional `POST /api/empleados/[id]/reenviar-invitacion` que regenera el token y reenvía el email.
- También existe `POST /api/setup/reset` (`src/app/api/setup/reset/route.ts`) que **borra todos los datos** de todas las tablas si el usuario actual es SUPERADMIN y manda `confirmacion: "BORRAR TODO"`. Útil para staging, peligroso en producción multi-tenant — habrá que retirarlo o aislarlo a entornos no productivos.

### 3.4 Qué cambiar para multi-tenant

| Tema | Estado actual | Cambio necesario |
|---|---|---|
| `tenant_id` en JWT | No existe | Inyectar `tenantId` (slug o UUID) tras resolver host → tenant. Si el `tenantId` del JWT no coincide con el del host de la request, invalidar sesión. |
| Validación de host | `trustHost: true` sin más | Añadir lista blanca de hosts permitidos por entorno; rechazar host sin tenant resoluble. |
| Login en subdominio | Único endpoint global | El login se hace en `<slug>.ficha.tecnocloud.es/login` y ya filtra usuarios al schema del tenant. La página de login del dominio raíz pasa a ser landing/registro. |
| `findUnique({ where: { email } })` | Global, único cliente Prisma | Tras seleccionar schema (search_path o pool por tenant), el `findUnique` opera en el schema correcto. Si vamos a shared schema, hay que añadir `tenantId` al where en cada consulta. |
| Super-admin de plataforma | No existe, `SUPERADMIN` es admin de empresa | Crear tabla `super_admins` en el control plane + auth independiente. Renombrar enum `Rol.SUPERADMIN` → `OWNER` o `ADMIN_TENANT` (ver §10). |
| `/setup` | Crea el primer admin si no hay usuarios | Inservible en multi-tenant. Se reemplaza por flujo de onboarding Stripe (Fase 4). Mantener temporalmente solo para el primer cutover. |
| `/api/setup/reset` | Wipe completo | Retirar de producción. Para soporte, usar `DROP SCHEMA tenant_x CASCADE` por el panel de plataforma. |

---

## 4. Configuración (env vars y ficheros)

### 4.1 Inventario actual de env vars

`.env.example` (10 líneas) declara solo:

```
DATABASE_URL
AUTH_SECRET
NEXTAUTH_URL
NODE_ENV
```

Variables referenciadas en código (`grep process.env`):

- `DATABASE_URL` — `src/lib/prisma.ts:9`, `prisma/seed.ts:5`.
- `NEXTAUTH_URL` — `src/app/api/empleados/route.ts:157`, `src/app/api/empleados/[id]/reenviar-invitacion/route.ts:37`, `src/lib/email-templates.ts:188`.
- `NODE_ENV` — `src/lib/prisma.ts:12,18`.
- `AUTH_SECRET` — usado por NextAuth implícitamente; no aparece en `process.env.*` directamente porque NextAuth lo lee él mismo.

Lo que **vive en BD** (no en env vars) y ahora mismo es global por tenant:

- Credenciales SMTP (`emailHost`, `emailPort`, `emailUser`, `emailPassword`, `emailFrom`) en `ConfiguracionEmpresa`. Hoy `emailPassword` se está usando como API key de Resend (`src/lib/email.ts:11`) — convivencia confusa.
- VAPID keys push (`pushVapidPublicKey`, `pushVapidPrivateKey`) generadas por `POST /api/push/generar-vapid` y guardadas en `ConfiguracionEmpresa`.
- Branding (`logo`, `favicon`, `colorPrimario`, `colorSidebar`, `appNombre`).

### 4.2 Variables que sobran o faltan para multi-tenant

**Sobran o cambian de significado**:

- `DATABASE_URL` por sí sola no basta si vamos a control plane separado. Sería: `DATABASE_URL` (control plane) y, si separamos, `APP_DATABASE_URL` (schemas de tenants). Si una sola DB con muchos schemas, basta con `DATABASE_URL` apuntando a la DB compartida y los schemas se enrutan por código.

**Faltan (lista concreta a añadir en `.env.example`)**:

```
# === Multi-tenant ===
ROOT_DOMAIN=ficha.tecnocloud.es           # para extraer slug del host
ADMIN_SUBDOMAIN=admin                      # slug reservado del super-admin
RESERVED_SLUGS=admin,api,www,app,dashboard,login,onboarding

# === Control plane ===
# Si separamos DBs:
# MASTER_DATABASE_URL=postgresql://...
# Si una sola DB con schema "master":
# DATABASE_URL ya cubre, schema seleccionado por código.

# === Stripe ===
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_ENTERPRISE=price_...

# === Caché de tenant resolution (opcional Fase 1, ver ADR-002) ===
# REDIS_URL=redis://...

# === TLS / Dokploy (según ADR-005) ===
# Si opción A (Cloudflare DNS-01):
# CLOUDFLARE_API_TOKEN=...
# Si opción B (HTTP-01 por subdominio):
# DOKPLOY_API_URL=https://dokploy.tecnocloud.es
# DOKPLOY_API_TOKEN=...

# === Email plataforma (no por tenant) ===
PLATFORM_EMAIL_FROM=noreply@ficha.tecnocloud.es
RESEND_API_KEY=re_...                     # global, se usa para emails de plataforma; los tenants pueden override en su config
```

Decisión a tomar: **VAPID keys** ¿globales (una por plataforma, los tenants no las gestionan) o por tenant? Hoy son por "empresa". Recomendación: globales — el navegador vincula el endpoint al origen (`<slug>.ficha.tecnocloud.es`), y la VAPID key se valida en `Crypto-Key`/`p256ecdsa`. Si todas comparten dominio raíz, una clave global simplifica y no rompe nada.

---

## 5. Despliegue actual

### 5.1 Dockerfile

`Dockerfile` (47 líneas), multi-stage:

- `base`: `node:20-alpine`. **Discrepancia 3**: `package.json:6` exige Node `>=22.0.0` y `nixpacks.toml` usa `nodejs_22`, pero el Dockerfile usa Node 20. Funciona porque las features de 22 que usa Next 16 no son bloqueantes hoy, pero el desfase puede romperse en cualquier upgrade. **Recomendación**: alinear a `node:22-alpine`.
- `deps`: instala `libc6-compat openssl` + `npm ci`.
- `builder`: `prisma generate` + `npm run build` (`next build`). `NEXT_TELEMETRY_DISABLED=1`.
- `runner`: copia `public/`, `prisma/`, `.next/standalone`, `.next/static`. Crea usuario `nextjs:nodejs` (UID 1001), expone `:3000`, `CMD ["node", "server.js"]`.

**No hay `entrypoint.sh`**. **No se ejecuta `prisma migrate deploy` ni `db push` en arranque**. Las migraciones dependen de:
- (a) `runMigrations()` lazy desde `src/lib/migrate.ts` (DDL ad-hoc).
- (b) Ejecución manual desde la terminal de Dokploy (`DESPLIEGUE.md:71-77` lo documenta).

Esto es la mayor deuda operativa hoy.

### 5.2 docker-compose.yml

`docker-compose.yml` (60 líneas):

- Servicio `postgres`: `postgres:16-alpine`, healthcheck con `pg_isready`.
- Servicio `app`: build local, depende del healthcheck del postgres. Labels Traefik para enrutado por `${DOMAIN}`.
- Servicio `migrate`: build local, profile `migrate`, comando `npx prisma migrate deploy && npx prisma db seed` — lo que confirma que el flujo "oficial" sería `migrate deploy` aunque el repo no tenga aún `prisma/migrations/` para desplegar.
- Faltan: redis, mailhog (mencionados en spec maestra Fase 8). No se usan en local hoy.

### 5.3 nixpacks.toml

3 líneas (`[phases.setup] nixPkgs = ["nodejs_22"]`). Implica que también hay un path de build con Nixpacks (Dokploy lo soporta). Si Dokploy usa el Dockerfile, este fichero no aplica; conviene confirmar cuál es el build pack activo en el proyecto Dokploy.

### 5.4 DESPLIEGUE.md

Resumen breve:

- Documenta despliegue en Dokploy: variables (`DATABASE_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, `NODE_ENV`), provisión de Postgres en Dokploy, creación de la app Docker, primera migración manual y seed.
- Lista credenciales semilla en claro: `admin@telecom.es / password123`, `manager.tienda1@telecom.es / password123`, etc. Coherente con `prisma/seed.ts:78,87,100,117`. **Quitar de cualquier guía de producción** o limitarlas a entornos de demo.
- Auto-deploy por webhook GitHub.
- Estructura desactualizada (lo que dice `DESPLIEGUE.md:120-151` no refleja `bolsa-horas`, `onboarding`, `articulos`, `comunicados`, etc. que sí existen ya).

### 5.5 Recursos en Dokploy

(según contexto pre-recopilado)

- App: `Ficha`, slug interno `fichaje-prueba-qlhel6`, auto-deploy en push a `main`.
- Postgres: provisionado en el mismo proyecto Dokploy.
- Dominio: `ficha.tecnocloud.es`, puerto 3000, TLS Let's Encrypt HTTP-01 vía Traefik.
- DNS: paginalia.es (`ns1.paginalia.es`, `ns2.paginalia.es`), **sin DNS-01**.
- Sin CI/CD en `.github/workflows/` (verificado: el directorio `.github/` no existe).

### 5.6 Cómo se aplican migraciones HOY

- **Sobre el deploy**: nada automático. Se aplican las DDL "lazy" la primera vez que un usuario hace `GET /api/configuracion` (lo invoca `runMigrations()`).
- **Manual**: `DESPLIEGUE.md:71-77` indica `npx prisma migrate deploy` desde la terminal de Dokploy, pero **no hay migraciones que desplegar** porque la carpeta no existe.
- En la práctica, el equipo ha venido sincronizando schema vía `npm run db:push` en local apuntado a la BD de producción. Esto es lo que confirma indirectamente la ausencia de `prisma/migrations/`.
- Para Fase 8 esto NO sirve: hay que migrar a un flujo `migrate deploy` con baseline.

---

## 6. Tests existentes

- `find` recursivo en el repo (excluyendo `node_modules`) buscando `*.test.*`, `*.spec.*`, `__tests__/`, `vitest.config.*`, `jest.config.*`, `playwright.config.*`: **0 resultados** dentro de `src/` o raíz. Solo aparecen `__tests__` dentro de `node_modules`.
- No hay configuración de runner de tests en `package.json` (no hay scripts `test`, `test:e2e`, etc.).
- Cobertura efectiva: **0%**.

Implicación: la Fase 9 (calidad) parte de cero. La Fase 3 ("tests de integración con dos tenants en paralelo verificando que no hay fuga de datos entre ellos") obliga a montar **antes** un runner — propuesta concreta: `vitest` + `@testcontainers/postgresql` (para arrancar Postgres efímero por suite) + `playwright` para E2E. Si no se quiere Testcontainers, alternativa: `pg-mem` o un schema temporal por test.

---

## 7. Acoplamientos mono-tenant detectados

Tabla con archivo:línea, tipo, impacto, propuesta.

| # | Archivo:línea | Tipo de acoplamiento | Impacto en migración | Propuesta |
|---|---|---|---|---|
| 1 | `src/lib/prisma.ts:1-18` | **Cliente Prisma único global**, una sola `connectionString`, sin `search_path` por request | Bloqueante para schema-per-tenant. Cada request necesita "saber" qué schema apuntar. | Crear `getPrismaForTenant(slug)` que: (a) si pool por tenant, mantiene `Map<slug, PrismaClient>` con `?schema=tenant_<slug>` en la URL; (b) si `SET search_path`, usa `prisma.$executeRaw` al inicio de la request. Decisión en ADR-002. |
| 2 | `src/middleware.ts:1-46` | Middleware que protege por rol pero **no resuelve tenant por host** | Sin esto no hay multi-tenant funcional. | Añadir resolución host→tenant antes del check de auth. Cachear (in-memory por instancia + TTL corto, o Redis si se monta). Fase 3 ADR-002. |
| 3 | `src/lib/email.ts:5-9`, `src/lib/notificaciones.ts:76`, `src/lib/push.ts:10` | `prisma.configuracionEmpresa.findFirst()` **sin filtro de tenant** | Asume "una empresa = una fila". | En schema-per-tenant: el `findFirst()` devuelve la única fila de **ese** schema → resuelto sin tocar el código. En shared schema: añadir `where: { tenantId }`. |
| 4 | `src/app/layout.tsx:14-38` | Root layout lee branding global con `findFirst()` en cada render | Branding por host: hay que resolver el tenant antes de renderizar layout. | Para schema-per-tenant: una vez activado el middleware, `findFirst()` ya opera en el schema correcto. Se puede cachear el branding por host en memoria. |
| 5 | `src/app/(dashboard)/layout.tsx:27`, `src/app/(auth)/login/page.tsx:57` | Mismo patrón, branding leído desde server component | Igual que (4). | Igual que (4). |
| 6 | `src/app/api/configuracion/route.ts:16-20,67-71`, `src/app/api/configuracion/branding/route.ts:51-54`, `src/app/api/push/generar-vapid/route.ts:16-27` | `upsert({ where: { id: "singleton" } })` | Hardcodea la idea de "una sola fila de config". | En multi-tenant schema-per-tenant: la fila singleton existe **por schema**, sigue funcionando. En shared: cambiar PK a `tenantId` y `upsert` por tenant. |
| 7 | `prisma/schema.prisma:64` (`User.email @unique`) | Único global | Dos tenants no podrán reusar emails. | Schema-per-tenant: ya resuelto. Shared: `@@unique([tenantId, email])`. |
| 8 | `prisma/schema.prisma:70` (`User.dni @unique`) | Único global | Idem. | Igual que (7). |
| 9 | `prisma/schema.prisma:10-14` (enum `Rol.SUPERADMIN`) | Nombre choca con super-admin de plataforma | Confusión semántica grave. Cualquier check `rol === "SUPERADMIN"` puede colarse como permiso de plataforma. | **Antes de Fase 1**: renombrar a `OWNER` (admin del tenant). Reservar el término "SuperAdmin" para `super_admins` en control plane. Migración Prisma de enum + búsqueda y reemplazo en código. |
| 10 | `src/app/api/setup/route.ts:6-77` | Crea el primer SUPERADMIN si `prisma.user.count() === 0` | Solo funciona en mono-tenant. | Eliminar para producción multi-tenant. Sustituido por webhook Stripe (Fase 4). Mantener bajo flag para el primer cutover. |
| 11 | `src/app/api/setup/reset/route.ts:25-40` | Wipe global con confirmación textual | Riesgo de borrar datos cross-tenant si llegara a un super-admin malintencionado o despistado. | Retirar. Operaciones destructivas pasan al panel super-admin con auditoría e impersonación nominal. |
| 12 | `src/app/api/empleados/route.ts:46-66` | `select` incluye `password` y `resetToken` (`:60-61`) | **Bug de seguridad pre-existente**: el GET expone hashes y tokens al frontend. Independiente de multi-tenant, debe arreglarse. | Quitar de `select` y de la respuesta. Mismo `select` se repite en `:137-153` (POST). |
| 13 | `src/lib/migrate.ts:7-134` | DDL imperativo lazy con `executeRawUnsafe` | El "schema vivo" no equivale al `schema.prisma` declarativo. | Consolidar en una migración baseline antes de Fase 2. |
| 14 | `src/lib/email.ts:5-12` | Reusa `emailPassword` de SMTP como API key Resend | Confunde dos integraciones distintas, complica el modelo de configuración por tenant. | Separar columnas: `smtpHost/Port/User/Pass` + `resendApiKey` independientes en `ConfiguracionEmpresa` (o en `tenant_settings` post-migración). |
| 15 | `src/app/api/branding/favicon/route.ts:5-26` | `findFirst()` y devuelve favicon **público** sin auth — y sin tenant en la URL | El favicon servido es el de "la empresa" actual; sin host→tenant servirá un favicon u otro aleatorio. | El endpoint debe resolver tenant por `Host` header y leer del schema correcto (o cachear `<slug>→favicon`). |
| 16 | `src/app/api/branding/route.ts:6-41` | Endpoint público sin auth ni tenant | Mismo problema (15). | Igual que (15). |
| 17 | `src/app/manifest.ts:5-11` | PWA manifest con `name: "TelecomFichaje"` y `theme_color` hardcoded | El manifest se sirve desde `/manifest.webmanifest` único. Para PWA por tenant, hay que generarlo dinámico en función del host. | Convertir `manifest.ts` a una **route handler** (`app/manifest.webmanifest/route.ts`) que resuelva tenant y rellene `name`/`theme_color`/`icons` con el branding del schema. |
| 18 | `src/components/layout/header.tsx:77`, `src/components/layout/sidebar.tsx:343`, `src/app/(auth)/set-password/page.tsx:229` | Strings hardcoded de fallback (`"TelecomFichaje"`, `"HR Suite"`, `"Mi Empresa"`) | Cosmético, pero filtra branding del primer cliente. | Centralizar el fallback (`appNombre` por defecto = "Fichaje" o similar neutro de plataforma). |
| 19 | `prisma/seed.ts:51,78,87,100,117,249-251` | Seed crea tienda "TelecomFichaje", `admin@telecom.es`, passwords `password123` | El seed actual no es reusable como onboarding de tenant. | Reescribir seed como (a) seed de control plane (planes, features, super-admin de plataforma) y (b) seed por-tenant invocable con `tenants:seed <slug>`. |
| 20 | `src/app/api/setup/route.ts:48-56`, `src/app/(dashboard)/admin/configuracion/page.tsx:118,126` | El frontend de admin asume `id: "singleton"` en el state local | Acoplamiento UI con el modelo singleton. | Cuando se mueva la config a "una fila por tenant en su schema", basta con seguir aceptando una sola fila. La UI no necesita cambios si el modelo se mantiene singleton-por-schema. |

Notas adicionales:

- **`socket.io`** está en `package.json` pero `grep` no encuentra ningún uso real (`io`, `Server`, `socket.io` solo aparecen en lockfile/types). Conviene retirarlo o decidir si la Fase 5/6 lo necesita (notificaciones realtime).
- **`@auth/prisma-adapter`** está en `dependencies` pero `auth.ts` usa solo Credentials sin adapter (no hay `adapter:` en `NextAuth({...})`). Probablemente residual; con JWT puro es prescindible.

---

## 8. Mapa de migración

Por bounded context (los 5 declarados en ADR-000):

### 8.1 `control-plane` (NUEVO)

Se crea de cero. Vive en su propio schema (`master`) o BD (`fichaje_master`) — ver §10.

Tablas:

- `tenants` — id (uuid), slug (unique), nombre, schema_name, plan_id, status (`pending|active|suspended|cancelled`), `stripe_customer_id`, `created_at`, `updated_at`.
- `plans` — id, key (`starter|pro|enterprise`), name, price_eur_month, billing_period.
- `features` — id, key, name, description, type (`boolean|limit|quota`).
- `plan_features` — `plan_id` × `feature_id` × `value`.
- `tenant_features` — overrides/addons por tenant, `expires_at` opcional.
- `subscriptions` — `tenant_id`, `stripe_subscription_id`, `status`, `current_period_end`.
- `super_admins` — cuentas de plataforma, login propio.
- `audit_log` — quién impersonó qué tenant cuándo (Fase 7).

Decisión Fase 2: ¿usar Prisma con un segundo `schema-master.prisma`, o un cliente distinto sobre la misma BD? Recomendación: **una sola BD con dos schemas (`master` + `tenant_*`)**, dos modelos Prisma separados o un solo modelo con ambos schemas. Detalle en §10.

### 8.2 `tenant-resolution` (REFACTOR)

Lo que hoy hace `src/middleware.ts` se amplía. Se mueve / refactoriza:

- Middleware → resuelve `host` (extrae `slug`), busca en `tenants`, configura contexto.
- `src/lib/prisma.ts` → cliente "factory" que selecciona schema (`SET search_path` o pool por tenant).
- Auth callbacks → meten `tenantId` en JWT y validan que coincide con el host.
- Toda llamada `prisma.configuracionEmpresa.findFirst()`, `prisma.user.findUnique({ email })`, etc. **no cambia su sintaxis** si schema-per-tenant + `search_path`: la misma query opera en el schema correcto. Esto es el argumento fuerte para schema-per-tenant: minimiza el delta en el código del producto.

### 8.3 `billing` (NUEVO)

- Stripe SDK oficial.
- Webhooks `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
- Idempotencia con `stripe_event_id` en una tabla `stripe_events`.
- En el schema del tenant no entra Stripe; vive solo en el control plane.

### 8.4 `fichaje` (CASI INTACTO)

La lógica de fichaje, ausencias, turnos, tareas, comunicados, documentos, onboarding, bolsa de horas — **el 90% se queda igual**. Lo único que cambia es:

1. La conexión Prisma apunta al schema correcto (transparente vía middleware).
2. Las constraints `@unique` globales (email, dni) pasan a ser por schema, lo cual es automático.
3. Los `findFirst()` sobre `ConfiguracionEmpresa` siguen funcionando porque cada schema tiene su propia fila singleton.
4. `runMigrations()` desaparece — lo sustituye `tenants:migrate <slug>` con migraciones Prisma reales.

Cambios cosméticos: retirar strings hardcoded, neutralizar fallbacks de branding, parametrizar manifest por tenant.

### 8.5 `super-admin` (NUEVO, en parte derivado)

- Vive bajo `admin.ficha.tecnocloud.es`. Auth completamente independiente del Credentials provider de los tenants (`super_admins` table en control plane, JWT con `aud: "platform"`).
- Reusa componentes UI del dashboard de admin actual (Radix + Tailwind), pero apunta a queries del control plane, no a un schema de tenant.
- Funciones de impersonación: emite un JWT efímero con `tenantId` + `actingAs` y cookie scoped al subdominio del tenant.

### 8.6 Qué se duplica vs comparte

| Asset | Compartido (plataforma) | Por tenant (schema) |
|---|---|---|
| Plantillas de email transaccional (invitación, bienvenida, recuperación) | Sí, en `src/lib/email-templates.ts` con vars (`appNombre`, `colorPrimario`) | No |
| Templates de email de marketing (newsletter, anuncios) | Sí | No |
| Branding (logo, colores, favicon) | No | Sí (en `ConfiguracionEmpresa` del schema) |
| Festivos | Hoy por empresa. **Decisión**: convertir festivos nacionales/CCAA en "catálogo de plataforma" + festivos locales por tenant. | Mixto |
| Tipos de ausencia | Por tenant (cada uno los suyos) | Sí |
| Plantillas de onboarding (`PlantillaTareaOnboarding`) | Por tenant | Sí |
| VAPID keys push | **Decisión**: globales (recomendado, ver §4) | No |
| Resend API key | Mixta: una global de plataforma para emails de plataforma; cada tenant puede meter la suya en `ConfiguracionEmpresa.resendApiKey` para emails con su dominio | Mixto |

---

## 9. Plan de cutover del despliegue actual

Pasos secuenciales. Cada paso con su rollback. **Pre-condición global**: snapshot de la BD antes de cada paso (Dokploy → Postgres → backup, o `pg_dump`).

### Paso 0. Baseline de migraciones (pre-trabajo, antes de Fase 2)

- Estado actual: BD viva con N tablas, 0 migraciones Prisma.
- Acción: en la rama `feature/saas-migration`, generar `prisma migrate dev --name baseline --create-only`, revisar el SQL, ejecutar `prisma migrate resolve --applied baseline` contra la BD de producción para registrar la migración como aplicada sin reejecutarla.
- Resultado: `prisma/migrations/0000_baseline/migration.sql` existe y la `_prisma_migrations` table queda en sync. A partir de aquí cualquier cambio nuevo es una migración nueva.
- Rollback: borrar `prisma/migrations/0000_baseline/`. La BD no se ha tocado.
- Riesgo: si hay drift entre `schema.prisma` y la BD viva (probable, dado el `runMigrations()` lazy), el `migrate dev` lo detectará. Resolverlo con `migrate diff` antes de generar la baseline.

### Paso 1. Crear control plane

Decisión previa: **una DB con dos schemas** (recomendado, ver §10) o dos DBs separadas.

- Si una DB: `CREATE SCHEMA master;` en la Postgres del proyecto Dokploy. Generar `prisma generate` con un segundo modelo `prisma/master.prisma` o usar el mismo con `@@map` por schema (Prisma 7 lo soporta vía multi-schema preview).
- Si dos DBs: provisionar nueva DB en el mismo Postgres (Dokploy → Database → Add). Variable `MASTER_DATABASE_URL`.
- Aplicar migración inicial del control plane (tablas de §8.1) + seed de `plans` y `features`.
- Rollback: `DROP SCHEMA master CASCADE` (o drop DB).

### Paso 2. Migrar el cliente actual a su primer tenant

- Crear schema `tenant_<slug>` (slug propuesto: el del primer cliente real, p.ej. `tenant_telecom` o `tenant_acme`).
- Mover datos del schema `public` al schema `tenant_<slug>`. Opciones:
  - (A) `pg_dump --schema=public --no-owner` + sed para reescribir referencias a `public.` → `tenant_<slug>.` + `psql` restore. Coste alto.
  - (B) `ALTER SCHEMA public RENAME TO tenant_<slug>;` + `CREATE SCHEMA public;`. Coste bajo, pero rompe cualquier cosa que dependa del nombre `public`. **Recomendado** si la app va a estar parada durante el cutover.
- Insertar en `master.tenants` el registro correspondiente (`schema_name = 'tenant_<slug>'`, `status = 'active'`, plan provisional gratis).
- Insertar en `master.super_admins` la cuenta de la plataforma (tú).
- Rollback: `ALTER SCHEMA tenant_<slug> RENAME TO public;` + drop master.

### Paso 3. Configurar wildcard DNS y TLS

Depende de **ADR-005** (decisión TLS A/B/C).

- Si A (Cloudflare): cambiar NS de `ficha.tecnocloud.es` a Cloudflare, dejar el resto en paginalia. Crear `*` A record apuntando a la IP del VPS. Configurar Traefik (Dokploy) con plugin Cloudflare DNS-01 para emitir wildcard. Verificar emisión.
- Si B (HTTP-01 por subdominio): añadir A record `*` apuntando al VPS. En Dokploy registrar el subdominio del primer tenant (`telecom.ficha.tecnocloud.es`) y emitir cert HTTP-01. Cada nuevo tenant requiere un nuevo dominio en Dokploy → API o manual.
- Si C (wildcard manual): generar wildcard cert con `certbot --manual --preferred-challenges dns` y subirlo a Dokploy. Renovación cada 90 días.

Rollback: ninguno necesario, los cambios DNS son aditivos hasta el switch del Paso 5.

### Paso 4. Activar middleware de resolución por subdominio en deploy paralelo

- Crear una segunda app en Dokploy temporal (`fichaje-saas-staging`) apuntando a la misma BD pero a la rama `feature/saas-migration` ya con el código multi-tenant.
- Probar `telecom.ficha.tecnocloud.es` accediendo al schema del primer tenant.
- Probar `admin.ficha.tecnocloud.es` (panel super-admin).
- Probar `nuevo-tenant.ficha.tecnocloud.es` con un schema vacío de prueba.

Rollback: borrar la app temporal. La app productiva original sigue sirviendo `ficha.tecnocloud.es`.

### Paso 5. DNS switch / mantener `ficha.tecnocloud.es`

Dos opciones para el dominio raíz:

- (a) Redirigir `ficha.tecnocloud.es` → `telecom.ficha.tecnocloud.es` (server-side 308 desde el middleware) — **recomendado** durante 30-90 días para no romper bookmarks/PWA del cliente actual.
- (b) Convertir el raíz en landing/registro inmediatamente.

Cambiar el routing de Dokploy para que la app multi-tenant atienda tanto `ficha.tecnocloud.es` como `*.ficha.tecnocloud.es`. Apagar la app monotenant antigua (mantenerla parada, no borrada, durante una semana).

Rollback: re-encender la app antigua, revertir el routing en Traefik. La BD está intacta porque ambos apuntan al mismo schema.

### Paso 6. Backups antes de cada paso

- Antes de paso 1, 2 y 5: `pg_dump --format=c` de toda la BD a un volumen del VPS y a un bucket fuera del VPS (S3 / Backblaze). Sin backup off-VPS, **no se ejecuta el paso**.
- Establecer `pg_dump --schema=tenant_<slug>` por tenant como nueva rutina diaria post-cutover.

### 9.1 Decisiones que dependen de ADR-005 y por qué

| Decisión | Depende de ADR-005 | Motivo |
|---|---|---|
| Si se puede emitir wildcard automático | Sí | Solo opción A o C lo permiten. B fuerza emisión por subdominio. |
| Cuándo se publica el primer tenant | Sí | Si B, hay que registrar `telecom.ficha.tecnocloud.es` en Dokploy antes del switch. Si A, basta con el wildcard. |
| Ritmo de altas | Sí | Con B hay rate limit Let's Encrypt (50 certs/semana por dominio raíz). Si esperamos 10-100 tenants en 12 meses, B es ajustado pero suficiente, salvo picos de onboarding. |
| Coste operativo a futuro | Sí | A (Cloudflare) es free tier para DNS, requiere un cambio de NS one-time. B fuerza tocar Dokploy en cada alta. C fuerza renovación manual cada 90 días. |

Recomendación: **A** (delegar zona a Cloudflare). Argumentos en §10.

---

## 10. Decisiones donde la propuesta de la spec puede no encajar

### 10.1 Schema-per-tenant vs shared schema con `tenant_id`

**A favor de schema-per-tenant** (lo que propone la spec):

- GDPR trivial: `DROP SCHEMA tenant_x CASCADE`.
- Backups por tenant: `pg_dump --schema=tenant_x`.
- Aislamiento real (no depende de WHERE).
- En el código del producto **no hay que añadir `tenantId` a 50 queries** — se resuelve por `search_path`. Esto es el argumento decisivo dado el estado del repo: hay decenas de queries y migrar todas a un `where: { tenantId }` es propenso a errores y crea riesgo de fuga si alguno se cuela.

**En contra**:

- Migraciones DDL hay que aplicarlas a N schemas (script `tenants:migrate:all`).
- Pool de conexiones: con muchos schemas conviene `SET search_path` por request reusando un solo pool (no `?schema=` que crearía un cliente Prisma por tenant, agotando conexiones).
- Pgbouncer en transaction mode interactúa raro con `SET search_path` — habría que cuidar `RESET` al final de la request, o usar session pooling.
- 100 schemas con 19 tablas cada uno = 1900 tablas. Postgres lo aguanta, pero `pg_class` y catálogos crecen; algunos clientes (DataGrip, dbeaver) se ralentizan.

**A favor de shared schema con `tenant_id`**:

- Una sola tabla `users`, una sola migración, una sola consulta de "todos los empleados de todos los tenants" para informes globales sin foreign data wrappers.
- Más sencillo si esperas escalar a miles de tenants.

**En contra**:

- Cada query necesita `tenantId`. RLS como segunda barrera es deseable (pero el código del repo no la usaría hoy porque Prisma no setea `current_setting('app.tenant_id')` automáticamente).
- Backups y GDPR delete son complejos (`DELETE FROM ... WHERE tenant_id = ...` × 19 tablas, en orden).

**Recomendación para este caso (10-100 tenants en 12 meses)**: **schema-per-tenant**. El volumen es perfectamente asumible y el delta sobre el código actual es mucho menor (no hay que añadir `tenantId` a las queries).

### 10.2 Una DB con muchos schemas vs dos DBs separadas

**Una DB con `master` + `tenant_*`**:

- Reaprovecha el Postgres ya provisionado en Dokploy (la spec lo pide explícitamente).
- Backups y restores en una sola unidad.
- Transacciones cross-schema posibles (útil para operaciones de provisión: crear tenant + insertar en `master.tenants` en una transacción).
- Pgbouncer único.

**Dos DBs (`fichaje_master` + `fichaje_app`)**:

- Aislamiento más fuerte (un acceso a la app no toca control plane).
- Escalado independiente futuro: el control plane puede moverse a otro Postgres si crece.
- Conexiones separadas → más esfuerzo de pooling.
- Imposibles las transacciones cross-DB sin 2PC.

**Recomendación**: **una DB**, `master` + `tenant_*`. Conviene aislar control plane con un usuario Postgres distinto (`grant usage on schema master to master_role`) para que la app del producto no tenga permisos sobre `master`. Si en 18 meses hace falta escalar, separar en dos DBs es un día de trabajo.

### 10.3 `SET search_path` por request vs connection pool por tenant

**`SET search_path`**:

- Un solo pool, una sola `connectionString`. Eficiente.
- Necesita `RESET` al final de cada request (o confiar en que la siguiente request lo sobreescriba — riesgo si comparten conexión sin reset y un endpoint olvida llamar al middleware).
- Compatible con session pooling de pgbouncer; **no** con transaction pooling sin cuidado.

**Pool por tenant**:

- Aislamiento total entre tenants a nivel de conexión.
- Coste de conexiones se multiplica por número de tenants. Con 100 tenants y 5 conexiones cada uno, son 500 conexiones — Postgres aguanta pero hay que dimensionar.
- Más sencillo de razonar: una request del tenant X siempre usa el pool X.

**Recomendación**: **`SET search_path`** con un único pool, dado el volumen previsto. Implementar como middleware Prisma (`$extends({ query })`) que ejecuta `SET search_path TO tenant_<slug>` al inicio de cada query y RESET al final. Documentar que pgbouncer debe estar en **session pooling**, no transaction pooling.

### 10.4 Redis para caché host→tenant: ¿desde día 1?

**A favor de día 1**:

- Cache hit de tenant resolution sin tocar Postgres.
- Si se monta worker para webhooks Stripe (Fase 4), Redis es la opción evidente para queue (BullMQ).

**En contra**:

- Servicio adicional en Dokploy → más superficie de fallos, más backups.
- Para 10-100 tenants una caché in-memory por instancia con TTL 60s sirve sobradamente. Postgres con índice en `tenants.slug` resuelve en <1ms.

**Recomendación**: **no** desde día 1. Caché in-memory por instancia (Map con TTL). Cuando llegue el momento del worker o cuando crucemos N instancias y veamos thundering herd, montar Redis. Documentarlo como TODO en el ADR-002.

### 10.5 Renombrado de `Rol.SUPERADMIN` → `OWNER`

**A favor de hacerlo en Fase 0/1**:

- Cuanto antes, menos código que tocar.
- Evita que cualquier check `rol === "SUPERADMIN"` se confunda con super-admin de plataforma cuando aparezca.
- La migración Prisma de un valor de enum es bien soportada en Postgres (`ALTER TYPE … RENAME VALUE`).

**A favor de hacerlo en Fase 4 (cuando llegue Auth multi-tenant)**:

- Menos churn ahora.

**Recomendación**: **renombrar en Fase 1** como parte del trabajo de ADRs (no es solo cosmético, es semántico). Cambio sugerido:

```
enum Rol {
  OWNER       # antes SUPERADMIN — admin del tenant
  MANAGER
  EMPLEADO
}
```

Y en el control plane, el super-admin de plataforma vive en otra tabla (`super_admins`) con su propio enum `PlatformRol { SUPER_ADMIN, SUPPORT }`.

### 10.6 Sistema de migraciones: ¿forzar `prisma migrate dev` ya?

**Opciones**:

- (a) Mantener `db:push` para el control plane, `migrate` para schemas de tenant. Inconsistente pero rápido.
- (b) Migrate para todo. Más código, más control.
- (c) Quedarse con `db:push` y `runMigrations()` lazy. **Descartado** — es el problema actual.

**Recomendación**: (b). Antes de Fase 2:

1. Generar baseline (Paso 0 de §9).
2. A partir de ahí: `prisma migrate dev` para cualquier cambio en `schema.prisma`. Las migraciones se aplican con `prisma migrate deploy` en arranque del contenedor (entrypoint nuevo).
3. Para schemas de tenant: comando CLI `tenants:migrate <slug>` que setea `search_path` y aplica `migrate deploy` apuntando al schema del tenant. Las mismas migraciones (mismos `.sql`) corren en todos los schemas. Esto es lo que la Fase 3 de la spec ya pide.

Eliminar `src/lib/migrate.ts` cuando todo el DDL viva en `prisma/migrations/`.

---

## 11. Catálogo inicial de planes y features

Sección añadida tras Fase 0 a partir de la propuesta acordada con el usuario
(las líneas 167-168 de la spec maestra piden "una lista concreta basándote en
lo que sea típico en un SaaS de fichaje"). El catálogo siguiente es el que
seedearemos en `master.plans`, `master.features` y `master.plan_features`
durante la Fase 2.

### 11.1 Tipos de feature

| Tipo      | Definición                                                         | Ejemplo de check en código                                |
|-----------|--------------------------------------------------------------------|-----------------------------------------------------------|
| `boolean` | enable/disable. La feature está o no.                              | `tenant.hasFeature('export_csv')` → `true`/`false`        |
| `limit`   | tope numérico estático verificado puntualmente (sin reset).        | `tenant.getLimit('max_employees')` → `50`; al crear el 51 → `402` |
| `quota`   | contador con periodo de reset (mensual o diario). Suma incremental.| `tenant.consumeQuota('emails_mes', 1)` → `ok`/`402` si excede; reset en `current_period_end` |

`null` = ilimitado (`unlimited`).

### 11.2 Funcionalidad CORE no desactivable

Antes del catálogo: hay funcionalidad que **NO** se gestiona vía feature flag,
porque es requisito legal o requisito mínimo del producto.

| Función                  | Por qué es CORE                                                                                                                              |
|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| `registro_jornada_legal` | Real Decreto-ley 8/2019: las empresas españolas están obligadas a llevar un registro diario de jornada de cada trabajador, con hora de inicio y fin, conservado 4 años. Es el núcleo del producto y la razón legal por la que un cliente compra fichaje. **No puede vivir como feature flag** — un tenant en plan Starter sigue teniendo obligación legal de registro de jornada. |

Implicación de diseño: las tablas `Fichaje`, `Turno` (parcialmente, para
jornada planificada) y la posibilidad de exportar el registro a un formato
legible **no se chequean nunca con `hasFeature`**. El check `hasFeature` se
aplica solo al cómo (geofencing, fichaje móvil, exportación a CSV/Excel,
notificaciones), no al qué (existencia del registro).

Lo mismo aplica a la consulta del registro propio por el empleado (también
exigida por el RD): no se puede ocultar tras un plan.

### 11.3 Catálogo de features

**Boolean — funcionalidad**:

- `multi_tienda` — habilita >1 tienda en el tenant.
- `geofencing` — fichaje validado por GPS / radio. En Starter limitado a 1
  ubicación (la única tienda permitida); en Pro/Enterprise se aplica por tienda
  combinado con `multi_tienda`.
- `fichaje_movil` — fichaje desde PWA / móvil del empleado.
- `fichaje_tablet` — fichaje desde tablet compartida en tienda.
- `bolsa_horas` — módulo de acumulación/consumo de horas.
- `turnos_publicacion` — planificación y publicación de turnos (no confundir
  con el registro legal de jornada, que es CORE).
- `ausencias_aprobacion` — flujo de aprobación (vs solo registro).
- `onboarding_offboarding` — procesos con plantillas.
- `comunicados` — módulo de comunicados internos.
- `articulos` — base de conocimiento.
- `documentos` — gestión documental por empleado.
- `notificaciones_email` — emails (vía SMTP/Resend de plataforma o propio del tenant).
- `notificaciones_push` — push web/móvil.

**Boolean — exportación e integración**:

- `export_csv`, `export_excel`, `export_pdf`. (Nota: el export del registro
  legal de jornada en formato exigido por inspección está en CORE; estos flags
  controlan exports adicionales: informes, listados, etc.)
- `api_access` — REST pública con tokens.
- `webhooks` — webhooks salientes.
- `integraciones_nomina` — conectores (a3, sage, datev…).
- `firma_electronica` — firma de documentos.

**Boolean — branding y operaciones**:

- `branding_personalizado` — logo, colores, app_nombre.
- `dominio_personalizado` — CNAME custom (no `<slug>.ficha.tecnocloud.es`).
- `auditoria_avanzada` — log de auditoría detallado (impersonación, cambios sensibles).
- `people_analytics` — analítica avanzada.
- `evaluaciones`, `objetivos` — futuros (hoy "Próximamente" en sidebar).

**Limit (tope estático)**:

- `max_employees` — usuarios activos.
- `max_tiendas` — tiendas activas.
- `historial_meses` — meses de fichajes/ausencias accesibles desde la UI
  (sobre el dato base; el almacenamiento sigue 4 años por requisito legal).
- `max_storage_mb` — almacenamiento de documentos/fotos.

> **Nota sobre `max_owners`**: descartado como feature vendible. El número de
> cuentas con rol `OWNER` por tenant se hardcodea en código a un máximo
> operativo de **5** para evitar pérdida del tenant si el OWNER único se da de
> baja, pero no se monetiza ni se expone como flag.

**Quota (con reset)**:

- `emails_mes` — emails enviables/mes (si la plataforma cubre el envío).
- `pushs_mes` — notificaciones push/mes.
- `exports_mes` — número de exportaciones de informes/mes (no aplica al
  export del registro legal, que es ilimitado por requisito).
- `api_calls_dia` — rate limit API/día.

### 11.4 Mapping `starter` / `pro` / `enterprise`

Leyenda de la columna "Addon": ✅ disponible como producto Stripe adicional
contratable a mayores del plan base; ❌ no comercializado como addon (se
obtiene subiendo de plan).

| Feature                  | Tipo  | Starter      | Pro           | Enterprise | Addon |
|--------------------------|-------|--------------|---------------|------------|-------|
| `max_employees`          | limit | **10**       | **50**        | unlimited  | ❌    |
| `max_tiendas`            | limit | 1            | 5             | unlimited  | ❌    |
| `historial_meses`        | limit | 6            | 36            | 120        | ❌    |
| `max_storage_mb`         | limit | 500          | 5000          | 50000      | ✅ Pro |
| `multi_tienda`           | bool  | ❌           | ✅            | ✅         | ❌    |
| `geofencing`             | bool  | ✅ (1 ubic.) | ✅ por tienda | ✅ por tienda | ❌  |
| `fichaje_movil`          | bool  | ✅           | ✅            | ✅         | ❌    |
| `fichaje_tablet`         | bool  | ❌           | ✅            | ✅         | ❌    |
| `bolsa_horas`            | bool  | ❌           | ✅            | ✅         | ❌    |
| `turnos_publicacion`     | bool  | ❌           | ✅            | ✅         | ❌    |
| `ausencias_aprobacion`   | bool  | ✅           | ✅            | ✅         | ❌    |
| `onboarding_offboarding` | bool  | ❌           | ✅            | ✅         | ❌    |
| `comunicados`            | bool  | ✅           | ✅            | ✅         | ❌    |
| `articulos`              | bool  | ❌           | ✅            | ✅         | ❌    |
| `documentos`             | bool  | ✅           | ✅            | ✅         | ❌    |
| `notificaciones_email`   | bool  | ✅           | ✅            | ✅         | ❌    |
| `notificaciones_push`    | bool  | ❌           | ✅            | ✅         | ❌    |
| `branding_personalizado` | bool  | ❌           | ✅            | ✅         | ❌    |
| `dominio_personalizado`  | bool  | ❌           | ❌            | ✅         | ✅ Pro |
| `export_csv`             | bool  | ❌           | ✅            | ✅         | ❌    |
| `export_excel`           | bool  | ❌           | ✅            | ✅         | ❌    |
| `export_pdf`             | bool  | ✅           | ✅            | ✅         | ❌    |
| `api_access`             | bool  | ❌           | ❌            | ✅         | ✅ Pro |
| `webhooks`               | bool  | ❌           | ❌            | ✅         | ✅ Pro |
| `integraciones_nomina`   | bool  | ❌           | ❌            | ✅         | ✅ Pro |
| `firma_electronica`      | bool  | ❌           | ❌            | ✅         | ✅ Pro |
| `auditoria_avanzada`     | bool  | ❌           | ✅            | ✅         | ❌    |
| `people_analytics`       | bool  | ❌           | ❌            | ✅         | ✅ Pro |
| `emails_mes`             | quota | 200          | 5000          | unlimited  | ✅    |
| `pushs_mes`              | quota | 1000         | unlimited     | unlimited  | ❌    |
| `exports_mes`            | quota | 5            | 100           | unlimited  | ❌    |
| `api_calls_dia`          | quota | —            | —             | 10000      | ❌    |

### 11.5 Notas de diseño

- **Starter** está dimensionado como "panadería con 10 empleados, 1 local,
  con o sin GPS". Vendible barato y suficiente para validar el producto.
  Geofencing incluido (1 ubicación) porque es trivial activarlo y barato de
  servir cuando hay una sola tienda.
- **Pro** abre lo que diferencia un fichaje serio: geofencing por tienda,
  turnos, bolsa, notif push, branding, exportaciones. Es el plan al que
  apuntará la mayoría de clientes.
- **Enterprise** mete las integraciones que justifican un precio
  cualitativamente distinto: API, nóminas, firma, dominio propio, analytics.
- **Addons** monetizables: `dominio_personalizado`, `api_access`, `webhooks`,
  `integraciones_nomina`, `firma_electronica`, `people_analytics` y
  ampliaciones de `max_storage_mb` y `emails_mes`. Permiten a un tenant Pro
  pagar solo por lo que necesita sin saltar a Enterprise.
- **`max_owners`** no es feature: es un cap operativo en código (5).

---

## Anexo: discrepancias con el contexto pre-recopilado

| # | Pre-contexto decía | Realidad verificada | Acción |
|---|---|---|---|
| 1 | "~40 endpoints" | 46 archivos `route.ts` | Cosmético, lo dejo anotado. |
| 2 | "el repo trabaja con `db:push`" | `db:push` solo está en scripts de `package.json`. En producción **no se ejecuta nada en deploy**; las DDL viven en `src/lib/migrate.ts` y se aplican lazily en `GET /api/configuracion` y `PUT /api/configuracion/branding`. | Es **más grave** de lo que sugiere el contexto: hay drift latente entre `schema.prisma` y la BD viva. Ver §2.3 y Paso 0 del cutover. |
| 3 | (No mencionado) | Dockerfile usa `node:20-alpine` pero `package.json` exige `>=22` y `nixpacks.toml` declara `nodejs_22`. | Alinear a Node 22 en Fase 8. |
| 4 | "`@auth/prisma-adapter` instalado" | Está en `package.json` pero **no se usa** (NextAuth v5 con JWT puro, sin adapter). | Retirar o documentar como dependencia muerta. |
| 5 | "`socket.io` declarado" | Sin uso en código (`grep` no encuentra import ni `Server`). | Decidir Fase 5/6 o retirar. |
| 6 | "ConfiguracionEmpresa singleton" | Confirmado, pero el ancla es `id: "singleton"` literal en upserts (`src/app/api/configuracion/route.ts:17`, `:68`, `src/app/api/configuracion/branding/route.ts:52-53`, `src/app/api/push/generar-vapid/route.ts:17,19`). Importante para el plan de migración. | Documentado en §2 y §7. |
| 7 | "endpoints filtran por `tiendaId`" | Confirmado. Es scoping intra-tenant (multi-tienda dentro de una empresa), no protección entre tenants. | Coherente con §7. |

---

## Apéndice: archivos clave revisados

Lista no exhaustiva de los archivos efectivamente leídos durante esta auditoría:

- `package.json`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`, `prisma.config.ts`, `nixpacks.toml`, `Dockerfile`, `docker-compose.yml`, `DESPLIEGUE.md`, `README.md`, `.env.example`, `.gitignore`.
- `prisma/schema.prisma`, `prisma/seed.ts`.
- `src/middleware.ts`, `src/app/layout.tsx`, `src/app/manifest.ts`, `src/app/(dashboard)/layout.tsx`.
- `src/lib/auth.ts`, `src/lib/auth.config.ts`, `src/lib/prisma.ts`, `src/lib/email.ts`, `src/lib/notificaciones.ts`, `src/lib/push.ts`, `src/lib/migrate.ts`.
- `src/app/api/setup/route.ts`, `src/app/api/setup/reset/route.ts`, `src/app/api/empleados/route.ts`, `src/app/api/configuracion/route.ts`, `src/app/api/configuracion/branding/route.ts`, `src/app/api/configuracion/test-email/route.ts`, `src/app/api/branding/route.ts`, `src/app/api/branding/favicon/route.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/auth/set-password/route.ts`, `src/app/api/fichajes/route.ts`, `src/app/api/push/generar-vapid/route.ts`.
- Inventarios via `grep`/`find`: usos de `findFirst` / `configuracionEmpresa`, presencia de tests, presencia de migraciones, `process.env` referenciados, strings hardcoded de branding, presencia de `.github/workflows/`.

Fin del documento.
