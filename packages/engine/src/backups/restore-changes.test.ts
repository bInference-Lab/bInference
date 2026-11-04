import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testLimits, testNowMs } from "../intents/test-intents.js";
import { restoreChanges } from "./restore-changes.js";
import type { AgentGuards, InstallGuards, WalletFacts } from "./restore-guards.js";

const tail = (n: number) => `0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`;
const main = idSchema("agt").parse(`agt_${tail(1)}`);
const other = idSchema("agt").parse(`agt_${tail(2)}`);

const noAccess = {
  tokens: [],
  devices: [],
  webPushSubscriptions: [],
  pairCodes: [],
  miniAppLaunches: [],
  miniAppTickets: [],
};

// An agent's guards as loose as they come: live, auto, send level 0, the test limits.
function agent(agentId: AgentGuards["agentId"], change: Partial<AgentGuards> = {}): AgentGuards {
  return {
    agentId,
    name: agentId === main ? "main" : "other",
    mode: "live",
    approvalMode: "auto",
    sendLevel: { level: 0 },
    limits: { values: testLimits },
    removedAddresses: [],
    ...change,
  };
}

function wallet(n: number, agentId: AgentGuards["agentId"]): WalletFacts {
  const id = idSchema("wal").parse(`wal_${tail(n)}`);
  return { id, agentId, address: `0x${String(n).padStart(40, "0")}`, label: "" };
}

function install(change: Partial<InstallGuards>): InstallGuards {
  return {
    access: noAccess,
    safety: {},
    agents: [agent(main)],
    wallets: [wallet(1, main)],
    outflows: [],
    backups: [],
    ...change,
  };
}

describe("what a restore changes", () => {
  it("names the agents and wallets that leave with it and those that come back", () => {
    const now = install({
      agents: [agent(main), agent(other)],
      wallets: [wallet(1, main), wallet(2, other)],
    });
    const backup = install({ wallets: [wallet(1, main), wallet(3, main)] });
    const changes = restoreChanges(now, backup, testNowMs);
    expect(changes).toMatchObject({
      agentsGone: ["other"],
      agentsBack: [],
      walletsGone: [wallet(2, other)],
      walletsBack: [wallet(3, main)],
    });
    expect(restoreChanges(backup, now, testNowMs)).toMatchObject({ agentsBack: ["other"] });
  });

  it("lists every guard and limit the backup holds stricter, which the restore keeps", () => {
    const strict = agent(main, {
      mode: "paper",
      approvalMode: "manual",
      frozenAtMs: testNowMs - 1,
      archivedAtMs: testNowMs - 1,
      sendLevel: { level: 3 },
      limits: { values: { ...testLimits, perTradeUsdMicros: 1n } },
    });
    const changes = restoreChanges(install({}), install({ agents: [strict] }), testNowMs);
    expect(changes.stricter).toStrictEqual([
      {
        name: "main",
        guards: ["frozen", "archived", "paper", "manual", "sendLevel"],
        limits: ["perTradeUsdMicros"],
      },
    ]);
  });

  it("lists no agent whose guards are as strict now as in the backup", () => {
    const strictNow = install({ agents: [agent(main, { mode: "paper", frozenAtMs: 1 })] });
    const changes = restoreChanges(strictNow, install({}), testNowMs);
    expect(changes.stricter).toStrictEqual([]);
    expect(changes.isFrozen).toBe(false);
  });

  it("says the install will be frozen when only the backup holds it frozen", () => {
    const frozen = install({ safety: { frozenAtMs: testNowMs - 1 } });
    expect(restoreChanges(install({}), frozen, testNowMs).isFrozen).toBe(true);
    expect(restoreChanges(frozen, frozen, testNowMs).isFrozen).toBe(false);
  });

  it("says where the history of the state it replaces ends, when it holds any", () => {
    const active = install({ lastActivityAtMs: testNowMs - 5 });
    expect(restoreChanges(active, install({}), testNowMs).lastActivityAtMs).toBe(testNowMs - 5);
    expect(restoreChanges(install({}), active, testNowMs)).not.toHaveProperty("lastActivityAtMs");
  });
});
