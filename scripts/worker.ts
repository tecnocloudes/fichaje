#!/usr/bin/env node
/**
 * Worker process — jobs programados de Fase 4. ADR-003 §5.2.
 *
 * Corre en proceso separado (decisión §15.9 del plan). En desarrollo
 * lo arranca `npm run dev:all` (concurrently) junto a Next dev. En
 * producción Fase 8 será un servicio Dokploy aparte.
 *
 * Dos jobs:
 *   1. cleanup-pending-tenants — cada hora, DELETE PENDING > 24h.
 *   2. detect-provisioning-stuck — cada 5 min, escalar PROVISIONING
 *      huérfanos.
 */

import "dotenv/config";
import cron from "node-cron";
import { cleanupPendingTenants } from "../src/lib/worker/jobs/cleanup-pending";
import { detectProvisioningStuck } from "../src/lib/worker/jobs/detect-provisioning-stuck";

console.log("[worker] arrancando…");

// Cleanup PENDING > 24h, cada hora en :00.
cron.schedule("0 * * * *", async () => {
  console.log("[cron] cleanup-pending-tenants");
  try {
    const deleted = await cleanupPendingTenants();
    if (deleted > 0) {
      console.log(`[cron] cleanup: ${deleted} tenants PENDING borrados`);
    }
  } catch (err) {
    console.error("[cron] cleanup error:", err);
  }
});

// Detect PROVISIONING > 10 min, cada 5 minutos.
cron.schedule("*/5 * * * *", async () => {
  console.log("[cron] detect-provisioning-stuck");
  try {
    const stuck = await detectProvisioningStuck();
    if (stuck.length > 0) {
      console.warn(
        `[cron] ${stuck.length} tenants PROVISIONING huérfanos:`,
        stuck.map((s) => s.slug).join(", "),
      );
    }
  } catch (err) {
    console.error("[cron] detect error:", err);
  }
});

console.log("[worker] cron schedules activos:");
console.log("  - cleanup-pending-tenants: cada hora");
console.log("  - detect-provisioning-stuck: cada 5 minutos");

// Mantener vivo el proceso (cron no lo hace por sí mismo en CommonJS).
process.on("SIGINT", () => {
  console.log("[worker] SIGINT recibido, parando…");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM recibido, parando…");
  process.exit(0);
});
