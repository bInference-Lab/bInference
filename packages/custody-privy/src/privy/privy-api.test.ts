import type { PrivyRequest } from "@binference/chain";
import {
  BinferenceError,
  createSecret,
  err,
  ok,
  type Result,
  type Http,
  type HttpRequest,
  type HttpResponse,
} from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import type { PrivyTransaction } from "../signing/privy-transaction.js";
import { createPrivyApi, type PrivyApi } from "./privy-api.js";
import type { PrivyId } from "./privy-records.js";

const secretText = "privy-secret-value-1234";
const wallet = "wallet0000000000000000001" as PrivyId;

interface Recorded extends Http {
  readonly sent: HttpRequest[];
}

// Answers every request with the next answer; `hang` never answers until the request aborts.
function scripted(answers: readonly (HttpResponse | "hang")[]): Recorded {
  const sent: HttpRequest[] = [];
  const queue = [...answers];
  return {
    sent,
    async request(request) {
      request.signal.throwIfAborted();
      sent.push(request);
      const next = queue.shift() ?? "hang";
      if (next !== "hang") {
        return next;
      }
      return new Promise((_, reject) => {
        request.signal.addEventListener("abort", () => {
          reject(
            new BinferenceError({ code: "http.unreachable", message: "aborted", retryable: true }),
          );
        });
      });
    },
  };
}

function json(status: number, body: object): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const walletAnswer = {
  id: wallet,
  address: "0xF1DBff66C993EE895C8cb176c30b07A559d76496",
  chain_type: "ethereum",
  policy_ids: [],
  additional_signers: [],
  owner_id: "rkiz0ivz254drv1xw982v3jq",
  created_at: 1741834854578,
  exported_at: null,
  imported_at: null,
};

