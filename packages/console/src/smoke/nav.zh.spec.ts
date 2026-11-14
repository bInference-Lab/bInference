import { expect, test } from "@playwright/test";
import { chineseNav } from "./chinese-nav.zh";
import {
  expectSectionsOnOneLine,
  expectSectionsScrollOnAPhone,
  openOnAPhone,
  openSystemPage,
} from "./smoke-nav";
import { openPaired, ownerReadsChinese, shootThemes } from "./smoke-page";

ownerReadsChinese();

test("puts the sections on one line in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const problems = await openPaired(page, request);
  await openSystemPage(page, chineseNav, "日志");
  await expectSectionsOnOneLine(page, chineseNav);
  await shootThemes(page, testInfo, "nav-1280-zh");
  expect(problems).toStrictEqual([]);
});

test("scrolls the sections sideways on a phone in Chinese, in light and in dark", async ({
  page,
  request,
}, testInfo) => {
  const opened = { names: chineseNav, path: "/plugins", heading: "插件" };
  const problems = await openOnAPhone(page, request, opened);
  await expectSectionsScrollOnAPhone(page, chineseNav);
  await shootThemes(page, testInfo, "nav-375-zh");
  expect(problems).toStrictEqual([]);
});
