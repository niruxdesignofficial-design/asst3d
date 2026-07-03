import { beforeEach, describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  createSession,
  issueNonce,
  loginMessage,
  verifySession,
  verifyWalletSignature,
} from "../src/auth.js";
import { openDb } from "../src/db/index.js";
import { Repo } from "../src/db/repo.js";

function keypair() {
  const kp = nacl.sign.keyPair();
  return {
    address: bs58.encode(kp.publicKey),
    sign(message: string): string {
      const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
      return Buffer.from(sig).toString("base64");
    },
  };
}

describe("auth con wallet (ed25519 + sesiones HMAC)", () => {
  it("firma válida sobre el nonce emitido: acepta", () => {
    const wallet = keypair();
    const { message } = issueNonce("device-1");
    expect(verifyWalletSignature("device-1", wallet.address, wallet.sign(message))).toBe(true);
  });

  it("el nonce es de un solo uso (anti-replay)", () => {
    const wallet = keypair();
    const { message } = issueNonce("device-1");
    const sig = wallet.sign(message);
    expect(verifyWalletSignature("device-1", wallet.address, sig)).toBe(true);
    expect(verifyWalletSignature("device-1", wallet.address, sig)).toBe(false);
  });

  it("firma de otra wallet o mensaje alterado: rechaza", () => {
    const wallet = keypair();
    const impostor = keypair();
    const { message } = issueNonce("device-1");
    expect(verifyWalletSignature("device-1", wallet.address, impostor.sign(message))).toBe(false);
    issueNonce("device-1");
    expect(
      verifyWalletSignature("device-1", wallet.address, wallet.sign(loginMessage("otro-nonce")))
    ).toBe(false);
  });

  it("sesión HMAC: válida hasta expirar, inválida si se manipula", () => {
    const { token } = createSession("wallet-user-1");
    expect(verifySession(token)).toBe("wallet-user-1");
    expect(verifySession(token.slice(0, -2) + "zz")).toBeNull();
    expect(verifySession("basura")).toBeNull();
  });
});

describe("migración device -> wallet", () => {
  let repo: Repo;

  beforeEach(async () => {
    repo = new Repo(await openDb(":memory:"));
  });

  it("mueve historial y suma contadores; el device queda en cero", async () => {
    await repo.upsertUser("device-1", null);
    await repo.incrementUsage("device-1", null, "g1");
    await repo.redeemCode("device-1", "FREE3", 3);
    const gen = await repo.createGeneration({
      userId: "device-1",
      kind: "text",
      prompt: "mi robot",
      styleId: "lowpoly",
      modelType: "lowpoly",
      isPublic: true,
    });

    const address = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    await repo.upsertUser(address, null);
    await repo.mergeDeviceIntoWallet("device-1", address);

    const wallet = (await repo.getUser(address))!;
    expect(wallet.generations_used).toBe(1);
    expect(wallet.bonus_generations).toBe(3);
    expect((await repo.getGeneration(gen.id))!.user_id).toBe(address);
    // el device quedó vacío: re-mergear no duplica
    await repo.mergeDeviceIntoWallet("device-1", address);
    expect((await repo.getUser(address))!.generations_used).toBe(1);
  });

  it("username único: el segundo que lo pide recibe false", async () => {
    await repo.upsertUser("u1", null);
    await repo.upsertUser("u2", null);
    expect(await repo.claimUsername("u1", "polymaster")).toBe(true);
    expect(await repo.claimUsername("u2", "polymaster")).toBe(false);
    expect(await repo.claimUsername("u1", "polymaster")).toBe(true); // re-claim propio ok
  });
});
