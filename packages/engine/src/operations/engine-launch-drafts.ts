import { createRunningTurns } from "../chat/running-turns.js";
import { draftLaunch } from "../launches/draft-launch.js";
import { createLaunchDraftDesk, type LaunchDraftDesk } from "../launches/launch-draft-desk.js";
import { createLaunchDraftShelf } from "../launches/launch-draft-shelf.js";
import type { LaunchingMoneyPath } from "../money-path/launching-money-path.js";
import { ownerImagesOf } from "../uploads/owner-images.js";
import { createUploadShelf, type UploadShelf } from "../uploads/upload-shelf.js";
import type { EngineOptions } from "./create-engine.js";
import type { EngineHandler } from "./engine-call.js";

/** The handler of `launch/draft` (decision 0285). */
export interface LaunchDraftHandlers {
  readonly "launch/draft": EngineHandler<"launch/draft">;
}

/** The engine's options with the one record of running turns and the one upload shelf. */
export type DraftingOptions = EngineOptions & {
  readonly turns: NonNullable<EngineOptions["turns"]>;
  readonly uploads: UploadShelf;
};

/**
 * The engine's options with one record of running turns and one upload shelf that every part
 * shares, the draft desk and the chat among them: those the options give, else new ones.
 */
export function withSharedParts(options: EngineOptions): DraftingOptions {
  const { clock, random } = options;
  return {
    ...options,
    turns: options.turns ?? createRunningTurns(),
    uploads: options.uploads ?? createUploadShelf({ clock, random }),
  };
}

/**
 * The agent's launch drafts (decisions 0285 and 0286): `launch/draft`, checked on the money path
 * as a proposal is and kept in memory, and the desk the owner's surfaces show and answer them
 * through, whose Start proposes with the engine's own `intent/propose`. An engine with no launch
 * host drafts nothing: `quote.no_route`.
 */
export function launchDraftsOf(
  options: DraftingOptions,
  parts: {
    readonly moneyPath: LaunchingMoneyPath;
    readonly handlers: { readonly "intent/propose": EngineHandler<"intent/propose"> };
  },
): { readonly handlers: LaunchDraftHandlers; readonly desk: LaunchDraftDesk } {
  const { launchHost: host, stores, chains, clock, random, publish, turns, uploads } = options;
  const shelf = createLaunchDraftShelf();
  const bot = options.botImages === undefined ? {} : { bot: options.botImages };
  const images = ownerImagesOf({ uploads, ...bot });
  const noHost = { picturePlace: () => undefined, pictureBytesFor: () => undefined };
  const launchpads = host ?? noHost;
  const drafting = {
    shelf,
    moneyPath: parts.moneyPath,
    host: launchpads,
    turns,
    agentInbox: stores.agentInbox,
    images,
    clock,
    random,
    publish,
  };
  const desk = createLaunchDraftDesk({
    shelf,
    host: launchpads,
    chains,
    uploads,
    propose: parts.handlers["intent/propose"],
    owners: stores.owners,
    clock,
    publish,
  });
  return { handlers: { "launch/draft": async (call) => draftLaunch(drafting, call) }, desk };
}
