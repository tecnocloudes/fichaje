import * as React from "react";
import { cn } from "@/lib/utils";

interface EmpleaIASymbolProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  /** id único del gradient (para evitar colisiones cuando hay varios símbolos) */
  gradientId?: string;
}

/**
 * Símbolo empleaIA — versión SVG inline (gradient Royal Blue → Navy).
 * Se sigue exportando porque lo consumen `src/app/icon.tsx` y
 * `src/app/apple-icon.tsx` (favicon dinámico de Next 16) donde no
 * podemos usar `<img>` con archivo estático.
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
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#0F172A" />
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
  /** Solo aplica en layout "horizontal": tamaño del texto wordmark HTML. */
  wordmarkFontSize?: number | string;
  /** Color del wordmark "emplea" (solo layout horizontal). */
  wordmarkClassName?: string;
  /**
   * "stacked" (default): renderiza el PNG generado en Stitch (isotipo 3D +
   * texto "EmpleaIA" integrado). Indicado para uso centrado con espacio
   * suficiente (formularios de login, registro).
   *
   * "horizontal": renderiza el símbolo SVG + el texto del wordmark en HTML
   * al lado. Indicado para barras estrechas como el sidebar.
   *
   * Si el tenant tiene `appNombre` distinto a "empleaIA", se fuerza
   * `horizontal` para respetar el branding custom.
   */
  layout?: "stacked" | "horizontal";
}

/**
 * Logo completo de empleaIA. Soporta multi-tenant branding.
 */
export function EmpleaIALogo({
  appNombre,
  className,
  symbolSize = 36,
  wordmarkClassName,
  wordmarkFontSize = 23,
  layout = "stacked",
}: EmpleaIALogoProps) {
  const name = (appNombre ?? "").trim();
  const lower = name.toLowerCase();
  const isStockBranding = !name || lower === "empleaia";

  // Tenant con branding propio → siempre formato horizontal con su nombre.
  // Marca stock + layout horizontal → SVG iso + "empleaIA" HTML (sidebar).
  if (!isStockBranding || layout === "horizontal") {
    const displayName = isStockBranding ? "empleaIA" : name;
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
          style={{
            fontSize:
              typeof wordmarkFontSize === "number"
                ? `${wordmarkFontSize}px`
                : wordmarkFontSize,
          }}
        >
          {isStockBranding ? (
            <>
              <span className="text-[var(--color-text-dark,#0F172A)]">emplea</span>
              <span className="text-[var(--color-primary,#2563EB)]">IA</span>
            </>
          ) : (
            <span className="text-[var(--color-text-dark,#0F172A)]">{displayName}</span>
          )}
        </span>
      </span>
    );
  }

  // Marca stock + layout stacked → PNG completo Stitch.
  return (
    <img
      src="/stitch/logo-source.png"
      alt="empleaIA"
      width={symbolSize}
      height={symbolSize}
      className={cn("inline-block shrink-0", className)}
      style={{
        width: symbolSize,
        height: symbolSize,
        objectFit: "cover",
      }}
    />
  );
}
