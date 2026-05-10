/**
 * Rate limiting + lockout in-memory para login y endpoints sensibles.
 *
 * Limitación conocida: el store es un Map en `globalThis`, así que NO
 * se comparte entre réplicas. En producción (Dokploy single-replica
 * actualmente) basta. Si en algún momento se escala horizontalmente
 * con varias instancias, migrar a Redis/Upstash con la misma API.
 *
 * No ponemos esto en BD porque el coste de IO por cada login fallido
 * cae justo en el path crítico que estamos intentando proteger.
 */

type RateBucket = { count: number; resetAt: number };
type LockoutEntry = { unlockAt: number; failures: number };

const RATES: Map<string, RateBucket> =
  (globalThis as { _rateLimitBuckets?: Map<string, RateBucket> })._rateLimitBuckets ??
  ((globalThis as { _rateLimitBuckets?: Map<string, RateBucket> })._rateLimitBuckets = new Map());

const LOCKOUTS: Map<string, LockoutEntry> =
  (globalThis as { _rateLimitLockouts?: Map<string, LockoutEntry> })._rateLimitLockouts ??
  ((globalThis as { _rateLimitLockouts?: Map<string, LockoutEntry> })._rateLimitLockouts = new Map());

export type RateResult =
  | { ok: true; remaining: number; resetAt: number }
  | { ok: false; retryAfterMs: number; resetAt: number };

/**
 * Sliding window básico. Si la key supera `limit` en `windowMs`, devuelve
 * `ok: false`. Cada llamada incrementa el contador.
 */
export function checkRate(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const bucket = RATES.get(key);

  if (!bucket || bucket.resetAt <= now) {
    RATES.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterMs: bucket.resetAt - now, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

export type LockoutResult =
  | { locked: false }
  | { locked: true; unlockAt: number; remainingMs: number };

/**
 * Devuelve si la key está bloqueada (sin modificar estado).
 */
export function isLocked(key: string): LockoutResult {
  const entry = LOCKOUTS.get(key);
  if (!entry) return { locked: false };
  const now = Date.now();
  if (entry.unlockAt <= now) {
    LOCKOUTS.delete(key);
    return { locked: false };
  }
  return { locked: true, unlockAt: entry.unlockAt, remainingMs: entry.unlockAt - now };
}

/**
 * Registra un fallo. Si supera `threshold` dentro de la misma "ventana"
 * (cada lockout reinicia el contador), bloquea durante `lockoutMs`.
 *
 * El contador se acumula en el LockoutEntry mientras no esté locked;
 * una vez locked, queda fijado hasta `unlockAt`.
 */
export function recordFailure(
  key: string,
  threshold: number,
  lockoutMs: number,
): { locked: boolean; failures: number; unlockAt?: number } {
  const now = Date.now();
  const entry = LOCKOUTS.get(key);

  // Si ya estaba locked y aún no venció, no hace falta tocar el contador.
  if (entry && entry.unlockAt > now) {
    return { locked: true, failures: entry.failures, unlockAt: entry.unlockAt };
  }

  const failures = (entry?.failures ?? 0) + 1;

  if (failures >= threshold) {
    const unlockAt = now + lockoutMs;
    LOCKOUTS.set(key, { unlockAt, failures });
    return { locked: true, failures, unlockAt };
  }

  // Mantener contador con TTL = lockoutMs (si no hay más fallos, expira).
  LOCKOUTS.set(key, { unlockAt: now + lockoutMs, failures });
  return { locked: false, failures };
}

/**
 * Limpia el contador de fallos tras un éxito.
 */
export function clearFailures(key: string): void {
  LOCKOUTS.delete(key);
}
