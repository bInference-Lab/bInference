import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import type { AllowedCommandRecord } from "./shell-records.js";

/** The notice that commands are allowed always (spec 4, section 4.5; decision 0409). */
const shellAllowedKey = "notice.shellAllowed";

/** The notice that an allowed command was removed (spec 4, section 4.5; decision 0409). */
const shellDisallowedKey = "notice.shellDisallowed";

/**
 * The notice that announces the commands an Always allow kept, all in one folder, and the surface
 * the owner answered on. Allowed commands are install-wide, so it names no agent.
 */
export function shellAllowedNotice(kept: readonly AllowedCommandRecord[], by: string): EnginePush {
  const values = {
    count: String(kept.length),
    by,
    folder: kept[0]?.folder ?? "",
    commands: kept.map((each) => each.text).join("; "),
  };
  return noticePush({ key: shellAllowedKey, values });
}

/** The notice that announces a removed allowed command, and the surface it was removed on. */
export function shellDisallowedNotice(removed: AllowedCommandRecord, by: string): EnginePush {
  const values = { by, command: removed.text, folder: removed.folder };
  return noticePush({ key: shellDisallowedKey, values });
}
