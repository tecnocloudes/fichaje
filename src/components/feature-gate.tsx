/**
 * `<FeatureGate>` — server component. ADR-004 §2.7 + plan Fase 5 §3.
 *
 * Lee `currentTenant().features` directamente (estamos dentro del
 * runWithTenant gracias a withTenantPage).
 *
 * Restricción importante (enmienda 3 plan §3.1): este componente es
 * SERVER. NO puede ser hijo directo de un client component (Next 16
 * lanza). Para casos cliente, usa `<FeatureGateClient>` (commit 7).
 *
 * Patrón recomendado: gate en server padre antes del client child.
 *
 * ```tsx
 * <FeatureGate feature="api_access" fallback={<UpsellCTA feature="api_access" />}>
 *   <ApiTokensClientPanel />
 * </FeatureGate>
 * ```
 */

import { hasFeature } from "@/lib/tenant/features";
import type { ReactNode } from "react";

export function FeatureGate({
  feature,
  fallback,
  children,
}: {
  feature: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  if (hasFeature(feature)) return <>{children}</>;
  return <>{fallback ?? null}</>;
}
