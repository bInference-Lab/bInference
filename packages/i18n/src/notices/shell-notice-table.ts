import type { WrittenNotice } from "./write-notice.js";

/**
 * One notice of each shell key of spec 4, section 4.5, as the engine publishes it: the commands an
 * Always allow kept, and an allowed command removed (decision 0409). They name no agent.
 */
export const shellNoticeTable: Readonly<Record<string, WrittenNotice>> = {
  "notice.shellAllowed": {
    key: "notice.shellAllowed",
    values: {
      count: "2",
      by: "telegram",
      folder: "/srv/project",
      commands: "git log -1; head -n 3",
    },
  },
  "notice.shellDisallowed": {
    key: "notice.shellDisallowed",
    values: { by: "cli", command: "git status", folder: "/srv/project" },
  },
};
