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
      <main style={{ maxWidth: 600, margin: "0 auto", padding: 32, textAlign: "center" }}>
        <h1>Falta session_id</h1>
        <p>Esta página solo se muestra tras un Checkout exitoso de Stripe.</p>
      </main>
    );
  }
  return <ExitoCliente sessionId={session_id} />;
}
