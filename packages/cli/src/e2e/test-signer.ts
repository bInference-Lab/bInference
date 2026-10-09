import { BinferenceError, ok } from "@binference/core";
import { parseAgentKey, type SignerRefusalNotice, signAuthorization } from "@binference/signer";
import type { StartSigner } from "../compose/start-signer.js";

/** A signer a test starts in its own process, and the hooks a test drives it with. */
export interface TestSigner {
  /** Starts it: it signs with the agent key it is given and checks no hard rule. */
  readonly start: StartSigner;
  /** Resolves once the engine first starts it: the server listens by then. */
  readonly reached: Promise<void>;
  /** How many times the engine started it. */
  readonly starts: () => number;
  /** Ends the signer that runs, as a crash would. */
  readonly crash: () => void;
  /** Refuses as the signer does when a step breaks a rule: the engine hears the refusal. */
  readonly refuse: (refusal: SignerRefusalNotice) => void;
}

/**
 * A {@link TestSigner} that holds the agent key the engine hands it, answers its public half and
 * signs every request with it, as the built signer does once its hard rules pass. `hold`, when
 * given, keeps each start waiting until it resolves, so a test sees the engine mid-start.
 */
export function createTestSigner(hold?: Promise<void>): TestSigner {
  const state = {
    starts: 0,
    crash: (): void => undefined,
    arrive: (): void => undefined,
    refuse: (_refusal: SignerRefusalNotice): void => undefined,
  };
  const reached = new Promise<void>((resolve) => {
    state.arrive = resolve;
  });
  const start: StartSigner = async ({ agentKey, onRefusal }) => {
    state.starts += 1;
    state.refuse = onRefusal;
    state.arrive();
    await hold;
    const pair = parseAgentKey(agentKey);
    if (!pair.ok) {
      throw new BinferenceError({ code: "signer.agent_key_invalid", message: "Not an agent key." });
    }
    const { privateKey, publicKey } = pair.value;
    const stopped = new Promise<void>((resolve) => {
      state.crash = resolve;
    });
    return {
      client: {
        publicKey: async () => Promise.resolve(publicKey),
        authorize: async (input) =>
          Promise.resolve(ok(signAuthorization(privateKey, input.request))),
      },
      stopped,
      stop: async () => {
        state.crash();
        await stopped;
      },
    };
  };
  return {
    start,
    reached,
    starts: () => state.starts,
    crash: () => state.crash(),
    refuse: (refusal) => state.refuse(refusal),
  };
}

/** A signer that never starts, as one whose program is missing or refuses its settings. */
export const brokenSigner: StartSigner = async () =>
  Promise.reject(
    new BinferenceError({ code: "signer.not_sealed", message: "The signer did not start." }),
  );
