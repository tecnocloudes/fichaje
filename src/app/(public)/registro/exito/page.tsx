/**
 * Página tras Stripe Checkout exitoso. ADR-003 §2.6 + §8.2 plan Fase 4.
 *
 * El navegador llega aquí con ?session_id=cs_test_... cuando el usuario
 * paga. El webhook checkout.session.completed puede llegar antes,
 * después, o en paralelo. Por eso la página hace polling al endpoint
 * /api/onboarding/status?session_id=... que devuelve el status del
 * tenant.
 *
 * - active → redirect a <slug>.localhost:3000/login (o producción).
 * - provisioning|pending → seguir esperando con animación.
 * - error → mostrar mensaje + CTA contacto soporte.
 */

import { ExitoCliente } from "./exito-cliente";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  if (!session_id) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
        <main className="text-center max-w-md bg-white border border-slate-200 rounded-lg shadow-sm px-8 py-10">
          <h1 className="text-2xl font-bold text-slate-900">Falta session_id</h1>
          <p className="text-sm text-slate-500 mt-2">Esta página solo se muestra tras un Checkout exitoso de Stripe.</p>
        </main>
      </div>
    );
  }
  return <ExitoCliente sessionId={session_id} />;
}
