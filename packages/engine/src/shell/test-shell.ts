import { createIdSource, type Result } from "@binference/core";
import type { ManualClock } from "@binference/core/testing";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  type ArgsOf,
  type InboxMessageView,
  inboxMessageViewSchema,
  type ProtocolErrorCode,
  protocolIdSchema,
  type ResultOf,
  type ShellAnswer,
} from "@binference/protocol";
import { createInboxHold } from "../chat/inbox-hold.js";
import {
  createFakeCommandRunner,
  type FakeCommand,
  type FakeCommandRunner,
} from "../fakes/fake-command-runner.js";
import { createMemoryAgentInboxStore } from "../fakes/memory-agent-inbox-store.js";
import { createMemoryAgentStore, type MemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryConfigJournal } from "../fakes/memory-config-journal.js";
import { createMemoryShellStore } from "../fakes/memory-shell-store.js";
import { testAgent, testAgentDraft } from "../intents/test-intents.js";
import type { EngineCaller } from "../operations/engine-call.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { ConfigJournal } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createShellPart, type ShellPart } from "./engine-shell.js";
import type { ShellStore } from "./ports.js";
import type { ShellSettings } from "./shell-policy.js";

/** The settings a test shell starts with: every command runs, none asks. */
export const openShell: ShellSettings = {
  run: "any",
  ask: "never",
  onNoAnswer: "refuse",
  timeoutSeconds: 1800,
  tellOnQuietEnd: false,
};

/** What a test shell is made from. */
export interface TestShellOptions {
  readonly script?: Readonly<Record<string, FakeCommand>>;
  readonly settings?: Partial<ShellSettings>;
  readonly missing?: readonly string[];
  readonly dialect?: "posix" | "powershell";
  /** The store, to start a shell on the rows an earlier one left. */
  readonly store?: ShellStore;
}

type Answer<N extends "shell/run" | "shell/job" | "shell/answer"> = Promise<
  Result<ResultOf<N>, ProtocolErrorCode>
>;

/**
 * A shell over in-memory stores, the fake runner and a manual clock, for one test agent: its
 * calls, the owner's answers, the pushes it made, and the messages that woke the agent.
 */
export interface TestShell {
  readonly clock: ManualClock;
  readonly agents: MemoryAgentStore;
  readonly runner: FakeCommandRunner;
  readonly part: ShellPart;
  readonly pushes: readonly EnginePush[];
  readonly store: ShellStore;
  readonly journal: ConfigJournal;
  /** Changes the settings the shell reads at each call. */
  change(settings: Partial<ShellSettings>): void;
  /** Freezes the test agent. */
  freeze(): void;
  run(args: Omit<ArgsOf<"shell/run">, "agent">): Answer<"shell/run">;
  job(args: Omit<ArgsOf<"shell/job">, "agent">): Answer<"shell/job">;
  answer(request: string, answer: ShellAnswer, caller?: EngineCaller): Answer<"shell/answer">;
  /** The messages that woke the agent, as the runtime reads them. */
  woken(): readonly InboxMessageView[];
  /** The words of each message that woke the agent. */
  wokenTexts(): readonly string[];
  /** The pushes of the agent's chat topic about shell requests. */
  requestPushes(): readonly EnginePush[];
}

function testCallsOf(part: ShellPart): Pick<TestShell, "run" | "job" | "answer"> {
  const { handlers } = part;
  const runtime = testCallers.runtime;
  return {
    run: async (args) => handlers["shell/run"](testCall({ agent: testAgent, ...args }, runtime)),
    job: async (args) => handlers["shell/job"](testCall({ agent: testAgent, ...args }, runtime)),
    answer: async (request, answer, caller = testCallers.cli) => {
      const id = protocolIdSchema("shellRequest").parse(request);
      return handlers["shell/answer"](testCall({ request: id, answer }, caller));
    },
  };
}

// No intent shows in a shell test's messages.
const intentView = async (): Promise<undefined> => Promise.resolve(undefined);

// The chat's parts a test shell wakes the agent through, and the pushes they made.
function wakePartsOf(parts: {
  readonly agents: MemoryAgentStore;
  readonly ids: ReturnType<typeof createIdSource>;
  readonly clock: ManualClock;
}) {
  const { agents, ids, clock } = parts;
  const pushes: EnginePush[] = [];
  const agentInbox = createMemoryAgentInboxStore({ agents });
  const publish = (push: EnginePush): void => {
    pushes.push(push);
  };
  const inboxHold = createInboxHold();
  return { wakeParts: { agents, agentInbox, inboxHold, ids, clock, publish, intentView }, pushes };
}

// What a test reads of the pushes: the agent's wake-ups and the request pushes.
function readsOf(
  pushes: readonly EnginePush[],
): Pick<TestShell, "woken" | "wokenTexts" | "requestPushes"> {
  const woken = () =>
    pushes
      .filter((push) => push.topic === "inbox")
      .map((push) => inboxMessageViewSchema.parse(push.data));
  return {
    woken,
    wokenTexts: () => woken().flatMap((view) => (view.kind === "inbox/message" ? [view.text] : [])),
    requestPushes: () => pushes.filter((push) => push.kind.startsWith("chat/shellRequest")),
  };
}

/** Creates a {@link TestShell}. */
export async function createTestShell(options: TestShellOptions = {}): Promise<TestShell> {
  const clock = createManualClock(Date.UTC(2026, 10, 11, 12));
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft({}), testCall({}));
  const ids = createIdSource({ clock, random: createSeededRandom(5) });
  const { script, missing, dialect } = options;
  const runner = createFakeCommandRunner({
    ...(script === undefined ? {} : { script }),
    folders: ["/home/owner", "/srv/project"],
    ...(missing === undefined ? {} : { missing }),
    ...(dialect === undefined ? {} : { dialect }),
  });
  const settings = { current: { ...openShell, ...options.settings } };
  const store = options.store ?? createMemoryShellStore();
  const journal = createMemoryConfigJournal();
  const { wakeParts, pushes } = wakePartsOf({ agents, ids, clock });
  const shell = { runner, settings: () => settings.current };
  const part = createShellPart({ shell, store, journal, wakeParts });
  return {
    clock,
    agents,
    runner,
    part,
    pushes,
    store,
    journal,
    change: (change) => {
      settings.current = { ...settings.current, ...change };
    },
    freeze: () => {
      const version = agents.agentNow(testAgent)?.version ?? 0;
      agents.freezeNow([{ agentId: testAgent, expectedVersion: version }], {
        atMs: clock.now(),
        isFrozen: true,
      });
    },
    ...testCallsOf(part),
    ...readsOf(pushes),
  };
}
