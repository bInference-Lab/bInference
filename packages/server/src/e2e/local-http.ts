import { Buffer } from "node:buffer";
import { request } from "node:http";

/** One request to the test server's HTTP listener. */
export interface LocalRequest {
  readonly path: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

/** The test server's answer: its status, headers and body as text and as bytes. */
export interface LocalAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
  readonly bytes: Buffer;
}

/** Sends one request to `127.0.0.1:<port>` on a fresh socket and reads the whole answer. */
export async function requestLocal(port: number, sent: LocalRequest): Promise<LocalAnswer> {
  return new Promise((resolve, reject) => {
    const { path, method = "GET", headers = {} } = sent;
    const options = { host: "127.0.0.1", port, path, method, headers, agent: false };
    const outgoing = request(options, (answer) => {
      const chunks: Buffer[] = [];
      answer.on("data", (chunk: Buffer) => chunks.push(chunk));
      answer.on("end", () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          status: answer.statusCode ?? 0,
          headers: answer.headers,
          body: bytes.toString("utf8"),
          bytes,
        });
      });
    });
    outgoing.on("error", reject);
    outgoing.end(sent.body);
  });
}
