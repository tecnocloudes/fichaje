# Plan de Fase 6 — Configuración por tenant + branding + dominio custom

- **Estado**: APROBADO (auto-respuesta §15 — modo turbo, ver §15)
- **Fecha**: 2026-05-01
- **Estimación**: 15-20 commits, 1-2 días.
- **Prerequisitos cerrados**: Fase 5 (feature flags + bloque A) + FIX 1/2/3 estructurales.
- **ADRs base**: 002 (resolución tenant), 003 (billing), 004 (features), 005 (deployment), 008 (lifecycle).

## 0. Objetivo

Materializar tres bloques de configuración del tenant:

1. **Branding por tenant**: logo, favicon, nombre comercial, paleta de colores. UI editable bajo `branding_personalizado`.
2. **Configuración general**: zona horaria, festivos, política de ausencias, días laborables, tipos de ausencia. UI accesible a OWNER del tenant.
3. **Dominio personalizado**: campo `custom_domain` en `master.tenants` + verificación DNS (TXT record) + resolución del proxy. SSL diferido a Fase 8.

## 1. Decisiones cerradas en ADRs (recap)

- **ADR-002 §2.3**: `parseHost` clasifica hosts en `tenant|app|admin|apex|invalid`. Cualquier host fuera del root → `invalid`. Fase 6 amplía esto: hosts no-root pero registrados en `master.tenants.custom_domain` → `tenant`.
- **ADR-002 §2.5**: feature `dominio_personalizado` (boolean, addon). Sin la feature, los campos custom domain en BD están permitidos pero el tenant no puede usarlos en producción.
- **ADR-005 §3**: SSL custom domain via Cloudflare DNS-01 + Dokploy. Fase 8.
- **ADR-008**: lifecycle del tenant. Borrado de `custom_domain` al `purge` (irreversible).

## 2. Branding

### 2.1 Storage de imágenes

**Decisión**: `logo` y `favicon` en `ConfiguracionEmpresa` siguen como `String?` (campo VARCHAR/TEXT en BD), almacenando **data URL base64** (`data:image/png;base64,...`).

**Razones**:
- Multi-tenant schema-per-tenant: el filesystem requeriría una jerarquía `/uploads/<slug>/...` con risk de path traversal y backups dispersos.
- Cap actual 3MB (`MAX_IMAGE_BYTES` en `branding/route.ts`) es manejable para BD: `pg_dump` lo trata como cualquier otra fila, no requiere cron de cleanup de archivos huérfanos.
- En producción Postgres TOAST comprime automáticamente.
- Si en Fase 9 se llega a > 100 tenants × 3 MB × 2 imágenes = 600 MB, evaluar mover a S3-compatible (Cloudflare R2, MinIO).

**No se hace**: blob storage externo, CDN, lazy-load de imágenes.

### 2.2 Validación

`POST/PUT /api/configuracion/branding`:
- Cap 3 MB por imagen (existente).
- Formato: regex en data URL `^data:image/(png|jpeg|jpg|webp|svg\+xml|x-icon);base64,`.
- Si falla → 400 con `{error: "image_format_invalid", allowed: [...]}`.

### 2.3 Endpoints

| Método | Path | Auth | Feature gate | Descripción |
|---|---|---|---|---|
| GET | `/api/configuracion/branding` | session | ninguno (defaults siempre accesibles) | Devuelve logo/favicon/colores/appNombre. Ya existente — no tocar. |
| PUT | `/api/configuracion/branding` | OWNER | `branding_personalizado` | Modifica branding. Ya existente con feature gate. |

No hay endpoints nuevos: lo de Fase 5 es suficiente. Fase 6 añade **validación de formato** y **UI completa** (Tab "Branding" en `/admin/configuracion`).

### 2.4 UI

`/admin/configuracion` ya tiene Tab "Branding" (visible en `ADMIN_TABS`). Fase 6:
- Preview en vivo del logo/favicon (cliente carga blob en `<img>`).
- Color pickers para `colorPrimario` / `colorSidebar`.
- Validación cliente del tamaño antes de subir (avoid 400 redondo trip).
- `<FeatureGateClient feature="branding_personalizado" fallback={<UpsellCTA/>}>` envolviendo todo.

