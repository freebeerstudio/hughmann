/**
 * mail-reader.ts — Read emails from a target mailbox in Apple Mail.
 *
 * Ported from Foundry's elle-mail-reader.ts.
 *
 * - findElleMailbox() — recursive two-pass search across Exchange account
 * - listMessages()    — structured list with RFC message IDs
 * - readFullMessage()  — complete body with no truncation
 */

import { runAppleScript } from './applescript.js'

const FIELD_DELIMITER = '|||'

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

function getAccountName(): string {
  return process.env.MAIL_ACCOUNT ?? 'Exchange'
}

function getMailboxName(): string {
  return process.env.MAIL_MAILBOX ?? 'Elle'
}

// ---------------------------------------------------------------------------
// findElleMailbox
// ---------------------------------------------------------------------------

export interface MailboxRef {
  account: string
  /** Full AppleScript reference, e.g. 'mailbox "Elle" of mailbox "Inbox" of account "Exchange"' */
  ref: string
}

let cachedRef: MailboxRef | null = null

export async function findElleMailbox(): Promise<MailboxRef | null> {
  if (cachedRef) return cachedRef

  const mboxName = getMailboxName()

  // Search nested sub-mailboxes FIRST (Inbox/Elle), then top-level as fallback.
  const script = `
tell application "Mail"
  set accts to every account
  -- Pass 1: check sub-mailboxes (nested folders like Inbox/${mboxName})
  repeat with a in accts
    set aName to name of a
    set mboxes to every mailbox of a
    repeat with mb in mboxes
      set subBoxes to every mailbox of mb
      repeat with sub in subBoxes
        if name of sub is "${mboxName}" then
          set mc to count of messages of sub
          if mc > 0 then
            return "mailbox \\"${mboxName}\\" of mailbox \\"" & (name of mb) & "\\" of account \\"" & aName & "\\"" & "${FIELD_DELIMITER}" & aName
          end if
        end if
      end repeat
    end repeat
  end repeat
  -- Pass 2: check top-level mailboxes as fallback
  repeat with a in accts
    set aName to name of a
    set mboxes to every mailbox of a
    repeat with mb in mboxes
      if name of mb is "${mboxName}" then
        set mc to count of messages of mb
        if mc > 0 then
          return "mailbox \\"${mboxName}\\" of account \\"" & aName & "\\"" & "${FIELD_DELIMITER}" & aName
        end if
      end if
    end repeat
  end repeat
  return ""
end tell`

  const result = await runAppleScript(script, { timeout: 30_000 })
  if (!result) return null

  const parts = result.split(FIELD_DELIMITER)
  if (parts.length < 2) return null

  cachedRef = {
    ref: parts[0].trim(),
    account: parts[1].trim(),
  }
  return cachedRef
}

/** Clear the cached mailbox reference (useful for testing). */
export function clearMailboxCache(): void {
  cachedRef = null
}

// ---------------------------------------------------------------------------
// listMessages
// ---------------------------------------------------------------------------

export interface MessageSummary {
  index: number
  messageId: string
  sender: string
  subject: string
  date: string
  isRead: boolean
}

export async function listMessages(
  mailboxRef: string,
  limit: number = 100,
): Promise<MessageSummary[]> {
  const script = `
tell application "Mail"
  set mbox to ${mailboxRef}
  set msgCount to count of messages of mbox
  set maxCount to ${limit}
  if msgCount < maxCount then set maxCount to msgCount
  set output to ""
  repeat with i from 1 to maxCount
    set m to message i of mbox
    set msgId to message id of m
    set subj to subject of m
    set sndr to sender of m
    set dt to date received of m
    set isRead to read status of m
    set readLabel to "false"
    if isRead then set readLabel to "true"
    set output to output & i & "${FIELD_DELIMITER}" & msgId & "${FIELD_DELIMITER}" & sndr & "${FIELD_DELIMITER}" & subj & "${FIELD_DELIMITER}" & (dt as string) & "${FIELD_DELIMITER}" & readLabel & linefeed
  end repeat
  return output
end tell`

  const result = await runAppleScript(script, { timeout: 60_000 })
  if (!result) return []

  const messages: MessageSummary[] = []
  for (const line of result.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split(FIELD_DELIMITER)
    if (parts.length < 6) continue

    messages.push({
      index: parseInt(parts[0], 10),
      messageId: parts[1].trim(),
      sender: parts[2].trim(),
      subject: parts[3].trim(),
      date: parts[4].trim(),
      isRead: parts[5].trim() === 'true',
    })
  }

  return messages
}

// ---------------------------------------------------------------------------
// readFullMessage
// ---------------------------------------------------------------------------

export interface FullMessage {
  sender: string
  subject: string
  date: string
  recipients: string
  body: string
}

export async function readFullMessage(
  mailboxRef: string,
  index: number,
): Promise<FullMessage> {
  const script = `
tell application "Mail"
  set m to message ${index} of ${mailboxRef}
  set subj to subject of m
  set sndr to sender of m
  set dt to date received of m
  set body to content of m
  set recips to ""
  try
    set toRecips to to recipients of m
    repeat with r in toRecips
      set recips to recips & (address of r) & ", "
    end repeat
  end try
  return sndr & "${FIELD_DELIMITER}" & subj & "${FIELD_DELIMITER}" & (dt as string) & "${FIELD_DELIMITER}" & recips & "${FIELD_DELIMITER}" & body
end tell`

  const result = await runAppleScript(script, {
    timeout: 60_000,
    maxBuffer: 5 * 1024 * 1024,
  })

  const delimIdx: number[] = []
  let searchFrom = 0
  for (let i = 0; i < 4; i++) {
    const idx = result.indexOf(FIELD_DELIMITER, searchFrom)
    if (idx === -1) throw new Error(`Failed to parse message ${index}: missing delimiter ${i}`)
    delimIdx.push(idx)
    searchFrom = idx + FIELD_DELIMITER.length
  }

  return {
    sender: result.slice(0, delimIdx[0]).trim(),
    subject: result.slice(delimIdx[0] + FIELD_DELIMITER.length, delimIdx[1]).trim(),
    date: result.slice(delimIdx[1] + FIELD_DELIMITER.length, delimIdx[2]).trim(),
    recipients: result.slice(delimIdx[2] + FIELD_DELIMITER.length, delimIdx[3]).trim(),
    body: result.slice(delimIdx[3] + FIELD_DELIMITER.length),
  }
}
