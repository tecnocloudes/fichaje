import { ClipboardList } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { ProximamenteCard } from "@/components/admin/proximamente-card";

async function CustomRequestsPage() {
  return (
    <ProximamenteCard
      Icon={ClipboardList}
      title="Peticiones personalizadas"
      description="Constructor de formularios y flujos de aprobación a medida. Diseña los procesos de RRHH específicos de tu empresa sin código."
      plan="Pro"
      bullets={[
        "Constructor visual drag-and-drop de formularios",
        "Campos condicionales y validaciones avanzadas",
        "Flujos de aprobación multi-nivel (manager → RRHH → dirección)",
        "Notificaciones automáticas en cada paso del flujo",
        "Histórico completo de peticiones con audit log",
        "Exportación a Excel/PDF para informes",
      ]}
    />
  );
}

export default withTenantPage(CustomRequestsPage);
