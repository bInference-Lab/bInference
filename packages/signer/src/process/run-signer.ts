import type { Writable } from "node:stream";
import type { SignerFaultCode } from "../requests/signer-message.schema.js";
import { serveSigner } from "./serve-signer.js";

/** What the signer's entry hands over from Node: the permission model and the standard streams. */
export interface SignerHost {
  /** `process.permission`: `undefined` when Node runs without the permission model. */
  readonly permission: NodeJS.ProcessPermission | undefined;
  /** The path of the program Node runs, which Node lets it read. */
  readonly program: string;
  readonly input: AsyncIterable<Uint8Array>;
  readonly output: Writable;
}

// Every scope of Node's permission model; the signer keeps none of them.
const scopes = ["fs", "net", "child", "worker", "inspector", "wasi", "addon"] as const;

// Node grants a process under the permission model no more than its flags say, and lets it read
// its own program. Once its bundle is loaded the signer needs neither, so it drops every scope,
// then checks that nothing is left.
function seal(host: SignerHost): boolean {
  const { permission } = host;
  if (permission === undefined) {
    return false;
  }
  scopes.forEach((scope) => {
    permission.drop(scope);
  });
  return (
    scopes.every((scope) => !permission.has(scope)) && !permission.has("fs.read", host.program)
  );
}

function lineWriter(output: Writable): (line: string) => Promise<void> {
  return async (line) =>
    new Promise((resolve, reject) => {
      output.write(`${line}\n`, (error) => {
        if (error === null || error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
}

/**
 * Runs the signer process: it refuses to start outside Node's permission model, drops every
 * permission it was given, then serves the engine on its standard streams until the engine closes
 * its input. Returns the fault it stopped on, after writing it as its last line.
 */
export async function runSigner(host: SignerHost): Promise<SignerFaultCode | undefined> {
  const write = lineWriter(host.output);
  if (!seal(host)) {
    await write(JSON.stringify({ fault: "signer.not_sealed" }));
    return "signer.not_sealed";
  }
  return serveSigner({ input: host.input, write });
}
