import { Buffer } from "node:buffer";
import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptPushMessage, newPushSenderParts } from "./encrypt-push-message.js";
import { createTestReceiver } from "./test-receiver.js";

// RFC 8291, section 5 and appendix A.
const example = {
  plaintext: "When I grow up, I want to be a watermelon",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  receiverPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  receiverPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const keys = { p256dh: example.receiverPublic, auth: example.auth };
const bytes = (text: string): Buffer => Buffer.from(text, "base64url");

function exampleSender() {
  const sender = createECDH("prime256v1");
  sender.setPrivateKey(bytes(example.senderPrivate));
  return { salt: bytes(example.salt), sender };
}

describe("encrypting a push message", () => {
  it("gives the body of RFC 8291's worked example, byte for byte", () => {
    const plaintext = Buffer.from(example.plaintext, "latin1");
    const body = encryptPushMessage(plaintext, keys, exampleSender());
    expect(Buffer.from(body).toString("base64url")).toBe(example.body);
  });

  it("makes a message the browser opens with its own private key", () => {
    const parts = newPushSenderParts(Buffer.alloc(16, 7));
    const body = encryptPushMessage(Buffer.from('{"v":1}'), keys, parts);
    const browser = createTestReceiver({ privateKey: example.receiverPrivate, auth: example.auth });
    expect(browser.open(body)).toBe('{"v":1}');
  });

  it("refuses keys that are not a P-256 point and a 16-byte secret", () => {
    const short = { ...keys, auth: "AAAA" };
    expect(() => encryptPushMessage(Buffer.from("x"), short, exampleSender())).toThrow(
      expect.objectContaining({ code: "web_push.bad_keys" }),
    );
  });

  it("refuses a message that does not fit one record", () => {
    expect(() => encryptPushMessage(Buffer.alloc(4_080), keys, exampleSender())).toThrow(
      expect.objectContaining({ code: "web_push.too_large" }),
    );
    expect(encryptPushMessage(Buffer.alloc(4_079), keys, exampleSender())).toHaveLength(4_096 + 86);
  });
});
