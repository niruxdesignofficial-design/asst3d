import { useState } from "react";
import { ApiError, redeemCode } from "../lib/api";

interface Props {
  /** llamado tras un canje exitoso para refrescar /api/me */
  onRedeemed: () => void;
}

/** Canje de códigos promo (ej. FREE3): la validación real vive en el server. */
export function PromoCode({ onRedeemed }: Props) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await redeemCode(value);
      setMsg({ ok: true, text: `Code applied! +${r.bonus} free generations 🎉` });
      setCode("");
      onRedeemed();
    } catch (err) {
      const e = err instanceof ApiError ? err.code : "unknown";
      setMsg({
        ok: false,
        text:
          e === "already_redeemed"
            ? "You already used this code on this device."
            : e === "invalid_code"
              ? "That code doesn't exist or expired."
              : e === "rate_limited"
                ? "Too many attempts — wait a minute and try again."
                : "Couldn't apply the code. Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!open && !msg?.ok) {
    return (
      <button className="promo-toggle" onClick={() => setOpen(true)}>
        🎟 Have a promo code?
      </button>
    );
  }

  return (
    <div className="promo">
      {!msg?.ok && (
        <div className="promo-row">
          <input
            className="search promo-input"
            placeholder="Enter code… e.g. FREE3"
            value={code}
            maxLength={32}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
          />
          <button className="btn-mini" disabled={busy || !code.trim()} onClick={submit}>
            {busy ? "…" : "Apply"}
          </button>
        </div>
      )}
      {msg && <div className={msg.ok ? "promo-ok" : "form-error"}>{msg.text}</div>}
    </div>
  );
}
