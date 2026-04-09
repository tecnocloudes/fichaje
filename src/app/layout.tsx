import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "TelecomFichaje",
    template: "%s | TelecomFichaje",
  },
  description: "Sistema de fichaje para tiendas de telecomunicaciones",
  keywords: ["fichaje", "telecomunicaciones", "tiendas", "empleados", "turnos"],
  authors: [{ name: "TelecomFichaje" }],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TelecomFichaje",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <body className="h-full antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
