// Flap's API as it answered binference's one live test upload on 2026-10-20, from funcs.flap.sh:
// the upload of a 1x1 PNG with the description "binference test upload, no token", no links and
// the zero address as creator, then one pin status read of its CID. No gateway was read.

/** The metadata CID the live upload answered. */
export const liveCid = "bafkreihkwrjts7hqtry4iub3yeaicqrwbmpfi47rcdjtegrbq4o2rru36e";

/** The 1x1 PNG the live upload sent. */
export const livePng: Uint8Array = Uint8Array.from(
  Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
      "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
    "hex",
  ),
);

/** The words the live upload sent. */
export const liveMetadata: {
  readonly description: string;
  readonly website: null;
  readonly twitter: null;
  readonly telegram: null;
  readonly creator: string;
} = {
  description: "binference test upload, no token",
  website: null,
  twitter: null,
  telegram: null,
  creator: "0x0000000000000000000000000000000000000000",
};

/** The live upload's body, base64: the GraphQL multipart request the client wrote. */
export const liveUploadBody: string =
  "LS1iaW5mZXJlbmNlLThkMGUxNjI4M2VhOTg5ZTMxZGEwNDkzZTZiMmFjN2U1NjU2NTZjMmE5NzY4MDk4ODg0YmM4ZmViYWE0NzEyYjcNCkNvbnRlbnQtRGlzcG9zaXRpb246IGZvcm0tZGF0YTsgbmFtZT0ib3BlcmF0aW9ucyINCg0KeyJxdWVyeSI6Im11dGF0aW9uIENyZWF0ZSgkZmlsZTogVXBsb2FkISwgJG1ldGE6IE1ldGFkYXRhSW5wdXQhKSB7IGNyZWF0ZShmaWxlOiAkZmlsZSwgbWV0YTogJG1ldGEpIH0iLCJ2YXJpYWJsZXMiOnsiZmlsZSI6bnVsbCwibWV0YSI6eyJkZXNjcmlwdGlvbiI6ImJpbmZlcmVuY2UgdGVzdCB1cGxvYWQsIG5vIHRva2VuIiwid2Vic2l0ZSI6bnVsbCwidHdpdHRlciI6bnVsbCwidGVsZWdyYW0iOm51bGwsImNyZWF0b3IiOiIweDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAifX19DQotLWJpbmZlcmVuY2UtOGQwZTE2MjgzZWE5ODllMzFkYTA0OTNlNmIyYWM3ZTU2NTY1NmMyYTk3NjgwOTg4ODRiYzhmZWJhYTQ3MTJiNw0KQ29udGVudC1EaXNwb3NpdGlvbjogZm9ybS1kYXRhOyBuYW1lPSJtYXAiDQoNCnsiMCI6WyJ2YXJpYWJsZXMuZmlsZSJdfQ0KLS1iaW5mZXJlbmNlLThkMGUxNjI4M2VhOTg5ZTMxZGEwNDkzZTZiMmFjN2U1NjU2NTZjMmE5NzY4MDk4ODg0YmM4ZmViYWE0NzEyYjcNCkNvbnRlbnQtRGlzcG9zaXRpb246IGZvcm0tZGF0YTsgbmFtZT0iMCI7IGZpbGVuYW1lPSJpbWFnZS5wbmciDQpDb250ZW50LVR5cGU6IGltYWdlL3BuZw0KDQqJUE5HDQoaCgAAAA1JSERSAAAAAQAAAAEIBgAAAB8VxIkAAAANSURBVHicY2AAAAIAAVSiT10AAAAASUVORK5CYIINCi0tYmluZmVyZW5jZS04ZDBlMTYyODNlYTk4OWUzMWRhMDQ5M2U2YjJhYzdlNTY1NjU2YzJhOTc2ODA5ODg4NGJjOGZlYmFhNDcxMmI3LS0NCg==";

/** A recorded answer: its HTTP status, its content type and its body. */
export interface RecordedAnswer {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/** The upload's answer: HTTP 200, `application/json`, the metadata's CID. */
export const liveUploadAnswer: RecordedAnswer = {
  status: 200,
  contentType: "application/json",
  body: '{"data":{"create":"bafkreihkwrjts7hqtry4iub3yeaicqrwbmpfi47rcdjtegrbq4o2rru36e"}}',
};

/**
 * The pin status read's answer, a moment after the upload: HTTP 200, `application/json`, already
 * pinned. It names no `jobId`, unlike the docs' example, and adds the pinned file's name, size
 * and time.
 */
export const livePinAnswer: RecordedAnswer = {
  status: 200,
  contentType: "application/json",
  body: '{"data":{"cid":"bafkreihkwrjts7hqtry4iub3yeaicqrwbmpfi47rcdjtegrbq4o2rru36e","status":"pinned","providerStatus":"pinned","name":"metadata.json","sizeBytes":292,"numberOfFiles":1,"pinnedAt":"2026-10-20T13:24:47.388Z","alreadyPinned":true},"requestId":"43e5ff85-6853-4bc1-917a-d7b456496714"}',
};

/** The pin status answer's fields, as {@link livePinAnswer} writes them, in its order. */
export const livePinFields: {
  readonly data: Readonly<Record<string, string | number | boolean>>;
  readonly requestId: string;
} = {
  data: {
    cid: "bafkreihkwrjts7hqtry4iub3yeaicqrwbmpfi47rcdjtegrbq4o2rru36e",
    status: "pinned",
    providerStatus: "pinned",
    name: "metadata.json",
    sizeBytes: 292,
    numberOfFiles: 1,
    pinnedAt: "2026-10-20T13:24:47.388Z",
    alreadyPinned: true,
  },
  requestId: "43e5ff85-6853-4bc1-917a-d7b456496714",
};
