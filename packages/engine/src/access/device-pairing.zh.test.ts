import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { newDeviceNoticeKey } from "./device-pairing.js";

describe("the new device notice in Chinese", () => {
  it("says a console device was paired, with its label", () => {
    const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });
    expect(chinese.message(newDeviceNoticeKey, { label: "Laptop" })).toBe(
      "已配对新的控制台设备：Laptop",
    );
  });
});
