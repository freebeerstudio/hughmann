# ChiefOfStaff / HughMann — Backlog

Items deferred from Phase 3 and identified during development.

## ~~Domain Filtering~~ (DONE — Phase 4A)
Wire `activeDomain` into all HughMann-backed views so the domain switcher actually filters content.
**Completed:** WorkView, MonthPlanView, QuarterPlanView, YearPlanView all filter by active domain. WeekPlanView already filtered via PlanningService.

## ~~Smart Notes Pipeline~~ (DONE — Phase 4B)
Route notes from iOS Today tab into the knowledge base with proper classification.
**Completed:** Claude Haiku classifies notes (customer/project/personal/meeting), associates customer notes via fuzzy name lookup, updates metadata JSONB. Fire-and-forget in memory-api edge function.

## ~~Multi-Note Today Tab~~ (DONE — Phase 4A)
Replace single-note field with scrollable note list.
**Completed:** SwiftData `Note` model, NoteEditorSheet with tag picker, domain-filtered note list, background Supabase sync via NoteService.

## ~~Calendar Integration~~ (DONE — Phase 4C)
Connect iOS app to HughMann's calendar data.
**Completed:** `calendar_events` Supabase table, CalendarSyncService (iOS), dual-source display (EventKit + Supabase), MeetingDetailSheet with notes, DataAdapter methods in all three adapters. Elle sync script pending.

## ~~Autonomous Refinement with Approval Gate~~ (DONE — Phase 4D)
Hugh runs refinements autonomously with per-project approval gating.
**Completed:** `approval_mode` field on projects (`required`/`auto_proceed`/`notify_only`), `auto-refine` skill, approval bundles table + 3 internal tools, daemon auto-refine trigger with hourly throttle, `approval-lifecycle` Trigger.dev task, iOS approval bundle UI in WorkView.

## ~~Project Lifecycle Management~~ (DONE — Phase 4D)
Centralize projects with registration, provisioning, and Claude Code dispatch.
**Completed:** `register_project` tool (scans directory, detects stack/git/CLAUDE.md), `provision_project` tool (creates dir/git/repo/CLAUDE.md), Claude Code dispatch in daemon for project-scoped tasks, new fields on projects (`local_path`, `stack`, `claude_md_exists`).

## Remaining Items

### Push Notification Infrastructure
- APNs setup for iOS approval bundle notifications
- Trigger.dev or Supabase push delivery
- Depends on: Apple Developer certificate setup

### Elle Calendar Sync Script
- Script on Elle's Mac to scrape Omnissa calendar → upsert to `calendar_events` table
- Depends on: Elle's calendar access method (Apple Mail scrape, CalDAV, or Google Calendar)

### Audio Note Transcription
- Upload audio → Supabase Storage → Trigger.dev task → Whisper API → transcript → classify + route
- Extends the Smart Notes Pipeline

### Other Items
- Realtime Supabase subscriptions for live updates across views
- iPad two-column layout for Work tab
- Handoff support verification with new views
- Daily use rough edge fixes
- Migration script to move existing projects into `~/Projects/` structure
