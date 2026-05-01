-- Plan D.5: TenantWebhook para suscripciones outbound del tenant.

CREATE TABLE "TenantWebhook" (
  "id"            TEXT PRIMARY KEY,
  "url"           TEXT NOT NULL,
  "events"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "secret"        TEXT NOT NULL,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "last_fired_at" TIMESTAMP(3),
  "fail_count"    INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "TenantWebhook_active_idx" ON "TenantWebhook" ("active");
