// built-in-chat/src/kernel.ts
import { BaseKernel, IKernel } from "@jupyterlite/kernel";

// TypeScript declarations for the Chrome Built-in AI Prompt API
declare class LanguageModel {
  static availability(): Promise<"unavailable" | "available" | "downloadable" | "downloading">;
  static create(options?: {
    monitor?: (monitor: { addEventListener: (event: string, callback: (e: ProgressEvent) => void) => void }) => void;
  }): Promise<LanguageModel>;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): ReadableStream<string>;
}

interface ChatSessionOptions {
  model?: string;
}

// ChatSession is defined inline here for TypeScript compilation
// The actual code used at runtime is in federation.ts
class ChatSession {
  private session: LanguageModel | null = null;

  constructor(_opts: ChatSessionOptions = {}) {
    console.log("[ChatSession] Using Chrome built-in AI");
  }

  async send(prompt: string, onChunk?: (chunk: string) => void): Promise<string> {
    if (typeof LanguageModel === "undefined") {
      throw new Error("Browser does not support Chrome built-in AI.");
    }

    const availability = await LanguageModel.availability();
    if (availability === "unavailable") {
      throw new Error("Chrome built-in AI model is not available.");
    }

    if (!this.session) {
      if (availability === "downloadable" || availability === "downloading") {
        this.session = await LanguageModel.create({
          monitor(m) {
            m.addEventListener("downloadprogress", (e: ProgressEvent) => {
              const progress = e.loaded;
              console.log(`[ChatSession] Downloading model: ${Math.round(progress * 100)}%`);
            });
          }
        });
      } else {
        this.session = await LanguageModel.create();
      }
    }

    const stream = this.session.promptStreaming(prompt);
    let reply = "";
    const reader = stream.getReader();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += value;
        if (onChunk && value) {
          onChunk(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    return reply;
  }
}

type KernelOptions = IKernel.IOptions & {
  /**
   * Optional model identifier to pass through to ChatSession.
   */
  model?: string;
};

export class BuiltInChatKernel extends BaseKernel {
  private chat: ChatSession;

  constructor(options: KernelOptions) {
    super(options);
    const model = options.model;
    this.chat = new ChatSession({ model });
  }

  async executeRequest(content: any): Promise<any> {
    const code = String(content.code ?? "");
    try {
      // Stream each chunk as it arrives using the stream() method for stdout
      await this.chat.send(code, (chunk: string) => {
        this.stream(
          { name: "stdout", text: chunk },
          this.parentHeader
        );
      });

      return {
        status: "ok",
        execution_count: this.executionCount,
        payload: [],
        user_expressions: {},
      };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      this.publishExecuteError(
        {
          ename: "Error",
          evalue: message,
          traceback: [],
        },
        this.parentHeader
      );
      return {
        status: "error",
        execution_count: this.executionCount,
        ename: "Error",
        evalue: message,
        traceback: [],
      };
    }
  }

  async kernelInfoRequest(): Promise<any> {
    return {
      status: "ok",
      protocol_version: "5.3",
      implementation: "built-in-chat-kernel",
      implementation_version: "0.2.6dev6",
      language_info: {
        name: "markdown",
        version: "0.0.0",
        mimetype: "text/markdown",
        file_extension: ".md",
      },
      banner: "Chrome Built-in AI chat kernel",
      help_links: [],
    };
  }

  async completeRequest(content: any): Promise<any> {
    return {
      status: "ok",
      matches: [],
      cursor_start: content.cursor_pos ?? 0,
      cursor_end: content.cursor_pos ?? 0,
      metadata: {},
    };
  }

  async inspectRequest(_content: any): Promise<any> {
    return {
      status: "ok",
      found: false,
      data: {},
      metadata: {},
    };
  }

  async isCompleteRequest(_content: any): Promise<any> {
    return {
      status: "complete",
      indent: "",
    };
  }

  async commInfoRequest(_content: any): Promise<any> {
    return {
      status: "ok",
      comms: {},
    };
  }

  async historyRequest(_content: any): Promise<any> {
    return {
      status: "ok",
      history: [],
    };
  }

  async shutdownRequest(_content: any): Promise<any> {
    return {
      status: "ok",
      restart: false,
    };
  }

  async inputReply(_content: any): Promise<void> {}

  async commOpen(_content: any): Promise<void> {}
  async commMsg(_content: any): Promise<void> {}
  async commClose(_content: any): Promise<void> {}
}

export function createBuiltInChatKernel(options: KernelOptions): IKernel {
  return new BuiltInChatKernel(options);
}
