/**
 * Mail module — Public API
 *
 * Processes emails from Apple Mail's Elle mailbox, classifies with Haiku,
 * and writes structured markdown to the Omnissa vault _inbox/ folder.
 */

export { runMailPipeline, getMailStatus, resolveVaultInboxPath, generateMailMarkdown } from './mail-processor.js'
export { findElleMailbox, listMessages, readFullMessage, clearMailboxCache } from './mail-reader.js'
export { classifyEmail } from './mail-classifier.js'
export type { MailPipelineOptions, MailPipelineResult } from './mail-processor.js'
export type { ClassifiedEmail } from './mail-classifier.js'
export type { MailboxRef, MessageSummary, FullMessage } from './mail-reader.js'
