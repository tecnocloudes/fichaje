# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# empleaIA — Dockerfile multi-stage para Next.js 16 + Prisma multi-tenant.
#
# Stages:
#   1) base       — node 22 alpine + libs nativas (openssl, libc6-compat, tini)
#   2) deps-prod  — solo deps de runtime (incluye tsx, pg, dotenv, prisma CLI)
#   3) builder    — instala todo + next build standalone
#   4) runner     — imagen final no-root, standalone + node_modules de prod
#
# Build: docker build -t empleaia-app:test .
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl ca-certificates wget tini bash

# ─── 2) deps-prod ────────────────────────────────────────────────────────────
# Instala TODO (postinstall corre `prisma generate`, requiere prisma CLI y
# schemas), después poda devDeps. Resultado: node_modules solo de runtime
# con prisma + tsx + pg + dotenv generados.
FROM base AS deps-prod
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY prisma.config.ts prisma.config.tenant.ts ./
RUN npm ci --no-audit --no-fund \
  && npx prisma generate --schema=prisma/schema-tenant.prisma \
  && npm prune --omit=dev

# ─── 3) builder ──────────────────────────────────────────────────────────────
# Instalación completa + next build standalone. Output: .next/standalone,
# .next/static.
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY prisma.config.ts prisma.config.tenant.ts ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx prisma generate --schema=prisma/schema-tenant.prisma \
  && npm run build

# ─── 4) runner ───────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Output standalone (trae server.js + minimal node_modules para correr Next).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# node_modules completo de runtime (sobre los standalone) — necesario para
# `prisma migrate deploy`, `tsx scripts/tenants-migrate.ts`, `pg`, `dotenv`.
# El standalone trae lo mínimo del bundle, pero falta tsx + dotenv + el
# CLI de prisma para el entrypoint.
COPY --from=deps-prod --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=deps-prod --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=deps-prod --chown=nextjs:nodejs /app/package-lock.json ./package-lock.json

# Clientes Prisma generados (los importa el código en runtime).
COPY --from=builder --chown=nextjs:nodejs /app/src/generated ./src/generated
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.tenant.ts ./prisma.config.tenant.ts

# src/lib/ — necesario en runtime para que tsx pueda resolver
# `../src/lib/...` desde scripts/tenants-migrate.ts (commit 1646439:
# alias @/ → paths relativos). El standalone de Next solo trae el
# bundle compilado, no las fuentes TS, así que las copiamos aparte.
COPY --from=builder --chown=nextjs:nodejs /app/src/lib ./src/lib

# Scripts ejecutados con tsx en runtime + SQL idempotente.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/tenants-migrate.ts ./scripts/tenants-migrate.ts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/sql ./scripts/sql

# tsconfig — todavía referenciado por algunas dependencias de tsx.
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

# Entrypoint.
COPY --chown=nextjs:nodejs scripts/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--", "./entrypoint.sh"]
CMD ["node", "server.js"]
