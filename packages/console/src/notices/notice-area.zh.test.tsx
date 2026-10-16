// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { shownNoticeTable } from "../testing/shown-notice-table";

afterEach(cleanup);

describe("the console's notice area, in Chinese", () => {
  it("shows every notice of spec 4 in Chinese (Y12)", async () => {
    const shown = await shownNoticeTable("zh");
    const lines = Object.values(shown).flat();
    expect(lines.length).toBeGreaterThanOrEqual(Object.keys(shown).length);
    expect(lines.filter((line) => line.trim() === "")).toStrictEqual([]);
    expect(lines.filter((line) => /notice\.|[{}]/u.test(line))).toStrictEqual([]);
    expect(shown["notice.lowGas"]?.map((line) => line.trim())).toStrictEqual([
      "Main 仅剩 0.001 FAKE 可付网络费。请充值 BNB。",
    ]);
    expect(shown["notice.newDevice"]).toStrictEqual(["已配对新的控制台设备：Laptop"]);
  });
});
