# Plan de Fase 7 — Panel super-admin + master.audit_log

- **Estado**: APROBADO (auto-respuesta §15 modo turbo)
- **Fecha**: 2026-05-01
- **Estimación**: 12-18 commits, 1-2 días
- **Prerequisitos**: Fases 0-6 cerradas. ADR-007 APROBADO (commit anterior).

## 0. Objetivo

Materializar ADR-007: panel super-admin en `admin.<root>` con auth
dedicada + tabla `master.audit_log` + UI para operaciones del lifecycle.

## 1. Decisiones cerradas en ADR-007

Recap (no se discuten aquí, solo se implementan):

- **Subdominio**: `admin.<root>` con cookie scope dedicado.
- **Auth**: NextAuth instance separada con audience claim `aud=platform`.
- **Tabla audit**: `master.audit_log` con shape definitivo (§2.4).
- **Permisos**: `SUPER_ADMIN` (full) vs `SUPPORT` (lecturas + sus propias mutaciones).
- **Lista AUDIT_ACTIONS**: cerrada en `src/lib/admin/audit-actions.ts`.

## 2. Auth super-admin

### 2.1 Pages

```
src/app/(admin)/
├── layout.tsx              # Layout con header admin + nav
├── login/page.tsx          # Login email/password (sin NextAuth público)
├── dashboard/page.tsx      # Métricas globales
├── tenants/
│   ├── page.tsx            # Listado tenants
│   └── [slug]/
│       ├── page.tsx        # Detalle tenant
│       ├── features/page.tsx  # Editar features (manual_override)
│       └── purge/page.tsx     # Confirmación purge
├── audit-log/page.tsx
└── settings/page.tsx       # Cuenta del super-admin
```

`(admin)` es route group separado del `(dashboard)` (tenants).

### 2.2 Endpoints auth

| Endpoint | Verbo | Descripción |
|---|---|---|
| `/api/admin/login` | POST | Login email/pwd. Sets cookie `admin-session-token`. |
| `/api/admin/logout` | POST | Clear cookie. |
| `/api/admin/me` | GET | Info del super-admin actual. |

Cookie name distinto (`admin-session-token`) y atributos `Path=/api/admin; Domain=admin.<root>`.

### 2.3 Middleware

`withSuperAdmin(handler)`:
- Lee cookie `admin-session-token` → JWT con `aud=platform`.
- Verifica firma + expiry.
- Rechaza si `aud≠platform` (defensa contra cookies del tenant).
- Inyecta `currentSuperAdmin()` (similar a `currentTenant()`).
- Reusa `prismaMaster` para todas las queries.

`proxy.ts`: `kind=admin` ya existe (Fase 3 commit 8). El handler real
deja de devolver 503 y enruta al panel.

## 3. master.audit_log

### 3.1 Migración

```sql
CREATE TABLE master.audit_log (...)
```

Shape exacto en ADR-007 §2.4. Migración aditiva.

### 3.2 Helper de escritura

`src/lib/admin/audit.ts`:

```ts
export async function writeAuditEntry(args: {
  superAdminId: string;
  action: keyof typeof AUDIT_ACTIONS;
  targetKind: string;
  targetId: string;
  summary?: Record<string, unknown>;
  dumpPath?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void>;
```

Llamado desde cada handler que ejecute una `AUDIT_ACTIONS`. Severity
se infiere de la lista cerrada.

### 3.3 Visibilidad (ADR-007 §2.5)

`GET /api/admin/audit-log`:
- `info`: visible a todos.
- `warning`/`critical`: si rol=SUPER_ADMIN → todas; si rol=SUPPORT →
  solo las suyas.
- Detalle (`summary`, `dump_path`): solo SUPER_ADMIN o autor.

## 4. Operaciones del panel

### 4.1 Listar tenants

| Path | Verbos | Descripción |
|---|---|---|
| `/api/admin/tenants` | GET | Filtros: status, plan, fecha. Paginación. |

Acción: `tenants:list` (info).

### 4.2 Detalle tenant + métricas

| Path | Verbos | Descripción |
|---|---|---|
| `/api/admin/tenants/[slug]` | GET | Datos de master + count users/sedes/fichajes (consulta `tenant_<slug>`). |

Métricas: count User, count Tienda, count Fichaje (último mes), MRR
(de Subscription), quotas consumed actuales.

Acción: `tenants:read` (info).

### 4.3 Editar features (manual_override)

