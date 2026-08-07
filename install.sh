#!/usr/bin/env bash
set -euo pipefail

REPO="s-h-a-d-o-w/s3-smart-sync"
REQUIRED_COMMANDS=(curl jq tar)
INSTALL_DIR="$PWD/s3-smart-sync"

TEMP_DIR="$(mktemp -d)"
ARCHIVE="$TEMP_DIR/s3-smart-sync-linux-x64.tar.gz"

installed_packages=()
install_cmd=()
remove_cmd=()
update_cmd=()

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo > /dev/null 2>&1; then
    sudo "$@"
  else
    echo "Error: root privileges are required to manage packages but sudo is not available." >&2
    return 1
  fi
}

detect_package_manager() {
  if command -v apt-get > /dev/null 2>&1; then
    update_cmd=(apt-get update)
    install_cmd=(apt-get install -y)
    remove_cmd=(apt-get remove -y)
  elif command -v dnf > /dev/null 2>&1; then
    install_cmd=(dnf install -y)
    remove_cmd=(dnf remove -y)
  elif command -v yum > /dev/null 2>&1; then
    install_cmd=(yum install -y)
    remove_cmd=(yum remove -y)
  elif command -v zypper > /dev/null 2>&1; then
    install_cmd=(zypper --non-interactive install)
    remove_cmd=(zypper --non-interactive remove)
  elif command -v pacman > /dev/null 2>&1; then
    install_cmd=(pacman -S --noconfirm --needed)
    remove_cmd=(pacman -Rs --noconfirm)
  elif command -v apk > /dev/null 2>&1; then
    install_cmd=(apk add)
    remove_cmd=(apk del)
  else
    return 1
  fi
}

cleanup() {
  rm -rf "$TEMP_DIR"

  if [ "${#installed_packages[@]}" -gt 0 ]; then
    echo "Removing dependencies that were only installed for this script: ${installed_packages[*]}"
    run_privileged "${remove_cmd[@]}" "${installed_packages[@]}" || true
  fi
}
trap cleanup EXIT

install_dependencies() {
  local missing=()
  local command_name

  for command_name in "${REQUIRED_COMMANDS[@]}"; do
    if ! command -v "$command_name" > /dev/null 2>&1; then
      missing+=("$command_name")
    fi
  done

  if [ "${#missing[@]}" -eq 0 ]; then
    return 0
  fi

  if ! detect_package_manager; then
    echo "Error: missing dependencies (${missing[*]}) and no supported package manager was found." >&2
    exit 1
  fi

  echo "Temporarily installing missing dependencies: ${missing[*]}"
  if [ "${#update_cmd[@]}" -gt 0 ]; then
    run_privileged "${update_cmd[@]}"
  fi

  for command_name in "${missing[@]}"; do
    run_privileged "${install_cmd[@]}" "$command_name"
    installed_packages+=("$command_name")
  done
}

install_dependencies

echo "Looking up the latest release..."
download_url="$(
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | jq -r '.assets[] | select(.name | endswith("linux-x64.tar.gz")) | .browser_download_url'
)"

if [ -z "$download_url" ]; then
  echo "Error: no linux-x64 asset found in the latest release." >&2
  exit 1
fi

echo "Downloading $download_url"
curl -fsSL -o "$ARCHIVE" "$download_url"

echo "Extracting to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
tar -xzf "$ARCHIVE" -C "$INSTALL_DIR" --strip-components=1

echo "Done. Fill in the required variables in $INSTALL_DIR/.env, then run $INSTALL_DIR/s3-smart-sync"
