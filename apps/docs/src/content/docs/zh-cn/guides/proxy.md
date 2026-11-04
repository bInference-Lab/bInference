---
title: 使用代理
description: 让 binference 的每个外发请求都经过你的 HTTP 或 HTTPS 代理，选择哪些请求直连，并检查代理。
---

如果你的网络只能通过代理访问互联网，请在 `network.proxy` 中写明代理。引擎和 Agent 的每个外发请求和 WebSocket 都会以隧道方式经过它：Telegram、模型服务商、Privy、RPC 节点和私密发送通道、行情、风险和跨链接口、浏览器通知，以及插件的请求。代理无法使用时，binference 从不绕过它直接发送这些请求。

## 设置代理

代理是一个 `http://` 或 `https://` 地址，需要时包含用户名和密码，例如 `http://user:password@proxy.example.net:3128`。因为它可能包含密码，配置只接受密钥来源，从不接受明文：

```json5
network: {
  proxy: { fromKeychain: "binference-proxy" },
}
```

`fromKeychain`、`fromFile`、`fromCommand` 和 `fromEnv` 都可以使用。`binference start` 安装的后台服务读不到你 shell 中的变量，因此以后台服务运行引擎时，建议使用钥匙串或文件。

设置时，`binference init --proxy` 接受同样的密钥来源，让 init 自己的检查也经过代理，并把它写入 `config.json5`。直接在命令行中输入的地址会被拒绝，这样地址不会留在 shell 的历史记录中；不含密码的地址可以通过 `BINFERENCE_INIT_PROXY` 或应答文件的 `proxy` 键提供。

不支持 SOCKS 代理，配置中也没有私有证书颁发机构的设置。

## 哪些请求直连

发往本机（`localhost` 和回环地址）以及非互联网地址（私有、链路本地和运营商地址段）的请求总是直连。`network.noProxy` 列出更多直连的主机，最多 256 个：

```json5
network: {
  proxy: { fromFile: "~/.binference/secrets/proxy" },
  noProxy: ["127.0.0.1", "localhost", "internal.example", "rpc.example.net:8545"],
}
```

每一项可以是表示所有主机的 `*`；punycode 形式的域名，同时覆盖它下面的子域名；IP 地址或 `[IPv6]` 地址，以上都可以带 `:port`；或者地址段，例如 `10.0.0.0/8`。binference 按书写的形式匹配域名，从不通过解析域名来判断。

## 代理出错时

- 如果配置中的代理无法读取，或者不是 `http://` 或 `https://` 地址，它本应转发的每个请求都会等待，没有任何请求直连。
- 代理拒绝密码、拒绝连接或无法连接时，请求会失败，错误为 `http.proxy_auth`、`http.proxy_refused` 或 `http.proxy_unreachable`。
- 代理地址从不出现在日志、错误、通知、`binference check` 或诊断包中。

## 运行中修改

binference 在每个请求时读取 `network`，因此对 `config.json5` 的修改立即生效：新请求走新的路由，已打开的 WebSocket 会关闭并经新代理重新打开。[`configChanged`](/zh-cn/reference/notices/#configchanged) 通知会说明新代理是否有回应。

## 检查代理

`binference check` 以 `network.proxy` 一项测试代理：在 10 秒内经代理访问 Telegram，否则说明原因。`network.cleartext` 一项会提醒两种情况：代理在另一台机器上、地址以 `http://` 开头且带密码，此时密码以明文传输；以及以 `http://` 开头的 RPC 节点，代理可以读取并篡改它们的回答。

## 更新

`binference update` 也会把代理交给 npm。代理无法读取时，它会以 `update.proxy_held` 停止，不做任何修改。

## 另请参阅

- [配置项](/zh-cn/reference/config/)：`network.proxy` 和 `network.noProxy`。
- [命令](/zh-cn/reference/commands/)：`init --proxy` 和 `check`。
