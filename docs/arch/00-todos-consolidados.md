# TODOs consolidados — origen, destino, severidad

- **Estado**: VIVO (actualizado al cerrar cada fase / encontrar TODOs nuevos)
- **Fecha**: 2026-05-01
- **Cobertura**: TODOs de Fases 0-4 cerradas, ADRs 001-008.

## Cómo leer este documento

Cada TODO tiene 4 campos:

- **Origen**: fase, commit, ADR o documento donde se descubrió o decidió aplazar.
- **Destino**: fase futura donde se implementa (5, 6, 7, 8 o 9).
- **Severidad**:
  - **bloqueante**: la fase destino no puede cerrarse sin esto.
  - **mejora**: aporta valor pero la fase destino puede cerrarse sin esto.
  - **opcional**: se hace si hay tiempo, no bloquea nada.
- **Estado**: `pendiente` | `en curso` | `cerrado`.

## Pre-Fase 5 (urgentes antes de arrancar Fase 5)

| # | TODO | Origen | Destino | Severidad | Estado |
|---|------|--------|---------|-----------|--------|
| P1 | Validar 9 puntos a confirmar de §15 plan Fase 5 | `00-fase-5-plan.md` §15 | Fase 5 | bloqueante | pendiente |

## Fase 5 — Feature flags productivos

| # | TODO | Origen | Severidad | Estado |
|---|------|--------|-----------|--------|
| 5.1 | Implementar HOFs `withFeature` y `withQuota` (ADR-004 §2.8) | ADR-004 §5.3 | bloqueante | pendiente |
| 5.2 | Implementar `<FeatureGate>` y `<UpsellCTA>` | ADR-004 §2.7 + §5.3 | bloqueante | pendiente |
| 5.3 | Implementar `GET /api/me/features` con `current` opt-in | ADR-004 §2.6 + §5.3 | bloqueante | pendiente |
| 5.4 | Refactor de los ~12 endpoints/UI con feature gates | `00-fase-5-plan.md` §5 | bloqueante | pendiente |
| 5.5 | Regla ESLint custom `no-feature-gate-on-core` | ADR-004 §2.9 | bloqueante | pendiente |
| 5.6 | Regla ESLint custom `no-quota-writer-leak` (verificada como pendiente — no existe en `eslint.config.mjs`) | ADR-004 §2.2 | bloqueante | pendiente |
| 5.7 | Regla ESLint `route-must-use-withTenant` (incluida en Fase 5 con el refactor) | Fase 3 cierre §11 → aplazada a Fase 5 | mejora | pendiente |
| 5.8 | Test integration `consumeQuota` con concurrencia (100 promises, max=50 → exactamente 50 oks) | ADR-004 §6 + plan Fase 5 §7.2 | bloqueante | pendiente |
| 5.9 | `npm run test:feature-coverage` en CI | ADR-004 §5.3 | bloqueante | pendiente |
| 5.10 | Test E2E `registro_jornada_legal` CORE (Starter sin export_csv puede fichar) | ADR-004 §2.9 | bloqueante | pendiente |
| 5.11 | Modificar `dev:seed-tenant` para opción `--features=enterprise` (todas las features true) | Plan Fase 5 §15.7 | mejora | pendiente |
| 5.12 | Endpoint `GET /api/fichaje/registro-legal` (export XML/PDF inspección) | ADR-004 §2.9 | bloqueante | pendiente |

## Fase 6 — Configuración por tenant

| # | TODO | Origen | Severidad | Estado |
|---|------|--------|-----------|--------|
| 6.1 | Tabla `tenant_settings` (decidir si en master o en cada schema) | Spec §6 | bloqueante | pendiente |
| 6.2 | UI ajustes admin (logo, colores, zona horaria, festivos, política fichaje) | Spec §6 | bloqueante | pendiente |
| 6.3 | Cargar settings en cada request | Spec §6 | bloqueante | pendiente |

## Fase 7 — Panel super-admin

