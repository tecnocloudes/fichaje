/**
 * Detección de tipo de dispositivo en el cliente. Plan Fase 5 cierre A.3.
 *
 * Usado por las UIs de fichaje del empleado para gatear según las
 * features `fichaje_movil` y `fichaje_tablet`. Coherente con
 * CORE-safe (RD 8/2019): el fichaje SIEMPRE es accesible — desde
 * algún dispositivo. Los planes Starter restringen a desktop/kiosko
 * web; planes superiores habilitan móvil/tablet.
 *
 * Heurística (no perfecta, evita user-agent sniffing pesado):
 *   - mobile: viewport <= 640 y/o pointer:coarse + maxTouchPoints>0
 *     y/o user-agent con "Mobi".
 *   - tablet: pointer:coarse + (640 < width <= 1024) y/o iPad.
 *   - desktop: el resto.
 *
 * Hook React `useDeviceType()` evalúa al montar y reactiva ante
 * `resize` y `orientationchange`. Durante SSR devuelve "unknown".
 */

import { useEffect, useState } from "react";
import type { DeviceType } from "@/lib/device-types";

export type { DeviceType };

// `detectDeviceTypeFromUA` se exporta desde `@/lib/device-ua` para
// poder importarse desde server routes (route handlers) sin arrastrar
// el `useEffect/useState` de React que vive en este archivo.
export { detectDeviceTypeFromUA } from "@/lib/device-ua";

export function detectDeviceType(): DeviceType {
  if (typeof window === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  const w = window.innerWidth;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;

  // iPad moderno reporta UA de Mac — distinguir por touchpoints.
  const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touch);
  if (isIpad) return "tablet";

  if (/Tablet|PlayBook|Silk/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return "mobile";

  // Sin UA marker: usar viewport + pointer.
  if (coarse && touch) {
    if (w <= 640) return "mobile";
    if (w <= 1024) return "tablet";
  }
  return "desktop";
}

export function useDeviceType(): DeviceType {
  const [type, setType] = useState<DeviceType>(() => detectDeviceType());
  useEffect(() => {
    const update = () => setType(detectDeviceType());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return type;
}

/**
 * Devuelve la feature key requerida para fichar desde el dispositivo
 * actual, o `null` si no requiere ninguna (desktop / unknown).
 */
export function deviceFichajeFeature(type: DeviceType): string | null {
  if (type === "mobile") return "fichaje_movil";
  if (type === "tablet") return "fichaje_tablet";
  return null;
}
