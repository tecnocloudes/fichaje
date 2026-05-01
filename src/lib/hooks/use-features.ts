"use client";

/**
 * `useFeatures()` — hook cliente que lee `/api/me/features` con caché
 * en sessionStorage. ADR-004 §2.6 + plan Fase 5 §4.4.
 *
 * El front del tenant pide las features en una sola llamada al cargar
 * la app. Persistir en sessionStorage para no re-pegar en cada
 * navegación.
 *
 * Invalidación:
 *  - Logout: limpiar entrada `features:<slug>`.
 *  - Carga de /admin/configuracion/facturacion: invalidar (allí se hacen
 *    los upgrades; cualquier visita asume estado puede haber cambiado).
 *  - refresh() manual del consumer.
 *
 * NO invalidar en cambios de ruta normales (coste de re-fetch
 * desproporcionado).
 */

import { useCallback, useEffect, useState } from "react";

export type FeaturesResponse = {
  booleans: Record<string, boolean>;
  limits: Record<string, { current?: number; max: number | null }>;
  quotas: Record<
    string,
    { used: number; max: number | null; resetAt: string }
  >;
};

const CACHE_KEY_PREFIX = "features:";
const STALE_AFTER_MS = 5 * 60 * 1000; // 5 min

type CachedEntry = {
  data: FeaturesResponse;
  fetchedAt: number;
};

function getCacheKey(): string {
  // El slug está en el subdominio actual.
  if (typeof window === "undefined") return CACHE_KEY_PREFIX + "ssr";
  const host = window.location.host;
  const slug = host.split(".")[0] ?? "unknown";
  return CACHE_KEY_PREFIX + slug;
}

function readCache(): CachedEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getCacheKey());
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    if (Date.now() - entry.fetchedAt > STALE_AFTER_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(data: FeaturesResponse): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedEntry = { data, fetchedAt: Date.now() };
    window.sessionStorage.setItem(getCacheKey(), JSON.stringify(entry));
  } catch {
    // sessionStorage lleno o privado: ignorar.
  }
}

function clearCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getCacheKey());
  } catch {
    // ignorar.
  }
}

export type UseFeaturesResult = {
  data: FeaturesResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};

export function useFeatures(): UseFeaturesResult {
  const [data, setData] = useState<FeaturesResponse | null>(
    () => readCache()?.data ?? null,
  );
  const [loading, setLoading] = useState<boolean>(data === null);
  const [error, setError] = useState<Error | null>(null);

  const fetchFeatures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/me/features", { cache: "no-store" });
      if (!r.ok) throw new Error(`/api/me/features status ${r.status}`);
      const body = (await r.json()) as FeaturesResponse;
      setData(body);
      writeCache(body);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    clearCache();
    await fetchFeatures();
  }, [fetchFeatures]);

  useEffect(() => {
    if (data === null) {
      void fetchFeatures();
    }
  }, [data, fetchFeatures]);

  return { data, loading, error, refresh };
}

/**
 * Helper imperativo para invalidar la caché desde fuera del hook
 * (e.g. tras logout o al entrar a /admin/configuracion/facturacion).
 */
export function invalidateFeaturesCache(): void {
  clearCache();
}
