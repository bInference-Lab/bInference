import type { HttpRequest, HttpResponse, JsonValue } from "@binference/plugin-sdk";
import type { ScriptedHttp } from "@binference/plugin-sdk/testing";

/** A metadata CID in the shape Flap's upload API answers, as a launch on BSC named it. */
export const recordedCid = "bafkreibxo4udedy3sxsljj7bmrvs7aodggcj6n4m5xaxb5xtydv3fwruem";

const json = (status: number, body: JsonValue): HttpResponse => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

/** The upload API's answer, as Flap's docs give it: the metadata's CID. */
export const uploadAnswer: HttpResponse = json(200, { data: { create: recordedCid } });

/** The pin status API's answer for the recorded CID, as Flap's docs give it. */
export function pinAnswer(status: string, cid: string = recordedCid): HttpResponse {
  return json(200, {
    data: {
      cid,
      status,
      providerStatus: "prechecking",
      jobId: "00000000-0000-0000-0000-000000000000",
    },
    requestId: "00000000-0000-0000-0000-000000000000",
  });
}

/** An answer Flap's API gives with a status and a JSON body, such as a refusal. */
export const apiAnswer: (status: number, body: JsonValue) => HttpResponse = json;

/** The page a host gives for an endpoint it does not serve. */
export const htmlNotFound: HttpResponse = {
  status: 404,
  headers: { "content-type": "text/html" },
  body: "<html><body>Not Found</body></html>",
};

/** A fake of Flap's API that also fails any read of an IPFS gateway, as a launch must never make. */
export interface FlapApiFake extends ScriptedHttp {
  /** Every URL asked for, oldest first. */
  readonly urls: () => readonly string[];
}

const apiOrigin = "https://funcs.flap.sh/";

/**
 * Answers an upload with `upload`, and each pin status read with the next of `statuses` (the last
 * one again once they run out). A request to anything but Flap's API, such as an IPFS gateway,
 * throws, so a test fails on it.
 */
export function flapApiFake(
  statuses: readonly HttpResponse[] = [pinAnswer("pinned")],
  upload: HttpResponse = uploadAnswer,
): FlapApiFake {
  const asked: HttpRequest[] = [];
  const reads = { count: 0 };
  return {
    async request(request) {
      request.signal.throwIfAborted();
      asked.push(request);
      if (!request.url.startsWith(apiOrigin) || request.url.includes("/ipfs/" + recordedCid)) {
        throw new Error(`A launch read ${request.url}, which is no Flap API call.`);
      }
      if (request.method === "POST") {
        return await Promise.resolve(upload);
      }
      const answer = statuses[Math.min(reads.count, statuses.length - 1)];
      reads.count += 1;
      return await Promise.resolve(answer ?? pinAnswer("pending"));
    },
    requests: () => [...asked],
    urls: () => asked.map((request) => request.url),
  };
}
