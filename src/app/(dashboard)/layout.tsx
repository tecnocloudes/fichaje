import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardShell } from "@/components/layout/dashboard-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const user = session.user as any;
  const sessionUser = {
    id: user.id ?? "",
    nombre: user.nombre ?? user.name ?? "Usuario",
    apellidos: user.apellidos ?? "",
    email: user.email ?? "",
    rol: user.rol ?? "EMPLEADO",
    tiendaId: user.tiendaId ?? null,
  };

  const branding = await prisma.configuracionEmpresa.findFirst({
    select: { logo: true, appNombre: true, nombre: true },
  }).catch(() => null);

  return (
    <DashboardShell
      user={sessionUser}
      branding={{
        logo: branding?.logo ?? null,
        appNombre: branding?.appNombre ?? "HR Suite",
        nombre: branding?.nombre ?? null,
      }}
    >
      {children}
    </DashboardShell>
  );
}