## 3. Configuración general

### 3.1 Campos nuevos en ConfiguracionEmpresa

Migración del producto (schema-tenant.prisma):

```prisma
model ConfiguracionEmpresa {
  // ... existentes ...
  zonaHoraria       String   @default("Europe/Madrid")
  diasLaborables    Int[]    @default([1, 2, 3, 4, 5])  // 0=Domingo, 6=Sábado
  ausenciasDefaults Json?    // { "vacaciones": 22, "personal": 3, ... }
}
```

Nota: el campo `zonaHoraria` SOLO se usa para mostrar fechas en UI/exports. **NO** lo conectamos con `computeCurrentPeriod` en Fase 6 (ese sigue en hora local del proceso, TODO N4 Fase 9). Documentar el gap.

### 3.2 Festivos — endpoints nuevos

Modelo `Festivo` ya existe. Fase 6 añade endpoints:

| Método | Path | Auth | Feature gate | Descripción |
|---|---|---|---|---|
| GET | `/api/festivos` | session | ninguno | Lista festivos del tenant. |
| POST | `/api/festivos` | OWNER | ninguno | Crea festivo. |
| DELETE | `/api/festivos/:id` | OWNER | ninguno | Elimina festivo. |

Festivos aplican a todos los planes (no requieren `branding_personalizado` ni similares). UI en pestaña nueva "Calendario" o dentro de "General".

### 3.3 Tipos de ausencia — endpoints

Modelo `TipoAusencia` ya existe. Endpoints:

| Método | Path | Auth | Feature gate | Descripción |
|---|---|---|---|---|
| GET | `/api/ausencias/tipos` | session | `ausencias_aprobacion` | Lista tipos. Ya parcialmente existente, verificar withFeature. |
| POST | `/api/ausencias/tipos` | OWNER | `ausencias_aprobacion` | Crea tipo. |
| PUT | `/api/ausencias/tipos/:id` | OWNER | `ausencias_aprobacion` | Edita. |
| DELETE | `/api/ausencias/tipos/:id` | OWNER | `ausencias_aprobacion` | Elimina (soft-delete con `activo=false`). |

### 3.4 Días laborables y política de ausencias por defecto

Editable en pestaña "General" de `/admin/configuracion`:
- Checkboxes Lun-Dom para `diasLaborables`.
- JSON editor (o tabla simple) para `ausenciasDefaults`.

Sin endpoint nuevo: PUT `/api/configuracion` ya existe (verificar) o se añade.

## 4. Dominio personalizado

### 4.1 Schema master

Migración:

```prisma
model Tenant {
  // ... existentes ...
  customDomain         String?   @unique @map("custom_domain")
  customDomainVerified Boolean   @default(false) @map("custom_domain_verified")
  customDomainToken    String?   @map("custom_domain_token")  // TXT record
}
```

`@unique` evita que dos tenants reclamen el mismo dominio. Index implícito por `@unique`.

### 4.2 Verificación DNS

Flow:
1. OWNER va a `/admin/configuracion/dominio`.
2. Introduce dominio (e.g. `fichaje.empresa.com`).
3. Sistema genera `customDomainToken` (UUID) y muestra:
   ```
   Añade este TXT record en tu DNS:
   _fichaje-verify.fichaje.empresa.com  TXT  "fichaje-verify=<token>"
   ```
4. OWNER click "Verificar":
   - `POST /api/configuracion/dominio/verify`.
   - Server hace `dns.promises.resolveTxt("_fichaje-verify.fichaje.empresa.com")`.
   - Si encuentra el token → `customDomainVerified=true`.
5. Una vez verificado, el dominio resuelve al tenant **solo si la feature `dominio_personalizado` está activa**.

### 4.3 Resolución en proxy

Modificar `parseHost` y `resolveTenant`:

- `parseHost` devuelve `{kind: "custom_domain_candidate", host}` si el host no coincide con root.
- `resolveTenant` consulta `master.tenants.customDomain = host AND customDomainVerified=true`. Si encuentra Y la feature está activa → `{kind: "tenant", ctx}`. Si no → `{kind: "invalid"}` (el comportamiento actual).

Caché:
- Reutilizar el cache existente keyed por host, TTL.

