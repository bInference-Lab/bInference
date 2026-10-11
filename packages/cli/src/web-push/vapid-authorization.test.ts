import { createMemorySecretStore } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { checkVapidAuthorization as check } from "./test-receiver.js";
import { vapidAuthorization } from "./vapid-authorization.js";
import { openWebPushKey } from "./web-push-key.js";

const nowMs = 1_790_000_000_000;

describe("the VAPID authorization", () => {
  it("reads as RFC 8292's own example does", () => {
    const example =
      "vapid t=eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA, k=BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
    expect(check(example)).toMatchObject({
      valid: true,
      claims: { aud: "https://push.example.net", exp: 1_453_523_768 },
    });
  });

  it("signs the endpoint's origin, an expiry 12 hours on and the project's contact", async () => {
    const key = await openWebPushKey(createMemorySecretStore({}), new AbortController().signal);
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/a:b", key, nowMs);
    expect(check(header)).toStrictEqual({
      valid: true,
      header: { typ: "JWT", alg: "ES256" },
      claims: {
        aud: "https://fcm.googleapis.com",
        exp: nowMs / 1000 + 12 * 60 * 60,
        sub: "https://binference.io",
      },
      key: key.publicKey,
    });
  });
});
