import { ShieldAlert } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { ProximamenteCard } from "@/components/admin/proximamente-card";

async function CanalDenunciasPage() {
  return (
    <ProximamenteCard
      Icon={ShieldAlert}
      title="Canal de denuncias"
      description="Buzón confidencial para que tus empleados reporten incumplimientos. Cumplimiento de la Ley 2/2023 de protección al informante (obligatorio para empresas de más de 50 empleados)."
      plan="Todos los planes"
      bullets={[
        "Buzón confidencial accesible 24/7 desde web y móvil",
        "Anonimato garantizado del denunciante (cumple Ley 2/2023)",
        "Trazabilidad cifrada de denuncias y comunicaciones",
        "Roles dedicados: gestor del canal, instructor, comité",
        "Plazos legales automatizados (acuse de recibo en 7 días, resolución en 3 meses)",
        "Exportación de informes para auditoría externa",
      ]}
    />
  );
}

export default withTenantPage(CanalDenunciasPage);
