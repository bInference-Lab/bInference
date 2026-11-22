import type { AgentMode } from "./agent-motion";

/** An order a section gives the agent for a while, over what its slot says. */
export interface AgentOrder {
  readonly mode: AgentMode;
  /** The words of the status pill while the order holds. */
  readonly label?: string;
  /** What to look at. */
  readonly target?: Element;
  /** When the order ends, in `performance.now()` milliseconds; without one it holds until replaced. */
  readonly until?: number;
}

/** How the page talks to its agent, and counts the reader's taps. */
export interface AgentBus {
  readonly isAwake: () => boolean;
  readonly wake: () => void;
  readonly order: (order: AgentOrder | undefined) => void;
  /** The order in force at `now`, if one is. */
  readonly orderAt: (now: number) => AgentOrder | undefined;
  readonly pulse: () => void;
  /** Whether a pulse was asked since the last call; it reads each pulse once. */
  readonly takePulse: () => boolean;
  readonly tap: () => void;
  readonly taps: () => number;
  readonly subscribe: (listener: () => void) => () => void;
}

/** A bus for one page: the agent starts asleep, with no order and no taps. */
export function createAgentBus(): AgentBus {
  let awake = false;
  let current: AgentOrder | undefined;
  let pulses = 0;
  let count = 0;
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    isAwake: () => awake,
    wake: () => {
      awake = true;
      tell();
    },
    order: (order) => {
      current = order;
    },
    orderAt: (now) => (current?.until !== undefined && now > current.until ? undefined : current),
    pulse: () => {
      pulses += 1;
    },
    takePulse: () => {
      const had = pulses > 0;
      pulses = 0;
      return had;
    },
    tap: () => {
      count += 1;
      tell();
    },
    taps: () => count,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
