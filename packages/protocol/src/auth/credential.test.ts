import { redactSecrets } from "@binference/core";
import { describe, expect, it } from "vitest";
import { credentialSchema } from "./credential.js";
import { deviceProofText } from "./device-proof.js";

const token = `bnt_${"Q9-_z".repeat(8)}abc`;
const device = "dev_0190f1c2-3a4b-7c5d-8e6f-0123456789ab";

describe("credentialSchema", () => {
  it.each([
    ["a client token", { token }],
    ["a console device", { device }],
    ["a Telegram launch", { telegram: { initData: "query_id=1&hash=ab" } }],
  ] as const)("parses %s", (_name, credential) => {
    expect(credentialSchema.parse(credential)).toStrictEqual(credential);
  });

  it.each([
    ["an AI gateway key", { token: `binf_${"Q".repeat(43)}` }],
    ["a token one character short", { token: token.slice(0, -1) }],
    ["a token with base64 padding", { token: `${token}=` }],
    ["a device id of another kind", { device: device.replace("dev_", "con_") }],
    ["empty Telegram data", { telegram: { initData: "" } }],
    ["two credentials", { token, device }],
    ["no credential", {}],
  ] as const)("refuses %s", (_name, credential) => {
    expect(credentialSchema.safeParse(credential).success).toBe(false);
  });

  it("uses a token shape that redaction masks", () => {
    expect(redactSecrets(`open with ${token}`)).toBe("open with [redacted]");
  });
});

describe("deviceProofText", () => {
  it("joins the label, the nonce and the origin, one per line", () => {
    const text = deviceProofText({ nonce: "c2VjcmV0", origin: "http://127.0.0.1:7456" });
    expect(text).toBe("binference-device-v1\nc2VjcmV0\nhttp://127.0.0.1:7456");
  });
});
