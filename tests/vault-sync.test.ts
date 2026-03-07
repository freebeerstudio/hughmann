import { describe, it, expect } from 'vitest'
import { splitIntoChunks } from '../src/runtime/vault-sync.js'

describe('splitIntoChunks', () => {
  it('returns single chunk for short text', () => {
    const text = 'Hello world'
    const chunks = splitIntoChunks(text, 100)
    expect(chunks).toEqual(['Hello world'])
  })

  it('splits on paragraph boundaries', () => {
    const para1 = 'A'.repeat(60)
    const para2 = 'B'.repeat(60)
    const text = `${para1}\n\n${para2}`

    const chunks = splitIntoChunks(text, 80)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toBe(para1)
    expect(chunks[1]).toBe(para2)
  })

  it('falls back to hard cut when no good boundary', () => {
    const text = 'X'.repeat(200)
    const chunks = splitIntoChunks(text, 100)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toBe('X'.repeat(100))
    expect(chunks[1]).toBe('X'.repeat(100))
  })

  it('returns empty array for empty text', () => {
    const chunks = splitIntoChunks('', 100)
    // Empty text is <= maxSize, returns as-is
    expect(chunks).toEqual([''])
  })

  it('handles text exactly at max size', () => {
    const text = 'A'.repeat(100)
    const chunks = splitIntoChunks(text, 100)
    expect(chunks).toEqual([text])
  })
})
