// Colab T4 + Qwen3-TTS 1.7B Base, Charly voice clone, sentence-by-sentence.
// Run:  CHARLY_TEXT_FILE=/abs/script.txt CHARLY_OUT=/abs/out.wav ego-browser nodejs < colab_charly_tts.mjs
// Optional env: CHARLY_SPACE (reuse TaskSpace id), CHARLY_REF_WAV, CHARLY_REF_TXT, CHARLY_KEEP=1 (keep Colab tab)
const fs = await import("node:fs/promises");
const crypto = await import("node:crypto");
const { execFileSync } = await import("node:child_process");
const os = await import("node:os");
const path = await import("node:path");

// ego-browser's Node runtime does not inherit shell env; run.sh prepends `const CFG = {...};`
const HOME = os.homedir();
const E = (typeof CFG !== "undefined" ? CFG : {});
const TEXT_FILE = E.CHARLY_TEXT_FILE;
const OUT = E.CHARLY_OUT;
// run.sh normally passes explicit private reference paths.
const REF_WAV = E.CHARLY_REF_WAV || `${HOME}/.local/share/colab-charly-tts/ref.wav`;
const REF_TXT = E.CHARLY_REF_TXT || `${HOME}/.local/share/colab-charly-tts/ref.txt`;
const NB = "https://colab.research.google.com/github/Myuniqous/qwen3-tts-voice-cloning-google-collab/blob/main/Qwen3_TTS_Voice_Cloning.ipynb";
if (!TEXT_FILE || !OUT) throw new Error("set CHARLY_TEXT_FILE and CHARLY_OUT");
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// ---- split: sentence ends; >80 chars split at comma/space; <15 chars merged into neighbour
function splitText(text) {
  const raw = text.replace(/\s+/g, " ").trim().split(/(?<=[.?!。？！…])\s+/).filter(Boolean);
  const out = [];
  for (let s of raw) {
    while (s.length > 80) {
      let cut = s.lastIndexOf(", ", 80);
      if (cut < 30) cut = s.lastIndexOf(" ", 80);
      if (cut < 30) cut = 80;
      out.push(s.slice(0, cut + 1).trim()); s = s.slice(cut + 1).trim();
    }
    if (s) out.push(s);
  }
  const merged = [];
  for (const s of out) {
    if (merged.length && (s.length < 15 || merged[merged.length - 1].length < 15) && merged[merged.length - 1].length + s.length + 1 <= 90)
      merged[merged.length - 1] += " " + s;
    else merged.push(s);
  }
  return merged;
}
const text = (await fs.readFile(TEXT_FILE, "utf8")).trim();
const sentences = splitText(text);
const refText = (await fs.readFile(REF_TXT, "utf8")).trim();
const job = crypto.randomBytes(4).toString("hex");
log("sentences", sentences.length, "chars", text.length, "job", job);

// ---- browser
const task = E.CHARLY_SPACE ? await taskSpace(Number(E.CHARLY_SPACE)) : await taskSpace("Colab 찰리 음성 생성");
console.log("SPACE", task.spaceId);
const c = task.page("p1");
if (!/colab\.research\.google\.com/.test(await c.url())) {
  await c.goto(NB);
  await c.waitForSelector("loc=css:#toolbar-add-code", { timeout: 60000 });
  await c.waitForTimeout(3000);
}
const walkText = () => {
  const walk = (root) => { let out = ""; const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = tw.nextNode())) out += n.nodeValue + "\n"; for (const el of root.querySelectorAll("*")) if (el.shadowRoot) out += walk(el.shadowRoot); return out; };
  let t = walk(document.body);
  for (const f of document.querySelectorAll("iframe")) { try { t += walk(f.contentDocument.body); } catch (e) {} }
  return t;
};
async function runCell(code) {
  await c.keyboard.press("Escape");
  await c.click("loc=css:#toolbar-add-code", { label: "add code cell" });
  await c.waitForTimeout(1200);
  await c.keyboard.paste(code);
  await c.waitForTimeout(500);
  // Run the newest cell containing this job marker. Keyboard shortcuts are unreliable
  // in fresh Colab notebooks because the selected cell may not own editor focus.
  const started = await c.evaluate((marker) => {
    const cells = [...document.querySelectorAll(".cell.code.notebook-cell")]
      .filter((cell) => (cell.innerText || cell.textContent || "").includes(marker));
    const cell = cells[cells.length - 1];
    const run = cell && cell.querySelector("colab-run-button");
    if (!run) return false;
    run.click();
    return true;
  }, `JOB${job}`);
  if (!started) throw new Error("could not locate new Colab cell run button");
  await c.waitForTimeout(3000);
  await c.click("md-text-button:has-text(\"무시하고 계속하기\")", { label: "run anyway" }).catch(() => {});
}
async function waitMarker(re, timeoutMs, every = 10000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    // Colab may render stdout either in the regular DOM or inside its output iframe.
    // Accessibility snapshots include both, so combine both views before matching.
    let t = await c.evaluate(walkText);
    try { t += "\n" + await c.snapshot({ scope: "full_page" }); } catch (_) {}
    const jobMarker = `JOB${job}`;
    const currentJob = t.slice(Math.max(0, t.lastIndexOf(jobMarker)));
    if (/Traceback \(most recent call last\)/.test(currentJob)) {
      const at = currentJob.lastIndexOf("Traceback");
      const tail = currentJob.slice(at, at + 1500);
      throw new Error("Colab error:\n" + tail);
    }
    const m = t.match(re);
    if (m) return m;
    await c.waitForTimeout(every);
  }
  throw new Error("timeout waiting " + re);
}

