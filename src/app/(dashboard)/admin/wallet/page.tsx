import { ComingSoon } from "@/components/ui/coming-soon";
import { Landmark } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Wallet" description="Monedero y beneficios para empleados" icon={<Landmark className="h-10 w-10 text-indigo-400" />} />;
}
