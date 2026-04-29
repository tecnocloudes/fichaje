-- CreateTable
CREATE TABLE "master"."plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."features" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "master"."FeatureType" NOT NULL,
    "quota_period" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master"."plan_features" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "master"."plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "features_key_key" ON "master"."features"("key");

-- CreateIndex
CREATE UNIQUE INDEX "plan_features_plan_id_feature_key_key" ON "master"."plan_features"("plan_id", "feature_key");

-- AddForeignKey
ALTER TABLE "master"."plan_features" ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "master"."plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CHECK: quota_period solo aplicable si type='quota'.
ALTER TABLE "master"."features"
  ADD CONSTRAINT "features_quota_period_consistency_check"
  CHECK (
    ("type" = 'quota' AND "quota_period" IS NOT NULL)
    OR
    ("type" <> 'quota' AND "quota_period" IS NULL)
  );

-- CHECK: quota_period solo admite 'mes' o 'dia' si está presente.
ALTER TABLE "master"."features"
  ADD CONSTRAINT "features_quota_period_values_check"
  CHECK ("quota_period" IS NULL OR "quota_period" IN ('mes', 'dia'));

-- Triggers updated_at.
CREATE TRIGGER "plans_touch_updated_at"
  BEFORE UPDATE ON "master"."plans"
  FOR EACH ROW EXECUTE FUNCTION "master"."touch_updated_at"();

CREATE TRIGGER "features_touch_updated_at"
  BEFORE UPDATE ON "master"."features"
  FOR EACH ROW EXECUTE FUNCTION "master"."touch_updated_at"();
