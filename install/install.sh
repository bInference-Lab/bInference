#!/bin/sh
# Installs binference on macOS and Linux: Node 26 when this machine has no Node 26.1 or later,
# then the binference package from npm into a folder of the owner's, a `binference` launcher that
# runs it with that Node, then `binference init`. It never asks for root and never edits a shell
# startup file. Run it with --help for its flags and variables.
set -eu

# The Node release this script installs, and the SHA-256 of each archive it may fetch, from
# Node's signed SHASUMS256.txt. A release script writes this block; never edit it by hand.
# node-pins:start
node_version=26.13.0
node_sha256() {
  case "$1" in
    darwin-arm64) echo d38bd5e5a2ddce6bbb5ce45e46e208337da4d51fffe611e567fd32073d6439f6 ;;
    darwin-x64) echo 525c9b29bb0263d687de60a4cec0e2a6db876a8eb032369e5795eca71e7c358e ;;
    linux-arm64) echo 439e9c438acdf6a6ffe47418da709153d66c4bed812e30a473faacb107dd2791 ;;
    linux-x64) echo 5848553868b402d3fabb5b09270649977780a390f832155721025a08b5104455 ;;
    *) echo "" ;;
  esac
}
# node-pins:end

# The oldest Node binference runs on, as its package's `engines` field says.
node_floor_major=26
node_floor_minor=1

# Any Chinese locale, zh_TW included, gets the Simplified Chinese lines.
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
  zh*) lang=zh ;;
  *) lang=en ;;
esac

# Each message comes in English and Simplified Chinese; the locale picks one.
say() {
  if [ "$lang" = zh ]; then printf '%s\n' "$2"; else printf '%s\n' "$1"; fi
}

fail() {
  say "$1" "$2" >&2
  exit 1
}

usage() {
  say "Usage: install.sh [--beta] [--yes] [--skip-init] [--help]

Installs Node 26 when this machine lacks it, then the binference package from npm, then runs
binference init. It never asks for root.

  --beta       Install from the beta channel instead of stable.
  --yes        Run binference init --yes, which asks nothing; init takes its answers from the
               BINFERENCE_INIT_* variables or the answers file BINFERENCE_INIT_ANSWERS names.
  --skip-init  Install only; run binference init yourself later.

Variables: BINFERENCE_INSTALL_CHANNEL (stable or beta), BINFERENCE_INSTALL_YES=1,
BINFERENCE_INSTALL_SKIP_INIT=1, BINFERENCE_NODE_MIRROR (an https:// Node download mirror; the
pinned checksums still decide), BINFERENCE_INSTALL_PACKAGE (a local tarball, for tests only)." \
    "用法：install.sh [--beta] [--yes] [--skip-init] [--help]

在本机缺少 Node 26 时安装它，然后从 npm 安装 binference 包，再运行 binference init。
它从不要求 root 权限。

  --beta       从 beta 渠道安装，而不是 stable。
  --yes        运行 binference init --yes，不提任何问题；init 从 BINFERENCE_INIT_* 变量或
               BINFERENCE_INIT_ANSWERS 指定的应答文件读取答案。
  --skip-init  只安装；之后自己运行 binference init。

变量：BINFERENCE_INSTALL_CHANNEL（stable 或 beta）、BINFERENCE_INSTALL_YES=1、
BINFERENCE_INSTALL_SKIP_INIT=1、BINFERENCE_NODE_MIRROR（https:// 的 Node 下载镜像；仍以固定的
校验和为准）、BINFERENCE_INSTALL_PACKAGE（本地包文件，仅供测试）。"
}

# A yes or no variable: unset, empty or 1; anything else stops with the next step.
switch_value() {
  case "$2" in
    "" | 1) printf '%s\n' "$2" ;;
    *)
      fail "$1 is $2; set it to 1 or leave it unset, then run the installer again." \
        "${1} 的值是 ${2}；请把它设为 1 或不设置，然后再次运行安装脚本。"
      ;;
  esac
}

