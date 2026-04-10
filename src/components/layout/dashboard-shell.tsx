"use client";

import React, { useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

interface SessionUser {
  id: string;
  nombre: string;
  apellidos: string;
  email: string;
  rol: string;
  tiendaId: string | null;
}

interface Branding {
  logo?: string | null;
  appNombre: string;
  nombre?: string | null;
}

interface DashboardShellProps {
  children: React.ReactNode;
  user: SessionUser;
  branding?: Branding;
}

export function DashboardShell({ children, user, branding }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);

  return (
    <div className="flex h-full min-h-screen bg-muted/30">
      <Sidebar
        user={user}
        branding={branding}
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
        notificationCount={0}
        pendingAusencias={0}
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Header user={user} onMenuToggle={toggleSidebar} notificationCount={0} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="mx-auto max-w-7xl animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
