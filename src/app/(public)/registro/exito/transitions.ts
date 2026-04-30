/**
 * Lógica pura de la máquina de estados del polling de
 * /registro/exito. Extraída del componente exito-cliente.tsx para
 * que sea testeable sin React + jsdom.
 *
 * El polling recibe una respuesta del endpoint /api/onboarding/status
 * cada 2s y llama a `decideNextState` con: la respuesta actual, el
 * número de "unknown" consecutivos previos, y el tiempo transcurrido
 * desde el primer poll. La función devuelve el estado visual y si
 * debe seguir polling.
 *
 * Cuatro estados visuales:
 * - "waiting": pending | provisioning | unknown transitorio (<15
 *              consecutivos). Spinner + "preparando".
 * - "slow":   ≥15 unknown consecutivos (~30s) o ≥30s sin alcanzar
 *             active en cualquier ruta. Spinner + aviso amarillo.
 * - "active": redirect.
 * - "error":  fetch network error o timeout absoluto 5 min.
 */

export type ApiStatus =
  | "pending"
  | "provisioning"
  | "active"
  | "error"
  | "unknown";

export type VisualState = "waiting" | "slow" | "active" | "error";

export const UNKNOWN_SLOW_THRESHOLD = 15;
export const ABSOLUTE_TIMEOUT_MS = 5 * 60 * 1000;
export const SLOW_AFTER_MS = 30_000;

export type ApiResponse = { status: ApiStatus; slug?: string };

export type Decision = {
  /** Estado visual a renderizar. */
  visual: VisualState;
  /** Si seguir polling. false si visual=active|error (terminales). */
  continuePolling: boolean;
  /** Nuevo contador de "unknown" consecutivos. */
  nextUnknownStreak: number;
  /** Slug del tenant si la respuesta lo trae. */
  slug: string | undefined;
};

/**
 * Decide el siguiente estado a partir de la respuesta del endpoint
 * y el contexto del polling (streak previo, tiempo transcurrido).
 */
export function decideNextState(
  response: ApiResponse,
  prevUnknownStreak: number,
  elapsedMs: number,
): Decision {
  // Timeout absoluto siempre gana.
  if (elapsedMs > ABSOLUTE_TIMEOUT_MS) {
    return {
      visual: "error",
      continuePolling: false,
      nextUnknownStreak: prevUnknownStreak,
      slug: response.slug,
    };
  }

  if (response.status === "active") {
    return {
      visual: "active",
      continuePolling: false,
      nextUnknownStreak: 0,
      slug: response.slug,
    };
  }

  if (response.status === "unknown") {
    const nextStreak = prevUnknownStreak + 1;
    const visual: VisualState =
      nextStreak >= UNKNOWN_SLOW_THRESHOLD ? "slow" : "waiting";
    return {
      visual,
      continuePolling: true,
      nextUnknownStreak: nextStreak,
      slug: response.slug,
    };
  }

  // pending | provisioning | error (api-side raro).
  // Reset streak — recibimos algo distinto a unknown.
  const visual: VisualState =
    elapsedMs > SLOW_AFTER_MS ? "slow" : "waiting";
  return {
    visual,
    continuePolling: true,
    nextUnknownStreak: 0,
    slug: response.slug,
  };
}

/**
 * Decisión cuando el fetch lanza (network error, JSON malformado, etc.).
 * Pasa directamente a "error" terminal.
 */
export function decideOnFetchError(): Decision {
  return {
    visual: "error",
    continuePolling: false,
    nextUnknownStreak: 0,
    slug: undefined,
  };
}
