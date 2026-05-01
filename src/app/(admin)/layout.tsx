/**
 * Layout del panel super-admin. Plan Fase 7 §5.1.
 *
 * NO usa withTenantPage — el panel vive en admin.<root>, sin tenant.
 * Branding fijo (slate). Auth se valida en cada page server-side via
 * `verifySuperAdminJwt` o redirige a /login.
 */

import type { ReactNode } from "react";
import Link from "next/link";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-slate-50 min-h-screen">
        <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="font-bold">
              Fichaje · Super-Admin
            </Link>
            <nav className="flex gap-4 text-sm text-slate-300">
              <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
              <Link href="/tenants" className="hover:text-white">Tenants</Link>
              <Link href="/audit-log" className="hover:text-white">Audit log</Link>
            </nav>
          </div>
          <form action="/api/admin/logout" method="POST">
            <button type="submit" className="text-sm text-slate-300 hover:text-white">
              Salir
            </button>
          </form>
        </header>
        <main className="max-w-6xl mx-auto p-6">{children}</main>
      </body>
    </html>
  );
}
