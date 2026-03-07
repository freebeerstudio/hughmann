import { describe, it, expect } from 'vitest'
import { buildClassificationPrompt, buildDiscoveryPrompt, parseClassificationResponse } from '../src/mail/gmail-classifier.js'

describe('gmail-classifier', () => {
  describe('buildClassificationPrompt', () => {
    it('builds a constrained prompt with category list', () => {
      const categories = [
        { name: 'billing', description: 'Invoices' },
        { name: 'newsletter', description: 'Newsletters' },
      ]
      const prompt = buildClassificationPrompt(categories)
      expect(prompt).toContain('billing')
      expect(prompt).toContain('newsletter')
      expect(prompt).toContain('Classify this email')
    })
  })

  describe('buildDiscoveryPrompt', () => {
    it('builds an open-ended discovery prompt', () => {
      const prompt = buildDiscoveryPrompt()
      expect(prompt).toContain('category')
      expect(prompt).not.toContain('Choose from')
    })
  })

  describe('parseClassificationResponse', () => {
    it('parses valid JSON response', () => {
      const raw = '{"category": "billing", "confidence": 0.95, "summary": "Invoice from Vercel"}'
      const result = parseClassificationResponse(raw)
      expect(result.category).toBe('billing')
      expect(result.confidence).toBe(0.95)
      expect(result.summary).toBe('Invoice from Vercel')
    })

    it('handles markdown-wrapped JSON', () => {
      const raw = '```json\n{"category": "billing", "confidence": 0.9, "summary": "test"}\n```'
      const result = parseClassificationResponse(raw)
      expect(result.category).toBe('billing')
    })

    it('returns unclassified on parse failure', () => {
      const result = parseClassificationResponse('not json at all')
      expect(result.category).toBe('unclassified')
      expect(result.confidence).toBe(0)
    })
  })
})
