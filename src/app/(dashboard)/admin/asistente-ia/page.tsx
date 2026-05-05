import { Bot } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { ProximamenteCard } from "@/components/admin/proximamente-card";

async function AsistenteIAPage() {
  return (
    <ProximamenteCard
      Icon={Bot}
      title="Asistente IA"
      description="empleaIA AI: tu copiloto inteligente para automatizar consultas de RRHH, redactar comunicados y analizar tendencias del equipo en lenguaje natural."
      plan="Enterprise"
      bullets={[
        "Chat conversacional con tu data: '¿Cuántas vacaciones quedan al equipo de marketing?'",
        "Generación automática de comunicados, descripciones de puestos y plantillas",
        "Análisis predictivo de rotación, absentismo y rendimiento",
        "Resúmenes ejecutivos automáticos de informes y métricas",
        "Sugerencias de turnos óptimos basadas en histórico y carga",
        "Multilenguaje: español, inglés, catalán, gallego, euskera",
      ]}
    />
  );
}

export default withTenantPage(AsistenteIAPage);
