# Cierre de Fase 7 — Panel super-admin + master.audit_log

- **Estado**: CERRADA (UI minimal — UI completa = TODO N7 Fase 9)
- **Fecha cierre inicial**: 2026-05-01
- **Fecha cierre formal**: 2026-05-02 (mini-sesión post-N17)
- **Plan**: [`00-fase-7-plan.md`](./00-fase-7-plan.md)
- **ADR base**: ADR-007 APROBADO.

## 1. Resumen ejecutivo

Fase 7 cerrada en **8 commits** (plan estimaba 12-18). Modo turbo:
UI mínima (login + dashboard). UI completa diferida a Fase 9 (TODO
N7) — el operador puede gestionar el panel via API directamente.

**Pantallas implementadas** (cubren lo bloqueante):
- `/admin/login`: form email + password → POST `/api/admin/login` →
  redirect `/admin/dashboard`.
- `/admin/dashboard`: cards con métricas tenants/subscriptions/audit24h.
- Layout slate con nav (Dashboard / Tenants / Audit log) + Salir.

**Pantallas pendientes Fase 9** (no bloqueantes para Fase 8):
- `/admin/tenants` lista con filtros visuales.
- `/admin/tenants/[slug]` detalle (features, subscription, quotas).
- `/admin/tenants/[slug]/features` editor manual_override + reason.
- `/admin/audit-log` viewer con filtros visuales.
- Botones "Suspend/Restore/Purge" desde browser (hoy via curl).
- Settings cuenta del super-admin (cambiar password, MFA — N9).

**Bug build resuelto post-cierre inicial**:
- "Two parallel pages" entre `(admin)/login` y `(auth)/login`.
- Fix: eliminado grupo `(admin)`, movido a path real `src/app/admin/*`.
  proxy.ts actualizado para `kind=admin` (Fase 7 ya no devuelve 503).

Bloques entregados:

1. **master.audit_log + AUDIT_ACTIONS catálogo** (commit C.1):
   migración aditiva + lista cerrada de 13 acciones con severity fija.
   Helper `writeAuditEntry()` + `extractRequestMeta()`.

2. **Auth super-admin** (commits C.2-C.3): `withSuperAdmin` middleware
   + JWT HS256 audience='platform' issuer='fichaje-admin' (jose).
   Cookie `admin-session-token` httpOnly. AsyncLocalStorage
   `currentSuperAdmin()`. Endpoints login/logout/me con audit.

3. **Operaciones del panel** (commits C.4-C.6):
   - Tenants: list + filtros + paginación + detail con métricas.
   - Features override: POST + DELETE manual_override (reason ≥10
     chars). Solo SUPER_ADMIN.
   - Lifecycle: POST suspend/restore con guard transición.
   - Purge stub: registra intención + indica CLI (Fase 9 lógica real).
   - Audit-log viewer con visibilidad por rol (SUPPORT solo info+suyas).
   - Metrics: 4 queries paralelas + mrrEur=null hasta Fase 9.

4. **E2E suite** (commit C.7): 7 escenarios sin mocks de auth,
   incluyendo cross-app cookie defense (JWT con aud='tenant'
   rechazado). Verifica audit entries persistidas.

5. **UI mínima** (commit C.8): layout admin slate + login form +
   dashboard de métricas. SPA completa diferida.

## 2. Cambios respecto al plan

| Sección | Diferencia | Razón |
|---|---|---|
| §5 SPA completa | UI minimal (login + dashboard) | Modo turbo. API completa funcional, gestión via curl/herramientas hasta Fase 9. |
| §4.4 purge | Stub que registra intención | Lógica real de purge en CLI (ADR-008). El stub conecta el panel sin reescribir el CLI. |
| §10 criterio "audit-log UI con filtros funcionales" | Endpoint OK, UI viewer diferida Fase 9 | API tiene los filtros. UI puede consumirlos. |
| §6 6 tests E2E | 7 tests en 1 archivo unificado | Más cohesivo que separar. Mismo coverage. |

