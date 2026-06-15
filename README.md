# Puglet

A simple Linear agent powered by OpenAI that triages a Linear task by triggering an automated estimate workflow in GitHub. The bot is deployed to a Cloudflare Worker.

Puglet triages into **one of two repositories** — the iOS app or the server backend — and decides which by reading the task's title, description, and any explicit "iOS/server" hint in your comment. When you ask the bot (in a Linear agent session) to "triage" the task, it fires a `repository_dispatch` event of type `pug-estimate` at the matching repository:

```
POST https://api.github.com/repos/<owner>/<repo>/dispatches
{ "event_type": "pug-estimate",
  "client_payload": { "linear_issue": "ZES-123", "instruction": "<optional note>" } }
```

That dispatch triggers the `Estimate Issue` workflow on the repo's default branch, which takes it from there: it analyzes the Linear task and the affected code, posts a triage summary (complexity, effort, and an AI-autonomy verdict) as a comment on the Linear issue, and applies `complexity:` / `effort:` / `autonomy:` labels. On the **iOS** repo, when the verdict is `ai-can-fix` it chains straight into an automated fix that opens a pull request. The **server** repo is scope-only for now — it estimates but does not open a PR automatically yet.

If Puglet can't tell which repo a task belongs to (and you gave no hint), it asks rather than guessing. Triaging tasks (into either repo) and sharing dog facts are the only things the bot can do: if asked for anything else, it politely declines — with a dog fact.

It responds to `AgentSession` webhooks from Linear and creates `AgentActivity` entries in response to prompts from users in Linear.

## Tools Available

The agent has one estimate tool per repo; which tool it calls is how it routes the task:

1. **`triggerIosEstimate(instruction)`** - Fires the `pug-estimate` repository dispatch at the iOS app repo for client-side iOS/Swift work.
2. **`triggerServerEstimate(instruction)`** - Fires the `pug-estimate` repository dispatch at the server backend repo for server/backend work.

For both, the Linear issue identifier (e.g. `ZES-123`) is pulled from the webhook payload; the optional `instruction` is a short free-text note the agent composes from any extra guidance the user gave in the session.

## Example Interactions

- "Triage this task." (clearly an app or backend task) → triggers the estimate workflow in the matching repo
- "Server triage, but only the visits cron job." → triggers the server workflow with that note as the instruction
- "Triage this." (ambiguous, no hint) → asks whether it's iOS or server work
- "What's the weather in Paris?" → politely declines (with a dog fact)

## Re-running

Re-triggering is safe: the workflow serializes runs per Linear issue, and a re-run reads the full Linear thread. To override a `needs-human` verdict, remove the `autonomy:needs-human` label on the Linear issue and ask Puglet to triage again.

## Architecture

The project is built as a Cloudflare Worker with the following structure:

```
src/
├── index.ts              # Main worker entry point
├── lib/
│   ├── agent/
│   │   ├── agentClient.ts # Main agent logic
│   │   ├── tools.ts       # Tool implementations (estimate workflow dispatch)
│   │   └── prompt.ts      # Prompt provided to LLM
│   └── oauth.ts           # Linear OAuth handling
│   └── types.ts           # TypeScript type definitions
```

## Setup

### Prerequisites

- Cloudflare account
- Linear workspace with permissions to create an OAuth app
- OpenAI API key
- A GitHub token that can send repository dispatches to the target repository (see below)

### GitHub token

The bot authenticates to the GitHub REST API with a token to fire the
`repository_dispatch` event. Because Puglet dispatches to **two** repos, the token
must cover both (`Zest-Maps/ZestMaps-iOS` and `Zest-Maps/NotSwarm-Server`). You
need **one** of:

- **Fine-grained personal access token** (recommended) — scoped to both
  repositories, with **Contents: Read and write** repository permission (this is
  what the dispatches endpoint requires). This is the most locked-down option.
- **Classic personal access token** — with the `repo` scope (or `public_repo` if
  the repos are public).

Whichever you create, set it as the `GITHUB_TOKEN` secret (below). The target repos
are configured via the `GITHUB_REPO_IOS` and `GITHUB_REPO_SERVER` variables
(`owner/repo`) in `wrangler.jsonc`. The `Estimate Issue` workflow (with
`on: repository_dispatch: types: [pug-estimate]`) must exist on each repo's
**default branch** — repository dispatches only trigger workflows from the default
branch.

### Cloudflare Worker Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure Cloudflare environment**

   * Set your `WORKER_URL`, `LINEAR_CLIENT_ID`, `GITHUB_REPO_IOS`, and `GITHUB_REPO_SERVER` variables in `wrangler.jsonc`

   * Set the client secret, webhook secret, OpenAI API key, and GitHub token via wrangler
   ```
   wrangler secret put LINEAR_CLIENT_SECRET
   wrangler secret put LINEAR_WEBHOOK_SECRET
   wrangler secret put OPENAI_API_KEY
   wrangler secret put GITHUB_TOKEN
   ```

   * Create a KV namespace and set its ID in `wrangler.jsonc` as well
   ```
   wrangler kv namespace create "PUGLET_BOT_TOKENS"
   ```

3. **Deploy**
   ```
   npm run deploy
   ```

### Linear OAuth Setup

1. Create a new OAuth app in Linear
2. Set the redirect URI to `https://<your-worker-url>/oauth/callback`
3. Enable webhooks and set the webhook endpoint to `https://<your-worker-url>/oauth/webhook`
4. Subscribe to agent session webhooks (and app user notification webhooks, if you'd like)
5. Copy the client ID, client secret, and webhook signing secret to use in your Cloudflare worker

## Installation

Once you've finished setting things up in both Linear and Cloudflare, visit `https://<your-worker-url>/oauth/authorize` to initiate OAuth between Puglet and Linear. This will install Puglet in your Linear workspace with an `actor=app` OAuth token.

## Development

### Local Development

```bash
# Start local development server
npm run dev
```

## Code Structure

### API Endpoints

- `POST /webhook` - Endpoint that receives Linear webhooks for `AgentSession` and `AgentActivity` creation
- `GET /oauth/authorize` - OAuth authorization endpoint
- `GET /oauth/callback` - OAuth callback handler

## License

This project is licensed under the MIT License.
