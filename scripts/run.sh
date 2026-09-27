#!/bin/bash
# Usage: run.sh --text-file /abs/script.txt --out /abs/out.wav [--space N] [--keep] [--ref-wav f --ref-txt f]
#        run.sh --text "문장" --out /abs/out.wav
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
TEXT_FILE=""; OUT=""; SPACE=""; KEEP=""; REF_WAV=""; REF_TXT=""; TEXT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --text-file) TEXT_FILE="$2"; shift 2;;
    --text) TEXT="$2"; shift 2;;
    --out) OUT="$2"; shift 2;;
    --space) SPACE="$2"; shift 2;;
    --keep) KEEP=1; shift;;
    --ref-wav) REF_WAV="$2"; shift 2;;
    --ref-txt) REF_TXT="$2"; shift 2;;
    *) echo "unknown arg $1" >&2; exit 2;;
  esac
done
[ -n "$OUT" ] || { echo "--out required" >&2; exit 2; }
command -v ego-browser >/dev/null || { echo "ego-browser CLI not found (install Ego Lite)" >&2; exit 3; }
OUT="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$OUT")"
# Reference voice is intentionally not bundled because voice samples are sensitive.
# Pass --ref-wav/--ref-txt, or store them at the private local defaults below.
REF_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/colab-charly-tts"
[ -n "$REF_WAV" ] || REF_WAV="$REF_ROOT/ref.wav"
[ -n "$REF_TXT" ] || REF_TXT="$REF_ROOT/ref.txt"
[ -f "$REF_WAV" ] && [ -f "$REF_TXT" ] || {
  echo "reference voice missing; use --ref-wav /private/ref.wav --ref-txt /private/ref.txt" >&2
  exit 2
}
if [ -n "$TEXT" ]; then
  TMPD="${TMPDIR:-/tmp}"; TEXT_FILE="$TMPD/colab_charly_$$.txt"; printf '%s\n' "$TEXT" > "$TEXT_FILE"
fi
[ -f "$TEXT_FILE" ] || { echo "text file missing" >&2; exit 2; }
TEXT_FILE="$(python3 -c 'import os,sys;print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$TEXT_FILE")"
CFG=$(python3 - "$TEXT_FILE" "$OUT" "$SPACE" "$KEEP" "$REF_WAV" "$REF_TXT" <<'PY'
import json,sys
k=["CHARLY_TEXT_FILE","CHARLY_OUT","CHARLY_SPACE","CHARLY_KEEP","CHARLY_REF_WAV","CHARLY_REF_TXT"]
print(json.dumps({a:b for a,b in zip(k,sys.argv[1:]) if b}, ensure_ascii=False))
PY
)
{ echo "const CFG = ${CFG};"; cat "$DIR/colab_charly_tts.mjs"; } | ego-browser nodejs
