# ADR-007 — Panel super-admin + `master.audit_log`

- **Estado**: APROBADO
- **Fecha PROPUESTO**: 2026-05-01
- **Fecha APROBADO**: 2026-05-01 (modo turbo cierre nocturno; sin enmiendas)
- **Contexto previo**: ADR-002 §2.5 menciona "ADR-007 panel super-admin" como pendiente. ADR-008 §2.6, §2.9, §5.2 referencian `master.audit_log` y la UI de `tenants:purge` como diferidos a este ADR.
- **ADRs relacionados**: ADR-001 (master_role + tenant_runtime_role), ADR-002 (status del tenant), ADR-003 (subscriptions, stripe_events), ADR-008 (lifecycle SUSPENDED → DELETED — operaciones que el panel ejecuta).

## 1. Contexto

Tras Fase 4 cerrada y Fase 5 planeada, el operador del SaaS necesita herramientas que el código actual **no expone**:

1. **Listar tenants** con filtros (status, plan, fecha registro).
2. **Operaciones del lifecycle** (ADR-008): `tenants:purge --pseudonymize`, `tenants:purge --hard-delete`, `tenants:restore`. Hoy son CLI; necesitan UI.
3. **Audit trail** de operaciones destructivas o intrusivas: quién hizo qué, cuándo, sobre qué tenant. Mandatorio para GDPR + RD 8/2019 (acreditar que el cliente o un super-admin autorizado ejecutó la pseudonimización).
4. **Métricas básicas**: total tenants, MRR estimado, registros últimos 30d, churn.
5. **Edición manual de features**: `manual_override` en `tenant_features` con razón y expiración. ADR-004 §2.11 lo deja para este ADR.
6. **Impersonar tenant**: ver lo que el OWNER ve (ADR-007 spec maestra Fase 7 punto 4). Auditable.

Hoy:
- `npm run tenants:list` muestra tenants en consola.
- `npm run tenants:provision` crea tenants manualmente.
- `npm run tenants:migrate` aplica migrations.
- `npm run dev:seed-tenant` siembra `tenant_dev`.
- No hay UI ni audit log persistente. Logs de operaciones quedan solo en stdout del worker (`[AUDIT]` prefix — fallback de ADR-008 §2.6).

Este ADR cierra el panel + audit_log para que ADR-008 (lifecycle) y Fase 7 (panel completo) tengan donde apoyarse.

## 2. Decisión

### 2.1 Subdominio `admin.<root>` con su propia auth

**Ruta**: `admin.ficha.tecnocloud.es` en producción, `admin.localhost:3000` en desarrollo.

**Auth independiente**: NO reusa NextAuth de los tenants. El panel tiene **su propio cookie scope** y JWT con `aud: "platform"` (audience claim).

Justificación:

- **Aislamiento**: el cookie del tenant (`authjs.session-token` con `tenantSlug`) NO debe ser válido para el panel. Si un OWNER de tenant captura su cookie y prueba en `admin.host`, el JWT con `aud: "tenant"` debe ser rechazado por el panel (`aud: "platform"`).
- **Tabla separada**: `master.super_admins` (creada en Fase 2). Login con email/password bcrypt, MFA opcional (Fase 9).
- **Proxy.ts**: `kind=admin` ya está implementado (Fase 3 commit 8). Devuelve 503 "Panel pendiente". Este ADR materializa el handler real.

### 2.2 Single-page application montada bajo subdominio admin

Estructura propuesta:

```
src/app/(admin)/
├── layout.tsx              # Layout super-admin (NO usa withTenantPage)
├── login/page.tsx           # Login super-admin (auth distinta)
├── dashboard/page.tsx       # Métricas
├── tenants/
│   ├── page.tsx             # Listado con filtros
│   └── [slug]/page.tsx      # Detalle: features, subscription, audit log, purge button
├── audit-log/page.tsx       # Log global con filtros
└── tools/
    ├── purge/page.tsx       # UI tenants:purge --pseudonymize/--hard-delete
    └── restore/page.tsx     # UI tenants:restore
```

`src/app/api/admin/**` para endpoints API que el panel usa. Whitelist en `eslint.config.mjs` (ya está documentado en `with-tenant.ts` JSDoc Fase 3).

### 2.3 Operaciones del panel

