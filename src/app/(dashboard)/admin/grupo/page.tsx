import { ComingSoon } from "@/components/ui/coming-soon";
import { Globe } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Grupo" description="Gestión multi-empresa y administración de franquicias" icon={<Globe className="h-10 w-10 text-indigo-400" />} />;
}
