#!/usr/bin/env bash
# Nightly backup of the quiz app's data (run by learning-quiz-backup.timer; safe to run by hand).
#   deploy/backup.sh
# Writes $BACKUP_DIR/data-YYYY-MM-DD.tar.gz (one per day, re-running the same day replaces it) and
# deletes archives older than $BACKUP_KEEP_DAYS (default 30). Settings come from ~/.config/learning-quiz/env:
#   BACKUP_DIR        default /mnt/hdd/backups/learning-quiz if the HDD is mounted, else ~/backups/learning-quiz
#   BACKUP_KEEP_DAYS  default 30
#   BACKUP_VAULT=1    also archive ~/vault (Obsidian Sync already keeps history; this is a second copy)
set -euo pipefail
umask 077

APP_DIR="${QUIZ_APP_DIR:-$HOME/learning-quiz}"
DATA_DIR="$APP_DIR/data"
KEEP="${BACKUP_KEEP_DAYS:-30}"
if [[ -z "${BACKUP_DIR:-}" ]]; then
  if mountpoint -q /mnt/hdd 2>/dev/null; then BACKUP_DIR=/mnt/hdd/backups/learning-quiz
  else BACKUP_DIR="$HOME/backups/learning-quiz"; fi
fi

[[ -d "$DATA_DIR" ]] || { echo "No data folder at $DATA_DIR" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F)"

archive() {   # archive <name> <parent dir> <folder> [tar options…]
  local name="$1" parent="$2" folder="$3"; shift 3
  local out="$BACKUP_DIR/$name-$STAMP.tar.gz" tmp
  tmp="$(mktemp "$BACKUP_DIR/.$name-XXXXXX")"
  # The app may write while we read: tar warns (exit 1) on a file that changed, which is fine here.
  tar -C "$parent" "$@" -czf "$tmp" "$folder" || [[ $? -eq 1 ]]
  mv -f "$tmp" "$out"
  echo "✓ $out ($(du -h "$out" | cut -f1))"
}

archive data "$APP_DIR" data
[[ "${BACKUP_VAULT:-0}" == 1 && -d "$HOME/vault" ]] && archive vault "$HOME" vault --exclude=vault/.trash

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'data-*.tar.gz' -o -name 'vault-*.tar.gz' \) -mtime +"$KEEP" -print -delete \
  | sed 's/^/  removed old /'
echo "Backups in $BACKUP_DIR: $(find "$BACKUP_DIR" -maxdepth 1 -name '*.tar.gz' | wc -l | tr -d ' ') archives, $(du -sh "$BACKUP_DIR" | cut -f1)"
