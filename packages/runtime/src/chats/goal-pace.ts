import type { Id } from "@binference/core";
import { type ChatSurface, chatSurfaceSchema, type InboxMessageView } from "@binference/protocol";
import type { QueuedMessage } from "@binference/store";
import type { GoalDesk } from "../goals/goal-desk.js";
import { type GoalTurnEnd, stepAfterTurn } from "../goals/goal-rules.js";
import { goalFactLine } from "../goals/goal-words.js";
import type { TurnReport } from "../loop/chat-turn.js";
import type { TurnRefusal } from "../loop/turn-records.js";
import type { GoalLineReader } from "../loop/turn-tail.js";
import type { ChatContext } from "./chat-context.js";
import { dropMessages } from "./drop-messages.js";
import { isGoalTurn, startsTurns, surfaceOf } from "./queued-view.js";

/** A waiting message as a turn takes it: the message, and its reserved turn when it starts one. */
interface Taken {
  readonly queued: QueuedMessage;
  readonly turn?: Id<"trn">;
}

/** A chat: its agent and session. */
interface Chat {
  readonly agent: Id<"agt">;
  readonly session: Id<"ses">;
}

/** How a turn of a chat ended, as the chat's goal reads it. */
interface EndedTurn extends Chat {
  readonly report: TurnReport;
  readonly refusal: Exclude<TurnRefusal, "unavailable"> | undefined;
  readonly taken: readonly Taken[];
}

/** Where the next goal turn asks to run: its chat, the surface it names, and its mark. */
interface NextGoalTurn extends Chat {
  readonly surface?: ChatSurface;
  readonly outside: boolean;
  readonly waitMs: number;
}

async function goalWaiting(context: ChatContext, session: Id<"ses">) {
  const waiting = await context.stores.queue.waiting(
    { sessionId: session, limit: 200 },
    { signal: context.lifetime },
  );
  return waiting.filter((message) => startsTurns(message.kind));
}

// Drops the session's waiting words of a goal turn: its goal no longer runs.
async function dropGoalTurns(context: ChatContext, session: Id<"ses">, reason: string) {
  const waiting = await goalWaiting(context, session);
  const goals = waiting.filter((message) => isGoalTurn(message)).map(({ message }) => message);
  await dropMessages(context, goals, reason);
}

/** Ends the wait for the agent's next goal turn, if one waits. */
export function cancelWait(context: ChatContext, agent: Id<"agt">): void {
  context.chats.goalWaits.get(agent)?.abort();
  context.chats.goalWaits.delete(agent);
}

// The surface a goal turn names: the last turn's, else where the session began, else the console.
async function surfaceFor(context: ChatContext, next: NextGoalTurn): Promise<ChatSurface> {
  if (next.surface !== undefined) {
    return next.surface;
  }
  const session = await context.stores.sessions.get(next.session, { signal: context.lifetime });
  const read = chatSurfaceSchema.safeParse(session?.surface);
  return read.success ? read.data : "console";
}

// The chat rests: the runtime goes on, no turn of the agent runs, no message waits to start one,
// and the chat is still the agent's open one.
async function rests(context: ChatContext, chat: Chat): Promise<boolean> {
  const { chats } = context;
  const open = chats.sessions.get(chat.agent);
  const isOther = open !== undefined && open !== chat.session;
  if (context.state.has("stopped") || chats.running.has(chat.agent) || isOther) {
    return false;
  }
  return (await goalWaiting(context, chat.session)).length === 0;
}

// Asks for the next goal turn once the chat rests, while its goal still runs with budget left.
async function requestIfIdle(context: ChatContext, desk: GoalDesk, next: NextGoalTurn) {
  if (!(await rests(context, next))) {
    return;
  }
  const { goal } = await desk.read(next.session, context.lifetime);
  if (goal?.status !== "active") {
    return;
  }
  const left = context.budgets?.leftOf(next.agent);
  if (left !== undefined && left <= 0n) {
    await desk.pause(next, "budget", context.lifetime);
    return;
  }
  const surface = await surfaceFor(context, next);
  const asked = await desk.request(goal, { surface, outside: next.outside }, context.lifetime);
  if (asked === "frozen") {
    await desk.pause(next, "frozen", context.lifetime);
  }
}

// The next goal turn, now or once its wait ends; a newer one, or a stop, ends a wait.
function schedule(context: ChatContext, desk: GoalDesk, next: NextGoalTurn): void {
  cancelWait(context, next.agent);
  const waited = new AbortController();
  context.chats.goalWaits.set(next.agent, waited);
  const ask = async (): Promise<void> => {
    if (context.chats.goalWaits.get(next.agent) === waited) {
      context.chats.goalWaits.delete(next.agent);
    }
    await context.serial(async () => requestIfIdle(context, desk, next));
  };
  if (next.waitMs <= 0) {
    context.track(ask());
    return;
  }
  // The wait itself is no open work: the runner rests while it sleeps, as a paused chat does.
  const signal = AbortSignal.any([context.lifetime, waited.signal]);
  void context.clock.sleep(next.waitMs, signal).then(
    () => context.track(ask()),
    () => undefined,
  );
}

