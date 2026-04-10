import { ComingSoon } from "@/components/ui/coming-soon";
import { GraduationCap } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Formación" description="Gestión de cursos y planes de formación del equipo" icon={<GraduationCap className="h-10 w-10 text-indigo-400" />} />;
}
