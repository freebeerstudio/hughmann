/**
 * CLI handler for Gmail email operations.
 * Used by skills via Bash to classify individual emails.
 */

import { classifyGmail, discoverGmail, buildClassificationPrompt } from './gmail-classifier.js'
import { loadCategories } from './gmail-categories.js'

export async function handleGmailClassify(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY')
    process.exit(1)
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim()
  if (!input) {
    console.error('No input on stdin')
    process.exit(1)
  }

  const email = JSON.parse(input) as {
    sender: string
    subject: string
    date: string
    snippet?: string
    body?: string
  }

  const categories = loadCategories()
  const prompt = buildClassificationPrompt(categories)
  const result = await classifyGmail(apiKey, prompt, email)
  console.log(JSON.stringify(result))
}

export async function handleGmailDiscover(): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error('Missing OPENROUTER_API_KEY')
    process.exit(1)
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  const input = Buffer.concat(chunks).toString('utf-8').trim()
  if (!input) {
    console.error('No input on stdin')
    process.exit(1)
  }

  const email = JSON.parse(input)
  const result = await discoverGmail(apiKey, email)
  console.log(JSON.stringify(result))
}
