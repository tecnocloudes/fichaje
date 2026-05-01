"use client";

/**
 * `<FeatureGateClient>` — variante cliente de `<FeatureGate>` para
 * usar dentro de UI client. Plan Fase 5 §15.1.
 *
 * Lee de `useFeatures()` (hook con sessionStorage caché). Si la feature
 * está cargando, muestra `loading` (default: nada). Si está activa,
 * renderiza children. Si no, fallback.
 *
 * Trade-off vs server `<FeatureGate>`:
 *  - Pro: funciona dentro de "use client" boundaries.
 *  - Pro: refresh() del hook permite toggle en respuesta a cambios
 *    de upgrade sin recargar la página.
 *  - Contra: el código JS del children siempre se envía al navegador
 *    (no hay tree-shaking server-only). Para evitar leak, preferir
 *    `<FeatureGate>` server.
 */

import type { ReactNode } from "react";
import { useFeatures } from "@/lib/hooks/use-features";

export function FeatureGateClient({
  feature,
  fallback,
  loading,
  children,
}: {
  feature: string;
  fallback?: ReactNode;
  loading?: ReactNode;
  children: ReactNode;
}) {
  const { data, loading: isLoading } = useFeatures();
  if (isLoading || data === null) return <>{loading ?? null}</>;
  if (data.booleans[feature] === true) return <>{children}</>;
  return <>{fallback ?? null}</>;
}
