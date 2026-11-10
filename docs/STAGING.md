# Staging (Vercel + Supabase)

## Preview deployments (B1-T23)

`proxy.ts` treats unknown hosts as unknown tenants and returns 404 in production. On a Vercel **preview**
deployment (`VERCEL_ENV=preview` only), the deployment's own hosts, `VERCEL_URL` and `VERCEL_BRANCH_URL`, are
served as the app host, so every PR preview URL works. Production behaviour is unchanged. The hosts come from
Vercel system env vars, never from a request header, and only exact `*.vercel.app` hostnames are accepted.

Requirements:
- Vercel project → Settings → Environment Variables → **"Automatically expose System Environment Variables"
  must be ON** (it provides `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`). ALAN/user: toggle if off.
- `turbo.json` needs no change: the proxy reads these at runtime, not at build time.

## Supabase Auth redirect URLs (staging project)

Add to Authentication → URL Configuration → Redirect URLs:

- `https://restomate-staging.vercel.app/**`
- `https://*-alan-alkalifas-projects.vercel.app/**` (deployment, branch and PR preview URLs; scope slug `alan-alkalifas-projects`)

Site URL stays `https://restomate-staging.vercel.app`.
