import {
  accountRefSchema,
  chainRefSchema,
  type SignedTx,
  type SignerProcess,
  type SignRequest,
} from "@binference/chain";
import { createEvmSigningScheme } from "@binference/chain-evm";
import { signerContract } from "@binference/chain/testing";
import {
  err,
  type Http,
  type HttpRequest,
  type HttpResponse,
  type Id,
  type Result,
} from "@binference/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type CustodySetup,
  setUp,
  signRequest,
  type TestCall,
  unsignedCall,
} from "../contracts/privy-custody-setup.js";
import { createPrivyApi } from "../privy/privy-api.js";
import { testAddresses, testChain } from "../testing/custody-fixtures.js";
import {
  createFakeCustodySubject,
  type FakeCustodySubject,
} from "../testing/fake-custody-subject.js";
import { createPrivyOwnerSigner } from "./privy-owner-signer.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const otherChain = { ...testChain, ref: chainRefSchema.parse("eip155:97"), chainId: 97 };
const unknownWallet = "wal_0190f1c2-3b4c-7d5e-8f60-718293a4b5c7" as Id<"wal">;
const call: TestCall = { to: testAddresses.router, valueWei: 1n, data: "0x12345678" };

interface World {
  readonly subject: FakeCustodySubject;
  readonly setup: CustodySetup;
  /** The requests that reached Privy after the wallet was made. */
  readonly sent: () => readonly HttpRequest[];
  /** Replaces Privy's next answer to a signing request. */
  readonly answerNext: (response: HttpResponse) => void;
}

async function world(): Promise<World> {
  const fake = createFakeCustodySubject();
  const sent: HttpRequest[] = [];
  const replies: HttpResponse[] = [];
  const http: Http = {
    async request(request) {
      sent.push(request);
      const reply = request.url.endsWith("/rpc") ? replies.shift() : undefined;
      return reply ?? fake.privy.http.request(request);
    },
  };
  const subject = {
    ...fake,
    api: createPrivyApi({
      http,
      clock: fake.clock,
      appId: fake.privy.appId,
      appSecret: fake.privy.appSecret,
    }),
  };
  const setup = await setUp(subject);
  const made = sent.length;
  return {
    subject,
    setup,
    sent: () => sent.slice(made),
    answerNext: (reply) => replies.push(reply),
  };
}

function adapterWith(
  setup: CustodySetup,
  signerProcess: SignerProcess,
): ReturnType<typeof createPrivyOwnerSigner> {
  return createPrivyOwnerSigner({
    api: setup.subject.api,
    signerProcess,
    walletOf: (id) => (id === setup.agentWallet ? setup.wallet : undefined),
  });
}

function only<T>(items: readonly T[]): T {
  const [item, ...more] = items;
  if (item === undefined || more.length > 0) {
    throw new Error(`Expected one item, got ${String(items.length)}.`);
  }
  return item;
}

function rawOf(signed: Result<SignedTx, string>): string {
  if (!signed.ok) {
    throw new Error(`Not signed: ${signed.error}`);
  }
  return signed.value.raw;
}

function requestFor(setup: CustodySetup, payloadCall: TestCall = call): SignRequest {
  return signRequest(setup, unsignedCall(setup, payloadCall), payloadCall);
}

