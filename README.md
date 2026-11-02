# Telegram Bot - Vercel Deployment

A Telegram bot for Telegram groups with:
- **Daily picks**: `/pidor` and `/beauty` (anyone can run, once per day)
- **Admin daily picks**: `/daily_pidor` and `/daily_beauty` (admin only)
- **Multiple named queues**: Create presentation queues with `/queue start <name>`
- **Sliding queue of 3**: Auto-pop and append when presenter marks "Done"
- **UI buttons**: Register via inline buttons, Done via inline buttons
- **Auto-delete**: Queues deleted after 48h if never started

## Features

### Daily Picks
| Command | Description | Access |
|---------|-------------|--------|
| `/pidor` | Pick Pidor of the day (once/day, suspense sequence) | Anyone |
| `/beauty` | Pick Beauty of the day (once/day, suspense sequence) | Anyone |
| `/daily_pidor` | Admin trigger for Pidor of the day | Admin only |
| `/daily_beauty` | Admin trigger for Beauty of the day | Admin only |
| `/enroll_daily` | Enroll yourself in daily picks | Anyone |
| `/unenroll_daily` | Remove yourself from daily picks | Anyone |

### Presentation Queues
| Command | Description | Access |
|---------|-------------|--------|
| `/queue start <name>` | Create and start a named queue | Anyone |
| `/queue delete <name>` | Delete a queue | Anyone |
| `/queue` | List all queues | Anyone |
| `/done` | Mark yourself done (pop first, append new random) | Anyone in active queue |

### Buttons
- **Register**: `📝 Register for <name>` — joins the queue
- **Done**: `✅ Done` — pops you from the active queue, shifts others up, appends new random

## Deployment on Vercel (Free Tier)

### 1. Create the Bot
1. Message **@BotFather** on Telegram
2. Run `/newbot` and follow the prompts
3. Save your **Bot Token**

### 2. Create Redis (Upstash - Free Tier)
1. Go to [Upstash Console](https://console.upstash.com/)
2. Create a new Redis database (free tier)
3. Copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

> Note: This bot uses the `redis` npm package which connects via the standard Redis protocol. If using Upstash's REST-only tier, you may need to adjust `lib/store.js` to use `@upstash/redis` instead.

### 3. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
vercel
```

Or connect your GitHub repo to Vercel and import it.

### 4. Set Environment Variables

In the Vercel dashboard, go to **Settings → Environment Variables** and add:

| Variable | Value |
|----------|-------|
| `BOT_TOKEN` | Your bot token from @BotFather |
| `REDIS_URL` | Your Redis connection URL (e.g., `redis://...`) |
| `ADMIN_USERS` | Comma-separated admin usernames (default: `TheDevilOfAntarctica`) |

### 5. Set the Webhook

After deployment, set the webhook URL in Telegram:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<your-project>.vercel.app/api/webhook"
```

Replace `<YOUR_BOT_TOKEN>` and `<your-project>` with your actual values.

## Local Development

```bash
# Install dependencies
npm install

# Copy env example
cp .env.example .env
# Edit .env with your values

# Run locally
npm run dev
```

## Notes for Vercel Free Tier

- Vercel free tier gives you a public `*.vercel.app` URL (perfect for webhooks)
- Serverless functions have a 30s max duration
- State is stored in Redis so it persists across cold starts
- The 48h auto-delete runs on queue creation check
