import { prisma } from "./prisma";

/**
 * Adds missing columns / tables introduced since the initial schema.
 * Uses IF NOT EXISTS so it's safe to call on every app start.
 */
export async function runMigrations() {
  try {
    // ── ConfiguracionEmpresa: notification columns ─────────────────────────
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ConfiguracionEmpresa"
        ADD COLUMN IF NOT EXISTS "notifAusencias"   BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "notifTurnos"       BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "notifTareas"       BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "notifFichajes"     BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "notifComunicados"  BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "emailActivo"       BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "emailHost"         TEXT,
        ADD COLUMN IF NOT EXISTS "emailPort"         INTEGER,
        ADD COLUMN IF NOT EXISTS "emailSecure"       BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "emailUser"         TEXT,
        ADD COLUMN IF NOT EXISTS "emailPassword"     TEXT,
        ADD COLUMN IF NOT EXISTS "emailFrom"         TEXT,
        ADD COLUMN IF NOT EXISTS "pushActivo"        BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "pushVapidPublicKey"  TEXT,
        ADD COLUMN IF NOT EXISTS "pushVapidPrivateKey" TEXT;
    `);

    // ── ConfiguracionEmpresa: branding columns ─────────────────────────────
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ConfiguracionEmpresa"
        ADD COLUMN IF NOT EXISTS "favicon"       TEXT,
        ADD COLUMN IF NOT EXISTS "colorPrimario" TEXT NOT NULL DEFAULT '#6366f1',
        ADD COLUMN IF NOT EXISTS "colorSidebar"  TEXT NOT NULL DEFAULT '#1e1b4b',
        ADD COLUMN IF NOT EXISTS "appNombre"     TEXT NOT NULL DEFAULT 'TelecomFichaje';
    `);

    // ── PreferenciasNotificacion table ─────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PreferenciasNotificacion" (
        "id"               TEXT NOT NULL,
        "userId"           TEXT NOT NULL,
        "inAppAusencias"   BOOLEAN NOT NULL DEFAULT true,
        "inAppTurnos"      BOOLEAN NOT NULL DEFAULT true,
        "inAppTareas"      BOOLEAN NOT NULL DEFAULT true,
        "inAppFichajes"    BOOLEAN NOT NULL DEFAULT false,
        "inAppComunicados" BOOLEAN NOT NULL DEFAULT true,
        "emailAusencias"   BOOLEAN NOT NULL DEFAULT true,
        "emailTurnos"      BOOLEAN NOT NULL DEFAULT true,
        "emailTareas"      BOOLEAN NOT NULL DEFAULT false,
        "emailFichajes"    BOOLEAN NOT NULL DEFAULT false,
        "emailComunicados" BOOLEAN NOT NULL DEFAULT false,
        "pushAusencias"    BOOLEAN NOT NULL DEFAULT true,
        "pushTurnos"       BOOLEAN NOT NULL DEFAULT true,
        "pushTareas"       BOOLEAN NOT NULL DEFAULT true,
        "pushFichajes"     BOOLEAN NOT NULL DEFAULT false,
        "pushComunicados"  BOOLEAN NOT NULL DEFAULT false,
        "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PreferenciasNotificacion_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'PreferenciasNotificacion_userId_key'
        ) THEN
          ALTER TABLE "PreferenciasNotificacion"
            ADD CONSTRAINT "PreferenciasNotificacion_userId_key" UNIQUE ("userId");
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'PreferenciasNotificacion_userId_fkey'
        ) THEN
          ALTER TABLE "PreferenciasNotificacion"
            ADD CONSTRAINT "PreferenciasNotificacion_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    // ── PushSubscripcion table ─────────────────────────────────────────────
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PushSubscripcion" (
        "id"        TEXT NOT NULL,
        "userId"    TEXT NOT NULL,
        "endpoint"  TEXT NOT NULL,
        "p256dh"    TEXT NOT NULL,
        "auth"      TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PushSubscripcion_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'PushSubscripcion_endpoint_key'
        ) THEN
          ALTER TABLE "PushSubscripcion"
            ADD CONSTRAINT "PushSubscripcion_endpoint_key" UNIQUE ("endpoint");
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'PushSubscripcion_userId_fkey'
        ) THEN
          ALTER TABLE "PushSubscripcion"
            ADD CONSTRAINT "PushSubscripcion_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "PushSubscripcion_userId_idx" ON "PushSubscripcion"("userId");
    `);

  } catch (err) {
    // Log but don't crash — if DB isn't ready yet it'll retry on next request
    console.error("[migrate] Error running lazy migrations:", err);
  }
}
