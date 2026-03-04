/**
 * mail-classifier.ts — LLM classification for Elle mailbox emails.
 *
 * Uses Haiku via OpenRouter (direct fetch, no openai package) to classify
 * emails and extract structured data.
 *
 * Ported from Foundry's elle-classifier.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassifiedEmail {
  type: string
  subject_slug: string
  summary: string
  key_points: string[]
  contacts: Array<{ name: string; email: string; role: string }>
  action_items: string[]
  customer_hint: string
  case_id: string | null
  severity: string | null
  product_hint: string | null
  events: Array<{
    title: string
    date: string
    registration_url: string
    details: string
  }>
}

// ---------------------------------------------------------------------------
// Classification prompt
// ---------------------------------------------------------------------------

const CLASSIFICATION_PROMPT = `You are an email classifier for a Sales Engineer at Omnissa (Workspace ONE, Horizon, Access, DEX, App Volumes). Classify the email and extract structured data.

## Classification Types
- support: SEV/severity mentions, CASE- or SR- numbers, Salesforce links, escalation threads, technical troubleshooting
- customer: From customer domain, questions, requests, correspondence, POC updates
- product-release: Release notes, availability announcements, end of life notices, version numbers, what's new
- meeting: Calendar invites, agendas, minutes, follow-ups, scheduling
- internal: Team updates, win wires, forecasts, org announcements, territory news
- newsletter: Regular newsletter format, digests, curated content roundups
- noise: Automated notifications with zero actionable content, OOO replies, read receipts, spam
- other: Anything that doesn't clearly fit above — still process it fully

## Output Format
Return ONLY a JSON object (no markdown fences, no extra text):
{
  "type": "<one of: support, customer, product-release, meeting, internal, newsletter, noise, other>",
  "subject_slug": "<kebab-case-brief-subject, max 60 chars>",
  "summary": "<2-3 sentence summary>",
  "key_points": ["<3-7 bullet points of important info>"],
  "contacts": [{"name": "...", "email": "...", "role": "..."}],
  "action_items": ["<genuinely actionable items only, empty array if none>"],
  "customer_hint": "<best guess at customer name, empty string if unclear>",
  "case_id": "<CASE-XXXXX or SR number if present, null otherwise>",
  "severity": "<SEV1/SEV2/etc if mentioned, null otherwise>",
  "product_hint": "<primary product mentioned if any, null otherwise>",
  "events": [{"title": "...", "date": "...", "registration_url": "...", "details": "..."}]
}

Rules:
- subject_slug should be descriptive but concise (e.g. "osumc-epic-half-screen", "horizon-saml-fix")
- For contacts, extract everyone mentioned with name/email/role when available
- action_items should only contain things someone needs to DO, not informational points
- customer_hint should be the organization name, not individual names
- If unsure about type, use "other" — never drop an email`

const MAX_BODY_CHARS = 12_000

// ---------------------------------------------------------------------------
// classifyEmail — direct fetch to OpenRouter
// ---------------------------------------------------------------------------

export async function classifyEmail(
  apiKey: string,
  email: { sender: string; subject: string; date: string; recipients: string; body: string },
): Promise<ClassifiedEmail> {
  const truncatedBody =
    email.body.length > MAX_BODY_CHARS
      ? email.body.slice(0, MAX_BODY_CHARS) + '\n\n[... truncated for classification ...]'
      : email.body

  const userContent = `From: ${email.sender}
Subject: ${email.subject}
Date: ${email.date}
To: ${email.recipients}

${truncatedBody}`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      max_tokens: 1500,
      temperature: 0,
      messages: [
        { role: 'system', content: CLASSIFICATION_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) {
    throw new Error('Empty LLM response')
  }

  // Parse JSON — handle markdown code fences if present
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
  const parsed = JSON.parse(jsonStr)

  return {
    type: parsed.type || 'other',
    subject_slug: sanitizeSlug(parsed.subject_slug || 'unknown'),
    summary: parsed.summary || '',
    key_points: Array.isArray(parsed.key_points) ? parsed.key_points : [],
    contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
    action_items: Array.isArray(parsed.action_items) ? parsed.action_items : [],
    customer_hint: parsed.customer_hint || '',
    case_id: parsed.case_id || null,
    severity: parsed.severity || null,
    product_hint: parsed.product_hint || null,
    events: Array.isArray(parsed.events) ? parsed.events : [],
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60)
}

export function sanitizeSlugFallback(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60)
}
