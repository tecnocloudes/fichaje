import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
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
      }
      return session;
    },
  },
  providers: [],
};
