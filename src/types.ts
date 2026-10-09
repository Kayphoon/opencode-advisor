export type AdviceSeverity = "nit" | "concern" | "blocker";

export interface AdviceNote {
  note: string;
  severity: AdviceSeverity;
}

export interface AdvisorDeliveryConfig {
  nit?: "synthetic_noreply" | "synthetic_waking";
  concern?: "synthetic_noreply" | "synthetic_waking";
  blocker?: "steer_waking" | "steer_noreply";
}

export interface AdvisorProviderConfig {
  baseURL?: string;
  apiKey?: string;
}

export interface AdvisorConfig {
  enabled?: boolean;
  model: string;
  variant?: string;
  provider?: AdvisorProviderConfig;
  reviewMode?: "step" | "idle" | "execution";
  maxToolSteps?: number;
  maxNotesPerUpdate?: number;
  immuneTurns?: number;
  timeoutMs?: number;
  tools?: string[];
  delivery?: AdvisorDeliveryConfig;
  systemPrompt?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<string>;
}

export interface ToolExecutionContext {
  workspaceDir: string;
  signal: AbortSignal;
}

export interface AdvisorSessionState {
  sessionID: string;
  workspaceDir: string;
  lastEvaluatedMessageID: string | null;
  consecutiveAdvisorTurns: number;
  userTurnCount: number;
  immuneUntilUserTurn: number;
  seenHashes: string[];
  rollingSummary: string;
  isReviewing: boolean;
  abortController: AbortController | null;
}

export interface OpenCodeV2Event {
  id?: string;
  created?: number;
  type: string;
  location?: {
    directory?: string;
    workspaceID?: string;
  };
  data?: Record<string, unknown>;
}
