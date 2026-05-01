/**
 * AsyncLocalStorage del super-admin actual.
 * ADR-007 §2.2 — análogo a `currentTenant()` de los tenants.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type SuperAdminContext = {
  id: string;
  email: string;
  role: "SUPER_ADMIN" | "SUPPORT";
};

const storage = new AsyncLocalStorage<SuperAdminContext>();

export function runWithSuperAdmin<T>(
  ctx: SuperAdminContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return storage.run(ctx, fn);
}

export function currentSuperAdmin(): SuperAdminContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      "No hay super-admin en el contexto. Usa withSuperAdmin para envolver el handler.",
    );
  }
  return ctx;
}

export function tryGetSuperAdmin(): SuperAdminContext | null {
  return storage.getStore() ?? null;
}
