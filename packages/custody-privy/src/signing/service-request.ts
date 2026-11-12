import type { SignRequest } from "@binference/chain";
import type { DecodedEvmTransaction } from "@binference/chain-evm";
import { BinferenceError, type Id } from "@binference/core";
import { z } from "zod";
import {
  type ServiceAuthorization,
  type SignerServiceRequest,
  signerServiceRequestBytes,
  signerServiceRequestSchema,
} from "./signer-service-wire.schema.js";

/** The lease a worker holds for the install whose engine asks for signatures. */
export interface ServiceLease {
  readonly install: Id<"ins">;
  /** The fence of the lease's rows, which the service checks on each request. */
  readonly fence: number;
}

// How long after its authorization ended a cancel of the step still signs (decision 0116).
const cancelGraceMs = 60_000;

/**
 * The last instant the request's authorization lets the service sign (spec 5, section 8.7): a
 * confirmation's or a grant's end, and a minute past it for a cancel of a confirmed intent or of a
 * fill. A repeat of the request never starts after it.
 */
export function signsUntilMs(request: SignRequest): number {
  const { authorization } = request;
  const endMs =
    authorization.kind === "confirmation"
      ? authorization.expiresAtMs
      : authorization.grant.expiresAtMs;
  const isGraced =
    request.step.replaces?.kind === "cancel" && authorization.kind !== "approvalMode";
  return isGraced ? endMs + cancelGraceMs : endMs;
}

function authorizationOf(request: SignRequest): ServiceAuthorization {
  const { authorization } = request;
  if (authorization.kind === "confirmation") {
    return { kind: "confirmation", id: authorization.id };
  }
  return authorization.kind === "fill"
    ? { kind: "fill", source: authorization.grant.source }
    : { kind: "approvalMode" };
}

/**
 * The request's body for the signer service (spec 5, section 8.3): the step and what the worker
 * chose for its transaction, read from the unsigned payload, under the worker's lease and a fresh
 * request id. It names the intent, the step and the authorization, and never sends the
 * transaction's bytes, its terms hash or its grant: the service reads those from the install's
 * rows. A body past 4 KiB throws `custody.service_request_too_large`.
 */
export function serviceBodyOf(
  request: SignRequest,
  made: {
    readonly lease: ServiceLease;
    readonly requestId: string;
    readonly decoded: DecodedEvmTransaction;
  },
): string {
  const { decoded } = made;
  const replaces = request.step.replaces?.kind;
  const body: SignerServiceRequest = {
    version: 1,
    requestId: made.requestId,
    install: made.lease.install,
    fence: made.lease.fence,
    intent: request.intent,
    step: request.step.index,
    authorization: authorizationOf(request),
    nonce: decoded.nonce,
    gasLimit: decoded.gas,
    fees: {
      maxFeePerGas: decoded.fees.maxFeePerGas,
      maxPriorityFeePerGas: decoded.fees.maxPriorityFeePerGas,
    },
    ...(replaces === undefined ? {} : { replaces }),
  };
  const text = JSON.stringify(z.encode(signerServiceRequestSchema, body));
  if (new TextEncoder().encode(text).byteLength > signerServiceRequestBytes) {
    throw new BinferenceError({
      code: "custody.service_request_too_large",
      message: `A signing request holds at most ${String(signerServiceRequestBytes)} bytes.`,
      details: { intent: request.intent },
    });
  }
  return text;
}
