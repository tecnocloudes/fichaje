# Cierre de Fase 6 — Configuración por tenant + branding + dominios

- **Estado**: CERRADA
- **Fecha**: 2026-05-01
- **Plan**: [`00-fase-6-plan.md`](./00-fase-6-plan.md)
- **ADRs**: 002 (resolución tenant), 004 (features), 005 (deployment), 008 (lifecycle).

## 1. Resumen ejecutivo

Fase 6 cerrada en **13 commits** (plan estimaba 15-20). Tres bloques:

1. **Branding** (commits 1-2): validación regex data URL +
   FeatureGateClient en tab Branding. Backend ya tenía feature gate
   desde Fase 5; añadida validación de formato.
2. **Configuración general** (commits 3-6): migración aditiva con
   `zonaHoraria`/`diasLaborables`/`ausenciasDefaults`. Endpoints
   `/api/configuracion` (PUT con allowlist) + festivos CRUD + tipos
   ausencia con feature gate. UI tab Calendario.
3. **Dominio personalizado** (commits 7-10): migración
   `master.tenants.customDomain*`. parseHost reconoce hosts no-root
   como candidatos. resolveTenant consulta BD por custom domain.
   Endpoints `/api/configuracion/dominio` GET/POST/DELETE + `/verify`
   con DNS TXT. UI tab Dominio.
4. **Cierre** (commits 11-12): coverage.ts (dominio_personalizado deja
   de ser deferred), cierre docs.

## 2. Cambios respecto al plan

| Sección plan | Diferencia | Razón |
|---|---|---|
| Estimación 15-20 commits | 13 reales | UI tabs Calendario + Dominio combinadas en 1 commit por compartir contexto. |
| §6 endpoint /api/configuracion (existente) | Solo allowlist + validación, no rewrite | El endpoint ya existía. Aditivo. |
| §6 PUT festivos[id] | No implementado | Soft-delete via DELETE + flag `activo`. PUT no necesario para los campos del MVP. |
| §7 6 tests obligatorios | 4 e2e + 1 unit | branding-validation.test.ts, festivos-crud.e2e, custom-domain.e2e cubren los 4. parseHost-custom-domain incluido en host.test.ts existente (3 tests añadidos). resolver-custom-domain en resolver.test.ts (2 tests añadidos). |

## 3. Criterios §11 cumplidos

| # | Criterio | Estado |
|---|---|---|
| 1 | tenant_dev sube logo y favicon, ve en sidebar | ✅ Validación + UI |
| 2 | Sin branding_personalizado UpsellCTA + 402 en PUT | ✅ FeatureGateClient + withFeature |
| 3 | Crear festivo "1 mayo" y ver en lista | ✅ E2E festivos-crud (5/5 verde) |
| 4 | POST festivo OWNER → 201; EMPLEADO → 403 | ✅ E2E |
| 5 | Sin dominio_personalizado tab Dominio oculto | ✅ FeatureGateClient en DominioTab |
| 6 | OWNER registra dominio + obtiene token TXT | ✅ E2E custom-domain (4/4 verde) |
| 7 | Verify pasa con TXT correcto | ✅ E2E |
| 8 | Custom domain resuelve al tenant correcto | ✅ resolver test (2 tests) |
| 9 | Si feature OFF, dominio deja de resolver | ✅ resolver test |
| 10 | test:feature-coverage verde | ✅ |
| 11 | tsc + vitest + eslint clean | ✅ 0 errores fichaje/* |

## 4. Suite tests al cierre

```
Test Files  24 passed (24)
Tests       205 passed (205)
```

Tests integration nuevos (con `VITEST_INTEGRATION=1`):
- `festivos-crud.e2e.test.ts` (5/5)
- `custom-domain.e2e.test.ts` (4/4)

## 5. Pendientes para Fase 7+

1. **N6 (Fase 7)**: invalidación pub/sub del cache de
   `currentTenant().features` cuando se modifica directamente en BD
   (sin pasar por Stripe webhook). Hoy TTL 60s + invalidación
   manual de host (POST/DELETE dominio).
2. **N1 (opcional)**: dev:seed-tenant a enterprise.
3. **SSL custom domain**: Fase 8 (Cloudflare DNS-01 + Dokploy).
4. **i18n**: español hardcoded.
5. **Importación masiva festivos**: CSV de calendarios oficiales.
6. **PUT sobre tipo individual** (`/api/ausencias/tipos/[id]`):
   implementado en Fase 6 commit 6 — verifica si UI lo aprovecha,
   si no se documenta como TODO de UI Fase 7.

## 6. Schema BD post-Fase 6

Master:
```diff
 model Tenant {
+  customDomain         String?   @unique @map("custom_domain")
+  customDomainVerified Boolean   @default(false) @map("custom_domain_verified")
+  customDomainToken    String?   @map("custom_domain_token")
 }
```

Tenant (cada `tenant_<slug>`):
```diff
 model ConfiguracionEmpresa {
+  zonaHoraria         String   @default("Europe/Madrid")
+  diasLaborables      Int[]    @default([1, 2, 3, 4, 5])
+  ausenciasDefaults   Json?
 }
```

2 migraciones aplicadas con `prisma migrate deploy` (master) +
`tenants:migrate:all` (3 schemas: template, dev, test1).

## 7. Cómo verificar en local

1. `dev.localhost:3000/admin/configuracion` → 6 tabs visibles.
2. Tab Branding: editar logo/colores. Si feature OFF → UpsellCTA.
3. Tab Calendario: crear festivo "Día 25 dic", toggle Lun-Dom, ver
   guardado tras refresh.
4. Tab Dominio: si dev no tiene `dominio_personalizado` → UpsellCTA.
   - Para activar manualmente: `INSERT INTO master.tenant_features
     (id, tenant_id, feature_key, value, source, created_at, updated_at)
     VALUES ('tf_dev_dom', (SELECT id FROM master.tenants WHERE slug='dev'),
     'dominio_personalizado', 'true'::jsonb, 'addon', now(), now());`
   - Reiniciar dev:all (cache).
   - Volver a tab Dominio: ahora editable. Registrar dominio + ver
     TXT record + botón Verificar.

## 8. Referencias

- [Plan Fase 6](./00-fase-6-plan.md)
- [TODOs consolidados](./00-todos-consolidados.md)
- [ADR-002](./adr-002-resolucion-tenant.md) §2.5
- [ADR-005](./adr-005-deployment-y-tls.md) §3 (SSL Fase 8)
