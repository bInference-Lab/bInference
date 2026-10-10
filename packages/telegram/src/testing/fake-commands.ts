import { err, type JsonValue, ok, type Result } from "@binference/core";
import { z } from "zod";

/** One command of a bot's menu, as `setMyCommands` sets it. */
export interface FakeCommand {
  readonly command: string;
  readonly description: string;
}

/** A menu the bot set: its scope's type, its language, and its commands in order. */
export interface FakeMenu {
  /** `default` when the call named no scope. */
  readonly scope: string;
  /** Absent for the menu of every language without its own. */
  readonly languageCode?: string;
  readonly commands: readonly FakeCommand[];
}

/** The bot's command menus, as the Bot API keeps them. */
export interface FakeMenus {
  /** Answers `setMyCommands` with Telegram's checks, or the description of its 400. */
  setMyCommands(body: string): Result<JsonValue, string>;
  /** Every menu set, each scope and language once, the last set winning. */
  menus(): readonly FakeMenu[];
}

// The Bot API's limits on `setMyCommands` and `BotCommand`.
const maxCommands = 100;
const maxDescriptionLength = 256;
const commandName = /^[a-z0-9_]{1,32}$/;
const scopeTypes = [
  "default",
  "all_private_chats",
  "all_group_chats",
  "all_chat_administrators",
  "chat",
  "chat_administrators",
  "chat_member",
] as const;

const setSchema = z.looseObject({
  commands: z.array(z.looseObject({ command: z.string(), description: z.string() })),
  scope: z.looseObject({ type: z.enum(scopeTypes) }).optional(),
  language_code: z.string().optional(),
});

function problemOf(call: z.output<typeof setSchema>): string | undefined {
  if (call.commands.length > maxCommands) {
    return "Bad Request: BOT_COMMANDS_TOO_MUCH";
  }
  if (call.language_code !== undefined && !/^[a-z]{2}$/.test(call.language_code)) {
    return "Bad Request: invalid language code specified";
  }
  const isValid = call.commands.every(
    ({ command, description }) =>
      commandName.test(command) &&
      description.length >= 1 &&
      description.length <= maxDescriptionLength,
  );
  return isValid ? undefined : "Bad Request: BOT_COMMAND_INVALID";
}

/** Creates a bot's empty command menus. */
export function createFakeMenus(): FakeMenus {
  const menus = new Map<string, FakeMenu>();
  return {
    setMyCommands(body) {
      const call = setSchema.safeParse(JSON.parse(body));
      if (!call.success) {
        return err("Bad Request: wrong parameters");
      }
      const problem = problemOf(call.data);
      if (problem !== undefined) {
        return err(problem);
      }
      const scope = call.data.scope?.type ?? "default";
      const language = call.data.language_code;
      menus.set(`${scope} ${language ?? ""}`, {
        scope,
        ...(language === undefined ? {} : { languageCode: language }),
        commands: call.data.commands.map(({ command, description }) => ({ command, description })),
      });
      return ok(true);
    },
    menus: () => [...menus.values()],
  };
}
