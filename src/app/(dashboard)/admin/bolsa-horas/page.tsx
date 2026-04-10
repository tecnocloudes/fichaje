import { ComingSoon } from "@/components/ui/coming-soon";
import { Timer } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Bolsa de Horas" description="Registro y compensación de horas extra del equipo" icon={<Timer className="h-10 w-10 text-indigo-400" />} />;
}
