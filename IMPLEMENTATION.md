# Piper TTS Plugin Implementation Notes

## Architecture Overview

This plugin follows the WOPR voice plugin architecture (PR 1154 pattern) and implements the `TTSProvider` interface.

## Key Components

### 1. TTSProvider Interface Implementation

```typescript
class PiperTTSProvider implements TTSProvider {
  readonly metadata: VoicePluginMetadata
  readonly voices: Voice[]

  validateConfig(): void
  synthesize(text: string, options?: TTSOptions): Promise<TTSSynthesisResult>
  healthCheck?(): Promise<boolean>
  shutdown?(): Promise<void>
}
```

### 2. Docker Container Management

**Pattern**: Ephemeral containers (like whisper-local)

- Each synthesis spawns a new container
- Container auto-removes after completion (`AutoRemove: true`)
- Models cached on host filesystem (bind mount)

**Container Configuration**:
```typescript
{
  Image: "rhasspy/piper:latest",
  Cmd: [
    "--model", voice,
    "--output_file", "/output/output.wav",
    "--length_scale", String(1 / speed),
    "--sample_rate", String(sampleRate),
  ],
  HostConfig: {
    Binds: [
      `${modelDir}:/models`,
      `${inputFile}:/input/input.txt:ro`,
      `${outputDir}:/output`,
    ],
    AutoRemove: true,
  },
}
```

### 3. Voice Model Management

**Download Strategy**:
- Models downloaded on first use per voice
- Cached in `modelCachePath` (default: OS temp dir)
- `downloadedModels` Set tracks which models are ready

**Model Location**:
```
~/.cache/piper-models/
  en_US-lessac-medium.onnx
  en_US-lessac-medium.onnx.json
```

### 4. Audio Format Conversion

**Piper Output**: WAV format (with 44-byte RIFF header)

**WOPR Expected**: PCM format (raw audio data)

**Conversion**: `wavToPcm()` strips WAV header
```typescript
private wavToPcm(wavBuffer: Buffer): Buffer {
  const headerSize = 44; // Standard WAV header
  // Verify RIFF/WAVE headers
  return wavBuffer.subarray(headerSize); // Return raw PCM
}
```

### 5. Plugin Registration

```typescript
const plugin: WOPRPlugin = {
  name: "voice-piper-tts",
  version: "1.0.0",

  async init(ctx: WOPRPluginContext) {
    const config = ctx.getConfig<PiperTTSConfig>();
    provider = new PiperTTSProvider(config);
    provider.validateConfig();
    ctx.registerProvider(provider); // ← Key registration (plugin-types ≥ 0.7)
    ctx.registerExtension("tts", provider); // ← For ctx.getExtension("tts") consumers
  },

  async shutdown() {
    await provider?.shutdown();
  },
};
```

## Synthesis Flow

```
1. synthesize(text, options)
   ↓
2. ensureModelDownloaded(voice)
   ├─ Check if model in cache
   ├─ If not: spawn container to download
   └─ Mark as downloaded
   ↓
3. Write text to temp file
   ↓
4. runPiperContainer(input, output, voice, speed, rate)
   ├─ Create Docker container
   ├─ Bind mount: models, input, output
   ├─ Pipe text to stdin
   └─ Wait for completion
   ↓
5. Read WAV output file
   ↓
6. wavToPcm(wavBuffer)
   ├─ Verify RIFF/WAVE headers
   └─ Strip 44-byte header → PCM
   ↓
7. Return TTSSynthesisResult
   ├─ audio: Buffer (PCM)
   ├─ format: "pcm_s16le"
   ├─ sampleRate: number
   └─ durationMs: number
```

## Differences from Whisper-Local Plugin

| Aspect | Whisper-Local (STT) | Piper (TTS) |
|--------|---------------------|-------------|
| Container lifecycle | Long-running server | Ephemeral per-synthesis |
| Port binding | Yes (8765) | No |
| Health check | HTTP `/health` endpoint | Docker ping |
| Input | Audio buffer → FormData | Text → temp file |
| Output | JSON (text) | WAV file → PCM buffer |
| Streaming | Session-based | Single-shot |

## Performance Characteristics

- **First synthesis**: 5-10s (model download + synthesis)
- **Subsequent**: 1-2s (container spawn + synthesis)
- **Container overhead**: ~500ms
- **Model size**: 10-50MB per voice
- **Memory**: ~200MB per container

## Error Handling

### Docker not available
```typescript
async healthCheck(): Promise<boolean> {
  try {
    await this.docker.listContainers({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}
```

### Invalid voice
```typescript
validateConfig(): void {
  const voiceExists = this.voices.some((v) => v.id === this.config.voice);
  if (!voiceExists) {
    throw new Error(`Invalid voice: ${this.config.voice}`);
  }
}
```

### WAV conversion errors
```typescript
private wavToPcm(wavBuffer: Buffer): Buffer {
  if (wavBuffer.length < 44) {
    throw new Error("Invalid WAV file: too small");
  }
  if (riffHeader !== "RIFF" || waveHeader !== "WAVE") {
    throw new Error("Invalid WAV file: missing RIFF/WAVE headers");
  }
  // ...
}
```

## Testing Checklist

- [ ] Plugin loads without errors
- [ ] `validateConfig()` rejects invalid voices
- [ ] `validateConfig()` rejects invalid sample rates
- [ ] `validateConfig()` rejects invalid speed values
- [ ] First synthesis downloads model
- [ ] Model cached for subsequent syntheses
- [ ] WAV → PCM conversion works
- [ ] Output format is `pcm_s16le`
- [ ] Different voices work
- [ ] Speed control works (0.5x - 2.0x)
- [ ] Temp files cleaned up
- [ ] Containers auto-remove
- [ ] `healthCheck()` returns correct status
- [ ] `shutdown()` cleans up resources

## Configuration Examples

### Minimal (use defaults)
```json
{
  "plugins": {
    "voice-piper-tts": {
      "enabled": true
    }
  }
}
```

### Full configuration
```json
{
  "plugins": {
    "voice-piper-tts": {
      "enabled": true,
      "config": {
        "voice": "en_GB-alan-medium",
        "sampleRate": 24000,
        "speed": 1.2,
        "modelCachePath": "/var/cache/wopr/piper-models",
        "image": "rhasspy/piper:2024.11.0"
      }
    }
  }
}
```

## Future Enhancements

- [ ] `streamSynthesize()` for long text (chunking)
- [ ] `synthesizeBatch()` for multiple texts
- [ ] Pitch control (if Piper adds support)
- [ ] Custom voice model URLs
- [ ] Pre-download all models on init
- [ ] Container pooling (reuse containers)
- [ ] GPU support (CUDA image)
- [ ] Voice cloning support

## Dependencies

- `dockerode`: ^4.0.0 - Docker API client
- Node.js built-ins:
  - `node:child_process` - Spawn processes
  - `node:fs/promises` - File operations
  - `node:path` - Path manipulation
  - `node:os` - Temp directory

## References

- [Piper GitHub](https://github.com/rhasspy/piper)
- [Piper Docker Hub](https://hub.docker.com/r/rhasspy/piper)
- [WOPR Voice Types](https://github.com/wopr-project/wopr/blob/main/src/voice/types.ts)
- [Whisper-Local Plugin](https://github.com/wopr-project/wopr/tree/main/plugins/wopr-plugin-voice-whisper-local)
