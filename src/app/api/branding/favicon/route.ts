import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const config = await prisma.configuracionEmpresa.findFirst({
      select: { favicon: true },
    });

    if (!config?.favicon) {
      return new Response(null, { status: 404 });
    }

    // favicon is stored as a data URL: "data:image/png;base64,..."
    const [header, data] = config.favicon.split(",");
    const mime = header.match(/:(.*?);/)?.[1] ?? "image/png";
    const buffer = Buffer.from(data, "base64");

    return new Response(buffer, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