#### 2.3.a Listar tenants con filtros

`GET /api/admin/tenants?status=active&plan=starter&since=2026-01-01`

- Lee `prismaMaster.tenant.findMany` con `include: { subscriptions: true }` para mostrar plan y MRR.
- Paginación: 50 por página.
- Auditable: cada acceso queda en `audit_log` con `action='tenants:list'` (severidad `info`).

#### 2.3.b `tenants:purge --pseudonymize` y `--hard-delete`

UI con confirmación obligatoria por slug (mismo patrón que el CLI ADR-008 §2.9):

```
┌────────────────────────────────────────────────────┐
│ PSEUDONIMIZAR tenant "acme"                        │
│                                                    │
│ Esta acción es irreversible. Datos afectados:      │
│  - 12 usuarios PII redactados                      │
│  - 4523 fichajes conservados (RD 8/2019)           │
│  - 18 documentos eliminados                        │
│  - configuración + comunicados eliminados          │
│                                                    │
│ Antes de proceder:                                 │
│  - Dump SQL automático: /var/lib/.../acme_*.sql.gz │
│                                                    │
│ Escribe el slug del tenant para confirmar:         │
│  [ acme                            ]               │
│                                                    │
│  [Cancelar]              [PSEUDONIMIZAR]           │
└────────────────────────────────────────────────────┘
```

- Backend: invoca el helper `purgePseudonymize(slug, superAdminId)` (extraído del CLI a `src/lib/admin/purge.ts`).
- Audit log entry: `action='tenants:purge'`, `mode='pseudonymize'`, `target='tenant:acme'`, `summary={users:12, fichajes:4523, ...}`, `dump_path='/var/lib/.../acme_pseudonymize_<ts>.sql.gz'`, `severity='critical'`.
- POST-OK: redirect a la lista con flash "Tenant pseudonimizado".

`--hard-delete` análogo, con condiciones extra (deleted_at < now - 4 años, ADR-008 §2.4).

#### 2.3.c `tenants:restore`

UI con confirmación: "Reactivar tenant 'acme' (estado actual: suspended)". Solo aplica si `status='suspended'` (NO si `deleted` — ADR-008 deja claro que es irreversible).

Acciones:
- `tenant.status = 'active'`.
- `tenant.suspended_at = NULL`.
- Restaurar `tenant_features` con `source='manual_override'` que estuvieran desactivadas (campo extra `disabled` o equivalente — pendiente Fase 7).

Audit log: `action='tenants:restore'`, `target='tenant:acme'`, `severity='warning'`.

#### 2.3.d Listar `audit_log`

`GET /api/admin/audit-log?action=tenants:purge&since=2026-04-01`

Paginación. Filtros: action, target tenant slug, severity, super_admin_id, fecha.

#### 2.3.e Métricas

`GET /api/admin/metrics`:

- Tenants por status (active, suspended, pending, provisioning, deleted).
- MRR estimado: suma de `subscriptions.amount * quantity` para subs activos. Stripe API es la fuente real; calculamos local desde `master.subscriptions` y `subscription_items` × precio mapeado de Stripe.
- Registros últimos 30 días (count por día).
- Churn 30d: tenants que pasaron a `suspended` o `canceled` en últimos 30 días / total active 30 días atrás.

Cacheable 5 min (no hace falta tiempo real).

#### 2.3.f Edición manual de features

UI por tenant: tabla con las 32 features × 3 fuentes (plan, addon, manual_override). Para cada feature:

- Mostrar valor resuelto (siguiendo prioridad ADR-003 §2.9: manual_override > addon > plan).
- Campo "Override manual": valor (boolean toggle / int / null), razón obligatoria (textarea ≥10 chars), `expires_at` opcional (date picker).
- Submit: insert/update en `master.tenant_features` con `source='manual_override'`.
- Audit log: `action='tenant_features:override'`, `target='tenant:acme:feature:export_csv'`, `summary={value:true, reason:"...", expires_at:null}`, `severity='warning'`.

ADR-004 §2.11 deja esta UI para ADR-007. Aquí queda especificada.

#### 2.3.g Impersonar tenant

Botón "Impersonar OWNER" en detalle de tenant. Acción:

