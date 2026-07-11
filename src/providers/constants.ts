export const SYSTEM_PROMPT = "You are a writing assistant. Return only the refined version of the text.";

// User-channel prompt shared by every chat-style backend. SYSTEM_PROMPT must never be
// embedded here — it travels in the system channel (or is prepended exactly once for
// raw-prompt backends like Ollama /api/generate).
export function buildUserPrompt(instruction: string, text: string): string {
	return `Instruction:\n${instruction.trim()}\n\nText:\n${text}`;
}
