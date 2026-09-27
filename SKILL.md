---
name: colab-charly-tts
description: "Use when Charly wants 찰리 음성 generated on Colab GPU."
version: 1.1.0
author: Charly Choi, Hermes Agent (맥헬미)
license: MIT
platforms: [macos]
metadata:
  short-description: Charly voice via Qwen3-TTS 1.7B on free Colab T4
  hermes:
    tags: [tts, voice-clone, korean, charly, qwen3, colab, gpu]
    related_skills: [qwen3-tts-charly, ego-browser, google-charly-tts, vps-charly-tts]
---

# Colab Charly TTS (Qwen3-TTS 1.7B on free Colab T4)

Generate a private reference voice with `Qwen/Qwen3-TTS-12Hz-1.7B-Base` on a Google Colab T4 GPU. The script drives Colab through the **Ego Lite browser** (`ego-browser` CLI), where the user must already be signed in.

Use only a voice sample that you own or have explicit permission to clone. Never commit reference audio or its transcript to a public repository.

**Status: production-tested (2026-09-27).** A fixed 1-minute Korean sample passed listening and automated boundary checks. Install this folder under an agent skill directory such as `~/.agents/skills/colab-charly-tts/`.

## Requirements

- macOS with Ego Lite installed (`ego-browser` on PATH) and Colab signed in inside Ego.
- `/opt/homebrew/bin/ffmpeg`, `ffprobe`.
- For verification: `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3` with `numpy`, `soundfile`, `mlx_whisper`.
- Store a private reference pair outside the repository at `~/.local/share/colab-charly-tts/ref.wav` and `ref.txt`, or pass `--ref-wav/--ref-txt`. The WAV and transcript are deliberately not bundled.

## Run

Paths below are relative to this skill folder (`SKILL_DIR`). The full path is `~/.agents/skills/colab-charly-tts`.

```bash
SKILL_DIR=~/.agents/skills/colab-charly-tts
# script file (preferred for anything longer than one sentence)
"$SKILL_DIR/scripts/run.sh" --text-file /abs/script.txt --out /abs/out.wav [--space <TaskSpace id>] [--keep]
# one short line
"$SKILL_DIR/scripts/run.sh" --text "문장" --out /abs/out.wav
```

- Run it in the background. It needs about 1–2 min for setup on a fresh runtime (model load ~50 s) plus about 3.7 s of generation per 1 s of audio. A 1-minute script takes about 4 min.
- Output ends with `WAV <path>`, `DURATION <s>`, `TIMING load_s gen_s vram_gb wall_s sentences`. Do not claim the file exists before `WAV` prints.
- `--space N`: reuse an existing Ego TaskSpace whose `p1` is the Colab notebook. The model stays loaded (`load_s=0.0`).
- `--keep`: keep the tab and runtime for follow-up requests. Without it, the TaskSpace is finished.
- `--ref-wav/--ref-txt`: use a private reference voice and matching transcript outside the repository. These override the local default under `~/.local/share/colab-charly-tts/`.

## Verify (required before delivery)

```bash
"$SKILL_DIR/scripts/verify.sh" /abs/out.wav /abs/script.txt   # must print VERIFY PASS
```

It runs three gates:
1. **Leading artifact:** the median first-100-ms correlation across sentences must be below 0.75. Before the fix it was 0.994.
2. **Ending boundaries:** each sentence's last 20 ms must be below -35 dB, meaning it faded out rather than being cut.
3. **Per-sentence ASR:** every sentence's final eojeol must appear in the script, and the `하나 둘 셋` guard phrase must not remain.

Whole-file ASR alone is never enough. A 100% text match once hid leading noise and 5/11 clipped endings. If a gate fails, regenerate the failing text before delivering. Do not patch it with speed or pitch processing.

## Finish

- Attach the WAV and give its **full local path**.
- When the batch is done, disconnect the runtime: Colab menu **런타임 → 런타임 연결 해제 및 삭제**. Then run the confirm dialog's **예**.
- Speed changes: apply `atempo` once to the clean 1.0× file. Charly dislikes post-processed speed or pitch as a substitute for natural delivery.

## What the script does

1. Splits text at sentence ends. Pieces over 80 chars are cut at `, ` or a space. Pieces under 15 chars are merged into a neighbour, because tiny pieces made the model add words.
2. Installs `qwen-tts` if missing and checks `torch.cuda`. It fails fast with `No GPU runtime` if Colab gave a CPU runtime or the quota is exhausted.
3. Writes `ref.wav` into `/content` from base64 inside a cell.
4. Loads the model once (`snapshot_download` → local load; `charly_model` global survives across runs) and caches the voice-clone prompt.
5. For each sentence, generates `sentence + " 하나 둘 셋."` with seed 1234, then:
   - removes the repeated initial artifact (`clean_initial_artifact`),
   - cuts only the guard phrase at the detected silence valley (`strip_dummy_pad`),
   - applies a 12 ms fade-out.

   It then joins sentences with 0.25 s gaps.
6. Downloads through base64 printed in the cell output, verifies MD5, and converts to 16-bit 24 kHz mono WAV.

## Measured (2026-09-27, fixed version)

- 489 chars / 11 sentences → 58.43 s audio, 215.9 s generation on T4, 9.1 GB VRAM, wall 248 s with the model already loaded.
- Leading-artifact correlation was -0.020. All 11 endings were at or below -38.9 dB. Per-sentence ASR preserved 11/11 final eojeols. No guard phrase remained.
- Always generate sentence by sentence (30–80 chars). One-shot generation drifts lower and quieter after about 10 s: 1,675 chars dropped about 30 Hz.

## Pitfalls

- `ego-browser nodejs` does not pass shell env vars, so `run.sh` prepends `const CFG = {...}`. Do not call the `.mjs` directly.
- The Colab file pane often has no `input[type=file]`. The script writes ref audio through base64 in a cell.
- Colab `files.download` does not reach Ego downloads. Use the base64-in-output path, which is already in the script.
- The first run shows a "GitHub에서 로드됨" warning. The script clicks 무시하고 계속하기.
- Run one job per runtime at a time. A second run queues behind the first.
- Keyboard shortcuts are unreliable for running cells. The script clicks the `colab-run-button` of the newest cell that contains its `JOB…` marker.
- Fresh runtimes can 404 on `additional_chat_templates`. That is why the script uses `snapshot_download()` and then `local_files_only=True`.
- Stdout may render inside an output iframe, so marker detection combines DOM text with an accessibility snapshot. Clear stale failed outputs (수정 → 모든 출력 지우기) before a retry.
- Ego's Node has no Homebrew on PATH, so the script calls `/opt/homebrew/bin/ffmpeg|ffprobe` by absolute path.
- An Ego TaskSpace can vanish mid-run (`page label not found: p1` / `task space not found`). Check `listTaskSpaces()`, then rerun without `--space`; a fresh space reconnects to the same runtime quickly.
- For 1–2 sentence outputs the leading-artifact gate prints SKIP (it compares sentence starts with each other); listen to the start instead.
- If Colab refuses a free GPU because the quota is used up, report it. Fall back to VPS only with Charly's OK.
