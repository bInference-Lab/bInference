/**
 * The Chinese lines a Genius.fun launch card shows for the fork test's settings: the launch fee,
 * the creator fees paid to `recipient` as a card shortens it, and the picture link whole.
 */
export function geniusfunSettingLinesZh(recipient: string, link: string): readonly string[] {
  return [
    "发射手续费 0.002 BNB",
    `每笔交易的创建者费用归 ${recipient}`,
    `图片地址 ${link}（binference 从不打开它）`,
  ];
}
