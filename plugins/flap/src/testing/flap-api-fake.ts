import type { HttpRequest, HttpResponse, JsonValue } from "@binference/plugin-sdk";
import type { ScriptedHttp } from "@binference/plugin-sdk/testing";
import {
  liveCid,
  livePinFields,
  liveUploadAnswer,
  type RecordedAnswer,
} from "./recorded-upload.js";

/** The metadata CID Flap's upload API answered binference's live test upload. */
export const recordedCid: string = liveCid;

const json = (status: number, body: JsonValue): HttpResponse => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const answerOf = (recorded: RecordedAnswer): HttpResponse => ({
  status: recorded.status,
  headers: { "content-type": recorded.contentType },
  body: recorded.body,
});

/** The upload API's answer, as it answered the live test upload: the metadata's CID. */
export const uploadAnswer: HttpResponse = answerOf(liveUploadAnswer);

/**
 * The pin status API's answer for a CID in the shape it gave the live test read, with the status
 * given: the live answer itself for the recorded CID and `pinned`.
 */
export function pinAnswer(status: string, cid: string = recordedCid): HttpResponse {
  const { data, requestId } = livePinFields;
  return json(200, { data: { ...data, cid, status, providerStatus: status }, requestId });
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
