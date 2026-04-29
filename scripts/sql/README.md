# `scripts/sql/`

Scripts SQL del control plane que **NO** se ejecutan automáticamente con
`prisma migrate deploy`. Son operaciones de superadmin que viven fuera del
flujo de Prisma porque tocan roles del cluster (no del schema).

## `00-roles.sql`

Crea los 3 roles Postgres del control plane (`app_role`,
`tenant_runtime_role`, `quota_writer_role`) y aplica los `GRANT`/`REVOKE`
exactos según ADR-001 §2.3, ADR-002 §3.6, ADR-004 §2.2.

**Idempotente**: re-ejecutable sin errores.

**No se ejecuta en Fase 2**. Se aplica en el cutover de Fase 8 (ADR-005
§5.4 paso d) con un wrapper Node que inyecta las contraseñas desde env:

```sh
# Fase 8 (cutover en Dokploy)
APP_ROLE_PASSWORD=*** \
TENANT_RUNTIME_ROLE_PASSWORD=*** \
QUOTA_WRITER_ROLE_PASSWORD=*** \
  npx tsx scripts/sql/apply-roles.ts
```

El wrapper `apply-roles.ts` (a redactar en Fase 8) hace:

1. Lee las 3 envs.
2. Conecta como `master_role` con `MASTER_DATABASE_URL`.
3. Ejecuta `00-roles.sql` con `psql` y `-v` para los placeholders.
4. Imprime la matriz de permisos resultante para verificación visual.

Las contraseñas **nunca** entran al repo. El `.env.example`
de Fase 2 documenta los nombres de las variables (commit 14).
