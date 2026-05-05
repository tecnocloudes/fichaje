import { MessageSquare } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { ProximamenteCard } from "@/components/admin/proximamente-card";

async function WhatsAppBotPage() {
  return (
    <ProximamenteCard
      Icon={MessageSquare}
      title="Asistente WhatsApp"
      description="Tus empleados fichan, solicitan vacaciones y consultan nóminas desde WhatsApp sin instalar apps. Conversación natural con el bot empleaIA."
      plan="Enterprise"
      bullets={[
        "Fichaje entrada/salida con un mensaje '/entrada' o '/salida'",
        "Solicitud de vacaciones y ausencias por chat",
        "Consulta de saldo de bolsa de horas y vacaciones pendientes",
        "Recepción de nóminas y comunicados con confirmación de lectura",
        "Notificaciones de turnos publicados y cambios",
        "Integración oficial Meta Business (no scraping ni APIs grises)",
      ]}
    />
  );
}

export default withTenantPage(WhatsAppBotPage);
