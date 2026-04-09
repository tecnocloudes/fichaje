import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    const rol = (session.user as any).rol as string | undefined;

    if (rol === "SUPERADMIN") {
      redirect("/admin");
    } else if (rol === "MANAGER") {
      redirect("/manager");
    } else {
      redirect("/empleado");
    }
  }

  redirect("/login");
}
