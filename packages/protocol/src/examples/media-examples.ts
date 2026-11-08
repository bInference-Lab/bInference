import type { MediaOperationShapes } from "../operations/media-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

const empty = {};

const video = {
  media: "d4e5f60718293a4b",
  kind: "video",
  contentType: "video/mp4",
  bytes: 2_481_502,
  path: "/srv/binference/workspace/media/made/2026-11-08/d4e5f60718293a4b.mp4",
};

const voice = {
  media: "e5f60718293a4b5c",
  kind: "voice",
  contentType: "audio/mp4",
  bytes: 41_210,
  path: "/srv/binference/workspace/media/speech/2026-11-08/e5f60718293a4b5c.m4a",
};

/** Example calls of the operations of the videos and speech the agent makes (decision 0405). */
export const mediaExamples: { readonly [N in keyof MediaOperationShapes]: WireExample } = {
  "media/store": {
    args: {
      agent: ids.agent,
      job: "f60718293a4b5c6d",
      kind: "video",
      offset: 0,
      total: 2_481_502,
      data: "AAAAHGZ0eXBpc29t",
    },
    result: {},
  },
  "media/made": {
    args: {
      agent: ids.agent,
      session: ids.session,
      turn: ids.turn,
      surface: "telegram",
      prompt: "A paper boat drifts across a calm pond at sunrise, slow tracking shot.",
      media: video.media,
    },
    result: empty,
  },
  "media/send": {
    args: { agent: ids.agent, turn: ids.turn, media: voice.media },
    result: empty,
  },
  "media/read": {
    args: { agent: ids.agent, media: video.media },
    result: {
      contentType: "video/mp4",
      bytes: 2_481_502,
      offset: 0,
      data: "AAAAHGZ0eXBpc29t",
      next: 524_288,
    },
  },
  "speech/local": {
    args: { agent: ids.agent, text: "Your BNB buy filled at 612 dollars.", voice: "Samantha" },
    result: { media: voice },
  },
};
