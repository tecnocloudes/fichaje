import { ComingSoon } from "@/components/ui/coming-soon";
import { Search } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Reclutamiento" description="Gestión de candidatos y procesos de selección" icon={<Search className="h-10 w-10 text-indigo-400" />} />;
}
