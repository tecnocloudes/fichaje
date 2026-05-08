/**
 * Detección de device type por User-Agent — server-safe (no
 * importa nada de React, vive separado de `lib/device.ts` que sí
 * tiene el hook cliente).
 *
 * Heurística conservadora: iPad explícito → tablet, Tablet/Silk →
 * tablet, Mobi/Android/iPhone/iPod/Windows Phone → mobile, resto →
 * desktop. Sin viewport ni pointer:coarse (no disponibles en server).
 */

import type { DeviceType } from "@/lib/device-types";

export function detectDeviceTypeFromUA(ua: string): DeviceType {
  if (!ua) return "unknown";
  if (/iPad/.test(ua)) return "tablet";
  if (/Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return "mobile";
  return "desktop";
}
