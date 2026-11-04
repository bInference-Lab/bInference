---
title: 用一条命令安装 binference
description: 在 macOS、Linux 或 Windows 上用一行命令安装 Node 26 和 binference，可以先检查脚本，也可以不经提问完成设置。
---

一行命令即可安装 binference 并开始设置。当你的电脑上没有 Node 26.1 或更高版本时，脚本会先安装 Node 26，然后从 npm 安装 `binference` 包，写入一个 `binference` 命令，再运行 `binference init`，由它询问所需的信息。脚本从不要求 root 或管理员权限，也从不自行修改你的 shell 启动文件或 PATH。

## macOS 和 Linux

打开终端并运行：

```sh
curl -fsSL https://binference.io/install.sh | sh
```

要从 beta 渠道安装，请加上 `--beta`：

```sh
curl -fsSL https://binference.io/install.sh | sh -s -- --beta
```

## Windows

打开 PowerShell（Windows PowerShell 5.1 或 PowerShell 7）并运行：

```powershell
irm https://binference.io/install.ps1 | iex
```

要从 beta 渠道安装，请先设置渠道：

```powershell
$env:BINFERENCE_INSTALL_CHANNEL = 'beta'; irm https://binference.io/install.ps1 | iex
```

## 运行前先检查脚本

每个发行版的 `SHA256SUMS` 随签名的 GitHub 发行版一起发布，其中列出了两个脚本。下载脚本和这个文件，核对校验和，阅读脚本，然后再运行：

```sh
curl -fsSLO https://binference.io/install.sh
curl -fsSLO https://github.com/bInference-Lab/bInference/releases/latest/download/SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS
sh install.sh
```

在 macOS 上，请用 `shasum -a 256 -c --ignore-missing SHA256SUMS` 代替 `sha256sum`。在 Windows 上，请把 PowerShell 打印的哈希与 `SHA256SUMS` 中 `install.ps1` 那一行对比：

```powershell
irm https://binference.io/install.ps1 -OutFile install.ps1
(Get-FileHash install.ps1 -Algorithm SHA256).Hash.ToLower()
powershell -ExecutionPolicy Bypass -File install.ps1
```

binference.io 也在脚本旁提供 `install.sh.sha256` 和 `install.ps1.sha256`。它们只说明下载完整；只有发行版中的 `SHA256SUMS` 能说明它来自这个发行版。

## 脚本做了什么

所有内容都放在你自己的一个文件夹中：macOS 和 Linux 上是 `~/.local/share/binference`，Windows 上是 `%LOCALAPPDATA%\binference`。

1. **Node。** 如果 PATH 上的 `node` 是 Node 26.1 或更高版本，并且它自己的 npm 就在旁边，脚本就使用它。否则它从 nodejs.org 下载一个 Node 26 发行版，并用脚本中写明的固定值核对压缩包的 SHA-256。两者不一致时，它在解压任何内容之前就会停止。Node 安装到该文件夹的 `node/` 中，脚本会检查它能否运行。
2. **binference。** 它在 stable 渠道上运行 `npm i -g binference`，或安装 `binference@beta`，装到该文件夹的 `npm/` 中，因此无需 `sudo`。
3. **命令。** 它写入 `bin/binference`（Windows 上为 `bin\binference.cmd`），用完整路径以这个 Node 运行 binference。只有这个命令会进入你的 PATH，Node 和 npm 从不进入，因此你的其他项目仍使用它们自己的 Node。
4. **PATH。** 如果 `bin/` 不在 PATH 上，脚本会打印要加入 shell 启动文件的那一行，或者把它加入用户 PATH 的 PowerShell 命令。请自己运行它，然后打开一个新终端。之后再次运行脚本安装更新的 Node 时，这一行保持不变。
5. **设置。** 它运行 `binference init`。如果没有可以回答问题的终端，它会说明这一点并停止；准备好后请在终端中运行 `binference init`。

当你的语言环境是中文时（macOS 和 Linux 上看 `LANG` 或 `LC_ALL`，Windows 上看显示语言；繁体中文环境也显示简体中文），脚本的每条消息都用简体中文显示，否则用英文。

## 不经提问完成设置

在服务器或脚本中，请加上 `--yes`。脚本随后运行 `binference init --yes`，它不提任何问题，从 `BINFERENCE_INIT_*` 变量或 `BINFERENCE_INIT_ANSWERS` 指定的应答文件读取每个答案，从不读取脚本的命令行：

```sh
curl -fsSL https://binference.io/install.sh | \
  BINFERENCE_INIT_ANSWERS="$HOME/answers.json5" sh -s -- --yes
```

密钥从不以明文给出：模型密钥这类答案是一个密钥来源，写法与 `config.json5` 中相同。如果缺少某个答案，init 会说出它的参数、变量和在应答文件中的键，然后停止，脚本以 init 的退出码结束。

## 参数和变量

| 参数          | 变量                              | 作用                                      |
| ------------- | --------------------------------- | ----------------------------------------- |
| `--beta`      | `BINFERENCE_INSTALL_CHANNEL=beta` | 从 beta 渠道安装                          |
| `--yes`       | `BINFERENCE_INSTALL_YES=1`        | 运行 `binference init --yes`              |
| `--skip-init` | `BINFERENCE_INSTALL_SKIP_INIT=1`  | 只安装；之后再运行 `binference init`      |
|               | `BINFERENCE_NODE_MIRROR`          | 从 https:// 镜像下载 Node；仍以校验和核对 |

`BINFERENCE_INSTALL_YES` 和 `BINFERENCE_INSTALL_SKIP_INIT` 只接受 `1` 或不设置。init 的答案放在 `BINFERENCE_INIT_*` 变量中。`BINFERENCE_INSTALL_PACKAGE` 指定一个本地包文件，仅供测试。在 Windows 上，请像 beta 示例那样，在 `irm` 那一行之前于 PowerShell 中设置变量。

## 脚本停止时

每次停止都会说明下一步。常见的情况：

- **Node 压缩包的 SHA-256 不一致。** 你的网络或镜像返回的内容与 Node 发布的不同。没有安装任何内容。请换一个网络再试，或取消设置 `BINFERENCE_NODE_MIRROR`。
- **没有官方 Node 构建。** Alpine 等使用 musl 的 Linux 系统，以及 Node 不提供构建的处理器，需要先用系统的软件包安装 Node 26。安装后再次运行脚本。
- **Node 无法在本机运行。** 下载的 Node 无法启动，常见于较旧的系统。脚本会删除它；请用系统的软件包安装 Node 26，然后再次运行脚本。
- **npm 无法安装 binference。** npm 自己的错误信息在这条消息上方。请检查网络和 npm 的 registry 设置。

## 托管脚本

托管 binference.io 的人按发行版试运行暂存时的原样提供 `install.sh`、`install.ps1` 及它们的 `.sha256` 文件，类型为 `text/plain; charset=utf-8`。Windows PowerShell 会把未注明字符集的脚本按 ISO-8859-1 读取，导致其中的中文乱码。
