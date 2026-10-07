import type { P256KeyPair } from "../keys/p256-key-pair.js";
import { signAuthorization } from "../privy/authorization-signature.js";
import {
  readSignerRequest,
  type SignerAnswer,
  type SignerRequest,
} from "../requests/signer-message.schema.js";

/** What the signer service holds. */
export interface SignerServiceOptions {
  /** The agent key, from the first line of the signer's input. */
  readonly agentKey: P256KeyPair;
}

/** Answers the engine's requests with the agent key. */
export interface SignerService {
  /** Answers one request line. It never throws: whatever the line holds gets an answer. */
  answer(line: string): SignerAnswer;
}

function answerRequest(agentKey: P256KeyPair, request: SignerRequest): SignerAnswer {
  if (request.kind === "publicKey") {
    return { id: request.id, ok: true, publicKey: agentKey.publicKey };
  }
  return {
    id: request.id,
    ok: true,
    signature: signAuthorization(agentKey.privateKey, request.request),
  };
}

/**
 * Creates the service behind the signer's channel (keys spec, section 5.1): `publicKey` answers
 * the agent key's public half, `authorize` answers Privy's authorization signature over the
 * request. Every other line is refused.
 */
export function createSignerService(options: SignerServiceOptions): SignerService {
  return {
    answer: (line) => {
      const reading = readSignerRequest(line);
      return reading.ok
        ? answerRequest(options.agentKey, reading.request)
        : { id: reading.id, ok: false, refused: reading.refused };
    },
  };
}
