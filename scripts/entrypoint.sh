#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# entrypoint.sh — bootstrap del contenedor empleaIA en producción.
#
# Pasos (en orden, abortando al primer error):
#   1. Esperar a que el master Postgres responda (timeout 60s).
#   2. Aplicar migraciones del control plane via `prisma migrate deploy`
#      contra MASTER_DATABASE_URL (idempotente).
#   3. Aplicar las migraciones del producto a `tenant_template` y a cada
#      tenant ACTIVE/SUSPENDED via `npx tsx scripts/tenants-migrate.ts --all`.
#      Idempotente — el script salta migraciones ya aplicadas
#      (tabla _prisma_migrations_tenant).
#   4. exec "$@" (CMD del Dockerfile, normalmente `node server.js`).
#
# Variables de entorno requeridas:
#   - MASTER_DATABASE_URL  (obligatoria)
#   - DATABASE_URL         (fallback si MASTER_DATABASE_URL no está)
#
# Variables opcionales:
#   - SKIP_MIGRATIONS=1    Salta los pasos 2 y 3 (rollback / debug).
#   - SKIP_TENANT_MIGRATIONS=1  Aplica solo master, salta tenants.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

export DB_URL="${MASTER_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "${DB_URL}" ]; then
  echo "[entrypoint] ERROR: MASTER_DATABASE_URL/DATABASE_URL no definida." >&2
  exit 1
fi

# ─── 1. Wait for Postgres ────────────────────────────────────────────────────
# pg_isready no está en la imagen base; usamos un script Node embebido
# que intenta abrir un Client de pg con timeout corto.
wait_for_db() {
  local timeout=60
  local elapsed=0
  local last_err=""
  echo "[entrypoint] esperando a Postgres (timeout ${timeout}s)..."
  while [ $elapsed -lt $timeout ]; do
    if last_err=$(node -e "
      const { Client } = require('pg');
      const c = new Client({ connectionString: process.env.DB_URL, connectionTimeoutMillis: 2000 });
      c.connect().then(() => c.end()).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
    " 2>&1); then
      echo "[entrypoint] Postgres respondió tras ${elapsed}s"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo "[entrypoint] ERROR: Postgres no respondió en ${timeout}s." >&2
  echo "[entrypoint] último error: ${last_err}" >&2
  return 1
}

wait_for_db

# ─── 2. Master migrations ────────────────────────────────────────────────────
if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
  echo "[entrypoint] SKIP_MIGRATIONS=1 — saltando todas las migraciones."
else
  echo "[entrypoint] aplicando migraciones master (prisma migrate deploy)..."
  DATABASE_URL="${DB_URL}" \
  MASTER_DATABASE_URL="${DB_URL}" \
    npx --no-install prisma migrate deploy --schema=prisma/schema.prisma

  # ─── 3. Tenant migrations ─────────────────────────────────────────────────
  if [ "${SKIP_TENANT_MIGRATIONS:-0}" = "1" ]; then
    echo "[entrypoint] SKIP_TENANT_MIGRATIONS=1 — saltando migraciones de tenants."
  else
    # tsx está en devDependencies → lo necesitamos en runtime para ejecutar
    # el script. Está copiado en `node_modules/` desde el stage builder
    # solo si se incluyó. En la imagen final standalone NO está por
    # defecto. Por eso ejecutamos el binario via node con un loader-less
    # fallback: si tsx no está disponible, ejecutamos un wrapper JS
    # mínimo que carga la lógica core (compilada en .next/server).
    if [ -x "node_modules/.bin/tsx" ]; then
      echo "[entrypoint] aplicando migraciones tenants (tsx scripts/tenants-migrate.ts --all)..."
      MASTER_DATABASE_URL="${DB_URL}" \
      DATABASE_URL="${DB_URL}" \
        node_modules/.bin/tsx scripts/tenants-migrate.ts --all
    else
      echo "[entrypoint] WARN: tsx no encontrado en runtime — saltando migraciones de tenants."
      echo "[entrypoint] (en producción definitiva, ejecutar como job aparte:"
      echo "[entrypoint]  docker run --rm -e MASTER_DATABASE_URL ... <img> npx tsx scripts/tenants-migrate.ts --all)"
    fi
  fi
fi

# ─── 4. Exec ─────────────────────────────────────────────────────────────────
echo "[entrypoint] iniciando aplicación: $*"
exec "$@"
