import pc from 'picocolors'

/**
 * Render markdown to ANSI-styled terminal output.
 * Handles: headers, bold, italic, inline code, code blocks, lists, HRs, links.
 */
export function renderMarkdown(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inCodeBlock = false
  let codeLang = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block toggle
    if (line.trimStart().startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = line.trimStart().slice(3).trim()
        const label = codeLang ? pc.dim(` ${codeLang}`) : ''
        out.push(pc.dim('  ┌──') + label)
      } else {
        inCodeBlock = false
        codeLang = ''
        out.push(pc.dim('  └──'))
      }
      continue
    }

    if (inCodeBlock) {
      out.push(pc.dim('  │ ') + pc.cyan(line))
      continue
    }

    // Horizontal rule
    if (/^---+$|^\*\*\*+$|^___+$/.test(line.trim())) {
      out.push(pc.dim('  ─────────────────────────────────'))
      continue
    }

    // Headers
    const h1 = line.match(/^# (.+)/)
    if (h1) {
      out.push('')
      out.push(pc.bold(pc.underline(h1[1])))
      out.push('')
      continue
    }

    const h2 = line.match(/^## (.+)/)
    if (h2) {
      out.push('')
      out.push(pc.bold(h2[1]))
      continue
    }

    const h3 = line.match(/^### (.+)/)
    if (h3) {
      out.push(pc.bold(pc.dim(h3[1])))
      continue
    }

    const h4 = line.match(/^#{4,} (.+)/)
    if (h4) {
      out.push(pc.dim(pc.bold(h4[1])))
      continue
    }

    // Unordered list items
    const ul = line.match(/^(\s*)([-*+])\s+(.+)/)
    if (ul) {
      const indent = ul[1]
      const content = renderInline(ul[3])
      out.push(`${indent}  \u2022 ${content}`)
      continue
    }

    // Ordered list items
    const ol = line.match(/^(\s*)(\d+)\.\s+(.+)/)
    if (ol) {
      const indent = ol[1]
      const num = ol[2]
      const content = renderInline(ol[3])
      out.push(`${indent}  ${pc.dim(num + '.')} ${content}`)
      continue
    }

    // Blockquote
    const bq = line.match(/^>\s?(.*)/)
    if (bq) {
      out.push(pc.dim('  \u2502 ') + pc.italic(renderInline(bq[1])))
      continue
    }

    // Regular line
    out.push(renderInline(line))
  }

  return out.join('\n')
}

/**
 * Render inline markdown: bold, italic, code, links, strikethrough
 */
function renderInline(text: string): string {
  // Inline code (must be before bold/italic to avoid conflicts)
  text = text.replace(/`([^`]+)`/g, (_, code) => pc.cyan(code))

  // Bold + italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, (_, content) => pc.bold(pc.italic(content)))

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, (_, content) => pc.bold(content))

  // Italic
  text = text.replace(/\*(.+?)\*/g, (_, content) => pc.italic(content))
  text = text.replace(/_(.+?)_/g, (_, content) => pc.italic(content))

  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, (_, content) => pc.strikethrough(content))

  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) =>
    `${pc.underline(pc.blue(linkText))} ${pc.dim(`(${url})`)}`
  )

  return text
}

/**
 * Stream-compatible markdown renderer.
 * Buffers lines and renders complete ones, flushing partial lines on done.
 */
export class StreamMarkdownRenderer {
  private buffer = ''

  /** Feed a chunk of text. Returns rendered lines ready to output. */
  feed(chunk: string): string {
    this.buffer += chunk
    const lines = this.buffer.split('\n')

    // Keep the last (potentially incomplete) line in the buffer
    this.buffer = lines.pop() ?? ''

    if (lines.length === 0) return ''

    // Render complete lines
    return lines.map(line => renderMarkdown(line)).join('\n') + '\n'
  }

  /** Flush any remaining buffered content. */
  flush(): string {
    if (!this.buffer) return ''
    const rendered = renderMarkdown(this.buffer)
    this.buffer = ''
    return rendered
  }
}
