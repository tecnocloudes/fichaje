"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  Building2, LayoutDashboard, Store, Users, Calendar, FileText,
  Settings, LogOut, Clock, ClipboardList, CalendarCheck, BarChart3,
  Bell, ChevronLeft, ChevronRight, UserCheck, CheckSquare, Megaphone,
  BookOpen, FolderOpen, Rocket, GraduationCap, Target, CreditCard,
  TrendingUp, GitBranch, Globe, Timer, Search, Star, Send, Pen,
  MessageSquare, ChevronDown, ChevronUp, Landmark,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface SessionUser {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  tiendaId: string | null;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  proximamente?: boolean;
  badge?: number;
}

interface NavSection {
  key: string;
  label: string;
  items: NavItem[];
}

interface SidebarConfig {
  top: NavItem;
  sections: NavSection[];
}

function getSidebarConfig(rol: string, pendingAusencias = 0): SidebarConfig {
  if (rol === "SUPERADMIN") {
    return {
      top: { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      sections: [
        {
          key: "admin",
          label: "ADMINISTRADOR",
          items: [
            { label: "Empleados", href: "/admin/empleados", icon: Users },
            { label: "Sedes", href: "/admin/tiendas", icon: Store },
          ],
        },
        {
          key: "tiempo",
          label: "GESTIÓN DEL TIEMPO",
          items: [
            { label: "Fichajes", href: "/admin/informes", icon: Clock },
            { label: "Ausencias", href: "/admin/ausencias", icon: ClipboardList, badge: pendingAusencias || undefined },
            { label: "Turnos", href: "/admin/turnos", icon: Calendar },
            { label: "Bolsa de horas", href: "/admin/bolsa-horas", icon: Timer },
            { label: "Tareas", href: "/admin/tareas", icon: CheckSquare },
          ],
        },
        {
          key: "talento",
          label: "TALENTO",
          items: [
            { label: "Incorporaciones y bajas", href: "/admin/onboarding", icon: Rocket },
            { label: "Reclutamiento", href: "/admin/reclutamiento", icon: Search, proximamente: true },
            { label: "Encuestas", href: "/admin/encuestas", icon: MessageSquare, proximamente: true },
            { label: "Evaluaciones", href: "/admin/evaluaciones", icon: Star, proximamente: true },
            { label: "Formación", href: "/admin/formacion", icon: GraduationCap, proximamente: true },
            { label: "Objetivos", href: "/admin/objetivos", icon: Target, proximamente: true },
          ],
        },
        {
          key: "comunicacion",
          label: "COMUNICACIÓN",
          items: [
            { label: "Comunicados", href: "/admin/comunicados", icon: Megaphone },
            { label: "Artículos", href: "/admin/articulos", icon: BookOpen },
          ],
        },
        {
          key: "finanzas",
          label: "FINANZAS",
          items: [
            { label: "Nóminas", href: "/admin/nominas", icon: FileText, proximamente: true },
            { label: "Envío Nóminas", href: "/admin/envio-nominas", icon: Send, proximamente: true },
            { label: "Control de gastos", href: "/admin/control-gastos", icon: CreditCard, proximamente: true },
            { label: "Retribución flexible", href: "/admin/retribucion", icon: Timer, proximamente: true },
            { label: "Wallet", href: "/admin/wallet", icon: Landmark, proximamente: true },
          ],
        },
        {
          key: "empresa",
          label: "EMPRESA",
          items: [
            { label: "Documentos", href: "/admin/documentos", icon: FolderOpen },
            { label: "Informes", href: "/admin/informes", icon: BarChart3 },
            { label: "People Analytics", href: "/admin/people-analytics", icon: TrendingUp, proximamente: true },
            { label: "Firma electrónica", href: "/admin/firma", icon: Pen, proximamente: true },
            { label: "Organigrama", href: "/admin/organigrama", icon: GitBranch, proximamente: true },
            { label: "Grupo", href: "/admin/grupo", icon: Globe, proximamente: true },
          ],
        },
      ],
    };
  }

  if (rol === "MANAGER") {
    return {
      top: { label: "Dashboard", href: "/manager", icon: LayoutDashboard },
      sections: [
        {
          key: "tiempo",
          label: "GESTIÓN DEL TIEMPO",
          items: [
            { label: "Presencia", href: "/manager/presencia", icon: UserCheck },
            { label: "Ausencias", href: "/manager/ausencias", icon: ClipboardList, badge: pendingAusencias || undefined },
            { label: "Turnos", href: "/manager/turnos", icon: Calendar },
            { label: "Tareas", href: "/manager/tareas", icon: CheckSquare },
          ],
        },
        {
          key: "comunicacion",
          label: "COMUNICACIÓN",
          items: [
            { label: "Comunicados", href: "/manager/comunicados", icon: Megaphone },
            { label: "Artículos", href: "/manager/articulos", icon: BookOpen },
          ],
        },
        {
          key: "empresa",
          label: "EMPRESA",
          items: [
            { label: "Documentos", href: "/manager/documentos", icon: FolderOpen },
            { label: "Informes", href: "/manager/informes", icon: BarChart3 },
          ],
        },
      ],
    };
  }

  // EMPLEADO
  return {
    top: { label: "Fichar", href: "/empleado", icon: Clock },
    sections: [
      {
        key: "tiempo",
        label: "GESTIÓN DEL TIEMPO",
        items: [
          { label: "Mis Fichajes", href: "/empleado/mis-fichajes", icon: FileText },
          { label: "Mis Turnos", href: "/empleado/mis-turnos", icon: CalendarCheck },
          { label: "Mis Ausencias", href: "/empleado/mis-ausencias", icon: ClipboardList },
          { label: "Mis Tareas", href: "/empleado/tareas", icon: CheckSquare },
        ],
      },
      {
        key: "comunicacion",
        label: "COMUNICACIÓN",
        items: [
          { label: "Comunicados", href: "/empleado/comunicados", icon: Megaphone },
          { label: "Artículos", href: "/empleado/articulos", icon: BookOpen },
        ],
      },
      {
        key: "empresa",
        label: "EMPRESA",
        items: [
          { label: "Mis Documentos", href: "/empleado/documentos", icon: FolderOpen },
        ],
      },
    ],
  };
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
    case "SUPERADMIN": return "bg-violet-500/20 text-violet-300";
    case "MANAGER": return "bg-sky-500/20 text-sky-300";
    default: return "bg-emerald-500/20 text-emerald-300";
  }
}

