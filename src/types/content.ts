/**
 * Content pipeline types for HughMann content creation and publishing.
 */

export type ContentStatus = 'idea' | 'drafting' | 'review' | 'approved' | 'scheduled' | 'published' | 'rejected'

export type ContentPlatform = 'blog' | 'linkedin' | 'x' | 'newsletter' | 'youtube' | 'shorts'

export type ContentSourceType = 'rss' | 'youtube' | 'newsletter' | 'manual'

export interface ContentPiece {
  id: string
  domain: string
  topic_id: string | null
  project_id: string | null
  title: string
  status: ContentStatus
  platform: ContentPlatform
  body: string | null
  source_material: { url: string; title: string; summary: string }[]
  scheduled_at: string | null
  published_at: string | null
  published_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Topic {
  id: string
  domain: string
  name: string
  description: string | null
  active: boolean
  created_at: string
}

export interface ContentSource {
  id: string
  domain: string
  name: string
  type: ContentSourceType
  url: string | null
  active: boolean
  created_at: string
}
