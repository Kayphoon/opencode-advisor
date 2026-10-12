import type { AdvisorConfig, PluginContextLike, ResolvedModelConfig } from "./types.js";
export type { PluginContextLike };
export interface ObserverDeps {
    config: AdvisorConfig;
    watchdog: ResolvedModelConfig;
}
export declare function startEventObserver(ctx: PluginContextLike, deps: ObserverDeps, rootSignal: AbortSignal): void;
//# sourceMappingURL=trigger.d.ts.map