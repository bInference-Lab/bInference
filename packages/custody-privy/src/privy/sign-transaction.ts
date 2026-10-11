import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { PrivyClient } from "@privy-io/node";
import type { SignTransactionRequest } from "./privy-api.js";
import { callPrivy, privyFault, statusFault } from "./privy-call.js";
import type { PrivySettings } from "./privy-client.js";
import { readPayload } from "./privy-payload.schema.js";
import { readSignedTransaction, refusalOf } from "./privy-wire.schema.js";

// A signing request expires five minutes after it is made, so a captured signature stops working.
const expiryMs = 5 * 60_000;

// Never leaves this file: a refusal of the signer stops the SDK before it sends anything.
const signerRefused = "custody.signer_refused";

async function authorized(
  payload: Uint8Array,
  request: SignTransactionRequest,
  signal: AbortSignal,
): Promise<string> {
  const privyRequest = readPayload(payload);
  if (privyRequest === undefined) {
    throw new BinferenceError({
      code: "custody.payload_unreadable",
      message: "The SDK asked to sign a payload that is no canonical Privy request.",
    });
  }
  const answer = await request.authorize(privyRequest, signal);
  if (!answer.ok) {
    throw new BinferenceError({ code: signerRefused, message: "The signer refused." });
  }
  return answer.value;
}

function signCall(settings: PrivySettings, request: SignTransactionRequest) {
  return {
    kind: "sign" as const,
    path: `/v1/wallets/${request.wallet}/rpc`,
    run: async (client: PrivyClient, signal: AbortSignal) =>
      client
        .wallets()
        .ethereum()
        .signTransaction(request.wallet, {
          params: { transaction: request.transaction },
          authorization_context: {
            sign_fns: [async (payload) => authorized(payload, request, signal)],
          },
          request_expiry: settings.clock.now() + expiryMs,
        }),
  };
}

async function signedOutcome(
  settings: PrivySettings,
  request: SignTransactionRequest,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof callPrivy>> | "refused"> {
  try {
    return await callPrivy(settings, signCall(settings, request), signal);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === signerRefused) {
      return "refused";
    }
    throw error;
  }
}

/**
 * Asks Privy to sign one transaction, once, as `PrivyApi.signTransaction` describes: the signer
 * authorizes the exact request the SDK built, and Privy's refusals become outcomes.
 */
export async function signWith(
  settings: PrivySettings,
  request: SignTransactionRequest,
  signal: AbortSignal,
): Promise<Result<string, "refused" | "unknown_wallet">> {
  const call = signCall(settings, request);
  const outcome = await signedOutcome(settings, request, signal);
  if (outcome === "refused") {
    return err("refused");
  }
  if (outcome.ok) {
    const raw = readSignedTransaction(outcome.value);
    if (raw === undefined) {
      throw privyFault("custody.privy_malformed", call);
    }
    return ok(raw);
  }
  const refusal = refusalOf(outcome.code);
  if (refusal === "policy" || refusal === "authorization") {
    return err("refused");
  }
  if (refusal === "expired") {
    throw privyFault("custody.request_expired", call, outcome);
  }
  return outcome.status === 404
    ? err("unknown_wallet")
    : Promise.reject(statusFault(call, outcome));
}