// 1) connect + install (idempotent)
await runCell(`print("JOB${job}")
import subprocess, sys, os
try:
    import qwen_tts
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "qwen-tts", "soundfile"], check=True)
import torch
print("SETUP${job}", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NO_GPU", os.path.getsize("/content/ref.wav") if os.path.exists("/content/ref.wav") else 0)`);
let m = await waitMarker(new RegExp(`SETUP${job}\\s+(True|False)\\s+(.+?)\\s+(\\d+)`), 15 * 60000);
if (m[1] !== "True") throw new Error("No GPU runtime: " + m[2] + " (Colab GPU quota may be exhausted)");
log("runtime", m[2]);
const refSize = (await fs.stat(REF_WAV)).size;
if (Number(m[3]) !== refSize) {
  // Fresh VM: write ref.wav from base64 inside a cell (file pane/input is unreliable).
  const refB64 = (await fs.readFile(REF_WAV)).toString("base64");
  await runCell(`print("JOB${job}")
import base64, os
open("/content/ref.wav", "wb").write(base64.b64decode("${refB64}"))
print("REFOK${job}", os.path.getsize("/content/ref.wav"))`);
  const r = await waitMarker(new RegExp(`REFOK${job}\\s+(\\d+)`), 3 * 60000, 3000);
  if (Number(r[1]) !== refSize) throw new Error("ref.wav upload size mismatch");
  await c.keyboard.press("Escape"); await c.keyboard.press("ControlOrMeta+m"); await c.keyboard.press("d"); await c.keyboard.press("ControlOrMeta+m"); await c.keyboard.press("d");
  log("ref.wav written", r[1]);
}

