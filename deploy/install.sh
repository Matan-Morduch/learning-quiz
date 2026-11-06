#!/usr/bin/env bash
# shellcheck disable=SC2015  # `test && ok || warn` is intended: ok/warn/info never fail
# Home-server install kit for the quiz app (Ubuntu Server 24.04 LTS, x86_64, optional NVIDIA Pascal GPU).
# Run as your normal user (NOT root) from the checkout; it uses sudo where needed. Safe to re-run:
# every step checks what's already there and skips it.
#
#   ~/learning-quiz/deploy/install.sh                 # everything except the lab VM
#   ~/learning-quiz/deploy/install.sh --with-lab      # + the Rocky Linux lab VM (KVM)
#   ~/learning-quiz/deploy/install.sh --only units,serve
#   ~/learning-quiz/deploy/install.sh --skip nvidia,cuda
#
# Options:
#   --with-lab            also build the Rocky Linux 9 lab VM (host alias `rocky`)
#   --lab-user NAME       user inside the lab VM (default: your username)
#   --no-gpu              skip the NVIDIA driver + CUDA; build whisper.cpp for the CPU
#   --vault-name NAME     the vault's name in Obsidian, used in obsidian:// links (default: matan)
#   --backup-disk DEV     mount an EXISTING filesystem (e.g. /dev/sdb1 or UUID=…) at /mnt/hdd for backups.
#                         Never formats anything; see docs/HOME-SERVER.md for preparing the disk.
#   --only STEPS          run just these steps (comma-separated)
#   --skip STEPS          skip these steps
#   --yes                 non-interactive: never prompt; print the login steps instead of running them
#   -h, --help
# Steps, in order:
#   base power ssh nvidia cuda node tailscale claude obsidian repo whisper voice units serve remote backup lab
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/learning-quiz"
BARE="$HOME/learning-quiz.git"
VAULT="$HOME/vault"
CONF_DIR="$HOME/.config/learning-quiz"
ENV_FILE="$CONF_DIR/env"
UNIT_DIR="$HOME/.config/systemd/user"
BIN="$HOME/.local/bin"
PORT=4747
NODE_MAJOR="${NODE_MAJOR:-22}"
CUDA_VER="${CUDA_VER:-12.9}"            # last major line that still compiles for Pascal (sm_61); 13.x dropped it
CUDA_PKG_VER="${CUDA_VER/./-}"
NVIDIA_BRANCH="${NVIDIA_BRANCH:-580}"   # last driver branch that supports Pascal (GTX 10xx)
WHISPER_REF="${WHISPER_REF:-v1.8.3}"
WHISPER_MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
ROCKY_URL="${ROCKY_URL:-https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2}"
LAB_IP=192.168.122.10
LAB_MAC=52:54:00:4c:51:0a
LAB_DIR=/var/lib/libvirt/images

WITH_LAB=0 GPU=1 YES=0 ONLY="" SKIP="" LAB_USER="$USER" VAULT_NAME="" BACKUP_DISK=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-lab) WITH_LAB=1 ;;
    --lab-user) LAB_USER="${2:?}"; shift ;;
    --no-gpu) GPU=0 ;;
    --vault-name) VAULT_NAME="${2:?}"; shift ;;
    --backup-disk) BACKUP_DISK="${2:?}"; shift ;;
    --only) ONLY="${2:?}"; shift ;;
    --skip) SKIP="${2:?}"; shift ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '3,24p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
  shift
done

# ---------- helpers ----------
c_b=$'\e[1m' c_g=$'\e[32m' c_y=$'\e[33m' c_r=$'\e[31m' c_0=$'\e[0m'
[[ -t 1 ]] || { c_b="" c_g="" c_y="" c_r="" c_0=""; }
heading() { printf '\n%s━━ %s ━━%s\n' "$c_b" "$*" "$c_0"; }
ok()      { printf '  %s✓%s %s\n' "$c_g" "$c_0" "$*"; }
info()    { printf '  → %s\n' "$*"; }
warn()    { printf '  %s!%s %s\n' "$c_y" "$c_0" "$*"; WARNINGS+=("$*"); }
die()     { printf '%s✗ %s%s\n' "$c_r" "$*" "$c_0" >&2; exit 1; }
todo()    { TODOS+=("$*"); }
have()    { command -v "$1" >/dev/null 2>&1; }
interactive() { [[ $YES == 0 && -t 0 && -t 1 ]]; }
ask() { interactive || return 1; local r; read -r -p "  $1 [y/N] " r; [[ "$r" =~ ^[Yy] ]]; }
WARNINGS=() TODOS=() REBOOT=0

# set_env KEY VALUE: write/replace one line in ~/.config/learning-quiz/env (the units read it).
set_env() {
  mkdir -p "$CONF_DIR"; touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  local tmp; tmp="$(mktemp)"
  grep -v -E "^#?[[:space:]]*$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  mv -f "$tmp" "$ENV_FILE"; chmod 600 "$ENV_FILE"
}
get_env() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }

