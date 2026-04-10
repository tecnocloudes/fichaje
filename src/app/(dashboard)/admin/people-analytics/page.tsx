import { ComingSoon } from "@/components/ui/coming-soon";
import { TrendingUp } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="People Analytics" description="Métricas avanzadas e inteligencia sobre tu capital humano" icon={<TrendingUp className="h-10 w-10 text-indigo-400" />} />;
}