function endOf(context: ChatContext, ended: EndedTurn): GoalTurnEnd {
  const { report, refusal, taken, agent } = ended;
  const goalTurn = taken.some(({ queued }) => isGoalTurn(queued));
  const atMs = context.clock.now();
  if (report.state === "refused") {
    const budgetSpent = refusal === "budget";
    return { goalTurn, outcome: "refused", budgetSpent, toolCalls: 0, spentMicros: 0n, atMs };
  }
  const left = context.budgets?.leftOf(agent);
  const failed = report.failedTool === undefined ? {} : { failedTool: report.failedTool };
  return {
    goalTurn,
    outcome: report.outcome,
    budgetSpent: left !== undefined && left <= 0n,
    toolCalls: report.toolCalls,
    spentMicros: report.spentMicros,
    atMs,
    ...failed,
  };
}

/**
 * Counts a turn that ended, or that the engine refused, on its chat's goal (decision 0407), then
 * asks for the next goal turn while the goal is active, at once or after its wait; a goal that
 * paused for a limit drops the goal turns that waited. A chat with no goal does nothing.
 */
export async function afterGoalTurn(context: ChatContext, ended: EndedTurn): Promise<void> {
  const desk = context.goals;
  const goal = await desk?.read(ended.session, context.lifetime);
  if (desk === undefined || goal?.goal === undefined) {
    return;
  }
  const step = stepAfterTurn(goal.goal, endOf(context, ended));
  await desk.write(goal.goal, step, context.lifetime);
  if (step.next.status !== "active") {
    await dropGoalTurns(context, ended.session, "goal_paused");
    return;
  }
  if (step.after === "stop") {
    return;
  }
  const waitMs = step.after === "continue" ? 0 : step.after.waitMs;
  const surface = surfaceOf(ended.taken.map(({ queued }) => queued));
  const outside = ended.report.state === "ended" && ended.report.outside;
  const at = { agent: ended.agent, session: ended.session, outside, waitMs };
  schedule(context, desk, surface === undefined ? at : { ...at, surface });
}

/**
 * The messages a turn may start with (decision 0407): the owner's messages go first, so the words
 * of a goal turn taken with any of them are dropped, and only one goal turn's words start a turn,
 * while the chat's goal is active.
 */
export async function admitGoalTurns<T extends Taken>(
  context: ChatContext,
  session: Id<"ses">,
  taken: readonly T[],
): Promise<readonly T[]> {
  const goals = taken.filter(({ queued }) => isGoalTurn(queued));
  if (goals.length === 0) {
    return taken;
  }
  const others = taken.filter(({ queued }) => !isGoalTurn(queued));
  if (others.some(({ turn }) => turn !== undefined)) {
    await dropMessages(
      context,
      goals.map(({ queued }) => queued.message),
      "owner_first",
    );
    return others;
  }
  const read = await context.goals?.read(session, context.lifetime);
  const [first, ...rest] = goals;
  if (read?.goal?.status !== "active" || first === undefined) {
    await dropMessages(
      context,
      goals.map(({ queued }) => queued.message),
      "goal_paused",
    );
    return others;
  }
  await dropMessages(
    context,
    rest.map(({ queued }) => queued.message),
    "replaced",
  );
  return [...others, first];
}

/**
 * A stop pauses the chat's goal (decision 0407): the owner's `/stop` as `stopped`, a freeze as
 * `frozen`; a clear forgets the goal and the progress note of the chat it closes. Either ends the
 * wait for the next goal turn.
 */
export async function goalStopped(
  context: ChatContext,
  view: Extract<InboxMessageView, { readonly kind: "inbox/stop" | "inbox/clear" }>,
): Promise<void> {
  cancelWait(context, view.agent);
  const desk = context.goals;
  if (desk === undefined) {
    return;
  }
  const chat = { agent: view.agent, session: view.session };
  if (view.kind === "inbox/clear") {
    await desk.forget(chat, context.lifetime);
    return;
  }
  await desk.pause(chat, view.reason === "owner" ? "stopped" : "frozen", context.lifetime);
}

/**
 * Follows a change of a chat's goal from outside a turn, such as the owner's `/goal` (decision
 * 0407): an active goal asks for its next goal turn once the chat rests, and any other ends the
 * wait and drops the goal turns that waited.
 */
export async function followGoal(context: ChatContext, chat: Chat): Promise<void> {
  const desk = context.goals;
  const read = await desk?.read(chat.session, context.lifetime);
  if (desk === undefined || read?.goal?.status !== "active") {
    cancelWait(context, chat.agent);
    await dropGoalTurns(context, chat.session, "goal_paused");
    return;
  }
  schedule(context, desk, { ...chat, outside: false, waitMs: 0 });
}

/**
 * The turn's reader of its chat's goal line (decision 0407), read again before each model call so
 * a call after `goal_update` names the goal as it now stands; none when the runtime keeps no goals.
 */
export function goalLineOf(
  context: ChatContext,
  session: Id<"ses">,
): { readonly goalLine?: GoalLineReader } {
  const desk = context.goals;
  if (desk === undefined) {
    return {};
  }
  const goalLine = async (signal: AbortSignal): Promise<string | undefined> => {
    const { goal } = await desk.read(session, signal);
    return goal === undefined ? undefined : goalFactLine(goal);
  };
  return { goalLine };
}
