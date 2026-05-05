import { ScanFace } from "lucide-react";
import { withTenantPage } from "@/lib/tenant/with-tenant-page";
import { ProximamenteCard } from "@/components/admin/proximamente-card";

async function FaceIDPage() {
  return (
    <ProximamenteCard
      Icon={ScanFace}
      title="Fichaje con reconocimiento facial"
      description="Face ID para validar la identidad del empleado en cada fichaje desde móvil o tablet compartida. Elimina el fichaje fraudulento por compañeros."
      plan="Todos los planes"
      bullets={[
        "Captura del rostro al fichar entrada/salida desde móvil o tablet",
        "Comparación con plantilla biométrica almacenada cifrada (AES-256)",
        "Detección de vida (anti-spoofing) — no acepta fotos ni vídeos",
        "Cumple GDPR: dato biométrico tratado con consentimiento explícito",
        "Plantilla biométrica reversible solo por el usuario o admin con audit log",
        "Fallback a PIN si la cámara falla (con flag en el fichaje)",
      ]}
    />
  );
}

export default withTenantPage(FaceIDPage);
