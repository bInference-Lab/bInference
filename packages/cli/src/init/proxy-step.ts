import { createSecret, isProxyUrl, ok, outboundRouteOf, type Secret } from "@binference/core";
import type { NetworkConfig } from "../config/schema/operations.schema.js";
import { type SecretSource, secretSourceSchema } from "../config/schema/secret-source.schema.js";
import { flagLabel } from "./answer-label.js";
import { answerOfFlag } from "./answer-names.js";
import { type InitContext, type InitStep, type Refused, refused } from "./init-context.js";
import { inlineSecretRefusal } from "./inline-secret.js";
import type { SecretPlace } from "./secret-places.js";
import { readFlagSecret, sourceOf } from "./take-secret.js";

/** The keychain entry or `keys/` file that holds a proxy URL its variable or file gave as text. */
export const proxyEntry = "network-proxy";

const proxyFlag = "--proxy";
// The source the refusal shows: a variable that holds the proxy URL.
const proxyExample = '{ fromEnv: "HTTPS_PROXY" }';

/** The proxy `--proxy` gives: a secret source, or a URL with no password, which init stores. */
type ProxyAnswer =
  | { readonly kind: "source"; readonly source: SecretSource }
  | { readonly kind: "url"; readonly url: Secret };

// A URL `--proxy` gave on the command line, where only a secret source may stand.
function commandLineRefusal(context: InitContext): Refused | undefined {
  const origin = context.origins.get("proxy");
  return origin === undefined || origin.layer === "flag"
    ? refused("init.proxy_on_command_line", "refused.proxyOnCommandLine", {
        flag: flagLabel(context, proxyFlag),
        example: proxyExample,
      })
    : undefined;
}

// The command line takes a secret source alone, so the proxy's address stays out of the shell's
// history and the process list; a URL with no password comes only from the variable or the
// answers file, and a user name or password never as text (decision 0225).
function answerOf(context: InitContext, text: string): InitStep<ProxyAnswer> {
  const source = sourceOf(text, secretSourceSchema);
  if (source !== undefined) {
    return ok({ kind: "source", source });
  }
  const onCommandLine = commandLineRefusal(context);
  if (onCommandLine !== undefined) {
    return onCommandLine;
  }
  const url = URL.canParse(text) ? new URL(text) : undefined;
  if (url !== undefined && (url.username !== "" || url.password !== "")) {
    const answer = answerOfFlag(proxyFlag);
    const name = flagLabel(context, proxyFlag);
    const inline = answer === undefined ? undefined : inlineSecretRefusal(name, answer, text);
    if (inline !== undefined) {
      return inline;
    }
  }
  return isProxyUrl(text)
    ? ok({ kind: "url", url: createSecret(text) })
    : refused("init.bad_proxy", "refused.badProxy", {
        flag: flagLabel(context, proxyFlag),
        example: proxyExample,
      });
}

async function proxyOf(
  context: InitContext,
  answer: ProxyAnswer,
  path: string,
): Promise<InitStep<Secret>> {
  if (answer.kind === "url") {
    return ok(answer.url);
  }
  const read = await readFlagSecret(context, { flag: path, path }, answer.source);
  if (!read.ok || isProxyUrl(read.value.reveal())) {
    return read;
  }
  return refused("init.bad_proxy", "refused.badProxy", { flag: path, example: proxyExample });
}

// The proxy the install's config names, or else the one `--proxy` gives; none without either.
async function chosenProxy(
  context: InitContext,
  network: NetworkConfig | undefined,
): Promise<InitStep<Secret | undefined>> {
  if (network?.proxy !== undefined) {
    return proxyOf(context, { kind: "source", source: network.proxy }, "network.proxy");
  }
  const text = context.flags.proxy;
  if (text === undefined) {
    return ok(undefined);
  }
  const answer = answerOf(context, text);
  return answer.ok ? proxyOf(context, answer.value, flagLabel(context, proxyFlag)) : answer;
}

/**
 * Puts the route of every request init and the restore steps make from now on in force (decision
 * 0347): through the proxy the install's `network.proxy` names when a config gives `network`, else
 * through the one `--proxy` (a secret source alone), its `BINFERENCE_INIT_PROXY` variable or the
 * answers file gives (a secret source, or a URL with no password), else directly. A proxy that
 * cannot be read, or is no `http:` or `https:` URL, is init's refusal before any request; a URL
 * on the command line is `init.proxy_on_command_line`, and one with a password
 * `config.secret_inline`. The proxy is never shown.
 */
export async function routeInitProxy(
  context: InitContext,
  network?: NetworkConfig,
): Promise<InitStep<void>> {
  const proxy = await chosenProxy(context, network);
  if (!proxy.ok) {
    return proxy;
  }
  const noProxy = network?.noProxy ?? [];
  const setting = proxy.value === undefined ? { noProxy } : { proxy: proxy.value, noProxy };
  context.host.outbound.use(outboundRouteOf(setting));
  return ok(undefined);
}

/**
 * The source `network.proxy` names in the config init writes: the one `--proxy` gave, or the
 * secret place's entry for a URL it gave as text, which {@link proxyToStore} stores there.
 */
export function proxySourceOf(context: InitContext, place: SecretPlace): SecretSource | undefined {
  const text = context.flags.proxy;
  if (text === undefined) {
    return undefined;
  }
  return sourceOf(text, secretSourceSchema) ?? place.sourceOf(proxyEntry);
}

/** The proxy URL `--proxy` gave as text, which init stores where it keeps typed secrets. */
export function proxyToStore(context: InitContext): Secret | undefined {
  const text = context.flags.proxy;
  return text === undefined || sourceOf(text, secretSourceSchema) !== undefined
    ? undefined
    : createSecret(text);
}
