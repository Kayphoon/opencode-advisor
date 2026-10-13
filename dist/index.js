import { Plugin } from "@opencode/plugin";
import { isConsultEnabled, loadAdvisorConfig, resolveConsult, resolveWatchdog } from "./config.js";
import { startEventObserver } from "./trigger.js";
import { clearAllSessionStates } from "./state.js";
import { createConsultTool } from "./tools/consult.js";
export const AdvisorPlugin = Plugin.define({
    id: "opencode-superadvisor",
    async setup(ctx) {
        const config = loadAdvisorConfig(ctx.options);
        if (config.enabled === false) {
            console.log("[opencode-superadvisor] Advisor disabled via config.");
            return () => { };
        }
        const watchdog = resolveWatchdog(config);
        const consult = resolveConsult(config);
        console.log(`[opencode-superadvisor] watchdog=${watchdog.model} (tools: ${watchdog.tools.join(",")}) ` +
            `consult=${consult.model} reviewMode=${config.reviewMode} interval=${config.reviewInterval ?? 1}`);
        const pluginCtx = ctx;
        const abortController = new AbortController();
        const disposers = [];
        // Intrinsic consultation tool (Claude Code "advisor tool" pattern).
        if (isConsultEnabled(config) && pluginCtx.tool?.transform) {
            try {
                const registration = await pluginCtx.tool.transform((editor) => {
                    editor.add(createConsultTool({
                        consult,
                        getContextMessages: (sessionID) => pluginCtx.session.context({ sessionID }),
                        includeContextMessages: config.consult?.includeContextMessages ?? 12,
                    }));
                });
                disposers.push(() => registration.dispose());
                console.log("[opencode-superadvisor] registered consult_advisor tool.");
            }
            catch (err) {
                console.warn("[opencode-superadvisor] failed to register consult_advisor:", err instanceof Error ? err.message : String(err));
            }
        }
        // Background watchdog observer.
        startEventObserver(pluginCtx, { config, watchdog }, abortController.signal);
        return async () => {
            console.log("[opencode-superadvisor] Unloading advisor plugin...");
            abortController.abort();
            clearAllSessionStates();
            for (const dispose of disposers) {
                try {
                    await dispose();
                }
                catch {
                    // best-effort cleanup
                }
            }
        };
    },
});
export default AdvisorPlugin;
//# sourceMappingURL=index.js.map