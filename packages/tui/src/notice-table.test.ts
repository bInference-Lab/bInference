import { describe, expect, it } from "vitest";
import { printedNoticeTable, writtenNoticeTable } from "./testing/printed-notice-table.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const red = String.fromCodePoint(0x1f534);

describe("terminal chat's notices", () => {
  it("prints every notice of spec 4 in English, in the words every surface writes (Y12)", async () => {
    const expected = writtenNoticeTable("en");
    const printed = await printedNoticeTable("en");
    expect(printed).toStrictEqual(expected);
    expect(printed["notice.lowGas"]).toStrictEqual([
      `${warning} Main has 0.001 FAKE left for network fees. Add BNB.`,
    ]);
    expect(printed["notice.locked"]).toStrictEqual([
      `${red} binference restarted and is locked. Run \`binference unlock\`.`,
    ]);
  });
});
