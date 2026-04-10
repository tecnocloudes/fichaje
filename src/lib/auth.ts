import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/lib/auth.config";

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
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

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
          user.password
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
        };
      },
    }),
  ],
});
