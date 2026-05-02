import * as React from "react";
import { cn } from "@/lib/utils";

interface EmpleaIASymbolProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Símbolo empleaIA: cuadrado redondeado con la letra "e" estilizada.
 * Color principal: var(--primary). Color claro: blanco.
 */
export function EmpleaIASymbol({
  size = 32,
  className,
  ...rest
}: EmpleaIASymbolProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="empleaIA"
      className={cn("shrink-0", className)}
      {...rest}
    >
      <rect width="32" height="32" rx="8" fill="var(--primary, #5B5FE9)" />
      <path
        d="M11.5 16.4c0-2.45 1.86-4.4 4.3-4.4 2.32 0 4.1 1.78 4.1 4.1v.7H13.4c.2 1.5 1.27 2.5 2.85 2.5 1.07 0 1.85-.42 2.32-1.16l1.55 1.07c-.85 1.32-2.27 2.07-3.93 2.07-2.62 0-4.7-1.95-4.7-4.88Zm6.55-1.06c-.16-1.13-1.05-1.86-2.27-1.86-1.18 0-2.07.7-2.32 1.86h4.6Z"
        fill="white"
      />
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
 * Logo completo: símbolo + wordmark.
 *  - "emplea" en slate-900 (o color del prop)
 *  - "IA" en color primary
 * Si appNombre viene custom (tenant branding), se renderiza tal cual sin
 * resaltar IA al final.
 */
export function EmpleaIALogo({
  appNombre,
  className,
  symbolSize = 32,
  wordmarkClassName,
}: EmpleaIALogoProps) {
  const isDefault = !appNombre || appNombre.toLowerCase() === "empleaia";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <EmpleaIASymbol size={symbolSize} />
      <span
        className={cn(
          "font-bold text-base tracking-tight truncate leading-none",
          wordmarkClassName ?? "text-slate-900"
        )}
      >
        {isDefault ? (
          <>
            emplea<span className="text-[var(--primary)]">IA</span>
          </>
        ) : (
          appNombre
        )}
      </span>
    </div>
  );
}
