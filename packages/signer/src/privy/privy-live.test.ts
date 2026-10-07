import type { KeyObject } from "node:crypto";
// oxlint-disable-next-line eslint/no-restricted-imports -- the opt-in live test calls Privy's API itself; nothing in the signer reaches the network
import { request as sendRequest } from "node:https";
import type { PrivyRequest } from "@binference/chain";
import { createSecret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { parseAgentKey } from "../agent-key/agent-key-text.js";
import { signAuthorization } from "./authorization-signature.js";

// The owner's Privy test app, set up by hand: a server wallet on chain 56 whose signer (or owner)
// is the key in BINFERENCE_PRIVY_AGENT_KEY, as base64 PKCS #8. The test asks Privy to sign a
// 0-value transfer to the wallet itself, which every ceiling allows, and sends nothing on chain.
// oxlint-disable-next-line node/no-process-env -- the switch and the test app's details, read only here
const live = process.env;
const liveTests = live["BINFERENCE_PRIVY_TESTS"] === "1";
const setting = (name: string): string => live[`BINFERENCE_PRIVY_${name}`] ?? "";

function agentKeyOf(text: string): KeyObject {
  const pair = parseAgentKey(createSecret(text));
  if (!pair.ok) {
    throw new Error("BINFERENCE_PRIVY_AGENT_KEY holds no P-256 private key.");
  }
  return pair.value.privateKey;
}

interface PrivyAnswer {
  readonly status: number;
  readonly body: string;
}

async function post(
  request: PrivyRequest,
  headers: Readonly<Record<string, string>>,
): Promise<PrivyAnswer> {
  const body = JSON.stringify(request.body);
  return new Promise((resolve, reject) => {
    const outgoing = sendRequest(
      request.url,
      {
        method: request.method,
        headers: { ...headers, "content-type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

describe.runIf(liveTests)("authorization signatures on the Privy test app", () => {
  it(
    "gets a transaction signed with our signature over the request",
    { timeout: 60_000 },
    async () => {
      const appId = setting("APP_ID");
      const appSecret = setting("APP_SECRET");
      const walletId = setting("WALLET_ID");
      const walletAddress = setting("WALLET_ADDRESS");
      const privateKey = agentKeyOf(setting("AGENT_KEY"));
      const request: PrivyRequest = {
        method: "POST",
        url: `https://api.privy.io/v1/wallets/${walletId}/rpc`,
        headers: { "privy-app-id": appId },
        body: {
          method: "eth_signTransaction",
          params: {
            transaction: {
              to: walletAddress,
              value: "0x0",
              chain_id: 56,
              nonce: 0,
              gas_limit: 21_000,
              max_fee_per_gas: "0x3b9aca00",
              max_priority_fee_per_gas: "0x0",
              type: 2,
            },
          },
        },
      };

      const answer = await post(request, {
        authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
        "privy-app-id": appId,
        "privy-authorization-signature": signAuthorization(privateKey, request),
      });

      const signed = JSON.parse(answer.body) as {
        readonly method: string;
        readonly data: { readonly signed_transaction: string };
      };

      expect(answer.status).toBe(200);
      expect(signed.method).toBe("eth_signTransaction");
      expect(signed.data.signed_transaction).toMatch(/^0x[0-9a-f]+$/);
    },
  );
});
