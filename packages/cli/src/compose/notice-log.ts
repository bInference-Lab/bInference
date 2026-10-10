import {
  BinferenceError,
  type Clock,
  type IdSource,
  type LogFields,
  type Logger,
} from "@binference/core";
import type { EnginePush } from "@binference/engine";
import {
  type NoticeRecord,
  type NoticeStore,
  type NoticeSurface,
  noticeArea,
  noticeRecordOf,
  storedNoticePush,
} from "@binference/engine/notices";
import { type Notice, noticeSchema } from "@binference/engine/surfaces";

/** The one write path of the owner notices (decision 0133). */
export interface NoticeLog {
  /**
   * Takes one push before any surface gets it. A notice of spec 4, section 4 gets its id and time
   * and is stored with a queued delivery for each chat surface, and the push every surface gets
   * carries them; any other push comes back as it is.
   */
  take(push: EnginePush): EnginePush;
  /** Resolves once every notice taken so far is stored, or failed and was logged. */
  idle(): Promise<void>;
}

/** What {@link createNoticeLog} stores through. */
export interface NoticeLogOptions {
  readonly store: NoticeStore;
  /** The chat surfaces the install runs, each of which delivers every notice from the outbox. */
  readonly surfaces: readonly NoticeSurface[];
  readonly ids: IdSource;
  readonly clock: Clock;
  readonly logger: Logger;
}

// Writes wait in one line, in the order the notices came; past this many waiting, a notice is not
// stored, and the surfaces that read pushes still get it.
const maxWaiting = 1_000;
// One write takes longer only when the store is stuck.
const writeTimeoutMs = 30_000;

// The ids a log line about a notice names, never its text.
function fieldsOf(notice: Notice): LogFields {
  const { agent, intent } = notice;
  return {
    ...(agent === undefined ? {} : { agentId: agent }),
    ...(intent === undefined ? {} : { intentId: intent }),
  };
}

/**
 * Creates the notice log the composition root's `publish` runs every push through. Notices are
 * stored one at a time, in the order they came; a write that fails is logged by its code and the
 * notice still reaches the clients that read pushes.
 */
export function createNoticeLog(options: NoticeLogOptions): NoticeLog {
  const { store, logger } = options;
  let written: Promise<void> = Promise.resolve();
  let waiting = 0;
  const write = async (record: NoticeRecord): Promise<void> => {
    try {
      await store.record(record, { signal: AbortSignal.timeout(writeTimeoutMs) });
    } catch (error) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      logger.warn("engine.notice_not_stored", { ...fieldsOf(record.notice), errorCode });
    }
  };
  return {
    take(push) {
      const notice = push.kind === "notice/new" ? noticeSchema.safeParse(push.data) : undefined;
      if (notice?.success !== true || !notice.data.key.startsWith(noticeArea)) {
        return push;
      }
      const stamp = { id: options.ids.next("ntc"), atMs: options.clock.now() };
      const record = noticeRecordOf(notice.data, { ...stamp, surfaces: options.surfaces });
      if (waiting >= maxWaiting) {
        logger.warn("engine.notice_not_stored", { ...fieldsOf(notice.data), errorCode: "busy" });
        return storedNoticePush(record);
      }
      waiting += 1;
      const before = written;
      written = (async () => {
        await before;
        await write(record);
        waiting -= 1;
      })();
      return storedNoticePush(record);
    },
    idle: async () => written,
  };
}
