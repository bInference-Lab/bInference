import type { EngineOptions } from "@binference/engine";

/** What the agent's work reaches beyond the engine, as a composition gives it. */
export interface EngineAgentParts {
  /** The agent's shell on this machine (decision 0378); off when absent. */
  readonly shell?: EngineOptions["shell"];
  /** The images the agent views on this machine (decision 0385); none when absent. */
  readonly viewImages?: EngineOptions["viewImages"];
  /** The config file a confirmed config change writes (decision 0393). */
  readonly configChanges?: EngineOptions["configChanges"];
}

/**
 * The engine's options of the parts the agent's work reaches beyond the engine: its shell, the
 * images it views and the config file a confirmed change writes, none when absent.
 */
export function agentPartsOf(
  parts: EngineAgentParts,
): Pick<EngineOptions, "shell" | "viewImages" | "configChanges"> {
  const { shell, viewImages, configChanges } = parts;
  return {
    ...(shell === undefined ? {} : { shell }),
    ...(viewImages === undefined ? {} : { viewImages }),
    ...(configChanges === undefined ? {} : { configChanges }),
  };
}
