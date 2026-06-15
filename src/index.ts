import {
  LinearWebhookClient,
  AgentSessionEventWebhookPayload,
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
      return new Response("Puglet says hello! 🐶", { status: 200 });
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

      if (!env.GITHUB_TOKEN) {
        return new Response("GitHub token not configured", { status: 500 });
      }

      if (!env.GITHUB_REPO_IOS) {
        return new Response("GitHub iOS repo not configured", { status: 500 });
      }

      if (!env.GITHUB_REPO_SERVER) {
        return new Response("GitHub server repo not configured", {
          status: 500,
        });
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

      handler.on("AgentSessionEvent", (payload) => {
        // Don't await: hand the agent loop to waitUntil so we ack Linear
        // immediately (within its webhook timeout) and finish in the background.
        ctx.waitUntil(this.handleAgentSessionEvent(payload, env));
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
   * @returns A promise that resolves when the webhook is handled.
   */
  async handleAgentSessionEvent(
    webhook: AgentSessionEventWebhookPayload,
    env: Env
  ): Promise<void> {
    const token = await getOAuthToken(env, webhook.organizationId);
    if (!token) {
      console.error("Linear OAuth token not found");
      return;
    }

    const issue = webhook.agentSession.issue;
    const issueContext = {
      // The identifier (e.g. "ZES-123") is what the estimate workflow's
      // repository_dispatch payload requires.
      identifier: issue?.identifier ?? "",
      title: issue?.title ?? "",
      // Description is part of the context the LLM uses to route the task to
      // the iOS vs. server repo.
      description: issue?.description ?? "",
    };

    const agentClient = new AgentClient(
      token,
      env.OPENAI_API_KEY,
      env.GITHUB_TOKEN,
      { ios: env.GITHUB_REPO_IOS, server: env.GITHUB_REPO_SERVER },
      issueContext
    );
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
    const issue = webhook.agentSession.issue;
    const issueTitle = issue?.title;
    // The description carries the bulk of the task detail and is the main
    // signal (alongside the title and any comment) the agent uses to route the
    // task to the iOS vs. server repo.
    const issueDescription = issue?.description;
    const descriptionSection = issueDescription
      ? `\n\nDescription: ${issueDescription}`
      : "";
    const commentBody = webhook.agentSession.comment?.body;
    if (issueTitle && commentBody) {
      return `Issue: ${issueTitle}${descriptionSection}\n\nTask: ${commentBody}`;
    } else if (issueTitle) {
      // The agent was delegated/assigned this task with no comment. Let the
      // agent decide from the title and description which repo it belongs to
      // (iOS app vs. server) and triage it there, or ask if it's unclear.
      return `This Linear task was delegated to you with no comment. If it is client-side iOS app work or server/backend work, triage it into the right repo; if you can't tell which, ask. Issue: ${issueTitle}${descriptionSection}`;
    } else if (commentBody) {
      return `Task: ${commentBody}`;
    }
    return "";
  },
};