### 4.4 SSL — Diferido Fase 8

Sin SSL custom, el dominio funciona solo con HTTPS si el OWNER configura su propio cert vía Cloudflare proxy o un nivel intermedio. Para Fase 8, Dokploy + Cloudflare DNS-01 lo automatizan.

Documentar en UI: "El SSL para tu dominio se configura en Fase 8 (deployment). Hasta entonces, usa HTTPS del subdominio principal."

### 4.5 Endpoints

| Método | Path | Auth | Feature gate | Descripción |
|---|---|---|---|---|
| GET | `/api/configuracion/dominio` | OWNER | `dominio_personalizado` | Devuelve estado + token DNS. |
| POST | `/api/configuracion/dominio` | OWNER | `dominio_personalizado` | Registra dominio + genera token. |
| POST | `/api/configuracion/dominio/verify` | OWNER | `dominio_personalizado` | Verifica TXT record. |
| DELETE | `/api/configuracion/dominio` | OWNER | `dominio_personalizado` | Elimina dominio del tenant. |

## 5. Inventario de pantallas

| Path | Estado | Cambios Fase 6 |
|---|---|---|
| `/admin/configuracion` | Existente | Añadir tabs "Calendario" + "Dominio". Refactor "Branding" con preview en vivo. |
| `/admin/configuracion/dominio` | Nuevo (page dentro de tab) | UI custom domain + DNS instrucciones. |

No hay pages enteras nuevas en `(dashboard)` — todo cabe dentro del page existente.

## 6. Inventario de endpoints

Por bloque (resumen):

| # | Endpoint | Verbos | Feature gate |
|---|---|---|---|
| 1 | /api/configuracion/branding | GET, PUT | branding_personalizado (en PUT) |
| 2 | /api/festivos | GET, POST | — |
| 3 | /api/festivos/:id | DELETE | — |
| 4 | /api/ausencias/tipos | GET, POST | ausencias_aprobacion |
| 5 | /api/ausencias/tipos/:id | PUT, DELETE | ausencias_aprobacion |
| 6 | /api/configuracion | GET, PUT | — (ya existe?) |
| 7 | /api/configuracion/dominio | GET, POST, DELETE | dominio_personalizado |
| 8 | /api/configuracion/dominio/verify | POST | dominio_personalizado |

Total: 8 endpoints (algunos pre-existentes).

## 7. Tests

Patrón **OBLIGATORIO** (lección Fase 5 cierre): cada endpoint nuevo añade un test E2E con Testcontainers en `src/tests/integration/`. Sin mocks de la cadena auth/feature/quota.

| Test | Cubre |
|---|---|
| `branding-validation.test.ts` (unit) | Validación de formato data URL + cap 3MB |
| `festivos-crud.e2e.test.ts` | Festivos CRUD con tenant real |
| `tipos-ausencia-crud.e2e.test.ts` | Tipos ausencia CRUD con feature gate |
| `custom-domain.e2e.test.ts` | Registro + verificación DNS + resolución (mock dns.resolveTxt) |
| `parseHost-custom-domain.test.ts` (unit) | Tabla de hosts → kind correcto |
| `resolver-custom-domain.integration.test.ts` | resolver consulta master.tenants.customDomain |

## 8. Estructura de commits (15-20 estimados)

Bloque branding (commits 1-3):
1. `feat(api): validación formato data URL + cap en /api/configuracion/branding`
2. `feat(ui): preview en vivo + color pickers en tab Branding`
3. `test(branding): unit + e2e validación`

Bloque general (commits 4-7):
4. `feat(prisma): zonaHoraria + diasLaborables + ausenciasDefaults en ConfiguracionEmpresa (migración)`
5. `feat(api/configuracion): GET/PUT /api/configuracion para campos generales`
6. `feat(api/festivos): CRUD endpoints + tests E2E`
7. `feat(api/ausencias/tipos): refactor PUT/POST con withFeature + tests E2E`

