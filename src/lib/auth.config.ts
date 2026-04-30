import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.rol = (user as any).rol;
        token.tiendaId = (user as any).tiendaId;
        token.nombre = (user as any).nombre;
        token.apellidos = (user as any).apellidos;
        // Fase 3 (ADR-002 §2.5): el JWT lleva tenantId+tenantSlug del
        // tenant donde el usuario hizo login. El proxy (commit 9)
        // compara esto con el slug del host y devuelve 401 si difieren.
        token.tenantId = (user as any).tenantId;
        token.tenantSlug = (user as any).tenantSlug;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        (session.user as any).rol = token.rol;
        (session.user as any).tiendaId = token.tiendaId;
        (session.user as any).nombre = token.nombre;
        (session.user as any).apellidos = token.apellidos;
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).tenantSlug = token.tenantSlug;
      }
      return session;
    },
  },
  providers: [],
};
