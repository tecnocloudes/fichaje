-- Fase 7 §2.4: master.audit_log para operaciones del panel super-admin.
-- Aditiva: tabla nueva. Sin impacto en tenants existentes.

CREATE TABLE "master"."audit_log" (
  "id"              TEXT PRIMARY KEY,
  "super_admin_id"  TEXT NOT NULL REFERENCES "master"."super_admins"("id"),
  "action"          TEXT NOT NULL,
  "target_kind"     TEXT NOT NULL,
  "target_id"       TEXT NOT NULL,
  "severity"        TEXT NOT NULL DEFAULT 'info',
  "summary"         JSONB NOT NULL DEFAULT '{}',
  "dump_path"       TEXT,
  "ip_address"      TEXT,
  "user_agent"      TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "audit_log_super_admin_id_idx"
  ON "master"."audit_log" ("super_admin_id");
CREATE INDEX "audit_log_target_kind_target_id_idx"
  ON "master"."audit_log" ("target_kind", "target_id");
CREATE INDEX "audit_log_severity_created_at_idx"
  ON "master"."audit_log" ("severity", "created_at" DESC);
CREATE INDEX "audit_log_created_at_idx"
  ON "master"."audit_log" ("created_at" DESC);
