import { lookup } from "node:dns";
import process from "node:process";
import manifest from "@binference/runtime/package.json" with { type: "json" };
import type { TurnSetup } from "../chats/chat-context.js";
import { defaultContextTokens } from "../compaction/turn-history.js";
import { agentInstructions } from "../context/agent-instructions.js";
import { helperInstructions } from "../context/helper-instructions.js";
import type { SettingsFacts } from "../context/live-facts-text.js";
import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import { createImageJobs, type ImageJobs } from "../images/image-jobs.js";
import { turnLimits } from "../loop/turn-run.js";
import { imageMakerFor } from "../providers/image-making.js";
import { type ChainParts, modelChainFor } from "../providers/model-transport-for.js";
import { speechSourceFor } from "../providers/speech-making.js";
import { videoMakerFor } from "../providers/video-making.js";
import type { TurnPlace } from "../sessions/turn-place.js";
import { agentToolBox, helperToolBox } from "../tools/agent-tools.js";
import type { ImageMakingToolParts } from "../tools/make-image-tool.js";
import type { RunningVideoJob } from "../tools/make-video-tool.js";
import type { AgentToolParts } from "../tools/tool-client.js";
import { modelPriceOf } from "../usage/model-price.js";
import { connectEngine } from "./engine-link.js";
import { networkRouteOf } from "./network-route.js";
import { createNodeStreamingHttp } from "./node-streaming-http.js";
import { processPorts } from "./process-ports.js";
import { type RuntimeHost, runRuntime } from "./run-runtime.js";
import { openSqliteAgentDatabase } from "./sqlite-agent-database.js";
import { chatModelOf, turnModelsOf } from "./turn-models.js";

const healthEveryMs = 10_000;
// Started from its TypeScript source, the runtime's store workers need its loader options too.
const workerExecArgv = import.meta.url.endsWith(".ts") ? process.execArgv : [];

