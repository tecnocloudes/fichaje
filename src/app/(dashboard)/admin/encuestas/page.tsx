import { ComingSoon } from "@/components/ui/coming-soon";
import { MessageSquare } from "lucide-react";

export default function Page() {
  return <ComingSoon feature="Encuestas" description="Crea y analiza encuestas de satisfacción del equipo" icon={<MessageSquare className="h-10 w-10 text-indigo-400" />} />;
}
