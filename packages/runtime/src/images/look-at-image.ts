import { err, ok, type Result } from "@binference/core";
import { callModel, type ModelLine } from "../loop/model-call.js";
import type { ModelImage } from "../loop/model-message.js";
import type { ImageLookRefusal } from "../loop/turn-records.js";
import { createModelRoute, type TurnRun } from "../loop/turn-run.js";
import { describePrefix, maxDescription } from "./describe-words.js";

/**
 * The model that looks at images: the turn's own when it takes images, from where the turn's
 * route stands, else the vision model; `undefined` when neither takes images.
 */
export function imageLineOf(run: TurnRun): ModelLine | undefined {
  const route = createModelRoute();
  if (run.parts.models.models[run.route.at()]?.readsImages === true) {
    route.moveTo(run.route.at());
    return { chain: run.parts.models, route };
  }
  return run.parts.vision === undefined ? undefined : { chain: run.parts.vision, route };
}

/**
 * Describes the images a tool read, together, with the question the agent asked of them (decision
 * 0385): one
 * call on the turn's model when it takes images, else on the vision model, its usage recorded on
 * the turn. Answers the description, cut to 4,000 characters, `no_model` when no model of the
 * turn takes images, or `failed` when the call failed.
 */
export async function lookAtImage(
  run: TurnRun,
  images: readonly ModelImage[],
  question: string,
): Promise<Result<string, ImageLookRefusal>> {
  const line = imageLineOf(run);
  if (line === undefined) {
    return err("no_model");
  }
  const which =
    images.length === 1 ? "this image" : `these ${String(images.length)} images, each by its place`;
  const text = `Describe ${which}. The agent wants to know: ${question}`;
  const request = {
    prefix: describePrefix,
    messages: [{ role: "owner" as const, text, images: [...images] }],
    tools: [],
  };
  const response = await callModel(run, request, line);
  if (!response.ok) {
    return err("failed");
  }
  const said = response.text.trim();
  return ok((said === "" ? "The model found nothing to describe." : said).slice(0, maxDescription));
}
