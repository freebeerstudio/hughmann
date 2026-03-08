---
name: scaffold-project
description: Scaffold infrastructure for a new FBS client project. Creates GitHub repo, Vercel project, Cloudflare DNS, and updates the project record with infrastructure details. Use when starting a new client website or app.
domain: fbs
---

# Scaffold Project

Automate the infrastructure setup for a new Free Beer Studio client project. This skill creates everything needed to go from zero to a deployable project in minutes.

## Prerequisites

Ensure these CLI tools are available (check via `which`):
- `gh` (GitHub CLI, authenticated)
- `vercel` (Vercel CLI, authenticated)

If any are missing, tell {{OWNER}} what needs to be installed and stop.

## Inputs

Ask {{OWNER}} for:
1. **Project name** — e.g., "Sunrise Coffee" (used for display)
2. **Slug** — e.g., "sunrise-coffee" (used for repo name, subdomain). Suggest one from the name.
3. **Domain** — e.g., "sunrisecoffee.com" (production domain, optional — can be added later)
4. **Template** — What kind of project? Options:
   - `nextjs` — Next.js with Tailwind (default for client websites)
   - `astro` — Astro static site
   - `empty` — Empty repo, manual setup

## Process

### 1. Create GitHub Repo

```bash
gh repo create freebeerstudio/{slug} --private --description "{name} — Free Beer Studio client project" --clone
```

If a template was selected, initialize it:

For `nextjs`:
```bash
cd {slug}
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-git
```

For `astro`:
```bash
cd {slug}
npm create astro@latest -- . --template minimal --typescript strict --install --no-git
```

Then:
```bash
git add -A
git commit -m "Initial scaffold — {name}"
git push -u origin main
```

### 2. Create Vercel Project

```bash
cd {slug}
vercel link --yes
vercel --prod
```

Capture the production URL from the output.

### 3. Create Staging Branch

```bash
git checkout -b staging
git push -u origin staging
git checkout main
```

Vercel will auto-create a preview deployment for the staging branch.

### 4. Configure DNS (if domain provided)

If {{OWNER}} provided a production domain:

```bash
# Add production domain to Vercel
vercel domains add {domain}
```

Tell {{OWNER}} the DNS records they need to add at their registrar:
- `A` record: `76.76.21.21`
- `CNAME` for `www`: `cname.vercel-dns.com`

For staging subdomain (staging.{domain}):
- This is handled automatically by Vercel preview deployments

### 5. Update Project Record

Use `update_project` to store the infrastructure details:

```
infrastructure: {
  repo_url: "https://github.com/freebeerstudio/{slug}",
  vercel_project: "{slug}",
  production_url: "{vercel production URL}",
  staging_url: "{vercel preview URL}",
  domain: "{domain}" (if provided)
}
```

If the project doesn't exist in the database yet, create it first with `create_project`, including the North Star and guardrails that {{OWNER}} defines.

### 6. Summary

Output a clean summary:

```
Project: {name}
GitHub: https://github.com/freebeerstudio/{slug}
Production: {production URL}
Staging: {staging URL}
Domain: {domain or "not configured yet"}

Next steps:
- Start building in the repo
- Run `hughmann refine` to plan the first sprint
```

## Key Behaviors

- Always create repos under the `freebeerstudio` GitHub org
- Repos are private by default (client work)
- Main branch = production, staging branch = preview
- Don't configure DNS unless {{OWNER}} provides a domain — they may not have it yet
- If any step fails, report the error and continue with the remaining steps
- Store all infrastructure URLs in the project record so Hugh can track deployment state