// 2) generate
const payload = Buffer.from(JSON.stringify({ s: sentences, ref: refText })).toString("base64");
await runCell(`print("JOB${job}")
import torch, time, json, base64, os, numpy as np, soundfile as sf
P = json.loads(base64.b64decode("${payload}").decode())
assert os.path.getsize("/content/ref.wav") == ${refSize}, "ref.wav size mismatch"
tl = time.time()
try: charly_model
except NameError:
    from qwen_tts import Qwen3TTSModel
    from huggingface_hub import snapshot_download
    model_dir = snapshot_download("Qwen/Qwen3-TTS-12Hz-1.7B-Base")
    charly_model = Qwen3TTSModel.from_pretrained(model_dir, device_map="cuda:0", dtype=torch.float16, attn_implementation="sdpa", local_files_only=True)
    charly_prompt = None
if charly_prompt is None or charly_prompt[1] != P["ref"]:
    charly_prompt = (charly_model.create_voice_clone_prompt(ref_audio="/content/ref.wav", ref_text=P["ref"]), P["ref"])
load_s = round(time.time() - tl, 1)
def clean_initial_artifact(wav, sr):
    win = int(sr * 0.01)
    max_search = min(len(wav), int(sr * 2.5))
    onset_idx = None
    for j in range(0, max_search - win, win):
        t = j / sr
        rms = float(np.sqrt(np.mean(wav[j:j + win] ** 2)))
        if t >= 0.15 and rms > 0.004:
            onset_idx = j
            break
    if onset_idx is None:
        return wav
    start = max(0, onset_idx - int(sr * 0.10))
    trimmed = wav[start:].copy()
    fade = int(sr * 0.015)
    if len(trimmed) > fade:
        trimmed[:fade] *= np.linspace(0.0, 1.0, fade)
    return trimmed
def rms_frames(wav, sr, hop=0.01):
    win = max(1, int(sr * hop))
    n = max(0, (len(wav) - win) // win)
    frames = np.empty(n, dtype=np.float64)
    for j in range(n):
        sl = wav[j * win:(j + 1) * win]
        frames[j] = float(np.sqrt(np.mean(sl.astype(np.float64) ** 2)))
    return frames, win
def duration_after_floor(wav, sr):
    rms, win = rms_frames(wav, sr)
    last = 0
    for j, value in enumerate(rms):
        if value > 0.004:
            last = j
    end = min(len(wav), (last + 1) * win + int(sr * 0.08))
    return end / sr
def strip_dummy_pad(wav, sr, pad_dur):
    n = len(wav)
    pad_dur = max(0.35, float(pad_dur))
    window_start = max(0, n - int((pad_dur + 0.70) * sr))
    region = wav[window_start:n]
    rms, win = rms_frames(region, sr)
    valleys = []
    j = 0
    while j < len(rms):
        if rms[j] < 0.006:
            k = j
            while k < len(rms) and rms[k] < 0.006:
                k += 1
            if k - j >= 18:
                valleys.append((j, k))
            j = k
        else:
            j += 1
    cut = None
    if valleys:
        best_score, best = 1e9, None
        for v0, v1 in valleys:
            remaining = (n - (window_start + v0 * win)) / sr
            err = abs(remaining - pad_dur)
            if remaining < pad_dur * 0.80:
                err += 0.80
            if err < best_score:
                best_score, best = err, (v0, v1)
        if best is not None and best_score < 1.20:
            v0, v1 = best
            into = min(int(sr * 0.10), max(win, (v1 - v0) * win // 2))
            cut = window_start + v0 * win + into
    if cut is None:
        cut = n - int(pad_dur * sr)
    cut = int(max(int(0.5 * sr), min(cut, n)))
    out = wav[:cut].copy()
    fade_out = int(sr * 0.012)
    if len(out) > fade_out:
        out[-fade_out:] *= np.linspace(1.0, 0.0, fade_out, dtype=out.dtype)
    return out
tg = time.time(); parts = []; sr = 24000
# Measure the generated duration of the disposable protection phrase once.
torch.manual_seed(1234)
pad_w, sr = charly_model.generate_voice_clone(text="하나 둘 셋.", language="Korean", voice_clone_prompt=charly_prompt[0], max_new_tokens=2048)
pad_a = np.array(pad_w[0] if isinstance(pad_w, (list, tuple)) else pad_w, dtype=np.float32)
pad_a = clean_initial_artifact(pad_a, int(sr))
pad_dur = duration_after_floor(pad_a, int(sr))
del pad_w, pad_a
print("PAD", round(pad_dur, 2), flush=True)
for i, s in enumerate(P["s"]):
    torch.manual_seed(1234)
    w, sr = charly_model.generate_voice_clone(text=s.rstrip() + " 하나 둘 셋.", language="Korean", voice_clone_prompt=charly_prompt[0], max_new_tokens=2048)
    a = np.array(w[0] if isinstance(w, (list, tuple)) else w, dtype=np.float32)
    a = clean_initial_artifact(a, int(sr))
    a = strip_dummy_pad(a, int(sr), pad_dur)
    parts += [a, np.zeros(int(0.25 * sr), np.float32)]
    print("SENT", i + 1, len(P["s"]), round(len(a) / sr, 2), flush=True)
a = np.concatenate(parts[:-1]); os.makedirs("/content/out", exist_ok=True)
sf.write("/content/out/${job}.flac", a, int(sr))
print("GENDONE${job}", load_s, round(time.time() - tg, 1), round(len(a) / sr, 2), round(torch.cuda.max_memory_allocated() / 1e9, 2))`);
m = await waitMarker(new RegExp(`GENDONE${job}\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`), 60 * 60000, 15000);
log("generated", { load_s: m[1], gen_s: m[2], dur_s: m[3], vram_gb: m[4] });

// 3) download via base64 in cell output
await runCell(`print("JOB${job}")
import base64, hashlib
b = open("/content/out/${job}.flac", "rb").read()
print("MD5${job}", hashlib.md5(b).hexdigest())
print("B${job}S" + base64.b64encode(b).decode() + "B${job}E")`);
const md5 = (await waitMarker(new RegExp(`MD5${job}\\s+([0-9a-f]{32})`), 5 * 60000, 3000))[1];
const b64 = (await waitMarker(new RegExp(`B${job}S([A-Za-z0-9+/=\\s]+)B${job}E`), 5 * 60000, 3000))[1].replace(/\s/g, "");
const buf = Buffer.from(b64, "base64");
if (crypto.createHash("md5").update(buf).digest("hex") !== md5) throw new Error("MD5 mismatch");
await c.keyboard.press("Escape"); await c.keyboard.press("ControlOrMeta+m"); await c.keyboard.press("d"); await c.keyboard.press("ControlOrMeta+m"); await c.keyboard.press("d");
const outAbs = path.resolve(OUT);
await fs.mkdir(path.dirname(outAbs), { recursive: true });
const flac = outAbs.replace(/\.wav$/i, "") + `.${job}.flac`;
await fs.writeFile(flac, buf);
execFileSync("/opt/homebrew/bin/ffmpeg", ["-y", "-loglevel", "error", "-i", flac, "-c:a", "pcm_s16le", outAbs]);
await fs.unlink(flac);
const dur = execFileSync("/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outAbs]).toString().trim();
if (E.CHARLY_KEEP !== "1") await task.finish({ keep: [] });
console.log(`WAV ${outAbs}`);
console.log(`DURATION ${dur}`);
console.log(`TIMING load_s=${m[1]} gen_s=${m[2]} vram_gb=${m[4]} wall_s=${((Date.now() - t0) / 1000).toFixed(0)} sentences=${sentences.length}`);
