import { describe, it, expect } from 'vitest'
import { cosineSimilarity } from '../src/util/math.js'

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
  })

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
  })

  it('handles typical embedding vectors', () => {
    const a = [0.1, 0.2, 0.3, 0.4]
    const b = [0.1, 0.2, 0.3, 0.4]
    expect(cosineSimilarity(a, b)).toBeCloseTo(1)
  })

  it('returns fractional similarity for partially similar vectors', () => {
    const sim = cosineSimilarity([1, 1, 0], [1, 0, 0])
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThan(1)
  })
})
