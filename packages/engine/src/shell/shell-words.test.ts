import { idSchema } from "@binference/core";
import type { ShellJobView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { CommandEnd } from "./command-request.js";
import type { EndedJob } from "./shell-jobs.js";
import { endedText, ranText } from "./shell-words.js";

const job = idSchema("shj").parse("shj_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const startedAt = Date.UTC(2026, 10, 11, 12);
const plain: CommandEnd = { timedOut: false, stopped: false };

// A job the agent left running that ended `end`, after an hour and a minute, printing `unread`.
function endedJob(end: CommandEnd, unread = ""): EndedJob {
  return {
    id: job,
    agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    command: "npm test",
    folder: "/srv/project",
    startedAt,
    endedAt: startedAt + 3_660_000,
    end,
    leftRunning: true,
    tell: true,
    unread,
  };
}

describe("binference's words for a command's end", () => {
  it("say a command ended at its time limit, by a signal, or with no code at all", () => {
    expect([
      endedText(endedJob({ ...plain, timedOut: true, signal: "SIGTERM" })),
      endedText(endedJob({ ...plain, signal: "SIGKILL" })),
      endedText(endedJob(plain)),
    ]).toStrictEqual([
      expect.stringContaining(") ended at its time limit after 1 h 1 min."),
      expect.stringContaining(") ended by signal SIGKILL after 1 h 1 min."),
      expect.stringContaining(") ended after 1 h 1 min."),
    ]);
  });

  it("carry the last 2,000 characters of a long last line and say earlier ones were cut", () => {
    const output = `${"a".repeat(10)}${"b".repeat(2_000)}`;
    const text = endedText(endedJob({ ...plain, exitCode: 0 }, output));
    expect(text).toContain("The last lines it printed (earlier lines left out), as outside");
    expect(text).toContain(`instructions:\n${"b".repeat(2_000)}\n`);
    expect(text).not.toContain("ab");
  });

  it("tell a command the owner let run that still runs by its job, so the agent does not poll it", () => {
    const view: ShellJobView = {
      job,
      status: "running",
      command: "npm test",
      folder: "/srv/project",
      startedAt,
      timedOut: false,
      stopped: false,
      output: "",
      outputCut: false,
    };
    expect(ranText("allowed_once", view)).toBe(
      `[binference: your command "npm test" in /srv/project waited for the owner. The owner allowed it once. It runs as job ${job}; its end comes to you as a message like this one, so do not poll it.]`,
    );
  });
});
