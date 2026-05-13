# Deployment Guide

## Prerequisites

- Node.js >= 18.18.0
- npm >= 11.0.0
- Git
- GitHub account
- Vercel account
- Supabase account
- SerpApi account
- LINE Developers account

## Local Development

### 1. Setup

```bash
git clone <your-repo>
cd Travel
npm install
cp .env.example .env.local
```

### 2. Configure Environment

Edit `.env.local` and fill in all required variables:
- `SERPAPI_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `CRON_SECRET`

### 3. Verify Setup

```bash
# Check TypeScript
npm run typecheck

# Check linting
npm run lint

# Build project
npm run build

# Start development server
npm run dev
```

Visit `http://localhost:3000` to verify.

## CI/CD Pipeline

The GitHub Actions workflow automatically:
1. Runs TypeScript type checking
2. Validates code style with ESLint
3. Builds the project
4. Performs security audit
5. Deploys to Vercel (on main branch)

All checks must pass before merging to main.

## Production Deployment

### 1. Vercel Setup

```bash
# Push to GitHub
git push origin main

# Vercel auto-deploys on main branch
# Set environment variables in Vercel Settings → Environment Variables
```

### 2. Post-Deployment

1. Update LINE Webhook URL in LINE Developers Console
2. Verify health check: `https://your-domain.vercel.app/api/health`
3. Test manual cron: `curl -X POST https://your-domain.vercel.app/api/cron/daily-search -H "Authorization: Bearer $CRON_SECRET"`

## Monitoring & Debugging

### Health Check

```bash
curl https://your-domain.vercel.app/api/health
```

### View Logs

- Vercel: Dashboard → Function Logs
- Supabase: Database → Logs
- LINE: Developers Console → Messaging API → Webhook

### Common Issues

| Issue | Solution |
|-------|----------|
| Webhook signature error | Verify `LINE_CHANNEL_SECRET` is correct |
| SerpApi quota exceeded | Check API usage in SerpApi dashboard |
| Database connection failed | Verify Supabase credentials in `.env` |
| Cron not triggering | Verify `CRON_SECRET` matches in request header |

## Rollback

If deployment fails:

```bash
# Vercel automatically keeps previous deployments
# Use Vercel Dashboard → Deployments to revert
```

## Security Considerations

- Never commit `.env.local` or secrets
- Rotate API keys regularly
- Use Vercel environment variables for production secrets
- Enable Supabase Row Level Security (RLS)
- Implement rate limiting on webhook endpoint

## Performance Tips

- Monitor Vercel analytics for performance metrics
- Use `npm run build` locally to catch build-time issues
- Check bundle size: `npm run build` shows size report
- Optimize images in SerpApi responses
- Cache responses where possible (6-hour cache default)
