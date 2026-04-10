import { ComingSoon } from "@/components/ui/coming-soon";
import { Pen } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Firma Electrónica" description="Firma digital de documentos y contratos con validez legal" icon={<Pen className="h-10 w-10 text-indigo-400" />} />;
}
