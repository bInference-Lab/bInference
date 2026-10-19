import { messages } from "@binference/i18n";
import { noticeTable } from "@binference/i18n/testing";
import { describe, expect, it } from "vitest";
import { ownerId } from "../testing/update-fixtures.js";
import { sentNoticeTable } from "./notice-table-fixtures.js";

const paper = String.fromCodePoint(0x1f9ea);
const done = String.fromCodePoint(0x2705);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const red = String.fromCodePoint(0x1f534);
const green = String.fromCodePoint(0x1f7e2);

// Every notice of spec 4, section 4, with sections 4.2 and 4.3, as the owner reads it in Chinese.
const expected: Readonly<Record<string, string>> = {
  "notice.fill": `${paper} ${done} 止盈已成交：以 $0.0000075 卖出 1.65 FAKE，收到 $12.40`,
  "notice.skipped": `${warning} 止损已跳过：钱包中这种代币不足。订单仍然有效。`,
  "notice.lowGas": `${warning} Main 仅剩 0.001 FAKE 可付网络费。请充值 BNB。`,
  "notice.orderExpiring": "限价单将于 2026年10月11日 09:30:00 到期",
  "notice.frozen": `${red} 已从 Telegram 冻结 main。请在命令行、控制台或 Mini App 中解除冻结。`,
  "notice.unfrozen": `${green} 已从 控制台 对 main 解除冻结。`,
  "notice.rescue": `${red} 已确认紧急转出：正在将全部资产转到 0x9F3c…41aB`,
  "notice.newDevice": "已配对新的控制台设备：Laptop",
  "notice.signInsLocked": `${warning} 控制台设备 Laptop 的登录失败次数过多，binference 在 2026年10月11日 09:30:00 前拒绝这些登录。这些尝试都没有登录成功。`,
  "notice.limitChange":
    "命令行 修改了限额：单笔上限将于 2026年10月11日 09:30:00 更改。不是你操作？请立即取消。",
  "notice.limitChangeCancelled": "已取消对24 小时上限的修改，当前限额保持不变",
  "notice.ceilingChange": `${warning} 已从 命令行 用所有者密钥修改 main 钱包的上限：一次合约调用最多可携带的金额。不是你操作？请立即冻结。`,
  "notice.signerRevoked": `${warning} 已从 命令行 用所有者密钥从所有钱包移除签名方 office-mac 的 Agent 密钥。持有它的机器无法再签名。不是你操作？请立即冻结。`,
  "notice.sendLevel": "转账级别 2 → 1，将于 2026年10月11日 09:30:00 生效",
  "notice.sendLevelCancelled": "已取消将转账级别改为 0，仍为 2",
  "notice.rescueStopped": `${red} 紧急转出中途停止：执行期间紧急转出地址已更改。未转出的资产仍在钱包中。请检查钱包，然后重新发起紧急转出。`,
  "notice.rescueAddress": `${warning} 紧急转出地址将于 2026年10月11日 09:30:00 改为 0x9F3c…41aB。不是你操作？请立即取消。`,
  "notice.rescueAddressCancelled": "已取消将紧急转出地址改为 0x9F3c…41aB",
  "notice.ceilingOutdated": `${warning} 各钱包的上限仍允许向 0x9F3c…41aB 转账。请用所有者密钥运行 \`binference rescue set\` 更新。`,
  "notice.plainSecret": `${warning} 配置文件中有明文密钥。请运行 \`binference check --fix\`。`,
  "notice.budget":
    "main 已用完今日模型预算（$3.00）。对话将于 2026年10月11日 09:30:00 恢复；自动订单继续运行。",
  "notice.scheduleSet":
    "main 有新的定时任务，来自 Telegram，下次运行时间 2026年10月11日 09:30:00：Review my portfolio.",
  "notice.scheduleCancelled": "main 的定时任务已由 Agent 自己取消：Review my portfolio.",
  "notice.loop": "main 重复执行同一步骤，已停止",
  "notice.watcherLag": `${warning} BNB Smart Chain 的价格读取落后链上 14 个区块，自动订单可能延迟成交。请在 config.json5 的 \`chains.rpc\` 中添加付费 RPC，或检查本机网络。`,
  "notice.watcherUnpriced": `${warning} BNB Smart Chain 的价格监控无法获取 2 个监控中代币的价格（首个为 0x9F3c…41aB），在价格恢复之前，这些代币的自动订单无法触发。价格来自发射台联合曲线，或可交易至少 $1,000 WBNB 或稳定币的 PancakeSwap 交易池。`,
  "notice.watcherStopped": `${red} BNB Smart Chain 的价格监控因故障停止，会自动重新启动；在此之前，该链上的自动订单不会成交。请运行 \`binference logs\` 查看原因。`,
  "notice.resumed": "引擎停止了 2 h：已检查 3 个订单，成交 1 个，跳过 2 个",
  "notice.update":
    "binference 2027.1.0 已发布：Stop-loss orders fill faster。请运行 `binference update`。",
  "notice.updateBare": "binference 2027.1.0 已发布。请运行 `binference update`。",
  "notice.updated": "binference 已更新到 2027.1.0。更新内容：Stop-loss orders fill faster",
  "notice.updatedBare": "binference 已更新到 2027.1.0。",
  "notice.updateRolledBack": `${warning} binference 2027.1.0 更新后未通过检查，binference 已回退到 2026.12.2。你的设置和记录与更新前一致。`,
  "notice.backupFailed": `${warning} 昨晚的备份失败：无法在 backups.copyTo 中写入第二份副本`,
  "notice.locked": `${red} binference 已重启并处于锁定状态。请运行 \`binference unlock\`。`,
  "notice.signerStopped": `${red} 签名进程已停止，binference 不会签名。请先处理 \`binference logs\` 显示的问题，再运行 \`binference unlock\`。`,
  "notice.signerRefused": `${warning} 签名进程拒绝为一笔交易的一个步骤签名：金额与这笔交易不符。该步骤未发送任何内容。`,
  "notice.privyUnreachable": `${red} binference 启动后五分钟内都无法连接 Privy，因此仍处于锁定状态。请检查本机网络，然后运行 \`binference unlock\`。`,
  "notice.configInvalid": `${warning} binference 保留了当前运行的设置：config.json5 中 telegram.mode 的值不可用。请运行 \`binference check\` 查看修复方法。`,
  "notice.configChanged": "config.json5 中的设置已更改：owner.locale。它们已立即生效。",
  "notice.unknownTx": `${warning} Main 的随机数 42 被一笔非 binference 签名的交易占用`,
  "notice.fillDiffers": `${warning} 一笔交易的成交结果与模拟结果相差超过 1%，请核对该笔交易。`,
  "notice.blockShared": `${warning} Main 的两笔交易在同一个区块上链，持仓和盈亏可能把该区块转入的币重复计算。请检查钱包。`,
  "notice.fillUnknown": `${warning} 一笔交易已上链，但已没有 RPC 能说明它收到了多少。请在配置中添加追踪 RPC 并重启 binference，以完成这笔交易的记录。`,
  "notice.notSigned": `${warning} 一笔交易在第一笔链上交易签名前已取消，未发送任何内容。`,
  "notice.confirmationLapsed": `${warning} 一笔交易未发送：它的确认在发出之前已过期。未签名任何内容。`,
  "notice.feeAboveCap": `${warning} 网络费高于你设定的上限，一笔交易一直在等待，它的确认已过期。请在新卡片上再次确认，或取消它。`,
  "notice.launchUnsent": `${warning} 一笔在发射项目联合曲线上的交易未发送：发射台已不在该联合曲线上持有此代币，例如代币已毕业。未签名任何内容。`,
  "notice.launchStopped": `${warning} MCAT 在 flap 的发射已停止：发射台未在 5 分钟内固定其图片和文字。未签名任何内容，但其图片和文字可能已在发射台公开。如仍需要，请重新发起发射。`,
  "notice.stepUnsent": `${warning} 一笔交易中途停止：前面的步骤已上链，但后面的步骤从未签名。请检查钱包。`,
  "notice.stepDropped": `${warning} 一笔交易长时间未上链，没有完成。没有任何资产变动，钱包已可再次使用。`,
  "notice.stepDroppedPartWay": `${warning} 一笔交易中途停止：前面的步骤已上链，但后面的步骤长时间未上链，没有完成。钱包已可再次使用。请检查钱包。`,
  "notice.droppedLanded": `${red} 一笔 binference 报告为长时间未上链的交易最终还是上链了。binference 已把它计入你的限额和持仓。请检查钱包。`,
  "notice.walletHeld": `${warning} Main 的一笔链上交易卡住了，该钱包之后的交易都在其后等待。binference 会继续发送它，直到区块收录它或所有中继都丢弃它。`,
  "notice.orderOverfilled": `${red} 止损的成交次数超过了上限：已成交 2 次，上限 1 次。请检查钱包和订单。`,
  "notice.fillUnvalued": `${warning} 限价单已在链上成交，但暂时无法为这笔交易估值。binference 已在订单上计入这次成交，并会继续尝试估值。`,
  "notice.fillsFailing": `${warning} 止盈已停止：最近 5 次成交都在链上失败。请检查该代币；如仍需要，请新建订单。`,
  "notice.approvalReset": `${warning} 一笔交易未能完成后面的步骤，binference 已把为 PEPE 给出的授权额度重置为零。`,
  "notice.binanceRefused": `${warning} main 尝试了超出限额的交易：buy $500 of CAKE。已拒绝。`,
  "notice.binancePaused": "已从 Mini App 暂停 main",
  "notice.approvalMode": "main 已切换为自动模式，来自 命令行",
  "notice.alertPrice":
    "PEPE 价格达到或高于 $0.00001：现价 $0.000011\nmain 正在查看。\n另有 3 个匹配未唤醒 main：每小时最多唤醒 10 次。",
  "notice.alertWallet": "Whale 卖出 2M PEPE（占其持仓的 40%），收到 $22.10",
  "notice.alertLaunch":
    "有新发射的代币通过了你的筛选条件：PEPE 0x6982…1933 · Pad · 3 分钟前 · 曲线进度 42% · 交易税 1% · 2 个内部钱包 · 创建者 30 天内其他发射：0",
  "notice.alertHeld": "main · 本小时另有 12 次匹配，请在控制台查看",
  "notice.ordersEnded": "止盈已卖出你持有的全部 PEPE，该持仓的其他 2 个平仓订单已结束",
  "notice.exitEnded": "PEPE 的追踪止损已结束：钱包中已没有这种代币",
};

describe("every notice in the owner's chat, in Chinese", () => {
  it("sends each notice to the owner's chat as the spec words it", async () => {
    const sent = await sentNoticeTable("zh");
    expect(sent.chats).toStrictEqual([ownerId]);
    expect(sent.texts).toStrictEqual(expected);
    expect(Object.keys(sent.texts)).toStrictEqual(Object.keys(noticeTable));
    expect(Object.keys(messages.zh).filter((key) => key.startsWith("notice."))).toHaveLength(
      Object.keys(noticeTable).length,
    );
  });
});
