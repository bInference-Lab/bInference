/**
 * The Chinese lines a Flap launch card shows for the fork test's settings: 3% on a buy, 5% on a
 * sale, paid to `recipient` as a card shortens it, 10% burned, for 365 days.
 */
export function flapSettingLinesZh(recipient: string): readonly string[] {
  return [
    "每笔买入的交易税：3.00%",
    "每笔卖出的交易税：5.00%",
    `交易税支付给 ${recipient}`,
    "交易税中销毁：10.00%",
    "交易税持续 365 天",
  ];
}

/** How the Chinese warning of a first buy with no minimum on chain starts. */
export const unboundFirstBuyZh: RegExp = /^⚠️ 首笔买入在链上没有最低数量/;
