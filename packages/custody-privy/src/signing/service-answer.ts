import { BinferenceError, type HttpResponse, nestsDeeperThan } from "@binference/core";
import { decodeServiceAnswer, type SignerServiceAnswer } from "./signer-service-wire.schema.js";

/**
 * The most bytes an answer of the signer service may hold: a signed transaction of the largest
 * size a node relays (128 KiB) as hex, with room for the rest. The `Http` that reaches the service
 * reads no more than this.
 */
export const signerServiceAnswerBytes: number = 320 * 1_024;

// The status each outcome comes with (spec 5, section 8.3): `down` with 503, the rest with 200.
function statusOf(answer: SignerServiceAnswer): number {
  return answer.outcome === "down" ? 503 : 200;
}

function unread(status: number, why: string): BinferenceError {
  return new BinferenceError({
    code: "custody.service_answer_unread",
    message: `The signer service answered something that is no answer to this request: ${why}. Nothing is read as signed.`,
    details: { status },
  });
}

// The answer by its schema, from JSON text no larger or deeper than an answer can be.
function decoded(response: HttpResponse): SignerServiceAnswer {
  const { body, status } = response;
  if (body.length > signerServiceAnswerBytes || nestsDeeperThan(body)) {
    throw unread(status, "too large");
  }
  const answer = decodeServiceAnswer(body);
  if (answer === undefined) {
    throw unread(status, "a shape no version names");
  }
  return answer;
}

/**
 * Reads one answer of the signer service to the request with this id, by its schema: the version,
 * the request id and the outcome, with the status that outcome comes with. Any other answer, an
 * unlisted status among them, throws `custody.service_answer_unread`, which is never retried and
 * never read as signed.
 */
export function readServiceAnswer(response: HttpResponse, requestId: string): SignerServiceAnswer {
  const { status } = response;
  const answer = decoded(response);
  if (answer.requestId !== requestId) {
    throw unread(status, "another request's id");
  }
  if (statusOf(answer) !== status) {
    throw unread(status, `${answer.outcome} with a status it never comes with`);
  }
  return answer;
}
