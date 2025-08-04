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

      try {
        // Verify that the webhook is valid and of a type we need to handle
        const text = await request.text();
        const payloadBuffer = Buffer.from(text);
        const linearSignature = request.headers.get(LINEAR_WEBHOOK_SIGNATURE_HEADER) || "";
        
        // Parse the payload to get the timestamp
        const parsedPayload = JSON.parse(text);
        const timestamp = parsedPayload[LINEAR_WEBHOOK_TS_FIELD];
        
        // Create webhook client and verify the signature
        const webhookClient = new LinearWebhookClient(env.LINEAR_WEBHOOK_SECRET);
        webhookClient.verify(payloadBuffer, linearSignature, timestamp);

        if (parsedPayload.type !== "AgentSessionEvent") {
          return new Response("Webhook received", { status: 200 });
        }

        const webhook = parsedPayload as AgentSessionEventWebhookPayload;
        const token = await getOAuthToken(env, webhook.organizationId);
        if (!token) {
          return new Response("Linear OAuth token not found", { status: 500 });
        }

        // Use waitUntil to ensure async processing completes
        ctx.waitUntil(
          this.handleWebhook(webhook, token, env.OPENAI_API_KEY).catch(
            (error: unknown) => {
              return new Response("Error handling webhook", { status: 500 });
            }
          )
        );

        // Return immediately to prevent timeout
        return new Response("Webhook handled", { status: 200 });
      } catch (error) {
        return new Response("Error handling webhook", { status: 500 });
      }
    }

    return new Response("OK", { status: 200 });
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
