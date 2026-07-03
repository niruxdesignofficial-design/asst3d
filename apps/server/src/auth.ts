import { createHmac, randomBytes } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { config } from "./config.js";

/**
 * Login con wallet Solana, server-authoritative:
 *  1. el cliente pide un nonce (ligado a su device, un solo uso, TTL 10 min)
 *  2. firma el mensaje "Formora login" + nonce con la wallet (ed25519)
 *  3. el server verifica la firma contra la pubkey (address base58) y emite
 *     un token de sesión HMAC — sin tabla de sesiones, sin estado.
 */

const NONCE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 días

const nonces = new Map<string, { nonce: string; at: number }>();

export function issueNonce(deviceId: string): { nonce: string; message: string } {
  const nonce = randomBytes(16).toString("hex");
  nonces.set(deviceId, { nonce, at: Date.now() });
  return { nonce, message: loginMessage(nonce) };
}

export function loginMessage(nonce: string): string {
  return `Formora login\nnonce: ${nonce}`;
}

/** Verifica la firma del mensaje del nonce. Consume el nonce (un solo uso). */
export function verifyWalletSignature(
  deviceId: string,
  address: string,
  signatureBase64: string
): boolean {
  const entry = nonces.get(deviceId);
  if (!entry || Date.now() - entry.at > NONCE_TTL_MS) return false;
  nonces.delete(deviceId); // un solo intento por nonce
  try {
    const pubkey = bs58.decode(address);
    if (pubkey.length !== 32) return false;
    const sig = Buffer.from(signatureBase64, "base64");
    if (sig.length !== 64) return false;
    const msg = new TextEncoder().encode(loginMessage(entry.nonce));
    return nacl.sign.detached.verify(msg, new Uint8Array(sig), pubkey);
  } catch {
    return false;
  }
}

// ---- sesiones HMAC (sin estado en DB) ----

function hmac(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("hex");
}

export function createSession(userId: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return { token: `${Buffer.from(payload).toString("base64url")}.${hmac(payload)}`, expiresAt };
}

export function verifySession(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = Buffer.from(token.slice(0, dot), "base64url").toString();
  const mac = token.slice(dot + 1);
  if (hmac(payload) !== mac) return null;
  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return null;
  const userId = payload.slice(0, sep);
  const expiresAt = Number(payload.slice(sep + 1));
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return userId;
}
