import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { InboxMessageView } from "@binference/protocol";
import type { EngineChat } from "../relay/ports.js";

/** An engine with one active agent, the runtime's side of its chat, and the owner's side. */
export interface EngineChatSubject {
  readonly chat: EngineChat;
  /** The active agent; `unknownAgent` names none the engine holds. */
  readonly agent: Id<"agt">;
  readonly unknownAgent: Id<"agt">;
  /** `chat/post` from the owner: the session and the turn the engine reserved. */
  readonly post: (
    text: string,
  ) => Promise<{ readonly session: Id<"ses">; readonly turn: Id<"trn"> }>;
  /** `chat/stop` from the owner. */
  readonly stop: () => Promise<void>;
  /** `chat/clear` from the owner: the session that follows. */
  readonly clear: () => Promise<Id<"ses">>;
  /** The kinds pushed on the agent's chat topic, once the push of a turn's end was seen. */
  readonly chatSeen: () => Promise<readonly string[]>;
}

/** Makes a fresh subject for each check. */
export interface EngineChatHarness {
  create(): Promise<EngineChatSubject>;
}

const live = (): AbortSignal => new AbortController().signal;

async function untaken(chat: EngineChat): Promise<readonly InboxMessageView[]> {
  const items: InboxMessageView[] = [];
  for (let cursor: string | undefined; ;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the one before
    const page = await chat.listInbox(cursor, live());
    items.push(...page.items);
    cursor = page.next;
    if (cursor === undefined) {
      return items;
    }
  }
}

async function postedMessage(subject: EngineChatSubject, text: string) {
  const posted = await subject.post(text);
  const found = (await untaken(subject.chat)).find(
    (view) => view.kind === "inbox/message" && view.text === text,
  );
  assert.ok(found?.kind === "inbox/message");
  return { posted, message: found };
}

async function listsUntilTaken(harness: EngineChatHarness): Promise<void> {
  const subject = await harness.create();
  const { posted, message } = await postedMessage(subject, "list me");
  assert.deepEqual(
    [message.agent, message.session, message.turn],
    [subject.agent, posted.session, posted.turn],
  );
  await subject.chat.takeInbox([message.message], live());
  const ids = (await untaken(subject.chat)).map((view) => view.message);
  assert.ok(!ids.includes(message.message));
}

async function pushesToWatcher(harness: EngineChatHarness): Promise<void> {
  const subject = await harness.create();
  const seen = { resolve: (_view: InboxMessageView): void => undefined };
  const pushed = new Promise<InboxMessageView>((resolve) => {
    seen.resolve = resolve;
  });
  const unwatch = subject.chat.watchInbox({
    onMessage: (view) => {
      if (view.kind === "inbox/message" && view.text === "push me") {
        seen.resolve(view);
      }
    },
    refetch: async () => Promise.resolve(),
  });
  try {
    await subject.post("push me");
    assert.equal((await pushed).agent, subject.agent);
  } finally {
    unwatch();
  }
}

async function runsATurn(harness: EngineChatHarness): Promise<void> {
  const subject = await harness.create();
  const { chat, agent } = subject;
  const { posted, message } = await postedMessage(subject, "run a turn");
  await chat.takeInbox([message.message], live());
  const at = { agent, turn: posted.turn };
  const start = {
    ...at,
    session: posted.session,
    messages: [message.message],
    outsideContent: false,
  };
  const started = await chat.startTurn(start, live());
  assert.equal(started.started && typeof started.budgetLeftMicros, "bigint");
  await chat.markTurn(at, live());
  await chat.sayTurn({ ...at, session: posted.session, text: "Done.", final: true }, live());
  await chat.turnStatus({ ...at, statusKey: "turn.stopped" }, live());
  await chat.endTurn({ ...at, outcome: "ok" }, live());
  assert.deepEqual(await subject.chatSeen(), [
    "chat/turnStarted",
    "chat/message",
    "chat/status",
    "chat/turnEnded",
  ]);
}

async function refusesUnknownAgent(harness: EngineChatHarness): Promise<void> {
  const subject = await harness.create();
  const { posted, message } = await postedMessage(subject, "nobody");
  const start = {
    agent: subject.unknownAgent,
    session: posted.session,
    turn: posted.turn,
    messages: [message.message],
    outsideContent: false,
  };
  assert.deepEqual(await subject.chat.startTurn(start, live()), {
    started: false,
    refusal: "not_found",
  });
}

async function listsStopAndClear(harness: EngineChatHarness): Promise<void> {
  const subject = await harness.create();
  await subject.stop();
  const next = await subject.clear();
  const kinds = (await untaken(subject.chat)).flatMap((view) => {
    if (view.kind === "inbox/stop") {
      return [`stop ${view.reason}`];
    }
    return view.kind === "inbox/clear" ? [`clear ${view.next === next ? "next" : "other"}`] : [];
  });
  assert.deepEqual(kinds, ["stop owner", "clear next"]);
}

/**
 * The contract every {@link EngineChat} keeps (runtime spec, sections 3.2 and 4.3): the owner's
 * messages wait in the inbox until taken and reach a watcher, a turn starts, takes its mark, text
 * and status, and ends on the agent's chat topic, an unknown agent's turn is refused, and stops
 * and clears reach the runtime.
 */
export function engineChatContract(harness: EngineChatHarness): readonly ContractCheck[] {
  return [
    {
      name: "lists an owner's message until the runtime takes it",
      run: async () => listsUntilTaken(harness),
    },
    {
      name: "pushes an owner's message to the inbox watcher",
      run: async () => pushesToWatcher(harness),
    },
    {
      name: "starts, marks, says, sets the status of and ends a turn on the chat topic",
      run: async () => runsATurn(harness),
    },
    {
      name: "refuses to start a turn of an unknown agent",
      run: async () => refusesUnknownAgent(harness),
    },
    { name: "lists the owner's stop and clear", run: async () => listsStopAndClear(harness) },
  ];
}
