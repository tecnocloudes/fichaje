import * as React from "react";
import { cn } from "@/lib/utils";

interface EmpleaIASymbolProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Símbolo empleaIA — cuadrado redondeado en primary con una "e"
 * sólida y un punto blanco que evoca el "punto inteligente" (IA).
 * Pensado para favicon y sidebar.
 */
export function EmpleaIASymbol({
  size = 32,
  className,
  ...rest
}: EmpleaIASymbolProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label="empleaIA"
      className={cn("shrink-0", className)}
      {...rest}
    >
      <rect width="64" height="64" rx="14" fill="var(--primary, #5B5FE9)" />
      {/* "e" sólida */}
      <path
        d="M32 18c-7.732 0-14 6.268-14 14s6.268 14 14 14c4.967 0 9.318-2.59 11.78-6.49a2.4 2.4 0 0 0-4.064-2.564C37.99 39.45 35.187 41.2 32 41.2c-4.04 0-7.45-2.71-8.51-6.4H44a2 2 0 0 0 2-2v-.8c0-7.732-6.268-14-14-14Zm-8.51 11.6C24.55 25.91 27.96 23.2 32 23.2s7.45 2.71 8.51 6.4H23.49Z"
        fill="white"
      />
      {/* punto IA superior derecha */}
      <circle cx="48" cy="20" r="4" fill="white" />
    </svg>
  );
}

interface EmpleaIALogoProps {
  appNombre?: string | null;
  className?: string;
  symbolSize?: number;
  /** color del wordmark "emplea". por defecto slate-900 */
  wordmarkClassName?: string;
}

/**
 * Logo completo — símbolo + wordmark.
 *  - "emplea" en slate-900 (o el color del prop)
 *  - "IA" en color primary
 *
 * Reglas de wordmark:
 *  - Si appNombre comienza con "empleaIA"/"empleaia" (case-insensitive) →
 *    se destaca "IA" en primary y el resto del nombre va detrás
 *    (ej. "empleaIA Demo" → "emplea<IA> Demo").
 *  - Si appNombre es custom (tenant branding) → se renderiza tal cual
 *    sin estilizar.
 */
export function EmpleaIALogo({
  appNombre,
  className,
  symbolSize = 32,
  wordmarkClassName,
}: EmpleaIALogoProps) {
  const name = (appNombre ?? "").trim();
  const lower = name.toLowerCase();
  const matchesEmpleaIA = !name || lower.startsWith("empleaia");
  const suffix = matchesEmpleaIA ? name.slice("empleaia".length) : null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <EmpleaIASymbol size={symbolSize} />
      <span
        className={cn(
          "font-bold text-base tracking-tight truncate leading-none",
          wordmarkClassName ?? "text-slate-900"
        )}
      >
        {matchesEmpleaIA ? (
          <>
            emplea<span className="text-[var(--primary)]">IA</span>
            {suffix}
          </>
        ) : (
          name
        )}
      </span>
    </div>
  );
}
