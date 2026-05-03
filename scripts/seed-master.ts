#!/usr/bin/env node
/**
 * seed:master — corre solo el seed del control plane (planes, features,
 * plan_features, reserved_slugs). Idempotente, NO toca datos del
 * producto en `tenant_*`.
 *
 * Útil para refrescar el catálogo en local/staging sin destruir los
 * tenants. En despliegues productivos se invoca como job aparte:
 *
 *   npx tsx scripts/seed-master.ts
 *
 * Variables: MASTER_DATABASE_URL (o DATABASE_URL como fallback).
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedMaster } from "../prisma/seeds/master";

const url = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("seed:master requiere MASTER_DATABASE_URL o DATABASE_URL.");
  process.exit(2);
}

const adapter = new PrismaPg({ connectionString: url });
const prisma = new PrismaClient({ adapter });

(async () => {
  await seedMaster(prisma);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
