/**
 * gmail-categories.ts — Email category config for Gmail classification.
 *
 * Loads/saves category definitions from ~/.hughmann/email/categories.json.
 * Categories drive the classifier prompt and Gmail label names.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../config.js'

export interface EmailCategory {
  name: string
  description: string
}

const CONFIG_DIR = join(HUGHMANN_HOME, 'email')
const CONFIG_PATH = join(CONFIG_DIR, 'categories.json')

const REQUIRED_CATEGORIES: EmailCategory[] = [
  { name: 'unwanted', description: 'Junk, spam, marketing noise that passed Gmail filters' },
  { name: 'unclassified', description: 'Model not confident, needs manual review' },
]

export const DEFAULT_CATEGORIES: EmailCategory[] = [...REQUIRED_CATEGORIES]

export function loadCategories(): EmailCategory[] {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CATEGORIES

  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    const cats: EmailCategory[] = Array.isArray(raw.categories) ? raw.categories : []

    for (const req of REQUIRED_CATEGORIES) {
      if (!cats.find(c => c.name === req.name)) {
        cats.push(req)
      }
    }
    return cats
  } catch {
    return DEFAULT_CATEGORIES
  }
}

export function saveCategories(categories: EmailCategory[]): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify({ categories }, null, 2), 'utf-8')
}

export function categoryNames(categories: EmailCategory[]): string[] {
  return categories.map(c => c.name)
}
