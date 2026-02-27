# WOPR Plugin: Piper Local TTS

Local text-to-speech provider using [Piper](https://github.com/rhasspy/piper) running in Docker.

## Features

- **100% Local**: No API calls, runs entirely on your machine
- **Docker-based**: Auto-manages Piper container lifecycle
- **Voice Selection**: 10+ voices across multiple languages
- **Speed Control**: Adjust speech rate (0.5x - 2.0x)
- **Auto-install**: Automatically downloads voice models on first use
- **PCM Output**: Standard PCM format for compatibility

## Installation

```bash
cd ~/wopr-project/plugins/wopr-plugin-voice-piper-tts
pnpm install
pnpm build
```

## Requirements

- Docker installed and running
- Node.js 20+

The plugin will automatically:
1. Pull `rhasspy/piper:latest` Docker image
2. Download voice models on first use
3. Manage container lifecycle

## Configuration

In your WOPR config:

```json
{
  "plugins": {
    "voice-piper-tts": {
      "enabled": true,
      "config": {
        "voice": "en_US-lessac-medium",
        "sampleRate": 22050,
        "speed": 1.0,
        "modelCachePath": "/path/to/cache/piper-models"
      }
    }
  }
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `voice` | string | `"en_US-lessac-medium"` | Default voice model to use |
| `sampleRate` | number | `22050` | Sample rate in Hz (16000, 22050, 24000, 48000) |
| `speed` | number | `1.0` | Speech speed multiplier (0.5 - 2.0) |
| `modelCachePath` | string | OS temp dir | Directory to cache downloaded models |
| `image` | string | `"rhasspy/piper:latest"` | Docker image to use |

## Available Voices

### English

| Voice ID | Name | Gender | Language | Quality |
|----------|------|--------|----------|---------|
| `en_US-lessac-medium` | Lessac | Male | US English | Medium |
| `en_US-amy-medium` | Amy | Female | US English | Medium |
| `en_US-joe-medium` | Joe | Male | US English | Medium |
| `en_US-kathleen-low` | Kathleen | Female | US English | Low (fast) |
| `en_GB-alan-medium` | Alan | Male | British English | Medium |
| `en_GB-northern_english_male-medium` | Northern English | Male | British English | Medium |

### Other Languages

| Voice ID | Language | Gender |
|----------|----------|--------|
| `de_DE-thorsten-medium` | German | Male |
| `es_ES-carlfm-x_low` | Spanish | Male |
| `fr_FR-upmc-medium` | French | Male |
| `it_IT-riccardo-x_low` | Italian | Male |

See [Piper voice repository](https://github.com/rhasspy/piper/blob/master/VOICES.md) for the full list.

## Usage

### From Channel Plugins

```typescript
// Get TTS provider (plugin-types ≥ 0.7)
const tts = ctx.getExtension("tts");

if (!tts) {
  ctx.log.warn("No TTS provider available");
  return;
}

// Synthesize speech
const result = await tts.synthesize("Hello from WOPR!", {
  voice: "en_US-amy-medium",
  speed: 1.2,
});

// result.audio is a Buffer containing PCM audio
// result.format is "pcm_s16le"
// result.sampleRate is 22050 (or configured rate)
```

### Voice Selection

```typescript
// List available voices
const voices = tts.voices;
console.log(voices.map(v => `${v.id}: ${v.name} (${v.language})`));

// Use specific voice
const result = await tts.synthesize("Bonjour!", {
  voice: "fr_FR-upmc-medium",
});
```

### Speed Control

```typescript
// Slower speech (0.5x - 1.0x)
const slow = await tts.synthesize("Speaking slowly", { speed: 0.7 });

// Faster speech (1.0x - 2.0x)
const fast = await tts.synthesize("Speaking quickly", { speed: 1.5 });
```

## Architecture

### Container Lifecycle

1. **On first synthesis**: Downloads voice model to cache directory
2. **Per synthesis**: Spawns ephemeral Docker container
3. **Container runs**: Piper CLI processes text → WAV
4. **Output conversion**: WAV → PCM (strip 44-byte header)
5. **Auto-cleanup**: Container auto-removes after completion

### File Flow

```
Text → Temp file → Docker container → Piper CLI → WAV file → PCM buffer
```

### Model Caching

Voice models are downloaded once and cached in `modelCachePath`:

```
~/.cache/piper-models/
  en_US-lessac-medium.onnx
  en_US-lessac-medium.onnx.json
  en_GB-alan-medium.onnx
  ...
```

## Troubleshooting

### Docker not running

```
Error: connect ENOENT /var/run/docker.sock
```

**Solution**: Start Docker daemon.

### Model download fails

```
Error: Voice model download failed
```

**Solution**: Check internet connection. Models are downloaded from Hugging Face on first use.

### Invalid voice error

```
Error: Invalid voice: xyz. Use one of: en_US-lessac-medium, ...
```

**Solution**: Use a voice from the supported list (see Available Voices above).

### WAV conversion error

```
Error: Invalid WAV file: missing RIFF/WAVE headers
```

**Solution**: This indicates Piper output an unexpected format. Check Piper container logs.

## Performance

- **First synthesis**: ~5-10s (model download + synthesis)
- **Subsequent syntheses**: ~1-2s (synthesis only)
- **Model size**: ~10-50MB per voice
- **Container overhead**: ~500ms startup

## Comparison with Other TTS

| Feature | Piper Local | Cloud TTS (OpenAI/ElevenLabs) |
|---------|-------------|-------------------------------|
| Cost | Free | Pay per character |
| Privacy | 100% local | Sends text to cloud |
| Latency | 1-2s | 0.5-1s (network dependent) |
| Quality | Good | Excellent |
| Voices | 100+ | 10-50 |
| Setup | Docker required | API key required |

## Development

```bash
# Watch mode
pnpm dev

# Build
pnpm build

# Test
node -e "import('./index.js').then(p => console.log(p.default))"
```

## License

MIT

## Credits

- [Piper TTS](https://github.com/rhasspy/piper) by Rhasspy
- [WOPR](https://github.com/wopr-project/wopr) voice plugin architecture