read_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --beta) channel=beta ;;
      --yes) unattended=1 ;;
      --skip-init) skip_init=1 ;;
      --help | -h)
        usage
        exit 0
        ;;
      *)
        fail "Unknown flag $1. Run the installer with --help to see its flags; init's answers go in BINFERENCE_INIT_* variables, never on the command line." \
          "未知参数 ${1}。用 --help 运行安装脚本查看它的参数；init 的答案放在 BINFERENCE_INIT_* 变量中，从不放在命令行上。"
        ;;
    esac
    shift
  done
}

refuse_package() {
  fail "BINFERENCE_INSTALL_PACKAGE takes only an existing .tgz file by its full path, or an http address of a .tgz on 127.0.0.1, localhost or [::1] with a port, for tests. Unset it to install binference from npm." \
    "BINFERENCE_INSTALL_PACKAGE 只接受以完整路径给出的现有 .tgz 文件，或 127.0.0.1、localhost、[::1] 上带端口的 .tgz 的 http 地址，仅供测试。取消设置它即可从 npm 安装 binference。"
}

# The test-only package override, read strictly: a loopback URL with a port and no user, query or
# fragment, or a regular .tgz file. Sets package_url or package_file.
read_package_override() {
  value=$BINFERENCE_INSTALL_PACKAGE
  case "$value" in
    *@* | *\?* | *#* | *[[:space:]]*) refuse_package ;;
  esac
  case "$value" in
    http://*/*.tgz)
      rest=${value#http://}
      authority=${rest%%/*}
      case "$authority" in
        127.0.0.1:*) port=${authority#127.0.0.1:} ;;
        localhost:*) port=${authority#localhost:} ;;
        "[::1]:"*) port=${authority#"[::1]:"} ;;
        *) refuse_package ;;
      esac
      case "$port" in
        "" | *[!0-9]*) refuse_package ;;
      esac
      package_url=$value
      ;;
    /*.tgz)
      [ -f "$value" ] || refuse_package
      package_file=$value
      ;;
    *) refuse_package ;;
  esac
  say "Installing ${value}, which BINFERENCE_INSTALL_PACKAGE names, not a release from npm." \
    "正在安装 BINFERENCE_INSTALL_PACKAGE 指定的 ${value}，而不是 npm 上的发行版。"
}

channel_spec() {
  case "$channel" in
    stable) spec=binference@latest ;;
    beta) spec=binference@beta ;;
    *)
      fail "BINFERENCE_INSTALL_CHANNEL is $channel; it takes stable or beta." \
        "BINFERENCE_INSTALL_CHANNEL 的值是 ${channel}；它只接受 stable 或 beta。"
      ;;
  esac
}

# Sets node_exe to the Node on PATH when it is Node 26.1 or later and its own npm sits in its
# folder. The real file, not a version manager's shim, so the launcher keeps this Node.
find_node() {
  command -v node >/dev/null 2>&1 || return 1
  facts=$(node -p 'process.execPath + "\n" + process.versions.node' 2>/dev/null) || return 1
  exe=$(printf '%s\n' "$facts" | sed -n 1p)
  found=$(printf '%s\n' "$facts" | sed -n 2p)
  [ -x "$(dirname "$exe")/npm" ] || return 1
  found=${found%%-*}
  major=${found%%.*}
  rest=${found#*.}
  minor=${rest%%.*}
  case "$major$minor" in
    "" | *[!0-9]*) return 1 ;;
  esac
  if [ "$major" -gt "$node_floor_major" ] ||
    { [ "$major" -eq "$node_floor_major" ] && [ "$minor" -ge "$node_floor_minor" ]; }; then
    node_exe=$exe
    say "Node ${found} is installed at ${exe}; using it." "已安装 Node ${found}（${exe}）；将使用它。"
    return 0
  fi
  return 1
}

platform() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *)
      fail "This installer runs on macOS and Linux; this machine reports $os. On Windows, run install.ps1 in PowerShell." \
        "本安装脚本只在 macOS 和 Linux 上运行；本机报告的系统是 ${os}。在 Windows 上，请在 PowerShell 中运行 install.ps1。"
      ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *)
      fail "Node's official builds do not cover the $arch processor. Install Node 26 from your system's packages, then run the installer again." \
        "Node 官方构建不支持 ${arch} 处理器。请用系统的软件包安装 Node 26，然后再次运行安装脚本。"
      ;;
  esac
  # A shell under Rosetta reports x86_64 on an Apple processor; the arm64 build runs natively.
  if [ "$os" = darwin ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    arch=arm64
  fi
  if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
    fail "Node's official builds need glibc, and this Linux uses musl. Install Node 26 from your system's packages (such as apk add nodejs npm), then run the installer again." \
      "Node 官方构建需要 glibc，而本机的 Linux 使用 musl。请用系统的软件包安装 Node 26（例如 apk add nodejs npm），然后再次运行安装脚本。"
  fi
  printf '%s\n' "$os-$arch"
}

download() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "Neither curl nor wget is installed. Install one of them, then run the installer again." \
      "本机没有安装 curl 或 wget。请安装其中一个，然后再次运行安装脚本。"
  fi
}

# One GET that must answer 200 itself: a redirect is a failure.
download_here() {
  if command -v curl >/dev/null 2>&1; then
    code=$(curl -sS --max-redirs 0 -o "$2" -w '%{http_code}' "$1") || return 1
    [ "$code" = 200 ]
  else
    wget -q --max-redirect=0 -O "$2" "$1"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | sed 's/^.*= *//'
  else
    fail "No SHA-256 tool is installed (sha256sum, shasum or openssl). Install one, then run the installer again." \
      "本机没有 SHA-256 工具（sha256sum、shasum 或 openssl）。请安装其中一个，然后再次运行安装脚本。"
  fi
}

mirror() {
  base=${BINFERENCE_NODE_MIRROR:-https://nodejs.org/dist}
  case "$base" in
    https://* | http://127.0.0.1:*) printf '%s\n' "${base%/}" ;;
    *)
      fail "BINFERENCE_NODE_MIRROR must be an https:// address. Fix it or unset it, then run the installer again." \
        "BINFERENCE_NODE_MIRROR 必须是 https:// 地址。请改正或取消设置它，然后再次运行安装脚本。"
      ;;
  esac
}

# Starts the Node in a folder once; a Node that cannot run here is removed, never kept.
check_node_runs() {
  if "$1/bin/node" --version >/dev/null 2>"$work/node-check"; then
    return 0
  fi
  reason=$(head -n 3 "$work/node-check")
  rm -rf "$1"
  fail "Node $node_version cannot run on this machine: $reason. Install Node 26 from your system's packages, then run the installer again." \
    "Node ${node_version} 无法在本机运行：${reason}。请用系统的软件包安装 Node 26，然后再次运行安装脚本。"
}

# Fetches the pinned Node archive, checks its SHA-256 against the pin and only then unpacks it
# beside its final folder and renames it there. A mismatch stops before anything is unpacked.
install_node() {
  plat=$(platform)
  expected=$(node_sha256 "$plat")
  if [ -z "$expected" ]; then
    fail "No Node build is pinned for $plat. Install Node 26 yourself, then run the installer again." \
      "没有为 ${plat} 固定的 Node 构建。请自行安装 Node 26，然后再次运行安装脚本。"
  fi
  name="node-v$node_version-$plat"
  folder="$data/node/$name"
  if [ -x "$folder/bin/node" ]; then
    say "Node ${node_version} is already in ${folder}." "Node ${node_version} 已在 ${folder} 中。"
  else
    url="$(mirror)/v$node_version/$name.tar.gz"
    say "Downloading Node ${node_version} from ${url}" "正在从 ${url} 下载 Node ${node_version}"
    if ! download "$url" "$work/$name.tar.gz"; then
      fail "Node could not be downloaded from $url. Check your network, or set BINFERENCE_NODE_MIRROR to a mirror, then run the installer again." \
        "无法从 ${url} 下载 Node。请检查网络，或把 BINFERENCE_NODE_MIRROR 设为一个镜像，然后再次运行安装脚本。"
    fi
    actual=$(sha256_of "$work/$name.tar.gz")
    if [ "$actual" != "$expected" ]; then
      fail "The Node archive's SHA-256 is $actual, not the pinned $expected, so nothing was installed. Check your network or mirror, then run the installer again." \
        "Node 压缩包的 SHA-256 是 ${actual}，而不是固定的 ${expected}，因此没有安装任何内容。请检查网络或镜像，然后再次运行安装脚本。"
    fi
    # Unpacked on the same disk as its folder, so the rename is whole or not at all.
    unpacking="$data/node/.unpacking-$$"
    rm -rf "$unpacking"
    mkdir -p "$unpacking"
    tar -xzf "$work/$name.tar.gz" -C "$unpacking"
    mv "$unpacking/$name" "$folder"
    rm -rf "$unpacking"
    say "Node ${node_version} is in ${folder}." "Node ${node_version} 已安装到 ${folder}。"
  fi
  check_node_runs "$folder"
  rm -f "$data/node/current"
  ln -s "$name" "$data/node/current"
  node_exe="$data/node/current/bin/node"
}

fetch_package() {
  if [ -n "$package_url" ]; then
    spec="$work/binference.tgz"
    if ! download_here "$package_url" "$spec"; then
      fail "$package_url did not answer 200 by itself; a redirect or an error stops the install. Check the address in BINFERENCE_INSTALL_PACKAGE." \
        "${package_url} 没有直接返回 200；重定向或错误都会停止安装。请检查 BINFERENCE_INSTALL_PACKAGE 中的地址。"
    fi
  elif [ -n "$package_file" ]; then
    spec=$package_file
  else
    channel_spec
  fi
}

# npm runs from the chosen Node's own folder, with that folder first on PATH for its scripts.
install_package() {
  node_dir=$(dirname "$node_exe")
  prefix="$data/npm"
  say "Installing ${spec} into ${prefix}" "正在把 ${spec} 安装到 ${prefix}"
  if ! PATH="$node_dir:$PATH" "$node_dir/npm" install --global --prefix "$prefix" \
    --no-fund --no-audit --no-update-notifier --loglevel=error "$spec"; then
    fail "npm could not install $spec; its error is above. Check your network and npm's registry setting, then run the installer again." \
      "npm 无法安装 ${spec}；错误信息见上方。请检查网络和 npm 的 registry 设置，然后再次运行安装脚本。"
  fi
}

# Single quotes for the launcher, with any quote in the text closed and reopened.
quoted() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# Writes the launcher: the one file of the folder the owner puts on PATH. It runs the package's
# entry with the chosen Node by its full path and the Node flags the entry's first line names,
# with that Node's folder first on PATH for binference alone, so `binference update` runs that
# Node's npm and installs into the same prefix, whose entry the launcher keeps running.
write_launcher() {
  package="$prefix/lib/node_modules/binference"
  facts=$("$node_exe" -e '
    const fs = require("node:fs");
    const path = require("node:path");
    const folder = process.argv[1];
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8"));
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.binference;
    const entry = path.join(folder, bin);
    const first = fs.readFileSync(entry, "utf8").split("\n")[0];
    const flags = /\bnode((?: +--[a-z0-9-]+)*) *$/.exec(first);
    console.log(entry + "\n" + (flags ? flags[1].trim() : ""));
  ' "$package" 2>/dev/null) || facts=""
  entry=$(printf '%s\n' "$facts" | sed -n 1p)
  flags=$(printf '%s\n' "$facts" | sed -n 2p)
  if [ -z "$entry" ] || [ ! -f "$entry" ]; then
    fail "npm finished, but binference's entry is missing in $package. Run the installer again; if it fails the same way, report it with npm's log." \
      "npm 已完成，但 ${package} 中缺少 binference 的入口文件。请再次运行安装脚本；如果仍然失败，请附上 npm 的日志报告问题。"
  fi
  mkdir -p "$data/bin"
  launcher="$data/bin/binference"
  {
    printf '#!/bin/sh\n'
    printf '# Written by the binference installer: runs binference with the Node it chose.\n'
    # The launcher expands $PATH when it runs, so the quotes stay single.
    # shellcheck disable=SC2016
    printf 'PATH=%s:"$PATH"\n' "$(quoted "$(dirname "$node_exe")")"
    printf 'export PATH\n'
    printf 'exec %s %s %s "$@"\n' "$(quoted "$node_exe")" "$flags" "$(quoted "$entry")"
  } >"$launcher.new"
  chmod 755 "$launcher.new"
  mv "$launcher.new" "$launcher"
  say "binference is installed: ${launcher}" "binference 已安装：${launcher}"
}

# The PATH line for a new terminal, printed only, since the startup file is the owner's to edit.
# The folder holds nothing but the launcher, and its name never changes with Node's version.
path_hint() {
  case ":$start_path:" in
    *":$data/bin:"*) return 0 ;;
  esac
  say "To run binference in a new terminal, add this line to your shell's startup file (such as ~/.zshrc or ~/.bashrc):" \
    "要在新终端中运行 binference，请把下面这一行加入你的 shell 启动文件（例如 ~/.zshrc 或 ~/.bashrc）："
  # The line keeps $PATH for the startup file to expand, so the quotes stay single.
  # shellcheck disable=SC2016
  printf '  export PATH="%s:$PATH"\n' "$data/bin"
}

run_init() {
  if [ -n "$skip_init" ]; then
    say "Set binference up when you are ready: binference init" "准备好后请设置 binference：binference init"
    return 0
  fi
  if [ -n "$unattended" ]; then
    if "$launcher" init --yes </dev/null; then return 0; else code=$?; fi
  elif (: </dev/tty) 2>/dev/null; then
    if "$launcher" init </dev/tty; then return 0; else code=$?; fi
  else
    say "No terminal can answer binference init's questions here. Run binference init in a terminal, or run the installer with --yes and init's answers in BINFERENCE_INIT_* variables." \
      "这里没有终端可以回答 binference init 的问题。请在终端中运行 binference init，或者带上 --yes 并把 init 的答案放在 BINFERENCE_INIT_* 变量中运行安装脚本。"
    return 0
  fi
  say "binference is installed, but init stopped; what it said is above. Fix that, then run: binference init" \
    "binference 已安装，但 init 已停止；原因见上方。处理后请运行：binference init" >&2
  exit "$code"
}

main() {
  channel=${BINFERENCE_INSTALL_CHANNEL:-stable}
  unattended=$(switch_value BINFERENCE_INSTALL_YES "${BINFERENCE_INSTALL_YES:-}")
  skip_init=$(switch_value BINFERENCE_INSTALL_SKIP_INIT "${BINFERENCE_INSTALL_SKIP_INIT:-}")
  read_flags "$@"
  if [ -z "${HOME:-}" ]; then
    fail "HOME is not set, so there is no folder of yours to install into. Set HOME, then run the installer again." \
      "HOME 未设置，因此没有属于你的文件夹可以安装。请设置 HOME，然后再次运行安装脚本。"
  fi
  data="${XDG_DATA_HOME:-$HOME/.local/share}/binference"
  start_path=$PATH
  package_url=""
  package_file=""
  if [ -n "${BINFERENCE_INSTALL_PACKAGE:-}" ]; then
    read_package_override
  else
    channel_spec
  fi
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  node_exe=""
  find_node || install_node
  fetch_package
  install_package
  write_launcher
  path_hint
  run_init
}

# The braces make a download cut short anywhere a syntax error, never a run without its flags.
{ main "$@"; }
