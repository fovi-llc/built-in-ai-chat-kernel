// built-in-chat/src/ChatSession.ts
// Browser-side chat session that uses Chrome's built-in AI Prompt API directly
// Uses the global LanguageModel class exposed by Chrome/Edge Built-in AI

// TypeScript declarations for the Chrome Built-in AI Prompt API
declare class LanguageModel {
  static availability(): Promise<"unavailable" | "available" | "downloadable" | "downloading">;
  static create(options?: {
    monitor?: (monitor: { addEventListener: (event: string, callback: (e: ProgressEvent) => void) => void }) => void;
  }): Promise<LanguageModel>;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): ReadableStream<string>;
}

export interface ChatSessionOptions {
  /**
   * Optional model identifier for Chrome AI.
   * Defaults to the default Chrome built-in AI model.
   */
  model?: string;
}

export class ChatSession {
  private session: LanguageModel | null = null;

  constructor(_opts: ChatSessionOptions = {}) {
    console.log("[ChatSession] Using Chrome built-in AI");
  }

  /**
   * Send a prompt and stream the response.
   * @param prompt The user prompt
   * @param onChunk Optional callback invoked for each chunk of text as it arrives
   * @returns The full response text
   */
  async send(prompt: string, onChunk?: (chunk: string) => void): Promise<string> {
    // Check if the API is available via the global LanguageModel class
    if (typeof LanguageModel === "undefined") {
      throw new Error("Browser does not support Chrome built-in AI.");
    }

    // Check model availability
    const availability = await LanguageModel.availability();
    if (availability === "unavailable") {
      throw new Error("Chrome built-in AI model is not available.");
    }

    // Create session if not already created, with progress monitoring
    if (!this.session) {
      if (availability === "downloadable" || availability === "downloading") {
        // Model needs to be downloaded, create with progress monitoring
        this.session = await LanguageModel.create({
          monitor(m) {
            m.addEventListener("downloadprogress", (e: ProgressEvent) => {
              // e.loaded is a value between 0 and 1 representing download progress
              const progress = e.loaded;
              console.log(`[ChatSession] Downloading model: ${Math.round(progress * 100)}%`);
            });
          }
        });
      } else {
        this.session = await LanguageModel.create();
      }
    }

    // Use streaming API
    const stream = this.session.promptStreaming(prompt);
    let reply = "";
    let previousLength = 0;
    const reader = stream.getReader();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        // The stream yields the full text so far, so we need to extract just the new part
        const newContent = value.slice(previousLength);
        previousLength = value.length;
        reply = value;
        if (onChunk && newContent) {
          onChunk(newContent);
        }
      }
    } finally {
      reader.releaseLock();
    }

    return reply;
  }
}
