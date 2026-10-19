import type { ProtocolClient } from "@binference/client";
import { createDeadline } from "@binference/core";
import type { AgentView, ProtocolId } from "@binference/protocol";
import { type ChatTerminal, runTerminalChat } from "@binference/tui";
import { platformOf } from "../compose/engine-locations.js";
import type { AgentFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { ownerFormatter } from "../program/owner-formatter.js";
import { connectEngine, reportUnreachable } from "./connect-engine.js";

// Connecting and picking the agent take at most this long; the chat itself runs until it ends.
const startBudgetMs = 15_000;

/** The agent the owner chats with: its id and its name. */
interface ChatAgent {
  readonly id: ProtocolId<"agent">;
  readonly name: string;
}

function chatAgentOf(view: AgentView): ChatAgent {
  return { id: view.agent, name: view.name };
}

// The agent `--agent` names, the only one, or the one the owner picks; undefined after saying why.
async function pickAgent(
  run: CommandRun,
  client: ProtocolClient,
  named: ProtocolId<"agent"> | undefined,
): Promise<ChatAgent | undefined> {
  const { output, host, formatter } = run;
  const deadline = createDeadline({
    clock: host.clock,
    signal: new AbortController().signal,
    timeoutMs: startBudgetMs,
  });
  try {
    const page = await client.call("agent/list", { limit: 100 }, { signal: deadline.signal });
    const agents = page.items.filter((agent) => agent.archivedAt === undefined);
    const found = named === undefined ? undefined : agents.find((agent) => agent.agent === named);
    if (named !== undefined) {
      if (found === undefined) {
        output.refuse("agent.not_found");
      }
      return found === undefined ? undefined : chatAgentOf(found);
    }
    const [only] = agents;
    if (only === undefined) {
      output.fail({ code: "cli.no_agent", key: "agent.none" });
      return undefined;
    }
    if (agents.length === 1) {
      return chatAgentOf(only);
    }
    if (host.prompter === undefined) {
      const ids = agents.map((agent) => agent.agent);
      const values = { count: agents.length, agents: ids.join(", ") };
      output.fail({
        code: "cli.agent_needed",
        key: "agent.several",
        values,
        details: { agents: ids },
      });
      return undefined;
    }
    const options = agents.map((agent) => ({ value: agent.agent, label: agent.name }));
    const message = formatter.message("cli.chat.pickAgent");
    const picked = await host.prompter.choose({ id: "agent", message, options });
    return chatAgentOf(agents.find((agent) => agent.agent === picked) ?? only);
  } finally {
    deadline.clear();
  }
}

// Chats until the owner leaves or a stop signal arrives; answers 0, or 1 when the engine went away.
async function chat(
  run: CommandRun,
  client: ProtocolClient,
  parts: { readonly agent: ChatAgent; readonly terminal: ChatTerminal },
): Promise<ExitCode> {
  const { host } = run;
  const status = client.status();
  const formatter = status.state === "ready" ? ownerFormatter(status.ready.owner) : run.formatter;
  const stopped = new AbortController();
  const onStop = (): void => stopped.abort();
  const { stopSignals } = platformOf(host);
  stopSignals.forEach((name) => host.signals.on(name, onStop));
  try {
    const how = await runTerminalChat({
      client,
      agent: parts.agent,
      formatter,
      terminal: parts.terminal,
      clock: host.clock,
      signal: stopped.signal,
    });
    return how === "left" ? 0 : 1;
  } finally {
    stopSignals.forEach((name) => host.signals.off(name, onStop));
  }
}

/**
 * `binference chat`: terminal chat with an agent, with the CLI's rights over IPC (decision 0050):
 * the agent `--agent` names, the only one, or the one the owner picks. It needs a terminal on both
 * ends, so `--json`, or input or output that is no terminal, is refused with
 * `cli.chat_needs_terminal`. The words follow the owner's language the engine names. Exits 0 when
 * the owner leaves or a stop signal arrives, 1 when the engine cannot be reached or goes away.
 */
export async function runChat(run: CommandRun, options: AgentFlags): Promise<ExitCode> {
  const { host, output } = run;
  const terminal = host.chatTerminal;
  if (options.json || terminal === undefined) {
    output.fail({ code: "cli.chat_needs_terminal", key: "chat.needsTerminal" });
    return 1;
  }
  const deadline = createDeadline({
    clock: host.clock,
    signal: new AbortController().signal,
    timeoutMs: startBudgetMs,
  });
  const connection = await connectEngine(host, deadline.signal, "tui").finally(() =>
    deadline.clear(),
  );
  if (!connection.ok) {
    return reportUnreachable(output, connection);
  }
  const { client } = connection;
  try {
    const agent = await pickAgent(run, client, options.agent);
    return agent === undefined ? 1 : await chat(run, client, { agent, terminal });
  } finally {
    client.close();
  }
}
