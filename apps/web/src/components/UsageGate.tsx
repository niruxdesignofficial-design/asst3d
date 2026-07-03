interface Props {
  code: string;
  paymentsEnabled: boolean;
  onDismiss: () => void;
}

/** Blocking banner when the server denies a generation. */
export function UsageGate({ code, paymentsEnabled, onDismiss }: Props) {
  let title = "";
  let body = "";
  if (code === "free_limit_reached") {
    title = "You're out of free generations";
    body = paymentsEnabled
      ? "Connect your wallet and unlock unlimited generations with the token."
      : "Token access is coming soon. Check back later to keep generating.";
  } else if (code === "capacity_reached") {
    title = "Capacity reached";
    body = "The app hit its monthly generation cap. Please try again later.";
  } else if (code === "rate_limited") {
    title = "Slow down";
    body = "You're generating too fast. Wait a moment and try again.";
  } else {
    title = "Generation failed";
    body = "Something went wrong. Please try again in a few minutes.";
  }

  return (
    <div className="gate">
      <div className="gate-box">
        <h3>{title}</h3>
        <p className="muted">{body}</p>
        <div className="gate-actions">
          {code === "free_limit_reached" && (
            <button
              className="btn-primary"
              disabled={!paymentsEnabled}
              title={paymentsEnabled ? "" : "Coming soon"}
            >
              🔑 Token access {paymentsEnabled ? "" : "(soon)"}
            </button>
          )}
          <button className="btn-secondary" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