| # | TODO | Origen | Severidad | Estado |
|---|------|--------|-----------|--------|
| 7.1 | **Materializar ADR-007** (auth dedicada + 7 endpoints + 8 páginas + audit_log) | ADR-007 §6 | bloqueante | pendiente |
| 7.2 | Migración Prisma para `master.audit_log` (shape ADR-007 §2.4) | ADR-007 §5.1 | bloqueante | pendiente |
| 7.3 | UI `tenants:purge --pseudonymize` y `--hard-delete` con confirmación de slug | ADR-008 §5.2 + ADR-007 §2.3.b | bloqueante | pendiente |
| 7.4 | UI `tenants:restore` (suspended → active) | ADR-008 §6 criterio 8 + ADR-007 §2.3.c | bloqueante | pendiente |
| 7.5 | UI `tenant_features:override` (manual_override con razón + expiración) | ADR-004 §2.11 → ADR-007 §2.3.f | bloqueante | pendiente |
| 7.6 | UI impersonate OWNER con cookie 15 min + banner permanente | ADR-007 §2.3.g | bloqueante | pendiente |
| 7.7 | Email a super-admin cuando `stuck_tenant.retryCount ≥ 3` | Fase 4 cierre §5 punto 3 | mejora | pendiente |
| 7.8 | Migrar `[AUDIT]` logs históricos de stdout a `master.audit_log` | ADR-007 §2.6 | opcional | pendiente |
| 7.9 | Listado audit_log con permisos por rol (SUPER_ADMIN ve todo, SUPPORT solo info propios) | ADR-007 §2.5 | bloqueante | pendiente |
| 7.10 | Métricas dashboard (count por status, MRR, registros 30d, churn) | ADR-007 §2.3.e | bloqueante | pendiente |

## Fase 8 — Despliegue Dokploy

| # | TODO | Origen | Severidad | Estado |
|---|------|--------|-----------|--------|
| 8.1 | DNS wildcard `*.ficha.tecnocloud.es` (Cloudflare DNS-01) | ADR-005 §2.1.b | bloqueante | pendiente |
| 8.2 | DNS específico `admin.ficha.tecnocloud.es` apuntando a la app | ADR-007 §5.2 | bloqueante | pendiente |
| 8.3 | Cutover del tenant actual a plan `enterprise` con sentinels Stripe | ADR-004 §5.4 | bloqueante | pendiente |
| 8.4 | Worker como segundo servicio Dokploy (separado de la app) | ADR-005 §3.2 + plan Fase 4 §15.9 | bloqueante | pendiente |
| 8.5 | Crear los 4 roles Postgres reales (`master_role`, `app_role`, `tenant_runtime_role`, `quota_writer_role`) | ADR-001 §2.3 | bloqueante | pendiente |
| 8.6 | Variable `EMAIL_SUPER_ADMIN` para alertas del worker | ADR-008 §5.3 | bloqueante | pendiente |
| 8.7 | Variable `PURGE_DUMP_DIR` (default `/var/lib/fichaje-purge-dumps`) | ADR-008 §2.9 | mejora | pendiente |
| 8.8 | Variable `SUPER_ADMIN_COOKIE_DOMAIN=admin.ficha.tecnocloud.es` | ADR-007 §5.2 | bloqueante | pendiente |
| 8.9 | Healthcheck endpoint que verifica master + app conexiones | ADR-005 §2.7 | bloqueante | pendiente |
| 8.10 | Backup del Postgres del control plane (retención 30 días) | ADR-008 §2.11 + ADR-001 §5.5 | bloqueante | pendiente |

## Fase 9 — Optimización + escalado

| # | TODO | Origen | Severidad | Estado |
|---|------|--------|-----------|--------|
| 9.1 | BullMQ + Redis si Trigger A (p50 > 10s) o B (>3 errors/sem) en webhook | ADR-003 §5.2 | opcional | pendiente |
| 9.2 | Vista materializada para `max_storage_mb.current` | ADR-004 §4.2 | mejora | pendiente |
| 9.3 | LRU + dispose para `globalThis._tenantClients` (>100 tenants) | ADR-002 §2.2 enmienda 5 | mejora | pendiente |
| 9.4 | Purge cron de `master.stripe_events` > 7 años | ADR-003 §2.3.b + ADR-008 §2.12 + Fase 4 cierre | mejora | pendiente |
| 9.5 | Purge cron de `PURGE_DUMP_DIR` > 90 días | ADR-008 §2.9 | mejora | pendiente |
| 9.6 | Purge cron de `master.audit_log` > 7 años | ADR-007 §5.3 | mejora | pendiente |
| 9.7 | MFA para super-admins | ADR-007 §5.3 | mejora | pendiente |
| 9.8 | IP allowlist para subdominio admin (opt-in) | ADR-007 §5.3 | opcional | pendiente |
| 9.9 | Webhooks audit_log (Slack/Teams cuando severity=critical) | ADR-007 §5.3 | opcional | pendiente |
| 9.10 | Stripe Billing Portal `flow_data.subscription_update` con prefill del addon de `?upgrade=KEY` | Plan Fase 5 §12 | mejora | pendiente |
| 9.11 | Compresión de schemas pseudonimizados (PostgreSQL TOAST) | ADR-008 §5.4 | opcional | pendiente |
| 9.12 | Métrica "tenants pseudonimizados/hard-deleted" en dashboard super-admin | ADR-008 §5.4 | mejora | pendiente |
| 9.13 | Test E2E del flow Stripe completo con Playwright (form + checkout + login) | Fase 4 cierre §5 punto 7 | mejora | pendiente |
| 9.14 | Test integration con Stripe REAL (no mocks) que ejercite `stripe.checkout.sessions.create` | Fase 4 fixes E2E (commit 83e8ae8) | mejora | pendiente |
| 9.15 | Test E2E pages del tenant (login, dashboard) con Playwright para prevenir regresiones tipo Bug 4 | Fase 4 fix Bug 4 (commit 619eafe) | mejora | pendiente |
| 9.16 | Test E2E flow `set-password` → `login` para prevenir regresiones tipo Bug 5 | Fase 4 fix Bug 5 (commit e9b7728) | mejora | pendiente |