describe("privy-owner signer", () => {
  let shared: World;
  beforeAll(async () => {
    shared = await world();
  });

  it.each(
    signerContract({
      create: () => {
        const { setup } = shared;
        const tx = unsignedCall(setup, call);
        const stranger = accountRefSchema.parse(`${testChain.ref}:${testAddresses.unsaved}`);
        return {
          signer: setup.signer,
          scheme: createEvmSigningScheme(),
          wallet: setup.agentWallet,
          account: accountRefSchema.parse(`${testChain.ref}:${setup.wallet.address}`),
          otherChain: otherChain.ref,
          unknownWallet,
          tx,
          foreignTx: { ...tx, from: stranger },
        };
      },
    }),
  )("follows the Signer contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("passes the signer the exact request it sends, with the wallet and the engine's request", async () => {
    const { setup, subject, sent } = await world();
    const base = requestFor(setup);
    const request = { ...base, step: { ...base.step, index: 1 }, termsHash: "a".repeat(64) };
    await expect(setup.signer.signTransaction(request, live())).resolves.toMatchObject({
      ok: true,
    });
    const asked = only(subject.signerProcess.requests());
    const reached = only(sent());
    expect(asked).toStrictEqual({
      wallet: {
        id: setup.agentWallet,
        custodyId: setup.wallet.id,
        account: accountRefSchema.parse(`${testChain.ref}:${setup.wallet.address}`),
      },
      request: asked.request,
      intent: request.intent,
      step: request.step,
      authorization: request.authorization,
      termsHash: "a".repeat(64),
      allowed: request.allowed,
    });
    expect(asked.request.url).toBe(`https://api.privy.io/v1/wallets/${setup.wallet.id}/rpc`);
    expect(reached.url).toBe(asked.request.url);
    expect(JSON.parse(String(reached.body))).toStrictEqual(asked.request.body);
    expect(reached.headers).toMatchObject(asked.request.headers);
    expect(asked.request.body).toMatchObject({
      method: "eth_signTransaction",
      chain_type: "ethereum",
      params: { transaction: { type: 2, chain_id: 56, nonce: 0, value: "0x1", data: call.data } },
    });
  });

  it("answers refused when the signer's hard rules refuse, and Privy hears nothing", async () => {
    const { setup, subject, sent } = await world();
    subject.signerProcess.refuseFromNow("rule_2");
    await expect(setup.signer.signTransaction(requestFor(setup), live())).resolves.toStrictEqual(
      err("refused"),
    );
    expect(sent()).toHaveLength(0);
  });

  it("refuses a transaction whose payload commits to another chain than its own, before anything is asked", async () => {
    const { setup, subject, sent } = await world();
    const request = requestFor(setup);
    const elsewhere = unsignedCall(setup, call, otherChain);
    const mixed = { ...request, tx: { ...request.tx, payload: elsewhere.payload } };
    await expect(setup.signer.signTransaction(mixed, live())).resolves.toStrictEqual(
      err("refused"),
    );
    expect(subject.signerProcess.requests()).toHaveLength(0);
    expect(sent()).toHaveLength(0);
  });

  it("reads the sender's address in any case, and refuses a sender on another chain", async () => {
    const { setup } = await world();
    const request = requestFor(setup);
    const lower = accountRefSchema.parse(`${testChain.ref}:${setup.wallet.address.toLowerCase()}`);
    await expect(
      setup.signer.signTransaction({ ...request, tx: { ...request.tx, from: lower } }, live()),
    ).resolves.toMatchObject({ ok: true });
    const onOther = accountRefSchema.parse(`${otherChain.ref}:${setup.wallet.address}`);
    await expect(
      setup.signer.signTransaction({ ...request, tx: { ...request.tx, from: onOther } }, live()),
    ).resolves.toStrictEqual(err("refused"));
  });

  it("throws for a payload that is no unsigned type 2 call", async () => {
    const { setup } = await world();
    const request = requestFor(setup);
    const broken = { ...request, tx: { ...request.tx, payload: "0x1234" } };
    await expect(setup.signer.signTransaction(broken, live())).rejects.toMatchObject({
      code: "custody.transaction_unreadable",
    });
  });

  it("throws when Privy answers bytes of another transaction than the one asked", async () => {
    const { setup, answerNext } = await world();
    const raw = rawOf(await setup.signer.signTransaction(requestFor(setup), live()));
    answerNext({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "eth_signTransaction",
        data: { signed_transaction: raw, encoding: "rlp" },
      }),
    });
    const other = requestFor(setup, { ...call, valueWei: 2n });
    await expect(setup.signer.signTransaction(other, live())).rejects.toMatchObject({
      code: "custody.signed_other_transaction",
    });
  });

  it("throws for a signer answer that is no signature, and sends it nowhere", async () => {
    const { setup, subject, sent } = await world();
    const odd: SignerProcess = {
      publicKey: async (options) => subject.signerProcess.publicKey(options),
      authorize: async () => Promise.resolve({ ok: true, value: "a,b\r\nx" }),
    };
    await expect(
      adapterWith(setup, odd).signTransaction(requestFor(setup), live()),
    ).rejects.toMatchObject({ code: "custody.signature_malformed" });
    expect(sent()).toHaveLength(0);
  });

  it("stops waiting for a signer that does not answer, before Privy hears anything", async () => {
    const { setup, subject, sent } = await world();
    const silent: SignerProcess = {
      publicKey: async (options) => subject.signerProcess.publicKey(options),
      authorize: async (_request, { signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(signal.reason);
          });
        }),
    };
    const signing = adapterWith(setup, silent)
      .signTransaction(requestFor(setup), live())
      .catch((error: unknown) => error);
    await subject.clock.advance(15_000);
    await expect(signing).resolves.toMatchObject({ code: "core.timeout" });
    expect(sent()).toHaveLength(0);
  });

  it("answers unknown_wallet when Privy no longer holds the wallet", async () => {
    const { setup, answerNext } = await world();
    answerNext({ status: 404, headers: { "content-type": "application/json" }, body: "{}" });
    await expect(setup.signer.signTransaction(requestFor(setup), live())).resolves.toStrictEqual(
      err("unknown_wallet"),
    );
  });
});
