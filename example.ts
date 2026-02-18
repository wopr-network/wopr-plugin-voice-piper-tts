/**
 * Example usage of the Piper TTS plugin
 *
 * This shows how channel plugins would use the TTS provider.
 */

import type { WOPRPluginContext } from "wopr";
import type { TTSProvider } from "wopr/voice";

// =============================================================================
// Example 1: Basic Text-to-Speech
// =============================================================================

async function basicTTS(ctx: WOPRPluginContext) {
	const tts = ctx.getExtension<TTSProvider>("tts");

	if (!tts) {
		ctx.log.warn("No TTS provider registered");
		return;
	}

	// Synthesize speech with default voice
	const result = await tts.synthesize("Hello from WOPR!");

	ctx.log.info(`Synthesized ${result.audio.length} bytes`);
	ctx.log.info(`Format: ${result.format}, Rate: ${result.sampleRate}Hz`);
	ctx.log.info(`Duration: ${result.durationMs}ms`);

	// result.audio is a Buffer containing PCM audio
	// You can now:
	// - Stream to Discord/Telegram voice channel
	// - Save to file
	// - Convert to other formats
	// - Play locally
}

// =============================================================================
// Example 2: Voice Selection
// =============================================================================

async function voiceSelection(ctx: WOPRPluginContext) {
	const tts = ctx.getExtension<TTSProvider>("tts");
	if (!tts) return;

	// List available voices
	ctx.log.info("Available voices:");
	for (const voice of tts.voices) {
		ctx.log.info(`  ${voice.id}: ${voice.name} (${voice.language})`);
	}

	// Use specific voice
	const result = await tts.synthesize("Bonjour, je suis WOPR!", {
		voice: "fr_FR-upmc-medium",
	});

	ctx.log.info(`Synthesized French speech: ${result.audio.length} bytes`);
}

// =============================================================================
// Example 3: Speed Control
// =============================================================================

async function speedControl(ctx: WOPRPluginContext) {
	const tts = ctx.getExtension<TTSProvider>("tts");
	if (!tts) return;

	const text = "The quick brown fox jumps over the lazy dog.";

	// Slow speech
	const slow = await tts.synthesize(text, { speed: 0.7 });
	ctx.log.info(`Slow speech: ${slow.durationMs}ms`);

	// Normal speech
	const normal = await tts.synthesize(text, { speed: 1.0 });
	ctx.log.info(`Normal speech: ${normal.durationMs}ms`);

	// Fast speech
	const fast = await tts.synthesize(text, { speed: 1.5 });
	ctx.log.info(`Fast speech: ${fast.durationMs}ms`);
}

// =============================================================================
// Example 4: Discord Voice Channel
// =============================================================================

async function discordVoice(ctx: WOPRPluginContext, channelId: string) {
	const tts = ctx.getExtension<TTSProvider>("tts");
	if (!tts) return;

	// Synthesize speech
	const result = await tts.synthesize("WOPR is online and ready!", {
		voice: "en_US-lessac-medium",
		sampleRate: 48000, // Discord native rate
	});

	// In a real Discord plugin, you'd stream this to voice channel:
	/*
  const connection = await voiceChannel.join();
  const stream = Readable.from(result.audio);
  connection.play(stream, {
    type: StreamType.Raw,
    data: {
      channels: 1,
      sampleRate: result.sampleRate,
    },
  });
  */

	ctx.log.info("Audio ready for Discord voice channel");
}

// =============================================================================
// Example 5: Save to WAV File
// =============================================================================

async function saveToWav(ctx: WOPRPluginContext, outputPath: string) {
	const tts = ctx.getExtension<TTSProvider>("tts");
	if (!tts) return;

	const result = await tts.synthesize("Saving this to a file!");

	// Create WAV header
	const wavHeader = createWavHeader(
		result.audio.length,
		result.sampleRate,
		1, // mono
		16, // 16-bit
	);

	// Combine header + PCM data
	const wavFile = Buffer.concat([wavHeader, result.audio]);

	// Save to file
	const { writeFile } = await import("node:fs/promises");
	await writeFile(outputPath, wavFile);

	ctx.log.info(`Saved WAV file: ${outputPath}`);
}

