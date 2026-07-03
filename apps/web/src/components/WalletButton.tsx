import { useState } from "react";
import type { MeDto } from "@asst3d/shared";
import { ApiError, authNonce, authVerify, claimUsername, setSession } from "../lib/api";

/** API mínima de Phantom (window.solana) — patrón estándar de Solana. */
interface PhantomProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signMessage(msg: Uint8Array, encoding: "utf8"): Promise<{ signature: Uint8Array }>;
}

function phantom(): PhantomProvider | null {
  const p = (window as unknown as { solana?: PhantomProvider }).solana;
  return p?.isPhantom ? p : null;
}

interface Props {
  me: MeDto | null;
  refreshMe: () => void;
}

/** Conectar wallet (login) + reserva de username la primera vez. */
export function WalletButton({ me, refreshMe }: Props) {
  const [busy, setBusy] = useState(false);
  const [askName, setAskName] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connected = !!me?.walletAddress;

  const connect = async () => {
    setError(null);
    const provider = phantom();
    if (!provider) {
      window.open("https://phantom.com", "_blank", "noopener");
      return;
    }
    setBusy(true);
    try {
      const { publicKey } = await provider.connect();
      const address = publicKey.toBase58();
      const { message } = await authNonce();
      const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");
      const res = await authVerify(address, btoa(String.fromCharCode(...signature)));
      setSession(res.token);
      refreshMe();
      if (!res.username) setAskName(true);
    } catch (err) {
      setError(err instanceof ApiError ? "Signature rejected — try again" : "Wallet connection failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    setSession(null);
    refreshMe();
  };

  const submitName = async () => {
    const value = name.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await claimUsername(value);
      setAskName(false);
      refreshMe();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "name_taken"
          ? "That name is taken — try another"
          : "3-20 chars: letters, numbers, underscore"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {connected ? (
        <button
          className="btn-mini wallet-chip"
          onClick={disconnect}
          title={`${me?.walletAddress} — click to disconnect`}
        >
          ◉ {me?.username ?? `${me?.walletAddress?.slice(0, 4)}…${me?.walletAddress?.slice(-4)}`}
        </button>
      ) : (
        <button className="btn-mini" onClick={connect} disabled={busy} title="Sign in with your Solana wallet">
          {busy ? "…" : "Connect wallet"}
        </button>
      )}

      {askName && (
        <div className="gate" onClick={() => setAskName(false)}>
          <div className="gate-box" onClick={(e) => e.stopPropagation()}>
            <h3>Pick your creator name</h3>
            <p className="muted">Shown on your models and your public profile.</p>
            <div className="promo-row" style={{ marginTop: 14 }}>
              <input
                className="search promo-input"
                style={{ textTransform: "none" }}
                placeholder="e.g. polymaster_3d"
                value={name}
                maxLength={20}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitName()}
              />
              <button className="btn-mini" disabled={busy || !name.trim()} onClick={submitName}>
                Claim
              </button>
            </div>
            {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}
            <div className="gate-actions">
              <button className="btn-secondary" onClick={() => setAskName(false)}>
                Later
              </button>
            </div>
          </div>
        </div>
      )}
      {error && !askName && <span className="form-error small">{error}</span>}
    </>
  );
}