apt_install() {   # only installs what's missing, so re-runs are quick
  local missing=() p
  for p in "$@"; do dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p"); done
  [[ ${#missing[@]} -eq 0 ]] && return 0
  info "apt install ${missing[*]}"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
}

in_list() { [[ ",$1," == *",$2,"* ]]; }
STEPS=(base power ssh nvidia cuda node tailscale claude obsidian repo whisper voice units serve remote backup lab)
want() {
  local s="$1"
  [[ -n "$ONLY" ]] && { in_list "$ONLY" "$s"; return; }
  in_list "$SKIP" "$s" && return 1
  case "$s" in
    nvidia|cuda) [[ $GPU == 1 ]] ;;
    lab) [[ $WITH_LAB == 1 ]] ;;
    *) return 0 ;;
  esac
}
for s in ${ONLY//,/ } ${SKIP//,/ }; do
  printf '%s\n' "${STEPS[@]}" | grep -qx "$s" || die "Unknown step '$s'. Steps: ${STEPS[*]}"
done

# ---------- preflight ----------
[[ "$(id -u)" -ne 0 ]] || die "Run this as your normal user, not root (it calls sudo itself)."
[[ "$(uname -m)" == x86_64 ]] || warn "Written for x86_64; this is $(uname -m)."
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04 ]] || warn "Written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}."
fi
echo "${c_b}Learning-quiz home server install${c_0}  (user $USER, kit $KIT)"
info "sudo is needed for system packages; you may be asked for your password once."
sudo -v || die "sudo failed."
# Keep the sudo timestamp fresh during long builds.
( while kill -0 $$ 2>/dev/null; do sudo -n true 2>/dev/null; sleep 50; done ) &
SUDO_KEEPALIVE=$!
trap 'kill "$SUDO_KEEPALIVE" 2>/dev/null || true' EXIT
mkdir -p "$BIN" "$CONF_DIR"
export PATH="$BIN:/usr/local/cuda-$CUDA_VER/bin:$PATH"

has_nvidia_gpu() { lspci -nn 2>/dev/null | grep -qiE 'vga|3d controller' && lspci -nn 2>/dev/null | grep -iE 'vga|3d controller' | grep -qi nvidia; }

# ---------- steps ----------
step_base() {
  heading "1. Base packages"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -q
  apt_install ca-certificates curl wget gnupg git rsync jq unzip pciutils lsof \
    build-essential cmake pkg-config python3 python3-venv \
    ffmpeg espeak-ng unattended-upgrades apt-listchanges avahi-daemon
  ok "base packages present (avahi: reachable as $(hostname).local on the LAN)"
}

