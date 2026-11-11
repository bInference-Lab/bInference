import { join } from "node:path";
import { createIdSource, type Id } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { createProposalStore } from "../skill-review/proposal-store.js";
import { createSkillReviewHandlers, tellWaiting } from "../skill-review/skill-review.js";
import { createAcceptedSkills } from "../skills/accepted-skills.js";
import { bundledSkillRoots } from "../skills/bundled-roots.js";
import { createSkillShelf } from "../skills/skill-shelf.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { createSkillOperations } from "./skill-operations.js";

/**
 * The skill operations of the self-hosted engine: the package's bundled skills, the state folder's
 * `skills/` with installs worked on in `skill-work/` beside it, and each agent's
 * `workspace/<agent>/skills/`, which load only at a folder hash the owner accepted; and the skill
 * proposals in `skill-review/` (decision 0408). An install's end and every notice go to `publish`;
 * an apply and an accept are journaled.
 */
export function composeSkillOperations(
  opening: Opening,
  opened: Opened,
  publish: PublishPush,
): EngineHandlerTable {
  const { platform, host, closers } = opening;
  const { root, workspace } = platform.stateFolder;
  const { clock, random } = host;
  const { permissions } = platform;
  const logger = opened.log.logger.child("skills");
  const review = join(root, "skill-review");
  const folders = { installed: join(root, "skills"), staging: join(root, "skill-work") };
  const accepted = createAcceptedSkills({ folder: review, workspace, permissions, clock, logger });
  const agentName = async (agent: Id<"agt">, signal: AbortSignal) =>
    (await opened.stores.agents.get(agent, { signal }))?.agent.name;
  const shelf = createSkillShelf({
    folders: { bundled: bundledSkillRoots, installed: folders.installed, workspace },
    startedAtMs: clock.now(),
    logger,
    accepted,
    onWaiting: tellWaiting({ accepted, agentName, publish }),
  });
  const proposals = createProposalStore({ folder: join(review, "proposals"), permissions });
  return {
    ...createSkillOperations({
      shelf,
      folders,
      permissions,
      clock,
      random,
      publish,
      closers,
      logger,
      proxy: () => opened.proxy.current(),
    }),
    ...createSkillReviewHandlers({
      shelf,
      accepted,
      proposals,
      apply: { workspace, review, permissions, random },
      clock,
      ids: createIdSource({ clock, random }),
      agentName,
      journal: { journal: opened.stores.configJournal, publish },
    }),
  };
}
