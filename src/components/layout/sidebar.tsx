"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Building2,
  LayoutDashboard,
  Store,
  Users,
  Calendar,
  FileText,
  Settings,
  LogOut,
  Clock,
  ClipboardList,
  CalendarCheck,
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface SessionUser {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  tiendaId: string | null;
}

interface SidebarProps {
  user: SessionUser;
  notificationCount?: number;
  pendingAusencias?: number;
  isOpen?: boolean;
  onToggle?: () => void;
}

// ─── Navigation config ────────────────────────────────────────────────────────

function getNavItems(rol: string, pendingAusencias = 0): NavItem[] {
  switch (rol) {
    case "SUPERADMIN":
      return [
        { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
        { label: "Sedes", href: "/admin/tiendas", icon: Store },
        { label: "Empleados", href: "/admin/empleados", icon: Users },
        { label: "Turnos", href: "/admin/turnos", icon: Calendar },
        {
          label: "Ausencias",
          href: "/admin/ausencias",
          icon: ClipboardList,
          badge: pendingAusencias || undefined,
        },
        { label: "Informes", href: "/admin/informes", icon: BarChart3 },
        { label: "Configuración", href: "/admin/configuracion", icon: Settings },
      ];
    case "MANAGER":
      return [
        { label: "Mi Sede", href: "/manager", icon: Store },
        { label: "Presencia", href: "/manager/presencia", icon: UserCheck },
        { label: "Turnos", href: "/manager/turnos", icon: Calendar },
        {
          label: "Ausencias",
          href: "/manager/ausencias",
          icon: ClipboardList,
          badge: pendingAusencias || undefined,
        },
        { label: "Informes", href: "/manager/informes", icon: BarChart3 },
      ];
    default: // EMPLEADO
      return [
        { label: "Fichar", href: "/empleado", icon: Clock },
        { label: "Mis Fichajes", href: "/empleado/mis-fichajes", icon: FileText },
        { label: "Mis Turnos", href: "/empleado/mis-turnos", icon: CalendarCheck },
        { label: "Mis Ausencias", href: "/empleado/mis-ausencias", icon: Briefcase },
      ];
  }
}

function getRolLabel(rol: string) {
  switch (rol) {
    case "SUPERADMIN": return "Super Admin";
    case "MANAGER": return "Manager";
    default: return "Empleado";
  }
}

function getRolColor(rol: string) {
  switch (rol) {
    case "SUPERADMIN": return "bg-violet-500/20 text-violet-200";
    case "MANAGER": return "bg-sky-500/20 text-sky-200";
    default: return "bg-emerald-500/20 text-emerald-200";
  }
}

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

export function Sidebar({
  user,
  notificationCount = 0,
  pendingAusencias = 0,
  isOpen = true,
  onToggle,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const rol = user.rol;
  const nombre = user.nombre;
  const apellidos = user.apellidos;
  const fullName = apellidos ? `${nombre} ${apellidos}` : nombre;

  const navItems = getNavItems(rol, pendingAusencias);

  const isActive = (href: string) => {
    if (href === pathname) return true;
    // Match sub-paths but avoid false positives (e.g. /admin vs /admin/tiendas)
    if (href !== "/admin" && href !== "/manager" && href !== "/empleado") {
      return pathname.startsWith(href);
    }
    return pathname === href;
  };

  const handleCollapse = () => setCollapsed((c) => !c);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col bg-[#1e1b4b] text-[#e0e7ff] transition-all duration-300",
          "lg:relative lg:translate-x-0",
          collapsed ? "w-16" : "w-64",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Header / Logo */}
        <div className="flex h-16 items-center justify-between px-4 border-b border-[#312e81]">
          {!collapsed && (
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500 shadow-md">
                <Building2 className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-sm tracking-wide text-white truncate">
                TelecomFichaje
              </span>
            </div>
          )}
          {collapsed && (
            <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 shadow-md">
              <Building2 className="h-4 w-4 text-white" />
            </div>
          )}
          <button
            onClick={handleCollapse}
            className={cn(
              "hidden lg:flex h-6 w-6 items-center justify-center rounded-md text-indigo-300 hover:text-white hover:bg-[#312e81] transition-colors shrink-0",
              collapsed && "mx-auto"
            )}
            aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* User info */}
        {!collapsed && (
          <div className="px-4 py-4 border-b border-[#312e81]">
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-indigo-500 text-white text-sm font-semibold">
                  {getInitials(fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{fullName}</p>
                <span
                  className={cn(
                    "inline-block rounded-full px-2 py-0.5 text-xs font-medium mt-0.5",
                    getRolColor(rol)
                  )}
                >
                  {getRolLabel(rol)}
                </span>
              </div>
            </div>
          </div>
        )}

        {collapsed && (
          <div className="flex justify-center py-3 border-b border-[#312e81]">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-indigo-500 text-white text-xs font-semibold">
                {getInitials(fullName)}
              </AvatarFallback>
            </Avatar>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
          {navItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  active
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-indigo-200 hover:bg-[#312e81] hover:text-white",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 shrink-0 transition-colors",
                    active ? "text-white" : "text-indigo-400 group-hover:text-white"
                  )}
                />
                {!collapsed && (
                  <span className="flex-1 truncate">{item.label}</span>
                )}
                {!collapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white leading-none">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
                {collapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Notifications + Logout */}
        <div className="mt-auto border-t border-[#312e81] p-3 space-y-1">
          {/* Notifications link */}
          <button
            className={cn(
              "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-indigo-200 hover:bg-[#312e81] hover:text-white transition-colors",
              collapsed && "justify-center px-2"
            )}
            title={collapsed ? "Notificaciones" : undefined}
          >
            <div className="relative shrink-0">
              <Bell className="h-5 w-5 text-indigo-400 group-hover:text-white transition-colors" />
              {notificationCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white leading-none">
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              )}
            </div>
            {!collapsed && <span className="flex-1 text-left">Notificaciones</span>}
            {!collapsed && notificationCount > 0 && (
              <span className="text-xs text-indigo-400">{notificationCount}</span>
            )}
          </button>

          {/* Logout */}
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className={cn(
              "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-indigo-200 hover:bg-red-500/20 hover:text-red-300 transition-colors",
              collapsed && "justify-center px-2"
            )}
            title={collapsed ? "Cerrar sesión" : undefined}
          >
            <LogOut className="h-5 w-5 shrink-0 text-indigo-400 group-hover:text-red-400 transition-colors" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
