/**
 * Layout del panel super-admin. Plan Fase 7 §5.1 + fix bug parallel pages.
 *
 * Subido al subdominio admin.<root>. NO usa withTenantPage —
 * el panel vive sin tenant. Branding fijo (slate).
 *
 * Vive en src/app/admin/ (path real, no grupo) para evitar conflicto
 * con (auth)/login del subdominio del tenant. Next.js rechaza dos
 * pages que resuelvan al mismo path.
 */

import type { ReactNode } from "react";
import Link from "next/link";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/admin/dashboard" className="font-bold">
            Fichaje · Super-Admin
          </Link>
          <nav className="flex gap-4 text-sm text-slate-300">
            <Link href="/admin/dashboard" className="hover:text-white">Dashboard</Link>
            <Link href="/admin/tenants" className="hover:text-white">Tenants</Link>
            <Link href="/admin/audit-log" className="hover:text-white">Audit log</Link>
          </nav>
        </div>
        <form action="/api/admin/logout" method="POST">
          <button type="submit" className="text-sm text-slate-300 hover:text-white">
            Salir
          </button>
        </form>
      </header>
      <main className="max-w-6xl mx-auto p-6">{children}</main>
    </div>
  );
}