async function writeLine(line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${line}\n`, (error) => {
      if (error === null || error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

// The image tool's parts under the settings in force: the agents' jobs, the model and its price.
function imageMakingOf(
  parts: ChainParts,
  settings: RuntimeSettings,
  jobs: ImageJobs,
): ImageMakingToolParts {
  const makingModel = settings.models.imageMaking;
  const price =
    makingModel === undefined ? undefined : modelPriceOf(makingModel, settings.models)?.price;
  return {
    jobs,
    maker: imageMakerFor(settings.models, parts),
    ...(price === undefined ? {} : { price }),
    random: processPorts.random,
    clock: parts.clock,
  };
}

// The video and speech tools' parts under the settings in force (decision 0405).
function mediaMakingOf(
  parts: ChainParts,
  settings: RuntimeSettings,
  jobs: ImageJobs<RunningVideoJob>,
): Pick<AgentToolParts, "videoMaking" | "speaking"> {
  const { random } = processPorts;
  const voice = settings.speech?.voice;
  return {
    videoMaking: { jobs, maker: videoMakerFor(settings.models, parts), random, clock: parts.clock },
    speaking: {
      source: speechSourceFor(settings.models, parts),
      ...(voice === undefined ? {} : { voice }),
      random,
    },
  };
}

// The models in force as the turn starts, which its live facts name.
function settingsFactsOf(place: TurnPlace, settings: RuntimeSettings): SettingsFacts {
  const { imageMaking, videoMaking, speech } = settings.models;
  const mainModel = chatModelOf(place, settings) ?? settings.models.main;
  return {
    ...(mainModel === undefined ? {} : { mainModel }),
    ...(imageMaking === undefined ? {} : { imageMakingModel: imageMaking }),
    ...(videoMaking === undefined ? {} : { videoMakingModel: videoMaking }),
    ...(speech === undefined ? {} : { speechModel: speech }),
  };
}

/** What a helper's setup is made from: its place, the settings, the chains' parts and its tools'. */
interface HelperSetupContext {
  readonly place: TurnPlace;
  readonly settings: RuntimeSettings;
  readonly parts: ChainParts;
  readonly toolParts: AgentToolParts;
}

// A helper's turn runs on the model the agent named for it, else on the agent's own chain, with
// the tools a helper may call and binference's helper instructions (decision 0403).
function helperSetupOf(agentSetup: TurnSetup, context: HelperSetupContext): TurnSetup {
  const { place, settings, parts, toolParts } = context;
  const model = place.helper?.model;
  return {
    ...agentSetup,
    models:
      model === undefined
        ? agentSetup.models
        : modelChainFor(settings.models, { role: "main", picked: model }, parts),
    tools: helperToolBox(toolParts),
    instructions: helperInstructions(),
  };
}

// The turns of the built runtime: binference's instructions in the owner's language, the main
// model of the settings in force and its fallbacks, or the model the owner picked for the agent
// alone (decision 0204), whose providers' rests every turn shares, the agent's tools over the
// runtime's connection to the engine and its web tools on the settings' search keys, and
// compaction on the fast model, or on the main model when no fast model is set (decision 0202),
// and the tools of the community plugins the settings in force name (decision 0349); a helper's
// turn gets a helper's setup (decision 0403).
function builtTurnSetup(parts: ChainParts): RuntimeHost["turnSetup"] {
  // The agents' image jobs outlive the turns that start them.
  const jobs = createImageJobs();
  const videoJobs = createImageJobs<RunningVideoJob>();
  return (place, settings, link) => {
    const { agent } = place;
    const { main, summarizer, vision } = turnModelsOf(place, settings, parts);
    const toolParts = {
      agent,
      client: link.client,
      turn: place,
      web: { http: parts.http, lookup, clock: parts.clock, search: settings.search },
      plugins: settings.plugins ?? [],
      imageMaking: imageMakingOf(parts, settings, jobs),
      ...mediaMakingOf(parts, settings, videoJobs),
      status: { chats: link.chats, settings, version: manifest.version, clock: parts.clock },
      ...(link.helpers === undefined ? {} : { helpers: link.helpers }),
    };
    const setup: TurnSetup = {
      models: main,
      settings: settingsFactsOf(place, settings),
      ...(vision === undefined ? {} : { vision }),
      compaction: {
        summarizer,
        contextTokens: defaultContextTokens,
        locale: settings.owner.locale,
      },
      tools: agentToolBox(toolParts),
      instructions: agentInstructions(settings.owner.locale),
      limits: {
        ...turnLimits,
        maxToolCalls: settings.models.maxToolCallsPerTurn,
        modelIdleMs: settings.models.idleTimeoutMs,
        loopGuard: settings.models.loopDetection,
      },
    };
    return place.helper === undefined
      ? setup
      : helperSetupOf(setup, { place, settings, parts, toolParts });
  };
}

/**
 * Runs the agent runtime as its own Node process, on its standard input and output (runtime spec,
 * section 2): the engine's IPC link, `agent.sqlite` on the store's workers, the process's clock,
 * and the turns' model and tools: the settings' main model over the process's own outbound HTTP
 * and the agent's tools over the engine link, unless a test gives turns of its own. Sets the exit code when it ends.
 */
export async function runNodeRuntime(
  parts: { readonly turnSetup?: RuntimeHost["turnSetup"] } = {},
): Promise<void> {
  const http = createNodeStreamingHttp({ version: manifest.version });
  const exit = await runRuntime({
    input: process.stdin,
    write: writeLine,
    connect: async (start, signal) =>
      connectEngine(start, { ...processPorts, version: manifest.version, signal }),
    openAgentDatabase: async (file, signal) =>
      openSqliteAgentDatabase(file, { signal, execArgv: workerExecArgv }),
    turnSetup:
      parts.turnSetup ?? builtTurnSetup({ http, clock: processPorts.clock, rests: new Map() }),
    random: processPorts.random,
    applySettings: (settings) => http.use(networkRouteOf(settings.network)),
    clock: processPorts.clock,
    everyTenSeconds: (onTick, signal) => {
      // A write that fails means the engine has gone; the end of the input stops the runtime.
      const timer = setInterval(() => void onTick().catch(() => undefined), healthEveryMs);
      signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    },
    version: manifest.version,
  });
  await http.close();
  process.exitCode = exit === "stopped" ? 0 : 1;
  // The input may still hold a read open, which would keep the process alive.
  process.stdin.destroy();
}
