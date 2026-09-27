#!/bin/bash
# Usage: verify.sh /abs/out.wav /abs/script.txt
# Quality gates for a generated Charly WAV. Exit 0 only when every gate passes.
#   1. repeated leading artifact (first 100 ms)   -> check_initial_artifact.py
#   2. clipped endings (last 20 ms per sentence)   -> check_ending_boundaries.py
#   3. per-sentence ASR: final eojeol present, no leftover "하나 둘 셋" guard phrase
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
WAV="${1:?wav required}"; TXT="${2:?script text required}"
PY312=/Library/Frameworks/Python.framework/Versions/3.12/bin/python3
PY="$PY312"; [ -x "$PY" ] || PY=python3
FFPROBE=/opt/homebrew/bin/ffprobe; [ -x "$FFPROBE" ] || FFPROBE=ffprobe
rc=0
echo "== format"; "$FFPROBE" -v error -show_entries format=duration -show_entries stream=sample_rate,channels -of default=nw=1 "$WAV" || rc=1
echo "== gate 1: leading artifact"; "$PY" "$DIR/check_initial_artifact.py" "$WAV" || rc=1
echo "== gate 2: ending boundaries"; "$PY" "$DIR/check_ending_boundaries.py" "$WAV" || rc=1
echo "== gate 3: per-sentence ASR"
"$PY" - "$WAV" "$TXT" <<'PY' || rc=1
import re, sys, os, tempfile
import numpy as np, soundfile as sf
try:
    import mlx_whisper
except ImportError:
    print("SKIP: mlx_whisper not installed; per-sentence ASR gate not run", file=sys.stderr); sys.exit(1)
wav, txt = sys.argv[1], sys.argv[2]
x, sr = sf.read(wav, dtype="float32")
if x.ndim > 1: x = x.mean(axis=1)
zero = np.abs(x) <= 2 / 32768; runs = []; st = None
for i, v in enumerate(zero):
    if v and st is None: st = i
    elif not v and st is not None:
        if i - st >= int(0.15 * sr): runs.append((st, i))
        st = None
chunks = []; a = 0
for s, e in runs:
    if s - a >= int(0.5 * sr): chunks.append(x[a:s])
    a = e
if len(x) - a >= int(0.5 * sr): chunks.append(x[a:])
norm = lambda s: re.sub(r"[^가-힣A-Za-z0-9]", "", s).lower()
full = norm(open(txt, encoding="utf-8").read())
tmp = tempfile.mkdtemp(); bad = 0; hits = 0
for i, c in enumerate(chunks, 1):
    p = os.path.join(tmp, f"{i:02}.wav"); sf.write(p, c, sr, subtype="PCM_16")
    got = mlx_whisper.transcribe(p, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="ko")["text"].strip()
    words = got.split(); last = norm(words[-1]) if words else ""
    guard = "하나둘셋" in norm(got)
    ok = bool(last) and last in full and not guard
    hits += ok; bad += (not ok)
    print(f"{i:02} {'OK ' if ok else 'BAD'} {'[GUARD LEFT] ' if guard else ''}{got}")
print(f"ASR per-sentence {hits}/{len(chunks)}")
sys.exit(1 if bad or not chunks else 0)
PY
[ $rc -eq 0 ] && echo "VERIFY PASS" || echo "VERIFY FAIL"
exit $rc
