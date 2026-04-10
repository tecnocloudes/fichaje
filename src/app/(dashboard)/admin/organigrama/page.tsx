import { ComingSoon } from "@/components/ui/coming-soon";
import { GitBranch } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Organigrama" description="Estructura organizativa visual de la empresa" icon={<GitBranch className="h-10 w-10 text-indigo-400" />} />;
}
