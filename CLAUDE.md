# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Puglet is a Linear agent deployed as a Cloudflare Worker. It receives `AgentSession` webhooks from Linear, runs an OpenAI-driven agent loop, and triages a task into ONE of two GitHub repos by firing a `pug-estimate` `repository_dispatch`. There is one estimate tool per repo — `triggerIosEstimate` and `triggerServerEstimate` — and the repos are configured in `wrangler.jsonc` (`GITHUB_REPO_IOS`, currently `Zest-Maps/ZestMaps-iOS`; `GITHUB_REPO_SERVER`, currently `Zest-Maps/NotSwarm-Server`). The agent routes by LLM inference from the issue title + description + any explicit "iOS/server" hint the user gives; if it can't tell which repo, it asks (an `Elicitation`) rather than guessing. Both repos answer the same `pug-estimate` event with an identical `Estimate Issue` workflow on their default branch — the iOS one chains into an automated fix/PR when the verdict is `ai-can-fix`, while the server one is scope-only (no automatic PR yet). The agent is intentionally limited: triage iOS-app or server-backend tasks, share dog facts, decline everything else.

## Commands

```bash
npm run dev        # wrangler dev (local server)
npm run deploy     # wrangler deploy --minify
npm run lint       # eslint src --ext .ts
npm run lint:fix
npm run cf-typegen # regenerate worker-configuration.d.ts (Env types) from wrangler.jsonc
```

There are no tests. Run `npm run cf-typegen` after changing bindings/vars in `wrangler.jsonc` — the global `Env` type used throughout `src/` comes from the generated `worker-configuration.d.ts`.

## Architecture

Request flow: `src/index.ts` routes `/` (health), `/oauth/authorize`, `/oauth/callback`, and `POST /webhook`. The webhook handler verifies the signature via `LinearWebhookClient`, then hands `AgentSessionEvent` processing to `ctx.waitUntil()` so Linear gets an ack within its webhook timeout while the agent loop finishes in the background.

Agent loop (`src/lib/agent/agentClient.ts`): `AgentClient.handleUserPrompt` rebuilds conversation history from previous Linear agent-session activities, then loops (max 10 iterations) calling OpenAI. The LLM does **not** use native function calling — it emits plain text prefixed with one of `THINKING:` / `ACTION:` / `RESPONSE:` / `ELICITATION:` / `ERROR:` (defined in `src/lib/agent/prompt.ts`), which `mapResponseToLinearActivityContent` parses into Linear `AgentActivity` types. `RESPONSE`, `ERROR`, and `ELICITATION` end the loop; `THINKING` and `ACTION` continue it. Actions are posted to Linear twice: once before execution (announcement) and once after with the result.

Repo routing: the LLM picks the target repo by *which* estimate tool it calls (`triggerIosEstimate` vs `triggerServerEstimate`) — it never passes a repo string. `executeAction` in `agentClient.ts` maps each tool to its repo and funnels both through one private `dispatchEstimate(repo, parameter)` helper. The issue title + description (both from the webhook payload) are fed to the LLM via `generateUserPrompt` in `index.ts` so it has the context to route; when it can't tell, the prompt instructs it to emit an `Elicitation` instead of guessing.

Tool execution (`src/lib/agent/tools.ts`): the Linear issue identifier comes from the webhook payload, never from the LLM — the only LLM-controlled input is the free-text `instruction`. The identifier is validated against `LINEAR_IDENTIFIER_REGEX` before dispatching because GitHub answers a `repository_dispatch` with 204 regardless of payload validity, so bad payloads would otherwise fail silently downstream.

OAuth (`src/lib/oauth.ts`): tokens are obtained with `actor=app` and stored per-workspace in the `PUGLET_BOT_TOKENS` KV namespace as JSON (`StoredTokenData`), auto-refreshed with a 5-minute expiry buffer.

## Constraints worth knowing

- The OpenAI client is deliberately bounded (30s timeout, 1 retry) so a hung completion can't wedge the worker while Linear shows "creating…". Keep external calls bounded similarly (the GitHub dispatch uses a 10s AbortController).
- Changing the agent's behavior usually means editing `src/lib/agent/prompt.ts`. The prompt, the keyword parser in `agentClient.ts`, and the `ToolName`/`Content` types in `src/lib/types.ts` must stay in sync — adding or renaming a tool touches all three plus `executeAction` (and `isToolName`/`TOOL_NAMES` in `types.ts`).
- Linear rejects an Action activity whose `parameter` is null; always send `""` for no-argument actions.
- Secrets (`LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `GITHUB_TOKEN`) are set via `wrangler secret put`; non-secret config (`WORKER_URL`, `LINEAR_CLIENT_ID`, `GITHUB_REPO_IOS`, `GITHUB_REPO_SERVER`) lives in `wrangler.jsonc` `vars`.
