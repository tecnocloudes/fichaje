# Estado del proyecto — 2026-05-02

Snapshot tras cierre formal de Fases 5/6/7 + endpoints diferidos
(Bloque D) + N17 (gates email/push).

## Métricas

- **Commits totales en `feature/saas-migration`**: ~198.
- **Fases cerradas**: 0, 1, 2, 3, 4, 5, 6, 7 (UI minimal panel).
- **ADRs aprobados**: 8 (000, 001, 002, 003, 004, 005, 007, 008).
- **Endpoints route.ts**: 74.
- **Tests unit**: 222.
- **Tests integration/e2e**: 8 archivos (Testcontainers).
- **Migraciones master**: 8 archivos (incluye Fase 7 audit_log + D.1
  api_tokens).
- **Migraciones tenant**: 4 archivos (init + Fase 6 config_general +
  D.2 firma + D.5 webhooks_tenant).
- **TODOs cerrados**: 7 (N3, N5, N17, N21, P1, criterios §6 ADR-004,
  criterios §11 ADR-006-Fase 6).
- **TODOs vivos**: ~16 (N1, N2, N4, N6-N16, N18, N19, N20).

## Suite de tests al cierre

```
$ npx tsc --noEmit
(clean)

$ npx vitest run
Test Files  26 passed (26)
Tests       222 passed (222)

$ VITEST_INTEGRATION=1 npx vitest run
admin-panel.e2e:                     7/7
custom-domain.e2e:                   4/4
festivos-crud.e2e:                   5/5
feature-guarded-endpoint.e2e:        3/3
informes-export.e2e:                 3/3
with-tenant-catalog.integration:     2/2
quota-rotation.integration:          3/3
quota-concurrency.integration:       1/1
+ tests existentes Fase 3-4 (leak, provision, webhooks stripe, jobs)

$ npx eslint --quiet "src/**/*.ts" "src/**/*.tsx" | grep "fichaje/"
(0 errores)

$ npm run build
✓ Compiled successfully in 3.8s
✓ Generating static pages using 9 workers (103/103) in 188ms
```

## Arquitectura final (resumen text)

```
┌─────────────────────────────────────────────────────────────────┐
│  PROXY (proxy.ts) — resuelve host → kind                        │
│  apex / app / admin / tenant / custom_domain_candidate / inv.   │
└─────────────────────────────────────────────────────────────────┘
        │
        ├── kind=apex  → redirect 301 a app.<root>
        ├── kind=app   → /registro, /api/webhooks/stripe, /api/onboarding/status
        ├── kind=admin → /admin/login, /admin/dashboard, /api/admin/*
        ├── kind=tenant → withTenant(handler) carga ctx.features
        │                 + invoca handler → runWithTenant
        └── kind=custom_domain_candidate → resolveTenant lookup BD
            (master.tenants.customDomain) si verified Y feature
            dominio_personalizado activa.

CONTROL PLANE (master schema, Postgres):
  tenants, plans, features, plan_features, tenant_features,
  subscriptions, subscription_items, tenant_quota_usage,
  super_admins, audit_log (Fase 7), api_tokens (D.1),
  reserved_slugs, stripe_events.

PRODUCTO (tenant_<slug> schema, Postgres):
  User, Tienda, Fichaje, Ausencia, TipoAusencia, Festivo, Turno,
  ProcesoOnboarding, Plantilla*, ConfiguracionEmpresa (con zona
  horaria, días laborables, ausencias defaults Fase 6),
  Documento, Firma (D.2), TenantWebhook (D.5), Notificacion,
  PushSubscripcion, BolsaHoras, Comunicado, Articulo, Tarea.

CLIENTES PRISMA (4 roles):
  prismaMaster (master_role) — control plane.
  prismaApp (app_role) — multiplexado por tenant via Proxy.
  prismaRuntime (tenant_runtime_role) — read-only sobre 4 tablas.
  prismaQuotaWriter (quota_writer_role) — exclusivo consumeQuota.

FEATURE GATING (ADR-004, Fase 5):
  hasFeature(key) / getLimit(key) / consumeQuota(key, n) sobre
  ctx.features (Map en memoria). withFeature(key, handler) HOF.
  withQuota(key, n, handler) HOF. <FeatureGate> server +
  <FeatureGateClient>. coverage.ts con 32 features cubiertas
  (0 deferred).

PANEL SUPER-ADMIN (ADR-007, Fase 7):
  admin.<root> con auth dedicada (JWT aud=platform).
  master.audit_log con 13 acciones canónicas.
  Endpoints: login/logout/me, tenants list/detail, features
  override, suspend/restore/purge stub, audit-log viewer, metrics.
  UI minimal: /admin/login + /admin/dashboard.

NOTIFICACIONES (N17, Fase 5.5):
  sendEmail (gates feature notificaciones_email + quota emails_mes).
  sendPush (gates feature notificaciones_push + quota pushs_mes).
  sendSystemEmail (sin gates) para Stripe handlers / worker.

API PÚBLICA (D.1):
  /api/v1/empleados|fichajes|tiendas con auth Bearer (api_tokens
  master) + feature api_access + quota api_calls_dia.

TODO N7 (Fase 9): UI completa panel super-admin.
TODO N4 (Fase 9): UTC timezone consolidación quota.
```