## 3. Criterios §10 cumplidos

| # | Criterio | Estado |
|---|---|---|
| 1 | super-admin login en admin.localhost:3000/login | ✅ Endpoint + UI |
| 2 | Cookie tenant NO da acceso al panel | ✅ E2E test JWT aud='tenant' → 401 |
| 3 | GET /api/admin/tenants lista los tenants | ✅ E2E test |
| 4 | Override en tenant_features + audit warning | ✅ E2E test verifica BD + severity |
| 5 | suspend/restore transitions + audit | ✅ Endpoints (E2E parcial) |
| 6 | audit-log con filtros funcionales | ⏳ API completa, UI viewer Fase 9 |
| 7 | SUPER_ADMIN ve todo, SUPPORT solo info+suyas | ✅ E2E test |
| 8 | tsc + vitest + eslint clean | ✅ |
| 9 | 6 E2E tests verde | ✅ 7 tests |

## 4. Suite tests al cierre

Unit:
```
Test Files  25 passed (25)
Tests       215 passed (215)
```

Integration:
- admin-panel.e2e (7/7) — Testcontainers + roles + 2 super-admins.
- custom-domain.e2e (4/4)
- festivos-crud.e2e (5/5)
- feature-guarded-endpoint.e2e (3/3)
- informes-export.e2e (3/3)
- with-tenant-catalog (2/2)
- quota-rotation (3/3)
- quota-concurrency (1/1)

## 5. Schema BD post-Fase 7

Master:
```diff
+model AuditLog {
+  id           String     @id @default(cuid())
+  superAdminId String
+  action       String
+  targetKind   String
+  targetId     String
+  severity     String     @default("info")
+  summary      Json       @default("{}")
+  dumpPath     String?
+  ipAddress    String?
+  userAgent    String?
+  createdAt    DateTime   @default(now())
+  superAdmin   SuperAdmin @relation(...)
+
+  @@index([superAdminId])
+  @@index([targetKind, targetId])
+  @@index([severity, createdAt])
+  @@index([createdAt])
+}
```

## 6. Pendientes para Fase 9+ (TODOs nuevos)

- **N7** (Fase 9): UI completa del panel — pages /tenants, /tenants/[slug],
  /tenants/[slug]/features, /audit-log con filtros visuales.
- **N8** (Fase 9): Purge endpoint real — actualmente stub registra
  intención, requiere conectar con CLI tenants-purge.
- **N9** (Fase 9): MFA para super-admin (TOTP).
- **N10** (Fase 9): Archive cron audit_log > 7 años.
- **N11** (Fase 9): Importar [AUDIT] históricos de stdout a BD (opcional).
- **N12** (Fase 9): Métricas avanzadas (cohorts, churn, MRR real desde Stripe).
- **N13** (Fase 10): Impersonate seguro (auditable + read-only o full).

## 7. Cómo verificar en local

1. Crear super-admin si no existe:
   ```bash
   npm run super-admin:create -- admin@local.test "Admin Local" "Pass1234!"
   ```
2. Acceder a `admin.localhost:3000/login` con esas credenciales.
3. Tras login → `/dashboard` con métricas.
4. API directa con cookie:
   ```bash
   COOKIE=$(curl -s -X POST -H "Host: admin.localhost:3000" \
     -H "content-type: application/json" \
     -d '{"email":"admin@local.test","password":"Pass1234!"}' \
     -c - http://localhost:3000/api/admin/login | grep admin-session)
   curl -H "Host: admin.localhost:3000" -H "Cookie: $COOKIE" \
     http://localhost:3000/api/admin/tenants
   ```
5. Audit log: `SELECT action, severity, created_at FROM master.audit_log ORDER BY created_at DESC LIMIT 20;`

## 8. Referencias

- [Plan Fase 7](./00-fase-7-plan.md)
- [ADR-007](./adr-007-panel-super-admin.md) APROBADO
- [TODOs consolidados](./00-todos-consolidados.md)
