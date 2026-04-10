import { ComingSoon } from "@/components/ui/coming-soon";
import { Timer } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Retribución Flexible" description="Configura planes de retribución flexible para el equipo" icon={<Timer className="h-10 w-10 text-indigo-400" />} />;
}