1. Crear sesión NextAuth temporal con `tenantSlug`, `rol='OWNER'`, y `impersonated_by_super_admin_id`.
2. Redirect a `<slug>.host` con cookie de sesión recién creada.
3. Audit log: `action='impersonate', target='tenant:acme:user:owner@acme.local', super_admin_id=...`.

**Cookie de impersonación**:
- Vida corta (15 min).
- Marcado en JWT con `imp: true` para que la app del tenant pueda mostrar banner "Estás impersonando como super-admin".
- Banner permanente en la UI del tenant impersonada.
- Botón "Salir de impersonación" devuelve al panel super-admin.

### 2.4 `master.audit_log` — shape

Tabla nueva en `master`:

```sql
CREATE TABLE master.audit_log (
  id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
  super_admin_id  VARCHAR(36) NOT NULL REFERENCES master.super_admins(id),
  action          VARCHAR(80) NOT NULL,        -- 'tenants:purge', 'tenant_features:override', etc.
  target_kind     VARCHAR(40) NOT NULL,        -- 'tenant' | 'feature' | 'session' | 'subscription' | 'user'
  target_id       VARCHAR(80) NOT NULL,        -- 'acme' | 'acme:export_csv' | etc.
  severity        VARCHAR(20) NOT NULL DEFAULT 'info',
                                                -- 'info' | 'warning' | 'critical'
  summary         JSONB NOT NULL DEFAULT '{}',
                                                -- contexto: {users:12, fichajes:4523, ...}
  dump_path       TEXT,                         -- path al dump SQL si aplica (ADR-008 §2.9)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address      INET,                         -- IP del super-admin en el momento
  user_agent      TEXT                          -- UA del navegador
);

CREATE INDEX audit_log_super_admin_idx ON master.audit_log (super_admin_id);
CREATE INDEX audit_log_target_idx ON master.audit_log (target_kind, target_id);
CREATE INDEX audit_log_severity_idx ON master.audit_log (severity, created_at DESC);
CREATE INDEX audit_log_created_at_idx ON master.audit_log (created_at DESC);
```

**Campos justificados**:

- `super_admin_id`: quién hizo la acción. FK a `master.super_admins`.
- `action`: identificador determinista. Lista cerrada (~20 acciones, declarada en `src/lib/admin/audit-actions.ts`).
- `target_kind` + `target_id`: composite identifier del objeto afectado.
- `severity`: `info` (lecturas), `warning` (mutaciones reversibles), `critical` (irreversibles: purge, hard-delete, impersonate).
- `summary` JSONB: contexto estructurado. Ejemplo: `{"users":12,"fichajes":4523,"documents":18}`.
- `dump_path`: solo para `tenants:purge` (path en disco al dump SQL preventivo, ADR-008 §2.9).
- `ip_address` + `user_agent`: traceability adicional. RGPD art. 32 (medidas técnicas).

**No se borra nunca**. Retención indefinida. Job de Fase 9 archiva entries > 7 años.

### 2.5 Audit trail — visibilidad

- **Lecturas (`severity='info'`)**: visible para todos los super-admins.
- **Warnings/Critical**: visible para super-admins con rol `SUPER_ADMIN` (no `SUPPORT`). El rol `SUPPORT` solo ve sus propias warnings/critical.
- **Detalle completo (`summary`, `dump_path`, `ip_address`)**: solo el super-admin que ejecutó la acción + role `SUPER_ADMIN`.
- **Metadata** (action, target, severity, created_at): visible para todos.

Esto coincide con la separación `SUPER_ADMIN` vs `SUPPORT` ya en `master.super_admins.role` (ADR-001 enum `PlatformRol`).

### 2.6 Integración con ADR-008

ADR-008 §2.6 + §2.9 documentan `[AUDIT]` log a stdout como **fallback** mientras ADR-007 está pendiente. Una vez este ADR cierre y `master.audit_log` exista:

1. Los CLI (`tenants:purge`, `tenants:restore`) escriben a **ambos**: BD + stdout (redundancia).
2. La UI del panel escribe SOLO a BD.
3. Job de migración: importar `[AUDIT]` lines de `journalctl` históricos a `master.audit_log` (opcional Fase 9 — bajo demanda).

### 2.7 Acciones declaradas (lista cerrada)

`src/lib/admin/audit-actions.ts`:

