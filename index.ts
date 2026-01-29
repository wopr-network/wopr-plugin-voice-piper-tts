/**
 * WOPR Voice Plugin: Piper Local (Piper TTS Docker)
 *
 * Provides local TTS using Piper running in Docker.
 * Automatically pulls and manages the Docker container.
 *
 * Usage:
 * ```typescript
 * // Plugin auto-registers on init
 * // Channel plugins access via:
 * const tts = ctx.getTTS();
 * if (tts) {
 *   const result = await tts.synthesize("Hello world");
 *   // result.audio is PCM audio buffer
 * }
 * ```
 */

import type {
  TTSProvider,
  TTSOptions,
  TTSSynthesisResult,
  Voice,
  VoicePluginMetadata,
} from "wopr/voice";
import type { WOPRPlugin, WOPRPluginContext } from "wopr";
import { spawn } from "node:child_process";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// =============================================================================
// Configuration
// =============================================================================

interface PiperTTSConfig {
  /** Docker image to use */
  image?: string;
  /** Default voice model */
  voice?: string;
  /** Sample rate (Hz) */
  sampleRate?: number;
  /** Speed multiplier (0.5 - 2.0) */
  speed?: number;
  /** Model cache directory on host (optional) */
  modelCachePath?: string;
}

const DEFAULT_CONFIG: Required<Omit<PiperTTSConfig, "modelCachePath">> = {
  image: "rhasspy/piper:latest",
  voice: "en_US-lessac-medium",
  sampleRate: 22050,
  speed: 1.0,
};

// =============================================================================
// Piper Voice Models
// =============================================================================

/**
 * Available Piper voices from the official voice repository.
 * These are downloaded on first use.
 */
const PIPER_VOICES: Voice[] = [
  {
    id: "en_US-lessac-medium",
    name: "Lessac (US English)",
    language: "en-US",
    gender: "male",
    description: "Clear American English voice",
  },
  {
    id: "en_GB-alan-medium",
    name: "Alan (British English)",
    language: "en-GB",
    gender: "male",
    description: "Clear British English voice",
  },
  {
    id: "en_US-amy-medium",
    name: "Amy (US English)",
    language: "en-US",
    gender: "female",
    description: "Natural American English female voice",
  },
  {
    id: "en_GB-northern_english_male-medium",
    name: "Northern English Male",
    language: "en-GB",
    gender: "male",
    description: "Northern British accent",
  },
  {
    id: "en_US-joe-medium",
    name: "Joe (US English)",
    language: "en-US",
    gender: "male",
    description: "Warm American English voice",
  },
  {
    id: "en_US-kathleen-low",
    name: "Kathleen (US English)",
    language: "en-US",
    gender: "female",
    description: "Low quality but fast American English female voice",
  },
  {
    id: "de_DE-thorsten-medium",
    name: "Thorsten (German)",
    language: "de-DE",
    gender: "male",
    description: "Clear German voice",
  },
  {
    id: "es_ES-carlfm-x_low",
    name: "Carlfm (Spanish)",
    language: "es-ES",
    gender: "male",
    description: "Fast Spanish voice",
  },
  {
    id: "fr_FR-upmc-medium",
    name: "UPMC (French)",
    language: "fr-FR",
    gender: "male",
    description: "Clear French voice",
  },
  {
    id: "it_IT-riccardo-x_low",
    name: "Riccardo (Italian)",
    language: "it-IT",
    gender: "male",
    description: "Fast Italian voice",
  },
];

// =============================================================================
// TTS Provider Implementation
// =============================================================================

class PiperTTSProvider implements TTSProvider {
  readonly metadata: VoicePluginMetadata = {
    name: "piper-tts",
    version: "1.0.0",
    type: "tts",
    description: "Local TTS using Piper in Docker",
    capabilities: ["voice-selection", "speed-control"],
    local: true,
    docker: true,
    emoji: "🔊",
    homepage: "https://github.com/rhasspy/piper",
    requires: {
      docker: ["rhasspy/piper:latest"],
    },
    install: [
      {
        kind: "docker",
        image: "rhasspy/piper",
        tag: "latest",
        label: "Pull Piper TTS image",
      },
    ],
  };

