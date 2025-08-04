import { LinearWebhookClient } from "@linear/sdk/webhooks";
import {
  handleOAuthAuthorize,
  handleOAuthCallback,
  getOAuthToken,
} from "./lib/oauth";
import { AgentClient } from "./lib/agent/agentClient";
import { AgentSessionEventWebhookPayload } from "@linear/sdk";

/**
 * This Cloudflare worker handles all requests for the demo agent.
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("Weather bot says hello! 🌤️", { status: 200 });
    }

    // Handle OAuth authorize route
    if (url.pathname === "/oauth/authorize") {
      return handleOAuthAuthorize(request, env);
    }

    // Handle OAuth callback route
    if (url.pathname === "/oauth/callback") {
      return handleOAuthCallback(request, env);
    }

    // Handle webhook route
    if (url.pathname === "/webhook" && request.method === "POST") {
      if (!env.LINEAR_WEBHOOK_SECRET) {
        return new Response("Webhook secret not configured", { status: 500 });
      }

      if (!env.OPENAI_API_KEY) {
        return new Response("OpenAI API key not configured", { status: 500 });
      }

      return this.handleWebhookWithEventListener(request, env, ctx);
    }

    return new Response("OK", { status: 200 });
  },

  /**
   * Handle webhook using the new LinearWebhookClient with event emitter pattern.
   * This uses the createHandler() method for simplified event handling.
   * @param request The incoming request.
   * @param env The environment variables.
   * @param ctx The execution context.
   * @returns A response promise.
   */
  async handleWebhookWithEventListener(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      // Create webhook client
      const webhookClient = new LinearWebhookClient(env.LINEAR_WEBHOOK_SECRET);
      const handler = webhookClient.createHandler();

      handler.on("AgentSessionEvent", async (payload) => {
        await this.handleAgentSessionEvent(payload, env, ctx);
      });

      return await handler(request);
    } catch (error) {
      console.error("Error in webhook handler:", error);
      return new Response("Error handling webhook", { status: 500 });
    }
  },

  /**
   * Handle an AgentSessionEvent webhook asynchronously (for non-blocking processing).
   * @param webhook The agent session event webhook payload.
   * @param env The environment variables.
   * @param ctx The execution context.
   * @returns A promise that resolves when the webhook is handled.
   */
  async handleAgentSessionEvent(
    webhook: any,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const token = await getOAuthToken(env, webhook.organizationId);
    if (!token) {
      console.error("Linear OAuth token not found");
      return;
    }

    const agentClient = new AgentClient(token, env.OPENAI_API_KEY);
    const userPrompt = this.generateUserPrompt(webhook);
    await agentClient.handleUserPrompt(webhook.agentSession.id, userPrompt);
  },

  /**
   * Generate a user prompt for the agent based on the webhook payload.
   * Modify this as needed if you want to give the agent more context by querying additional APIs.
   *
   * @param webhook The webhook payload.
   * @returns The user prompt.
   */
  generateUserPrompt(webhook: AgentSessionEventWebhookPayload): string {
    const issueTitle = webhook.agentSession.issue?.title;
    const commentBody = webhook.agentSession.comment?.body;
    if (issueTitle && commentBody) {
      return `Issue: ${issueTitle}\n\nTask: ${commentBody}`;
    } else if (issueTitle) {
      return `Task: ${issueTitle}`;
    } else if (commentBody) {
      return `Task: ${commentBody}`;
    }
    return "";
  },
};
