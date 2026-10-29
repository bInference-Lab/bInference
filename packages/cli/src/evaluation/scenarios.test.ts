import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { loadScenarios, scenarioFolder } from "./load-scenarios.js";
import { runScenario } from "./run-scenario.js";
import type { CheckName, Scenario, StandInReply } from "./scenario.schema.js";
import { safetyChecks, scoreScenario } from "./score-scenario.js";
import { standInChain } from "./stand-in-models.js";

// Every shipped scenario, proven on its own scripted answers: the right one passes, and each wrong
// one misses the checks it names, so no check of the scorer passes a wrong answer unseen.

const book = await loadScenarios(scenarioFolder, AbortSignal.timeout(10_000));
const known = new Set(
  book.world.tokens.flatMap((token) => token.asset.match(/0x[0-9a-f]{40}/gi) ?? []),
);

async function verdictOf(
  scenario: Scenario,
  replies: readonly StandInReply[],
  signal: AbortSignal,
) {
  const clock = createManualClock(1_767_261_600_000);
  const model = () => standInChain(replies, clock);
  const run = await runScenario(scenario, { world: book.world, model, clock, signal });
  return scoreScenario(run, new Set([...known].map((address) => address.toLowerCase())));
}

// The checks a scenario declares, each of which some wrong answer must miss.
function declared(scenario: Scenario): readonly CheckName[] {
  const { controls, mentions, never } = scenario.expect;
  return [
    "proposals",
    ...(controls === undefined ? [] : ["controls" as const]),
    ...(mentions === undefined ? [] : ["mentions" as const]),
    ...(never === undefined ? [] : ["never" as const]),
  ];
}

describe("the evaluation's scenarios", () => {
  it.each(["en", "zh"] as const)(
    "hold about 30 scenarios in %s, of both tags, with the same ids as the other language",
    (locale) => {
      const own = book.scenarios.filter((scenario) => scenario.locale === locale);
      const other = book.scenarios.filter((scenario) => scenario.locale !== locale);
      expect(own.length).toBeGreaterThanOrEqual(30);
      expect(new Set(own.map((scenario) => scenario.tag))).toEqual(
        new Set(["safety", "understanding"]),
      );
      expect(own.map((scenario) => scenario.id)).toEqual(other.map((scenario) => scenario.id));
    },
  );

  it("read the bundled skills every agent's index holds, without the one for MCP clients alone", () => {
    const names = book.world.skills.map((skill) => skill.name);
    expect(names).not.toContain("binference-tools");
    expect(
      book.world.skills.every((skill) => skill.location === `bundled/${skill.name}/SKILL.md`),
    ).toBe(true);
  });

  it.each(["en", "zh"] as const)(
    "test each bundled skill with safety and understanding scenarios in %s, and name no other skill",
    (locale) => {
      const own = book.scenarios.filter((scenario) => scenario.locale === locale);
      const names = book.world.skills.map((skill) => skill.name);
      const tagsOf = (name: string) =>
        new Set(own.filter((scenario) => scenario.skill === name).map((scenario) => scenario.tag));
      expect(names.filter((name) => tagsOf(name).size < 2)).toEqual([]);
      const named = own.map((scenario) => scenario.skill).filter((name) => name !== undefined);
      expect(named.filter((name) => !names.includes(name))).toEqual([]);
    },
  );

  it.each(["en", "zh"] as const)(
    "miss every safety check with some wrong answer in %s",
    (locale) => {
      const missed = new Set(
        book.scenarios
          .filter((scenario) => scenario.locale === locale)
          .flatMap((scenario) => scenario.proof.wrong.flatMap((answer) => answer.misses)),
      );
      expect([...safetyChecks].filter((check) => !missed.has(check))).toEqual([]);
    },
  );

  describe.each(
    book.scenarios.map((scenario) => [`${scenario.locale} ${scenario.id}`, scenario] as const),
  )("scenario %s", (_name, scenario) => {
    it("passes its right answer", async ({ signal }) => {
      const verdict = await verdictOf(scenario, scenario.proof.right, signal);
      expect({ status: verdict.status, misses: verdict.misses }).toEqual({
        status: "passed",
        misses: [],
      });
    });

    it("misses the checks each wrong answer names, and its wrong answers miss every check it declares", async ({
      signal,
    }) => {
      const found: CheckName[] = [];
      for (const answer of scenario.proof.wrong) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- each wrong answer gets a run of its own
        const verdict = await verdictOf(scenario, answer.replies, signal);
        const misses = verdict.misses.map((miss) => miss.check);
        expect({
          status: verdict.status,
          missed: answer.misses.filter((check) => !misses.includes(check)),
        }).toEqual({
          status: "missed",
          missed: [],
        });
        found.push(...misses);
      }
      expect(declared(scenario).filter((check) => !found.includes(check))).toEqual([]);
    });
  });
});
