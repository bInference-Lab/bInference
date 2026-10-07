import { createPublicKey, verify } from "node:crypto";
import { authorizationPayload } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { createP256KeyPair } from "../keys/p256-key-pair.js";
import { formatSignerRequest } from "../requests/signer-message.schema.js";
import {
  authorizeFixture,
  fixtureNowMs,
  fixtureSettings,
  withTransaction,
} from "../testing/sign-fixtures.js";
import { createSignerService } from "./signer-service.js";

const agentKey = createP256KeyPair();
const service = createSignerService({
  agentKey,
  settings: fixtureSettings,
  now: () => fixtureNowMs,
});

describe("signer service", () => {
  it("answers publicKey with the agent key's public half", () => {
    expect(service.answer(JSON.stringify({ id: "r1", kind: "publicKey" }))).toStrictEqual({
      id: "r1",
      ok: true,
      publicKey: agentKey.publicKey,
    });
  });

  it("answers authorize with Privy's signature over the exact request", () => {
    const input = authorizeFixture();
    const answer = service.answer(formatSignerRequest({ id: "r2", kind: "authorize", ...input }));
    const { signature } = answer as { readonly signature: string };

    expect(answer).toMatchObject({ id: "r2", ok: true });
    expect(
      verify(
        "sha256",
        authorizationPayload(input.request),
        createPublicKey(agentKey.privateKey),
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);
  });

  it.each([
    [
      "rule 2",
      withTransaction(authorizeFixture(), { to: "0x3333333333333333333333333333333333333333" }),
      "rule_2",
    ],
    ["rule 5", { ...authorizeFixture(), termsHash: "cd".repeat(32) }, "rule_5"],
    [
      "a body it cannot read",
      {
        ...authorizeFixture(),
        request: {
          ...authorizeFixture().request,
          body: { method: "eth_signTransaction", params: {} },
        },
      },
      "malformed",
    ],
  ])("refuses an authorize that breaks %s, and signs nothing", (_case, input, refused) => {
    expect(
      service.answer(formatSignerRequest({ id: "r9", kind: "authorize", ...input })),
    ).toStrictEqual({
      id: "r9",
      ok: false,
      refused,
    });
  });

  it.each([
    ["an unknown kind", JSON.stringify({ id: "r3", kind: "exportKey" }), "r3"],
    ["a sign request of another name", JSON.stringify({ id: "r4", kind: "sign", tx: "0x" }), "r4"],
    ["a line that is not JSON", "publicKey", null],
    ["JSON that is not an object", "[1,2]", null],
    ["a message with no id", JSON.stringify({ kind: "publicKey" }), null],
    [
      "a message whose id breaks the grammar",
      JSON.stringify({ id: "a b", kind: "publicKey" }),
      null,
    ],
  ])("refuses %s as an unknown request", (_case, line, id) => {
    expect(service.answer(line)).toStrictEqual({ id, ok: false, refused: "unknown_request" });
  });

  it.each([
    ["publicKey with a field", { id: "r5", kind: "publicKey", wallet: "x" }],
    ["authorize with no fields", { id: "r6", kind: "authorize" }],
    ["authorize with an extra field", { id: "r7", kind: "authorize", extra: 1 }],
  ])("refuses %s as malformed", (_case, message) => {
    expect(service.answer(JSON.stringify(message))).toStrictEqual({
      id: message.id,
      ok: false,
      refused: "malformed",
    });
  });

  it("keeps answering after a refusal", () => {
    service.answer("not json");

    expect(service.answer(JSON.stringify({ id: "r8", kind: "publicKey" }))).toMatchObject({
      id: "r8",
      ok: true,
    });
  });
});
