/**
 * Wrapper de dns.promises.resolveTxt con timeout.
 * Plan Fase 6 §4.2: lookup TXT puede tardar (propagación DNS).
 *
 * Devuelve la promise rechazada con un Error si el timeout vence
 * antes de la respuesta DNS.
 */

import { promises as dns } from "node:dns";

export async function resolveTxtWithTimeout(
  host: string,
  timeoutMs: number,
): Promise<string[][]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`DNS resolveTxt timeout (${timeoutMs}ms): ${host}`)),
      timeoutMs,
    );
  });
  try {
    const result = await Promise.race([dns.resolveTxt(host), timeout]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
