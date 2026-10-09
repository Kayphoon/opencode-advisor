import { Plugin } from "@opencode/plugin";
import { loadAdvisorConfig } from "./config.js";
import { startEventObserver, type PluginContextLike } from "./trigger.js";
import { clearAllSessionStates } from "./state.js";

export const AdvisorPlugin = Plugin.define({
  id: "opencode-advisor",
  async setup(ctx) {
    const config = loadAdvisorConfig(ctx.options);

    if (config.enabled === false) {
      console.log("[opencode-advisor] Advisor disabled via config.");
      return () => {};
    }

    console.log(
      `[opencode-advisor] Initialized with model: ${config.model}, reviewMode: ${config.reviewMode}, maxToolSteps: ${config.maxToolSteps}`
    );

    const abortController = new AbortController();

    // Start background event observer
    startEventObserver(ctx as unknown as PluginContextLike, config, abortController.signal);

    // Return cleanup hook for plugin unload
    return () => {
      console.log("[opencode-advisor] Unloading advisor plugin...");
      abortController.abort();
      clearAllSessionStates();
    };
  },
});

export default AdvisorPlugin;
