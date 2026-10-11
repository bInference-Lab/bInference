import { createIdSource, err } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAccessStore } from "../fakes/memory-access-store.js";
import { expectOk, testNowMs } from "../intents/test-intents.js";
import { testCall } from "../operations/test-engine.js";
import { sha256Hex } from "../records/sha256-hex.js";
import { createTokenHandlers } from "./token-handlers.js";

function tokens() {
  const clock = createManualClock(testNowMs);
  const access = createMemoryAccessStore();
  const ids = createIdSource({ clock, random: createSeededRandom(7) });
  return { access, clock, handlers: createTokenHandlers({ access, clock, ids }) };
}

const secret = `bnt_${"a".repeat(43)}`;
const register = {
  label: "mcp-codex",
  kind: "mcp" as const,
  scopes: ["read" as const, "propose" as const],
  secretHash: sha256Hex(secret),
};

describe("the token handlers", () => {
  it("registers a token from its hash alone, which then signs in and lists without it", async () => {
    const { access, handlers } = tokens();
    const view = expectOk(await handlers["token/register"](testCall(register)));
    expect(view).toStrictEqual({
      token: view.token,
      label: "mcp-codex",
      kind: "mcp",
      scopes: ["read", "propose"],
      createdAt: testNowMs,
    });
    const stored = await access.findToken(sha256Hex(secret), testCall({}));
    expect(stored?.id).toBe(view.token);
    expect(expectOk(await handlers["token/list"](testCall({})))).toStrictEqual({ items: [view] });
    expect(JSON.stringify(view)).not.toContain(register.secretHash);
  });

  it("refuses a hash the store holds already", async () => {
    const { handlers } = tokens();
    await handlers["token/register"](testCall(register));
    await expect(handlers["token/register"](testCall(register))).resolves.toStrictEqual(
      err("protocol.bad_args"),
    );
  });

  it("revokes a token, and refuses one it does not know", async () => {
    const { clock, handlers } = tokens();
    const { token } = expectOk(await handlers["token/register"](testCall(register)));
    await clock.advance(5);
    expect(expectOk(await handlers["token/revoke"](testCall({ token })))).toStrictEqual({});
    const { items } = expectOk(await handlers["token/list"](testCall({})));
    expect(items[0]?.revokedAt).toBe(testNowMs + 5);
    await expect(
      handlers["token/revoke"](testCall({ token: fixtureId("tok", 9) })),
    ).resolves.toStrictEqual(err("token.not_found"));
  });
});
