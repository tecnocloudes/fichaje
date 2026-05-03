import * as React from "react";
import { cn } from "@/lib/utils";

interface EmpleaIASymbolProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  /** id único del gradient (para evitar colisiones cuando hay varios símbolos) */
  gradientId?: string;
}

/**
 * Símbolo empleaIA — copiado 1:1 del componente <Logo> de la landing
 * (`empleaia-landing/src/components/Logo.astro`, símbolo "B").
 * Cuadrado redondeado con gradiente diagonal `#5B5FE9 → #4A4ECC`,
 * arco abierto blanco que evoca "loading"/"tracker" + punto central.
 */
export function EmpleaIASymbol({
  size = 32,
  gradientId,
  className,
  ...rest
}: EmpleaIASymbolProps) {
  const id = gradientId ?? React.useId().replace(/[^a-z0-9]/gi, "");
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...rest}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5B5FE9" />
          <stop offset="1" stopColor="#4A4ECC" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${id})`} />
      <path
        d="M16 7a9 9 0 1 1-9 9"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="2.4" fill="#FFFFFF" />
    </svg>
  );
}

interface EmpleaIALogoProps {
  appNombre?: string | null;
  className?: string;
  symbolSize?: number;
  /** color del wordmark "emplea". por defecto var(--color-text-dark) */
  wordmarkClassName?: string;
  /** font-size del wordmark — por defecto 23px (mismo que la landing) */
  wordmarkFontSize?: number | string;
}

/**
 * Logo completo — símbolo + wordmark — alineado 1:1 con la landing
 * (`empleaia-landing/src/components/Logo.astro`):
 *   - símbolo `EmpleaIASymbol` 36px en navbar.
 *   - texto en Inter Bold, `tracking: -0.02em`, gap 11px al símbolo.
 *   - "emplea" en text-dark, "IA" en color primary.
 *
 * Si `appNombre` empieza por "empleaIA" (case-insensitive), se respeta
 * el sufijo. En otro caso (custom branding del tenant), se renderiza
 * el `appNombre` tal cual.
 */
export function EmpleaIALogo({
  appNombre,
  className,
  symbolSize = 36,
  wordmarkClassName,
  wordmarkFontSize = 23,
}: EmpleaIALogoProps) {
  const name = (appNombre ?? "").trim();
  const lower = name.toLowerCase();
  const matchesEmpleaIA = !name || lower.startsWith("empleaia");
  const suffix = matchesEmpleaIA ? name.slice("empleaia".length) : null;

  return (
    <span
      className={cn(
        "inline-flex items-center font-bold leading-none tracking-[-0.02em]",
        className
      )}
      style={{ gap: "11px" }}
    >
      <EmpleaIASymbol size={symbolSize} />
      <span
        className={cn("whitespace-nowrap truncate", wordmarkClassName)}
        style={{ fontSize: typeof wordmarkFontSize === "number" ? `${wordmarkFontSize}px` : wordmarkFontSize }}
      >
        {matchesEmpleaIA ? (
          <>
            <span className="text-[var(--color-text-dark,#0F172A)]">emplea</span>
            <span className="text-[var(--color-primary,#5B5FE9)]">IA</span>
            {suffix && <span className="text-[var(--color-text-dark,#0F172A)]">{suffix}</span>}
          </>
        ) : (
          <span className="text-[var(--color-text-dark,#0F172A)]">{name}</span>
        )}
      </span>
    </span>
  );
}
