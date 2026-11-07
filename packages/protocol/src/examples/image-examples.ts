import type { ImageOperationShapes } from "../operations/image-operations.schema.js";
import { ids, type WireExample } from "./wire-values.js";

const empty = {};

/** Example calls of the agent's image operations. */
export const imageExamples: { readonly [N in keyof ImageOperationShapes]: WireExample } = {
  "inbox/readImage": {
    args: { agent: ids.agent, message: ids.message, image: "tg:AgACAgIAAxkBAAIB" },
    result: { contentType: "image/png", bytes: 8, offset: 0, data: "iVBORw0KGgo=" },
  },
  "image/view": {
    args: { agent: ids.agent, url: "https://example.com/chart.png" },
    result: { contentType: "image/png", bytes: 8, offset: 0, data: "iVBORw0KGgo=" },
  },
  "image/store": {
    args: {
      agent: ids.agent,
      job: "a1b2c3d4e5f60718",
      place: 0,
      offset: 0,
      total: 8,
      data: "iVBORw0KGgo=",
    },
    result: {
      image: "a1b2c3d4e5f607180",
      path: "/var/lib/binference/workspace/media/made/2026-11-07/a1b2c3d4e5f607180.png",
    },
  },
  "image/made": {
    args: {
      agent: ids.agent,
      session: ids.session,
      turn: ids.turn,
      surface: "console",
      prompt: "A round logo of a green frog on a dark blue field, flat style.",
      images: ["a1b2c3d4e5f607180"],
    },
    result: empty,
  },
  "image/show": {
    args: {
      agent: ids.agent,
      turn: ids.turn,
      paths: ["media/made/2026-11-07/a1b2c3d4e5f60718.png"],
      caption: "The logo made today.",
    },
    result: {
      images: [
        {
          image: "b2c3d4e5f6071829",
          path: "media/made/2026-11-07/a1b2c3d4e5f60718.png",
        },
      ],
    },
  },
  "image/read": {
    args: { agent: ids.agent, image: "a1b2c3d4e5f607180" },
    result: { contentType: "image/png", bytes: 8, offset: 0, data: "iVBORw0KGgo=" },
  },
};
