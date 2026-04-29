-- CreateTable
CREATE TABLE "master"."tenant_quota_usage" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "consumed" BIGINT NOT NULL DEFAULT 0,
    "max" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_quota_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_quota_usage_tenant_id_feature_key_period_end_idx" ON "master"."tenant_quota_usage"("tenant_id", "feature_key", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_quota_usage_tenant_id_feature_key_period_start_key" ON "master"."tenant_quota_usage"("tenant_id", "feature_key", "period_start");

-- AddForeignKey
ALTER TABLE "master"."tenant_quota_usage" ADD CONSTRAINT "tenant_quota_usage_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "master"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Trigger updated_at en tenant_quota_usage.
CREATE TRIGGER "tenant_quota_usage_touch_updated_at"
  BEFORE UPDATE ON "master"."tenant_quota_usage"
  FOR EACH ROW EXECUTE FUNCTION "master"."touch_updated_at"();
