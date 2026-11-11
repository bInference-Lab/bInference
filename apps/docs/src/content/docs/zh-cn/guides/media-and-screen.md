---
title: 图片、视频、语音和屏幕
description: 让 Agent 生成图片和视频、说话、展示图片、发送文件、读取 PDF，并查看你的屏幕。
---

Agent 可以生成图片和视频、对你说话、展示机器上已有的图片和文件、读取 PDF，并在你要求时查看你的屏幕。它生成的内容保存在工作区文件夹（binference 状态文件夹中的 `workspace/`），并在每个界面的对话中显示。

## Agent 生成的图片

`make_image` 根据提示词生成 1 到 4 张图片（例如代币的标志），或编辑你指定的最多 4 张图片。它需要 `models.imageMaking`，一个写成 `<provider>/<model>` 的模型：

- 在 `binference` 服务商上，是 bInference 网关的某个图片模型；binference 只向每个模型发送它接受的设置
- 在 `openai` 服务商上，是 OpenAI Images API 的某个模型

```sh
binference config set models.imageMaking binference/<model>
```

没有设置时，Agent 会说明要设置哪个配置项。Agent 启动生成任务后就结束这一轮；图片稍后（最多几分钟）会出现在对话中。Telegram 把每张图片作为照片发送，控制台直接显示，终端对话打印它的保存位置，即工作区文件夹中的 `media/made/<date>/`。每个 Agent 同一时间只运行一个生成任务，其花费计入 Agent 的模型预算。

## 视频

`make_video` 用 `models.videoMaking`（bInference 网关的某个视频模型）生成一段短视频。你没有指定时长、尺寸或声音时，Agent 会请求模型最短的时长和最小的尺寸，比例为 16:9，不带声音，这样花费最少。用作首帧、尾帧的图片，以及用于保持外观的参考图，只能以公开的 `https` 链接提供：你机器上的文件不会被上传。

一段视频需要几分钟，最多 15 分钟。它保存在 `media/made/<date>/` 中，最大 100 MiB，其花费计入模型预算。Telegram 会直接播放小于 50 MB 的视频，更大的视频则发送其路径；控制台可以直接播放。

## 语音

`speak` 把最多 4,000 个字符读成语音消息，仅在你要求听某些内容时使用。`models.speech` 指定由谁来说：

- `openai` 服务商上的某个语音模型；`speech.voice` 选择它的一种声音，默认为 `alloy`
- `local`，即 macOS 上这台机器自带的声音；`speech.voice` 选择它的一种声音，例如 `Samantha`。在 Linux 和 Windows 上，`local` 会被拒绝。

Telegram 发送语音消息，控制台直接播放，终端对话打印它的保存位置，即 `media/speech/<date>/`。

## 展示图片和发送文件

- `show_images` 展示机器上已有的最多 12 张图片，例如 Agent 之前生成的图片或一张屏幕截图：PNG、JPEG 或 WebP 文件，每张最大 5 MiB，每条消息最多 4 张。Telegram 把它们作为照片发送，每张都注明保存位置。
- `send_files` 以文档形式发送最多 10 个任意类型的文件，每个最大 20 MiB，供你保存。Telegram 作为文档发送，控制台为每个文件提供“保存”按钮，终端对话打印每个文件的位置。

两者都像[文件工具](/zh-cn/guides/shell-and-files/#文件工具)一样读取文件：永远不读 binference 自己的文件夹；当 `files.workspaceOnly` 为 `true` 时，只读工作区文件夹中的文件。

## 图片和 PDF

- `look_at_image` 描述最多 4 张位于公网地址或机器上文件中的图片，每张最大 5 MiB。
- `read_pdf` 读取最多 10 个位于公网地址或机器上的 PDF，每个最大 10 MiB，并回答 Agent 关于它们的问题。每次调用读取 20 页（除非 Agent 指定其他页，否则为前 20 页），最多 100,000 个字符的文字。扫描页（文字很少的页面）会从其图像读取：如果 `models.imageInput` 列出了对话所用的模型，就由它读取，否则由 `models.vision` 读取；两者都没有时，回答会列出未读的页面。对于加密的 PDF，Agent 会向你询问密码，binference 从不记录或保存它。

地址只在公网上读取，设置了代理时经过你的代理。图片或 PDF 中的内容都是外部内容，所以对话会像读过网页一样被标记。

## 查看你的屏幕

`look_at_screen` 截取机器屏幕的截图并加以描述，仅在你要求 Agent 查看时使用。它只看不动：binference 中没有任何部分会移动鼠标、点击、输入或控制应用，所以 Agent 会告诉你在那里该怎么做。每张截图保存在 `media/screen/<date>/` 中，你要求时 Agent 会展示给你。屏幕上显示的内容是外部内容，Agent 从不复述它看到的密码、密钥或助记词。

- **macOS** 会在第一次截图时请求权限，在你允许之前不会截图。打开“系统设置”中的“隐私与安全性”，进入“屏幕录制”，开启 Agent 指出的程序：binference 运行所用的 Node 程序，或启动 binference 的终端应用。然后用 `binference stop` 和 `binference start` 重启 binference。
- **Linux** 需要桌面会话，以及 `grim`、`gnome-screenshot` 或 `scrot` 之一。
- **Windows** 用一个固定的 PowerShell 脚本截图。

没有屏幕的机器（例如服务器或容器）没有可看的内容。超过 5 MiB 的截图会在 Agent 读取前被缩小；`gnome-screenshot` 无法缩小截图，所以用它时这样的截图会被拒绝。

## 另请参阅

- [配置项](/zh-cn/reference/config/)：`models.imageMaking`、`models.videoMaking`、`models.speech`、`speech.voice`、`models.vision` 和 `models.imageInput`。
- [Agent 工具和 MCP 工具](/zh-cn/reference/agent-and-mcp-tools/)：本页的每个工具。
- [与 Agent 对话](/zh-cn/guides/chat/)：模型预算。
