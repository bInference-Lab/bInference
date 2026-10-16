import type { ProtocolClient } from "@binference/client";
import { type NoticePushView, noticePushViewSchema, type ResultOf } from "@binference/protocol";
import { useCallback, useRef, useState } from "react";
import { useEngine } from "../connection/engine-context";
import { useTopic } from "../connection/use-topic";

/** The notices the notice area shows, newest first, and how the owner dismisses one. */
export interface ShownNotices {
  readonly notices: readonly NoticePushView[];
  readonly dismiss: (id: NoticePushView["id"]) => void;
}

// The most notices the area holds; an older one leaves as a new one comes.
const kept = 20;
// The most pages a read after a gap goes through: the area keeps only the newest anyway.
const readPages = 4;

// The notices after the last one the area has, oldest first (decision 0133).
async function readOn(
  client: ProtocolClient,
  after: string,
  signal: AbortSignal,
): Promise<readonly NoticePushView[]> {
  const read: NoticePushView[] = [];
  let cursor: string | undefined = after;
  for (let page = 0; page < readPages && cursor !== undefined; page += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page reads on from the last
    const answer: ResultOf<"notice/list"> = await client.call(
      "notice/list",
      { cursor, limit: 50 },
      { signal },
    );
    read.push(...answer.items);
    cursor = answer.next;
  }
  return read.slice(-kept);
}

/**
 * The owner's notices that arrive while the console is open (spec 4, section 4), newest first,
 * at most 20. After a gap in the `notice` topic the area reads on from the last notice it has
 * with `notice/list`, so none is missed; the notices from before the page opened stay in the
 * owner's chats.
 */
export function useNotices(): ShownNotices {
  const { client } = useEngine();
  const [notices, setNotices] = useState<readonly NoticePushView[]>([]);
  const last = useRef<string | undefined>(undefined);
  const add = useCallback((arrived: readonly NoticePushView[]) => {
    const newest = arrived.at(-1);
    if (newest === undefined) {
      return;
    }
    last.current = newest.id;
    const ids = new Set(arrived.map((notice) => notice.id));
    setNotices((shown) =>
      [...arrived.toReversed(), ...shown.filter((notice) => !ids.has(notice.id))].slice(0, kept),
    );
  }, []);
  useTopic("notice", {
    onPush: (push) => {
      const notice =
        push.kind === "notice/new" ? noticePushViewSchema.safeParse(push.data) : undefined;
      if (notice?.success === true) {
        add([notice.data]);
      }
    },
    refetch: async (signal) => {
      const after = last.current;
      if (after !== undefined) {
        add(await readOn(client, after, signal));
      }
    },
  });
  const dismiss = useCallback((id: NoticePushView["id"]) => {
    setNotices((shown) => shown.filter((notice) => notice.id !== id));
  }, []);
  return { notices, dismiss };
}