step_power() {
  heading "2. Always on: no sleep, automatic security updates"
  local t masked=1
  for t in sleep.target suspend.target hibernate.target hybrid-sleep.target; do
    [[ "$(systemctl is-enabled "$t" 2>/dev/null || true)" == masked ]] || masked=0
  done
  if [[ $masked == 1 ]]; then ok "sleep/suspend already disabled"
  else sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null; ok "sleep/suspend disabled (masked)"; fi

  # Security updates install by themselves; reboot at 04:30 only when one needs it (kernel etc.).
  # NVIDIA packages are left out: a driver update under a running system breaks CUDA until a reboot,
  # so update those by hand (sudo apt upgrade && sudo reboot). The 580 branch is versioned in the
  # package name, so it can never jump to 590 (which drops Pascal) on its own.
  sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  sudo tee /etc/apt/apt.conf.d/52learning-quiz-unattended >/dev/null <<'EOF'
// Written by learning-quiz deploy/install.sh
Unattended-Upgrade::Package-Blacklist {
    "nvidia-";
    "libnvidia-";
    "xserver-xorg-video-nvidia";
    "cuda-";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
EOF
  sudo systemctl enable --now unattended-upgrades.service >/dev/null 2>&1 || true
  ok "unattended security upgrades on (NVIDIA held back, auto-reboot 04:30 when required)"
  todo "BIOS: set 'Restore on AC power loss' = Power On (so the box comes back after an outage)."
}

step_ssh() {
  heading "2b. SSH: key login only"
  local f=/etc/ssh/sshd_config.d/10-keys-only.conf
  if [[ ! -s "$HOME/.ssh/authorized_keys" ]]; then
    warn "no key in ~/.ssh/authorized_keys yet; password login left on (run ssh-copy-id from the Mac, then re-run --only ssh)"
    return 0
  fi
  if [[ -f "$f" ]]; then ok "password login over SSH already off"; return 0; fi
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' | sudo tee "$f" >/dev/null
  sudo sshd -t && sudo systemctl reload ssh && ok "password login over SSH turned off (keys only)" \
    || { sudo rm -f "$f"; warn "sshd config test failed; left password login on"; }
}

step_nvidia() {
  heading "3. NVIDIA driver ($NVIDIA_BRANCH branch, proprietary)"
  if ! has_nvidia_gpu; then warn "No NVIDIA GPU found (lspci); skipping driver. Use --no-gpu to silence."; GPU=0; return; fi
  if nvidia-smi >/dev/null 2>&1; then
    ok "driver loaded: $(nvidia-smi --query-gpu=name,driver_version --format=csv,noheader | head -1)"
    # Keeps the driver initialised so the idle GPU stays in its lowest power state (P8) between jobs.
    if systemctl list-unit-files nvidia-persistenced.service >/dev/null 2>&1; then
      sudo systemctl enable --now nvidia-persistenced.service >/dev/null 2>&1 && ok "nvidia-persistenced on"
    fi
    return 0
  fi
  # Pascal (GTX 10xx) needs the proprietary kernel module: NVIDIA's open modules start at Turing.
  # The -server (production branch) headless packages: no X/desktop bits on a headless box.
  apt_install "nvidia-headless-$NVIDIA_BRANCH-server" "nvidia-utils-$NVIDIA_BRANCH-server"
  if [[ -d /sys/firmware/efi ]] && have mokutil && mokutil --sb-state 2>/dev/null | grep -qi 'enabled'; then
    warn "Secure Boot is ON: the NVIDIA module won't load until its key is enrolled (MOK screen at the next boot, needs a monitor) — or turn Secure Boot off in the BIOS."
  fi
  REBOOT=1
  ok "driver installed; it loads after a reboot (the rest of the install continues meanwhile)"
}

step_cuda() {
  heading "4. CUDA $CUDA_VER toolkit (for building whisper.cpp for sm_61)"
  if [[ $GPU == 0 ]] || ! has_nvidia_gpu; then info "no GPU: skipping"; GPU=0; return; fi
  local nvcc="/usr/local/cuda-$CUDA_VER/bin/nvcc"
  if [[ -x "$nvcc" ]]; then ok "$("$nvcc" --version | tail -1)"; return; fi
  if ! dpkg-query -W -f='${Status}' cuda-keyring 2>/dev/null | grep -q 'install ok installed'; then
    local tmp; tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/cuda-keyring.deb" https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
    sudo dpkg -i "$tmp/cuda-keyring.deb"; rm -rf "$tmp"
  fi
  # NVIDIA's repo also carries drivers: keep it low priority so it only supplies what Ubuntu doesn't
  # (the cuda-* packages) and never replaces Ubuntu's 580 driver.
  sudo tee /etc/apt/preferences.d/learning-quiz-cuda >/dev/null <<'EOF'
Package: *
Pin: origin developer.download.nvidia.com
Pin-Priority: 100
EOF
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -q
  # Just the compiler + dev libraries (not the multi-GB tools/GUI bundle); fall back to the full toolkit.
  if ! apt_install "cuda-compiler-$CUDA_PKG_VER" "cuda-libraries-dev-$CUDA_PKG_VER" "cuda-cudart-dev-$CUDA_PKG_VER" \
        "libcublas-dev-$CUDA_PKG_VER" "cuda-driver-dev-$CUDA_PKG_VER"; then
    apt_install "cuda-toolkit-$CUDA_PKG_VER" || { warn "CUDA install failed; whisper.cpp will be built for the CPU."; return; }
  fi
  [[ -x "$nvcc" ]] && ok "$("$nvcc" --version | tail -1)" || warn "nvcc not found at $nvcc"
}

step_node() {
  heading "5. Node.js $NODE_MAJOR (NodeSource)"
  local cur=0
  have node && cur="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if [[ "$cur" -ge "$NODE_MAJOR" ]]; then ok "node $(node --version)"; return; fi
  local tmp; tmp="$(mktemp)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o "$tmp"
  sudo -E bash "$tmp"; rm -f "$tmp"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  [[ -x /usr/bin/node ]] || die "node didn't land in /usr/bin/node (the service expects it there)"
  ok "node $(node --version)"
}

tailscale_running() { [[ "$(tailscale status --json 2>/dev/null | jq -r '.BackendState // empty')" == Running ]]; }

step_tailscale() {
  heading "6. Tailscale (private HTTPS for the iPhone)"
  if ! have tailscale; then
    local tmp; tmp="$(mktemp)"
    curl -fsSL https://tailscale.com/install.sh -o "$tmp"; sh "$tmp"; rm -f "$tmp"
  fi
  sudo systemctl enable --now tailscaled >/dev/null 2>&1
  if tailscale_running; then
    ok "logged in as $(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
  elif interactive; then
    info "Log this machine into your tailnet: open the URL below on the Mac or phone."
    sudo tailscale up || warn "tailscale up didn't finish; run: sudo tailscale up"
  else
    todo "Log in to Tailscale: sudo tailscale up   (open the URL it prints)"
  fi
  # Lets you run `tailscale serve` without sudo.
  sudo tailscale set --operator="$USER" >/dev/null 2>&1 || true
  todo "Tailscale admin console (login.tailscale.com/admin/dns): MagicDNS ON and HTTPS Certificates ON."
}

step_claude() {
  heading "7. Claude Code (native installer, your subscription)"
  if [[ ! -x "$BIN/claude" ]]; then
    local tmp; tmp="$(mktemp)"
    curl -fsSL https://claude.ai/install.sh -o "$tmp"; bash "$tmp"; rm -f "$tmp"
  fi
  [[ -x "$BIN/claude" ]] || die "claude not at $BIN/claude after install"
  ok "$("$BIN/claude" --version 2>/dev/null | head -1)"
  set_env QUIZ_CLAUDE_BIN "$BIN/claude"
  if [[ -s "$HOME/.claude/.credentials.json" ]]; then ok "logged in (~/.claude/.credentials.json exists)"; return; fi
  if interactive && ask "Log in to Claude now (opens a URL you finish on the Mac/phone)?"; then
    info "Sign in with your claude.ai account (subscription). Paste the code back here if asked."
    "$BIN/claude" auth login || { warn "claude auth login failed; run 'claude' and use /login."; }
    [[ -s "$HOME/.claude/.credentials.json" ]] && ok "logged in"
    systemctl --user try-restart learning-quiz.service 2>/dev/null || true   # the app caches the CLI check
  else
    todo "Log in to Claude: run 'claude' on the server (or 'claude auth login'), finish in the browser on any device, then: systemctl --user restart learning-quiz"
  fi
  return 0
}

step_obsidian() {
  heading "8. Obsidian Headless Sync → ~/vault"
  if [[ ! -x "$BIN/ob" ]]; then
    info "npm install obsidian-headless (into ~/.local)"
    npm install -g --prefix "$HOME/.local" obsidian-headless
  fi
  [[ -x "$BIN/ob" ]] || die "ob not found at $BIN/ob"
  ok "ob $("$BIN/ob" --version 2>/dev/null || echo installed)"
  local marker="$CONF_DIR/obsidian-setup-done"
  if [[ -f "$marker" ]]; then
    ok "vault already set up ($(cat "$marker"))"
  elif interactive && ask "Set up Obsidian Sync now (email, password, 2FA, vault encryption password)?"; then
    "$BIN/ob" login || { warn "ob login failed; retry: deploy/install.sh --only obsidian"; return 0; }
    echo; info "Your remote vaults:"; "$BIN/ob" sync-list-remote || true
    local v=""; read -r -p "  Vault name (or ID) to sync to ~/vault: " v
    [[ -n "$v" ]] || { warn "no vault given; skipped"; return; }
    mkdir -p "$VAULT"
    info "If the vault is end-to-end encrypted you'll be asked for its encryption password."
    "$BIN/ob" sync-setup --vault "$v" --path "$VAULT" --device-name "$(hostname)" \
      || { warn "ob sync-setup failed; retry: deploy/install.sh --only obsidian"; return 0; }
    # The quiz code lives in ~/learning-quiz; the vault's Learning/_quiz is the Mac's copy. Don't sync it.
    "$BIN/ob" sync-config --path "$VAULT" --excluded-folders "Learning/_quiz" \
      || warn "couldn't exclude Learning/_quiz from sync; set it later: ob sync-config --path ~/vault --excluded-folders Learning/_quiz"
    "$BIN/ob" sync-config --path "$VAULT" || true
    info "First sync (one pass; can take a while for a big vault)…"
    "$BIN/ob" sync --path "$VAULT" || warn "first sync reported an error; the service will retry"
    printf '%s\n' "$v" > "$marker"
    [[ -z "$VAULT_NAME" ]] && VAULT_NAME="$v"
    ok "vault '$v' synced to $VAULT"
  else
    todo "Obsidian: ob login; ob sync-list-remote; ob sync-setup --vault \"<name>\" --path ~/vault --device-name \"$(hostname)\"; ob sync-config --path ~/vault --excluded-folders \"Learning/_quiz\"; then re-run: deploy/install.sh --only obsidian,units"
    todo "(after doing it by hand: echo '<vault name>' > $marker so the service gets enabled)"
  fi
  # obsidian:// links need the vault's NAME as Obsidian knows it (the Mac's folder is "matan").
  local name="${VAULT_NAME:-$(get_env QUIZ_VAULT)}"
  name="${name:-matan}"
  set_env QUIZ_VAULT "$name"
  ok "QUIZ_VAULT=$name (vault name for obsidian:// links; must match the name your iPhone's Obsidian shows)"
}

step_repo() {
  heading "9. App code: bare repo + checkout (push-to-deploy)"
  [[ -d "$BARE" ]] || { git init -q --bare -b main "$BARE"; ok "created $BARE"; }
  install -m 755 "$KIT/hooks/post-receive" "$BARE/hooks/post-receive"
  ok "post-receive hook installed"
  if ! git --git-dir="$BARE" rev-parse -q --verify refs/heads/main >/dev/null; then
    warn "Nothing pushed yet. On the Mac run: deploy/mac/push.sh $USER@$(hostname)  — then re-run this script."
    return
  fi
  if [[ ! -d "$APP/.git" ]]; then
    mkdir -p "$APP"
    git -C "$APP" init -q -b main
    git -C "$APP" remote add origin "$BARE"
    git -C "$APP" fetch -q origin main
    git -C "$APP" checkout -q -f -B main FETCH_HEAD
  fi
  [[ "$(git -C "$APP" remote get-url origin 2>/dev/null)" == "$BARE" ]] || warn "$APP's origin isn't $BARE; pushes won't update it."
  mkdir -p "$APP/data"; chmod 700 "$APP/data"
  ok "$APP at $(git -C "$APP" log -1 --format='%h %s')"
}

step_whisper() {
  heading "10. Dictation: whisper.cpp $WHISPER_REF + small.en model"
  local src="$HOME/.local/src/whisper.cpp" stamp="$CONF_DIR/whisper-build" backend=""
  local want_cuda=0 nvcc="/usr/local/cuda-$CUDA_VER/bin/nvcc"
  [[ $GPU == 1 && -x "$nvcc" ]] && want_cuda=1
  if [[ -x "$BIN/whisper-cli" && -f "$stamp" ]] && grep -q "ref=$WHISPER_REF " "$stamp" \
     && { [[ $want_cuda == 0 ]] || grep -q 'backend=cuda' "$stamp"; }; then
    ok "whisper-cli already built ($(cat "$stamp"))"
  else
    if [[ ! -d "$src/.git" ]]; then
      mkdir -p "$(dirname "$src")"
      git clone -q https://github.com/ggml-org/whisper.cpp "$src"
    fi
    git -C "$src" fetch -q --tags origin || warn "couldn't fetch whisper.cpp tags (offline?)"
    git -C "$src" checkout -q -f "$WHISPER_REF" || { warn "whisper.cpp has no '$WHISPER_REF'; set WHISPER_REF=<tag> and re-run --only whisper"; return 0; }
    local common=(-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF)
    if [[ $want_cuda == 1 ]]; then
      info "building with CUDA for the GTX 1080 (sm_61); takes ~10–20 min"
      if cmake -S "$src" -B "$src/build-cuda" "${common[@]}" -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=61 \
            -DCMAKE_CUDA_COMPILER="$nvcc" -DCMAKE_CUDA_FLAGS="-Wno-deprecated-gpu-targets" >/dev/null \
         && cmake --build "$src/build-cuda" -j"$(nproc)" --config Release --target whisper-cli; then
        install -m 755 "$src/build-cuda/bin/whisper-cli" "$BIN/whisper-cli"; backend=cuda
      else
        warn "CUDA build failed; falling back to a CPU build (dictation still works, just slower)."
      fi
    fi
    if [[ -z "$backend" ]]; then
      info "building for the CPU"
      if cmake -S "$src" -B "$src/build-cpu" "${common[@]}" >/dev/null \
         && cmake --build "$src/build-cpu" -j"$(nproc)" --config Release --target whisper-cli; then
        install -m 755 "$src/build-cpu/bin/whisper-cli" "$BIN/whisper-cli"; backend=cpu
      else
        warn "whisper.cpp build failed; dictation stays off. Retry: deploy/install.sh --only whisper"; return 0
      fi
    fi
    printf 'ref=%s backend=%s built=%s\n' "$WHISPER_REF" "$backend" "$(date +%F)" > "$stamp"
    ok "whisper-cli ($backend) → $BIN/whisper-cli"
  fi
  set_env QUIZ_WHISPER_BIN "$BIN/whisper-cli"
  grep -q 'backend=cuda' "$stamp" 2>/dev/null && set_env LD_LIBRARY_PATH "/usr/local/cuda-$CUDA_VER/lib64"

  local mdir="$HOME/.cache/quiz-whisper" model="$HOME/.cache/quiz-whisper/ggml-small.en.bin"
  mkdir -p "$mdir"
  if [[ -s "$model" ]]; then ok "model present ($(du -h "$model" | cut -f1))"
  else
    info "downloading ggml-small.en.bin (~470 MB)"
    curl -fL --retry 3 --progress-bar -o "$model.part" "$WHISPER_MODEL_URL" && mv -f "$model.part" "$model"
    ok "model downloaded"
  fi
  if [[ -f "$src/samples/jfk.wav" ]]; then
    if LD_LIBRARY_PATH="/usr/local/cuda-$CUDA_VER/lib64" timeout 120 "$BIN/whisper-cli" -m "$model" -f "$src/samples/jfk.wav" -np -nt 2>/dev/null | grep -qi 'country'; then
      ok "test transcription works"
    else
      warn "test transcription failed (normal before the reboot that loads the NVIDIA driver; re-check with deploy/check.sh)"
    fi
  fi
}

step_voice() {
  heading "11. Local voice (Kokoro sidecar)"
  local tts="$APP/tools/tts-server/install.sh"
  [[ -f "$tts" ]] || { warn "no $tts (push the code first); skipped"; return; }
  local stamp="$HOME/.local/share/quiz-tts/installed.json"
  if [[ -f "$stamp" ]]; then
    # Installed for the CPU before the NVIDIA driver loaded (first run, pre-reboot)? Redo it for the GPU.
    if [[ $GPU == 1 ]] && grep -q '"onnx-cpu"' "$stamp" && nvidia-smi -L >/dev/null 2>&1; then
      info "the GPU works now: reinstalling the voice for CUDA"
    else
      ok "already installed ($(cat "$stamp"))"; return
    fi
  fi
  apt_install espeak-ng ffmpeg
  if bash "$tts"; then ok "voice installed (the app starts it on demand)"
  else warn "voice install failed; the app falls back to the browser's voice. Retry: bash $tts"; fi
}

step_units() {
  heading "12. systemd user services"
  mkdir -p "$UNIT_DIR"
  local f
  for f in "$KIT"/systemd/*.service "$KIT"/systemd/*.timer; do install -m 644 "$f" "$UNIT_DIR/"; done
  ok "units copied to $UNIT_DIR"
  if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != yes ]]; then
    sudo loginctl enable-linger "$USER"; ok "linger on (your services run at boot, without a login)"
  else ok "linger already on"; fi
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  systemctl --user daemon-reload
  if [[ -f "$CONF_DIR/obsidian-setup-done" ]]; then
    systemctl --user enable --now obsidian-sync.service >/dev/null 2>&1 && ok "obsidian-sync.service running"
  else
    info "obsidian-sync.service not enabled yet (vault not set up)"
  fi
  if [[ -f "$APP/server.js" ]]; then
    systemctl --user enable learning-quiz.service >/dev/null 2>&1
    systemctl --user restart learning-quiz.service
    local body="" _
    for _ in $(seq 1 40); do body="$(curl -sf --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null)" && break; sleep 0.5; done
    if [[ -n "$body" ]]; then ok "learning-quiz.service up: $body"
    else warn "learning-quiz.service didn't answer /api/health; see: journalctl --user -u learning-quiz -n 50"; fi
    [[ -d "$VAULT/Learning" ]] || warn "$VAULT/Learning doesn't exist yet (vault not synced?): the app will show no questions."
  else
    info "learning-quiz.service not started (no code at $APP yet)"
  fi
  return 0
}

step_serve() {
  heading "13. HTTPS on your tailnet (tailscale serve)"
  have tailscale && tailscale_running || { todo "After 'sudo tailscale up': deploy/install.sh --only serve"; info "tailscale not logged in; skipped"; return; }
  local dns; dns="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
  # Layout: the quiz at https://<host>/quiz/ (tailscale strips the /quiz prefix, so the app still sees "/"),
  # LifeOS at the root (its own installer, ~/lifeos/deploy/install.sh, sets "/" → 127.0.0.1:4700).
  # The mount is "/quiz/" with the slash: "/quiz" then also lands here and the page adds the slash itself.
  if tailscale serve status --json 2>/dev/null | jq -e --arg p "http://127.0.0.1:$PORT" '[.Web[]?.Handlers["/quiz/"].Proxy] | index($p)' >/dev/null; then
    ok "already serving https://$dns/quiz/ → http://127.0.0.1:$PORT"
  else
    info "tailscale serve --bg --https=443 --set-path /quiz/ http://127.0.0.1:$PORT"
    info "(if it prints a link to enable HTTPS/Serve for your tailnet, open it, approve, and it continues)"
    if timeout 300 tailscale serve --bg --https=443 --set-path /quiz/ "http://127.0.0.1:$PORT"; then
      ok "serving https://$dns/quiz/ (tailnet only; persists across reboots)"
    else
      warn "tailscale serve failed. Turn on MagicDNS + HTTPS Certificates in the admin console, then: deploy/install.sh --only serve"
    fi
  fi
  # Nothing at the root yet (LifeOS not installed)? Send the root to the quiz too, so https://<host>/ works.
  if ! tailscale serve status --json 2>/dev/null | jq -e '[.Web[]?.Handlers["/"]] | map(select(. != null)) | length > 0' >/dev/null; then
    tailscale serve --bg --https=443 --set-path / "http://127.0.0.1:$PORT" >/dev/null && info "root → quiz as well (until LifeOS takes it over)"
  fi
  set_env QUIZ_PUBLIC_URL "https://$dns/quiz"
  return 0
}

step_remote() {
  heading "13b. Remote control from anywhere: Cockpit + desktop, Tailscale only"
  # Cockpit: control panel in the browser (:9090). xrdp + Xfce: a full desktop window (Windows App on the Mac, :3389).
  # Both log in with your Linux password. The firewall lets them in ONLY over Tailscale (your devices);
  # nothing is opened on the router, so they are not on the internet.
  apt_install cockpit cockpit-machines xrdp xorgxrdp xfce4 xfce4-terminal dbus-x11 ufw
  [[ -f "$HOME/.xsession" ]] || echo "startxfce4" > "$HOME/.xsession"
  id -nG xrdp 2>/dev/null | grep -qw ssl-cert || sudo adduser xrdp ssl-cert >/dev/null
  sudo systemctl enable --now cockpit.socket xrdp >/dev/null 2>&1 || warn "couldn't start cockpit/xrdp"
  local lan
  lan="$(ip -4 route | awk '/proto kernel/ && $3 !~ /^(virbr|tailscale|docker|lo)/ {print $1; exit}')"
  sudo ufw default deny incoming >/dev/null
  sudo ufw default allow outgoing >/dev/null
  sudo ufw allow in on tailscale0 comment 'tailnet: ssh, app, cockpit, desktop' >/dev/null
  [[ -n "$lan" ]] && sudo ufw allow from "$lan" to any port 22 proto tcp comment 'ssh from home LAN (fallback)' >/dev/null
  [[ -n "$lan" ]] && sudo ufw allow from "$lan" to any port 5353 proto udp comment 'mDNS homebox.local' >/dev/null
  sudo ufw allow in on virbr0 comment 'lab VM: DHCP/DNS from libvirt' >/dev/null
  sudo ufw --force enable >/dev/null && ok "firewall on: only Tailscale gets in (plus SSH from ${lan:-the LAN})"
  ok "Cockpit:  https://$(hostname):9090  (over Tailscale; accept the self-signed certificate once)"
  ok "Desktop:  Windows App on the Mac → add PC → $(hostname) (over Tailscale), log in with your Linux user"
  have tailscale && tailscale_running || todo "Cockpit and the desktop only open over Tailscale: finish 'sudo tailscale up' first"
}

step_backup() {
  heading "14. Nightly backup of data/"
  if [[ -n "$BACKUP_DISK" ]]; then
    sudo mkdir -p /mnt/hdd
    if mountpoint -q /mnt/hdd; then ok "/mnt/hdd already mounted"
    else
      local spec="$BACKUP_DISK" uuid
      if [[ "$spec" != UUID=* ]]; then
        uuid="$(sudo blkid -s UUID -o value "$spec")" || die "No filesystem on $spec. Prepare the disk first (docs/HOME-SERVER.md, 'Backup disk')."
        spec="UUID=$uuid"
      fi
      grep -q "^$spec " /etc/fstab || echo "$spec /mnt/hdd auto defaults,nofail,x-systemd.device-timeout=10s 0 2" | sudo tee -a /etc/fstab >/dev/null
      sudo systemctl daemon-reload
      sudo mount /mnt/hdd
      ok "mounted $spec at /mnt/hdd (in /etc/fstab, nofail)"
    fi
    sudo mkdir -p /mnt/hdd/backups/learning-quiz
    sudo chown "$USER:$USER" /mnt/hdd/backups /mnt/hdd/backups/learning-quiz
    set_env BACKUP_DIR /mnt/hdd/backups/learning-quiz
  elif [[ -z "$(get_env BACKUP_DIR)" ]]; then
    mountpoint -q /mnt/hdd && set_env BACKUP_DIR /mnt/hdd/backups/learning-quiz || set_env BACKUP_DIR "$HOME/backups/learning-quiz"
  fi
  ok "backups go to $(get_env BACKUP_DIR) (30 days kept)"
  [[ "$(get_env BACKUP_DIR)" == "$HOME/"* ]] && info "(on the NVMe; add --backup-disk to put them on the HDD)"
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  if [[ -f "$UNIT_DIR/learning-quiz-backup.timer" ]]; then
    systemctl --user enable --now learning-quiz-backup.timer >/dev/null 2>&1 && ok "timer on (03:30 nightly)"
    [[ -d "$APP/data" && -f "$APP/deploy/backup.sh" ]] && systemctl --user start learning-quiz-backup.service && ok "first backup done"
  else
    info "units not installed yet; run --only units,backup"
  fi
  return 0
}

step_lab() {
  heading "15. Lab VM: Rocky Linux 9 on KVM (host alias 'rocky' → $LAB_IP)"
  grep -Eq 'vmx|svm' /proc/cpuinfo || { warn "CPU virtualization is off: enable Intel VT-x (and VT-d) in the BIOS, then re-run with --with-lab."; return; }
  apt_install qemu-kvm qemu-utils libvirt-daemon-system libvirt-clients virtinst cloud-image-utils dnsmasq-base ovmf
  sudo systemctl enable --now libvirtd >/dev/null 2>&1 || true
  groups "$USER" | grep -qw libvirt || { sudo usermod -aG libvirt,kvm "$USER"; info "added you to libvirt/kvm groups (takes effect at next login)"; }
  local V=(sudo virsh -c qemu:///system)
  "${V[@]}" net-info default >/dev/null 2>&1 || die "libvirt's default network is missing"
  "${V[@]}" net-autostart default >/dev/null
  "${V[@]}" net-info default | grep -q 'Active:.*yes' || "${V[@]}" net-start default >/dev/null
  if ! "${V[@]}" net-dumpxml default | grep -q "$LAB_MAC"; then
    "${V[@]}" net-update default add ip-dhcp-host "<host mac='$LAB_MAC' name='rocky' ip='$LAB_IP'/>" --live --config >/dev/null
    ok "DHCP reservation rocky → $LAB_IP"
  fi

  local key="$HOME/.ssh/id_ed25519_rocky"
  mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
  [[ -f "$key" ]] || ssh-keygen -q -t ed25519 -N '' -C "$USER@$(hostname) lab" -f "$key"
  if ! grep -q '# >>> learning-quiz lab >>>' "$HOME/.ssh/config" 2>/dev/null; then
    cat >> "$HOME/.ssh/config" <<EOF

# >>> learning-quiz lab >>>
Host rocky
  HostName $LAB_IP
  User $LAB_USER
  IdentityFile $key
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
  UserKnownHostsFile ~/.ssh/known_hosts_rocky
# <<< learning-quiz lab <<<
EOF
    chmod 600 "$HOME/.ssh/config"; ok "added 'Host rocky' to ~/.ssh/config"
  fi

  if "${V[@]}" dominfo rocky >/dev/null 2>&1; then
    ok "VM 'rocky' exists ($("${V[@]}" domstate rocky))"
  else
    local base="$LAB_DIR/rocky9-genericcloud.qcow2" disk="$LAB_DIR/rocky.qcow2" seed="$LAB_DIR/rocky-seed.iso"
    if ! sudo test -s "$base"; then
      info "downloading Rocky 9 GenericCloud image (~0.6 GB)"
      sudo curl -fL --retry 3 --progress-bar -o "$base.part" "$ROCKY_URL" && sudo mv -f "$base.part" "$base"
    fi
    sudo qemu-img convert -O qcow2 "$base" "$disk"
    sudo qemu-img resize "$disk" 40G >/dev/null
    local tmp; tmp="$(mktemp -d)"
    cat > "$tmp/user-data" <<EOF
#cloud-config
hostname: rocky
fqdn: rocky.lab
preserve_hostname: false
users:
  - name: $LAB_USER
    groups: [wheel]
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - $(cat "$key.pub")
ssh_pwauth: false
timezone: $(timedatectl show -p Timezone --value 2>/dev/null || echo UTC)
EOF
    printf 'instance-id: rocky-lab-1\nlocal-hostname: rocky\n' > "$tmp/meta-data"
    sudo cloud-localds "$seed" "$tmp/user-data" "$tmp/meta-data"; rm -rf "$tmp"
    local os=rocky9
    virt-install --osinfo list 2>/dev/null | grep -qw rocky9 || os=linux2022
    sudo virt-install --connect qemu:///system --name rocky --memory 4096 --vcpus 2 --cpu host-passthrough --boot uefi \
      --disk "path=$disk,format=qcow2,bus=virtio" --disk "path=$seed,device=cdrom" \
      --network "network=default,model=virtio,mac=$LAB_MAC" --osinfo "$os" \
      --import --graphics none --noautoconsole >/dev/null
    ok "VM 'rocky' created (4 GB RAM, 2 vCPU, 40 GB disk on the NVMe)"
  fi
  "${V[@]}" autostart rocky >/dev/null
  "${V[@]}" domstate rocky | grep -q running || "${V[@]}" start rocky >/dev/null
  info "waiting for ssh rocky (first boot runs cloud-init, ~1 min)"
  local _
  for _ in $(seq 1 60); do
    ssh -o BatchMode=yes -o ConnectTimeout=3 rocky true 2>/dev/null && { ok "ssh rocky works ($(ssh -o BatchMode=yes rocky 'cat /etc/rocky-release' 2>/dev/null))"; return; }
    sleep 5
  done
  warn "ssh rocky didn't answer yet; check: sudo virsh console rocky  (exit: Ctrl+])"
  return 0
}

# ---------- run ----------
for s in "${STEPS[@]}"; do
  if want "$s"; then "step_$s"; fi
done

heading "Done"
if [[ ${#WARNINGS[@]} -gt 0 ]]; then echo "${c_y}Warnings:${c_0}"; printf '  ! %s\n' "${WARNINGS[@]}"; fi
if [[ ${#TODOS[@]} -gt 0 ]]; then echo "${c_b}Left for you:${c_0}"; printf '  [ ] %s\n' "${TODOS[@]}"; fi
[[ $REBOOT == 1 ]] && echo "${c_b}Reboot to load the NVIDIA driver:${c_0} sudo reboot   (then: ~/learning-quiz/deploy/check.sh)"
echo "Check everything any time: $KIT/check.sh"
