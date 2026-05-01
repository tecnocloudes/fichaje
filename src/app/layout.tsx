import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * El root layout sirve TODOS los hosts (apex, app, admin, tenant). Hacer
 * una query a `prismaApp.configuracionEmpresa` aquí significaría:
 *  1. 1 query master por cada navegación, incluso para subdominios
 *     `app.localhost/registro` que NO tienen tenant.
 *  2. Imposible envolver con `withTenantPage` porque el layout sirve
 *     hosts donde NO hay tenant.
 *
 * Solución (opción C parcial Bug 4 Fase 4): el root layout usa branding
 * **default hardcoded**. El branding por tenant se aplica desde el
 * layout/page del subdominio tenant que SÍ está envuelto con
 * `withTenantPage` (e.g. `(dashboard)/layout.tsx`,
 * `(auth)/login/page.tsx`).
 *
 * Trade-off aceptado: el "<title>" del navegador es siempre el default
 * "Fichaje" hasta que el layout hijo del tenant pueda renderear su
 * título. En la práctica los usuarios siempre llegan a páginas dentro
 * del tenant donde el título correcto se computa antes de mostrarse.
 */

const DEFAULT_BRANDING = {
  appNombre: "Fichaje",
  colorPrimario: "#6366f1",
  colorSidebar: "#1e1b4b",
  favicon: null as string | null,
};

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: {
      default: DEFAULT_BRANDING.appNombre,
      template: `%s | ${DEFAULT_BRANDING.appNombre}`,
    },
    description: "Sistema de fichaje y gestión de RRHH",
    manifest: "/manifest.webmanifest",
    icons: { icon: "/favicon.ico" },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: DEFAULT_BRANDING.appNombre,
    },
    formatDetection: { telephone: false },
  };
}

/** Derive a slightly lighter version of the sidebar color for hover states */
function lightenHex(hex: string, amount = 20): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Branding default. El tenant override se hace en el layout del
  // subdominio tenant via withTenantPage.
  const sidebarHighlight = lightenHex(DEFAULT_BRANDING.colorSidebar, 28);

  const cssVars = `
    :root {
      --primary: ${DEFAULT_BRANDING.colorPrimario};
      --ring: ${DEFAULT_BRANDING.colorPrimario};
      --accent-foreground: ${DEFAULT_BRANDING.colorPrimario};
      --sidebar-bg: ${DEFAULT_BRANDING.colorSidebar};
      --sidebar-highlight: ${sidebarHighlight};
    }
  `;

  return (
    <html lang="es" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVars }} />
      </head>
      <body className="h-full antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
