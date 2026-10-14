import type { AdvisorConfig, OpenCodeV2Event, PluginContextLike, ResolvedModelConfig } from "./types.js";
export type { PluginContextLike };
export interface ObserverDeps {
    config: AdvisorConfig;
    watchdog: ResolvedModelConfig;
}
export declare function extractSessionID(event: OpenCodeV2Event): string;
export declare function startEventObserver(ctx: PluginContextLike, deps: ObserverDeps, rootSignal: AbortSignal): void;
//# sourceMappingURL=trigger.d.ts.map