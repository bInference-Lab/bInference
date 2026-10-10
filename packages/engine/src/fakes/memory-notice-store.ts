import { err, ok, type Result } from "@binference/core";
import {
  type DeliveryMove,
  type DeliveryState,
  type NoticeDelivery,
  type NoticeRecord,
  type NoticeSurface,
  noticeSurfaces,
} from "../notices/notice-record.js";
import type { AgentStore, NoticeStore } from "../ports.js";
import { constraintFault, memoryCall } from "./memory-call.js";

/** What the in-memory notice store checks a notice's agent against. */
export interface MemoryNoticeStoreOptions {
  readonly agents: Pick<AgentStore, "get">;
}

/** One outbox row as the fake keeps it. */
interface Row {
  readonly id: number;
  readonly noticeId: NoticeRecord["id"];
  readonly surface: NoticeSurface;
  readonly state: DeliveryState;
  readonly attempts: number;
  readonly nextAtMs: number;
}

/** The fake's two tables. */
interface Tables {
  readonly notices: ReadonlyMap<string, NoticeRecord>;
  readonly rows: readonly Row[];
}

function deliveryOf(tables: Tables, row: Row): NoticeDelivery {
  const record = tables.notices.get(row.noticeId);
  if (record === undefined) {
    throw constraintFault("a delivery of a notice the store does not hold");
  }
  const { noticeId: _noticeId, ...delivery } = row;
  return structuredClone({ ...delivery, record });
}

function movedRow(row: Row, move: DeliveryMove): Row {
  if (move.to === "unknown_after_send") {
    return { ...row, state: move.to, attempts: row.attempts + 1 };
  }
  return move.to === "queued"
    ? { ...row, state: move.to, nextAtMs: move.nextAtMs }
    : { ...row, state: move.to };
}

// The tables after one move, which changes the row and the notice's delivery state together.
function tablesAfter(tables: Tables, row: Row, next: Row): Tables {
  const record = tables.notices.get(row.noticeId);
  const notices =
    record === undefined
      ? tables.notices
      : new Map(tables.notices).set(record.id, {
          ...record,
          delivered: { ...record.delivered, [row.surface]: next.state },
        });
  return { notices, rows: tables.rows.map((held) => (held.id === row.id ? next : held)) };
}

// The tables with a notice and its deliveries, numbered after the last row, as SQLite numbers them.
function withRecord(tables: Tables, record: NoticeRecord): Tables {
  if (tables.notices.has(record.id)) {
    throw constraintFault("a notice id in use");
  }
  const lastId = tables.rows.at(-1)?.id ?? 0;
  const rows = noticeSurfaces
    .flatMap((surface) => {
      const state = record.delivered[surface];
      return state === undefined ? [] : [{ surface, state } as const];
    })
    .map(({ surface, state }, at) => ({
      id: lastId + at + 1,
      noticeId: record.id,
      surface,
      state,
      attempts: 0,
      nextAtMs: record.atMs,
    }));
  return {
    notices: new Map(tables.notices).set(record.id, structuredClone(record)),
    rows: [...tables.rows, ...rows],
  };
}

function withoutBefore(tables: Tables, beforeMs: number): Tables {
  const gone = new Set(
    [...tables.notices.values()].filter((record) => record.atMs < beforeMs).map(({ id }) => id),
  );
  return {
    notices: new Map(
      [...tables.notices.values()].filter(({ id }) => !gone.has(id)).map((kept) => [kept.id, kept]),
    ),
    rows: tables.rows.filter((row) => !gone.has(row.noticeId)),
  };
}

function listed(tables: Tables, after: string | undefined, limit: number): readonly NoticeRecord[] {
  return structuredClone(
    [...tables.notices.values()]
      .filter((record) => after === undefined || record.id > after)
      .toSorted((left, right) => (left.id < right.id ? -1 : 1))
      .slice(0, limit),
  );
}

/**
 * Creates an empty in-memory {@link NoticeStore} for tests. Like the SQLite store, it refuses a
 * notice whose agent it does not hold, lists notices in the code-unit order of their ids, and
 * numbers deliveries in the order they were recorded.
 */
export function createMemoryNoticeStore(options: MemoryNoticeStoreOptions): NoticeStore {
  let tables: Tables = { notices: new Map(), rows: [] };
  const move = (change: DeliveryMove): Result<NoticeDelivery, "not_found" | "moved"> => {
    const row = tables.rows.find((held) => held.id === change.id);
    if (row === undefined) {
      return err("not_found");
    }
    if (row.state !== change.from) {
      return err("moved");
    }
    const next = movedRow(row, change);
    tables = tablesAfter(tables, row, next);
    return ok(deliveryOf(tables, next));
  };
  return {
    record: async (record, call) => {
      const agent = record.notice.agent;
      const isHeld = agent === undefined || (await options.agents.get(agent, call)) !== undefined;
      return memoryCall(call, () => {
        if (!isHeld) {
          throw constraintFault("a notice of an agent the store does not hold");
        }
        tables = withRecord(tables, record);
      });
    },
    list: async (page, call) => memoryCall(call, () => listed(tables, page.after, page.limit)),
    queued: async (query, call) =>
      memoryCall(call, () =>
        tables.rows
          .filter((row) => row.surface === query.surface && row.state === "queued")
          .slice(0, query.limit)
          .map((row) => deliveryOf(tables, row)),
      ),
    move: async (change, call) => memoryCall(call, () => move(change)),
    prune: async (beforeMs, call) =>
      memoryCall(call, () => {
        const before = tables.notices.size;
        tables = withoutBefore(tables, beforeMs);
        return before - tables.notices.size;
      }),
  };
}
