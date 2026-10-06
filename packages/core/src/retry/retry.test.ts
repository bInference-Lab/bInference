import { describe, expect, it, vi } from "vitest";
import { BinferenceError } from "../errors/binference-error.js";
import { createManualClock } from "../fakes/manual-clock.js";
import { createSeededRandom } from "../fakes/seeded-random.js";
import { retry, type RetryAttempt } from "./retry.js";

type Operation = (attempt: RetryAttempt) => Promise<string>;

const policy = { attempts: 4, baseDelayMs: 100, maxDelayMs: 1_000, budgetMs: 10_000 };
const transient = new BinferenceError({ code: "rpc.timeout", message: "Slow.", retryable: true });
const permanent = new BinferenceError({ code: "rpc.refused", message: "No." });

function setup() {
  const clock = createManualClock(1_000);
  const controller = new AbortController();
  const options = { ...policy, clock, random: createSeededRandom(7), signal: controller.signal };
  return { clock, controller, options };
}

function failing(times: number, fault: () => Error) {
  return vi.fn<Operation>(async ({ attempt }) => {
    await Promise.resolve();
    if (attempt <= times) {
      throw fault();
    }
    return `done on ${String(attempt)}`;
  });
}

// Settles to the value or the rejection reason, so a test can advance the clock first.
async function outcome(promise: Promise<string>): Promise<unknown> {
  return promise.then(
    (value) => value,
    (error: unknown) => error,
  );
}

// The waits between attempt start times, each paired with its cap.
function waitsWithCaps(startedAt: readonly number[], caps: readonly number[]) {
  return startedAt.slice(1).map((time, index) => ({
    waitMs: time - (startedAt[index] ?? 0),
    capMs: caps[index] ?? 0,
  }));
}

describe("retry", () => {
  it("retries a transient fault until the operation succeeds", async () => {
    const { clock, options } = setup();
    const operation = failing(2, () => transient);
    const result = outcome(retry(operation, options));
    await clock.advance(10_000);
    expect(await result).toBe("done on 3");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("waits at most the capped exponential delay before each attempt", async () => {
    const { clock, options } = setup();
    const startedAt: number[] = [];
    const operation = vi.fn<Operation>(async () => {
      startedAt.push(clock.now());
      await Promise.resolve();
      throw transient;
    });
    const result = outcome(retry(operation, { ...options, attempts: 6 }));
    await clock.advance(10_000);
    expect(await result).toBe(transient);
    const waits = waitsWithCaps(startedAt, [100, 200, 400, 800, 1_000]);
    expect(waits).toHaveLength(5);
    for (const { waitMs, capMs } of waits) {
      expect(waitMs).toBeGreaterThanOrEqual(0);
      expect(waitMs).toBeLessThan(capMs);
    }
  });

  it("throws a fault that is not retryable at once", async () => {
    const { options } = setup();
    const operation = failing(1, () => permanent);
    await expect(retry(operation, options)).rejects.toBe(permanent);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("throws a plain error at once", async () => {
    const { options } = setup();
    const operation = failing(1, () => new Error("plain"));
    await expect(retry(operation, options)).rejects.toThrow("plain");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after the last attempt with the last fault", async () => {
    const { clock, options } = setup();
    const operation = failing(10, () => transient);
    const result = outcome(retry(operation, options));
    await clock.advance(10_000);
    expect(await result).toBe(transient);
    expect(operation).toHaveBeenCalledTimes(4);
  });

  it("stops when the next wait would pass the time budget", async () => {
    const { clock, options } = setup();
    const operation = failing(10, () => transient);
    const result = outcome(retry(operation, { ...options, baseDelayMs: 5_000, budgetMs: 1 }));
    await clock.advance(10_000);
    expect(await result).toBe(transient);
    expect(operation.mock.calls.length).toBeLessThan(4);
  });

  it("stops within one tick when the signal aborts during a wait", async () => {
    const { clock, controller, options } = setup();
    const operation = failing(10, () => transient);
    const slow = { baseDelayMs: 60_000, maxDelayMs: 60_000, budgetMs: 600_000 };
    const result = retry(operation, { ...options, ...slow });
    await clock.advance(0);
    const reason = new Error("owner stopped");
    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("never starts an attempt on an aborted signal", async () => {
    const { controller, options } = setup();
    const operation = failing(0, () => transient);
    controller.abort(new Error("stopped"));
    await expect(retry(operation, options)).rejects.toThrow("stopped");
    expect(operation).not.toHaveBeenCalled();
  });
});
