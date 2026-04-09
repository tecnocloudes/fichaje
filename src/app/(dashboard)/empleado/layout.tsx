import type { ReactNode } from "react";

interface EmpleadoLayoutProps {
  children: ReactNode;
}

export default function EmpleadoLayout({ children }: EmpleadoLayoutProps) {
  return <>{children}</>;
}