/**
 * Create WAV file header for PCM data
 */
function createWavHeader(
	dataSize: number,
	sampleRate: number,
	channels: number,
	bitDepth: number,
): Buffer {
	const header = Buffer.alloc(44);

	// RIFF header
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + dataSize, 4); // File size - 8
	header.write("WAVE", 8);

	// fmt chunk
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16); // fmt chunk size
	header.writeUInt16LE(1, 20); // Audio format (1 = PCM)
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * channels * (bitDepth / 8), 28); // Byte rate
	header.writeUInt16LE(channels * (bitDepth / 8), 32); // Block align
	header.writeUInt16LE(bitDepth, 34);

	// data chunk
	header.write("data", 36);
	header.writeUInt32LE(dataSize, 40);

	return header;
}

// =============================================================================
// Example 6: Error Handling
// =============================================================================

async function errorHandling(ctx: WOPRPluginContext) {
	const tts = ctx.getExtension<TTSProvider>("tts");
	if (!tts) {
		ctx.log.error("TTS not available");
		return;
	}

	try {
		// This will work
		const result = await tts.synthesize("Valid text", {
			voice: "en_US-lessac-medium",
			speed: 1.0,
		});
		ctx.log.info("Synthesis succeeded");
	} catch (err) {
		ctx.log.error(`Synthesis failed: ${err}`);
	}

	try {
		// This will fail (invalid voice)
		await tts.synthesize("Invalid voice", {
			voice: "nonexistent-voice",
		});
	} catch (err) {
		ctx.log.error(`Expected error: ${err}`);
	}

	try {
		// This will fail (invalid speed)
		await tts.synthesize("Invalid speed", {
			speed: 5.0, // Must be 0.5 - 2.0
		});
	} catch (err) {
		ctx.log.error(`Expected error: ${err}`);
	}
}

// =============================================================================
// Example 7: Health Check
// =============================================================================

async function healthCheck(ctx: WOPRPluginContext) {
	const tts = ctx.getExtension<TTSProvider>("tts");
	if (!tts) return;

	if (tts.healthCheck) {
		const healthy = await tts.healthCheck();
		if (healthy) {
			ctx.log.info("✓ TTS provider is healthy");
		} else {
			ctx.log.warn("✗ TTS provider is unhealthy (Docker may not be running)");
		}
	}
}

// =============================================================================
// Example 8: Multi-Voice Conversation
// =============================================================================

async function multiVoiceConversation(ctx: WOPRPluginContext) {
	const tts = ctx.getExtension<TTSProvider>("tts");
	if (!tts) return;

	const conversation = [
		{
			speaker: "WOPR",
			voice: "en_US-joe-medium",
			text: "Shall we play a game?",
		},
		{
			speaker: "User",
			voice: "en_US-amy-medium",
			text: "How about Global Thermonuclear War?",
		},
		{
			speaker: "WOPR",
			voice: "en_US-joe-medium",
			text: "Wouldn't you prefer a good game of chess?",
		},
	];

	for (const line of conversation) {
		const result = await tts.synthesize(line.text, {
			voice: line.voice,
		});
		ctx.log.info(
			`${line.speaker}: ${line.text} (${result.audio.length} bytes)`,
		);
		// In a real app, you'd play this audio
		await new Promise((r) => setTimeout(r, 1000)); // Pause between lines
	}
}

// =============================================================================
// Export Examples
// =============================================================================

export {
	basicTTS,
	voiceSelection,
	speedControl,
	discordVoice,
	saveToWav,
	errorHandling,
	healthCheck,
	multiVoiceConversation,
};
