import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prismaApp as prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/lib/auth.config";
import { runWithTenant, type TenantContext } from "@/lib/tenant/context";
import { resolveTenant } from "@/lib/tenant/resolver";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      // Fase 3 — mitigación §11.3: NextAuth invoca este callback en una
      // continuación interna (fuera del runWithTenant que el proxy.ts
      // estableció), por lo que `currentTenant()` lanza al usar prismaApp.
      // Mitigación local: leemos el Host del request (NextAuth 5 lo
      // pasa como segundo arg), resolvemos tenant via cache del proxy
      // (resolveTenant) y reanidamos runWithTenant explícitamente.
      async authorize(credentials, req) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const host = req.headers?.get("host") ?? "";
        const resolved = await resolveTenant(host);
        if (resolved.kind !== "tenant" || resolved.ctx.status !== "active") {
          return null;
        }
        const ctx: TenantContext = resolved.ctx;

        return await runWithTenant(ctx, async () => {
          const user = await prisma.user.findUnique({
            where: { email: parsed.data.email },
            select: {
              id: true,
              email: true,
              password: true,
              nombre: true,
              apellidos: true,
              rol: true,
              tiendaId: true,
              activo: true,
            },
          });

          if (!user || !user.activo || !user.password) return null;

          const passwordOk = await bcrypt.compare(
            parsed.data.password,
            user.password,
          );
          if (!passwordOk) return null;

          return {
            id: user.id,
            email: user.email,
            name: `${user.nombre} ${user.apellidos}`,
            rol: user.rol,
            tiendaId: user.tiendaId,
            nombre: user.nombre,
            apellidos: user.apellidos,
            tenantId: ctx.tenantId,
            tenantSlug: ctx.slug,
          };
        });
      },
    }),
  ],
});
