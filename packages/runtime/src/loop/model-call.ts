import { type AttemptStep, stepAfter } from "./attempt-policy.js";
import type { ModelEvent } from "./model-event.js";
import type { ModelChain } from "./ports.js";
import { type ModelFault, type ModelResponse, readModelResponse } from "./read-model-response.js";
import type { ModelRequest } from "./turn-records.js";
import type { TurnRun } from "./turn-run.js";

/** Where a call stands among its attempts. */
interface CallState {
  /** The chain's index of the model the next attempt calls. */
  readonly at: number;
  readonly attempts: number;
  /** The times the model at `at` was tried again. */
  readonly retries: number;
}

const stopped = (fault: ModelFault): ModelFault => ({
  ...fault,
  failure: "aborted",
  message: "The model call was stopped.",
});

// The first model from `from` on whose provider does not rest. When every one rests, the turn's
// current model is tried anyway: a rest skips a provider, it never leaves a turn with none.
function firstAwake(chain: ModelChain, from: number): number | undefined {
  const index = chain.models.findIndex((model, at) => at >= from && !chain.resting(model.name));
  return index === -1 ? undefined : index;
}

/** A timer that runs out after a quiet spell, started again by each event. */
interface IdleTimer {
  readonly restart: () => void;
  readonly stop: () => void;
}

function idleTimer(run: TurnRun, onIdle: () => void): IdleTimer {
  const holder = { armed: new AbortController() };
  const restart = (): void => {
    holder.armed.abort();
    holder.armed = new AbortController();
    run.parts.clock
      .sleep(run.limits.modelIdleMs, holder.armed.signal)
      .then(onIdle, () => undefined);
  };
  restart();
  return { restart, stop: () => holder.armed.abort() };
}

async function* restartingOn(
  events: AsyncIterable<ModelEvent>,
  timer: IdleTimer,
): AsyncGenerator<ModelEvent, void, undefined> {
  for await (const event of events) {
    timer.restart();
    yield event;
  }
}

// A call cut for its silence failed for a passing cause, whatever the transport said of the cut.
function silent(run: TurnRun, fault: ModelFault): ModelFault {
  const seconds = String(Math.round(run.limits.modelIdleMs / 1_000));
  const { retryAfterMs: _asked, ...said } = fault;
  return { ...said, failure: "transient", message: `The model sent nothing for ${seconds} s.` };
}

// One attempt, cut when no event comes for the idle time: from the call's start, and from each
// event to the next, so a stream that stalls halfway is cut like one that never starts.
async function attempt(run: TurnRun, at: number, request: ModelRequest): Promise<ModelResponse> {
  const model = run.parts.models.models[at];
  if (model === undefined) {
    return {
      ok: false,
      failure: "request",
      message: "The chain has no such model.",
      text: "",
      reasoning: "",
    };
  }
  const idle = new AbortController();
  const signal = AbortSignal.any([run.halted, idle.signal]);
  const timer = idleTimer(run, () => idle.abort());
  try {
    const events = restartingOn(model.transport.stream(request, signal), timer);
    const response = await readModelResponse(events, { signal, clock: run.parts.clock });
    const wasSilent = !response.ok && idle.signal.aborted && !run.halted.aborted;
    return wasSilent ? silent(run, response) : response;
  } finally {
    timer.stop();
  }
}

// Waits before the same model is tried again; a halt ends the wait, and the call with it.
async function waited(run: TurnRun, waitMs: number): Promise<boolean> {
  try {
    await run.parts.clock.sleep(waitMs, run.halted);
    return true;
  } catch {
    return false;
  }
}

function restAfter(run: TurnRun, at: number, step: AttemptStep): void {
  const model = run.parts.models.models[at];
  if (step.kind !== "retry" && step.restMs !== undefined && model !== undefined) {
    run.parts.models.rest(model.name, step.restMs);
  }
}

async function attemptFrom(
  run: TurnRun,
  request: ModelRequest,
  state: CallState,
): Promise<ModelResponse> {
  const response = await attempt(run, state.at, request);
  if (response.ok) {
    return response;
  }
  const committed = run.tally.now().committed;
  const step = stepAfter({ ...response, ...state, attempts: state.attempts + 1, committed });
  restAfter(run, state.at, step);
  const attempts = state.attempts + 1;
  if (step.kind === "retry") {
    const ready = await waited(run, step.waitMs);
    return ready
      ? attemptFrom(run, request, { ...state, attempts, retries: state.retries + 1 })
      : stopped(response);
  }
  const next = step.kind === "next" ? firstAwake(run.parts.models, state.at + 1) : undefined;
  if (next === undefined) {
    return response;
  }
  run.route.moveTo(next);
  return attemptFrom(run, request, { at: next, attempts, retries: 0 });
}

/**
 * One model call of the turn (runtime spec, section 8.2): the turn's current model of its chain,
 * or the first after it whose provider does not rest, tried again on a passing fault, then swapped
 * for the next model of the chain, until it answers or no step is left. A fallback lasts for the
 * turn. Only the attempt that answers, or the last one, is the call's response: what a failed
 * attempt wrote before it failed goes nowhere.
 */
export async function callModel(run: TurnRun, request: ModelRequest): Promise<ModelResponse> {
  const at = firstAwake(run.parts.models, run.route.at()) ?? run.route.at();
  run.route.moveTo(at);
  return attemptFrom(run, request, { at, attempts: 0, retries: 0 });
}
