#!/usr/bin/env bash
# Chess Lens — cross-platform installer (macOS / Linux)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/video-db/chess-lens/main/install.sh | bash

set -euo pipefail

REPO="https://github.com/video-db/chess-lens.git"
INSTALL_DIR="$HOME/chess-lens"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[chess-lens]${RESET} $*"; }
success() { echo -e "${GREEN}[chess-lens]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[chess-lens]${RESET} $*"; }
die()     { echo -e "${RED}[chess-lens] ERROR:${RESET} $*" >&2; exit 1; }

# ── OS detection ─────────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="macOS" ;;
  Linux)  PLATFORM="Linux" ;;
  *)      die "Unsupported OS: $OS. Use install.ps1 on Windows." ;;
esac
info "Detected platform: $PLATFORM"

# ── Dependency checks ─────────────────────────────────────────────────────────
check_cmd() {
  command -v "$1" &>/dev/null || die "'$1' is required but not installed. $2"
}

check_cmd git  "Install git: https://git-scm.com/downloads"
check_cmd node "Install Node.js 18+: https://nodejs.org"
check_cmd npm  "npm ships with Node.js. Re-install Node: https://nodejs.org"

# Node version check (need 18+)
NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js 18+ is required. Found v$(node -v). Upgrade at https://nodejs.org"
fi

info "Node.js v$(node -v) — OK"
info "npm v$(npm -v) — OK"

# ── Clone or update ───────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  warn "Directory $INSTALL_DIR already exists — pulling latest changes."
  git -C "$INSTALL_DIR" pull --ff-only
else
  info "Cloning Chess Lens into $INSTALL_DIR ..."
  git clone "$REPO" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── Install dependencies ──────────────────────────────────────────────────────
info "Installing npm dependencies (this includes electron-rebuild for native modules) ..."
npm install

# ── Platform-specific permissions reminder ────────────────────────────────────
if [ "$PLATFORM" = "macOS" ]; then
  echo ""
  warn "macOS: grant Screen Recording + Microphone permissions before first run."
  warn "  System Settings → Privacy & Security → Screen Recording / Microphone"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
success "Installation complete!"
echo -e "  ${BOLD}Directory:${RESET} $INSTALL_DIR"
echo ""
echo -e "  ${BOLD}Start dev mode:${RESET}"
echo -e "    cd $INSTALL_DIR && npm run dev"
echo ""
echo -e "  ${BOLD}Build distributable:${RESET}"
echo -e "    cd $INSTALL_DIR && npm run dist"
echo ""
echo -e "  ${BOLD}First run:${RESET} enter your VideoDB API key (https://console.videodb.io)"
echo ""
