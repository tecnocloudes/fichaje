import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Plugin local con reglas custom de Fase 3.
 *
 * `no-legacy-prisma`: prohíbe importar `prisma` o `prismaMaster` desde
 * `src/app/api/**` (excepto whitelist de endpoints exonerados). Los
 * endpoints del producto deben usar `prismaApp` (cliente con schema
 * tenant). prismaRuntime y prismaQuotaWriter están permitidos en casos
 * concretos (configuración por tenant, consumeQuota). ADR-002 §2.2 +
 * ADR-004 §2.2.
 *
 * Whitelist actualizada en commit 22 (vacía cuando termina el refactor).
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
          // Endpoints que se eliminan/refactorizan en Fase 4.
          "/api/setup/",
          "/api/auth/",
          // Webhook Stripe: vive en subdominio app, sin tenant en
          // contexto. Usa prismaMaster para idempotencia y dispatch
          // (ADR-003 §2.3.c, AGENTS.md "server actions del subdominio app").
          "/api/webhooks/",
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
    },
  },
]);

export default eslintConfig;
