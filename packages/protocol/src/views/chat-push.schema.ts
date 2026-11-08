import { z } from "zod";
import { maxSentFiles } from "../operations/file-limits.js";
import {
  type ImageContentType,
  imageContentTypeSchema,
  maxImagePromptChars,
  maxImagesPerMessage,
} from "../operations/image-operations.schema.js";
import { type MediaView, mediaViewSchema } from "../operations/media-operations.schema.js";
import {
  type SentFileView,
  sentFileViewSchema,
} from "../operations/sent-file-operations.schema.js";
import { type AgentMode, agentModeSchema } from "./agent-view.schema.js";
import { type PortableChart, portableChartSchema } from "./portable-chart.schema.js";
import { type WalletView, walletViewSchema } from "./wallet-view.schema.js";

/**
 * The most characters of reasoning one `turn/reasoning`, and so one `chat/reasoning`, carries;
 * the runtime cuts a longer one there (decision 0377).
 */
export const maxReasoningChars: number = 50_000;

/** An image the agent made, as `chat/images` names it (decision 0392). */
interface MadeImageView {
  /** Its id, which `image/read` reads it by. */
  readonly image: string;
  readonly contentType: ImageContentType;
  readonly bytes: number;
  /** Where it was saved, in the agent's workspace. */
  readonly path: string;
}

/** A line's values, as `chat/status` and `chat/progress` carry them. */
type LineValues = Readonly<Record<string, string | number>>;

/** A push of an agent's chat topic, in the shapes of protocol spec section 7.7. */
export type ChatPush =
  | { readonly kind: "chat/turnStarted"; readonly agent: string; readonly turn: string }
  | {
      readonly kind: "chat/message";
      readonly agent: string;
      readonly turn: string;
      readonly text: string;
      readonly final: boolean;
    }
  | {
      readonly kind: "chat/status";
      readonly agent: string;
      readonly turn: string;
      readonly statusKey: string;
      readonly values?: LineValues;
    }
  | {
      readonly kind: "chat/progress";
      readonly agent: string;
      readonly turn: string;
      readonly progressKey: string;
      readonly values?: LineValues;
    }
  | {
      readonly kind: "chat/reasoning";
      readonly agent: string;
      readonly turn: string;
      readonly text: string;
      readonly final: boolean;
    }
  | {
      readonly kind: "chat/deposit";
      readonly agent: string;
      readonly turn: string;
      /** The agent's mode and freeze now, which a surface warns of beside each address. */
      readonly mode: AgentMode;
      readonly frozen: boolean;
      /** The wallets to show, each with the address its QR code holds (decision 0380). */
      readonly wallets: readonly WalletView[];
    }
  | {
      readonly kind: "chat/chart";
      readonly agent: string;
      readonly turn: string;
      /** The chart to draw, or to show as text where no chart is drawn (decision 0387). */
      readonly chart: PortableChart;
    }
  | {
      readonly kind: "chat/images";
      readonly agent: string;
      readonly turn: string;
      /**
       * What the agent asked the image model for, or, for images it showed from the machine, the
       * line it said they are (decision 0399).
       */
      readonly prompt: string;
      readonly images: readonly MadeImageView[];
    }
  | {
      readonly kind: "chat/files";
      readonly agent: string;
      readonly turn: string;
      /** The line the agent said the files are (decision 0400). */
      readonly caption: string;
      readonly files: readonly SentFileView[];
    }
  | {
      readonly kind: "chat/media";
      readonly agent: string;
      readonly turn: string;
      /** A video the agent made, or its words spoken, saved in its workspace (decision 0405). */
      readonly media: MediaView;
    }
  | {
      readonly kind: "chat/turnEnded";
      readonly agent: string;
      readonly turn: string;
      /** The tool whose last call failed, when the turn gave the owner no answer to name it in. */
      readonly failedTool?: string;
    };

const at = { agent: z.string().min(1), turn: z.string().min(1) };
const values = z.record(z.string(), z.union([z.string(), z.number()])).optional();

const turnSchema = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("chat/turnStarted"), data: z.looseObject(at) }),
  z.looseObject({
    kind: z.literal("chat/message"),
    data: z.looseObject({ ...at, text: z.string(), final: z.boolean() }),
  }),
  z.looseObject({
    kind: z.literal("chat/status"),
    data: z.looseObject({ ...at, statusKey: z.string().min(1), values }),
  }),
  z.looseObject({
    kind: z.literal("chat/progress"),
    data: z.looseObject({ ...at, progressKey: z.string().min(1), values }),
  }),
  z.looseObject({
    kind: z.literal("chat/reasoning"),
    data: z.looseObject({ ...at, text: z.string(), final: z.boolean() }),
  }),
  z.looseObject({
    kind: z.literal("chat/turnEnded"),
    data: z.looseObject({ ...at, failedTool: z.string().min(1).max(128).optional() }),
  }),
]);

