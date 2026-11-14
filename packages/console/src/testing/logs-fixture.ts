import type { FakeAnswers } from "./fake-client";

// What a logs screen test's engine answers (decision 0446): two lines as the support bundle's
// field rules keep them, one with a host held back, and two lines left out.

const lines = [
  {
    time: "2026-11-14T08:00:01.000Z",
    level: "info",
    subsystem: "engine.server",
    event: "server.listening",
  },
  {
    time: "2026-11-14T08:00:02.000Z",
    level: "warn",
    subsystem: "engine.orders",
    event: "order.skipped",
    fields: { orderId: "ord_0190f1c2-3a4b-7c5d-8e6f-000000000001", host: "[omitted]" },
  },
];

/** The fake engine's answers for the logs screen. */
export const logsAnswers: FakeAnswers = {
  "log/recent": () => ({ items: lines, omitted: 2 }),
};
