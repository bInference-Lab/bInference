import { describe, expect, inject, it, onTestFailed } from "vitest";
import type { CrashContext } from "./crash-context.js";
import {
  armKill,
  restartWith,
  type RunKillPoint,
  storyOf,
  useCrashHarness,
} from "./crash-harness.js";
import { type AtKill, atKillOf, atRest, landedOf, minedOf, unminedOf } from "./crash-reads.js";
import { setUpCrashInstall } from "./crash-runs.js";
import {
  type AlertBooked,
  alertBookedOf,
  alertEndedAndStopped,
  crashRuleOf,
  postCrashAlert,
} from "./crash-webhook-rules.js";

// Each run makes a live webhook rule on a fresh install as the owner does, confirms its card,
// posts one alert to the rule's URL, and kills the engine outright at the run's point of the
// alert's fill: as custody is asked to sign, once it signed, or at a point of the chain's on its
// one step. A second engine on the same folder then recovers the fill and ends the alert. An alert
// is judged once (decision 0336), so a fill a stop left unsigned ends its alert and nothing fills
// it again; a fill whose bytes were stored reaches the chain once and counts on its rule once
// (decision 0342). What reached the chain is counted by the test's relays and by anvil itself,
// and the signatures by the test's Privy.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 67 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);
const notSigned = { isRelayed: false, isOnChain: false, mined: 0, stored: [] };
const unmined = { isRelayed: true, isOnChain: true, mined: 0 };

/** What a run at one kill point during a live rule fill does and must show. */
interface RuleKillCase {
  readonly point: RunKillPoint;
  readonly atKill: AtKill;
  /** Whether the relays get the wallet's bytes after the restart. */
  readonly isResent: boolean;
  readonly signatures: { readonly beforeKill: number; readonly afterRestart: number };
  /** The transactions that reach the chain: none for a fill the stop left unsigned. */
  readonly sent: number;
  /** How the alert ends, with the rule's fills after it. */
  readonly alert: Pick<AlertBooked["alert"], "outcome" | "reason">;
  readonly ruleFills: number;
}

const unsignedEnd = { outcome: "skipped", reason: "fill_failed" } as const;

// A stop before the fill's bytes are stored leaves nothing to send: recovery ends the fill
// unsigned and its alert `fill_failed`, and nothing proposes it again. A stop anywhere after
// leaves one transaction, which recovery follows to its end and counts on the rule once.
const ruleKillCases: readonly RuleKillCase[] = [
  {
    point: "asked",
    atKill: notSigned,
    isResent: false,
    signatures: { beforeKill: 0, afterRestart: 0 },
    sent: 0,
    alert: unsignedEnd,
    ruleFills: 0,
  },
  {
    point: "signed",
    atKill: notSigned,
    isResent: false,
    signatures: { beforeKill: 1, afterRestart: 0 },
    sent: 0,
    alert: unsignedEnd,
    ruleFills: 0,
  },
  {
    point: "stored",
    atKill: { isRelayed: true, isOnChain: false, mined: 0, stored: ["signed"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 0 },
    sent: 1,
    alert: { outcome: "filled" },
    ruleFills: 1,
  },
  {
    point: "sent",
    atKill: { ...unmined, stored: ["sent"] },
    isResent: true,
    signatures: { beforeKill: 1, afterRestart: 0 },
    sent: 1,
    alert: { outcome: "filled" },
    ruleFills: 1,
  },
  {
    point: "included",
    atKill: { ...unmined, mined: 1, stored: ["sent"] },
    isResent: false,
    signatures: { beforeKill: 1, afterRestart: 0 },
    sent: 1,
    alert: { outcome: "filled" },
    ruleFills: 1,
  },
];

describe.each(ruleKillCases)(
  "an engine killed at $point during a live webhook rule fill",
  (killCase) => {
    it.each(runs)("sends the fill once at most and ends its alert once, run %i", async () => {
      const world = harness.worldOf();
      const { chain, services } = world;
      const install = await setUpCrashInstall(world, harness.folders);
      const { from, machine } = install;
      const before = services.signatures();
      const first = await harness.startEngine(install, { fills: true });
      const rule = await crashRuleOf(install, { isLive: true });
      const killed = armKill(world, first, { point: killCase.point });
      expect(await postCrashAlert(install, rule)).toBe(202);
      await killed;
      const atKill = await atKillOf(chain, from, machine.folder);
      const sendsAtKill = chain.sends().filter((send) => send.from === from).length;
      const signedAtKill = services.signatures();
      const settle = async () => alertEndedAndStopped(install, rule);
      const isMinedAfterResend = killCase.point !== "included";
      const second = await restartWith(harness, install, {
        isMinedAfterResend,
        fills: true,
        settle,
      });
      const story = await storyOf(machine.folder, [first, second.engine]);
      onTestFailed(() => {
        process.stderr.write(`${story}\n`);
      });
      const sends = chain.sends().filter((send) => send.from === from);
      const hashes = [...new Set(sends.map(({ hash }) => hash))];
      const after = await alertBookedOf(install, rule);
      expect(atRest(atKill)).toStrictEqual(killCase.atKill);
      expect(hashes).toHaveLength(killCase.sent);
      expect((await landedOf(chain, sends)).toSorted()).toStrictEqual(hashes.toSorted());
      expect([await minedOf(chain, from), await unminedOf(chain, from)]).toStrictEqual([
        killCase.sent,
        0,
      ]);
      expect(sends.length > sendsAtKill).toBe(killCase.isResent);
      expect({
        beforeKill: signedAtKill - before,
        afterRestart: services.signatures() - signedAtKill,
      }).toStrictEqual(killCase.signatures);
      expect(await second.engine.program.exited).toBe(0);
      const [fill] = after.fills;
      expect(after.fills).toHaveLength(1);
      expect(after.alert).toStrictEqual({ ...killCase.alert, intent: fill?.intent });
      expect(after.ruleFills).toBe(killCase.ruleFills);
    });
  },
);
