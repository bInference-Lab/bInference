import type { P256KeyPair } from "../keys/p256-key-pair.js";
import { signAuthorization } from "../privy/authorization-signature.js";
import {
  readSignerRequest,
  type SignerAnswer,
  type SignerRequest,
} from "../requests/signer-message.schema.js";
import { checkHardRules } from "../rules/check-hard-rules.js";
import type { SignerSettings } from "./signer-settings.schema.js";

/** What the signer service holds. */
export interface SignerServiceOptions {
  /** The agent key, from the signer's input. */
  readonly agentKey: P256KeyPair;
  /** The settings the signer started with. */
  readonly settings: SignerSettings;
  /** Now, in epoch milliseconds: the clock confirmations and orders expire by. */
  readonly now: () => number;
}

/** Answers the engine's requests with the agent key. */
export interface SignerService {
  /** Answers one request line. It never throws: whatever the line holds gets an answer. */
  answer(line: string): SignerAnswer;
}

function answerRequest(options: SignerServiceOptions, request: SignerRequest): SignerAnswer {
  const { agentKey } = options;
  if (request.kind === "publicKey") {
    return { id: request.id, ok: true, publicKey: agentKey.publicKey };
  }
  const refused = checkHardRules(request, { settings: options.settings, nowMs: options.now() });
  if (refused !== undefined) {
    return { id: request.id, ok: false, refused };
  }
  return {
    id: request.id,
    ok: true,
    signature: signAuthorization(agentKey.privateKey, request.request),
  };
}

/**
 * Creates the service behind the signer's channel (keys spec, section 5.1): `publicKey` answers
 * the agent key's public half; `authorize` answers Privy's authorization signature over the
 * request once every hard rule holds (section 5.2), and otherwise the first rule it breaks. Every
 * other line is refused.
 */
export function createSignerService(options: SignerServiceOptions): SignerService {
  return {
    answer: (line) => {
      const reading = readSignerRequest(line);
      return reading.ok
        ? answerRequest(options, reading.request)
        : { id: reading.id, ok: false, refused: reading.refused };
    },
  };
}
