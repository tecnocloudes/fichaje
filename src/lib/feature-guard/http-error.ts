/**
 * HttpError — error tipado que un handler puede lanzar para devolver
 * un body JSON estructurado con un status HTTP concreto.
 *
 * Uso típico (ADR-004 §2.10 max_employees con advisory lock):
 *
 *   if (count >= max) {
 *     throw new HttpError(402, {
 *       error: "limit_reached",
 *       feature_key: "max_employees",
 *       current: count,
 *       max,
 *       upgrade_url: "/admin/configuracion/facturacion?upgrade=max_employees",
 *     });
 *   }
 *
 * Combinado con `wrapHttpErrors(handler)`: el wrapper captura
 * HttpError y devuelve el response correspondiente.
 */

import { type NextRequest, NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(`HttpError ${status}: ${JSON.stringify(body)}`);
    this.name = "HttpError";
  }
}

type Handler<Args extends unknown[]> = (
  req: NextRequest,
  ...rest: Args
) => Promise<Response> | Response;

/**
 * Wrapper que captura HttpError lanzado dentro del handler y devuelve
 * el response JSON correspondiente. Otros errores se propagan como
 * 500 con body `{ error: "internal" }` y log a stderr.
 */
export function wrapHttpErrors<Args extends unknown[]>(
  handler: Handler<Args>,
): Handler<Args> {
  return async (req, ...rest) => {
    try {
      return await handler(req, ...rest);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      console.error("[wrapHttpErrors] internal error:", err);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
  };
}