function apiOver(http: Http, clock = createManualClock(1_790_000_000_000)): PrivyApi {
  return createPrivyApi({
    http,
    clock,
    appId: "app-id",
    appSecret: createSecret(secretText),
    timeoutMs: 1_000,
  });
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

function make(origin: string): PrivyApi {
  return createPrivyApi({
    http: scripted([]),
    clock: createManualClock(0),
    appId: "a",
    appSecret: createSecret("s"),
    origin,
  });
}

const transaction: PrivyTransaction = {
  type: 2,
  chain_id: 56,
  nonce: 0,
  to: "0xF1DBff66C993EE895C8cb176c30b07A559d76496",
  value: "0x0",
  data: "0x",
  gas_limit: "0x5208",
  max_fee_per_gas: "0x1",
  max_priority_fee_per_gas: "0x1",
};
const signature = "c2lnbmF0dXJlLWJ5dGVzLW9mLWEtc2lnbmVy";

interface Signed {
  readonly result: Result<string, "refused" | "unknown_wallet">;
  /** The requests the signer was asked to authorize. */
  readonly asked: readonly PrivyRequest[];
}

async function sign(
  api: PrivyApi,
  answer: Result<string, "refused"> = ok(signature),
): Promise<Signed> {
  const asked: PrivyRequest[] = [];
  const result = await api.signTransaction(
    {
      wallet,
      transaction,
      authorize: async (request) => {
        asked.push(request);
        return Promise.resolve(answer);
      },
    },
    live(),
  );
  return { result, asked };
}

describe("the Privy API client", () => {
  it("sends Basic auth with the app id and secret and the privy-app-id header", async () => {
    const http = scripted([json(200, walletAnswer)]);
    await apiOver(http).wallet(wallet, live());
    const [request] = http.sent;
    expect(request?.url).toBe(`https://api.privy.io/v1/wallets/${wallet}`);
    expect(request?.headers?.["authorization"]).toBe(
      `Basic ${Buffer.from(`app-id:${secretText}`).toString("base64")}`,
    );
    expect(request?.headers?.["privy-app-id"]).toBe("app-id");
  });

  it("reads a wallet as Privy's own example answers it, and a missing one as not_found", async () => {
    const api = apiOver(
      scripted([
        json(200, { ...walletAnswer, entity: null, display_name: "Treasury" }),
        json(404, {}),
      ]),
    );
    await expect(api.wallet(wallet, live())).resolves.toStrictEqual({
      ok: true,
      value: {
        id: wallet,
        address: walletAnswer.address,
        chainType: "ethereum",
        ownerId: walletAnswer.owner_id,
        policyIds: [],
        signers: [],
      },
    });
    await expect(api.wallet(wallet, live())).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("reads Privy's example key quorum with its keys' line breaks taken out", async () => {
    const key =
      "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEx4aoeD72yykviK+f/ckqE2CItVIG\n1rCnvC3/XZ1HgpOcMEMialRmTrqIK4oZlYd1RfxU3za/C9yjhboIuoPD3g==";
    const answer = {
      id: "tb54eps4z44ed0jepousxi4n",
      display_name: "Prod",
      authorization_threshold: 1,
      authorization_keys: [{ public_key: key, display_name: null }],
      user_ids: null,
    };
    const found = await apiOver(scripted([json(200, answer)])).keyQuorum(
      "tb54eps4z44ed0jepousxi4n" as PrivyId,
      live(),
    );
    expect(found).toMatchObject({
      ok: true,
      value: { publicKeys: [key.replace("\n", "")], threshold: 1, userIds: [], memberQuorums: [] },
    });
  });

  it("refuses an answer of another shape, and never shows the secret in a fault", async () => {
    const api = apiOver(scripted([json(200, { id: "x" }), json(500, { error: secretText })]));
    const malformed = await api.wallet(wallet, live()).catch((error: unknown) => error);
    const failed = await api.wallet(wallet, live()).catch((error: unknown) => error);
    expect(malformed).toMatchObject({ code: "custody.privy_malformed", retryable: false });
    expect(failed).toMatchObject({
      code: "custody.privy_failed",
      retryable: true,
      details: { status: 500 },
    });
    expect(JSON.stringify([malformed, failed, String(malformed), String(failed)])).not.toContain(
      secretText,
    );
  });

  it.each([
    [429, "custody.privy_busy", true],
    [401, "custody.privy_credentials", false],
    [400, "custody.privy_refused", false],
    [503, "custody.privy_failed", false],
  ] as const)("turns a %i answer to a write into %s", async (status, code, retryable) => {
    const create = apiOver(scripted([json(status, {})])).createKeyQuorum(
      { publicKey: "k", displayName: "d" },
      live(),
    );
    await expect(create).rejects.toMatchObject({ code, retryable });
  });

  it("stops a call at its timeout, and a read may be asked again while a write may not", async () => {
    const clock = createManualClock(0);
    const api = apiOver(scripted(["hang", "hang"]), clock);
    const read = api.wallet(wallet, live()).catch((error: unknown) => error);
    const write = api
      .createKeyQuorum({ publicKey: "k", displayName: "d" }, live())
      .catch((error: unknown) => error);
    await clock.advance(1_000);
    await expect(read).resolves.toMatchObject({
      code: "custody.privy_unreachable",
      retryable: true,
    });
    await expect(write).resolves.toMatchObject({
      code: "custody.privy_unreachable",
      retryable: false,
    });
  });

  it("sends nothing on an aborted signal", async () => {
    const http = scripted([]);
    const reason = new Error("stopped");
    await expect(apiOver(http).wallet(wallet, { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
    expect(http.sent).toHaveLength(0);
  });

  it("refuses an origin that is not https or has a path", () => {
    expect(() => make("http://api.privy.io")).toThrow(
      expect.objectContaining({ code: "custody.origin_invalid" }),
    );
    expect(() => make("https://api.privy.io/v1")).toThrow(
      expect.objectContaining({ code: "custody.origin_invalid" }),
    );
  });
});

describe("signing requests to Privy", () => {
  it("has the signer authorize the exact request it sends, expiring five minutes from now", async () => {
    const http = scripted([
      json(200, {
        method: "eth_signTransaction",
        data: { signed_transaction: "0x02ab", encoding: "rlp" },
      }),
    ]);
    const { result, asked } = await sign(apiOver(http, createManualClock(1_790_000_000_000)));
    expect(result).toStrictEqual({ ok: true, value: "0x02ab" });
    const [request] = asked;
    const [sent] = http.sent;
    expect(request?.url).toBe(`https://api.privy.io/v1/wallets/${wallet}/rpc`);
    expect(sent?.url).toBe(request?.url);
    expect(JSON.parse(String(sent?.body))).toStrictEqual(request?.body);
    expect(request?.body).toStrictEqual({
      method: "eth_signTransaction",
      chain_type: "ethereum",
      params: { transaction },
    });
    expect(request?.headers).toStrictEqual({
      "privy-app-id": "app-id",
      "privy-request-expiry": "1790000300000",
    });
    expect(sent?.headers).toMatchObject({
      ...request?.headers,
      "privy-authorization-signature": signature,
    });
  });

  it("stops before Privy hears of a request the signer refuses", async () => {
    const http = scripted([]);
    await expect(sign(apiOver(http), err("refused"))).resolves.toMatchObject({
      result: err("refused"),
    });
    expect(http.sent).toHaveLength(0);
  });

  it.each([
    [{ error: "Policy violation", code: "policy_violation" }, 400],
    [{ error: "POLICY_VIOLATION" }, 403],
    [
      { error: "No valid authorization signature", code: "zero_correct_authorization_signatures" },
      401,
    ],
    [{ code: "insufficient_correct_authorization_signatures" }, 401],
  ])("answers refused when Privy names %j", async (body, status) => {
    await expect(sign(apiOver(scripted([json(status, body)])))).resolves.toMatchObject({
      result: err("refused"),
    });
  });

  it("answers unknown_wallet for a wallet Privy does not hold, and faults otherwise", async () => {
    const api = apiOver(
      scripted([
        json(404, {}),
        json(400, { code: "request_expired" }),
        json(500, {}),
        json(200, { data: {} }),
      ]),
    );
    await expect(sign(api)).resolves.toMatchObject({ result: err("unknown_wallet") });
    await expect(sign(api)).rejects.toMatchObject({ code: "custody.request_expired" });
    await expect(sign(api)).rejects.toMatchObject({
      code: "custody.privy_failed",
      retryable: false,
    });
    await expect(sign(api)).rejects.toMatchObject({ code: "custody.privy_malformed" });
  });

  it("calls a lost answer sign_unknown, which this client never asks again", async () => {
    const clock = createManualClock(0);
    const http = scripted(["hang", json(200, {})]);
    const signing = sign(apiOver(http, clock)).catch((error: unknown) => error);
    await clock.advance(1_000);
    await expect(signing).resolves.toMatchObject({
      code: "custody.sign_unknown",
      retryable: false,
    });
    expect(http.sent).toHaveLength(1);
  });
});
