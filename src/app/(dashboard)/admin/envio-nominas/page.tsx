import { ComingSoon } from "@/components/ui/coming-soon";
import { Send } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Envío de Nóminas" description="Distribución automática de nóminas a empleados" icon={<Send className="h-10 w-10 text-indigo-400" />} />;
}