| Path | Verbos | Descripción |
|---|---|---|
| `/api/admin/tenants/[slug]/features` | GET | Listar features actuales del tenant. |
| `/api/admin/tenants/[slug]/features` | POST | Override manual: añadir o reemplazar feature con source='manual_override' + reason. |
| `/api/admin/tenants/[slug]/features/[key]` | DELETE | Quitar el override (vuelve a heredar de plan/addon). |

Solo `SUPER_ADMIN`. Acción: `tenant_features:override` (warning).

`reason` obligatorio (CHECK constraint con length≥10 ya existente en
ADR-003 §2.9).

### 4.4 Lifecycle: suspend / restore / purge

| Path | Verbos | Descripción |
|---|---|---|
| `/api/admin/tenants/[slug]/suspend` | POST | active → suspended. |
| `/api/admin/tenants/[slug]/restore` | POST | suspended → active. |
| `/api/admin/tenants/[slug]/purge` | POST | Pseudonymize o hard-delete (según `mode` body). Solo `deleted` status. |

`purge` requiere confirmación slug en body (typo del slug literal).

Acciones:
- `tenants:suspend` (warning)
- `tenants:restore` (warning)
- `tenants:purge:pseudonymize` (critical)
- `tenants:purge:hard-delete` (critical)

`purge` reusa la lógica del CLI existente (`tenants-purge.ts` —
TODO ADR-008 verificar si existe; si no, escribir).

### 4.5 Audit log viewer

| Path | Verbos | Descripción |
|---|---|---|
| `/api/admin/audit-log` | GET | Filtros: action, target, severity, super_admin_id, fecha. |

UI: tabla con paginación + filtros + drill-down a detalle.

Acción: `audit-log:list` (info, no auto-log para evitar recursión).

### 4.6 Métricas globales (dashboard)

| Path | Verbos | Descripción |
|---|---|---|
| `/api/admin/metrics` | GET | totals: tenants, status counts, MRR estimado, registros últimos 30d. |

Acción: `metrics:read` (info).

## 5. UI

### 5.1 Layout admin

`src/app/(admin)/layout.tsx`: solo se renderiza cuando `host = admin.<root>`. Sidebar con:
- Dashboard
- Tenants
- Audit log
- Settings

Sin branding del tenant — usa fija paleta admin (slate/zinc).

### 5.2 Páginas a implementar

| Página | Endpoint | Acción |
|---|---|---|
| `/login` | POST /api/admin/login | super-admin:login |
| `/dashboard` | GET /api/admin/metrics | metrics:read |
| `/tenants` | GET /api/admin/tenants | tenants:list |
| `/tenants/[slug]` | GET /api/admin/tenants/[slug] | tenants:read |
| `/tenants/[slug]/features` | GET/POST | tenant_features:override |
| `/tenants/[slug]/purge` | POST | tenants:purge:* |
| `/audit-log` | GET /api/admin/audit-log | audit-log:list |

## 6. Tests

Patrón obligatorio E2E (Fase 5 cierre). Setup: tenant_admin sembrado
con super-admin de prueba.

| Test | Cubre |
|---|---|
| `admin-auth.e2e.test.ts` | Login OK, login mal, JWT con aud=tenant rechazado |
| `admin-tenants-list.e2e.test.ts` | Filtros + paginación |
| `admin-feature-override.e2e.test.ts` | Override + DELETE + audit log entry |
| `admin-suspend-restore.e2e.test.ts` | Lifecycle ADR-008 |
| `admin-audit-log.e2e.test.ts` | Visibilidad por rol |
| `admin-purge.e2e.test.ts` | Confirmación slug + dump path |

## 7. Estructura de commits (12-18)

Auth + middleware (commits 1-3):
1. `feat(prisma): master.audit_log migración + AUDIT_ACTIONS catálogo`
2. `feat(admin): withSuperAdmin middleware + JWT aud=platform`
3. `feat(admin): /api/admin/login + /me + /logout + tests`

Operaciones (commits 4-9):
4. `feat(admin): GET /api/admin/tenants con filtros`
5. `feat(admin): GET /api/admin/tenants/[slug] + métricas`
6. `feat(admin): POST/DELETE /api/admin/tenants/[slug]/features (override)`
7. `feat(admin): POST suspend/restore endpoints`
8. `feat(admin): POST purge (pseudonymize + hard-delete) con confirmación`
9. `feat(admin): GET /api/admin/audit-log con filtros + visibilidad por rol`

UI (commits 10-13):
10. `feat(admin/ui): layout + login page`
11. `feat(admin/ui): dashboard métricas`
12. `feat(admin/ui): tenants list + detail`
13. `feat(admin/ui): feature override + audit log viewer`