// What a tool showed mid-turn: wallets to fund, a chart, images, files or a made medium.
const shownSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("chat/deposit"),
    data: z.looseObject({
      ...at,
      mode: agentModeSchema,
      frozen: z.boolean(),
      wallets: z.array(walletViewSchema).min(1),
    }),
  }),
  z.looseObject({
    kind: z.literal("chat/chart"),
    data: z.looseObject({ ...at, chart: portableChartSchema }),
  }),
  z.looseObject({
    kind: z.literal("chat/images"),
    data: z.looseObject({
      ...at,
      prompt: z.string().min(1).max(maxImagePromptChars),
      images: z
        .array(
          z.looseObject({
            image: z.string().min(1),
            contentType: imageContentTypeSchema,
            bytes: z.int().positive(),
            path: z.string().min(1),
          }),
        )
        .min(1)
        .max(maxImagesPerMessage),
    }),
  }),
  z.looseObject({
    kind: z.literal("chat/files"),
    data: z.looseObject({
      ...at,
      caption: z.string().min(1).max(500),
      files: z.array(sentFileViewSchema).min(1).max(maxSentFiles),
    }),
  }),
  z.looseObject({
    kind: z.literal("chat/media"),
    data: z.looseObject({ ...at, media: mediaViewSchema }),
  }),
]);

/** A push of a chat topic, as it arrives. */
interface RawPush {
  readonly kind: string;
  readonly data: unknown;
}

// The tool a turn's end names as failed, when it names one, as an optional field.
function failedOf(failedTool: unknown): { readonly failedTool?: string } {
  return typeof failedTool === "string" ? { failedTool } : {};
}

// A line's values when it carries any, as an optional field.
function valuesOf(shown: LineValues | undefined): { readonly values?: LineValues } {
  return shown === undefined ? {} : { values: shown };
}

// What a tool showed mid-turn, or `undefined` for any other push.
function shownPushOf(push: RawPush): ChatPush | undefined {
  const parsed = shownSchema.safeParse(push);
  if (!parsed.success) {
    return undefined;
  }
  const read = parsed.data;
  if (read.kind === "chat/deposit") {
    const { agent, turn, mode, frozen, wallets } = read.data;
    return { kind: read.kind, agent, turn, mode, frozen, wallets };
  }
  if (read.kind === "chat/chart") {
    const { agent, turn, chart } = read.data;
    return { kind: read.kind, agent, turn, chart };
  }
  if (read.kind === "chat/images") {
    const { agent, turn, prompt, images } = read.data;
    return { kind: read.kind, agent, turn, prompt, images };
  }
  if (read.kind === "chat/files") {
    const { agent, turn, caption, files } = read.data;
    return { kind: read.kind, agent, turn, caption, files };
  }
  const { agent, turn, media } = read.data;
  return { kind: read.kind, agent, turn, media };
}

/**
 * Reads a push of an agent's chat topic as a {@link ChatPush}; `undefined` for any other push,
 * such as an agent's question, and for one in a shape it cannot read.
 */
export function chatPushOf(push: RawPush): ChatPush | undefined {
  const parsed = turnSchema.safeParse(push);
  if (!parsed.success) {
    return shownPushOf(push);
  }
  const read = parsed.data;
  if (read.kind === "chat/message" || read.kind === "chat/reasoning") {
    const { agent, turn, text, final } = read.data;
    return { kind: read.kind, agent, turn, text, final };
  }
  if (read.kind === "chat/status") {
    const { agent, turn, statusKey, values: shown } = read.data;
    return { kind: read.kind, agent, turn, statusKey, ...valuesOf(shown) };
  }
  if (read.kind === "chat/progress") {
    const { agent, turn, progressKey, values: shown } = read.data;
    return { kind: read.kind, agent, turn, progressKey, ...valuesOf(shown) };
  }
  if (read.kind === "chat/turnEnded") {
    const { agent, turn, failedTool } = read.data;
    return { kind: read.kind, agent, turn, ...failedOf(failedTool) };
  }
  const { agent, turn } = read.data;
  return { kind: read.kind, agent, turn };
}
