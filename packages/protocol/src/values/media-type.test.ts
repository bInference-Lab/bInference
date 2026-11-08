import { describe, expect, it } from "vitest";
import type { MediaContentType, MediaKind } from "../operations/media-operations.schema.js";
import { mediaTypeOf } from "./media-type.js";

const ftyp = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
const ogg = [0x4f, 0x67, 0x67, 0x53, 0];

/** Bytes a medium opens with, the kind it is read as, and the format read, if any. */
interface Case {
  readonly first: readonly number[];
  readonly kind: MediaKind;
  readonly type?: MediaContentType;
}

const cases: Readonly<Record<string, Case>> = {
  "an MP4 video": { first: ftyp, kind: "video", type: "video/mp4" },
  "Ogg speech": { first: ogg, kind: "voice", type: "audio/ogg" },
  "MP3 speech with an ID3 tag": { first: [0x49, 0x44, 0x33, 4], kind: "voice", type: "audio/mpeg" },
  "MP3 speech from its first frame": {
    first: [0xff, 0xfb, 0x90],
    kind: "voice",
    type: "audio/mpeg",
  },
  "M4A speech": { first: ftyp, kind: "voice", type: "audio/mp4" },
  "speech as a video": { first: ogg, kind: "video" },
  "text as speech": { first: [0x68, 0x69], kind: "voice" },
  "nothing as speech": { first: [], kind: "voice" },
};

describe("mediaTypeOf", () => {
  it.each(Object.entries(cases))("reads %s by its first bytes alone", (_name, read: Case) => {
    expect(mediaTypeOf(new Uint8Array(read.first), read.kind)).toBe(read.type);
  });
});
