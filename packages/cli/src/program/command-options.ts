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

/** Collects each `--set key=value` in the order given. */
export function addSet(value: string, earlier: readonly string[]): readonly string[] {
  return [...earlier, value];
}

const lifetimeUnits = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

// The longest lifetime in the largest unit that divides it: `90d`, `24h`.
function lifetimeText(ms: number): string {
  return ms % lifetimeUnits.d === 0
    ? `${String(ms / lifetimeUnits.d)}d`
    : `${String(ms / lifetimeUnits.h)}h`;
}

/**
 * `--ttl <duration>`, read in milliseconds: a whole number of minutes, hours or days (`30m`, `1h`,
 * `7d`), from 1 minute to `maxMs`.
 */
export function ttlOption(description: string, maxMs: number): Option {
  return new Option("--ttl <duration>", description).argParser((value: string): number => {
    const parts = /^(?<count>[1-9]\d{0,5})(?<unit>[mhd])$/.exec(value)?.groups;
    const unit = parts?.["unit"];
    const ms =
      unit === "m" || unit === "h" || unit === "d"
        ? Number(parts?.["count"]) * lifetimeUnits[unit]
        : undefined;
    if (ms === undefined || ms > maxMs) {
      throw new InvalidArgumentError(
        `--ttl takes a whole number of minutes, hours or days, such as 30m, 1h or 7d, from 1m to ${lifetimeText(maxMs)}.`,
      );
    }
    return ms;
  });
}
