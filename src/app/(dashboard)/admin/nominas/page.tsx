import { ComingSoon } from "@/components/ui/coming-soon";
import { FileText } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Nóminas" description="Generación y gestión de nóminas de empleados" icon={<FileText className="h-10 w-10 text-indigo-400" />} />;
}
