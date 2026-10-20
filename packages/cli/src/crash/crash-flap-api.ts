// oxlint-disable-next-line eslint/no-restricted-imports -- the crash suite serves Flap's API on loopback; nothing ships a listener
import type { ServerResponse } from "node:http";
import type { HttpResponse } from "@binference/core";
import { apiAnswer, pinAnswer } from "@binference/flap/testing";

/** What Flap's pin status API answers a run's reads, in turn; the last again once they run out. */
type CrashPinStates = readonly [string, ...string[]];

/** Flap's upload and pin status API as the crash engines reach it, counting what reaches it. */
export interface CrashFlapApi {
  /**
   * Starts a run's launch: the upload answers `cid`, and the pin status reads answer `pins` in
   * turn. The counts start again, and any answer still held is dropped.
   */
  readonly serve: (run: { readonly cid: string; readonly pins: CrashPinStates }) => void;
  /** The uploads of the run that reached the API, answered or held. */
  readonly uploads: () => number;
  /** Holds the next upload: it is counted and never answered. Resolves once it came. */
  readonly holdNextUpload: () => Promise<void>;
  /** Holds the next pin status read: it is counted and never answered. Resolves once it came. */
  readonly holdNextPinRead: () => Promise<void>;
  /** Answers one request to the API's path, or holds it. */
  readonly respond: (call: {
    readonly path: string;
    readonly method: string | undefined;
    readonly outgoing: ServerResponse;
  }) => void;
  /** Ends every held answer's connection. */
  readonly release: () => void;
}

const uploadPath = "/api/upload";
const pinsPath = "/api/v1/ipfs/pins";

/** One kind of request the API counts, and holds when asked. */
interface HeldCounter {
  readonly count: () => number;
  /** Resolves once the next request came, which is then held. */
  readonly arm: () => Promise<void>;
  /** Counts a request; answers whether a hold keeps it, unanswered. */
  readonly take: (outgoing: ServerResponse) => boolean;
  readonly reset: () => void;
}

function createHeldCounter(held: ServerResponse[]): HeldCounter {
  const state: { count: number; hold: (() => void) | undefined } = { count: 0, hold: undefined };
  return {
    count: () => state.count,
    arm: async () =>
      new Promise((resolve) => {
        state.hold = resolve;
      }),
    take: (outgoing) => {
      state.count += 1;
      const { hold } = state;
      state.hold = undefined;
      if (hold !== undefined) {
        held.push(outgoing);
        hold();
      }
      return hold !== undefined;
    },
    reset: () => {
      Object.assign(state, { count: 0, hold: undefined });
    },
  };
}

function write(outgoing: ServerResponse, answer: HttpResponse): void {
  outgoing.writeHead(answer.status, answer.headers).end(answer.body);
}

/**
 * Flap's API for the crash engines, answering as the recorded API did: an upload answers the run's
 * CID, a pin status read the run's next state, and anything else 404. A hold keeps a request
 * unanswered, as an API the engine was killed waiting on. No IPFS gateway is served: a launch
 * never reads one.
 */
export function createCrashFlapApi(): CrashFlapApi {
  const run: { cid: string; pins: CrashPinStates } = { cid: "", pins: ["pinned"] };
  const held: ServerResponse[] = [];
  const uploads = createHeldCounter(held);
  const reads = createHeldCounter(held);
  const release = (): void => {
    held.splice(0).forEach((outgoing) => outgoing.destroy());
  };
  // The upload, or the pin status read with the run's next state, unless a hold keeps it.
  const answerOf = (method: string | undefined, pathname: string) => {
    if (method === "POST" && pathname === uploadPath) {
      return { counter: uploads, answer: apiAnswer(200, { data: { create: run.cid } }) };
    }
    const state = run.pins[Math.min(reads.count(), run.pins.length - 1)] ?? "pinned";
    return method === "GET" && pathname === pinsPath
      ? { counter: reads, answer: pinAnswer(state, run.cid) }
      : undefined;
  };
  return {
    serve(next) {
      release();
      Object.assign(run, next);
      uploads.reset();
      reads.reset();
    },
    uploads: uploads.count,
    holdNextUpload: uploads.arm,
    holdNextPinRead: reads.arm,
    respond({ path, method, outgoing }) {
      const found = answerOf(method, new URL(path, "https://funcs.flap.sh").pathname);
      if (found === undefined) {
        write(outgoing, apiAnswer(404, { message: "not found" }));
      } else if (!found.counter.take(outgoing)) {
        write(outgoing, found.answer);
      }
    },
    release,
  };
}
