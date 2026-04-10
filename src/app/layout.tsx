import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";
import { prisma } from "@/lib/prisma";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

async function getBranding() {
  try {
    const config = await prisma.configuracionEmpresa.findFirst({
      select: {
        appNombre: true,
        colorPrimario: true,
        colorSidebar: true,
        favicon: true,
      },
    });
    return {
      appNombre: config?.appNombre ?? "TelecomFichaje",
      colorPrimario: config?.colorPrimario ?? "#6366f1",
      colorSidebar: config?.colorSidebar ?? "#1e1b4b",
      favicon: config?.favicon ?? null,
    };
  } catch {
    return {
      appNombre: "TelecomFichaje",
      colorPrimario: "#6366f1",
      colorSidebar: "#1e1b4b",
      favicon: null,
    };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return {
    title: {
      default: branding.appNombre,
      template: `%s | ${branding.appNombre}`,
    },
    description: "Sistema de fichaje y gestión de RRHH",
    manifest: "/manifest.webmanifest",
    icons: branding.favicon
      ? { icon: "/api/branding/favicon", shortcut: "/api/branding/favicon" }
      : { icon: "/favicon.ico" },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: branding.appNombre,
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
  const branding = await getBranding();
  const sidebarHighlight = lightenHex(branding.colorSidebar, 28);

  const cssVars = `
    :root {
      --primary: ${branding.colorPrimario};
      --ring: ${branding.colorPrimario};
      --accent-foreground: ${branding.colorPrimario};
      --sidebar-bg: ${branding.colorSidebar};
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
