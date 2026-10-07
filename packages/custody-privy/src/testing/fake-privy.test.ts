import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import type { HttpResponse, JsonValue } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { buildCeiling } from "../ceiling/build-ceiling.js";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import { signaturePayload } from "../signer-process/privy-request.js";
import { testCeilingRequest } from "./custody-fixtures.js";
import { createFakePrivy, type FakePrivy } from "./fake-privy.js";

const origin = "https://api.privy.io";

function auth(privy: FakePrivy, secret = privy.appSecret.reveal()): Record<string, string> {
  const basic = Buffer.from(`${privy.appId}:${secret}`).toString("base64");
  return { authorization: `Basic ${basic}`, "privy-app-id": privy.appId };
}

async function send(
  privy: FakePrivy,
  path: string,
  options: { readonly body?: JsonValue; readonly headers?: Record<string, string> } = {},
): Promise<HttpResponse> {
  return privy.http.request({
    method: options.body === undefined ? "GET" : "POST",
    url: `${origin}${path}`,
    headers: { ...auth(privy), ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: new AbortController().signal,
  });
}

function newPrivy(): FakePrivy {
  return createFakePrivy({
    clock: createManualClock(1_790_000_000_000),
    random: createSeededRandom(7),
  });
}

function newKey(): string {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

async function idOf(response: Promise<HttpResponse>): Promise<string> {
  const { body } = await response;
  return (JSON.parse(body) as { id: string }).id;
}

const policyBody = (
  rules: readonly JsonValue[],
  extra: Record<string, JsonValue> = {},
): JsonValue => ({
  version: "1.0",
  name: "binference ceiling",
  chain_type: "ethereum",
  rules: [...rules],
  ...extra,
});

const rescueAddress = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
const unsavedAddress = "0x4C7f6780Ec91C6AC1D99dA89A90db7895a17dAcE";

function sendTo(to: string): Record<string, JsonValue> {
  return {
    to,
    chain_id: 56,
    nonce: 0,
    gas_limit: 21000,
    max_fee_per_gas: 1,
    max_priority_fee_per_gas: 1,
    value: "0x1",
  };
}

function ceilingRules(): readonly JsonValue[] {
  const ceiling = buildCeiling(testCeilingRequest());
  if (!ceiling.ok) {
    throw new Error(ceiling.error);
  }
  return ceiling.value.rules.map(policyRuleJson);
}

interface SignerWallet {
  readonly privy: FakePrivy;
  readonly wallet: string;
  /** The private half of the wallet's signer key. */
  readonly signer: KeyObject;
}

// A wallet owned by another key, the ceiling as its policy, and one signer with an override or not.
async function walletWithSigner(options: { readonly override: boolean }): Promise<SignerWallet> {
  const privy = newPrivy();
  const signer = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = signer.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const quorum = await idOf(send(privy, "/v1/key_quorums", { body: { public_keys: [publicKey] } }));
  const policy = await idOf(send(privy, "/v1/policies", { body: policyBody(ceilingRules()) }));
  const added = options.override
    ? { signer_id: quorum, override_policy_ids: [policy] }
    : { signer_id: quorum };
  const owner = await idOf(send(privy, "/v1/key_quorums", { body: { public_keys: [newKey()] } }));
  const body = {
    chain_type: "ethereum",
    owner_id: owner,
    policy_ids: [policy],
    additional_signers: [added],
  };
  const wallet = await idOf(send(privy, "/v1/wallets", { body }));
  return { privy, wallet, signer: signer.privateKey };
}

interface SignedRpc extends SignerWallet {
  readonly transaction: Record<string, JsonValue>;
  /** The signature header to send instead of the signer's. */
  readonly signature?: string;
  readonly expiry?: string;
}

async function signedRpc(rpc: SignedRpc): Promise<HttpResponse> {
  const url = `${origin}/v1/wallets/${rpc.wallet}/rpc`;
  const body = { method: "eth_signTransaction", params: { transaction: rpc.transaction } };
  const headers = {
    "privy-app-id": rpc.privy.appId,
    ...(rpc.expiry === undefined ? {} : { "privy-request-expiry": rpc.expiry }),
  };
  const payload = Buffer.from(signaturePayload({ method: "POST", url, body, headers }));
  const signature = rpc.signature ?? sign("sha256", payload, rpc.signer).toString("base64");
  return send(rpc.privy, `/v1/wallets/${rpc.wallet}/rpc`, {
    body,
    headers: {
      ...headers,
      ...(signature === "" ? {} : { "privy-authorization-signature": signature }),
    },
  });
}

const toRule = (value: JsonValue, operator = "in"): JsonValue => ({
  name: "rule",
  method: "eth_signTransaction",
  action: "ALLOW",
  conditions: [{ field_source: "ethereum_transaction", field: "to", operator, value }],
});

describe("the Privy fake", () => {
  it("refuses wrong credentials and serves no other origin", async () => {
    const privy = newPrivy();
    const wrong = await privy.http.request({
      method: "GET",
      url: `${origin}/v1/wallets/x`,
      headers: auth(privy, "other-secret"),
      signal: new AbortController().signal,
    });
    expect(wrong.status).toBe(401);
    await expect(
      privy.http.request({
        method: "GET",
        url: "https://example.org/v1",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "http.unreachable", retryable: true });
  });

  it("answers a key quorum's key broken into lines, as Privy's examples do", async () => {
    const privy = newPrivy();
    const key = newKey();
    const answer = await send(privy, "/v1/key_quorums", {
      body: { public_keys: [key], authorization_threshold: 1 },
    });
    const [stored] = (JSON.parse(answer.body) as { authorization_keys: { public_key: string }[] })
      .authorization_keys;
    expect(stored?.public_key).toContain("\n");
    expect(stored?.public_key.replaceAll("\n", "")).toBe(key);
  });

  it.each([
    ["a key that is no P-256 key", { public_keys: ["bm90IGEga2V5"] }],
    ["a threshold above its keys", { public_keys: ["KEY"], authorization_threshold: 2 }],
    ["an unknown field", { public_keys: ["KEY"], user_ids: ["user"] }],
  ])("refuses a key quorum with %s", async (_, body) => {
    const privy = newPrivy();
    const json = JSON.parse(JSON.stringify(body).replace("KEY", newKey())) as JsonValue;
    await expect(send(privy, "/v1/key_quorums", { body: json })).resolves.toMatchObject({
      status: 400,
    });
  });

  it.each([
    ["an unknown field", policyBody([], { owner: null })],
    [
      "a rule name over 50 characters",
      policyBody([{ ...(toRule(["0x1"]) as object), name: "n".repeat(51) }]),
    ],
    [
      "an `in` over 100 values",
      policyBody([toRule(Array.from({ length: 101 }, (_, n) => String(n)))]),
    ],
    ["`eq` with a list", policyBody([toRule(["a"], "eq")])],
    [
      "a calldata condition with no ABI",
      policyBody([
        {
          name: "r",
          method: "eth_signTransaction",
          action: "ALLOW",
          conditions: [
            {
              field_source: "ethereum_calldata",
              field: "function_name",
              operator: "eq",
              value: "x",
            },
          ],
        },
      ]),
    ],
    [
      "a condition on typed data",
      policyBody([
        {
          name: "r",
          method: "eth_signTypedData_v4",
          action: "ALLOW",
          conditions: [
            {
              field_source: "ethereum_typed_data_domain",
              field: "chainId",
              operator: "eq",
              value: "56",
            },
          ],
        },
      ]),
    ],
    ["an owner that is no key quorum", policyBody([], { owner_id: "nosuchquorum" })],
  ])("refuses a policy with %s", async (_, body) => {
    await expect(send(newPrivy(), "/v1/policies", { body })).resolves.toMatchObject({
      status: 400,
    });
  });

  it("holds at most 1,000 key quorums and refuses one more", async () => {
    const privy = newPrivy();
    const body = { public_keys: [newKey()] };
    const made = await Promise.all(
      Array.from({ length: 1_000 }, async () => send(privy, "/v1/key_quorums", { body })),
    );
    expect(made.every((answer) => answer.status === 200)).toBe(true);
    const more = await send(privy, "/v1/key_quorums", { body });
    expect([more.status, more.body.includes("limit_reached")]).toStrictEqual([400, true]);
  });

  it("refuses a wallet that names a policy or a quorum the app does not hold", async () => {
    const privy = newPrivy();
    const policy = await idOf(send(privy, "/v1/policies", { body: policyBody([]) }));
    const bodies: readonly JsonValue[] = [
      { chain_type: "ethereum", policy_ids: ["nosuchpolicy"] },
      { chain_type: "ethereum", owner_id: "nosuchquorum" },
      {
        chain_type: "ethereum",
        additional_signers: [{ signer_id: "nosuchquorum", override_policy_ids: [policy] }],
      },
      { chain_type: "solana" },
    ];
    const answers = await Promise.all(
      bodies.map(async (body) => send(privy, "/v1/wallets", { body })),
    );
    expect(answers.map((answer) => answer.status)).toStrictEqual([400, 400, 400, 400]);
    await expect(send(privy, "/v1/wallets/nosuchwallet")).resolves.toMatchObject({ status: 404 });
  });

  it("binds a signer with no override policy by the wallet's own policy", async () => {
    const { privy, wallet, signer } = await walletWithSigner({ override: false });
    const answer = await signedRpc({ privy, wallet, signer, transaction: sendTo(unsavedAddress) });
    expect(answer.status).toBe(400);
    expect(answer.body).toContain("policy_violation");
    await expect(
      signedRpc({ privy, wallet, signer, transaction: sendTo(rescueAddress) }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("refuses a request with no signature, a signature over another request, or a passed expiry", async () => {
    const { privy, wallet, signer } = await walletWithSigner({ override: true });
    const transaction = sendTo(rescueAddress);
    const unsigned = await signedRpc({ privy, wallet, signer, transaction, signature: "" });
    const forged = await signedRpc({ privy, wallet, signer, transaction, signature: "other" });
    const late = await signedRpc({ privy, wallet, signer, transaction, expiry: "1789999999999" });
    expect([unsigned.status, forged.status, late.status]).toStrictEqual([401, 401, 400]);
    expect(unsigned.body).toContain("missing_or_empty_authorization_header");
    expect(forged.body).toContain("zero_correct_authorization_signatures");
    expect(late.body).toContain("request_expired");
  });

  it("refuses a body Privy's schema refuses and a wallet it does not hold", async () => {
    const { privy, wallet, signer } = await walletWithSigner({ override: true });
    const odd = { ...sendTo(rescueAddress), gas: 1 };
    await expect(signedRpc({ privy, wallet, signer, transaction: odd })).resolves.toMatchObject({
      status: 400,
    });
    await expect(
      signedRpc({ privy, wallet: "nosuchwallet", signer, transaction: sendTo(rescueAddress) }),
    ).resolves.toMatchObject({ status: 404 });
  });
});
