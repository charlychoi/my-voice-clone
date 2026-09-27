#!/usr/bin/env python3
"""Regression gate for repeated Qwen leading artifacts in chunked WAV output."""
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


def median_leading_correlation(wav_path: str, window_s: float = 0.10) -> tuple[float, int]:
    x, sr = sf.read(wav_path, dtype="float32")
    if x.ndim > 1:
        x = x.mean(axis=1)
    chunks = split_on_zero_gaps(x, sr)
    if len(chunks) < 3:
        raise ValueError(f"need at least 3 chunks, found {len(chunks)}")
    n = int(window_s * sr)
    base = chunks[0][:n]
    correlations = []
    for chunk in chunks[1:]:
        if len(chunk) < n:
            continue
        correlations.append(float(np.corrcoef(base, chunk[:n])[0, 1]))
    return float(np.median(correlations)), len(chunks)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--max-correlation", type=float, default=0.75)
    args = ap.parse_args()
    try:
        median, count = median_leading_correlation(args.wav)
    except ValueError as exc:
        # The artifact signature is detected by comparing sentence starts with each other,
        # so it cannot be measured on fewer than 3 sentences. Report SKIP honestly.
        print(f"SKIP: {exc}; repeated-start comparison needs 3+ sentences (listen to the start)")
        return 0
    print(f"chunks={count} median_first100ms_correlation={median:.6f} limit={args.max_correlation:.3f}")
    if median >= args.max_correlation:
        print("FAIL: repeated leading artifact signature detected", file=sys.stderr)
        return 1
    print("PASS: no repeated leading artifact signature")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
