# ChiefOfStaff / HughMann — Backlog

Items deferred from Phase 3 and identified during development.

## ~~Domain Filtering~~ (DONE — Phase 4A)
**Completed:** WorkView, MonthPlanView, QuarterPlanView, YearPlanView all filter by active domain.

## ~~Smart Notes Pipeline~~ (DONE — Phase 4B)
**Completed:** Claude Haiku classifies notes, associates customer notes via fuzzy name lookup.

## ~~Multi-Note Today Tab~~ (DONE — Phase 4A)
**Completed:** SwiftData Note model, NoteEditorSheet, domain-filtered note list, Supabase sync.

## ~~Calendar Integration~~ (DONE — Phase 4C)
**Completed:** calendar_events table, CalendarSyncService, dual-source display, MeetingDetailSheet.

## ~~Elle Calendar Sync~~ (DONE)
**Completed:** `hughmann calendar sync` CLI command, cron job on Elle every 30 min.

## ~~Autonomous Refinement with Approval Gate~~ (DONE — Phase 4D)
**Completed:** approval_mode, auto-refine skill, approval bundles, daemon trigger, Trigger.dev lifecycle, iOS UI.

## ~~Project Lifecycle Management~~ (DONE — Phase 4D)
**Completed:** register_project, provision_project, Claude Code dispatch, infrastructure fields.

## ~~Push Notification Infrastructure~~ (DONE)
**Completed:** APNs edge function, device token table, notification templates, approval_request category wired to bundle creation. Needs APNs key configured in Supabase secrets.

## ~~Audio Note Transcription~~ (DONE)
**Completed:** AudioRecorderService (AVAudioRecorder), TranscriptionService (Supabase Storage + Whisper), AudioNoteButton in TodayView, transcribe-audio edge function. Needs audio-notes Storage bucket and OPENAI_API_KEY secret.

## ~~Realtime Supabase Subscriptions~~ (DONE)
**Completed:** RealtimeService singleton, subscribes to tasks/approval_bundles/calendar_events, NotificationCenter-based view refresh in WorkView and TodayView.

## ~~iPad Two-Column Layout~~ (DONE)
**Completed:** NavigationSplitView for WorkView on iPad (horizontalSizeClass == .regular), sidebar with goals + approvals, detail pane with selected goal's projects.

## ~~Project Directory Migration~~ (DONE)
**Completed:** `hughmann projects migrate` CLI command, searches common directories, moves or symlinks to ~/Projects/{domain}/{slug}/, updates DB with stack/git/CLAUDE.md detection.

## Remaining Items

### Deployment Prerequisites
- **APNs Key**: Generate .p8 key in Apple Developer Portal, set `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY` as Supabase secrets
- **Audio Storage**: Create `audio-notes` bucket in Supabase Storage dashboard
- **OpenAI Key**: Set `OPENAI_API_KEY` as Supabase secret for Whisper transcription
- **Edge Function Deploy**: `supabase functions deploy transcribe-audio`
- **Microphone Permission**: Add `NSMicrophoneUsageDescription` to Info.plist if not present

### Future Enhancements
- Handoff support verification with new views
- Daily use rough edge fixes
- Richer notification categories (meeting prep, task overdue, weekly review)
- Offline-first sync with conflict resolution
