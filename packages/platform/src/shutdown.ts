import { BinferenceError, createDeadline, type Clock } from "@binference/core";

/** What started the shutdown: an OS stop signal, or a request such as `engine/stop`. */
export type StopTrigger = NodeJS.Signals | "request";

/** One step of the shutdown sequence. It should finish promptly once `signal` aborts. */
export type ShutdownStep = (signal: AbortSignal) => Promise<void>;

/**
 * How a step ended: `timed_out` when the budget ran out during it, `skipped` when it had run out
 * before the step began.
 */
export type StepOutcome = "done" | "failed" | "timed_out" | "skipped";

/** One step's name and outcome. */
export interface ShutdownStepReport {
  readonly name: string;
  readonly outcome: StepOutcome;
}

/** What the sequence did, step by step, in order. */
export interface ShutdownReport {
  readonly trigger: StopTrigger;
  readonly steps: readonly ShutdownStepReport[];
}

/** Where stop signals arrive: `process` in the engine, an emitter in tests. */
export interface SignalEvents {
  on(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): void;
  off(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): void;
}

/** What one shutdown sequence needs. */
export interface ShutdownOptions {
  readonly clock: Clock;
  /** The time limit of the whole sequence, such as `engine.shutdownBudgetMs`. */
  readonly budgetMs: number;
  readonly events: SignalEvents;
  /** The signals that stop the process on this OS: `Platform.stopSignals`. */
  readonly signals: readonly NodeJS.Signals[];
}

/** The one shutdown sequence, started by a stop signal or by a request. */
export interface Shutdown {
  /** Adds a step; steps run one at a time in the order they were added. At most 64. */
  add(name: string, step: ShutdownStep): void;
  /** Starts the sequence. Every later stop, by signal or request, returns the same run. */
  stop(trigger: StopTrigger): Promise<ShutdownReport>;
  /** Resolves when a started sequence has ended. */
  readonly finished: Promise<ShutdownReport>;
  /** Stops listening for stop signals; call it once the sequence has ended. */
  dispose(): void;
}

interface NamedStep {
  readonly name: string;
  readonly step: ShutdownStep;
}

const maxSteps = 64;

async function runStep(step: ShutdownStep, signal: AbortSignal): Promise<StepOutcome> {
  const stepEnded = new AbortController();
  const budgetSpent = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
      signal: stepEnded.signal,
    });
  });
  try {
    await Promise.race([step(signal), budgetSpent]);
    return "done";
  } catch {
    return signal.aborted ? "timed_out" : "failed";
  } finally {
    stepEnded.abort();
  }
}

async function runSteps(
  steps: readonly NamedStep[],
  options: ShutdownOptions,
): Promise<ShutdownStepReport[]> {
  const deadline = createDeadline({
    clock: options.clock,
    signal: new AbortController().signal,
    timeoutMs: options.budgetMs,
  });
  // Steps run strictly one after another: a later step may close what an earlier one uses.
  const reports = await steps.reduce<Promise<ShutdownStepReport[]>>(
    async (earlier, { name, step }) => {
      const done = await earlier;
      const outcome = deadline.signal.aborted ? "skipped" : await runStep(step, deadline.signal);
      return [...done, { name, outcome }];
    },
    Promise.resolve([]),
  );
  deadline.clear();
  return reports;
}

/**
 * Creates the shutdown sequence and listens for this OS's stop signals at once. Each step gets the
 * signal of one shared budget; when the budget runs out, the step running is left behind and the
 * rest are skipped, so the process can exit. A failing step does not stop the ones after it.
 */
export function createShutdown(options: ShutdownOptions): Shutdown {
  const steps: NamedStep[] = [];
  let isStarted = false;
  let begin: (trigger: StopTrigger) => void;
  const finished = new Promise<StopTrigger>((resolve) => {
    begin = resolve;
  }).then(async (trigger) => ({ trigger, steps: await runSteps(steps, options) }));
  const stop = async (trigger: StopTrigger): Promise<ShutdownReport> => {
    if (!isStarted) {
      isStarted = true;
      begin(trigger);
    }
    return finished;
  };
  const onSignal = (signal: NodeJS.Signals): void => {
    void stop(signal);
  };
  options.signals.forEach((signal) => options.events.on(signal, onSignal));
  return {
    add: (name, step) => {
      if (isStarted) {
        throw new BinferenceError({
          code: "platform.shutdown_started",
          message: `The shutdown step ${name} came after the sequence started; add steps at startup.`,
          details: { name },
        });
      }
      if (steps.length >= maxSteps) {
        throw new BinferenceError({
          code: "platform.too_many_steps",
          message: `The shutdown sequence holds at most ${String(maxSteps)} steps.`,
          details: { name },
        });
      }
      steps.push({ name, step });
    },
    stop,
    finished,
    dispose: () => options.signals.forEach((signal) => options.events.off(signal, onSignal)),
  };
}
