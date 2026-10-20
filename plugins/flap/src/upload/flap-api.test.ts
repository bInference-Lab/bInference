import type { HttpRequest, HttpResponse } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  apiAnswer,
  flapApiFake,
  htmlNotFound,
  pinAnswer,
  recordedCid,
  uploadAnswer,
} from "../testing/flap-api-fake.js";
import {
  liveCid,
  liveMetadata,
  livePinAnswer,
  livePinFields,
  livePng,
  liveUploadAnswer,
  liveUploadBody,
  type RecordedAnswer,
} from "../testing/recorded-upload.js";
import { readPinStatus, uploadMetadata } from "./flap-api.js";

const signal = new AbortController().signal;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const upload = {
  image: { bytes: png, contentType: "image/png", fileName: "image.png" },
  metadata: {
    description: "A cat on the moon",
    website: "https://moon.example",
    twitter: null,
    telegram: null,
    creator: "0x000000000000000000000000000000000000bEEF",
  },
};

const answerOf = (recorded: RecordedAnswer): HttpResponse => ({
  status: recorded.status,
  headers: { "content-type": recorded.contentType },
  body: recorded.body,
});

// The one request a fake took; a test fails without it.
function onlyRequest(requests: readonly HttpRequest[]): HttpRequest {
  const [request] = requests;
  if (request === undefined || requests.length !== 1) {
    throw new Error("Expected one request.");
  }
  return request;
}

function boundaryOf(request: HttpRequest): string {
  const type = request.headers?.["content-type"];
  if (type === undefined) {
    throw new Error("The upload names no content type.");
  }
  return type.replace("multipart/form-data; boundary=", "");
}

function bytesOf(request: HttpRequest): Readonly<Uint8Array> {
  if (request.bodyBytes === undefined) {
    throw new Error("The upload sent no bytes.");
  }
  return request.bodyBytes;
}

describe("the Flap upload API", () => {
  it("sends the picture and metadata as the GraphQL multipart request Flap's docs show", async () => {
    const http = flapApiFake();
    await expect(uploadMetadata(http, upload, signal)).resolves.toStrictEqual({
      ok: true,
      value: recordedCid,
    });
    const request = onlyRequest(http.requests());
    const boundary = boundaryOf(request);
    const body = Buffer.from(bytesOf(request)).toString("latin1");
    expect(request.url).toBe("https://funcs.flap.sh/api/upload");
    expect(body.split(`--${boundary}`)).toHaveLength(5);
    expect(body).toContain('name="operations"\r\n\r\n{"query":"mutation Create($file: Upload!');
    expect(body).toContain(
      '"variables":{"file":null,"meta":{"description":"A cat on the moon","website":"https://moon.example","twitter":null,"telegram":null,"creator":"0x000000000000000000000000000000000000bEEF"}}',
    );
    expect(body).toContain('name="map"\r\n\r\n{"0":["variables.file"]}');
    expect(body).toContain('name="0"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n');
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  const outcomes: readonly (readonly [string, HttpResponse, string])[] = [
    ["GraphQL errors", apiAnswer(200, { errors: [{ message: "bad file" }] }), "refused"],
    ["a refusal", apiAnswer(400, { error: "INVALID_REQUEST" }), "refused"],
    ["a picture too large", apiAnswer(413, { error: "REQUEST_TOO_LARGE" }), "too_large"],
    ["a rate limit", apiAnswer(429, { error: "slow down" }), "rate_limited"],
    ["a server fault", apiAnswer(503, { error: "upstream" }), "unavailable"],
    ["a page that is no API", htmlNotFound, "unavailable"],
    ["an answer of another shape", apiAnswer(200, { data: { create: "not a cid" } }), "bad_answer"],
  ];

  it.each(outcomes)("answers %s with its own outcome", async (_name, answer, failure) => {
    const http = flapApiFake([], answer);
    await expect(uploadMetadata(http, upload, signal)).resolves.toStrictEqual({
      ok: false,
      error: failure,
    });
  });

  it("reads each of Flap's pin statuses", async () => {
    const statuses = ["queued", "retrieving", "processing", "not_found", "pinned", "failed", "new"];
    const http = flapApiFake(statuses.map((status) => pinAnswer(status)));
    // The fake answers in the order the reads reach it, which is the order they are made.
    const read = await Promise.all(
      statuses.map(async () => readPinStatus(http, recordedCid, signal)),
    );
    expect(read).toStrictEqual(
      ["pending", "pending", "pending", "pending", "pinned", "failed", "pending"].map((value) => ({
        ok: true,
        value,
      })),
    );
    expect(http.urls()[0]).toBe(`https://funcs.flap.sh/api/v1/ipfs/pins?cid=${recordedCid}`);
  });

  it("reads a status of another CID, or a refused read, as a failure", async () => {
    const other = flapApiFake([pinAnswer("pinned", "bafkreiother0000000000000000000000")]);
    await expect(readPinStatus(other, recordedCid, signal)).resolves.toStrictEqual({
      ok: false,
      error: "bad_answer",
    });
    const refused = flapApiFake([apiAnswer(400, { error: "INVALID_REQUEST" })], uploadAnswer);
    await expect(readPinStatus(refused, recordedCid, signal)).resolves.toStrictEqual({
      ok: false,
      error: "refused",
    });
  });

  it("writes the live test upload's request byte for byte, and reads its answers", async () => {
    const live = flapApiFake([answerOf(livePinAnswer)], answerOf(liveUploadAnswer));
    const image = { bytes: livePng, contentType: "image/png", fileName: "image.png" };
    const cid = await uploadMetadata(live, { image, metadata: liveMetadata }, signal);
    expect(cid).toStrictEqual({ ok: true, value: liveCid });
    const sent = onlyRequest(live.requests());
    expect(Buffer.from(bytesOf(sent)).toString("base64")).toBe(liveUploadBody);
    await expect(readPinStatus(live, liveCid, signal)).resolves.toStrictEqual({
      ok: true,
      value: "pinned",
    });
    expect(JSON.stringify(livePinFields)).toBe(livePinAnswer.body);
  });
});
