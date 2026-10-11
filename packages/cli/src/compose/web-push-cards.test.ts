import { type Id, idSchema } from "@binference/core";
import { createMemorySecretStore, createScriptedHttp } from "@binference/core/testing";
import {
  testAgent as agent,
  testCoin as coin,
  testToken as token,
  testWallet as wallet,
} from "@binference/engine/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createTestReceiver } from "../web-push/test-receiver.js";
import { openWebPushKey } from "../web-push/web-push-key.js";
import { type Skeleton, skeletonCompositions, startSkeleton } from "./test-skeleton.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const device = idSchema("dev").parse("dev_0190f1c2-3a4b-7c5d-8e6f-0000000000a1");
const endpoint = "https://push.example.invalid/send/laptop";
const browser = createTestReceiver();
describe.each(skeletonCompositions)(
  "a card on the owner's browsers on the $name composition",
  ({ parts: partsOf }) => {
    let skeleton: Skeleton | undefined;

    afterEach(async () => {
      await skeleton?.close();
      skeleton = undefined;
    });

    it("reaches a registered browser when it opens and again when it is answered", async () => {
      const key = await openWebPushKey(createMemorySecretStore({}), live().signal);
      const http = createScriptedHttp([
        { method: "POST", url: endpoint, response: { status: 201, headers: {}, body: "" } },
      ]);
      skeleton = await startSkeleton(partsOf(), {
        webPush: { key, http, isPublicEndpoint: async () => Promise.resolve(true) },
      });
      const { client, composed, parts } = skeleton;
      const { access } = parts.stores;
      await access.addDevice(
        { id: device, label: "Laptop", alg: "ed25519", publicKey: "MCow", createdAtMs: 1 },
        live(),
      );
      const subscription = { endpoint, deviceId: device, ...browser.keys };
      await access.saveWebPushSubscription(
        { ...subscription, serverKey: key.publicKey, createdAtMs: 1 },
        live(),
      );
      await client.call("portfolio/resetPaper", { agent }, live());
      const proposed = await client.call(
        "intent/propose",
        {
          kind: "swap",
          agent,
          wallet,
          reason: "Rotate",
          from: coin,
          to: token,
          amount: { base: 1_000_000n },
        },
        live(),
      );
      const card = proposed.card?.card as Id<"crd">;
      await client.call(
        "intent/confirm",
        { intent: proposed.intent, card, cardVersion: 1 },
        live(),
      );
      await composed.webPush?.idle();
      const messages = http.requests().map((request) => browser.openJson(request.bodyBytes));
      expect(messages).toMatchObject([
        { v: 1, kind: "opened", intent: proposed.intent, card },
        { v: 1, kind: "closed", intent: proposed.intent, card },
      ]);
    });
  },
);
