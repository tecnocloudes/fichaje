-- CreateTable
CREATE TABLE "master"."super_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "master"."PlatformRol" NOT NULL DEFAULT 'SUPER_ADMIN',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "super_admins_email_key" ON "master"."super_admins"("email");


-- Trigger updated_at en super_admins.
CREATE TRIGGER "super_admins_touch_updated_at"
  BEFORE UPDATE ON "master"."super_admins"
  FOR EACH ROW EXECUTE FUNCTION "master"."touch_updated_at"();
