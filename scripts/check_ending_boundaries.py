#!/usr/bin/env python3
"""Regression gate for abrupt active-audio endings before inter-chunk zero pads."""
import argparse
import sys

import numpy as np
import soundfile as sf


def split_on_zero_gaps(x: np.ndarray, sr: int, min_gap_s: float = 0.15) -> list[np.ndarray]:
    zero = np.abs(x) <= 2 / 32768
    runs: list[tuple[int, int]] = []
    start = None
    for i, value in enumerate(zero):
        if value and start is None:
            start = i
        elif not value and start is not None:
            if i - start >= int(min_gap_s * sr):
                runs.append((start, i))
            start = None
    chunks: list[np.ndarray] = []
    begin = 0
    for end, next_begin in runs:
        piece = x[begin:end]
        if len(piece) >= int(0.5 * sr):
            chunks.append(piece)
        begin = next_begin
    piece = x[begin:]
    if len(piece) >= int(0.5 * sr):
        chunks.append(piece)
    return chunks


def tail_db(chunk: np.ndarray, sr: int, window_s: float = 0.02) -> float:
    tail = chunk[-max(1, int(window_s * sr)):]
    return float(20 * np.log10(np.sqrt(np.mean(tail.astype(np.float64) ** 2)) + 1e-12))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--max-tail-db", type=float, default=-35.0)
    args = ap.parse_args()
    x, sr = sf.read(args.wav, dtype="float32")
    if x.ndim > 1:
        x = x.mean(axis=1)
    chunks = split_on_zero_gaps(x, sr)
    if len(chunks) < 1:
        print("FAIL: no audible chunk found", file=sys.stderr)
        return 2
    values = [tail_db(chunk, sr) for chunk in chunks]
    failed = [i + 1 for i, value in enumerate(values) if value > args.max_tail_db]
    print("chunks=" + str(len(chunks)) + " last20ms_db=" + ",".join(f"{v:.1f}" for v in values))
    if failed:
        print(f"FAIL: active audio reaches hard boundary in chunks {failed}", file=sys.stderr)
        return 1
    print("PASS: every chunk reaches a quiet protected tail before padding")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
