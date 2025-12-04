// built-in-chat/src/federation.ts
// Module Federation container for JupyterLite

declare const window: any;

// TypeScript declarations for the Chrome Built-in AI Prompt API
declare class LanguageModel {
  static availability(): Promise<"unavailable" | "available" | "downloadable" | "downloading">;
  static create(options?: {
    monitor?: (monitor: { addEventListener: (event: string, callback: (e: ProgressEvent) => void) => void }) => void;
  }): Promise<LanguageModel>;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): ReadableStream<string>;
}

console.log("[built-in-chat/federation] Setting up Module Federation container");

const scope = "@wiki3-ai/built-in-chat";
let sharedScope: any = null;

// Helper to get a module from the shared scope
async function importShared(pkg: string): Promise<any> {
  if (!sharedScope) {
    // Fallback to global webpack share scope if available
    // @ts-ignore
    if (window.__webpack_share_scopes__ && window.__webpack_share_scopes__.default) {
      console.warn(`[built-in-chat] Using global __webpack_share_scopes__.default for ${pkg}`);
      // @ts-ignore
      sharedScope = window.__webpack_share_scopes__.default;
    } else {
      throw new Error(`[built-in-chat] Shared scope not initialized when requesting ${pkg}`);
    }
  }

  const versions = sharedScope[pkg];
  if (!versions) {
    throw new Error(`[built-in-chat] Shared module ${pkg} not found in shared scope. Available: ${Object.keys(sharedScope)}`);
  }

  const versionKeys = Object.keys(versions);
  if (versionKeys.length === 0) {
    throw new Error(`[built-in-chat] No versions available for ${pkg}`);
  }

  // Pick the first available version
  const version = versions[versionKeys[0]];
  const factory = version?.get;

  if (typeof factory !== "function") {
    throw new Error(`[built-in-chat] Module ${pkg} has no factory function`);
  }

  // Factory might return a Promise or the module directly
  let result = factory();

  // If it's a promise, await it
  if (result && typeof result.then === 'function') {
    result = await result;
  }

  // If result is a function (Webpack module wrapper), call it to get the actual exports
  if (typeof result === 'function') {
    result = result();
  }

  console.log(`[built-in-chat] Loaded ${pkg}:`, result);
  return result;
}