function getInitials(nombre: string, apellidos: string): string {
  return `${nombre[0] ?? ""}${apellidos[0] ?? ""}`.toUpperCase();
}

interface Branding {
  logo?: string | null;
  appNombre: string;
  nombre?: string | null;
}

interface SidebarProps {
  user: SessionUser;
  branding?: Branding;
  notificationCount?: number;
  pendingAusencias?: number;
  isOpen?: boolean;
  onToggle?: () => void;
}

export function Sidebar({
  user,
  branding,
  notificationCount = 0,
  pendingAusencias = 0,
  isOpen = true,
  onToggle,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const { top, sections } = getSidebarConfig(user.rol, pendingAusencias);
  const fullName = user.apellidos ? `${user.nombre} ${user.apellidos}` : user.nombre;

  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href !== "/admin" && href !== "/manager" && href !== "/empleado") {
      return pathname.startsWith(href);
    }
    return false;
  };

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href);
    const Icon = item.icon;

    if (item.proximamente) {
      return (
        <Link
          href={item.href}
          className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
            "text-white/30 hover:text-white/50",
            collapsed && "justify-center px-2"
          )}
          title={collapsed ? item.label : undefined}
        >
          <Icon className="h-4 w-4 shrink-0 text-white/20" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-xs">{item.label}</span>
              <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                Pronto
              </span>
            </>
          )}
        </Link>
      );
    }

    return (
      <Link
        href={item.href}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
          active
            ? "bg-[var(--primary)] text-white shadow-sm"
            : "text-white/70 hover:bg-[var(--sidebar-highlight)] hover:text-white",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? item.label : undefined}
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            active ? "text-white" : "text-white/50 group-hover:text-white"
          )}
        />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white leading-none">
                {item.badge > 99 ? "99+" : item.badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  };

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

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex flex-col text-white/80 transition-all duration-300 overflow-hidden",
          "lg:relative lg:translate-x-0",
          collapsed ? "w-16" : "w-64",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
        style={{ backgroundColor: "var(--sidebar-bg)" }}
      >
        {/* Header */}
        <div className="flex h-14 items-center justify-between px-3 border-b border-white/10 shrink-0">
          {!collapsed && (
            <div className="flex items-center gap-2 overflow-hidden">
              {branding?.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.logo}
                  alt={branding.appNombre}
                  className="h-7 max-w-[32px] object-contain shrink-0"
                />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]">
                  <Building2 className="h-4 w-4 text-white" />
                </div>
              )}
              <span className="font-bold text-sm text-white truncate">
                {branding?.appNombre ?? "HR Suite"}
              </span>
            </div>
          )}
          {collapsed && (
            <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--primary)] overflow-hidden">
              {branding?.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branding.logo} alt="" className="h-7 w-7 object-contain" />
              ) : (
                <Building2 className="h-4 w-4 text-white" />
              )}
            </div>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              "hidden lg:flex h-6 w-6 items-center justify-center rounded-md text-white/40 hover:text-white hover:bg-[var(--sidebar-highlight)] transition-colors shrink-0",
              collapsed && "mx-auto"
            )}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* User info */}
        {!collapsed ? (
          <div className="px-3 py-3 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-[var(--primary)] text-white text-xs font-semibold">
                  {getInitials(user.nombre, user.apellidos)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate leading-tight">{fullName}</p>
                <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium mt-0.5", getRolColor(user.rol))}>
                  {getRolLabel(user.rol)}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-3 border-b border-white/10 shrink-0">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-[var(--primary)] text-white text-xs font-semibold">
                {getInitials(user.nombre, user.apellidos)}
              </AvatarFallback>
            </Avatar>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2 space-y-0.5 px-2">
          {/* Top item (Dashboard/Fichar) */}
          <div className="mb-1">
            <NavLink item={top} />
          </div>

          {/* Sections */}
          {sections.map((section) => {
            const isSectionCollapsed = collapsedSections[section.key];
            return (
              <div key={section.key} className="mb-1">
                {!collapsed && (
                  <button
                    onClick={() => toggleSection(section.key)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] font-bold text-white/35 uppercase tracking-wider hover:text-white/60 transition-colors"
                  >
                    <span>{section.label}</span>
                    {isSectionCollapsed
                      ? <ChevronRight className="h-3 w-3" />
                      : <ChevronDown className="h-3 w-3" />}
                  </button>
                )}
                {!isSectionCollapsed && (
                  <div className="space-y-0.5">
                    {section.items.map((item) => (
                      <NavLink key={item.href} item={item} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="mt-auto border-t border-white/10 p-2 space-y-0.5 shrink-0">
          <button
            className={cn(
              "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70 hover:bg-[var(--sidebar-highlight)] hover:text-white transition-colors",
              collapsed && "justify-center px-2"
            )}
            title={collapsed ? "Notificaciones" : undefined}
          >
            <div className="relative shrink-0">
              <Bell className="h-4 w-4 text-white/50 group-hover:text-white transition-colors" />
              {notificationCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white leading-none">
                  {notificationCount > 9 ? "9+" : notificationCount}
                </span>
              )}
            </div>
            {!collapsed && <span className="flex-1 text-left text-sm">Notificaciones</span>}
          </button>

          {user.rol === "SUPERADMIN" && (
            <Link
              href="/admin/configuracion"
              className={cn(
                "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70 hover:bg-[var(--sidebar-highlight)] hover:text-white transition-colors",
                isActive("/admin/configuracion") && "bg-[var(--primary)] text-white",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? "Configuración" : undefined}
            >
              <Settings className="h-4 w-4 text-indigo-400 group-hover:text-white transition-colors" />
              {!collapsed && <span className="flex-1 text-left text-sm">Configuración</span>}
            </Link>
          )}

          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className={cn(
              "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-white/70 hover:bg-red-500/20 hover:text-red-300 transition-colors",
              collapsed && "justify-center px-2"
            )}
            title={collapsed ? "Cerrar sesión" : undefined}
          >
            <LogOut className="h-4 w-4 shrink-0 text-white/50 group-hover:text-red-400 transition-colors" />
            {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
