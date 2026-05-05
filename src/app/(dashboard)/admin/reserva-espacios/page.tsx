import { Building2 } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { ProximamenteCard } from "@/components/admin/proximamente-card";

async function ReservaEspaciosPage() {
  return (
    <ProximamenteCard
      Icon={Building2}
      title="Reserva de espacios"
      description="Gestión de salas de reunión, mesas de hot-desking, plazas de parking y otros recursos compartidos. Ideal para oficinas con espacio flexible o teletrabajo híbrido."
      plan="Pro"
      bullets={[
        "Calendario visual de salas y mesas por sede",
        "Reserva por hora, medio día o día completo",
        "Hot-desking: mapa interactivo de la oficina",
        "Plazas de parking con turnos rotativos",
        "Recordatorios automáticos antes de la reserva",
        "Estadísticas de ocupación para optimizar el espacio",
      ]}
    />
  );
}

export default withTenantPage(ReservaEspaciosPage);
