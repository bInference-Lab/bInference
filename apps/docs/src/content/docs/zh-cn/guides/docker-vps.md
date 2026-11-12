---
title: 用 Docker 在服务器上运行 binference
description: 在 Linux 服务器上部署 binference 镜像，保持它不对外公开，备份、更新它，并在重启后解锁。
---

本指南在你租用的 Linux 服务器（例如 VPS）上用 Docker 运行 binference。引擎的规则与在你自己电脑上相同：每笔交易前都会先问你，只在服务器的回环地址上监听，你的密钥留在它的状态文件夹中。

## 你需要准备

- 一台至少 1 个 vCPU、1 GB 内存的 Linux 服务器，并已安装 Docker Engine。
- 用密钥登录它的 SSH 访问。
- `binference init` 要问的内容：Privy 应用 ID 和密钥、你的救援地址、BotFather 给的 Telegram 机器人令牌，以及一个模型提供方和它的密钥。

## 1. 在服务器上建一个自己的用户

不要用 `root` 运行 Agent 的工作。为它建一个用户，并让它使用 Docker：

```sh
sudo adduser --disabled-password binference-admin
sudo usermod -aG docker binference-admin
```

`docker` 组的成员在这台服务器上等同于 `root`，所以只把它给这个用户。下面每一步都用这个用户登录操作。在容器内，binference 以它自己的用户 `binference`（ID 10001）运行，从不以 `root` 运行。Agent 的命令以另一个用户 `binference-shell`（ID 10003）运行，该用户无法读取 binference 自己的文件。

## 2. 防火墙

只允许外部访问 SSH：

```sh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
```

不要用 `-p` 或 `ports:` 发布引擎的 7456 端口。Docker 发布的端口会绕过 `ufw`，而引擎不应面向互联网。镜像不发布任何端口：容器共用服务器的网络，引擎只在 `127.0.0.1` 上监听。

## 3. 构建镜像

发布版镜像尚未提供；之后会由发布流程构建，附带 SBOM，以 amd64 和 arm64 两种架构发布到 GitHub 的镜像仓库（`ghcr.io`）。在此之前，请取得你要的版本的 binference 源码，然后构建：

```sh
docker build -t binference .
```

构建只下载 Node 包，不下载别的，并检查每个包都已发布至少 7 天。

## 4. 完成设置

创建存放状态文件夹的卷，然后在你的 SSH 终端中运行初始设置：

```sh
docker volume create binference-state
docker run --rm -it --network host --read-only --tmpfs /tmp \
  -e TZ=Asia/Shanghai \
  -v binference-state:/var/lib/binference/.binference \
  binference init
```

`-it` 把你的终端交给 init：它逐一提问，只显示一次你的所有者密钥，并把你输入的密钥保存在卷中，只有 `binference` 用户可以读取。请把所有者密钥抄写下来，存放在服务器以外的地方。

把 `TZ` 设为你的时区；不设置时，容器的每日摘要和计划任务使用 UTC。设置 `-e LANG=zh_CN.UTF-8` 可让它一开始就使用中文。

### 不经提问

在脚本中，`binference init --yes` 从参数、`BINFERENCE_INIT_*` 变量或答案文件（`--answers`）中取得每个答案。它从不生成所有者密钥：请在有终端的电脑上用 `binference owner-key create` 生成，再用 `--owner-key-public` 传入它的公钥部分。密钥始终是密钥来源。把它们保存在属于用户 10001 的文件中，并以只读方式挂载：

```sh
sudo install -d -m 0500 -o 10001 -g 10001 /srv/binference/secrets
# 把每个密钥写入它的文件，然后：
sudo chown 10001:10001 /srv/binference/secrets/*
sudo chmod 0400 /srv/binference/secrets/*

docker run --rm --network host --read-only --tmpfs /tmp \
  -v binference-state:/var/lib/binference/.binference \
  -v /srv/binference/secrets:/run/secrets:ro \
  binference init --yes --accept-disclaimer \
    --privy-app-id <应用 ID> \
    --privy-app-secret '{ fromFile: "/run/secrets/privy-app-secret" }' \
    --owner-key-public <公钥部分> \
    --rescue <救援地址> \
    --bot-token '{ fromFile: "/run/secrets/bot-token" }' \
    --model-provider <提供方> --model <模型 ID> \
    --model-key '{ fromFile: "/run/secrets/model-key" }'
```

