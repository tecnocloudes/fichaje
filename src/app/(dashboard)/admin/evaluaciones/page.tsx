import { ComingSoon } from "@/components/ui/coming-soon";
import { Star } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Evaluaciones de desempeño" description="Ciclos de evaluación y feedback continuo" icon={<Star className="h-10 w-10 text-indigo-400" />} />;
}
