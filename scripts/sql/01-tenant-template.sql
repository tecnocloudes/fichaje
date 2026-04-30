-- scripts/sql/01-tenant-template.sql
--
-- Crea el schema fijo `tenant_template` que sirve de plantilla para todos
-- los `tenant_<slug>` reales. Las migraciones del producto se aplican
-- contra este schema con `npm run tenants:migrate -- template` (commit 13).
-- Después, `tenants:provision <slug>` (commit 12) clona su estructura a
-- un schema nuevo `tenant_<slug>` para el cliente recién creado.
--
-- Idempotente: se puede ejecutar repetidamente sin efectos. Roles esperados
-- (creados por scripts/sql/00-roles.sql en Fase 2): master_role, app_role.
--
-- Uso:
--   psql "$MASTER_DATABASE_URL" -f scripts/sql/01-tenant-template.sql
--
-- Lo ejecuta el operador en bootstrap (Fase 8 cutover) y los tests de
-- integración (commit 17 leak test).

\set ON_ERROR_STOP on

-- 1. Schema plantilla.
CREATE SCHEMA IF NOT EXISTS tenant_template;

-- 2. Grants base. app_role debe poder usar el schema y leer/escribir las
-- tablas que se creen DENTRO de él vía `tenants:migrate -- template`.
GRANT USAGE ON SCHEMA tenant_template TO app_role;

-- DEFAULT PRIVILEGES: cuando master_role cree tablas/secuencias en
-- tenant_template, app_role recibe SELECT/INSERT/UPDATE/DELETE
-- automáticamente. ADR-001 §2.3.
ALTER DEFAULT PRIVILEGES FOR ROLE master_role IN SCHEMA tenant_template
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_role;
ALTER DEFAULT PRIVILEGES FOR ROLE master_role IN SCHEMA tenant_template
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_role;

-- Nota: tenant_template NO contiene datos productivos. Es solo estructura.
-- El comando tenants:provision (commit 12) replica esta estructura a
-- tenant_<slug> con pg_dump/pg_restore o equivalente.