`--accept-disclaimer` 会打印免责声明和隐私说明，并代你接受它们。每次启动引擎时都要挂载同一个密钥文件夹。

## 5. 启动引擎

```sh
docker volume create binference-plugins
docker run -d --name binference --restart unless-stopped \
  --network host --read-only --tmpfs /tmp --stop-timeout 45 \
  --init --user root --entrypoint binference-image \
  -e TZ=Asia/Shanghai \
  -v binference-state:/var/lib/binference/.binference \
  -v binference-plugins:/var/lib/binference-plugins \
  binference
```

- `--user root --entrypoint binference-image` 启动镜像入口，它是唯一以 root 运行的进程。它以 `binference` 用户启动引擎，以 `binference-plugin` 用户启动插件启动器，以 `binference-shell` 用户启动运行 Agent 命令的命令行启动器。`binference-plugin` 是社区插件专用的用户，因此插件永远无法停止或调试引擎。镜像入口不接受任何参数，也不启动其他进程。`--init` 让 Docker 清理结束的插件进程和命令进程。不带这些参数启动时，引擎照常运行，但不运行任何插件，也不运行 Agent 的任何命令。
- 在这个容器中，`docker exec binference binference ...` 和健康检查以 root 运行，每条 `binference` 命令都会先切换到 `binference` 用户再做任何事，因此你的状态文件夹中不会出现 root 创建的文件。
- `binference-plugins` 保存插件的文件和每个插件自己的数据，与你的状态数据分开。

- `--stop-timeout 45` 让引擎有时间发完正在发送的内容并关闭数据库。Docker 默认的 10 秒可能不够。
- `--restart unless-stopped` 在崩溃或服务器重启后再次启动它。
- 健康检查每 30 秒运行一次 `binference health`。引擎就绪或已锁定时，它都报告健康：已锁定的引擎在等你操作，重启也无法打开它。

检查它：

```sh
docker exec binference binference status
docker inspect --format '{{.State.Health.Status}}' binference
```

然后配对你的 Telegram：在 Telegram 中打开 init 打印的配对链接。

## 6. 打开控制台

控制台在服务器的 `127.0.0.1:7456` 上监听。从你的电脑通过 SSH 访问它：

```sh
ssh -N -L 7456:127.0.0.1:7456 binference-admin@<服务器>
```

在另一个终端中生成一次性登录链接，然后在浏览器中打开它：

```sh
ssh binference-admin@<服务器> docker exec binference binference console
```

### Telegram Mini App

Mini App 需要一个能到达引擎端口的 HTTPS 地址。在服务器上用 Tailscale `serve` 发布这个端口，这样只有你 tailnet 中自己的设备能访问它，然后把地址告诉 binference 并重启：

```sh
docker exec binference binference config set remote.publicUrl https://<机器>.<tailnet>.ts.net
docker restart binference
```

不要把引擎的端口放在公共代理或 Tailscale `funnel` 后面。

## Agent 的命令

在镜像中，Agent 的[命令行工具](/zh-cn/guides/shell-and-files/)通过命令行启动器，以 `binference-shell` 用户在 bash 中运行每条命令。该用户无法读取 binference 自己的文件：状态文件夹 `/var/lib/binference/.binference/state` 只属于 `binference` 用户，所以密钥、数据库、`config.json5` 和命令行的访问令牌都在命令的范围之外。镜像不需要 bubblewrap，何况 Docker 的默认设置本来也会拒绝它。

状态卷中有镜像建好的三个文件夹：

| 文件夹       | 存放什么                                                              |
| ------------ | --------------------------------------------------------------------- |
| `state/`     | 状态文件夹，只属于 `binference`                                       |
| `workspace/` | Agent 的工作区，由 `binference` 和 `binference-shell` 共用            |
| `shell/`     | `run/` 中命令行启动器的套接字，以及 `binference-shell` 用户的 `home/` |

你会看到：

