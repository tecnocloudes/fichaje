import { ImageResponse } from "next/og";

// Next.js icon convention — favicon empleaIA. Render del símbolo de la
// landing (EmpleaIASymbol): rect rounded primary con gradiente +
// arco abierto blanco + punto central. 32x32 PNG.
//
// La forma exacta es la de
// `empleaia-landing/src/components/Logo.astro` (símbolo "B").

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #2563EB 0%, #0F172A 100%)",
          borderRadius: "8px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          width="32"
          height="32"
        >
          <path
            d="M16 7a9 9 0 1 1-9 9"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <circle cx="16" cy="16" r="2.4" fill="#FFFFFF" />
        </svg>
      </div>
    ),
    {
      ...size,
    }
  );
}
