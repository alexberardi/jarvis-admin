#!/bin/sh
set -e

# Jarvis Admin Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/alexberardi/jarvis-admin/main/install.sh | sh

REPO="alexberardi/jarvis-admin"
INSTALL_DIR="$HOME/.jarvis/bin"
BINARY_NAME="jarvis-admin"

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
  success "Installed to ${INSTALL_DIR}/${BINARY_NAME}"
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

# Print success message
print_success() {
  printf "\n"
  printf "${GREEN}${BOLD}Jarvis Admin installed successfully!${NC}\n"
  printf "\n"
  printf "  Start the setup wizard:\n"
  printf "    ${BOLD}jarvis-admin${NC}\n"
  printf "\n"
  printf "  Then open ${BLUE}http://localhost:7711${NC} in your browser.\n"
  printf "\n"

  if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
    printf "  ${BOLD}Note:${NC} Restart your terminal or run:\n"
    printf "    export PATH=\"\$HOME/.jarvis/bin:\$PATH\"\n"
    printf "\n"
  fi
}

# Main
main() {
  printf "\n${BOLD}Jarvis Admin Installer${NC}\n\n"

  check_prereqs
  detect_platform
  get_latest_version
  install_binary
  setup_path
  print_success
}

main
