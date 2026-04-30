/**
 * Página /registro. Vive en subdominio `app` (proxy.ts kind=app).
 * No usa withTenant (subdominio app no tiene tenant en contexto).
 */

import { prismaMaster } from "@/lib/prisma";
import { RegistroForm } from "./registro-form";

export const dynamic = "force-dynamic";

export default async function Page() {
  // Cargamos los planes activos para mostrarlos en el formulario.
  const planes = await prismaMaster.plan.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    select: { key: true, name: true, description: true },
  });
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32 }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Crea tu cuenta</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>
        Completa los datos y te llevamos a Stripe para confirmar el pago. 14 días de prueba.
      </p>
      <RegistroForm planes={planes} />
    </main>
  );
}
