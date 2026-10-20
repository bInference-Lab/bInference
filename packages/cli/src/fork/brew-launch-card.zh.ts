/**
 * The Chinese lines a Brew launch card shows for the fork test's settings: the fee, the creator
 * fees paid to `recipient`, shown whole, holder rewards off, the 8 BNB start, and Brew's warning.
 */
export function brewSettingLinesZh(recipient: string): readonly string[] {
  return [
    "发射手续费 0 BNB",
    `交易池的创建者费用存放在 Brew 的锁仓合约中，直到 ${recipient} 领取`,
    "持有者奖励：关闭",
    "起始市值约为 8 BNB，向下取整到交易池的下一个价格档位",
    "⚠️ Brew 的网站称其不向美国公民提供服务",
  ];
}
