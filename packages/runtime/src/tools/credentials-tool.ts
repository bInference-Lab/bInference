import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** The args of `credentials`: one action, with what a request or a deletion names. */
interface CredentialsArgs {
  readonly action: "request" | "list" | "delete";
  readonly name?: string;
  readonly reason?: string;
  readonly allowedHosts?: readonly string[];
  readonly timeoutSeconds?: number;
}

const credentialsArgs: z.ZodType<CredentialsArgs> = z.strictObject({
  action: z.enum(["request", "list", "delete"]),
  name: z.string().exactOptional(),
  reason: z.string().exactOptional(),
  allowedHosts: z.array(z.string()).exactOptional(),
  timeoutSeconds: z.int().exactOptional(),
});

const refusals: Readonly<Record<string, string>> = {
  "protocol.bad_args":
    "Name the credential in capitals, digits and underscores, starting with a letter, as an environment variable is named; hosts are exact lower-case host names such as api.example.com; a reason is at most 300 characters; timeoutSeconds is 30 to 3600.",
  "credential.unavailable": "This engine keeps no credentials. Tell the owner.",
  "credential.not_found": "No credential of that name is stored.",
};

const noName: ToolOutcome = {
  text: "Name the credential: a request and a deletion each name one.",
  isError: true,
};

async function listed(parts: AgentToolParts, signal: AbortSignal): Promise<ToolOutcome> {
  const { items } = await parts.client.call("credential/list", {}, { signal });
  if (items.length === 0) {
    return { text: "No credential is stored.", isError: false };
  }
  const lines = items.map(
    (item) =>
      `${item.name}: hosts ${item.allowedHosts.length === 0 ? "none" : item.allowedHosts.join(", ")}`,
  );
  return {
    text: ["Stored credentials (names and hosts only):", ...lines].join("\n"),
    isError: false,
  };
}

async function requested(
  parts: AgentToolParts,
  args: CredentialsArgs & { readonly name: string },
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const { agent, client, turn } = parts;
  const { name, reason, allowedHosts, timeoutSeconds } = args;
  const asked = await client.call(
    "turn/credential",
    {
      agent,
      session: turn.session,
      turn: turn.turn,
      name,
      ...(reason === undefined ? {} : { reason }),
      ...(allowedHosts === undefined ? {} : { allowedHosts }),
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    },
    { signal },
  );
  const hosts = asked.allowedHosts.length === 0 ? "no host" : asked.allowedHosts.join(", ");
  const text = `The owner now sees a request for ${name} with ${hosts} proposed, and answers it in a masked prompt; the turn ends here. Their answer starts your next turn: stored, or no credential. Never ask for the value in the chat.`;
  return { text, isError: false, endsTurn: true };
}

/**
 * `credentials`, a control tool (decision 0388): `list` reads the stored credentials' names and
 * hosts, never a value; `request` asks the owner for a missing credential with a name, a reason and
 * the exact hosts proposed, which the owner answers in a masked prompt, and ends the turn, the
 * owner's answer starting the next; `delete` removes one. No action writes a value the agent
 * supplies.
 */
export function credentialsTool(parts: AgentToolParts): AgentTool {
  return defineTool({
    name: "credentials",
    kind: "control",
    asksOwner: true,
    description: agentToolTexts.credentials,
    args: credentialsArgs,
    run: async (args, { signal }) =>
      answerOrRefusal({ tool: "credentials", refusals }, async () => {
        if (args.action === "list") {
          return listed(parts, signal);
        }
        const { name } = args;
        if (name === undefined) {
          return noName;
        }
        if (args.action === "request") {
          return requested(parts, { ...args, name }, signal);
        }
        await parts.client.call("credential/delete", { name }, { signal });
        return { text: `Removed the credential ${name}.`, isError: false };
      }),
  });
}
