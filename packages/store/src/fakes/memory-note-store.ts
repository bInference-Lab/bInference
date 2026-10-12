import { err, ok } from "@binference/core";
import type { NoteRecord } from "../notes/note-record.js";
import type { NoteStore } from "../ports.js";
import { holdsFence, inMemory, type MemoryAgentDatabase } from "./memory-agent-database.js";

// The shortest query the trigram index matches; a shorter one is looked for as a substring.
const shortestQuery = 3;

// The characters of a text, as the trigram index counts them: code points.
function characters(text: string): number {
  return text.match(/./gsu)?.length ?? 0;
}

function isListed(note: NoteRecord, agentId: string): boolean {
  return note.agentId === agentId && note.deletedAtMs === undefined;
}

function listedOf(notes: ReadonlyMap<number, NoteRecord>, agentId: string): readonly NoteRecord[] {
  return [...notes.values()]
    .filter((note) => isListed(note, agentId))
    .toSorted((left, right) => left.id - right.id);
}

// The notes whose text holds the query: a short one as a substring in any ASCII letter case, as
// the database's does, a longer one in any letter case.
function found(notes: readonly NoteRecord[], query: string): readonly NoteRecord[] {
  const fold = (text: string): string =>
    characters(query) < shortestQuery
      ? text.replace(/[A-Z]+/g, (run) => run.toLowerCase())
      : text.toLowerCase();
  const wanted = fold(query);
  return notes.filter((note) => fold(note.text).includes(wanted));
}

/** The {@link NoteStore} of an in-memory agent database. */
export function createMemoryNoteStore(database: MemoryAgentDatabase): NoteStore {
  const { notes } = database;
  const listed = (agentId: string): readonly NoteRecord[] => listedOf(notes, agentId);
  return {
    write: async ({ fence, atMs, ...draft }, options) =>
      inMemory(options, () => {
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        const note = {
          ...draft,
          id: database.noteIds.add(1),
          createdAtMs: atMs,
          changedAtMs: atMs,
        };
        notes.set(note.id, note);
        return ok(structuredClone(note));
      }),
    delete: async ({ fence, note, atMs }, options) =>
      inMemory(options, () => {
        const stored = notes.get(note);
        if (!holdsFence(database, fence)) {
          return err("fenced");
        }
        if (stored === undefined || stored.deletedAtMs !== undefined) {
          return err("not_found");
        }
        const deleted = { ...stored, deletedAtMs: atMs };
        notes.set(note, deleted);
        return ok(structuredClone(deleted));
      }),
    list: async ({ agentId, afterId = 0, limit }, options) =>
      inMemory(options, () =>
        listed(agentId)
          .filter((note) => note.id > afterId)
          .slice(0, limit)
          .map((note) => structuredClone(note)),
      ),
    search: async ({ agentId, query, limit }, options) =>
      inMemory(options, () =>
        found(listed(agentId), query)
          .slice(0, limit)
          .map((note) => structuredClone(note)),
      ),
  };
}