Cierre (commits 14-15):
14. `test: 6 E2E suite admin`
15. `docs(arch): cierre Fase 7 + criterios verificados`

## 8. Riesgos

### 8.1 Cookie scope multi-subdominio

Si `admin.<root>` y `<slug>.<root>` comparten parent domain, el
cookie con `Domain=.<root>` llega a ambos. **Mitigación**: cookie
`Path=/api/admin` + `Domain=admin.<root>` exacto (sin punto inicial)
+ aud=platform validado server-side. Doble defensa.

### 8.2 Prisma generate después de migración audit_log

Cliente Prisma necesita regenerar tras añadir `AuditLog`. Hacer en
el commit 1.

### 8.3 Audit log volumen

Lecturas (info) generan 1 row por request. En 1 año con 10 super-admins
× 100 req/día = ~365k filas. Manejable. Job de archivado Fase 9.

### 8.4 Impersonación

ADR-007 menciona impersonate como `critical`. Fase 7 lo deja como
TODO (Fase 9 o 10) — UI sin impersonate, solo visualización read-only.

## 9. Lo que NO se hace en Fase 7

- Impersonate de OWNER (TODO Fase 9-10).
- MFA para super-admin (Fase 9).
- Audit log archive job (Fase 9).
- Importar `[AUDIT]` históricos de stdout a BD (Fase 9 opcional).
- Métricas avanzadas (cohorts, funnels) — solo totals básicos.
- Webhooks Stripe re-disparar (Fase 9).

## 10. Criterios de aceptación

1. Super-admin sembrado con `npm run super-admin:create` puede login en
   `admin.localhost:3000/login`.
2. Cookie del tenant NO da acceso al panel (rechazo 401).
3. `GET /api/admin/tenants` lista los 2 tenants (dev + test1) con shape
   correcto.
4. POST manual_override en `tenant_features` aparece en BD + audit_log
   con severity=warning + reason persistido.
5. `POST suspend` cambia status a suspended; `restore` lo invierte;
   ambos auditados.
6. `audit-log` UI muestra las acciones recientes con filtros funcionales.
7. SUPER_ADMIN ve todas las warnings; SUPPORT solo las suyas.
8. tsc + vitest + eslint clean.
9. 6 E2E tests verde con Testcontainers.

## 11. Schema BD post-Fase 7

Master:
```diff
+model AuditLog {
+  id            String   @id @default(uuid()) @map("id")
+  superAdminId  String   @map("super_admin_id")
+  superAdmin    SuperAdmin @relation(fields:[superAdminId], references:[id])
+  action        String
+  targetKind    String   @map("target_kind")
+  targetId      String   @map("target_id")
+  severity      String   @default("info")
+  summary       Json     @default("{}")
+  dumpPath      String?  @map("dump_path")
+  ipAddress     String?  @map("ip_address")
+  userAgent     String?  @map("user_agent")
+  createdAt     DateTime @default(now()) @map("created_at")
+
+  @@index([superAdminId])
+  @@index([targetKind, targetId])
+  @@index([severity, createdAt])
+  @@index([createdAt])
+  @@map("audit_log")
+  @@schema("master")
+}

 model SuperAdmin {
+  auditLogs     AuditLog[]
 }
```

## 12. §15 Auto-respuesta (modo turbo)

### 12.1 ✅ Subdominio `admin.<root>` (no `/super-admin` path)
ADR-007 §3.1 ya cerrado.

### 12.2 ✅ Auth dedicada (no NextAuth con role)
ADR-007 §3.2.

### 12.3 ✅ Audit síncrono (no queue)
ADR-007 §3.3. Para Fase 7 aceptable, queue Fase 9 si crece.

### 12.4 ✅ Permisos binarios SUPER_ADMIN/SUPPORT
ADR-007 §3.4. Granularidad fina diferida.

### 12.5 ✅ Impersonate read-only o diferido
NO se implementa en Fase 7 (riesgo de auth complicada). Solo
visualización.

### 12.6 ✅ Cookie `admin-session-token` con `Path=/api/admin`
Doble defensa con `aud=platform`.

### 12.7 ✅ Migración aditiva de master.audit_log
Sin RLS por ahora. RLS Fase 9 si crece el riesgo.

### 12.8 ✅ Re-disparar webhook NO en Fase 7
Diferido Fase 9 — operación poco frecuente que requiere validación
adicional.

### 12.9 ✅ Tests E2E sin mocks (patrón Fase 5/6)
6 e2e en `src/tests/integration/admin-*.e2e.test.ts`.
