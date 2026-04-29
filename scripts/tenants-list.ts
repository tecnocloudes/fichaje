/**
 * Lista los tenants registrados en master.tenants. Útil para soporte y
 * debugging. Se ejecuta con `npm run tenants:list`.
 */

import { prismaMaster } from "../src/lib/prisma";

async function main() {
  const tenants = await prismaMaster.tenant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      slug: true,
      name: true,
      status: true,
      stripeCustomerId: true,
      createdAt: true,
    },
  });

  if (tenants.length === 0) {
    console.log("(sin tenants registrados)");
    return;
  }

  console.log(`${tenants.length} tenant(s):\n`);
  console.log(
    [
      "slug".padEnd(20),
      "status".padEnd(14),
      "stripe_customer".padEnd(28),
      "created_at".padEnd(20),
      "name",
    ].join(" "),
  );
  console.log("-".repeat(110));
  for (const t of tenants) {
    console.log(
      [
        t.slug.padEnd(20),
        t.status.padEnd(14),
        (t.stripeCustomerId ?? "—").padEnd(28),
        t.createdAt.toISOString().slice(0, 19).padEnd(20),
        t.name,
      ].join(" "),
    );
  }
}

main()
  .catch((err) => {
    console.error("❌", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaMaster.$disconnect();
  });