// Module Federation container API
const container = {
  init: (scope: any) => {
    console.log("[built-in-chat/federation] init() called, storing shared scope");
    sharedScope = scope;
    return Promise.resolve();
  },

  get: async (module: string) => {
    console.log("[built-in-chat/federation] get() called for module:", module);
    console.log("[built-in-chat/federation] This means JupyterLite is requesting our plugin!");

    // JupyterLite may request either "./index" or "./extension"
    if (module === "./index" || module === "./extension") {
      // Lazy-load our plugin module, which will pull from shared scope
      return async () => {
        console.log("[built-in-chat/federation] ===== LOADING PLUGIN MODULE =====");
        console.log("[built-in-chat/federation] Loading plugins from shared scope...");

        // Import JupyterLab/JupyterLite modules from shared scope
        const { BaseKernel, IKernelSpecs } = await importShared('@jupyterlite/kernel');

        console.log("[built-in-chat/federation] Got BaseKernel from shared scope:", BaseKernel);

        // Define Chrome built-in AI Chat session inline
        class ChatSession {
          private session: LanguageModel | null = null;

          constructor(_opts: any = {}) {
            console.log("[ChatSession] Using Chrome built-in AI");
          }

          async send(prompt: string, onChunk?: (chunk: string) => void): Promise<string> {
            console.log("[ChatSession] Sending prompt to Chrome built-in AI:", prompt);

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

            // Use streaming API - each chunk is a delta (only the new content)
            const stream = this.session.promptStreaming(prompt);
            let reply = "";
            const reader = stream.getReader();
            
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                // Append the chunk directly (delta streaming - each chunk is new content only)
                reply += value;
                if (onChunk && value) {
                  onChunk(value);
                }
              }
            } finally {
              reader.releaseLock();
            }

            console.log("[ChatSession] Got reply from Chrome built-in AI:", reply);
            return reply;
          }
        }

        // Define BuiltInChatKernel extending BaseKernel
        class BuiltInChatKernel extends BaseKernel {
          private chat: ChatSession;

          constructor(options: any) {
            super(options);
            const model = options.model;
            this.chat = new ChatSession({ model });
          }

          async executeRequest(content: any): Promise<any> {
            const code = String(content.code ?? "");
            try {
              // Stream each chunk as it arrives using the stream() method for stdout
              await this.chat.send(code, (chunk: string) => {
                // @ts-ignore
                this.stream(
                  { name: "stdout", text: chunk },
                  // @ts-ignore
                  this.parentHeader
                );
              });

              return {
                status: "ok",
                // @ts-ignore
                execution_count: this.executionCount,
                payload: [],
                user_expressions: {},
              };
            } catch (err: any) {
              const message = err?.message ?? String(err);
              // @ts-ignore
              this.publishExecuteError(
                {
                  ename: "Error",
                  evalue: message,
                  traceback: [],
                },
                // @ts-ignore
                this.parentHeader
              );
              return {
                status: "error",
                // @ts-ignore
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
              implementation_version: "0.1.0",
              language_info: {
                name: "markdown",
                version: "0.0.0",
                mimetype: "text/markdown",
                file_extension: ".md",
              },
              banner: "Chrome built-in AI chat kernel",
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
            return { status: "ok", found: false, data: {}, metadata: {} };
          }

          async isCompleteRequest(_content: any): Promise<any> {
            return { status: "complete", indent: "" };
          }

          async commInfoRequest(_content: any): Promise<any> {
            return { status: "ok", comms: {} };
          }

          async historyRequest(_content: any): Promise<any> {
            return { status: "ok", history: [] };
          }

          async shutdownRequest(_content: any): Promise<any> {
            return { status: "ok", restart: false };
          }

          async inputReply(_content: any): Promise<void> { }
          async commOpen(_content: any): Promise<void> { }
          async commMsg(_content: any): Promise<void> { }
          async commClose(_content: any): Promise<void> { }
        }

        // Define and return the plugin
        const builtInChatKernelPlugin = {
          id: "@wiki3-ai/built-in-chat:plugin",
          autoStart: true,
          // Match the official JupyterLite custom kernel pattern:
          // https://jupyterlite.readthedocs.io/en/latest/howto/extensions/kernel.html
          requires: [IKernelSpecs],
          activate: (app: any, kernelspecs: any) => {
            console.log("[built-in-chat] ===== ACTIVATE FUNCTION CALLED =====");
            console.log("[built-in-chat] JupyterLab app:", app);
            console.log("[built-in-chat] kernelspecs service:", kernelspecs);

            if (!kernelspecs || typeof kernelspecs.register !== "function") {
              console.error("[built-in-chat] ERROR: kernelspecs.register not available!");
              return;
            }

            try {
              kernelspecs.register({
                spec: {
                  name: "built-in-chat",
                  display_name: "Built-in AI Chat",
                  language: "python",
                  argv: [],
                  resources: {},
                },
                create: async (options: any) => {
                  console.log("[built-in-chat] Creating BuiltInChatKernel instance", options);
                  return new BuiltInChatKernel(options);
                },
              });

              console.log("[built-in-chat] ===== KERNEL REGISTERED SUCCESSFULLY =====");
              console.log("[built-in-chat] Kernel name: built-in-chat");
              console.log("[built-in-chat] Display name: Built-in AI Chat");
            } catch (error) {
              console.error("[built-in-chat] ===== REGISTRATION ERROR =====", error);
            }
          },
        };

        const plugins = [builtInChatKernelPlugin];
        console.log("[built-in-chat/federation] ===== PLUGIN CREATED SUCCESSFULLY =====");
        console.log("[built-in-chat/federation] Plugin ID:", builtInChatKernelPlugin.id);
        console.log("[built-in-chat/federation] Plugin autoStart:", builtInChatKernelPlugin.autoStart);
        console.log("[built-in-chat/federation] Returning plugins array:", plugins);

        // IMPORTANT: Shape the exports like a real federated ES module
        // so JupyterLite's loader sees our plugins. It checks for
        // `__esModule` and then reads `.default`.
        const moduleExports = {
          __esModule: true,
          default: plugins
        };

        return moduleExports;
      };
    }

    throw new Error(`[built-in-chat/federation] Unknown module: ${module}`);
  }
};

// Register the container
window._JUPYTERLAB = window._JUPYTERLAB || {};
window._JUPYTERLAB[scope] = container;

console.log("[built-in-chat/federation] Registered Module Federation container for scope:", scope);
