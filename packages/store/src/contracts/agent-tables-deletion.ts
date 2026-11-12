import assert from "node:assert/strict";
import { go, nthId, okValue } from "./agent-fixtures.js";
import type { AgentRow, AgentRows, AgentTablesSubject } from "./agent-tables-contract.js";
import { plantAcrossCutoff } from "./agent-tables-plant.js";

// The case of the agent tables' suite that checks what a deletion removes from every table
// (decision 0415): one agent's chats go, row for row, and nothing else does.

// The tables a deletion removes rows from, and the column each names the chat's agent in, or the
// session through which it does.
const byAgent = ["sessions", "chat_queue", "helpers", "goals", "progress_notes"] as const;
const bySession = ["turns", "transcript_events"] as const;

// The rows a deletion of `agent`'s chats leaves: every row but those of its chats, its notes, the
// counters and `meta` as they were.
function keptByDeletion(rows: AgentRows, agent: string): AgentRows {
  const isAgents = (row: AgentRow): boolean => row["agent_id"] === agent;
  const sessions = new Set((rows["sessions"] ?? []).filter(isAgents).map((row) => row["id"]));
  const kept: Record<string, readonly AgentRow[]> = { ...rows };
  for (const table of byAgent) {
    kept[table] = (rows[table] ?? []).filter((row) => !isAgents(row));
  }
  for (const table of bySession) {
    kept[table] = (rows[table] ?? []).filter((row) => !sessions.has(row["session_id"] ?? null));
  }
  return kept;
}

// Both agents hold rows in each table a deletion removes from, so the case proves each.
function assertBothPlanted(rows: AgentRows): void {
  const agentOf = new Map(
    (rows["sessions"] ?? []).map((session) => [session["id"], session["agent_id"]]),
  );
  const owner = (row: AgentRow): AgentRow[string] | undefined =>
    row["agent_id"] ?? agentOf.get(row["session_id"] ?? null);
  for (const table of [...byAgent, ...bySession]) {
    const owners = new Set((rows[table] ?? []).map(owner));
    assert.equal(owners.size, 2, `The case leaves ${table} without both agents' rows.`);
  }
}

/** One agent's deletion leaves the other agent's rows, the notes and `meta` as they were. */
export async function deletesOnlyChosenAgents(
  subject: AgentTablesSubject,
  fence: number,
): Promise<void> {
  await plantAcrossCutoff(subject, fence, 1);
  await plantAcrossCutoff(subject, fence, 2);
  const before = await subject.rows();
  assertBothPlanted(before);
  const agent = nthId("agt", 1);
  const deleted = okValue(await subject.deletion.delete({ agents: [agent], fence }, go()));
  const kept = keptByDeletion(before, agent);
  assert.deepEqual(await subject.rows(), kept);
  const gone = (table: string): number => (before[table]?.length ?? 0) - (kept[table]?.length ?? 0);
  assert.deepEqual(deleted, {
    sessions: gone("sessions"),
    turns: gone("turns"),
    events: gone("transcript_events"),
    messages: gone("chat_queue"),
    goals: gone("goals"),
    progressNotes: gone("progress_notes"),
    helpers: gone("helpers"),
  });
}
