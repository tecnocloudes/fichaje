import { ComingSoon } from "@/components/ui/coming-soon";
import { Target } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Objetivos (OKR)" description="Define y sigue los objetivos estratégicos del equipo" icon={<Target className="h-10 w-10 text-indigo-400" />} />;
}
