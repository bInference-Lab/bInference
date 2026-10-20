/**
 * The Chinese lines a Genius.fun launch card shows for the fork test's settings: the launch fee,
 * the creator fees paid to `recipient`, shown whole, and the picture link whole.
 */
export function geniusfunSettingLinesZh(recipient: string, link: string): readonly string[] {
  return [
    "发射手续费 0.002 BNB",
    `每笔交易的创建者费用留在发射台，直到 ${recipient} 领取；该地址买入时也不付狙击税`,
    `图片地址 ${link}（binference 从不打开它）`,
  ];
}
