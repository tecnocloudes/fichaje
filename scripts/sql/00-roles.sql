-- ─────────────────────────────────────────────────────────────────────────────
-- 00-roles.sql — Crea los roles Postgres del control plane y los privilegios
--                disjuntos sobre el schema master.
--
-- Idempotente: re-ejecutable sin errores. Solo crea roles que no existen,
-- aplica GRANTs (idempotentes) y revoca lo que no debería estar concedido.
--
-- ROLES CREADOS:
--   app_role            — usuario de la app del producto (Fase 3+).
--                         Sin acceso a master. Usará los schemas tenant_*.
--   tenant_runtime_role — middleware HTTP, hasFeature, getLimit,
--                         GET /api/me/features. SELECT-only sobre 4 tablas
--                         master. ADR-002 §3.6 + ADR-004 §2.2.
--   quota_writer_role   — exclusivo del helper consumeQuota.
--                         SELECT/INSERT/UPDATE solo sobre tenant_quota_usage.
--                         ADR-004 §2.2.
--
-- master_role NO se crea aquí — viene del setup inicial de Postgres.
--
-- USO:
--   psql -h <host> -U master_role -d fichaje \
--     -v app_role_password='****' \
--     -v tenant_runtime_role_password='****' \
--     -v quota_writer_role_password='****' \
--     -f scripts/sql/00-roles.sql
--
-- Las contraseñas son parámetros (-v). NUNCA hardcodearlas en este archivo.
-- El wrapper Node `scripts/sql/apply-roles.ts` (Fase 8) las lee de env y
-- las inyecta vía psql.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Crear los 3 roles si no existen. Usamos \gexec para idempotencia
-- porque las variables de psql (:'name') no se expanden dentro de bloques
-- DO $$ ... $$. El patrón es: SELECT 'CREATE ROLE ...' WHERE NOT EXISTS;
-- \gexec ejecuta el resultado del SELECT como SQL. Si la fila no existe,
-- el SELECT devuelve 0 filas y \gexec no hace nada.

SELECT format('CREATE ROLE app_role LOGIN PASSWORD %L', :'app_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role')
\gexec

SELECT format('CREATE ROLE tenant_runtime_role LOGIN PASSWORD %L', :'tenant_runtime_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_runtime_role')
\gexec

SELECT format('CREATE ROLE quota_writer_role LOGIN PASSWORD %L', :'quota_writer_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quota_writer_role')
\gexec

-- 2. Cierre por defecto: nadie ve master por accidente.
REVOKE ALL ON SCHEMA "master" FROM PUBLIC;

-- 3. tenant_runtime_role: SELECT sobre 4 tablas concretas. Sin escritura.
GRANT USAGE ON SCHEMA "master" TO tenant_runtime_role;
GRANT SELECT ON "master"."tenants"            TO tenant_runtime_role;
GRANT SELECT ON "master"."reserved_slugs"     TO tenant_runtime_role;
GRANT SELECT ON "master"."tenant_features"    TO tenant_runtime_role;
GRANT SELECT ON "master"."tenant_quota_usage" TO tenant_runtime_role;

-- 4. quota_writer_role: SELECT/INSERT/UPDATE solo sobre tenant_quota_usage.
--    Sin acceso a las otras tablas master ni a sus secuencias.
GRANT USAGE ON SCHEMA "master" TO quota_writer_role;
GRANT SELECT, INSERT, UPDATE ON "master"."tenant_quota_usage" TO quota_writer_role;

-- 5. app_role: SIN acceso a master.
--    Sus permisos sobre tenant_<slug> los aplica el script de provisión
--    (Fase 3) cuando crea cada schema, vía DEFAULT PRIVILEGES.
REVOKE ALL ON SCHEMA "master" FROM app_role;

-- 6. Defensa: revocar privilegios residuales que ningún rol debería tener.
REVOKE ALL ON "master"."tenants"            FROM PUBLIC;
REVOKE ALL ON "master"."reserved_slugs"     FROM PUBLIC;
REVOKE ALL ON "master"."tenant_features"    FROM PUBLIC;
REVOKE ALL ON "master"."tenant_quota_usage" FROM PUBLIC;
REVOKE ALL ON "master"."plans"              FROM PUBLIC;
REVOKE ALL ON "master"."features"           FROM PUBLIC;
REVOKE ALL ON "master"."plan_features"      FROM PUBLIC;
REVOKE ALL ON "master"."subscriptions"      FROM PUBLIC;
REVOKE ALL ON "master"."subscription_items" FROM PUBLIC;
REVOKE ALL ON "master"."stripe_events"      FROM PUBLIC;
REVOKE ALL ON "master"."super_admins"       FROM PUBLIC;

-- 7. Verificación in-line: imprime la matriz final de permisos.
--    Útil para debug; en producción se puede silenciar con \set QUIET on.
\echo '── Roles del control plane ──'
SELECT rolname, rolcanlogin
FROM pg_roles
WHERE rolname IN ('master_role', 'app_role', 'tenant_runtime_role', 'quota_writer_role')
ORDER BY rolname;

\echo '── Permisos en master.* ──'
SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'master'
  AND grantee IN ('app_role', 'tenant_runtime_role', 'quota_writer_role')
ORDER BY grantee, table_name, privilege_type;
