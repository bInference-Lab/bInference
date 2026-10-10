import { type ProtocolId, protocolIdSchema } from "@binference/protocol";
import { type Command, InvalidArgumentError, Option } from "commander";

/** An id of the protocol's kind, or a command line commander refuses with one message. */
export function idOf<K extends "agent" | "intent" | "wallet" | "addressBook">(
  kind: K,
): (value: string) => ProtocolId<K> {
  return (value: string): ProtocolId<K> => {
    const parsed = protocolIdSchema(kind).safeParse(value);
    if (!parsed.success) {
      throw new InvalidArgumentError(`${value} is not a ${kind} id.`);
    }
    return parsed.data;
  };
}

/** Adds the options every command takes, `--json` and `--yes`, and help in the owner's language. */
export function withCommon(command: Command, message: (key: string) => string): Command {
  return command
    .option("--json", message("option.json"))
    .option("--yes", message("option.yes"))
    .helpOption("-h, --help", message("option.help"));
}

/** `--agent <id>`, read as an agent id. */
export function agentOption(message: (key: string) => string): Option {
  return new Option("--agent <id>", message("option.agent")).argParser(idOf("agent"));
}
