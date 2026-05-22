# Chess Lens — Windows installer script
# Usage (run in PowerShell as normal user, NOT as Administrator):
#
#   irm https://raw.githubusercontent.com/video-db/chess-lens/main/install.ps1 | iex
#
# Or download and run locally:
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
#   .\install.ps1

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repo      = 'https://github.com/video-db/chess-lens.git'
$InstallDir = "$HOME\chess-lens"

# ── Colour helpers ─────────────────────────────────────────────────────────────
function Write-Info    ($msg) { Write-Host "[chess-lens] $msg" -ForegroundColor Cyan   }
function Write-Success ($msg) { Write-Host "[chess-lens] $msg" -ForegroundColor Green  }
function Write-Warn    ($msg) { Write-Host "[chess-lens] $msg" -ForegroundColor Yellow }
function Write-Die     ($msg) { Write-Host "[chess-lens] ERROR: $msg" -ForegroundColor Red; exit 1 }

# ── OS guard ───────────────────────────────────────────────────────────────────
if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) {
    Write-Die "This script is for Windows. On macOS/Linux run install.sh instead."
}
Write-Info "Detected platform: Windows"

# ── Dependency checks ──────────────────────────────────────────────────────────
function Require-Command ($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Die "'$cmd' is required but not found. $hint"
    }
}

Require-Command git  "Install Git for Windows: https://git-scm.com/download/win"
Require-Command node "Install Node.js 18+: https://nodejs.org"
Require-Command npm  "npm ships with Node.js. Re-install Node: https://nodejs.org"

# Node version check (need 18+)
$nodeMajor = [int](node -e "process.stdout.write(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 18) {
    $nodeVer = node -e "process.stdout.write(process.version)"
    Write-Die "Node.js 18+ is required. Found $nodeVer. Upgrade at https://nodejs.org"
}

Write-Info "Node.js $(node -e 'process.stdout.write(process.version)') — OK"
Write-Info "npm v$(npm -v) — OK"

# ── Clone or update ────────────────────────────────────────────────────────────
if (Test-Path "$InstallDir\.git") {
    Write-Warn "Directory $InstallDir already exists — pulling latest changes."
    git -C $InstallDir pull --ff-only
} else {
    Write-Info "Cloning Chess Lens into $InstallDir ..."
    git clone $Repo $InstallDir
}

Set-Location $InstallDir

# ── Install dependencies ───────────────────────────────────────────────────────
Write-Info "Installing npm dependencies (this includes electron-rebuild for native modules) ..."
npm install

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Success "Installation complete!"
Write-Host "  Directory : $InstallDir"
Write-Host ""
Write-Host "  Start dev mode:"
Write-Host "    cd `"$InstallDir`"; npm run dev"
Write-Host ""
Write-Host "  Build distributable:"
Write-Host "    cd `"$InstallDir`"; npm run dist"
Write-Host ""
Write-Host "  First run: enter your VideoDB API key (https://console.videodb.io)"
Write-Host ""
