# Installs binference on Windows: Node 26 when this machine has no Node 26.1 or later, then the
# binference package from npm into a folder of the owner's, a `binference` launcher that runs it
# with that Node, then `binference init`. It never asks for administrator rights and never changes
# PATH by itself. Run it with --help for its flags and variables. It runs in Windows PowerShell 5.1
# and in PowerShell 7.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'

  # The Node release this script installs, and the SHA-256 of each archive it may fetch, from
  # Node's signed SHASUMS256.txt. A release script writes this block; never edit it by hand.
  # node-pins:start
  $NodeVersion = '26.13.0'
  $NodeHashes = @{
    'win-arm64' = 'a9427139595156ef484e1fb08957676e09d4232368dd1743a2a9f93f3d241b14'
    'win-x64' = 'dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a'
  }
  # node-pins:end

  # The oldest Node binference runs on, as its package's `engines` field says.
  $NodeFloor = [version]'26.1'

  # Any Chinese display language, Traditional included, gets the Simplified Chinese lines.
  $Chinese = (Get-UICulture).Name -like 'zh*'

  # Each message comes in English and Simplified Chinese; the UI language picks one.
  function Say([string]$English, [string]$Zh) {
    if ($Chinese) { Write-Host $Zh } else { Write-Host $English }
  }

  # Stops the install: the message goes to the error stream and the block below ends with 1.
  function Stop-Install([string]$English, [string]$Zh) {
    if ($Chinese) { [Console]::Error.WriteLine($Zh) } else { [Console]::Error.WriteLine($English) }
    throw 'binference-install-stopped'
  }

  function Show-Usage {
    Say @'
Usage: install.ps1 [--beta] [--yes] [--skip-init] [--help]

Installs Node 26 when this machine lacks it, then the binference package from npm, then runs
binference init. It never asks for administrator rights.

  --beta       Install from the beta channel instead of stable.
  --yes        Run binference init --yes, which asks nothing; init takes its answers from the
               BINFERENCE_INIT_* variables or the answers file BINFERENCE_INIT_ANSWERS names.
  --skip-init  Install only; run binference init yourself later.

Variables: BINFERENCE_INSTALL_CHANNEL (stable or beta), BINFERENCE_INSTALL_YES=1,
BINFERENCE_INSTALL_SKIP_INIT=1, BINFERENCE_NODE_MIRROR (an https:// Node download mirror; the
pinned checksums still decide), BINFERENCE_INSTALL_PACKAGE (a local tarball, for tests only).
'@ @'
用法：install.ps1 [--beta] [--yes] [--skip-init] [--help]

在本机缺少 Node 26 时安装它，然后从 npm 安装 binference 包，再运行 binference init。
它从不要求管理员权限。

  --beta       从 beta 渠道安装，而不是 stable。
  --yes        运行 binference init --yes，不提任何问题；init 从 BINFERENCE_INIT_* 变量或
               BINFERENCE_INIT_ANSWERS 指定的应答文件读取答案。
  --skip-init  只安装；之后自己运行 binference init。

变量：BINFERENCE_INSTALL_CHANNEL（stable 或 beta）、BINFERENCE_INSTALL_YES=1、
BINFERENCE_INSTALL_SKIP_INIT=1、BINFERENCE_NODE_MIRROR（https:// 的 Node 下载镜像；仍以固定的
校验和为准）、BINFERENCE_INSTALL_PACKAGE（本地包文件，仅供测试）。
'@
  }

  # A yes or no variable: unset, empty or 1; anything else stops with the next step.
  function Read-Switch([string]$Name) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if (-not $value) { return $false }
    if ($value -ceq '1') { return $true }
    Stop-Install "$Name is $value; set it to 1 or leave it unset, then run the installer again." `
      "${Name} 的值是 ${value}；请把它设为 1 或不设置，然后再次运行安装脚本。"
  }

  function Read-Flags([string[]]$Words) {
    $flags = @{
      Channel = $env:BINFERENCE_INSTALL_CHANNEL
      Yes = Read-Switch 'BINFERENCE_INSTALL_YES'
      SkipInit = Read-Switch 'BINFERENCE_INSTALL_SKIP_INIT'
      Help = $false
    }
    if (-not $flags.Channel) { $flags.Channel = 'stable' }
    foreach ($word in $Words) {
      switch -CaseSensitive ($word) {
        '--beta' { $flags.Channel = 'beta' }
        '--yes' { $flags.Yes = $true }
        '--skip-init' { $flags.SkipInit = $true }
        { $_ -eq '--help' -or $_ -eq '-h' } { $flags.Help = $true }
        default {
          Stop-Install "Unknown flag $word. Run the installer with --help to see its flags; init's answers go in BINFERENCE_INIT_* variables, never on the command line." `
            "未知参数 ${word}。用 --help 运行安装脚本查看它的参数；init 的答案放在 BINFERENCE_INIT_* 变量中，从不放在命令行上。"
        }
      }
    }
    return $flags
  }

  # The test-only package override, read strictly: a loopback URL with a port and no user, query
  # or fragment, or an existing .tgz file by its full path. Answers @{ Url } or @{ File }.
  function Read-PackageOverride([string]$Value) {
    if ($Value -cmatch '^http://(127\.0\.0\.1|localhost|\[::1\]):[0-9]+/[^?#@\s]*\.tgz$') {
      $answer = @{ Url = $Value }
    } elseif ($Value -notmatch '[?#@]' -and $Value -like '*.tgz' -and [IO.Path]::IsPathRooted($Value) -and
      (Test-Path -LiteralPath $Value -PathType Leaf)) {
      $answer = @{ File = $Value }
    } else {
      Stop-Install 'BINFERENCE_INSTALL_PACKAGE takes only an existing .tgz file by its full path, or an http address of a .tgz on 127.0.0.1, localhost or [::1] with a port, for tests. Unset it to install binference from npm.' `
        'BINFERENCE_INSTALL_PACKAGE 只接受以完整路径给出的现有 .tgz 文件，或 127.0.0.1、localhost、[::1] 上带端口的 .tgz 的 http 地址，仅供测试。取消设置它即可从 npm 安装 binference。'
    }
    Say "Installing $Value, which BINFERENCE_INSTALL_PACKAGE names, not a release from npm." `
      "正在安装 BINFERENCE_INSTALL_PACKAGE 指定的 ${Value}，而不是 npm 上的发行版。"
    return $answer
  }

  function Get-ChannelSpec([string]$Channel) {
    switch -CaseSensitive ($Channel) {
      'stable' { return 'binference@latest' }
      'beta' { return 'binference@beta' }
      default {
        Stop-Install "BINFERENCE_INSTALL_CHANNEL is $Channel; it takes stable or beta." `
          "BINFERENCE_INSTALL_CHANNEL 的值是 ${Channel}；它只接受 stable 或 beta。"
      }
    }
  }

  # The real node.exe on PATH when it is Node 26.1 or later and its own npm sits in its folder,
  # not a version manager's shim, so the launcher keeps this Node.
  function Find-Node {
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { return $null }
    $ErrorActionPreference = 'Continue'
    $facts = @(& $node.Source -p 'process.execPath + String.fromCharCode(10) + process.versions.node' 2>$null)
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0 -or $facts.Count -lt 2) { return $null }
    $exe = [string]$facts[0]
    $found = ([string]$facts[1]).Split('-')[0]
    $parsed = $null
    if (-not [version]::TryParse($found, [ref]$parsed)) { return $null }
    if ($parsed -lt $NodeFloor) { return $null }
    if (-not (Test-Path -LiteralPath (Join-Path (Split-Path $exe) 'npm.cmd'))) { return $null }
    Say "Node $found is installed at ${exe}; using it." "已安装 Node ${found}（${exe}）；将使用它。"
    return $exe
  }

  function Get-Platform {
    $arch = $null
    try {
      $arch = [string][Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    } catch {
      $arch = $env:PROCESSOR_ARCHITEW6432
      if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    }
    # An x64 PowerShell on an ARM64 Windows reports the machine's own architecture here; -eq
    # ignores case.
    switch ($arch) {
      { $_ -eq 'x64' -or $_ -eq 'amd64' } { return 'win-x64' }
      { $_ -eq 'arm64' } { return 'win-arm64' }
      default {
        Stop-Install "Node's official builds do not cover the $arch processor. Install Node 26 yourself, then run the installer again." `
          "Node 官方构建不支持 ${arch} 处理器。请自行安装 Node 26，然后再次运行安装脚本。"
      }
    }
  }

  function Get-Mirror {
    $base = $env:BINFERENCE_NODE_MIRROR
    if (-not $base) { $base = 'https://nodejs.org/dist' }
    if (-not ($base -like 'https://*' -or $base -like 'http://127.0.0.1:*')) {
      Stop-Install 'BINFERENCE_NODE_MIRROR must be an https:// address. Fix it or unset it, then run the installer again.' `
        'BINFERENCE_NODE_MIRROR 必须是 https:// 地址。请改正或取消设置它，然后再次运行安装脚本。'
    }
    return $base.TrimEnd('/')
  }

  # Starts the Node in a folder once; a Node that cannot run here is removed, never kept.
  function Test-NodeRuns([string]$Folder) {
    $ErrorActionPreference = 'Continue'
    $reason = @(& (Join-Path $Folder 'node.exe') --version 2>&1) -join ' '
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -eq 0) { return }
    Remove-Item -Recurse -Force -LiteralPath $Folder -ErrorAction SilentlyContinue
    Stop-Install "Node $NodeVersion cannot run on this machine: $reason. Install Node 26 yourself, then run the installer again." `
      "Node ${NodeVersion} 无法在本机运行：${reason}。请自行安装 Node 26，然后再次运行安装脚本。"
  }

  # Fetches the pinned Node archive, checks its SHA-256 against the pin and only then unpacks it
  # beside its final folder and moves it there. A mismatch stops before anything is unpacked.
  function Install-Node([string]$Data, [string]$Work) {
    $platform = Get-Platform
    $expected = $NodeHashes[$platform]
    $name = "node-v$NodeVersion-$platform"
    $nodes = Join-Path $Data 'node'
    $folder = Join-Path $nodes $name
    if (Test-Path -LiteralPath (Join-Path $folder 'node.exe')) {
      Say "Node $NodeVersion is already in ${folder}." "Node ${NodeVersion} 已在 ${folder} 中。"
    } else {
      $url = "$(Get-Mirror)/v$NodeVersion/$name.zip"
      Say "Downloading Node $NodeVersion from $url" "正在从 ${url} 下载 Node ${NodeVersion}"
      $archive = Join-Path $Work "$name.zip"
      try {
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
      } catch {
        Stop-Install "Node could not be downloaded from $url. Check your network, or set BINFERENCE_NODE_MIRROR to a mirror, then run the installer again." `
          "无法从 ${url} 下载 Node。请检查网络，或把 BINFERENCE_NODE_MIRROR 设为一个镜像，然后再次运行安装脚本。"
      }
      $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
      if ($actual -ne $expected) {
        Stop-Install "The Node archive's SHA-256 is $actual, not the pinned $expected, so nothing was installed. Check your network or mirror, then run the installer again." `
          "Node 压缩包的 SHA-256 是 ${actual}，而不是固定的 ${expected}，因此没有安装任何内容。请检查网络或镜像，然后再次运行安装脚本。"
      }
      # Unpacked on the same disk as its folder, so the move is a rename.
      $unpacking = Join-Path $nodes ('.unpacking-' + [guid]::NewGuid())
      New-Item -ItemType Directory -Force -Path $unpacking | Out-Null
      Expand-Archive -LiteralPath $archive -DestinationPath $unpacking
      Move-Item -LiteralPath (Join-Path $unpacking $name) -Destination $folder
      Remove-Item -Recurse -Force -LiteralPath $unpacking
      Say "Node $NodeVersion is in ${folder}." "Node ${NodeVersion} 已安装到 ${folder}。"
    }
    Test-NodeRuns $folder
    $current = Join-Path $nodes 'current'
    if (Test-Path -LiteralPath $current) { [IO.Directory]::Delete($current) }
    New-Item -ItemType Junction -Path $current -Target $folder | Out-Null
    return (Join-Path $current 'node.exe')
  }

  # One GET that must answer 200 itself: a redirect is a failure.
  function Get-LoopbackPackage([string]$Url, [string]$Work) {
    $file = Join-Path $Work 'binference.tgz'
    $status = 0
    try {
      $status = (Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $file -MaximumRedirection 0 -PassThru).StatusCode
    } catch {
      $status = 0
    }
    if ($status -ne 200) {
      Stop-Install "$Url did not answer 200 by itself; a redirect or an error stops the install. Check the address in BINFERENCE_INSTALL_PACKAGE." `
        "${Url} 没有直接返回 200；重定向或错误都会停止安装。请检查 BINFERENCE_INSTALL_PACKAGE 中的地址。"
    }
    return $file
  }

  # The package's entry file, and the Node flags its first line names.
  $entryScript = @'
const fs = require('node:fs');
const path = require('node:path');
const folder = process.argv[1];
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.binference;
const entry = path.join(folder, bin);
const first = fs.readFileSync(entry, 'utf8').split(/\r?\n/)[0];
const flags = /\bnode((?: +--[a-z0-9-]+)*) *$/.exec(first);
console.log(entry + '\n' + (flags ? flags[1].trim() : ''));
'@

  # Writes the launcher, the one file of the folder the owner puts on PATH: it runs the entry with
  # the chosen Node by its full path through the stable current link, with that Node's folder
  # first on PATH for binference alone (setlocal), so `binference update` runs that Node's npm and
  # installs into the same prefix. cmd reads % as a variable, so each one is doubled.
  function Write-Launcher([string]$NodeExe, [string]$Prefix, [string]$Data) {
    $package = Join-Path (Join-Path $Prefix 'node_modules') 'binference'
    $ErrorActionPreference = 'Continue'
    $facts = @(& $NodeExe -e $entryScript $package 2>$null)
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -ne 0 -or $facts.Count -lt 1 -or -not (Test-Path -LiteralPath ([string]$facts[0]) -PathType Leaf)) {
      Stop-Install "npm finished, but binference's entry is missing in $package. Run the installer again; if it fails the same way, report it with npm's log." `
        "npm 已完成，但 ${package} 中缺少 binference 的入口文件。请再次运行安装脚本；如果仍然失败，请附上 npm 的日志报告问题。"
    }
    $entry = [string]$facts[0]
    $flags = ''
    if ($facts.Count -gt 1) { $flags = [string]$facts[1] }
    $bin = Join-Path $Data 'bin'
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $launcher = Join-Path $bin 'binference.cmd'
    $lines = @(
      '@echo off',
      'rem Written by the binference installer: runs binference with the Node it chose.',
      'setlocal',
      ('set "PATH={0};%PATH%"' -f (Split-Path $NodeExe).Replace('%', '%%')),
      ('"{0}" {1} "{2}" %*' -f $NodeExe.Replace('%', '%%'), $flags, $entry.Replace('%', '%%'))
    )
    # cmd reads a batch file in the console's OEM code page, so a name such as a Chinese user
    # folder must be written in it.
    $oem = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
    [IO.File]::WriteAllLines("$launcher.new", $lines, $oem)
    Move-Item -Force -LiteralPath "$launcher.new" -Destination $launcher
    Say "binference is installed: $launcher" "binference 已安装：${launcher}"
    return $launcher
  }

  # The user's PATH as stored, with its %VARIABLES% unexpanded.
  function Get-UserPath {
    $key = Get-Item -LiteralPath 'HKCU:\Environment'
    return [string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames')
  }

  # The command that adds the launcher's folder to the user's PATH, printed only, since PATH is
  # the owner's to change. It keeps the stored PATH's %VARIABLES% and its type.
  function Show-PathHint([string]$Folder) {
    if ((Get-UserPath) -split ';' -contains $Folder) { return }
    Say 'To run binference in a new terminal, add its folder to your user PATH in "Edit environment variables for your account", or run this command:' `
      '要在新终端中运行 binference，请在“编辑你的账户的环境变量”中把它的文件夹加入用户 PATH，或运行下面这条命令：'
    $quoted = $Folder.Replace("'", "''")
    Write-Host "  `$old = (Get-Item 'HKCU:\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames'); Set-ItemProperty 'HKCU:\Environment' -Name Path -Type ExpandString -Value ('$quoted;' + `$old)"
  }

  # npm, node and init run as statements of this block, never inside a function whose result is
  # kept, so their output and prompts reach the console; each runs with errors set to Continue,
  # since Windows PowerShell turns a native program's stderr into errors, and each exit code is
  # checked.
  $code = 0
  $work = Join-Path ([IO.Path]::GetTempPath()) ('binference-install-' + [guid]::NewGuid())
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
    $flags = Read-Flags @($args)
    if ($flags.Help) {
      Show-Usage
      throw 'binference-install-done'
    }
    $data = Join-Path $env:LOCALAPPDATA 'binference'
    $override = $null
    if ($env:BINFERENCE_INSTALL_PACKAGE) {
      $override = Read-PackageOverride $env:BINFERENCE_INSTALL_PACKAGE
    } else {
      $spec = Get-ChannelSpec $flags.Channel
    }
    New-Item -ItemType Directory -Path $work | Out-Null
    $nodeExe = Find-Node
    if (-not $nodeExe) { $nodeExe = Install-Node $data $work }
    if ($override -and $override.Url) { $spec = Get-LoopbackPackage $override.Url $work }
    if ($override -and $override.File) { $spec = $override.File }
    $nodeDir = Split-Path $nodeExe
    $prefix = Join-Path $data 'npm'
    Say "Installing $spec into $prefix" "正在把 ${spec} 安装到 ${prefix}"
    $savedPath = $env:Path
    $env:Path = "$nodeDir;$env:Path"
    $ErrorActionPreference = 'Continue'
    & (Join-Path $nodeDir 'npm.cmd') install --global --prefix $prefix --no-fund --no-audit --no-update-notifier --loglevel=error $spec
    $npmCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    $env:Path = $savedPath
    if ($npmCode -ne 0) {
      Stop-Install "npm could not install $spec; its error is above. Check your network and npm's registry setting, then run the installer again." `
        "npm 无法安装 ${spec}；错误信息见上方。请检查网络和 npm 的 registry 设置，然后再次运行安装脚本。"
    }
    $launcher = Write-Launcher $nodeExe $prefix $data
    Show-PathHint (Split-Path $launcher)
    if ($flags.SkipInit) {
      Say 'Set binference up when you are ready: binference init' '准备好后请设置 binference：binference init'
    } elseif ($flags.Yes) {
      $ErrorActionPreference = 'Continue'
      & $launcher init --yes
      $code = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
    } elseif ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
      $ErrorActionPreference = 'Continue'
      & $launcher init
      $code = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
    } else {
      Say 'No terminal can answer binference init''s questions here. Run binference init in a terminal, or run the installer with --yes and init''s answers in BINFERENCE_INIT_* variables.' `
        '这里没有终端可以回答 binference init 的问题。请在终端中运行 binference init，或者带上 --yes 并把 init 的答案放在 BINFERENCE_INIT_* 变量中运行安装脚本。'
    }
    if ($code -ne 0) {
      $text = 'binference is installed, but init stopped; what it said is above. Fix that, then run: binference init'
      if ($Chinese) { $text = 'binference 已安装，但 init 已停止；原因见上方。处理后请运行：binference init' }
      [Console]::Error.WriteLine($text)
    }
  } catch {
    $reason = $_.Exception.Message
    if ($reason -ne 'binference-install-done') {
      if ($reason -ne 'binference-install-stopped') { [Console]::Error.WriteLine($reason) }
      $code = 1
    }
  } finally {
    Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue
  }
  # Run as a file, the script ends with the code; pasted into a window, it leaves the window open
  # and sets $LASTEXITCODE.
  if ($PSCommandPath) { exit $code }
  $global:LASTEXITCODE = $code
} @args