Bloque dominio (commits 8-13):
8. `feat(prisma): customDomain + customDomainVerified + customDomainToken en master.tenants (migración)`
9. `feat(host): parseHost reconoce hosts no-root como custom_domain_candidate + tests`
10. `feat(resolver): resolveTenant consulta master.tenants.customDomain + tests`
11. `feat(api/configuracion/dominio): GET/POST/DELETE + generación token + tests E2E`
12. `feat(api/configuracion/dominio/verify): DNS lookup TXT + tests E2E`
13. `feat(ui): tab Dominio en /admin/configuracion`

Bloque UI configuración (commits 14-15):
14. `feat(ui): tab Calendario (festivos + diasLaborables + politicas)`
15. `feat(ui): integración con useFeatures + UpsellCTA en branding/dominio`

Cierre (commits 16-18):
16. `test: feature-coverage actualizada (custom_domain ya no deferred)`
17. `chore: actualizar AGENTS.md con flujo custom domain`
18. `docs(arch): cierre Fase 6 con criterios verificados`

## 9. Riesgos identificados

### 9.1 Custom domain + auth NextAuth

NextAuth requiere `NEXTAUTH_URL` o `AUTH_URL` consistente. Con custom domain, los tokens emitidos en `tenant.host` no son válidos en `empresa.com`. **Mitigación**: Fase 6 deja documentado que el OWNER debe usar su dominio custom desde el primer login (no migrar sesiones). Los emails de invitación incluyen el dominio custom si está verified.

### 9.2 Validación DNS bloqueante

`dns.promises.resolveTxt` puede tardar en propagación DNS (segundos a minutos). **Mitigación**: timeout 5s; UI dice "puede tardar hasta 24h en propagar". Botón "Reintentar" en frontend.

### 9.3 Caché de resolveTenant pollutante

Si OWNER cambia `custom_domain`, el cache antiguo persiste hasta TTL. **Mitigación**: invalidación explícita en POST/DELETE de `/api/configuracion/dominio` — llamar `invalidateTenantHostCache(host)`.

### 9.4 Conflicto de dominios

Dos OWNERs reclaman el mismo dominio. UNIQUE constraint protege, pero el segundo solo ve "dominio ya en uso" sin pista. **Mitigación**: documentar el flow de transferencia (Fase 7 panel super-admin lo automatizará).

### 9.5 Schema BD migration risk

Dos migraciones Prisma necesarias:
- `prisma/migrations/` (master): añade `customDomain*` a `tenants`.
- `prisma/migrations-tenant/` (producto): añade `zonaHoraria`, `diasLaborables`, `ausenciasDefaults` a `ConfiguracionEmpresa`. Se aplica con `tenants:migrate:all` a cada `tenant_<slug>`.

**Mitigación**: ambas migraciones son **aditivas** (campos nuevos con defaults). Backward-compatible.

## 10. Lo que NO se hace en Fase 6

- SSL custom domain (Fase 8).
- Multi-idioma (i18n) — sigue español hardcoded.
- Importación masiva de festivos (CSV de calendarios oficiales).
- Templates de email per-tenant (Fase 7 si se demanda).
- Integración con Google/Outlook calendars.
- Editor de plantillas de informes.

## 11. Criterios de aceptación

1. ✅ tenant_dev puede subir un logo y favicon, verlos en su sidebar tras refresh.
2. ✅ tenant_dev sin `branding_personalizado` ve UpsellCTA y NO puede llamar PUT.
3. ✅ tenant_dev puede crear un festivo "1 mayo" y verlo en una lista.
4. ✅ POST /api/festivos con tenant_dev OWNER → 201; con EMPLEADO → 403.
5. ✅ tenant_dev sin `dominio_personalizado` no ve la pestaña Dominio (FeatureGateClient).
6. ✅ tenant_dev con `dominio_personalizado` puede registrar `dev.example.com` y obtener un TXT token.
7. ✅ Tras añadir el TXT record en DNS real (mockeado en tests), POST /verify → 200 + verified=true.
8. ✅ Acceder a `dev.example.com` resuelve al tenant correcto (test integration con mock dns).
9. ✅ Si `dominio_personalizado` se desactiva tras verificar, el dominio deja de resolver.
10. ✅ test:feature-coverage verde.
11. ✅ tsc + vitest + eslint clean.

## 12. Coexistencia con Fase 5 (test1 / dev)

