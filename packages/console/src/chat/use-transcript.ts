import type { ProtocolClient } from "@binference/client";
import type { ProtocolId, ResultOf } from "@binference/protocol";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import type { TranscriptMessage } from "./chat-entries";

// The most messages the console reads of a session: the newest it shows come after these.
const pageSize = 200;
const mostPages = 10;

async function readSession(
  client: ProtocolClient,
  agent: ProtocolId<"agent">,
  signal: AbortSignal,
): Promise<readonly TranscriptMessage[]> {
  const read: TranscriptMessage[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < mostPages; page += 1) {
    const args = { agent, limit: pageSize, ...(cursor === undefined ? {} : { cursor }) };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page reads on from the last
    const answer: ResultOf<"chat/messages"> = await client.call("chat/messages", args, { signal });
    read.push(...answer.items);
    cursor = answer.next;
    if (cursor === undefined) {
      break;
    }
  }
  return read;
}

/** The query key of an agent's transcript, which a turn's end and a clear make stale. */
export function transcriptKey(agent: ProtocolId<"agent">): readonly string[] {
  return ["chat", agent];
}

/**
 * The agent's open session as the runtime keeps it, oldest first, up to 2,000 messages. It fails
 * `runtime.unavailable` while the agent runtime is down; the owner's messages still reach the
 * engine then.
 */
export function useTranscript(
  agent: ProtocolId<"agent">,
): UseQueryResult<readonly TranscriptMessage[]> {
  const { client } = useEngine();
  return useQuery({
    queryKey: transcriptKey(agent),
    queryFn: async ({ signal }) => readSession(client, agent, signal),
    retry: false,
  });
}
