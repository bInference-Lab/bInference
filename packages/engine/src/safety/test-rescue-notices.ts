import { type AccountRef, accountRefSchema, chainRefSchema } from "@binference/chain";
import { createFormatter, writeNotice } from "@binference/i18n";
import { z } from "zod";
import type { RescueReachRecord, RescueReachState } from "../install/rescue-record.js";
import { testAgent } from "../intents/test-intents.js";
import { standingNotices } from "./rescue-bridged-notice.js";

const agent = { id: testAgent, name: "main" };

// The two destinations the words name: the fake bridge's, and one of another kind.
const destinations = [
  { ref: chainRefSchema.parse("fake:2"), name: "Fake Two" },
  { ref: chainRefSchema.parse("other:3"), name: "Other Three" },
];

const onBase = accountRefSchema.parse("fake:2:0x000000d9");
const nextOnBase = accountRefSchema.parse("fake:2:0x000000d8");

const pushSchema = z.looseObject({
  key: z.string(),
  values: z.record(z.string(), z.string()),
  times: z.record(z.string(), z.number()).optional(),
});

/** One standing of the test agent, of the rescue address in effect on the destination unless named. */
export function standing(state: RescueReachState, account: AccountRef = onBase): RescueReachRecord {
  return { agent: testAgent, account, state };
}

/** The new rescue address on the destination. */
export const nextRescueThere: AccountRef = nextOnBase;

/**
 * The words the owner reads for the standings that changed from `before` to `after`, in the
 * language given, with a waiting address taking effect at the test's time plus a day.
 */
export function standingWords(
  locale: "en" | "zh",
  change: {
    readonly before: readonly RescueReachRecord[];
    readonly after: readonly RescueReachRecord[];
  },
): readonly string[] {
  const formatter = createFormatter({ locale, timeZone: "UTC" });
  const pushes = standingNotices(agent, {
    ...change,
    destinations,
    waitsUntilMs: Date.UTC(2026, 9, 11, 9, 30, 0),
  });
  return pushes.map((push) => {
    const data = pushSchema.parse(push.data);
    const notice = {
      key: data.key,
      values: data.values,
      ...(data.times === undefined ? {} : { times: data.times }),
    };
    return writeNotice(notice, { formatter, assetInfo: () => undefined });
  });
}
