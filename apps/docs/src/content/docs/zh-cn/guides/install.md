---
title: 用一条命令安装 binference
description: 在你的 Mac 上用一行命令安装 Node 26 和 binference，可以先检查脚本，也可以不经提问完成设置，以及如何再卸载它。
---

binference 目前只支持 macOS。一行命令即可安装 binference 并开始设置。当你的 Mac 上没有 Node 26.1 或更高版本时，脚本会先安装 Node 26，然后从 npm 安装 `binference` 包，写入一个 `binference` 命令，再运行 `binference init`，由它询问所需的信息。脚本从不要求 root 或管理员权限，也从不自行修改你的 shell 启动文件或 PATH。

在其他系统上，脚本会说明 binference 目前只支持 macOS，并在下载任何内容之前停止。

## 安装

binference 正处于 beta 阶段。打开“终端”并运行：

```sh
curl -fsSL https://binference.io/install.sh | sh -s -- --beta
```

不加 `--beta` 时，脚本从 stable 渠道安装。然后按照[开始使用](/zh-cn/guides/getting-started/)完成设置。

## 运行前先检查脚本

每个发行版的 `SHA256SUMS` 随签名的 GitHub 发行版一起发布，其中列出了这个脚本。下载脚本和这个文件，核对校验和，阅读脚本，然后再运行：

```sh
curl -fsSLO https://binference.io/install.sh
curl -fsSLO https://github.com/bInference-Lab/bInference/releases/download/v2026.11.0-beta.1/SHA256SUMS
shasum -a 256 -c --ignore-missing SHA256SUMS
sh install.sh --beta
```

请在第二行填入你要安装的发行版的标签。beta 版在 GitHub 上是预发行版，`releases/latest` 找不到它。

binference.io 也在脚本旁提供 `install.sh.sha256`。它只说明下载完整；只有发行版中的 `SHA256SUMS` 能说明它来自这个发行版。

## 脚本做了什么

所有内容都放在你自己的一个文件夹中：`~/.local/share/binference`，设置了 `XDG_DATA_HOME` 时则是其中的 `binference`。

1. **Node。** 如果 PATH 上的 `node` 是 Node 26.1 或更高版本，并且它自己的 npm 就在旁边，脚本就使用它。否则它从 nodejs.org 下载脚本固定的那个 Node 26 发行版（第一个 beta 版中是 26.13.0），并用脚本中写明的固定值核对压缩包的 SHA-256，这个值来自 Node 签名的校验和文件。两者不一致时，它在解压任何内容之前就会停止。Node 安装到该文件夹的 `node/` 中，并有一个指向它的 `node/current` 链接，脚本会检查它能否运行。Apple 芯片和 Intel 的 Mac 各自得到对应的构建。
2. **binference。** 它运行 `npm i -g binference@beta`，在 stable 渠道上则是 `binference@latest`，装到该文件夹的 `npm/` 中，因此无需 `sudo`。
3. **命令。** 它写入 `bin/binference`，用完整路径以这个 Node 运行 binference。只有这个命令会进入你的 PATH，Node 和 npm 从不进入，因此你的其他项目仍使用它们自己的 Node。
4. **PATH。** 如果 `bin/` 不在 PATH 上，脚本会打印要加入 shell 启动文件（例如 `~/.zshrc`）的那一行。请自己加入，然后打开一个新终端。之后再次运行脚本安装更新的 Node 时，这一行保持不变。
5. **设置。** 它运行 `binference init`。如果没有可以回答问题的终端，它会说明这一点并停止；准备好后请在终端中运行 `binference init`。

binference 把自己的状态（配置、数据库、密钥和日志）放在 `binference init` 创建的另一个文件夹中：`~/.binference`。

当你的语言环境是中文时（看 `LANG` 或 `LC_ALL`；繁体中文环境也显示简体中文），脚本的每条消息都用简体中文显示，否则用英文。

## 不经提问完成设置

在脚本中，请加上 `--yes`。脚本随后运行 `binference init --yes`，它不提任何问题，从 `BINFERENCE_INIT_*` 变量或 `BINFERENCE_INIT_ANSWERS` 指定的应答文件读取每个答案，从不读取脚本的命令行：

```sh
curl -fsSL https://binference.io/install.sh | \
  BINFERENCE_INIT_ANSWERS="$HOME/answers.json5" sh -s -- --beta --yes
```

密钥从不以明文给出：模型密钥这类答案是一个密钥来源，写法与 `config.json5` 中相同。如果缺少某个答案，init 会说出它的参数、变量和在应答文件中的键，然后停止，脚本以 init 的退出码结束。

## 参数和变量

| 参数          | 变量                              | 作用                                      |
| ------------- | --------------------------------- | ----------------------------------------- |
| `--beta`      | `BINFERENCE_INSTALL_CHANNEL=beta` | 从 beta 渠道安装                          |
| `--yes`       | `BINFERENCE_INSTALL_YES=1`        | 运行 `binference init --yes`              |
| `--skip-init` | `BINFERENCE_INSTALL_SKIP_INIT=1`  | 只安装；之后再运行 `binference init`      |
|               | `BINFERENCE_NODE_MIRROR`          | 从 https:// 镜像下载 Node；仍以校验和核对 |

`BINFERENCE_INSTALL_YES` 和 `BINFERENCE_INSTALL_SKIP_INIT` 只接受 `1` 或不设置。init 的答案放在 `BINFERENCE_INIT_*` 变量中。`BINFERENCE_INSTALL_PACKAGE` 指定一个本地包文件，仅供测试。

## 脚本停止时

每次停止都会说明下一步。常见的情况：

- **不是 macOS。** 在 Linux、Windows 或其他系统上，binference 目前只支持 macOS。没有下载或安装任何内容。
- **Node 压缩包的 SHA-256 不一致。** 你的网络或镜像返回的内容与 Node 发布的不同。没有安装任何内容。请换一个网络再试，或取消设置 `BINFERENCE_NODE_MIRROR`。
- **Node 无法在本机运行。** 下载的 Node 无法启动，常见于较旧的 macOS。脚本会删除它；请自行安装 Node 26，然后再次运行脚本。
- **npm 无法安装 binference。** npm 自己的错误信息在这条消息上方。请检查网络和 npm 的 registry 设置。

## 卸载

```sh
binference uninstall
```

它会停止 binference，移除它的后台服务，然后移除程序：脚本放在 `~/.local/share/binference` 中的命令、包和 Node。你原有的 Node 会保留。它会先请你输入 `uninstall`；`--yes` 跳过这个问题。

状态文件夹 `~/.binference` 会保留。`binference uninstall --state` 会连同 binference 在钥匙串中的条目一起移除它。你的钱包及其中的资产仍在 Privy 中。状态文件夹移除后，只有你的所有者密钥能转移其中的代币，所以请先用 `binference rescue` 把一切转到你的紧急转出地址，或者保留所有者密钥，之后用 `binference init --attach` 重新设置。

如果你加过那一行 PATH，命令会打印它；请把它从 shell 启动文件中删除。

## 托管脚本

托管 binference.io 的人按发行版试运行暂存时的原样提供 `install.sh` 和 `install.sh.sha256`，类型为 `text/plain; charset=utf-8`。
