import { ImageResponse } from "next/og";

// Next.js icon convention — genera el favicon con el símbolo empleaIA
// (mismo trazado que `EmpleaIASymbol`) en runtime sin necesidad de PNG.
// Los hosts/SO suelen pedir tamaños 32x32 (clásico) y Apple touch 180x180.
// Este file genera el icono base de 32x32; Next escala automáticamente
// para los demás tamaños declarados.
//
// Ref: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#5B5FE9",
          borderRadius: "7px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {/* "e" estilizada — Inter Bold */}
        <div
          style={{
            color: "white",
            fontSize: 24,
            fontWeight: 800,
            fontFamily: "system-ui, -apple-system, sans-serif",
            letterSpacing: "-0.05em",
            lineHeight: 1,
            marginTop: -1,
          }}
        >
          e
        </div>
        {/* Punto IA */}
        <div
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            width: 4,
            height: 4,
            borderRadius: "9999px",
            background: "white",
          }}
        />
      </div>
    ),
    {
      ...size,
    }
  );
}
