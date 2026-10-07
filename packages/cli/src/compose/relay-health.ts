import type { ChainRef, RelayAnswer, RelaySender } from "@binference/chain";
import type { HealthSignal } from "./health-signals.js";

/** The executor's health signal, read from the private relays' answers to its sends. */
export interface RelayHealth {
  /** A sender that sends as `sender` does and notes each send's answers. */
  watch(chain: ChainRef, sender: RelaySender): RelaySender;
  /**
   * `ok` before any send and while every relay accepted its chain's last send, `warn` while some
   * relay did not, `fail` while a chain's last send reached no relay at all.
   */
  state(): HealthSignal["state"];
}

function stateOf(answers: readonly RelayAnswer[]): HealthSignal["state"] {
  const accepted = answers.filter((answer) => answer.outcome === "accepted").length;
  if (accepted === answers.length) {
    return "ok";
  }
  return accepted > 0 ? "warn" : "fail";
}

const order: readonly HealthSignal["state"][] = ["ok", "warn", "fail"];

/** Creates a {@link RelayHealth} that has seen no send. */
export function createRelayHealth(): RelayHealth {
  const last = new Map<ChainRef, readonly RelayAnswer[]>();
  return {
    watch(chain, sender) {
      const watched: Pick<RelaySender, "send"> = {
        async send(signed, options) {
          const answers = await sender.send(signed, options);
          last.set(chain, answers);
          return answers;
        },
      };
      return { relays: sender.relays, send: watched.send };
    },
    state() {
      const states = new Set([...last.values()].map(stateOf));
      return order.findLast((state) => states.has(state)) ?? "ok";
    },
  };
}
