import { describe, expect, it } from "vitest";
import type { Fetcher } from "../app/console-browser";
import { createDeviceKey } from "./device-key";
import { pairDevice } from "./pair-device";
import { pairCodeIn } from "./pair-link";

const live = new AbortController().signal;

function answering(status: number, body: object | string) {
  const sent: { path: string; init: RequestInit }[] = [];
  const fetcher: Fetcher = async (path, init) => {
    sent.push({ path, init });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status });
  };
  return { fetcher, sent };
}

describe("pairing a device", () => {
  it("sends the code, the public key and the label to the page's own /pair", async () => {
    const key = await createDeviceKey(globalThis.crypto.subtle);
    const { fetcher, sent } = answering(201, { deviceId: "dev_0190" });
    const outcome = await pairDevice(fetcher, { code: "abc", key, label: "Browser", signal: live });
    expect(outcome).toStrictEqual({ ok: true, deviceId: "dev_0190" });
    expect(sent[0]?.path).toBe("/pair");
    expect(JSON.parse(sent[0]?.init.body as string)).toStrictEqual({
      code: "abc",
      publicKey: key.publicKey,
      alg: "ed25519",
      label: "Browser",
    });
  });

  it.each([
    ["used", 401, { error: { code: "auth.invalid", message: "used" } }],
    ["expired", 401, { error: { code: "auth.expired", message: "expired" } }],
    ["refused", 403, { error: { code: "auth.origin", message: "origin" } }],
    ["refused", 500, "not json"],
    ["refused", 201, { device: "no id" }],
  ] as const)("reads a refusal as %s", async (refusal, status, body) => {
    const key = await createDeviceKey(globalThis.crypto.subtle);
    const { fetcher } = answering(status, body);
    const outcome = await pairDevice(fetcher, { code: "abc", key, label: "Browser", signal: live });
    expect(outcome).toStrictEqual({ ok: false, refusal });
  });

  it("reads the code from the link's hash and nothing else", () => {
    expect(pairCodeIn("#pair=q3Zr_x9-AbCdEfGhIjKlMn")).toBe("q3Zr_x9-AbCdEfGhIjKlMn");
    expect(pairCodeIn("#pair=")).toBeUndefined();
    expect(pairCodeIn("#pair=a b")).toBeUndefined();
    expect(pairCodeIn("#other=abc")).toBeUndefined();
  });
});
