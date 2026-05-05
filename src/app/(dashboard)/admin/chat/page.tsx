import { MessageCircle } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { ProximamenteCard } from "@/components/admin/proximamente-card";

async function ChatPage() {
  return (
    <ProximamenteCard
      Icon={MessageCircle}
      title="Chat interno"
      description="Mensajería instantánea entre empleados, managers y equipos sin salir de empleaIA. Sustituye WhatsApp y Telegram para conversaciones laborales."
      plan="Pro"
      bullets={[
        "Mensajes 1 a 1 y grupos por equipo, sede o departamento",
        "Adjuntos seguros con la misma política GDPR de la app",
        "Notificaciones push y por email configurables",
        "Estado de presencia (en línea, ocupado, fuera de horario)",
        "Búsqueda en histórico con filtros por persona y fecha",
        "Reacciones, menciones (@usuario) y respuestas hiladas",
      ]}
    />
  );
}

export default withTenantPage(ChatPage);
