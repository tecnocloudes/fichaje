import { Store } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { ProximamenteCard } from "@/components/admin/proximamente-card";

async function MarketplacePage() {
  return (
    <ProximamenteCard
      Icon={Store}
      title="Marketplace de integraciones"
      description="Catálogo de integraciones nativas con software de nómina, ERPs, herramientas de comunicación y plataformas externas. Activación en un click sin código."
      plan="Todos los planes"
      bullets={[
        "Integración con A3, Sage, Holded, Contasol y otros softwares de nómina",
        "Sincronización con Slack, Microsoft Teams, Google Workspace",
        "Conectores con SAP, Odoo, Holded y ERPs de cabecera",
        "Plantillas Zapier / Make (10 000+ apps disponibles)",
        "OAuth 2.0 para acceso seguro y revocable",
        "Apps de terceros instalables con permisos granulares",
      ]}
    />
  );
}

export default withTenantPage(MarketplacePage);