```ts
export const AUDIT_ACTIONS = {
  // Lecturas (severity='info')
  "tenants:list": { severity: "info", description: "Listado de tenants" },
  "audit-log:list": { severity: "info", description: "Listado de audit log" },
  "metrics:read": { severity: "info", description: "Lectura de métricas" },

  // Mutaciones reversibles (severity='warning')
  "tenant_features:override": { severity: "warning", description: "Override manual de feature" },
  "tenants:restore": { severity: "warning", description: "Restore tenant suspended → active" },
  "tenants:provision": { severity: "warning", description: "Provisión manual (sin Stripe)" },

  // Irreversibles (severity='critical')
  "tenants:purge:pseudonymize": { severity: "critical", description: "Pseudonimización ADR-008" },
  "tenants:purge:hard-delete": { severity: "critical", description: "Hard delete ADR-008" },
  "impersonate": { severity: "critical", description: "Impersonación de OWNER" },

  // Auth eventos super-admin
  "super-admin:login": { severity: "info", description: "Login super-admin" },
  "super-admin:login-failed": { severity: "warning", description: "Login fallido" },
  "super-admin:password-reset": { severity: "warning", description: "Reset password super-admin" },
} as const;
```

Lista extensible. Cada acción nueva requiere PR explícito.

## 3. Opciones consideradas

### 3.1 Subdominio dedicado vs path `/super-admin`

| Opción | Pro | Contra |
|---|---|---|
| **`admin.host` subdomain** (elegida) | Aislamiento de cookies por dominio. Auth completamente separada. Whitelist en proxy ya existe (Fase 3) | Requiere DNS adicional |
| `/super-admin` path bajo apex | Sin DNS extra | Cookie del super-admin podría leakar a tenants. Auth difícil de aislar |

**Descartada path**: el aislamiento de cookies es suficiente razón.

### 3.2 Auth: NextAuth con rol especial vs auth dedicada

| Opción | Pro | Contra |
|---|---|---|
| **Auth dedicada** (elegida) | Tabla `super_admins` separada de `User` del tenant. JWT con `aud: "platform"` distinto | Implementación duplicada del flow login |
| NextAuth con rol `SUPER_ADMIN` mezclado en `User` del tenant | Una sola lib | Mezcla autenticación de planos distintos. Cookie del tenant podría escalar a super-admin con un bug |

**Descartada NextAuth mezclado**: principio de least privilege.

### 3.3 Audit log síncrono vs queue

| Opción | Pro | Contra |
|---|---|---|
| **INSERT síncrono inline** (elegida) | Atomicidad: si la acción falla, log no aparece. Si log falla, acción se aborta | Latencia añadida (negligible para acciones humanas) |
| Queue async (BullMQ) | Sin latencia | Posible pérdida si worker cae entre acción y log |

**Descartada queue**: las acciones del super-admin son raras (decenas/día), latencia 5ms del INSERT es asumible.

### 3.4 Permisos granulares vs rol binario

| Opción | Pro | Contra |
|---|---|---|
| **Rol binario `SUPER_ADMIN` / `SUPPORT`** (elegida) | Simple, ya en `master.super_admins.role` | Menos granular |
| Sistema de permisos por acción | Granular | Sobre-ingeniería para 1-5 super-admins esperados |

**Descartada granular**: hasta crecer >10 super-admins, dos roles bastan.

### 3.5 Impersonate con cookie real vs sin sesión cookie

| Opción | Pro | Contra |
|---|---|---|
| **Cookie real con `imp:true`** (elegida) | El super-admin ve EXACTAMENTE lo que ve el OWNER. Fidelidad total | Si el banner falla y se olvida en sesión, riesgo de cambios atribuidos al OWNER en vez del super-admin |
| Vista read-only sin sesión | Menos riesgo | Pierde la fidelidad — botones POST etc. fallarían |

**Elegida con mitigaciones**: vida corta (15 min), banner permanente, audit log antes y después de cada mutación dentro de la impersonación.

## 4. Consecuencias

### 4.1 Positivas

- Trazabilidad completa de operaciones críticas (GDPR + RD 8/2019).
- Aislamiento de auth super-admin del tenant.
- ADR-008 puede materializarse (la UI de purge tiene donde vivir).
- El operador puede gestionar tenants sin SSH al servidor.
- `master.audit_log` desbloquea TODOs cruzados (Fase 4 escalado super-admin, Fase 5 manual_override).

