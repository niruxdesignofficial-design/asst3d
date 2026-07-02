interface Props {
  code: string;
  paymentsEnabled: boolean;
  onDismiss: () => void;
}

/** Banner de bloqueo cuando el server rechaza una generación. */
export function UsageGate({ code, paymentsEnabled, onDismiss }: Props) {
  let title = "";
  let body = "";
  if (code === "free_limit_reached") {
    title = "Se te acabaron las generaciones gratis";
    body = paymentsEnabled
      ? "Conectá tu wallet y accedé con el token para seguir generando."
      : "El acceso con token está llegando pronto. Volvé más tarde para seguir generando.";
  } else if (code === "capacity_reached") {
    title = "Capacidad completa";
    body = "La app llegó a su tope de generaciones de este mes. Probá de nuevo más tarde.";
  } else if (code === "rate_limited") {
    title = "Muy rápido";
    body = "Estás generando demasiado seguido. Esperá un momento y probá de nuevo.";
  } else {
    title = "No se pudo generar";
    body = "Ocurrió un problema. Probá de nuevo en unos minutos.";
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <h3>{title}</h3>
        <p className="muted">{body}</p>
        <div className="gate-actions">
          {code === "free_limit_reached" && (
            <button className="btn-primary" disabled={!paymentsEnabled} title={paymentsEnabled ? "" : "Próximamente"}>
              🔑 Acceso con token {paymentsEnabled ? "" : "(pronto)"}
            </button>
          )}
          <button className="btn-secondary" onClick={onDismiss}>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
