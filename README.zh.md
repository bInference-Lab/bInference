<p align="center">
  <img src=".github/assets/header.zh.png" alt="bInference：你自己的 AI Agent，专注 BNB Smart Chain，就在你的口袋里" width="100%">
</p>

<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# bInference

bInference 是一个面向 BNB Smart Chain 的开源 AI Agent。你可以把它部署成交易员、研究员、KOL、开发者，或任何你需要的角色。它运行在你自己的机器上，你在 Telegram 和其他渠道上指挥它。

Hermes Agent、Meta 的 Muse 和 OpenClaw 是面向日常生活的 AI Agent。bInference 能做到它们能做的事，并且专为区块链打造：它深入了解 BNB Smart Chain，在链上交易、调研和执行时，比通用 Agent 更专业。

**你的钱包，你的规则，你来确认。** Agent 用它自己的钱包、在你设定的限额内交易。默认情况下，没有你的确认什么都不会发生；开启自动模式后，它会在你的限额内自动交易，并在事后告诉你。

[官网](https://binference.io) · [X](https://x.com/getbinference)

> [!IMPORTANT]
> bInference 正在开发中，尚不能用于真实资金。

## 它能做什么

### 交易所有 BSC 发射台 <img src=".github/assets/logos/flap.png" width="18" height="18" alt="Flap">&nbsp;<img src=".github/assets/logos/four-meme.png" width="18" height="18" alt="four.meme">&nbsp;<img src=".github/assets/logos/genius.png" width="18" height="18" alt="Genius.fun">&nbsp;<img src=".github/assets/logos/brew.png" width="18" height="18" alt="Brew">

发射你自己的代币，抢先买入新发射的代币，在联合曲线上交易，并跟随每个代币进入流动性池。

### 兑换与自动化 <img src=".github/assets/logos/pancakeswap.png" width="18" height="18" alt="PancakeSwap">&nbsp;<img src=".github/assets/logos/kyberswap.png" width="18" height="18" alt="KyberSwap">&nbsp;<img src=".github/assets/logos/okx.png" width="18" height="18" alt="OKX">

在 PancakeSwap、KyberSwap 和 OKX 之间寻找最优价格。限价单、止盈、止损、追踪止损、定投和跟单，批准后由代码执行。

### 收益与跨链 <img src=".github/assets/logos/venus.png" width="18" height="18" alt="Venus">&nbsp;<img src=".github/assets/logos/lista.png" width="18" height="18" alt="Lista">&nbsp;<img src=".github/assets/logos/aave.png" width="18" height="18" alt="Aave">&nbsp;<img src=".github/assets/logos/bnb.png" width="18" height="18" alt="BNB">&nbsp;<img src=".github/assets/logos/across.png" width="18" height="18" alt="Across">&nbsp;<img src=".github/assets/logos/relay.png" width="18" height="18" alt="Relay">&nbsp;<img src=".github/assets/logos/lifi.png" width="18" height="18" alt="LI.FI">

在 Venus、Lista 和 Aave 上借贷，质押 BNB，并通过 Across、Relay 和 LI.FI 跨链到其他网络。

### 调研 <img src=".github/assets/logos/x.png" width="18" height="18" alt="X">&nbsp;<img src=".github/assets/logos/binance.png" width="18" height="18" alt="Binance Square">&nbsp;<img src=".github/assets/logos/web.png" width="18" height="18" alt="Any web page">

阅读 X、Binance Square 和任何网页，在你做决定之前讲清楚一个代币、一个叙事或一个钱包。如果某个想法来自它读到的外部内容，卡片上会标明。

### 市场情报 <img src=".github/assets/logos/gmgn.png" width="18" height="18" alt="GMGN">&nbsp;<img src=".github/assets/logos/dexscreener.png" width="18" height="18" alt="DEX Screener">&nbsp;<img src=".github/assets/logos/geckoterminal.png" width="18" height="18" alt="GeckoTerminal">&nbsp;<img src=".github/assets/logos/birdeye.png" width="18" height="18" alt="Birdeye">&nbsp;<img src=".github/assets/logos/okx.png" width="18" height="18" alt="OKX">

来自 GMGN、DEX Screener、GeckoTerminal、Birdeye 和 OKX 的价格、图表、流动性、持有者、新发射代币和聪明钱钱包。

### 完整链上访问 <img src=".github/assets/logos/bnb.png" width="18" height="18" alt="BNB Chain">&nbsp;<img src=".github/assets/logos/alchemy.png" width="18" height="18" alt="Alchemy">&nbsp;<img src=".github/assets/logos/quicknode.png" width="18" height="18" alt="QuickNode">&nbsp;<img src=".github/assets/logos/nodereal.png" width="18" height="18" alt="NodeReal">&nbsp;<img src=".github/assets/logos/ankr.png" width="18" height="18" alt="Ankr">&nbsp;<img src=".github/assets/logos/chainstack.png" width="18" height="18" alt="Chainstack">

通过公共 BNB Chain RPC，或你自己的 Alchemy、QuickNode、NodeReal、Ankr、Chainstack 密钥，读取 BSC 上的任何合约、钱包或交易，并自动切换备用节点。

### Agent 托管钱包 <img src=".github/assets/logos/privy.png" width="18" height="18" alt="Privy">

钱包私钥保存在 Privy 的安全隔区中，从不落到你的机器上。Agent 只能在仅由你修改的策略范围内签名，即使机器丢失，资产也不会丢失。

### 私密执行 <img src=".github/assets/logos/48club.png" width="18" height="18" alt="48 Club">&nbsp;<img src=".github/assets/logos/blockrazor.png" width="18" height="18" alt="BlockRazor">&nbsp;<img src=".github/assets/logos/bloxroute.png" width="18" height="18" alt="bloXroute">&nbsp;<img src=".github/assets/logos/pancakeswap.png" width="18" height="18" alt="PancakeSwap MEV Guard">

每笔交易都先经过模拟，再通过 48 Club、BlockRazor、bloXroute 或 PancakeSwap MEV Guard 私密发送，让抢跑机器人无从下手。

### 代币安全 <img src=".github/assets/logos/goplus.png" width="18" height="18" alt="GoPlus">&nbsp;<img src=".github/assets/logos/honeypot.png" width="18" height="18" alt="honeypot.is">

买入任何陌生代币之前，GoPlus、honeypot.is 和它自己的买入卖出模拟会揪出貔貅盘、隐藏交易税和所有者的花招。

### 提醒与自动化 <img src=".github/assets/logos/tradingview.png" width="18" height="18" alt="TradingView">

价格和钱包提醒、定时检查（“每天早上检查我的投资组合”），以及触发你预先批准的订单的 TradingView 提醒。

### 投资组合

持仓、按平均成本计算的盈亏、每日总结，以及每一笔成交的 CSV。

### 域名与身份 <img src=".github/assets/logos/spaceid.png" width="18" height="18" alt="SPACE ID">

向 `.bnb` 域名转账，并通过 ERC-8004 为每个 Agent 进行链上登记。

### 学习你的交易方式

记住你的策略和笔记，并添加来自 Binance Skills Hub、BNB Chain、PancakeSwap 和 Flap 的技能。

## Binance Agent <img src=".github/assets/logos/binance.png" width="20" height="20" alt="Binance">

连接你在 Binance Agent OS 上运行的 Agent，在一处统一管理：

- **查看** 它们的每一笔交易，包括价格和结果。
- **限制** 每个 Agent 可以花费和交易的范围。
- **暂停或停止** 任何 Agent，只需点一下。
- **证明** 收益，凭经过验证的交易记录。
- **交易** 你的 Binance 子账户，凭证由 Binance 保管。

## 不只是交易

Agent 随 bInference 一起成长：bInference 路线图上的每项能力都会加入 Agent。

- **短片**：用 bInference Motion Engine 制作世界级的动态短片，可直接发布到 X 和 Binance Square。
- **私密 AI**：通过 bInference Router 匿名使用 AI，涵盖数百个各类模型；处理敏感内容时，可使用端到端加密的私密模型。

## 你的机器，你来掌控 <img src=".github/assets/logos/telegram.png" width="20" height="20" alt="Telegram">&nbsp;<img src=".github/assets/logos/claude.png" width="20" height="20" alt="Claude Code">&nbsp;<img src=".github/assets/logos/codex.png" width="20" height="20" alt="Codex">&nbsp;<img src=".github/assets/logos/mcp.png" width="20" height="20" alt="MCP">

你可以用自己的密钥在自己的电脑或服务器上运行 bInference，也可以在 binference.io 上一键部署到 bInference Cloud，无需任何设置。无论哪种方式，钱包都是归你所有的 Privy 钱包：任何机器都不会持有钱包私钥，而且只有你能修改的策略限定了任何机器可以签署的内容。你可以在 Telegram、网页控制台（也可作为 Mini App 在 Telegram 中打开）、终端，或从 Claude Code、Codex 和任何 MCP 客户端与它沟通。

运行一个或多个 Agent，每个都有自己的钱包和限额，支持中文和英文。AI 默认由 bInference Router 提供；任何兼容的模型服务商也都可以使用，包括本地模型。

## 安全设计 <img src=".github/assets/logos/safe.png" width="20" height="20" alt="">

- 默认的手动模式下，每笔交易都以卡片形式出现，列明准确金额、费用和模拟结果。点一下即发送；不回复就等于拒绝。
- 自动模式在你的限额内交易，并在每笔交易后发送回执。转账、跨链、发币以及任何超出限额的操作仍需你确认。
- 点了确认也照样有效的限额：单笔上限和 24 小时上限、滑点和交易税上限，以及决定资金可以转往何处的转账级别。
- 资金只能转往你的紧急转出地址或你保存过的地址，即使机器被入侵，攻击者也无法把资金转走。
- 每个新 Agent 都从模拟模式开始，使用虚拟资金和真实报价。
- `/freeze` 立即停止一切。`/rescue` 把全部资金转回你自己的钱包。

## 安装 <img src=".github/assets/logos/apple.png" width="20" height="20" alt="macOS">&nbsp;<img src=".github/assets/logos/windows.png" width="20" height="20" alt="Windows">&nbsp;<img src=".github/assets/logos/linux.png" width="20" height="20" alt="Linux">&nbsp;<img src=".github/assets/logos/docker.png" width="20" height="20" alt="Docker">

macOS 和 Linux：

```bash
curl -fsSL https://binference.io/install.sh | sh
binference init
```

在 Windows 上，于 PowerShell 中运行：

```powershell
irm https://binference.io/install.ps1 | iex
```

支持 macOS、Windows 和 Linux，可运行在你的电脑、服务器或 Docker 中。自托管的 Agent 不收取任何费用。不想自己设置？可以在 [binference.io](https://binference.io) 上部署到 bInference Cloud。

## 参与贡献

请阅读 [AGENTS.md](AGENTS.md)：无论是人还是编程 Agent，每一次修改都要遵守其中的规则。

## 安全

请通过 [GitHub 安全公告](../../security/advisories/new) 私下报告安全问题，切勿在公开 issue 中提交。

## 许可证

MIT
