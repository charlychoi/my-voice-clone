# Colab Qwen3-TTS Voice Clone Skill

Google Colab T4에서 `Qwen/Qwen3-TTS-12Hz-1.7B-Base`를 구동해 문장별 음성을 생성하는 에이전트 스킬입니다. Hermes Agent, Claude Code, Codex에서 같은 폴더를 공유할 수 있습니다.

## 특징

- 30~80자 단위 문장 분할
- 문장 앞 반복 잡음 자동 제거
- `하나 둘 셋.` 보호 발화 후 제거하여 마지막 어절 잘림 방지
- 문장 끝 12ms 페이드아웃과 0.25초 간격
- 출력 MD5 검증 및 24kHz/16-bit/mono WAV 변환
- 앞 잡음, 끝 절단, 문장별 ASR 품질 검사

## 개인정보·음성 안전

실제 참조 음성은 저장소에 포함하지 않습니다. 본인 음성이거나 명시적인 복제 허가를 받은 음성만 사용하세요.

```bash
mkdir -p ~/.local/share/colab-charly-tts
cp /private/path/ref.wav ~/.local/share/colab-charly-tts/ref.wav
cp /private/path/ref.txt ~/.local/share/colab-charly-tts/ref.txt
```

`ref.txt`는 `ref.wav`에서 실제로 말한 문장을 정확하게 기록해야 합니다. 또는 실행할 때 `--ref-wav`, `--ref-txt`로 다른 비공개 경로를 지정할 수 있습니다.

## 설치

```bash
git clone https://github.com/charlychoi/my-voice-clone.git ~/.agents/skills/colab-charly-tts
ln -s ~/.agents/skills/colab-charly-tts ~/.claude/skills/colab-charly-tts
ln -s ~/.agents/skills/colab-charly-tts ~/.codex/skills/colab-charly-tts
```

Hermes Agent에서는 활성 프로필의 skills 폴더 아래에 연결하거나 복사합니다. 자세한 실행 절차와 검증 기준은 [`SKILL.md`](SKILL.md)를 참고하세요.

## 실행

```bash
SKILL_DIR=~/.agents/skills/colab-charly-tts
"$SKILL_DIR/scripts/run.sh" \
  --text-file /absolute/path/script.txt \
  --out /absolute/path/output.wav
```

짧은 문장:

```bash
"$SKILL_DIR/scripts/run.sh" \
  --text "안녕하세요. 음성 생성 테스트입니다." \
  --out /absolute/path/output.wav
```

## 품질 검사

```bash
"$SKILL_DIR/scripts/verify.sh" \
  /absolute/path/output.wav \
  /absolute/path/script.txt
```

`VERIFY PASS`가 출력된 파일만 전달하세요. 1~2문장 파일은 시작 패턴끼리 비교할 수 없어 앞 잡음 검사가 `SKIP`되므로 직접 청취가 필요합니다.

## 주요 요구사항

- macOS
- Ego Lite 및 `ego-browser` CLI
- Ego Lite 안에서 Google Colab 로그인
- Homebrew `ffmpeg`, `ffprobe`
- 품질 검사: Python 3.12, `numpy`, `soundfile`, `mlx_whisper`

## 라이선스

MIT. 모델과 의존 패키지에는 각 프로젝트의 라이선스가 별도로 적용됩니다.