## Documentación pendiente

| # | TODO | Origen | Destino | Severidad | Estado |
|---|------|--------|---------|-----------|--------|
| D1 | Documentar en `AGENTS.md` que `stripe listen` SIEMPRE va a `app.localhost:3000/api/webhooks/stripe` (NO `localhost:3000` apex — el proxy redirige a app) | Fase 4 fix sesión E2E (descubrimiento operador) | Pre-Fase 5 | mejora | pendiente |
| D2 | Documentar política de branding default unificado entre `src/app/layout.tsx` (root) y `LoginPage` | Fase 4 commit 619eafe | Fase 5 o 6 | mejora | pendiente |
| D3 | Página pública `/legal/privacidad` con política GDPR + RD 8/2019 (incluye 30 días backups) | ADR-008 §6 criterio 10 | Fase 7 (cuando hay tenant productivo) | bloqueante | pendiente |
| D4 | Runbook operador: rotación de password Postgres en producción | ADR-005 §6 + plan Fase 4 §11.5 | Fase 8 | mejora | pendiente |
| D5 | Runbook operador: comando `tenants:purge` paso a paso con dump SQL | ADR-008 §2.9 | Fase 7 | mejora | pendiente |
| D6 | Runbook operador: setup Stripe (login, listen, bootstrap, tarjeta test 4242) | Fase 4 cierre §8 | Pre-Fase 5 | opcional | cerrado parcialmente (00-fase-4-cierre.md §8) |

## Pendientes del operador (acciones humanas)

| # | TODO | Origen | Severidad |
|---|------|--------|-----------|
| O1 | E2E real con Stripe CLI completar (criterio 14 §13 plan Fase 4) — bloqueado hasta tenant_test1 verificado en navegador con set-password + login | Fase 4 cierre §8.3 | bloqueante |
| O2 | Decisión merge `feature/saas-migration` → `main` antes o después de Fase 5 | Fase 4 cierre §8.4 | bloqueante |
| O3 | Validar 9 puntos §15 del plan Fase 5 antes de arrancar commit 1 | Plan Fase 5 §15 | bloqueante |
| O4 | Validar ADR-007 (revisión de cierre) antes de Fase 7 | Esta tarea (commit 6b5f1e9) | bloqueante |

---

## Resumen por destino

| Destino | TODOs bloqueantes | TODOs mejora | TODOs opcionales |
|---|---|---|---|
| Pre-Fase 5 | 3 | 2 | 0 |
| Fase 5 | 9 | 3 | 0 |
| Fase 6 | 3 | 0 | 0 |
| Fase 7 | 7 | 2 | 1 |
| Fase 8 | 8 | 2 | 0 |
| Fase 9 | 0 | 9 | 5 |
| Documentación | 2 | 3 | 1 |
| Operador | 4 | 0 | 0 |
| **Total** | **36** | **21** | **7** |

## Resumen por origen

- **ADR-001** (aislamiento): 1 TODO.
- **ADR-002** (resolución tenant): 1 TODO.
- **ADR-003** (billing): 2 TODOs.
- **ADR-004** (feature flags): 9 TODOs.
- **ADR-005** (deployment): 2 TODOs.
- **ADR-007** (panel super-admin): 8 TODOs.
- **ADR-008** (lifecycle): 7 TODOs.
- **Plan Fase 5** (recién escrito): 14 TODOs.
- **Cierres Fase 3 y 4**: 6 TODOs.
- **Bugs E2E reales Fase 4**: 4 TODOs (test E2E para prevenir regresiones).
- **Spec maestra**: 4 TODOs (Fase 6 + 8).

## Cómo se actualiza este documento

- Al cerrar una fase: marcar TODOs como `cerrado` con commit hash.
- Al añadir un TODO nuevo (descubrimiento, ADR nuevo): añadir entrada con su origen.
- Al cambiar destino de un TODO: justificar en commit message.
- Mantener el resumen por destino actualizado.