- 除非 Agent 指定其他文件夹，命令从 `binference-shell` 用户的主文件夹 `/var/lib/binference/.binference/shell/home` 开始运行。对命令行工具和文件工具来说，`~` 都指这个主文件夹，`whoami` 会打印 `binference-shell`。
- 工作区位于状态文件夹旁边，即 `/var/lib/binference/.binference/workspace`。引擎和 `binference-shell` 用户通过 `binference-shell` 组共用它，所以双方都能读取和修改对方在其中创建的文件。其中每个 Agent 自己的文件夹（包括它的 `STRATEGY.md`、笔记和技能）对命令保持关闭。
- `docker exec binference binference check` 报告 `shell.wall` 一项正常：Agent 的命令以单独的用户运行。命令行启动器没有应答时，它会发出警告。

### 你绑定的文件夹

新建的命名卷会从镜像中取得这三个文件夹及其所有者和权限。用你绑定的文件夹代替命名卷时，需要在第一次启动前手动建好它们：

```sh
sudo install -d -m 0750 -o 10001 -g 10003 /srv/binference/volume
sudo install -d -m 0700 -o 10001 -g 10001 /srv/binference/volume/state
sudo install -d -m 2770 -o 10001 -g 10003 /srv/binference/volume/workspace
sudo install -d -m 0750 -o 10001 -g 10003 /srv/binference/volume/shell
sudo install -d -m 0750 -o 10003 -g 10001 /srv/binference/volume/shell/run
sudo install -d -m 2770 -o 10003 -g 10003 /srv/binference/volume/shell/home
```

然后用 `-v /srv/binference/volume:/var/lib/binference/.binference` 代替命名卷挂载它。缺少 `shell/` 及其中的两个文件夹时，命令行启动器无法监听：Agent 运行的每条命令都无法启动，`binference check` 会警告命令行启动器没有运行。

## 日志

```sh
docker logs binference                    # 引擎在启动和停止时打印的内容
docker exec binference binference logs    # 引擎的日志
docker exec binference binference report  # 不含任何密钥的支持包
```

## 备份

binference 每晚在你的时区 03:30 做一次加密备份，用你的所有者密钥封存，放在卷中的 `state/backups/` 下。引擎运行时不要复制卷中的数据库文件：请复制备份。要在服务器上保留第二份，挂载一个文件夹并让 `backups.copyTo` 指向它：

```sh
sudo install -d -m 0700 -o 10001 -g 10001 /srv/binference/backups
```

在启动命令中加上 `-v /srv/binference/backups:/backups`，然后：

```sh
docker exec binference binference config set backups.copyTo /backups
```

按你自己的计划把 `/srv/binference/backups` 复制到服务器以外。手动备份用 `docker exec binference binference backup create`。

恢复前先停止容器：恢复会停止引擎，而在容器中这会让容器一起停止。然后在一个单独的容器中恢复，它会要求你输入所有者密钥，再重新启动：

```sh
docker stop binference
docker run --rm -it --network host --read-only --tmpfs /tmp \
  -v binference-state:/var/lib/binference/.binference \
  -v /srv/binference/backups:/backups \
  binference backup restore /backups/<文件>
docker start binference
```

## 更新

`binference update` 在容器中不适用。更新步骤：

1. 先备份：`docker exec binference binference backup create`。
2. 用新版本重新构建镜像。
3. 用同一个卷替换容器：

   ```sh
   docker stop binference
   docker rm binference
   ```

   然后再次运行第 5 步的启动命令。引擎启动时会先备份再迁移它的数据库。

## 重启后解锁

- **`file` 方式**（Docker 中的默认方式）：每次启动时从卷中打开 Agent 密钥，引擎会自己解锁。
- **`manual` 方式**：Agent 密钥用你的口令加密保存。每次启动后引擎处于锁定状态：它照常应答、继续模拟交易并打开卡片，但不签名任何交易。从你的 SSH 终端解锁：

  ```sh
  docker exec -it binference binference unlock
  ```

  口令只通过终端输入，从不作为参数或变量。

`docker exec binference binference status` 会显示 `locked` 及原因。

## 出现问题时

- **“binference 无法写入 /var/lib/binference/.binference/state”**：卷属于另一个用户，或以只读方式挂载。请像上面那样使用命名卷，或按“你绑定的文件夹”一节建好其中列出的文件夹。
- **Agent 的命令无法启动**：容器启动时没有带 `--init --user root --entrypoint binference-image`，或者绑定的文件夹缺少 `shell/`。`docker exec binference binference check` 会警告命令行启动器没有运行。
- **控制台打不开**：检查 SSH 隧道是否在运行，以及容器是否使用了 `--network host`。
