import { type AgentSessionEventWebhookPayload } from "@linear/sdk";
import {
  LinearWebhookClient,
  LINEAR_WEBHOOK_SIGNATURE_HEADER,
  LINEAR_WEBHOOK_TS_FIELD,
} from "@linear/sdk/webhooks";
import {
  handleOAuthAuthorize,
  handleOAuthCallback,
  getOAuthToken,
} from "./lib/oauth";
import { AgentClient } from "./lib/agent/agentClient";

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
   * Handle webhook using the new LinearWebhookClient with simplified event handling.
   * This eliminates all the boilerplate code for verification and parsing.
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
      
      // Get request body and headers
      const body = await request.text();
      const signature = request.headers.get(LINEAR_WEBHOOK_SIGNATURE_HEADER) || "";
      
      // Parse payload and verify signature
      const payload = JSON.parse(body);
      const timestamp = payload[LINEAR_WEBHOOK_TS_FIELD];
      webhookClient.verify(Buffer.from(body), signature, timestamp);

      // Handle AgentSessionEvent with the new pattern
      if (payload.type === "AgentSessionEvent") {
        const token = await getOAuthToken(env, payload.organizationId);
        if (!token) {
          return new Response("Linear OAuth token not found", { status: 500 });
        }

        // Use waitUntil to ensure async processing completes
        ctx.waitUntil(
          this.handleWebhook(payload, token, env.OPENAI_API_KEY).catch(
            (error: unknown) => {
              console.error("Error handling webhook:", error);
            }
          )
        );
      }
      
      return new Response("Webhook handled", { status: 200 });
    } catch (error) {
      console.error("Error in webhook handler:", error);
      return new Response("Error handling webhook", { status: 500 });
    }
  },

  /**
   * Handle a Linear webhook asynchronously (for non-blocking processing).
   * @param webhook The agent session event webhook payload.
   * @param linearAccessToken The Linear access token.
   * @param openaiApiKey The OpenAI API key.
   * @returns A promise that resolves when the webhook is handled.
   */
  async handleWebhook(
    webhook: AgentSessionEventWebhookPayload,
    linearAccessToken: string,
    openaiApiKey: string
  ): Promise<void> {
    const agentClient = new AgentClient(linearAccessToken, openaiApiKey);
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
