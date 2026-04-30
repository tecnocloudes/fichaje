/**
 * Lógica core de creación/actualización de super-admins. Separada del
 * wrapper CLI (scripts/super-admin-create.ts) para que sea testeable
 * sin acoplarla a stdin.
 */

import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";

export type UpsertSuperAdminInput = {
  email: string;
  name: string;
  /** Si null/undefined, no se cambia el password. Si la cuenta no existe, lanza. */
  password?: string;
  role?: "SUPER_ADMIN" | "SUPPORT";
};

export type UpsertSuperAdminResult = {
  created: boolean;
  passwordUpdated: boolean;
  id: string;
};

/**
 * Upsert por email. Si la cuenta no existe, crea con password obligatorio.
 * Si existe, actualiza name+role siempre y password solo si se pasa.
 *
 * Reglas:
 * - email se normaliza a lowercase + trim.
 * - password mínimo 12 caracteres.
 * - bcrypt con cost 12 (igual que User.password en el repo).
 */
export async function upsertSuperAdmin(
  prisma: Pick<PrismaClient, "superAdmin">,
  input: UpsertSuperAdminInput,
): Promise<UpsertSuperAdminResult> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const role = input.role ?? "SUPER_ADMIN";

  if (!email) throw new Error("email es obligatorio");
  if (!name) throw new Error("name es obligatorio");

  if (input.password !== undefined && input.password.length < 12) {
    throw new Error("La contraseña debe tener al menos 12 caracteres.");
  }

  const existing = await prisma.superAdmin.findUnique({
    where: { email },
    select: { id: true, password: true },
  });

  if (!existing) {
    if (!input.password) {
      throw new Error("password es obligatorio al crear una cuenta nueva.");
    }
    const hash = await bcrypt.hash(input.password, 12);
    const created = await prisma.superAdmin.create({
      data: { email, name, password: hash, role },
      select: { id: true },
    });
    return { created: true, passwordUpdated: true, id: created.id };
  }

  // Existe: actualizar siempre name + role; password solo si se pasa.
  if (input.password !== undefined) {
    const hash = await bcrypt.hash(input.password, 12);
    const updated = await prisma.superAdmin.update({
      where: { email },
      data: { name, role, password: hash },
      select: { id: true },
    });
    return { created: false, passwordUpdated: true, id: updated.id };
  }

  const updated = await prisma.superAdmin.update({
    where: { email },
    data: { name, role },
    select: { id: true },
  });
  return { created: false, passwordUpdated: false, id: updated.id };
}
