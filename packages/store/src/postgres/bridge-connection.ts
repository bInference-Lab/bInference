import { receiveMessageOnPort, type MessagePort } from "node:worker_threads";
import { BinferenceError } from "@binference/core";
import type { CompiledQuery, QueryResult } from "kysely";
import { assertQueryRows } from "../dialect/assert-query-rows.js";
import type { PostgresTaskConnection } from "../dialect/store-connection.js";
import {
  bridgeWords,
  type ResultMessage,
  type StatementMessage,
  toTaskThreadSchema,
} from "./task-bridge-messages.js";

/** A task thread's end of the bridge: its port, the shared words and its wait bound. */
export interface TaskThreadLink {
  readonly port: MessagePort;
  readonly words: Int32Array;
  readonly waitMs: number;
}

/** Makes the connection each run's task gets, numbering statements across runs. */
export interface TaskBridge {
  connectionFor(run: number, schema: string): PostgresTaskConnection;
}

function aborted(): BinferenceError {
  return new BinferenceError({
    code: "store.aborted",
    message: "The store call was aborted while its task waited for Postgres; nothing committed.",
  });
}

function unanswered(waitMs: number): BinferenceError {
  return new BinferenceError({
    code: "store.postgres_unreachable",
    message: `Postgres did not answer a statement within ${String(waitMs)} ms, so the task stopped and its transaction rolls back. Try the call again.`,
    retryable: true,
    details: { waitMs },
  });
}

// The statement side holds the statement's own error and reports that one; this only unwinds the
// task, as a failed statement does on SQLite.
function statementFailed(): BinferenceError {
  return new BinferenceError({
    code: "store.postgres_statement_failed",
    message: "A statement of this store task failed on Postgres; the task stopped.",
  });
}

function answerOf<Row>(message: ResultMessage): QueryResult<Row> {
  if (!message.ok) {
    throw statementFailed();
  }
  const rows = assertQueryRows<Row>(message.rows);
  return message.numAffectedRows === undefined
    ? { rows }
    : { rows, numAffectedRows: message.numAffectedRows };
}

// Blocks the task thread until the answer to `statement` arrives. A wake comes with each message
// the statement side posts; an answer to an earlier statement, left by a run that ended, is
// dropped. The caller's abort and the wait bound end the wait with a fault.
function awaitAnswer(link: TaskThreadLink, run: number, statement: number): ResultMessage {
  const deadline = performance.now() + link.waitMs;
  for (;;) {
    if (Atomics.load(link.words, bridgeWords.aborted) === run) {
      throw aborted();
    }
    const seen = Atomics.load(link.words, bridgeWords.posted);
    const received = receiveMessageOnPort(link.port);
    if (received !== undefined) {
      const message = toTaskThreadSchema.parse(received.message);
      if (message.kind === "result" && message.statement === statement) {
        return message;
      }
      continue;
    }
    const leftMs = deadline - performance.now();
    if (leftMs <= 0 || Atomics.wait(link.words, bridgeWords.posted, seen, leftMs) === "timed-out") {
      throw unanswered(link.waitMs);
    }
  }
}

/**
 * The task thread's side of the bridge (decision 0369). A task's statement goes to the statement
 * side, and the task thread blocks on `Atomics.wait` until its answer comes, the caller aborts,
 * or the wait bound passes.
 */
export function createTaskBridge(link: TaskThreadLink): TaskBridge {
  let statements = 0;
  return {
    connectionFor: (run, schema) => ({
      dialect: "postgres",
      schema,
      run: <Row>(query: CompiledQuery<Row>): QueryResult<Row> => {
        if (Atomics.load(link.words, bridgeWords.aborted) === run) {
          throw aborted();
        }
        statements += 1;
        const message: StatementMessage = {
          kind: "statement",
          statement: statements,
          sql: query.sql,
          parameters: query.parameters,
        };
        link.port.postMessage(message, []);
        return answerOf<Row>(awaitAnswer(link, run, statements));
      },
    }),
  };
}
