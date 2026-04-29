/**
 * Crea o actualiza un super-admin en master.super_admins.
 *
 * Uso:
 *   npm run super-admin:create -- --email=admin@tecnocloud.es --name="Daniel"
 *   npm run super-admin:create -- --email=... --name=... --reset-password
 *   npm run super-admin:create -- --email=... --name=... --role=SUPPORT
 *
 * Pide la contraseña por stdin (no se acepta como argumento). Hashea con
 * bcrypt (mismo método que User.password). Idempotente:
 *   - Si el email no existe: crea el super-admin.
 *   - Si existe: actualiza name y role. Solo cambia password si se pasa
 *     --reset-password.
 *
 * NO requiere acceso a la BD del producto (public.*); solo a master.
 * Usa prismaMaster (alias de prisma en Fase 2).
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";
import { prismaMaster } from "../src/lib/prisma";

type Args = {
  email: string;
  name: string;
  resetPassword: boolean;
  role: "SUPER_ADMIN" | "SUPPORT";
};

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let email: string | undefined;
  let name: string | undefined;
  let resetPassword = false;
  let role: Args["role"] = "SUPER_ADMIN";

  for (const arg of args) {
    if (arg.startsWith("--email=")) email = arg.slice("--email=".length);
    else if (arg.startsWith("--name=")) name = arg.slice("--name=".length);
    else if (arg === "--reset-password") resetPassword = true;
    else if (arg.startsWith("--role=")) {
      const v = arg.slice("--role=".length);
      if (v !== "SUPER_ADMIN" && v !== "SUPPORT") {
        throw new Error(`role inválido: ${v}. Usa SUPER_ADMIN o SUPPORT.`);
      }
      role = v;
    }
  }

  if (!email) throw new Error("Falta --email=<email>");
  if (!name) throw new Error("Falta --name=<nombre>");

  return { email, name, resetPassword, role };
}

async function readPassword(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  // Nota: readline en Node no tiene "hide input" nativo. Para producción
  // usaríamos `read` o similar. En el runbook de soporte se documenta que
  // hay que ejecutarlo en una shell sin scrollback compartido.
  const value = await rl.question(prompt);
  rl.close();
  return value.trim();
}

async function main() {
  const args = parseArgs();

  const existing = await prismaMaster.superAdmin.findUnique({
    where: { email: args.email },
  });

  if (!existing) {
    const password = await readPassword(`Contraseña para ${args.email}: `);
    if (password.length < 12) {
      throw new Error("La contraseña debe tener al menos 12 caracteres.");
    }
    const hash = await bcrypt.hash(password, 12);
    await prismaMaster.superAdmin.create({
      data: {
        email: args.email,
        name: args.name,
        password: hash,
        role: args.role,
      },
    });
    console.log(`✅ Super-admin creado: ${args.email} (role=${args.role})`);
    return;
  }

  // Existe: actualizar name/role. Solo password si --reset-password.
  if (args.resetPassword) {
    const password = await readPassword(`Nueva contraseña para ${args.email}: `);
    if (password.length < 12) {
      throw new Error("La contraseña debe tener al menos 12 caracteres.");
    }
    const hash = await bcrypt.hash(password, 12);
    await prismaMaster.superAdmin.update({
      where: { email: args.email },
      data: { name: args.name, role: args.role, password: hash },
    });
    console.log(`✅ Super-admin actualizado con nueva contraseña: ${args.email}`);
  } else {
    await prismaMaster.superAdmin.update({
      where: { email: args.email },
      data: { name: args.name, role: args.role },
    });
    console.log(`✅ Super-admin actualizado (sin tocar password): ${args.email}`);
  }
}

main()
  .catch((err) => {
    console.error("❌", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaMaster.$disconnect();
  });
