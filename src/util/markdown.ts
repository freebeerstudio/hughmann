import pc from 'picocolors'

/** Strip ANSI escape codes to get visible character count */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/** Get terminal width, with a sensible fallback */
function getTermWidth(): number {
  return process.stdout.columns || 100
}

/**
 * Word-wrap a rendered line (may contain ANSI codes) to fit terminal width.
 * Uses `indent` for the first line and `hangIndent` for continuation lines.
 */
function wordWrap(line: string, indent: string, hangIndent: string): string[] {
  const maxWidth = getTermWidth() - 2 // small right margin
  const visibleLen = stripAnsi(indent).length

  // If it fits, return as-is
  if (stripAnsi(indent + line).length <= maxWidth) {
    return [indent + line]
  }

  // Split on word boundaries, preserving ANSI codes attached to words
  const words = line.split(/( +)/).filter(Boolean)
  const lines: string[] = []
  let current = indent
  let currentVisible = visibleLen

  for (const word of words) {
    const wordVisible = stripAnsi(word).length
    if (currentVisible + wordVisible > maxWidth && currentVisible > stripAnsi(hangIndent).length) {
      // Wrap: push current line, start new one with hang indent
      lines.push(current)
      current = hangIndent
      currentVisible = stripAnsi(hangIndent).length
      // Skip leading whitespace on wrapped line
      if (word.trim() === '') continue
    }
    current += word
    currentVisible += wordVisible
  }

  if (currentVisible > stripAnsi(hangIndent).length) {
    lines.push(current)
  }

  return lines
}

const INDENT = '    '  // 4-space indent for all chat output

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
        out.push(INDENT + pc.dim('┌──') + label)
      } else {
        inCodeBlock = false
        codeLang = ''
        out.push(INDENT + pc.dim('└──'))
      }
      continue
    }

    if (inCodeBlock) {
      // Code blocks: no word wrap, just indent
      out.push(INDENT + pc.dim('│ ') + pc.cyan(line))
      continue
    }

    // Horizontal rule
    if (/^---+$|^\*\*\*+$|^___+$/.test(line.trim())) {
      out.push(INDENT + pc.dim('─────────────────────────────────'))
      continue
    }

    // Headers
    const h1 = line.match(/^# (.+)/)
    if (h1) {
      out.push('')
      out.push(INDENT + pc.bold(pc.underline(h1[1])))
      out.push('')
      continue
    }

    const h2 = line.match(/^## (.+)/)
    if (h2) {
      out.push('')
      out.push(INDENT + pc.bold(h2[1]))
      continue
    }

    const h3 = line.match(/^### (.+)/)
    if (h3) {
      out.push(INDENT + pc.bold(pc.dim(h3[1])))
      continue
    }

    const h4 = line.match(/^#{4,} (.+)/)
    if (h4) {
      out.push(INDENT + pc.dim(pc.bold(h4[1])))
      continue
    }

    // Unordered list items
    const ul = line.match(/^(\s*)([-*+])\s+(.+)/)
    if (ul) {
      const extraIndent = ul[1]
      const content = renderInline(ul[3])
      const prefix = INDENT + extraIndent + '\u2022 '
      const hang = INDENT + extraIndent + '  '
      out.push(...wordWrap(content, prefix, hang))
      continue
    }

    // Ordered list items
    const ol = line.match(/^(\s*)(\d+)\.\s+(.+)/)
    if (ol) {
      const extraIndent = ol[1]
      const num = ol[2]
      const content = renderInline(ol[3])
      const prefix = INDENT + extraIndent + pc.dim(num + '.') + ' '
      const hang = INDENT + extraIndent + '   '
      out.push(...wordWrap(content, prefix, hang))
      continue
    }

    // Blockquote
    const bq = line.match(/^>\s?(.*)/)
    if (bq) {
      const prefix = INDENT + pc.dim('\u2502 ')
      out.push(...wordWrap(pc.italic(renderInline(bq[1])), prefix, prefix))
      continue
    }

    // Empty line
    if (line.trim() === '') {
      out.push('')
      continue
    }

    // Regular line — word wrap with indent
    out.push(...wordWrap(renderInline(line), INDENT, INDENT))
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
