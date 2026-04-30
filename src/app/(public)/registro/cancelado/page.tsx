/**
 * Página tras cancelación voluntaria del Checkout.
 *
 * El tenant en master.tenants queda en status=PENDING. El job horario
 * lo borrará a las 24h (commit 19).
 */

export default function Page() {
  return (
    <main
      style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: 32,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 28 }}>Has cancelado el pago</h1>
      <p>No se ha cargado nada a tu tarjeta.</p>
      <p style={{ marginTop: 24 }}>
        <a
          href="/registro"
          style={{
            background: "#6366f1",
            color: "white",
            padding: "10px 20px",
            textDecoration: "none",
            borderRadius: 6,
            display: "inline-block",
          }}
        >
          Volver al registro
        </a>
      </p>
    </main>
  );
}
