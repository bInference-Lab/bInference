import { join } from "node:path";
import { createIdSource, type Id, idSchema } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { EngineCaller, EnginePush } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { createMemoryConfigJournal } from "@binference/engine/testing";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import type { ArgsOf, OperationName, ResultOf } from "@binference/protocol";
import { z } from "zod";
import { noPermissions } from "../e2e/test-host.js";
import { createAcceptedSkills } from "../skills/accepted-skills.js";
import { skillText, writeFiles } from "../skills/skill-fixtures.js";
import { createSkillShelf, type SkillShelf } from "../skills/skill-shelf.js";
import { createProposalStore } from "./proposal-store.js";
import { createSkillReviewHandlers, tellWaiting } from "./skill-review.js";

// A test rig of the skill review over a temporary state folder (decision 0408).

/** The test's agent. */
export const rigAgent: Id<"agt"> = idSchema("agt").parse(
  "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
);

/** The agent runtime in a turn that read no outside content. */
export const cleanTurn: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000009",
  client: { kind: "runtime", version: "test" },
  scopes: ["read", "propose", "agent"],
  transport: "ipc",
  turn: { hasOutsideContent: false },
};

/** The owner at the terminal. */
export const ownerAtCli: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
  transport: "ipc",
};

/** Where the rig keeps its state. */
interface RigFolders {
  readonly folder: TempFolder;
  readonly workspace: string;
  readonly review: string;
  readonly bundled: string;
  readonly installed: string;
}

/** The rig: its folders, what it published, its journal and its handlers. */
export interface ReviewRig extends RigFolders {
  readonly shelf: SkillShelf;
  readonly pushes: EnginePush[];
  readonly journal: ReturnType<typeof createMemoryConfigJournal>;
  /** Calls one operation's handler and answers its result, or throws its error code. */
  call<N extends OperationName>(
    name: N,
    args: ArgsOf<N>,
    caller?: EngineCaller,
  ): Promise<ResultOf<N>>;
  /** Calls one operation's handler and answers the error code it refused with. */
  refusal<N extends OperationName>(
    name: N,
    args: ArgsOf<N>,
    caller?: EngineCaller,
  ): Promise<string>;
}

async function answer<N extends OperationName>(
  handlers: EngineHandlerTable,
  call: { readonly name: N; readonly args: ArgsOf<N>; readonly caller: EngineCaller },
) {
  const handler = handlers[call.name];
  if (handler === undefined) {
    throw new Error(`No handler for ${call.name}.`);
  }
  return handler({ args: call.args, caller: call.caller, signal: AbortSignal.timeout(20_000) });
}

/** Writes the agent's workspace skill of this name, as a person or the agent's shell would. */
export async function writeWorkspaceSkill(
  rig: Pick<ReviewRig, "workspace">,
  name: string,
  files: Readonly<Record<string, string>> = { "SKILL.md": skillText(name) },
): Promise<void> {
  await writeFiles(join(rig.workspace, rigAgent, "skills", name), files);
}

async function rigFolders(seeded: readonly string[]): Promise<RigFolders> {
  const folder = await createTempFolder("bnf-review-");
  const state = join(folder.path, "state");
  const workspace = join(state, "workspace");
  const bundled = join(folder.path, "package", "skills");
  await writeFiles(bundled, { "safe-swap/SKILL.md": skillText("safe-swap") });
  for (const name of seeded) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a few test skills, one after another
    await writeWorkspaceSkill({ workspace }, name);
  }
  const review = join(state, "skill-review");
  return { folder, workspace, review, bundled, installed: join(state, "skills") };
}

const agentName = async (): Promise<string> => Promise.resolve("main");

function rigHandlers(folders: RigFolders, publish: (push: EnginePush) => void) {
  const { workspace, review } = folders;
  const clock = createManualClock(1_767_261_610_000);
  const random = { bytes: (length: number) => crypto.getRandomValues(new Uint8Array(length)) };
  const logger = createMemoryLogger({ subsystem: "skills" });
  const permissions = noPermissions;
  const accepted = createAcceptedSkills({ folder: review, workspace, permissions, clock, logger });
  const shelf = createSkillShelf({
    folders: { bundled: [folders.bundled], installed: folders.installed, workspace },
    startedAtMs: clock.now(),
    logger,
    accepted,
    onWaiting: tellWaiting({ accepted, agentName, publish }),
  });
  const journal = createMemoryConfigJournal();
  const handlers = createSkillReviewHandlers({
    shelf,
    accepted,
    proposals: createProposalStore({ folder: join(review, "proposals"), permissions }),
    apply: { workspace, review, permissions, random },
    clock,
    ids: createIdSource({ clock, random }),
    agentName,
    journal: { journal, publish },
  });
  return { shelf, journal, handlers };
}

/**
 * A rig over a fresh state folder with the bundled skill `safe-swap`, the agent named `main`, and
 * the workspace skills `seeded` there when the shelf first reads.
 */
export async function reviewRig(seeded: readonly string[] = []): Promise<ReviewRig> {
  const folders = await rigFolders(seeded);
  const pushes: EnginePush[] = [];
  const { shelf, journal, handlers } = rigHandlers(folders, (push) => {
    pushes.push(push);
  });
  return {
    ...folders,
    shelf,
    pushes,
    journal,
    async call(name, args, caller = cleanTurn) {
      const result = await answer(handlers, { name, args, caller });
      if (!result.ok) {
        throw new Error(`${name} refused: ${result.error}`);
      }
      return result.value;
    },
    async refusal(name, args, caller = cleanTurn) {
      const result = await answer(handlers, { name, args, caller });
      if (result.ok) {
        throw new Error(`${name} was not refused.`);
      }
      return result.error;
    },
  };
}

/** The keys of the notices the rig published, in order. */
export function noticeKeys(rig: Pick<ReviewRig, "pushes">): readonly string[] {
  return rig.pushes.flatMap((push) => {
    const notice = z.object({ key: z.string() }).safeParse(push.data);
    return push.kind === "notice/new" && notice.success ? [notice.data.key] : [];
  });
}
