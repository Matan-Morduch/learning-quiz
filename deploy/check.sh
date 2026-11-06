#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2088,SC2012  # `test && pass || fail` is intended (pass/soft never fail); ~ is display text
# Health check for the home server. Run on the server (no sudo, spends nothing: no Claude requests).
#   ~/learning-quiz/deploy/check.sh
#   ssh user@homebox learning-quiz/deploy/check.sh      # from the Mac
# Prints ✓ / ! / ✗ per item; exits 1 if anything is ✗.
set -uo pipefail

APP="$HOME/learning-quiz"
ENV_FILE="$HOME/.config/learning-quiz/env"
PORT=4747
FAIL=0 WARN=0
c_g=$'\e[32m' c_y=$'\e[33m' c_r=$'\e[31m' c_b=$'\e[1m' c_0=$'\e[0m'
[[ -t 1 ]] || { c_g="" c_y="" c_r="" c_b="" c_0=""; }
pass() { printf '  %s✓%s %s\n' "$c_g" "$c_0" "$*"; }
soft() { printf '  %s!%s %s\n' "$c_y" "$c_0" "$*"; WARN=$((WARN + 1)); }
fail() { printf '  %s✗%s %s\n' "$c_r" "$c_0" "$*"; FAIL=$((FAIL + 1)); }
sect() { printf '\n%s%s%s\n' "$c_b" "$*" "$c_0"; }
have() { command -v "$1" >/dev/null 2>&1; }
envv() { [[ -f "$ENV_FILE" ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export PATH="$HOME/.local/bin:$PATH"

unit() {   # unit <name> [optional]
  local st; st="$(systemctl --user is-active "$1" 2>/dev/null)"
  if [[ "$st" == active ]]; then pass "$1 active (since $(systemctl --user show "$1" -p ActiveEnterTimestamp --value))"
  elif [[ "${2:-}" == optional ]]; then soft "$1: ${st:-not installed}"
  else fail "$1: ${st:-not installed}  →  journalctl --user -u $1 -n 50"; fi
}

sect "System"
[[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == yes ]] && pass "linger on (services start at boot)" || fail "linger off  →  sudo loginctl enable-linger $USER"
[[ "$(systemctl is-enabled suspend.target 2>/dev/null)" == masked ]] && pass "suspend disabled" || soft "suspend not masked  →  deploy/install.sh --only power"
systemctl is-active -q unattended-upgrades 2>/dev/null && pass "unattended security upgrades on" || soft "unattended-upgrades not running"
[[ -f /var/run/reboot-required ]] && soft "a reboot is pending (updates): sudo reboot" || pass "no reboot pending"
df -h / | awk 'NR==2 { printf "  · disk /: %s used of %s (%s)\n", $3, $2, $5 }'
avail_kb="$(df -Pk / | awk 'NR==2 {print $4}')"; [[ "${avail_kb:-0}" -gt 10485760 ]] || soft "less than 10 GB free on /"
if have node; then
  v="$(node -p 'process.versions.node.split(".")[0]')"; [[ "$v" -ge 22 ]] && pass "node $(node --version)" || fail "node $(node --version) is older than 22"
else fail "node missing"; fi

sect "GPU"
if have nvidia-smi; then
  if out="$(nvidia-smi --query-gpu=name,driver_version,temperature.gpu,power.draw,pstate --format=csv,noheader 2>/dev/null)"; then
    pass "$out"
  else fail "nvidia-smi can't talk to the driver (reboot after a driver update?)"; fi
else soft "no NVIDIA driver (fine if you installed with --no-gpu)"; fi

sect "App"
unit learning-quiz.service
if body="$(curl -sf --max-time 5 "http://127.0.0.1:$PORT/api/health")"; then
  if [[ "$(jq -r '.ok' <<<"$body" 2>/dev/null)" == true ]]; then
    pass "/api/health ok: $(jq -r '"\(.questions) questions, up \(.uptime)s, learningDir \(.learningDir)"' <<<"$body")"
  else fail "/api/health says not ok: $body  (vault not synced? QUIZ_LEARNING_DIR wrong?)"; fi
  [[ "$(jq -r '.claude' <<<"$body" 2>/dev/null)" == true ]] || soft "the app can't run claude (if you just installed/logged in: systemctl --user restart learning-quiz)"
else fail "no answer on http://127.0.0.1:$PORT/api/health"; fi
if [[ -d "$APP/.git" ]]; then pass "code: $(git -C "$APP" log -1 --format='%h %s (%cr)')"; else fail "no checkout at $APP"; fi
if [[ -d "$APP/data" ]]; then
  pass "data/: $(du -sh "$APP/data" | cut -f1)"
  if [[ -f "$APP/data/voice.json" ]]; then
    m="$(stat -c %a "$APP/data/voice.json")"; [[ "$m" == 600 ]] && pass "data/voice.json mode 600" || soft "data/voice.json is mode $m  →  chmod 600 $APP/data/voice.json"
  fi
else fail "no $APP/data"; fi
qv="$(envv QUIZ_VAULT)"; [[ -n "$qv" ]] && pass "QUIZ_VAULT=$qv (obsidian:// links)" || soft "QUIZ_VAULT not set in $ENV_FILE (obsidian:// links would use 'vault')"

sect "Claude Code"
CL="$(envv QUIZ_CLAUDE_BIN)"; CL="${CL:-$HOME/.local/bin/claude}"
if [[ -x "$CL" ]]; then pass "$("$CL" --version 2>/dev/null | head -1)"; else fail "claude not at $CL"; fi
if [[ -s "$HOME/.claude/.credentials.json" ]]; then pass "credentials file present (~/.claude/.credentials.json)"
elif [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}$(envv CLAUDE_CODE_OAUTH_TOKEN)" ]]; then pass "CLAUDE_CODE_OAUTH_TOKEN set (setup-token)"
else fail "not logged in  →  run 'claude' and /login (then systemctl --user restart learning-quiz)"; fi

sect "Obsidian vault"
unit obsidian-sync.service
if [[ -d "$HOME/vault/Learning" ]]; then
  n="$(find "$HOME/vault/Learning" -path '*/Questions/*.md' 2>/dev/null | wc -l | tr -d ' ')"
  pass "~/vault/Learning present ($n question files)"
else fail "~/vault/Learning missing (sync not set up?)"; fi
[[ -d "$HOME/vault/Learning/_quiz" ]] && soft "~/vault/Learning/_quiz exists: the exclusion isn't active (ob sync-config --path ~/vault)"
if have ob; then
  ob sync-status --path "$HOME/vault" >/dev/null 2>&1 && pass "ob sync-status ok" || soft "ob sync-status reported a problem: ob sync-status --path ~/vault"
fi

sect "Dictation (whisper.cpp)"
WB="$(envv QUIZ_WHISPER_BIN)"; WB="${WB:-$HOME/.local/bin/whisper-cli}"
if [[ -x "$WB" ]]; then
  if LD_LIBRARY_PATH="$(envv LD_LIBRARY_PATH)" ldd "$WB" 2>/dev/null | grep -q 'not found'; then fail "$WB is missing libraries (ldd)"
  else pass "$WB ($(cat "$HOME/.config/learning-quiz/whisper-build" 2>/dev/null || echo 'build info unknown'))"; fi
else fail "no whisper-cli at $WB  →  deploy/install.sh --only whisper"; fi
ls "$HOME"/.cache/quiz-whisper/ggml-*.bin >/dev/null 2>&1 && pass "models: $(cd "$HOME/.cache/quiz-whisper" && ls ggml-*.bin | tr '\n' ' ')" || fail "no model in ~/.cache/quiz-whisper"
have ffmpeg && pass "ffmpeg" || fail "ffmpeg missing  →  sudo apt install ffmpeg"

sect "Voice (Kokoro sidecar)"
TTS="${QUIZ_TTS_HOME:-$HOME/.local/share/quiz-tts}"
if [[ -f "$TTS/installed.json" ]]; then
  pass "installed: $(cat "$TTS/installed.json")"
  if h="$(curl -sf --max-time 2 http://127.0.0.1:8737/health)"; then pass "sidecar running: $h"; else pass "sidecar idle (the app starts it on the first request)"; fi
else soft "local voice not installed (browser voice is used)  →  bash $APP/tools/tts-server/install.sh"; fi

sect "Tailscale / HTTPS"
if have tailscale; then
  st="$(tailscale status --json 2>/dev/null)"
  if [[ "$(jq -r '.BackendState' <<<"$st" 2>/dev/null)" == Running ]]; then
    dns="$(jq -r '.Self.DNSName' <<<"$st" | sed 's/\.$//')"
    pass "tailnet up as $dns ($(tailscale ip -4 2>/dev/null | head -1))"
    if tailscale serve status --json 2>/dev/null | jq -e --arg p "http://127.0.0.1:$PORT" '[.Web[]?.Handlers["/quiz/"].Proxy] | index($p)' >/dev/null; then
      pass "tailscale serve /quiz/ → 127.0.0.1:$PORT"
      if curl -sf --max-time 10 "https://$dns/quiz/api/health" >/dev/null; then pass "https://$dns/quiz/ works (open this on the iPhone)"
      else soft "https://$dns/quiz/ didn't answer from here (cert still being issued? HTTPS enabled in the admin console?)"; fi
      root="$(tailscale serve status --json 2>/dev/null | jq -r '[.Web[]?.Handlers["/"].Proxy] | map(select(. != null)) | first // "nothing"')"
      pass "root https://$dns/ → $root (LifeOS is 127.0.0.1:4700)"
    else fail "tailscale serve /quiz/ not set  →  tailscale serve --bg --https=443 --set-path /quiz/ http://127.0.0.1:$PORT"; fi
  else fail "tailscale not logged in  →  sudo tailscale up"; fi
else fail "tailscale not installed"; fi

sect "Backups"
unit learning-quiz-backup.timer
BD="$(envv BACKUP_DIR)"; BD="${BD:-$HOME/backups/learning-quiz}"
last="$(find "$BD" -maxdepth 1 -name 'data-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -1 | cut -d' ' -f2-)"
if [[ -n "$last" ]]; then
  age=$(( ( $(date +%s) - $(stat -c %Y "$last") ) / 3600 ))
  [[ $age -le 48 ]] && pass "latest: $last (${age}h ago)" || soft "latest backup is ${age}h old: $last"
else fail "no backups in $BD  →  systemctl --user start learning-quiz-backup"; fi
[[ "$BD" == /mnt/hdd/* ]] && { mountpoint -q /mnt/hdd && pass "/mnt/hdd mounted" || fail "/mnt/hdd not mounted (backups would fail)"; }

sect "Interview (mock coding interviews)"
have python3 && pass "python3 $(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])') (runs the hidden tests)" || fail "python3 missing (the interview can't check code)  →  sudo apt install python3"
have prlimit && pass "prlimit (CPU/memory limits for test runs)" || fail "prlimit missing  →  sudo apt install util-linux"
have ffmpeg && pass "ffmpeg (makes replays seekable)" || soft "ffmpeg missing: replays play but can't seek well  →  sudo apt install ffmpeg"
nready=$(ls "$APP/data/interview/problems/"*.tests.json 2>/dev/null | wc -l)
[[ $nready -gt 0 ]] && pass "$nready interview problem(s) prepared" || soft "no interview problems prepared yet (they're prepared in the background after a start)"

sect "Teach materials (PDFs and photos)"
[[ -x "${QUIZ_PDF_HOME:-$HOME/.local/share/quiz-pdf}/venv/bin/python" ]] && pass "PDF reader (PyMuPDF) installed" || soft "PDF reader missing: only text files can be added to Materials  →  tools/pdf/install.sh"

sect "Gemini engine (optional)"
GBIN="${QUIZ_GEMINI_BIN:-${QUIZ_GEMINI_HOME:-$HOME/.local/share/gemini-cli}/node_modules/.bin/gemini}"
if [[ -x "$GBIN" ]] || have gemini; then
  pass "Gemini CLI installed"
  [[ -f "$HOME/.gemini/oauth_creds.json" ]] && pass "Gemini CLI signed in" || soft "Gemini CLI not signed in  →  tools/gemini/install.sh --login"
else soft "Gemini CLI not installed (only needed for the Gemini engine)  →  tools/gemini/install.sh"; fi
[[ -f "$APP/data/ai.json" ]] && grep -q '"apiKey"' "$APP/data/ai.json" && pass "Gemini API key saved" || true

sect "Lab VM (optional)"
if grep -q '^Host rocky' "$HOME/.ssh/config" 2>/dev/null; then
  if ssh -o BatchMode=yes -o ConnectTimeout=5 rocky true 2>/dev/null; then pass "ssh rocky works"
  else fail "ssh rocky fails  →  sudo virsh start rocky; sudo virsh console rocky"; fi
else soft "no 'Host rocky' in ~/.ssh/config (install with --with-lab)"; fi

echo
if [[ $FAIL -gt 0 ]]; then echo "${c_r}$FAIL problem(s)${c_0}, $WARN warning(s)."; exit 1; fi
echo "${c_g}All good${c_0} ($WARN warning(s))."