- tenant_test1 (Starter sin `branding_personalizado`): UI muestra UpsellCTA en branding. PUT devuelve 402.
- tenant_dev (Starter): igual.
- Para verificar Fase 6 manualmente, el operador puede invocar:
  ```sql
  UPDATE master.tenant_features SET value='true'::jsonb 
  WHERE feature_key='branding_personalizado' 
    AND tenant_id IN (SELECT id FROM master.tenants WHERE slug='dev');
  ```
  Sin invalidar caché del resolver, hay que reiniciar el dev server (TODO N6).

## 13. TODO N6 (cierre Fase 6)

Anotar al cerrar: invalidación del cache de `currentTenant().features` cuando se modifica directamente en BD (sin pasar por Stripe webhook). Hoy el cache sobrevive 5 min (config). Considerar TTL más corto o invalidación pub/sub.

## 14. Migración BD — protocolo

Antes de aplicar cualquiera de las dos migraciones:
1. Ejecutar `prisma validate` (master + tenant).
2. Generar la migración con `npx prisma migrate dev --name <nombre>`.
3. Aplicar primero al schema master (control plane) con `npx prisma migrate deploy`.
4. Aplicar a tenants existentes con `npm run tenants:migrate:all`.
5. Verificar con un INSERT/SELECT manual en `tenant_dev`.

Las migraciones de producto son aditivas (todos los campos nuevos con defaults). Sin riesgo de pérdida de datos.

## 15. Puntos a confirmar — RESPUESTAS AUTO (modo turbo)

Operador autorizó modo turbo: respondo yo basado en ADRs + plan + Fase 5 confirmado.

### 15.1 ✅ Storage de logo/favicon: data URL base64 en BD
- **Razón**: simple, multi-tenant safe, backups consistentes, cap 3 MB asumible.
- **Reversible**: si en Fase 9 escala mal, mover a S3-compatible es transparente para clientes (la columna pasa a guardar URL).

### 15.2 ✅ Validación de formato: regex en data URL
- Aceptados: png, jpeg, webp, svg+xml, x-icon (favicon).
- 400 con shape `{error, allowed}`.

### 15.3 ✅ Custom domain: campo `String?` con `@unique` en master.tenants
- 3 columnas nuevas: `custom_domain`, `custom_domain_verified`, `custom_domain_token`.
- Migración aditiva, backward-compatible.

### 15.4 ✅ Verificación DNS: TXT record con prefijo `_fichaje-verify.<dominio>`
- Token UUID v4, regenerable.
- Timeout 5s.

### 15.5 ✅ SSL custom domain diferido a Fase 8
- Dokploy + Cloudflare DNS-01.
- Documentado en UI.

### 15.6 ✅ resolveTenant consulta master.tenants.customDomain solo si feature activa
- Aunque el dominio esté verificado, si la feature `dominio_personalizado` se desactiva (downgrade plan, expira addon), el dominio deja de resolver.
- El sub-dominio principal (`<slug>.host`) sigue resolviendo siempre (CORE).

### 15.7 ✅ zonaHoraria es solo display
- NO conectada con `computeCurrentPeriod` en Fase 6 (TODO N4 Fase 9).
- Documentar gap explícitamente en cierre.

### 15.8 ✅ ausenciasDefaults como JSON
- Schema flexible: `{ "vacaciones": 22, "personal": 3, "asuntos_propios": 6 }`.
- Validación: keys must match `tipoAusencia.nombre` lowercased.

### 15.9 ✅ diasLaborables como Int[] (0-6)
- Postgres array nativo.
- 0=Domingo, 1=Lunes, ..., 6=Sábado.
- Default `[1,2,3,4,5]` (Lun-Vie).

### 15.10 ✅ Tests E2E patrón Fase 5 obligatorios
- Cada endpoint nuevo en su test file en `src/tests/integration/<dominio>.e2e.test.ts`.
- Sin mocks de auth/feature/quota.

## 16. Resumen ejecutivo

3 bloques (branding refinado, configuración general, custom domain) en 15-20 commits. 2 migraciones BD aditivas. 8 endpoints. 5-6 tests E2E nuevos. Coherente con ADR-002 §2.5, ADR-005 §3, ADR-008 lifecycle. Tras cierre, Fase 7 (panel super-admin) puede arrancar.