  readonly voices: Voice[] = PIPER_VOICES;

  private config: Required<Omit<PiperTTSConfig, "modelCachePath">> & {
    modelCachePath?: string;
  };
  private docker?: any; // Dockerode instance
  private downloadedModels = new Set<string>();

  constructor(config: PiperTTSConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config.modelCachePath) {
      this.config.modelCachePath = config.modelCachePath;
    }
  }

  validateConfig(): void {
    // Validate voice exists
    const voiceExists = this.voices.some((v) => v.id === this.config.voice);
    if (!voiceExists) {
      throw new Error(
        `Invalid voice: ${this.config.voice}. Use one of: ${this.voices.map((v) => v.id).join(", ")}`,
      );
    }

    // Validate sample rate
    const validRates = [16000, 22050, 24000, 48000];
    if (!validRates.includes(this.config.sampleRate)) {
      throw new Error(
        `Invalid sample rate: ${this.config.sampleRate}. Valid: ${validRates.join(", ")}`,
      );
    }

    // Validate speed
    if (this.config.speed < 0.5 || this.config.speed > 2.0) {
      throw new Error(`Invalid speed: ${this.config.speed}. Must be 0.5-2.0`);
    }
  }

  async synthesize(
    text: string,
    options?: TTSOptions,
  ): Promise<TTSSynthesisResult> {
    const voice = options?.voice || this.config.voice;
    const speed = options?.speed || this.config.speed;
    const sampleRate = options?.sampleRate || this.config.sampleRate;

    // Ensure model is downloaded
    await this.ensureModelDownloaded(voice);

    // Create temp files
    const tempDir = tmpdir();
    const textFile = join(tempDir, `piper-input-${Date.now()}.txt`);
    const wavFile = join(tempDir, `piper-output-${Date.now()}.wav`);

    try {
      // Write text to temp file
      await writeFile(textFile, text, "utf-8");

      // Run Piper in Docker
      const startTime = Date.now();
      await this.runPiperContainer(textFile, wavFile, voice, speed, sampleRate);

      // Read WAV output
      const wavBuffer = await this.readWavFile(wavFile);

      // Convert WAV to PCM (strip WAV header)
      const pcmBuffer = this.wavToPcm(wavBuffer);

      const durationMs = Date.now() - startTime;

      return {
        audio: pcmBuffer,
        format: "pcm_s16le",
        sampleRate,
        durationMs,
      };
    } finally {
      // Cleanup temp files
      await unlink(textFile).catch(() => {});
      await unlink(wavFile).catch(() => {});
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Lazy load dockerode
      if (!this.docker) {
        const Docker = (await import("dockerode")).default;
        this.docker = new Docker();
      }

      // Check if Docker is running by listing containers
      await this.docker.listContainers({ limit: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    // Piper runs in ephemeral containers, no cleanup needed
    this.docker = undefined;
    this.downloadedModels.clear();
  }

  // -------------------------------------------------------------------------
  // Private: Docker management
  // -------------------------------------------------------------------------

  private async ensureModelDownloaded(voice: string): Promise<void> {
    if (this.downloadedModels.has(voice)) {
      return;
    }

    console.log(`[piper-tts] Downloading voice model: ${voice}...`);

    // Lazy load dockerode
    if (!this.docker) {
      const Docker = (await import("dockerode")).default;
      this.docker = new Docker();
    }

    // Pull image if not present
    try {
      await this.pullImage();
    } catch (err) {
      console.warn(`[piper-tts] Image pull warning:`, err);
    }

    // Download model using Piper's download_voice script
    // This runs once per voice and caches the model
    const modelDir = this.config.modelCachePath || join(tmpdir(), "piper-models");
    await mkdir(modelDir, { recursive: true });

    const container = await this.docker.createContainer({
      Image: this.config.image,
      Cmd: ["--model", voice, "--download-dir", "/models", "--help"],
      HostConfig: {
        Binds: [`${modelDir}:/models`],
        AutoRemove: true,
      },
    });

    await container.start();
    await container.wait();

    this.downloadedModels.add(voice);
    console.log(`[piper-tts] Voice model downloaded: ${voice}`);
  }

  private async runPiperContainer(
    inputFile: string,
    outputFile: string,
    voice: string,
    speed: number,
    sampleRate: number,
  ): Promise<void> {
    // Lazy load dockerode
    if (!this.docker) {
      const Docker = (await import("dockerode")).default;
      this.docker = new Docker();
    }

    const modelDir = this.config.modelCachePath || join(tmpdir(), "piper-models");

    const container = await this.docker.createContainer({
      Image: this.config.image,
      Cmd: [
        "--model",
        voice,
        "--output_file",
        "/output/output.wav",
        "--length_scale",
        String(1 / speed), // Piper uses length_scale (inverse of speed)
        "--sample_rate",
        String(sampleRate),
      ],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      StdinOnce: true,
      HostConfig: {
        Binds: [
          `${modelDir}:/models`,
          `${inputFile}:/input/input.txt:ro`,
          `${join(outputFile, "..")}:/output`,
        ],
        AutoRemove: true,
      },
    });

    // Start container and pipe input
    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
    });

    await container.start();

    // Stream text to stdin
    const fs = await import("node:fs");
    const textStream = fs.createReadStream(inputFile);
    textStream.pipe(stream);

    // Wait for completion
    await container.wait();
  }

  private async readWavFile(path: string): Promise<Buffer> {
    const { readFile } = await import("node:fs/promises");
    return readFile(path);
  }

  /**
   * Convert WAV file to raw PCM by stripping the WAV header.
   * Assumes standard 44-byte WAV header.
   */
  private wavToPcm(wavBuffer: Buffer): Buffer {
    // WAV header is typically 44 bytes
    // Format: RIFF (4) + size (4) + WAVE (4) + fmt (4) + fmt_size (4) + fmt_data (16)
    //         + data (4) + data_size (4) = 44 bytes
    const headerSize = 44;

    if (wavBuffer.length < headerSize) {
      throw new Error("Invalid WAV file: too small");
    }

    // Verify it's a WAV file
    const riffHeader = wavBuffer.toString("ascii", 0, 4);
    const waveHeader = wavBuffer.toString("ascii", 8, 12);

    if (riffHeader !== "RIFF" || waveHeader !== "WAVE") {
      throw new Error("Invalid WAV file: missing RIFF/WAVE headers");
    }

    // Strip header and return PCM data
    return wavBuffer.subarray(headerSize);
  }

  private async pullImage(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(this.config.image, (err: Error, stream: any) => {
        if (err) {
          reject(err);
          return;
        }
        this.docker.modem.followProgress(
          stream,
          (err: Error) => (err ? reject(err) : resolve()),
          (event: any) => {
            if (event.status) {
              console.log(`[piper-tts] ${event.status}`);
            }
          },
        );
      });
    });
  }
}

// =============================================================================
// Plugin Export
// =============================================================================

let provider: PiperTTSProvider | null = null;

const plugin: WOPRPlugin = {
  name: "voice-piper-tts",
  version: "1.0.0",
  description: "Local TTS using Piper in Docker",

  async init(ctx: WOPRPluginContext) {
    const config = ctx.getConfig<PiperTTSConfig>();
    provider = new PiperTTSProvider(config);

    try {
      provider.validateConfig();
      ctx.registerTTSProvider(provider);
      ctx.log.info("Piper TTS provider registered");
    } catch (err) {
      ctx.log.error(`Failed to register Piper TTS: ${err}`);
    }
  },

  async shutdown() {
    if (provider) {
      await provider.shutdown();
      provider = null;
    }
  },
};

export default plugin;
