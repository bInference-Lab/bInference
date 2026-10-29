// oxlint-disable-next-line eslint/no-restricted-imports -- the types of the listener below
import type { IncomingMessage, ServerResponse } from "node:http";
// oxlint-disable-next-line eslint/no-restricted-imports -- the image smoke test serves its fakes to the container under test over TLS; nothing ships a listener
import { createServer } from "node:https";
import { join } from "node:path";
import process from "node:process";
import { text as readBody } from "node:stream/consumers";
import { BinferenceError, type Http, type HttpMethod } from "@binference/core";
import { createFakePrivy } from "@binference/custody-privy/testing";
import { readTextFile, runCommand } from "@binference/platform";
import { createFakeBotApi } from "@binference/telegram/testing";
import { z } from "zod";
import { headersOf } from "../e2e/incoming-headers.js";
import { createFakeModelProvider } from "../e2e/model-fixtures.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemRandom } from "../runtime/system-random.js";
import { edgeCertFolder, edgeHosts } from "./image-names.js";

// The image smoke test's edge: Privy's, Telegram's and OpenAI's APIs as the container under test
// reaches them, served by the fakes the e2e tests use. The test's Docker network gives this
// container those three names, so the image's own binference calls them over HTTPS unchanged.
// At start it makes a certificate for the three names in the folder the test shares with the
// container under test, which trusts it through NODE_EXTRA_CA_CERTS. It runs in the image's build
// stage, which holds the sources, tsx and openssl, and prints one line once it listens.
const methodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const keyFile = join(edgeCertFolder, "edge.key");
const certFile = join(edgeCertFolder, "edge.pem");

async function readOrThrow(file: string): Promise<string> {
  const read = await readTextFile(file, AbortSignal.timeout(5_000));
  if (!read.ok) {
    throw new BinferenceError({ code: "image.no_certificate", message: `${file} is missing.` });
  }
  return read.value;
}

async function makeCertificate(): Promise<{ readonly key: string; readonly cert: string }> {
  const names = edgeHosts.map((host) => `DNS:${host}`).join(",");
  const subject = ["-subj", "/CN=binference image smoke", "-addext", `subjectAltName=${names}`];
  const curve = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256"];
  const files = ["-keyout", keyFile, "-out", certFile];
  const args = ["req", "-x509", ...curve, "-nodes", "-days", "1", ...subject, ...files];
  await runCommand("openssl", args, AbortSignal.timeout(15_000));
  return { key: await readOrThrow(keyFile), cert: await readOrThrow(certFile) };
}

const clock = createSystemClock();
const services = new Map<string, Http>([
  ["api.privy.io", createFakePrivy({ clock, random: createSystemRandom() }).http],
  ["api.telegram.org", createFakeBotApi().http],
  ["api.openai.com", createFakeModelProvider().http],
]);

async function answer(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  const body = await readBody(incoming);
  const host = incoming.headers.host ?? "";
  const service = services.get(host.split(":")[0] ?? "");
  if (service === undefined) {
    outgoing.writeHead(404).end();
    return;
  }
  const method: HttpMethod = methodSchema.parse(incoming.method);
  const reply = await service.request({
    method,
    url: `https://${host}${incoming.url ?? "/"}`,
    headers: headersOf(incoming),
    ...(body === "" ? {} : { body }),
    signal: AbortSignal.timeout(60_000),
  });
  outgoing.writeHead(reply.status, reply.headers).end(reply.body);
}

const tls = await makeCertificate();
createServer(tls, (incoming, outgoing) => {
  answer(incoming, outgoing).catch(() => {
    outgoing.writeHead(500).end();
  });
}).listen(443, () => {
  process.stdout.write(`${JSON.stringify({ edge: "listening", hosts: edgeHosts })}\n`);
});
