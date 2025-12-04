// built-in-chat/src/ChatSession.ts
// Browser-side chat session that uses Chrome's built-in AI Prompt API directly
// Uses self.ai.languageModel to work in WebWorker environments (JupyterLite kernels)

declare const self: any;

export interface ChatSessionOptions {
  /**
   * Optional model identifier for Chrome AI.
   * Defaults to the default Chrome built-in AI model.
   */
  model?: string;
}

export class ChatSession {
  private session: any = null;

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
    // Check if the API is available (using self for WebWorker compatibility)
    if (!self.ai?.languageModel) {
      throw new Error("Browser does not support Chrome built-in AI.");
    }

    // Check model availability
    const capabilities = await self.ai.languageModel.capabilities();
    if (capabilities.available === "no") {
      throw new Error("Chrome built-in AI model is not available.");
    }

    // Create session if not already created, with progress monitoring
    if (!this.session) {
      if (capabilities.available === "after-download") {
        // Model needs to be downloaded, create with progress monitoring
        this.session = await self.ai.languageModel.create({
          monitor(m: any) {
            m.addEventListener("downloadprogress", (e: any) => {
              const progress = e.loaded / e.total;
              console.log(`[ChatSession] Downloading model: ${Math.round(progress * 100)}%`);
            });
          }
        });
      } else {
        this.session = await self.ai.languageModel.create();
      }
    }

    // Use streaming API
    const stream = await this.session.promptStreaming(prompt);
    let reply = "";
    let previousLength = 0;
    for await (const chunk of stream) {
      // The stream yields the full text so far, so we need to extract just the new part
      const newContent = chunk.slice(previousLength);
      previousLength = chunk.length;
      reply = chunk;
      if (onChunk && newContent) {
        onChunk(newContent);
      }
    }

    return reply;
  }
}
