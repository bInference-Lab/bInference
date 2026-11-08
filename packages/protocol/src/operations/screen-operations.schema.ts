import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { imageByteCountSchema } from "./image-operations.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/** The most displays `screen/capture` shows at once, one image each (decision 0406). */
export const maxScreenShots: number = 4;

/** The highest display number `screen/capture` takes. */
export const maxDisplayNumber: number = 16;

/** The args of `screen/capture`: every display, or the one `display` numbers from 1. */
interface CaptureScreenArgs {
  readonly agent: ProtocolId<"agent">;
  readonly display?: number;
}

/** A screenshot the engine saved in the agent's workspace, which `image/view` reads by its path. */
export interface ScreenShotView {
  /** Where it was saved, under `media/screen/<date>/` of the workspace. */
  readonly path: string;
  readonly contentType: "image/png" | "image/jpeg";
  readonly bytes: number;
  /** The display it shows, by the OS's number from 1; absent for one image of every display. */
  readonly display?: number;
}

/**
 * What `screen/capture` took: the screenshots, at most 4, or none with `blocked` when the OS has
 * not allowed binference to record the screen, naming the program the owner allows.
 */
export interface ScreenCaptureView {
  readonly shots: readonly ScreenShotView[];
  readonly blocked?: { readonly program: string };
}

/** The operation of the screenshots the agent looks at (decision 0406). */
export interface ScreenOperationShapes {
  readonly "screen/capture": {
    readonly args: CaptureScreenArgs;
    readonly result: ScreenCaptureView;
  };
}

// A screenshot the engine saved.
const screenShotViewSchema: z.ZodType<ScreenShotView> = z.object({
  path: z.string().min(1).max(4_096),
  contentType: z.enum(["image/png", "image/jpeg"]),
  bytes: imageByteCountSchema,
  display: z.int().min(1).max(maxDisplayNumber).exactOptional(),
});

/** The screen operation, by name. */
export const screenOperations: OperationTable<ScreenOperationShapes> = {
  "screen/capture": {
    ...readFlags,
    name: "screen/capture",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      display: z.int().min(1).max(maxDisplayNumber).exactOptional(),
    }),
    result: z.object({
      shots: z.array(screenShotViewSchema).max(maxScreenShots),
      blocked: z.object({ program: z.string().min(1).max(4_096) }).exactOptional(),
    }),
  },
};
