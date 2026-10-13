import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { ContextSource } from "../relay/ports.js";
import type { SkillIndexEntry } from "../relay/skill-index-entry.js";

/**
 * An engine with one agent whose `RULES.md` holds `rules`, that has no `NOTES.md`, and whose
 * index holds `skills`, by name.
 */
export interface ContextSourceSubject {
  readonly source: ContextSource;
  readonly agent: Id<"agt">;
  readonly unknownAgent: Id<"agt">;
  readonly rules: string;
  readonly skills: readonly SkillIndexEntry[];
}

/** Makes a fresh subject for each check. */
export interface ContextSourceHarness {
  create(): Promise<ContextSourceSubject>;
}

const live = (): AbortSignal => new AbortController().signal;

const checks: readonly {
  readonly name: string;
  readonly run: (subject: ContextSourceSubject) => Promise<void>;
}[] = [
  {
    name: "reads a workspace file's text, and none for a file the agent does not have",
    run: async ({ source, agent, rules }) => {
      assert.equal(await source.workspaceFile({ agent, file: "RULES.md" }, live()), rules);
      assert.equal(await source.workspaceFile({ agent, file: "NOTES.md" }, live()), undefined);
    },
  },
  {
    name: "lists the skills the agent's index holds",
    run: async ({ source, agent, skills }) => {
      assert.deepEqual(await source.skills(agent, live()), skills);
    },
  },
  {
    name: "reads the agent's live facts",
    run: async ({ source, agent }) => {
      const facts = await source.liveFacts(agent, live());
      assert.equal(facts.agent, agent);
      assert.equal(typeof facts.spentTodayUsdMicros, "bigint");
    },
  },
  {
    name: "rejects for an agent the engine does not hold, and once the signal aborted",
    run: async ({ source, agent, unknownAgent }) => {
      await assert.rejects(source.liveFacts(unknownAgent, live()));
      const aborted = AbortSignal.abort(new Error("stopped"));
      await assert.rejects(source.liveFacts(agent, aborted), /stopped/u);
      await assert.rejects(source.workspaceFile({ agent, file: "RULES.md" }, aborted), /stopped/u);
    },
  },
];

/**
 * The contract every {@link ContextSource} keeps: a workspace file reads back as its text, a
 * missing one as none, the agent's skills list as its index holds them, the live facts are the
 * agent's, and an unknown agent or an aborted signal rejects.
 */
export function contextSourceContract(harness: ContextSourceHarness): readonly ContractCheck[] {
  return checks.map((check) => ({
    name: check.name,
    run: async () => check.run(await harness.create()),
  }));
}
