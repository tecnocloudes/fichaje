#!/usr/bin/env node
/**
 * tenants:provision — crea un tenant nuevo en BD (sin Stripe).
 *
 * Pasos (ADR-003 §2.6, simplificado para Fase 3 sin checkout):
 *  1. Validar slug (regex + reserved_slugs).
 *  2. Validar plan_key (existe en master.plans).
 *  3-5. provisionTenantSchema(slug) — extraído a src/lib/tenant/provision.ts
 *       en commit 5 de Fase 4 para que webhook handler y CLI compartan.
 *  6. INSERT en master.tenants con status=ACTIVE + sentinels Stripe.
 *  7. INSERT TenantFeature por cada PlanFeature (source='plan').
 *  8. INSERT TenantQuotaUsage iniciales para features quota del plan.
 *
 * Idempotente: si el tenant existe con status=ACTIVE → exit 0
 * informando. Si existe en PROVISIONING → continúa desde donde se
 * quedó (ADR-003 §5.2).
 *
 * Uso:
 *   npm run tenants:provision -- <slug> <plan_key>
 *
 * Ejemplo:
 *   npm run tenants:provision -- acme starter
 */

import "dotenv/config";
import { isValidTenantSlug } from "@/lib/tenant/quote";
import { prismaMaster } from "@/lib/prisma";
import { provisionTenantSchema } from "@/lib/tenant/provision";
import { computeCurrentPeriod, isQuotaPeriod } from "@/lib/feature-guard/period";

const USAGE = `
tenants:provision <slug> <plan_key>

Crea un tenant en master.tenants + schema tenant_<slug> + features
del plan + quotas iniciales. Sin Stripe (Fase 4 lo añade).

Argumentos:
  <slug>      slug del tenant (regex ^[a-z][a-z0-9_]{2,30}$).
  <plan_key>  starter | pro | enterprise.

Ejemplo:
  npm run tenants:provision -- acme starter
`.trim();

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.length < 2) {
    console.error(USAGE);
    process.exit(2);
  }
  const [slug, planKey] = args as [string, string];

  if (!isValidTenantSlug(slug)) {
    console.error(`Slug "${slug}" no cumple ^[a-z][a-z0-9_]{2,30}$`);
    process.exit(2);
  }

  // 1. reserved_slugs check.
  const reserved = await prismaMaster.reservedSlug.findUnique({ where: { slug } });
  if (reserved) {
    console.error(`Slug "${slug}" reservado: ${reserved.reason}`);
    process.exit(2);
  }

  // 2. Plan existe.
  const plan = await prismaMaster.plan.findUnique({
    where: { key: planKey },
    include: { planFeatures: true },
  });
  if (!plan || !plan.active) {
    console.error(`Plan "${planKey}" no existe o no está activo.`);
    process.exit(2);
  }

  // 3. Tenant existente?
  const existing = await prismaMaster.tenant.findUnique({ where: { slug } });
  if (existing && existing.status === "active") {
    console.log(`✓ tenant "${slug}" ya existe (status=ACTIVE). Nada que hacer.`);
    process.exit(0);
  }

  // 4-5. provisión del schema (delegada).
  console.log(`→ provisionTenantSchema "${slug}"`);
  await provisionTenantSchema(slug);

  // 6. INSERT master.tenants si no existe.
  let tenant = existing;
  if (!tenant) {
    tenant = await prismaMaster.tenant.create({
      data: {
        slug,
        name: slug,
        email: `admin@${slug}.local`,
        status: "active",
      },
    });
    console.log(`→ INSERT master.tenants id=${tenant.id} slug=${slug} status=active`);
  } else if (tenant.status === "provisioning" || tenant.status === "pending") {
    tenant = await prismaMaster.tenant.update({
      where: { id: tenant.id },
      data: { status: "active" },
    });
    console.log(`→ UPDATE master.tenants id=${tenant.id} status=active`);
  }

  // 7. tenant_features (source='plan').
  for (const pf of plan.planFeatures) {
    await prismaMaster.tenantFeature.upsert({
      where: {
        tenantId_featureKey_source: {
          tenantId: tenant.id,
          featureKey: pf.featureKey,
          source: "plan",
        },
      },
      create: {
        tenantId: tenant.id,
        featureKey: pf.featureKey,
        value: pf.value as never,
        source: "plan",
      },
      update: { value: pf.value as never },
    });
  }
  console.log(`→ ${plan.planFeatures.length} tenant_features (source=plan)`);

  // 8. tenant_quota_usage iniciales para quotas del plan.
  const quotas = await prismaMaster.feature.findMany({
    where: { type: "quota", key: { in: plan.planFeatures.map((p) => p.featureKey) } },
  });
  for (const q of quotas) {
    const pf = plan.planFeatures.find((p) => p.featureKey === q.key);
    if (!pf) continue;
    if (!isQuotaPeriod(q.quotaPeriod)) {
      throw new Error(
        `Feature quota ${q.key} con quota_period inválido: ${JSON.stringify(q.quotaPeriod)}`,
      );
    }
    const { start: periodStart, end: periodEnd } = computeCurrentPeriod(q.quotaPeriod);
    const max = typeof pf.value === "number" ? BigInt(pf.value) : null;
    await prismaMaster.tenantQuotaUsage.upsert({
      where: {
        tenantId_featureKey_periodStart: {
          tenantId: tenant.id,
          featureKey: q.key,
          periodStart,
        },
      },
      create: {
        tenantId: tenant.id,
        featureKey: q.key,
        periodStart,
        periodEnd,
        consumed: BigInt(0),
        max,
      },
      update: { max },
    });
  }
  console.log(`→ ${quotas.length} tenant_quota_usage iniciales`);

  console.log(`\n✅ tenant "${slug}" provisionado en plan "${planKey}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
