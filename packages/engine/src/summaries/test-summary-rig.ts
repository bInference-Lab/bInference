import { createFormatter, type MessageLocale, writeNotice } from "@binference/i18n";
import { live } from "../contracts/store-fixtures.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticeSchema } from "../pushes/notice-push.js";
import {
  createDailySummaries,
  type DailySummaries,
  type DailySummaryOptions,
} from "./daily-summaries.js";
import { type DayRig, type DayRigOptions, startDayRig } from "./test-summary-parts.js";

/** The fixture's agent with its daily summaries: what they published, and their runs. */
export interface SummaryRig extends DayRig {
  readonly pushes: readonly EnginePush[];
  /** A summary run as the engine runs one now. */
  readonly run: () => Promise<void>;
  /** Makes the summaries again on the same stores, as a restart does. */
  readonly restart: () => void;
}

/** What the rig starts from, and what a test changes in the parts the summaries run on. */
export interface SummaryRigOptions extends DayRigOptions {
  readonly wrap?: (options: DailySummaryOptions) => DailySummaryOptions;
}

/** The fixture's agent and the daily summaries over its stores, on the rig's own clock. */
export async function startSummaryRig(options: SummaryRigOptions = {}): Promise<SummaryRig> {
  const rig = await startDayRig(options);
  const pushes: EnginePush[] = [];
  const wrap = options.wrap ?? ((given: DailySummaryOptions) => given);
  const make = (): DailySummaries =>
    createDailySummaries(
      wrap({
        ...rig.parts,
        agents: rig.test.stores.agents,
        summaries: rig.test.stores.dailySummaries,
        ownerTimeZone: rig.zone,
        clock: rig.clock,
        publish: (push) => pushes.push(push),
      }),
    );
  const made = { summaries: make() };
  return {
    ...rig,
    pushes,
    run: async () => made.summaries.run(live()),
    restart: () => {
      made.summaries = make();
    },
  };
}

/** The daily summaries the rig published, as the owner reads them in the language. */
export function summariesIn(rig: SummaryRig, locale: MessageLocale): readonly string[] {
  const formatter = createFormatter({ locale, timeZone: rig.zone() });
  const { chains } = rig.test.engineOptions;
  return rig.pushes
    .filter(({ kind }) => kind === "notice/new")
    .map((push) => noticeSchema.parse(push.data))
    .filter(({ key }) => key === "notice.daily")
    .map((notice) =>
      writeNotice(notice, { formatter, assetInfo: (asset) => assetInfoOf(chains, asset) }),
    );
}
