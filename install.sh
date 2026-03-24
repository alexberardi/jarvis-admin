#!/bin/sh
set -e

# Jarvis Admin Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/alexberardi/jarvis-admin/main/install.sh | sh

REPO="alexberardi/jarvis-admin"
INSTALL_DIR="$HOME/.jarvis/bin"
BINARY_NAME="jarvis-admin"
SERVICE_NAME="jarvis-admin"

# Colors (if terminal supports them)
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info() { printf "${BLUE}>${NC} %s\n" "$1"; }
success() { printf "${GREEN}>${NC} %s\n" "$1"; }
error() { printf "${RED}>${NC} %s\n" "$1" >&2; exit 1; }

# Detect platform
detect_platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)

  case "$OS" in
    darwin) OS="darwin" ;;
    linux)  OS="linux" ;;
    *)      error "Unsupported OS: $OS" ;;
  esac

  case "$ARCH" in
    x86_64|amd64)  ARCH="x64" ;;
    arm64|aarch64) ARCH="arm64" ;;
    *)             error "Unsupported architecture: $ARCH" ;;
  esac

  BINARY="jarvis-admin-${OS}-${ARCH}"
  info "Detected platform: ${OS}-${ARCH}"
}

# Get latest release tag
get_latest_version() {
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

  if [ -z "$VERSION" ]; then
    error "Could not determine latest version. Check https://github.com/${REPO}/releases"
  fi
  info "Latest version: ${VERSION}"
}

# Check prerequisites
check_prereqs() {
  if ! command -v docker >/dev/null 2>&1; then
    printf "${BOLD}Warning:${NC} Docker not found. Jarvis requires Docker to run services.\n"
    printf "  Install: https://docs.docker.com/get-docker/\n\n"
  fi

  if ! command -v curl >/dev/null 2>&1; then
    error "curl is required but not installed"
  fi
}

# Download and install
install_binary() {
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BINARY}"

  info "Downloading ${BINARY}..."
  mkdir -p "$INSTALL_DIR"

  if ! curl -fsSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"; then
    error "Download failed. Check if release exists: https://github.com/${REPO}/releases/tag/${VERSION}"
  fi

  chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
  success "Installed binary to ${INSTALL_DIR}/${BINARY_NAME}"

  # Download frontend assets
  PUBLIC_URL="https://github.com/${REPO}/releases/download/${VERSION}/public.tar.gz"
  info "Downloading frontend assets..."
  if curl -fsSL "$PUBLIC_URL" | tar xz -C "$INSTALL_DIR"; then
    success "Frontend assets installed to ${INSTALL_DIR}/public/"
  else
    error "Failed to download frontend assets"
  fi
}

# Add to PATH if needed
setup_path() {
  if echo "$PATH" | grep -q "$INSTALL_DIR"; then
    return
  fi

  SHELL_NAME=$(basename "$SHELL")
  case "$SHELL_NAME" in
    zsh)  RC_FILE="$HOME/.zshrc" ;;
    bash) RC_FILE="$HOME/.bashrc" ;;
    *)    RC_FILE="" ;;
  esac

  if [ -n "$RC_FILE" ]; then
    if ! grep -q ".jarvis/bin" "$RC_FILE" 2>/dev/null; then
      printf '\n# Jarvis\nexport PATH="$HOME/.jarvis/bin:$PATH"\n' >> "$RC_FILE"
      info "Added ${INSTALL_DIR} to PATH in ${RC_FILE}"
    fi
  fi

  export PATH="${INSTALL_DIR}:${PATH}"
}

# Set up systemd service (Linux) or launchd (macOS) for autostart
setup_autostart() {
  if [ "$OS" = "linux" ] && command -v systemctl >/dev/null 2>&1; then
    info "Setting up systemd service..."

    SERVICE_FILE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
    mkdir -p "$(dirname "$SERVICE_FILE")"

    cat > "$SERVICE_FILE" << UNIT
[Unit]
Description=Jarvis Admin Dashboard
After=network.target docker.service

[Service]
Type=simple
ExecStart=${INSTALL_DIR}/${BINARY_NAME}
Restart=on-failure
RestartSec=5
Environment=PORT=7711
Environment=STATIC_DIR=${INSTALL_DIR}/public

[Install]
WantedBy=default.target
UNIT

    systemctl --user daemon-reload
    systemctl --user enable "$SERVICE_NAME" 2>/dev/null || true
    systemctl --user restart "$SERVICE_NAME"

    # Enable lingering so user services start at boot (not just on login)
    loginctl enable-linger "$(whoami)" 2>/dev/null || true

    success "Systemd service installed and started"

  elif [ "$OS" = "darwin" ]; then
    info "Setting up launchd service..."

    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$PLIST_DIR/com.jarvis.admin.plist"
    mkdir -p "$PLIST_DIR"

    cat > "$PLIST_FILE" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.jarvis.admin</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/${BINARY_NAME}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>7711</string>
    <key>STATIC_DIR</key>
    <string>${INSTALL_DIR}/public</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.jarvis/logs/admin.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.jarvis/logs/admin.log</string>
</dict>
</plist>
PLIST

    mkdir -p "$HOME/.jarvis/logs"
    launchctl unload "$PLIST_FILE" 2>/dev/null || true
    launchctl load "$PLIST_FILE"

    success "LaunchAgent installed and started"

  else
    # Fallback: just start in background
    info "Starting jarvis-admin in background..."
    STATIC_DIR="${INSTALL_DIR}/public" PORT=7711 \
      nohup "${INSTALL_DIR}/${BINARY_NAME}" > "$HOME/.jarvis/logs/admin.log" 2>&1 &
    success "Started (PID: $!)"
  fi
}

# Print success message
print_success() {
  printf "\n"
  printf "${GREEN}${BOLD}Jarvis Admin is running!${NC}\n"
  printf "\n"
  printf "  Open ${BLUE}http://localhost:7711${NC} in your browser to get started.\n"
  printf "\n"
  printf "  The admin service starts automatically on boot.\n"
  printf "  Manage it with: ${BOLD}systemctl --user status jarvis-admin${NC}\n"
  printf "\n"
}

# Main
main() {
  printf "\n${BOLD}Jarvis Admin Installer${NC}\n\n"

  check_prereqs
  detect_platform
  get_latest_version
  install_binary
  setup_path
  setup_autostart
  print_success
}

main
