import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Plugin local con reglas custom — Fase 3 + Fase 5.
 *
 * Fase 3 commit 18:
 *  - `no-legacy-prisma`: prohíbe importar `prisma` o `prismaMaster` desde
 *    src/app/api/** (con whitelist).
 *
 * Fase 5 commit 16:
 *  - `no-feature-gate-on-core`: prohíbe `withFeature`/`withQuota`/
 *    `consumeQuota` en handlers del CORE (registro de jornada).
 *    Permite `hasFeature`/`getLimit` porque NO rechazan el fichaje
 *    (solo modifican comportamiento, ver plan §5.1 + §6.1).
 *  - `no-quota-writer-leak`: prohíbe `import { prismaQuotaWriter }`
 *    fuera de `src/lib/tenant/features.ts`. ADR-004 §2.2.
 *  - `route-must-use-withTenant`: rutas en src/app/api/** con export
 *    HTTP (GET, POST, ...) deben envolver el handler con `withTenant`.
 *    Whitelist: /api/auth, /api/webhooks, /api/onboarding, /api/health,
 *    /api/admin (panel super-admin).
 */
const fichajePlugin = {
  rules: {
    "no-legacy-prisma": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Prohíbe importar `prisma` o `prismaMaster` en src/app/api/** salvo whitelist.",
        },
        schema: [],
      },
      create(context) {
        const EXEMPT_PATHS = [
          "/api/auth/",
          "/api/webhooks/",
          "/api/onboarding/",
        ];
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "@/lib/prisma") return;
            const filename = context.filename || context.getFilename();
            const relevant =
              filename.includes("/src/app/api/") ||
              filename.includes("\\src\\app\\api\\");
            if (!relevant) return;
            const isExempt = EXEMPT_PATHS.some((p) => filename.includes(p));
            if (isExempt) return;
            for (const spec of node.specifiers) {
              if (spec.type !== "ImportSpecifier") continue;
              const name = spec.imported && spec.imported.name;
              if (name === "prisma" || name === "prismaMaster") {
                context.report({
                  node: spec,
                  message: `'${name}' no debe importarse en src/app/api/**. Usa 'prismaApp' (operaciones del tenant) o 'prismaRuntime'/'prismaQuotaWriter' según el caso. ADR-002 §2.2.`,
                });
              }
            }
          },
        };
      },
    },

    "no-feature-gate-on-core": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Prohíbe withFeature/withQuota/consumeQuota en handlers del CORE (registro de jornada). RD 8/2019 obliga a que el registro de jornada sea SIEMPRE accesible. hasFeature/getLimit sí están permitidos porque solo modifican comportamiento (ver fichajes/route.ts: geofencing + historial_meses).",
        },
        schema: [],
      },
      create(context) {
        const CORE_PATHS = [
          "/src/app/api/fichajes/",
          "/src/app/api/empleado/fichajes/",
          "/src/app/api/empleado/registro/",
          "/src/app/api/fichaje/registro-legal/",
        ];
        const filename = context.filename || context.getFilename();
        const isCore = CORE_PATHS.some((p) =>
          filename.includes(p) || filename.includes(p.replaceAll("/", "\\")),
        );
        if (!isCore) return {};
        const FORBIDDEN = new Set(["withFeature", "withQuota", "consumeQuota"]);
        return {
          ImportSpecifier(node) {
            const name = node.imported && node.imported.name;
            if (FORBIDDEN.has(name)) {
              context.report({
                node,
                message: `'${name}' no puede usarse en handlers del CORE (${filename}). RD 8/2019: el registro de jornada debe ser SIEMPRE accesible. Si necesitas modificar comportamiento sin rechazar, usa 'hasFeature'/'getLimit'.`,
              });
            }
          },
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type === "Identifier" && FORBIDDEN.has(callee.name)) {
              context.report({
                node: callee,
                message: `'${callee.name}()' no puede usarse en handlers del CORE. RD 8/2019.`,
              });
            }
          },
        };
      },
    },

    "no-quota-writer-leak": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Prohíbe importar `prismaQuotaWriter` fuera de src/lib/tenant/features.ts. Solo `consumeQuota` debe escribir tenant_quota_usage. ADR-004 §2.2.",
        },
        schema: [],
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "@/lib/prisma") return;
            const filename = context.filename || context.getFilename();
            const isAllowed =
              filename.endsWith("/src/lib/tenant/features.ts") ||
              filename.endsWith("\\src\\lib\\tenant\\features.ts");
            for (const spec of node.specifiers) {
              if (spec.type !== "ImportSpecifier") continue;
              const name = spec.imported && spec.imported.name;
              if (name === "prismaQuotaWriter" && !isAllowed) {
                context.report({
                  node: spec,
                  message:
                    "'prismaQuotaWriter' solo puede importarse en src/lib/tenant/features.ts. Para consumir cuotas, usa la función exportada `consumeQuota`. ADR-004 §2.2.",
                });
              }
            }
          },
        };
      },
    },

    "route-must-use-withTenant": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Los exports HTTP en src/app/api/** (GET/POST/PUT/PATCH/DELETE) deben envolver el handler con withTenant. Whitelist: /api/auth, /api/webhooks, /api/onboarding, /api/health, /api/admin.",
        },
        schema: [],
      },
      create(context) {
        const EXEMPT_PATHS = [
          "/api/auth/",
          "/api/webhooks/",
          "/api/onboarding/",
          "/api/health/",
          "/api/admin/",
        ];
        const filename = context.filename || context.getFilename();
        const relevant =
          filename.includes("/src/app/api/") ||
          filename.includes("\\src\\app\\api\\");
        if (!relevant) return {};
        const isExempt = EXEMPT_PATHS.some((p) => filename.includes(p));
        if (isExempt) return {};
        const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
        return {
          ExportNamedDeclaration(node) {
            const decl = node.declaration;
            if (!decl || decl.type !== "VariableDeclaration") return;
            for (const v of decl.declarations) {
              if (v.id.type !== "Identifier") continue;
              if (!HTTP.has(v.id.name)) continue;
              const init = v.init;
              if (!init) continue;
              // Buscar primera CallExpression cuyo callee sea Identifier 'withTenant'.
              let cur = init;
              let found = false;
              for (let depth = 0; depth < 5 && cur; depth++) {
                if (cur.type !== "CallExpression") break;
                const callee = cur.callee;
                if (callee.type === "Identifier" && callee.name === "withTenant") {
                  found = true;
                  break;
                }
                cur = cur.arguments && cur.arguments[0];
              }
              if (!found) {
                context.report({
                  node: v.id,
                  message: `'export const ${v.id.name} = ...' debe envolver el handler con 'withTenant(...)'. ADR-002 §6 + plan Fase 3 §11.`,
                });
              }
            }
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
  {
    plugins: { fichaje: fichajePlugin },
    rules: {
      "fichaje/no-legacy-prisma": "error",
      "fichaje/no-feature-gate-on-core": "error",
      "fichaje/no-quota-writer-leak": "error",
      "fichaje/route-must-use-withTenant": "error",
    },
  },
  // Tests: las reglas custom NO aplican (los tests importan/mockean
  // los clientes Prisma para configurar mocks).
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.integration.test.ts"],
    rules: {
      "fichaje/no-legacy-prisma": "off",
      "fichaje/no-quota-writer-leak": "off",
      "fichaje/route-must-use-withTenant": "off",
    },
  },
]);

export default eslintConfig;
