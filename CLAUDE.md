# wopr-plugin-voice-piper-tts

Local Piper TTS provider for WOPR — runs Piper in Docker.

## Commands

```bash
npm run build     # tsc
npm run check     # biome check + tsc --noEmit (run before committing)
npm run format    # biome format --write src/
npm test          # vitest run
```

## Key Details

- Implements the `tts` capability provider from `@wopr-network/plugin-types`
- **Requires Docker** — Piper runs in a container. Docker must be running on the host.
- Piper is a fully local, offline TTS engine — no API key, no network calls for synthesis
- Voice models downloaded into the container on first run
- Config: Docker socket path, voice model name, container name
- **Gotcha**: First run is slow — model download. Subsequent runs use cached model.
- Use case: privacy-first, offline, free TTS

## Plugin Contract

Imports only from `@wopr-network/plugin-types`. Never import from `@wopr-network/wopr` core.

## Issue Tracking

All issues in **Linear** (team: WOPR). Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-voice-piper-tts`.
