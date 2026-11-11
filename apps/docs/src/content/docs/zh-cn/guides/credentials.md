---
title: 凭据和 API 调用
description: 把 API 密钥连同可以发送到的主机存储一次，让 Agent 调用 API 而永远看不到密钥。
---

有些任务需要 API 密钥，例如某个数据服务的密钥。你把它作为凭据存储在 binference 中。之后 Agent 用 `http_request` 调用 API，并在密钥的位置写一个占位符，binference 只在你允许的主机上把密钥填进去。密钥永远不会到达 Agent、对话、对话记录或日志。

## 存储凭据

凭据有一个按环境变量写法命名的名称（例如 `DUNE_API_KEY`）、一个值，以及它可以发送到的主机：

```sh
binference credential set DUNE_API_KEY --allow-host api.dune.com
```

值在隐藏输入框中输入；没有任何参数接受它。每个主机重复一次 `--allow-host`，最多 16 个。主机按原样精确匹配：`api.dune.com` 既不包括 `eu.api.dune.com`，也不包括 `dune.com`。再次存储同一个名称会替换它的值和主机，所以每次都要列出所有主机。没有主机的凭据，Agent 永远不会发送。

`binference credential list` 显示每个名称及其主机，从不显示值。`binference credential delete <name>` 删除一个凭据：从此任何读取都找不到它，它的值会在 30 天后彻底清除。值保存在 `engine.sqlite` 中，这个文件只有你的用户能读取，备份则用你的所有者密钥封存。

## Agent 请求凭据时

当任务需要一个你还没有存储的凭据时，Agent 会请求它，并附上名称、原因和它建议的主机。请求等待期间 Agent 的这一轮会结束，你的回复会开始它的下一轮：Agent 只知道收到了什么，永远不知道值。

- 在控制台中，消息框上方会显示一个隐藏输入框，附带你可以编辑的主机。“存储”保存凭据；“跳过”表示不提供。
- 在终端对话中，在请求下方输入值，它会显示为圆点。按 Enter 为 Agent 建议的主机存储它；按 Esc 跳过。包含多行的粘贴会被整体拒绝。
- 在 Telegram 中，机器人会告诉你去哪里回复。永远不要在 Telegram 对话中发送凭据：那里的消息会到达 Agent。
- 在命令行中，`binference credential set <name> --allow-host <host>` 同样可以回复请求。

请求保持 15 分钟，或 Agent 指定的时长（30 秒到 1 小时）。每个 Agent 同一时间只有一个未处理的凭据请求。

## 带凭据的调用

`http_request` 发出一个 HTTPS 请求：`GET`、`HEAD`、`POST`、`PUT`、`PATCH` 或 `DELETE`，最多 32 个请求头和一个文本正文。在密钥的位置，Agent 写入 `{{credential:NAME}}`：

- 在请求头的值中，例如 `Authorization: Bearer {{credential:DUNE_API_KEY}}`
- 在 URL 的查询部分中，例如 `?api_key={{credential:DUNE_API_KEY}}`
- 在正文中

只有每条规则都满足时 binference 才发送请求，否则什么都不发送：

- URL 是公网地址上的 `https:`：永远不是这台机器、私有网络，也不是 `remote.publicUrl` 中 binference 自己的地址。
- 每个占位符都指向一个已存储的凭据，且该凭据的主机包括 URL 的主机，端口为默认的 443。
- 占位符只能放在请求头的值、查询部分或正文中，永远不能放在主机或路径中。
- 在读过外部内容的对话中，带凭据的请求只能使用 `GET` 或 `HEAD`，这样网页就无法让 Agent 以你的账户发布、下单或删除内容。请发送 `/clear` 后重新提问。

重定向永远不会被跟随：Agent 拿到新地址后再调用一次，新地址单独判断。每次调用有 1 到 25 秒，默认 20 秒。Agent 读取状态、内容类型和速率限制等少数响应头，以及最多 10,000 个字符的正文；超过 8 MiB 的响应不会被读取。在 Agent 读取任何内容之前，响应中凡是重复请求所带的值（无论原样还是百分号编码）的地方，binference 都会重新写成占位符。网站返回的一切都是外部内容。

日志为每个请求记一行：方法、主机、状态和耗时，从不记录路径、查询部分、请求头或正文。

## 它做不到的事

- API 以其他形式（例如 base64）重复的密钥不会被隐藏。
- 把密钥放在 URL 路径中，或使用由用户名和密码组成的 Basic 认证的 API，无法用占位符调用。
- 超过 25 秒才回复的 API 无法调用。
- 助手永远不会得到 `http_request`，Agent 的命令也永远拿不到凭据。

不带占位符时，`http_request` 可以访问任何公网 HTTPS 地址，与 Agent 的命令行工具能访问的范围相同。

## 在配置中使用凭据

接受密钥来源的配置项可以指向一个已存储的凭据，这样一份存储的副本同时供 Agent 和配置使用：

```sh
binference config set search.keys.brave --from-credential BRAVE_KEY
```

这会写入 `{ fromCredential: "BRAVE_KEY" }`。只有运行中的引擎会读取它，并且它会发送到该配置项发送的任何地方，与凭据列出的主机无关。Agent 密钥和 Privy 应用密钥永远不会来自凭据。删除某个配置项指向的凭据后，从下次启动起该配置项就没有值了。

## 另请参阅

- [命令](/zh-cn/reference/commands/)：`credential` 和 `config set`。
- [配置项](/zh-cn/reference/config/)：接受密钥来源的配置项。
- [Agent 工具和 MCP 工具](/zh-cn/reference/agent-and-mcp-tools/)：`credentials` 和 `http_request`。
