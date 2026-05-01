-- Plan D.1: master.api_tokens para auth de /api/v1/**.
-- Aditiva. tenant_id FK con CASCADE para que purge tenant elimine tokens.

CREATE TABLE "master"."api_tokens" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL REFERENCES "master"."tenants"("id") ON DELETE CASCADE,
  "name"         TEXT NOT NULL,
  "prefix"       TEXT NOT NULL UNIQUE,
  "token_hash"   TEXT NOT NULL,
  "last_used_at" TIMESTAMP(3),
  "expires_at"   TIMESTAMP(3),
  "revoked_at"   TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" TEXT
);

CREATE INDEX "api_tokens_tenant_id_idx" ON "master"."api_tokens" ("tenant_id");
CREATE INDEX "api_tokens_prefix_idx" ON "master"."api_tokens" ("prefix");