## Próximos pasos

**Fase 8 — Despliegue Dokploy** (preparada para arrancar):
1. `Dockerfile` multi-stage (revisar el actual o crear).
2. `docker-compose.yml` para dev local (app + postgres + worker).
3. Variables de entorno producción (4 roles BD + AUTH_SECRET +
   ADMIN_JWT_SECRET + RESEND_API_KEY + STRIPE_*).
4. SSL custom domain (Cloudflare DNS-01 — diferido en plan Fase 6
   §15.5).
5. `entrypoint.sh` con `prisma migrate deploy` + `tenants:migrate:all`.
6. Healthcheck endpoint.
7. Dominio wildcard `*.ficha.tecnocloud.es` + Traefik.
8. Backup `pg_dump` de master + por tenant (cron Dokploy).

**Pendiente fuera de Fase 8** (opcional, ver `00-todos-consolidados.md`):
- N1, N2, N4, N6-N16, N18-N20.
- Iteración UI panel (N7) en Fase 9 o cuando demanda crezca.

## Cómo verificar el SaaS en local

Pre-requisitos:
- Docker Desktop con `fichaje_postgres` corriendo.
- `npm run dev:all` activo.

Tests visuales rápidos (todos requieren login con sesión válida):

1. **Tenant dev** (`http://dev.localhost:3000/login`):
   - Login admin@dev.local / dev_password_2026.
   - Tab `Configuración` → 6 sub-tabs (General, Tipos ausencia,
     Notificaciones, Branding, Calendario, Dominio).
   - Tab `Informes` → botones Excel/PDF descargan archivos reales.

2. **Panel super-admin** (`http://admin.localhost:3000/admin/login`):
   - `npm run super-admin:create -- admin@local.test "Admin" "Pass1234!"`.
   - Login → `/admin/dashboard` con métricas globales.

3. **API pública v1**:
   ```bash
   # POST API token (con sesión OWNER):
   curl -X POST -H "Cookie: <session>" \
     -H "content-type: application/json" \
     -d '{"name":"local"}' \
     http://dev.localhost:3000/api/me/api-tokens
   # Usar plainToken devuelto:
   curl -H "Authorization: Bearer <plainToken>" \
     http://dev.localhost:3000/api/v1/empleados
   ```

## Archivos relevantes

- `docs/specs/00-saas-migration-master-plan.md` — plan maestro 9 fases.
- `docs/arch/adr-{000-008}.md` — decisiones arquitectónicas.
- `docs/arch/00-fase-{0-7}-{plan,cierre}.md` — planes y cierres por fase.
- `docs/arch/00-todos-consolidados.md` — vivo, actualizado por fase.
- `AGENTS.md` — convenciones para futuros agentes (incluye N5).
- `CLAUDE.md` — alias a AGENTS.md para Claude Code.

---

**El proyecto está listo para Fase 8 (despliegue).**
