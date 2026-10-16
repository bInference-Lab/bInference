import { ok } from "@binference/core";
import { type AnswerKey, answerNames } from "./answer-names.js";
import { type InitRefusal, type InitStep, type Refused, refused } from "./init-context.js";
import { inlineSecretRefusal } from "./inline-secret.js";
import { modelPresets } from "./model-presets.js";

/** What init knows about a run's answers: its flags with every layer filled in. */
type Given = Readonly<Partial<Record<AnswerKey, string | boolean>>>;

/**
 * Init's refusal for an answer nobody gave, naming its flag, its `BINFERENCE_INIT_*` variable and
 * its key in the answers file (decision 0225).
 */
export function missingAnswer(flag: string): Refused {
  const answer = answerNames.find((item) => item.flag === flag);
  return refused("init.needs_flag", "refused.needsAnswer", {
    flag,
    variable: answer?.variable ?? "",
    key: answer?.key ?? "",
  });
}

// The model answers a run needs: the provider and model, its address for a compatible provider,
// and a key for every provider but a compatible one, which may run on this machine without one.
function modelNeeds(given: Given): InitStep<readonly AnswerKey[]> {
  const preset = modelPresets.find((item) => item.id === given.modelProvider);
  if (given.modelProvider !== undefined && preset === undefined) {
    const providers = modelPresets.map((item) => item.id).join(", ");
    return refused("init.bad_model_provider", "refused.modelProvider", { providers });
  }
  const address: readonly AnswerKey[] = preset?.asksBaseUrl === true ? ["modelBaseUrl"] : [];
  const key: readonly AnswerKey[] = preset?.asksBaseUrl === true ? [] : ["modelKey"];
  return ok(["modelProvider", "model", ...address, ...key]);
}

function isGiven(given: Given, key: AnswerKey): boolean {
  const value = given[key];
  return value !== undefined && value !== false;
}

/**
 * Checks a new set-up nobody answers before anything is written (decision 0225): a secret given
 * as plain text rather than a secret source is refused (`config.secret_inline`) first, then the
 * first answer missing, in the order of the onboarding, is named. The model is required. Answers
 * nothing when every answer is there; the steps check each value later.
 */
export function unattendedRefusal(
  given: Given,
  named: (flag: string) => string,
): InitRefusal | undefined {
  const inline = answerNames
    .filter((answer) => answer.kind === "secret")
    .map((answer) => {
      const text = given[answer.key];
      return typeof text === "string"
        ? inlineSecretRefusal(named(answer.flag), answer, text)
        : undefined;
    })
    .find((refusal) => refusal !== undefined);
  if (inline !== undefined) {
    return inline.refusal;
  }
  const model = modelNeeds(given);
  if (!model.ok) {
    return model.refusal;
  }
  const command: readonly AnswerKey[] = given.unlock === "command" ? ["unlockCommand"] : [];
  const needed: readonly AnswerKey[] = [
    ...model.value,
    "privyAppId",
    "privyAppSecret",
    "ownerKeyPublic",
    "rescue",
    "botToken",
    ...command,
  ];
  const missing = needed.find((key) => !isGiven(given, key));
  if (missing === "ownerKeyPublic") {
    return { code: "init.owner_key_needs_terminal", key: "refused.ownerKeyTerminal" };
  }
  const answer = answerNames.find((item) => item.key === missing);
  return answer === undefined ? undefined : missingAnswer(answer.flag).refusal;
}
