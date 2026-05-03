import { ImageResponse } from "next/og";

// Apple touch icon — 180x180. Mismo símbolo que el favicon escalado.
// Mantener proporciones del SVG original (viewBox 32) escalando 5.625x.

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #5B5FE9 0%, #4A4ECC 100%)",
          borderRadius: "40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 32 32"
          width="180"
          height="180"
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
