import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
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

  return <DashboardShell user={sessionUser}>{children}</DashboardShell>;
}
