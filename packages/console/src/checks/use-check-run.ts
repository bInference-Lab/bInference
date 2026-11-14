import type { CheckReportView } from "@binference/protocol";
import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useEngine } from "../connection/engine-context";
import { type CheckEnd, readCheckEnd } from "./check-end.schema";

// A run has 15 seconds in the engine; the page waits a little longer for its job's end.
const waitMs = 30_000;
// The ends a page keeps for a job whose answer has not come yet.
const keptEnds = 20;

/** The ends of check jobs the page heard, and a wait for one by its job. */
interface CheckEnds {
  take(end: CheckEnd): void;
  wait(job: string, signal: AbortSignal): Promise<CheckEnd>;
}

function createCheckEnds(): CheckEnds {
  const ended = new Map<string, CheckEnd>();
  const waiting = new Map<string, (end: CheckEnd) => void>();
  return {
    take(end) {
      const waiter = waiting.get(end.job);
      if (waiter !== undefined) {
        waiter(end);
        return;
      }
      ended.set(end.job, end);
      const [oldest] = ended.keys();
      if (ended.size > keptEnds && oldest !== undefined) {
        ended.delete(oldest);
      }
    },
    async wait(job, signal) {
      const known = ended.get(job);
      if (known !== undefined) {
        return known;
      }
      return new Promise<CheckEnd>((resolve, reject) => {
        waiting.set(job, resolve);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }).finally(() => waiting.delete(job));
    },
  };
}

// The check jobs' ends on the `job` topic for as long as the page shows, so none comes before
// the page listens: the console's frame follows the topic from the start too.
function useCheckEnds(): CheckEnds {
  const { topics } = useEngine();
  const [ends] = useState(createCheckEnds);
  useEffect(
    () =>
      topics.listen("job", {
        onPush: (push) => {
          const end = readCheckEnd(push.data);
          if (end !== undefined) {
            ends.take(end);
          }
        },
        refetch: async () => Promise.resolve(),
      }),
    [topics, ends],
  );
  return ends;
}

/**
 * Runs `binference check` in the engine through `check/run` (`admin`, decision 0445) and waits for
 * its job's report on the `job` topic; a job that failed rejects with its error's code.
 */
export function useCheckRun(): UseMutationResult<CheckReportView, Error, void> {
  const { client } = useEngine();
  const ends = useCheckEnds();
  return useMutation({
    mutationFn: async () => {
      const signal = AbortSignal.timeout(waitMs);
      const { job } = await client.call("check/run", {}, { signal });
      const end = await ends.wait(job, signal);
      if ("code" in end) {
        throw Object.assign(new Error("check/run"), { code: end.code });
      }
      return end.report;
    },
  });
}
