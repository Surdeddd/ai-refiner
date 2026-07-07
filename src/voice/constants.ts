export const VOICE_DEFAULT_ENDPOINT = "";
export const VOICE_DEFAULT_MODEL = "";
export const VOICE_DEFAULT_SAMPLE_RATE = 44_100;
export const VOICE_MIN_SAMPLE_RATE = 8_000;
export const VOICE_PCM_BUFFER_SIZE = 4096;
export const VOICE_WAV_MIME_TYPE = "audio/wav";

export const VOICE_RECORDING_MIME_CANDIDATES = [
	"audio/mp4",
	"audio/ogg;codecs=opus",
	"audio/webm;codecs=opus",
	"audio/webm",
] as const;

export const VOICE_LOOPBACK_HOST_CANDIDATES = [
	"127.0.0.1",
	"[::1]",
	"localhost",
] as const;
