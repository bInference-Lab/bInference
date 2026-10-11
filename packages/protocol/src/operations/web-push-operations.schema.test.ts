import { describe, expect, it } from "vitest";
import { webPushSubscriptionSchema } from "./web-push-operations.schema.js";

// The browser's key and secret of RFC 8291, appendix A.
const keys = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

const parses = (endpoint: string): boolean =>
  webPushSubscriptionSchema.safeParse({ endpoint, keys }).success;

describe("a browser push subscription", () => {
  it("takes an HTTPS endpoint on a named host", () => {
    expect(parses("https://fcm.googleapis.com/fcm/send/abc:def")).toBe(true);
    expect(parses("https://web.push.apple.com/QGuQyavXutnMH")).toBe(true);
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://127.0.0.1/push",
    "https://[::1]/push",
    "https://localhost/push",
    "https://engine.localhost/push",
    "https://10.0.0.8/push",
  ])("refuses %s", (endpoint) => {
    expect(parses(endpoint)).toBe(false);
  });

  it("refuses keys of the wrong length", () => {
    const short = { endpoint: "https://push.example.invalid/a", keys: { ...keys, auth: "AAAA" } };
    expect(webPushSubscriptionSchema.safeParse(short).success).toBe(false);
  });
});
