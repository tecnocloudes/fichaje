import { ImageResponse } from "next/og";

// Apple touch icon — usado por iOS al guardar la PWA en home screen.
// Mismo símbolo que el favicon pero a 180x180 con padding correcto.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#5B5FE9",
          borderRadius: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <div
          style={{
            color: "white",
            fontSize: 130,
            fontWeight: 800,
            fontFamily: "system-ui, -apple-system, sans-serif",
            letterSpacing: "-0.05em",
            lineHeight: 1,
            marginTop: -6,
          }}
        >
          e
        </div>
        <div
          style={{
            position: "absolute",
            top: 28,
            right: 28,
            width: 22,
            height: 22,
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
