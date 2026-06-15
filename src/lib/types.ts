import { LinearDocument as L } from "@linear/sdk";

/**
 * Error thrown when an unreachable case is encountered in an exhaustive switch statement
 */
export class UnreachableCaseError extends Error {
  constructor(value: unknown) {
    super(`Unreachable case: ${value}`);
    this.name = "UnreachableCaseError";
  }
}

/**
 * The content of an agent activity
 */
export type Content =
  | { type: L.AgentActivityType.Thought; body: string }
  | {
      type: L.AgentActivityType.Action;
      action: ToolName;
      // The tool's argument (the free-text instruction for the estimate
      // workflow). Linear requires a string here; use "" when there is none.
      parameter: string;
      result?: string;
    }
  | { type: L.AgentActivityType.Response; body: string }
  | { type: L.AgentActivityType.Elicitation; body: string }
  | { type: L.AgentActivityType.Error; body: string };

/**
 * The name of a tool that can be executed by the agent. There is one estimate
 * tool per target repository; the tool the LLM picks is how it routes a task
 * to the iOS client app vs. the server backend.
 */
export type ToolName = "triggerIosEstimate" | "triggerServerEstimate";

const TOOL_NAMES: readonly ToolName[] = [
  "triggerIosEstimate",
  "triggerServerEstimate",
];

/**
 * Check if a string is a valid tool name
 * @param value - The string to check
 * @returns True if the string is a valid tool name, false otherwise
 */
export const isToolName = (value: string): value is ToolName => {
  return (TOOL_NAMES as readonly string[]).includes(value);
};

/**
 * OAuth response from Linear.
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

/**
 * Stored token data that includes both access and refresh tokens with expiry information.
 */
export interface StoredTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp
}
