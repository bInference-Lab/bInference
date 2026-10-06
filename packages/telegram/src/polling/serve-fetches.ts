import type { MessagePort } from "node:worker_threads";
import {
  type PollReply,
  type PollRequest,
  pollFaultOf,
  pollRequestOf,
} from "./poll-messages.schema.js";
import type { UpdateFetcher } from "./update-fetcher.js";

type FetchRequest = Extract<PollRequest, { kind: "fetch" }>;

// The parent asks for one batch at a time; this bound only catches a parent that does not.
const maxInFlight = 4;

/**
 * Answers a parent's fetch requests on a worker's port with the fetcher's updates or its fault,
 * and cancels a fetch on request. A message that is not a request is ignored.
 */
export function serveFetches(port: MessagePort, fetcher: UpdateFetcher): void {
  const inFlight = new Map<number, AbortController>();
  const send = (reply: PollReply): void => {
    port.postMessage(reply);
  };
  const answer = async (request: FetchRequest, signal: AbortSignal): Promise<void> => {
    try {
      const updates = await fetcher.fetch(request.offset, { signal });
      send({ kind: "updates", id: request.id, updates });
    } catch (error) {
      send({ kind: "fault", id: request.id, fault: pollFaultOf(error) });
    }
  };
  port.on("message", (value) => {
    const request = pollRequestOf(value);
    if (request?.kind === "cancel") {
      inFlight.get(request.id)?.abort();
      return;
    }
    if (request === undefined) {
      return;
    }
    if (inFlight.size >= maxInFlight) {
      send({
        kind: "fault",
        id: request.id,
        fault: { code: "telegram.poller_busy", retryable: true },
      });
      return;
    }
    const controller = new AbortController();
    inFlight.set(request.id, controller);
    void answer(request, controller.signal).finally(() => inFlight.delete(request.id));
  });
}
