import { ComingSoon } from "@/components/ui/coming-soon";
import { CreditCard } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Control de Gastos" description="Gestión y aprobación de gastos de empresa" icon={<CreditCard className="h-10 w-10 text-indigo-400" />} />;
}
