# Weather Bot

A simple agent powered by OpenAI that integrates with Linear to provide current weather and time information. The bot is set up to be deployed to a Cloudflare worker.

The bot can look up coordinates for cities, get current weather conditions, and provide local time information for any location. It responds to `AgentSession` webhooks from Linear and creates `AgentActivity` entries in response to prompts from users in Linear.

---

*From bytes to breezes, I translate the sky,*  
*Where cloud coordinates meet clouds up high.*  
*A digital weathervane, forever awake,*  
*Predicting the sunshine or storms in your wake.*

---

## Tools Available

The agent has access to three main tools:

1. **`getCoordinates(city_name)`** - Get coordinates for a city
2. **`getWeather(lat, long)`** - Get current weather for given coordinates (latitude first, then longitude)
3. **`getTime(lat, long)`** - Get current time for given coordinates (latitude first, then longitude)

## Example Interactions

- "What tools do you have access to?"
- "What's the weather like in Paris?"
- "What time is it in Tokyo?"
- "Tell me about the weather and time in New York"

## Architecture

The project is built as a Cloudflare Worker with the following structure:

```
src/
├── index.ts              # Main worker entry point
├── lib/
│   ├── agent/
│   │   ├── agentClient.ts # Main agent logic
│   │   ├── tools.ts       # Tool implementations
│   │   └── prompt.ts      # Prompt provided to LLM
│   └── oauth.ts           # Linear OAuth handling
│   └── types.ts           # TypeScript type definitions
```

## Setup

### Prerequisites

- Cloudflare account
- Linear workspace with permissions to create an OAuth app
- OpenAI API key

### Cloudflare Worker Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure Cloudflare environment**

   * Set your `WORKER_URL` and `LINEAR_CLIENT_ID` variables in `wrangler.jsonc`

   * Set the client secret, webhook secret, and OpenAI API key via wrangler
   ```
   wrangler secret put LINEAR_CLIENT_SECRET
   wrangler secret put LINEAR_WEBHOOK_SECRET
   wrangler secret put OPENAI_API_KEY
   ```

   * Create a KV namespace and set its ID in `wrangler.jsonc` as well
   ```
   wrangler kv namespace create "WEATHER_BOT_TOKENS"
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

Once you've finished setting things up in both Linear and Cloudflare, visit `https://<your-worker-url>/oauth/authorize` to initiate OAuth between Weather Bot and Linear. This will install Weather Bot in your Linear workspace with an `actor=app` OAuth token.

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

### Usage

1. Fork the repository
2. Create a feature branch
3. Make changes as necessary
    - Update the tools to different ones based on your use case
    - Handle converting the agent's response into a Linear activity based on your custom prompt
    - Handle additional webhooks involving your agent

## License

This project is licensed under the MIT License.
