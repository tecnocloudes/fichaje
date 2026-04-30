// Prisma 7 config para el schema del producto (modelos por tenant).
// Fase 3 — ADR-002 §2.2.
//
// Uso:
//   npx prisma validate --config prisma.config.tenant.ts
//   npx prisma generate --config prisma.config.tenant.ts
//   npx prisma migrate dev   --config prisma.config.tenant.ts --name <X>
//   npx prisma migrate deploy --config prisma.config.tenant.ts
//
// El comando `tenants:migrate <slug>` (commit 13) consumirá esto y modulará
// la connection string para añadir `?options=-csearch_path%3Dtenant_<slug>` o
// reescribirá APP_DATABASE_URL con `?schema=tenant_<slug>` antes del deploy.
//
// `prisma.config.ts` (sin sufijo) sigue gestionando el control plane
// (`prisma/schema.prisma`) y `prisma/migrations/`. Los dos configs son
// independientes — cada uno con su schema, su carpeta de migraciones y su
// connection string.

import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema-tenant.prisma",
  migrations: {
    path: "prisma/migrations-tenant",
  },
  datasource: {
    url: process.env["APP_DATABASE_URL"],
  },
});
