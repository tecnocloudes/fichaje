import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prismaApp as prisma, prismaMaster } from "@/lib/prisma";
import { currentTenant } from "@/lib/tenant/context";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";

async function DashboardLayout({
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

  // Trial banner: si el tenant tiene una subscription en estado
  // "trialing" o no tiene subscription activa todavía, mostramos un
  // aviso global con CTA para activar la cuenta.
  let trial: { trialEnd: string | null; isTrialing: boolean } | null = null;
  try {
    const { tenantId } = currentTenant();
    const sub = await prismaMaster.subscription.findFirst({
      where: { tenantId },
      select: { status: true, trialEnd: true },
      orderBy: { updatedAt: "desc" },
    });
    if (sub?.status === "trialing") {
      trial = {
        trialEnd: sub.trialEnd ? sub.trialEnd.toISOString() : null,
        isTrialing: true,
      };
    }
  } catch {
    // Sin contexto de tenant o BD caída → no banner, no romper layout.
  }

  return (
    <DashboardShell
      user={sessionUser}
      branding={{
        logo: branding?.logo ?? null,
        appNombre: branding?.appNombre ?? "empleaIA",
        nombre: branding?.nombre ?? null,
      }}
      trial={trial}
    >
      {children}
    </DashboardShell>
  );
}

export default withTenantPage(DashboardLayout as never);