### 4.2 Negativas (asumidas)

- Carga de implementación: ~25-35 commits estimados (más extenso que Fase 5).
- Curva de mantenimiento: cada nueva acción requiere actualizar `AUDIT_ACTIONS` + tests + UI.
- Riesgo del impersonate (mitigado pero no eliminado).
- Coste BD: `audit_log` crece. Estimación 100K acciones/año con 1000 tenants → 100K filas / año / 200B promedio = ~20MB/año. Asumible décadas.

### 4.3 Neutras

- Worker (Fase 4) escribe a `audit_log` para alertas de PROVISIONING stuck. Cambio 1-line.
- ADR-008 jobs cron también escriben a `audit_log` (alertas tenants due).
- TLS por subdominio admin: si Fase 8 va con opción A wildcard, no requiere config extra.

## 5. Implicaciones para fases siguientes

### 5.1 Fase 7 — implementación completa

- Migración Prisma para `master.audit_log` + `master.super_admins.permissions` opcional.
- Implementación de los 7 endpoints `/api/admin/**`.
- 8 páginas en `src/app/(admin)/**`.
- Auth dedicada en `src/lib/admin/auth.ts` (separada de NextAuth del tenant).
- Whitelist `/api/admin/**` en `eslint.config.mjs` para `no-legacy-prisma`.
- Tests integration + E2E del flow super-admin (login → listar tenants → impersonate → audit log).

### 5.2 Fase 8 — Despliegue

- DNS: `admin.ficha.tecnocloud.es` apuntando a la app (mismo deployment).
- Cert TLS via Cloudflare DNS-01 wildcard (ADR-005 §2.1.b ya cubre `*.ficha.tecnocloud.es`).
- Variable `SUPER_ADMIN_COOKIE_DOMAIN=admin.ficha.tecnocloud.es` para que el cookie no leakee.

### 5.3 Fase 9 — Optimización futura

- Archivo `audit_log` > 7 años (purge cron).
- MFA para super-admins.
- IP allowlist para subdominio admin (opt-in).
- Webhooks de audit_log (Slack/Teams cuando severity=critical).

## 6. Criterios de aceptación

Esta decisión se considera implementada (probable Fase 7) cuando todos los siguientes son ciertos:

1. `master.audit_log` existe con shape §2.4 y 4 índices.
2. `src/lib/admin/audit-actions.ts` declara la lista cerrada de acciones (≥10 entries).
3. Auth super-admin en `admin.<root>` con cookie scope distinto del tenant. Login + JWT con `aud:"platform"`.
4. Listado de tenants con filtros funcional. Auditable.
5. UI `tenants:purge --pseudonymize` y `--hard-delete` con confirmación de slug. Audit log entry con `dump_path`.
6. UI `tenants:restore` (suspended → active) con audit warning.
7. UI `tenant_features:override` (manual_override) con razón obligatoria + expiración opcional.
8. UI impersonate con cookie de 15 min + banner permanente + audit critical antes/después.
9. Métricas dashboard (count por status, MRR, registros 30d, churn).
10. Listado audit_log con filtros y permisos por rol (§2.5).
11. Tests integration: cada acción crítica registra en audit_log con shape correcto.
12. Test E2E: super-admin login → impersonate tenant → modificación → "salir impersonación" → audit log con 3 entries (impersonate, mutation, exit-impersonate).

## 7. Referencias

- ADR-001 §2.3 (master_role, tenant_runtime_role), §5.2 (super_admins).
- ADR-002 §2.5 (cookie scope `__Host-`), §3.5 (kind=admin en proxy).
- ADR-003 §2.6 (subscriptions, base de métricas MRR).
- ADR-004 §2.11 (UI manual_override deferida aquí).
- ADR-008 (lifecycle SUSPENDED → DELETED — operaciones que esta UI ejecuta).
- RGPD art. 30 (registro de actividades de tratamiento).
- RGPD art. 32 (medidas de seguridad — IP, UA, audit log son medidas exigidas).
- RD 8/2019 art. 34 (registro horario — tenants:purge debe acreditar 4 años de retención).
- NextAuth — [JWT audience claim](https://authjs.dev/concepts/session-strategies#jwt-session).
