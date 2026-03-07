/**
 * gmail-classifier.ts — Haiku classification for Gmail emails.
 *
 * Uses Haiku via OpenRouter (direct fetch) to classify emails into
 * categories defined in ~/.hughmann/email/categories.json.
 *
 * Two modes:
 * - Discovery: open-ended classification (proposes new categories)
 * - Fixed: constrained to a predefined category list
 */

import type { EmailCategory } from './gmail-categories.js'

export interface GmailClassification {
  category: string
  confidence: number
  summary: string
}

export interface DiscoveryClassification {
  proposed_category: string
  reasoning: string
  summary: string
}

const MAX_BODY_CHARS = 12_000

export function buildDiscoveryPrompt(): string {
  return `You are an email classifier for a small business owner. Analyze this email and propose a category.

Return ONLY a JSON object (no markdown fences, no extra text):
{
  "proposed_category": "<short kebab-case category name, e.g. billing, newsletter, personal>",
  "reasoning": "<one sentence explaining why this category fits>",
  "summary": "<one sentence summary of the email>"
}

Rules:
- Category names should be short, lowercase, kebab-case
- Be specific but not too granular (e.g. "billing" not "vercel-invoice")
- Common categories: billing, newsletter, personal, saas-notification, shipping, social, marketing, transactional, unwanted`
}

export function buildClassificationPrompt(categories: EmailCategory[]): string {
  const categoryList = categories
    .map(c => `- ${c.name}: ${c.description}`)
    .join('\n')

  return `You are an email classifier. Classify this email into one of these categories:

${categoryList}

Return ONLY a JSON object (no markdown fences, no extra text):
{
  "category": "<one of the categories listed above>",
  "confidence": <0.0 to 1.0>,
  "summary": "<one sentence summary of the email>"
}

Rules:
- Choose the single best-fitting category
- If none fit well, use "unclassified"
- confidence should reflect how well the email fits the chosen category`
}

function formatEmailForClassification(email: {
  sender: string
  subject: string
  date: string
  snippet?: string
  body?: string
}): string {
  const body = email.body ?? email.snippet ?? ''
  const truncated = body.length > MAX_BODY_CHARS
    ? body.slice(0, MAX_BODY_CHARS) + '\n[... truncated ...]'
    : body

  return `From: ${email.sender}
Subject: ${email.subject}
Date: ${email.date}

${truncated}`
}

export async function classifyGmail(
  apiKey: string,
  systemPrompt: string,
  email: { sender: string; subject: string; date: string; snippet?: string; body?: string },
): Promise<GmailClassification> {
  const userContent = formatEmailForClassification(email)

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      max_tokens: 500,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
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
  if (!raw) throw new Error('Empty LLM response')

  return parseClassificationResponse(raw)
}

export async function discoverGmail(
  apiKey: string,
  email: { sender: string; subject: string; date: string; snippet?: string; body?: string },
): Promise<DiscoveryClassification> {
  const userContent = formatEmailForClassification(email)

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4-5',
      max_tokens: 500,
      temperature: 0,
      messages: [
        { role: 'system', content: buildDiscoveryPrompt() },
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
  if (!raw) throw new Error('Empty LLM response')

  return parseDiscoveryResponse(raw)
}

export function parseClassificationResponse(raw: string): GmailClassification {
  try {
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(jsonStr)
    return {
      category: parsed.category || 'unclassified',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      summary: parsed.summary || '',
    }
  } catch {
    return { category: 'unclassified', confidence: 0, summary: '' }
  }
}

function parseDiscoveryResponse(raw: string): DiscoveryClassification {
  try {
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(jsonStr)
    return {
      proposed_category: parsed.proposed_category || 'other',
      reasoning: parsed.reasoning || '',
      summary: parsed.summary || '',
    }
  } catch {
    return { proposed_category: 'other', reasoning: 'Parse error', summary: '' }
  }
}
