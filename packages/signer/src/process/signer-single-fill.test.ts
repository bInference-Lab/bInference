import type { AuthorizeInput, SignAuthorization } from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { createP256KeyPair } from "../keys/p256-key-pair.js";
import { formatSignerRequest } from "../requests/signer-message.schema.js";
import {
  authorizeFixture,
  fixtureNowMs,
  fixtureSettings,
  fixtureTermsHash,
} from "../testing/sign-fixtures.js";
import { createSignerService } from "./signer-service.js";

const order = idSchema("ord").parse("ord_0192f3a4-5b6c-7d8e-9f00-112233445566");
const agent = idSchema("agt").parse("agt_0192f3a4-5b6c-7d8e-9f00-112233445566");
const other = idSchema("int").parse("int_0192f3a4-5b6c-7d8e-9f00-aabbccddeeff");

// A fill of `intent` under its order's grant at its first fill, as the engine would send it.
function fillOf(input: AuthorizeInput, intent = input.intent): AuthorizeInput {
  const authorization: SignAuthorization = {
    kind: "order",
    grant: {
      order,
      agent,
      intent,
      orderTermsHash: "ef".repeat(32),
      fillsBefore: 0,
      termsHash: fixtureTermsHash,
      grantedAtMs: fixtureNowMs - 1,
      expiresAtMs: fixtureNowMs + 59_000,
      networkFeeCapNativeBase: 10n ** 9n,
      spend: { maxBase: 10n ** 16n },
    },
    current: {
      id: order,
      state: "active",
      termsHash: "ef".repeat(32),
      expiresAtMs: fixtureNowMs + 3_600_000,
      fills: 0,
      maxFills: 1,
    },
  };
  return { ...input, intent, authorization };
}

describe("the signer's single use of a fill grant", () => {
  it("signs one fill per order and count, its later steps too, and no second fill", () => {
    const clock = { nowMs: fixtureNowMs };
    const service = createSignerService({
      agentKey: createP256KeyPair(),
      settings: fixtureSettings,
      now: () => clock.nowMs,
    });
    const ask = (id: string, input: AuthorizeInput) =>
      service.answer(formatSignerRequest({ id, kind: "authorize", ...input })).ok;
    const first = fillOf(authorizeFixture());
    const second = fillOf(authorizeFixture(), other);

    const answers = [ask("a", first), ask("b", first), ask("c", second)];
    clock.nowMs = fixtureNowMs + 59_000 + 60_000;
    const afterGrace = ask("d", { ...second, authorization: renewed(second) });

    expect(answers).toStrictEqual([true, true, false]);
    expect(afterGrace).toBe(true);
  });
});

// The second fill's grant made again later, as a new confirmation would make it.
function renewed(input: AuthorizeInput): SignAuthorization {
  const { authorization } = input;
  return authorization.kind === "order"
    ? {
        ...authorization,
        grant: {
          ...authorization.grant,
          grantedAtMs: fixtureNowMs + 119_000,
          expiresAtMs: fixtureNowMs + 170_000,
        },
      }
    : authorization;
}
