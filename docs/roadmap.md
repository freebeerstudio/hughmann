# HughMann Product Roadmap

Items ordered by expected build time, lowest to highest.

## Completed

| # | Item | Commit |
|---|------|--------|
| 1 | Generalize all hardcoded references | `2d72f66` |
| 2 | Publish to npm as `create-hughmann` | `0864e65` |
| 3 | `.env.example` and first-run docs | `0bf5992` |
| 4 | Basic test suite + bug fixes | `bfa2d12` |
| 5 | Structured progress log | `bc108cb` |
| 6 | Checkpointing and crash recovery | `1c2125a` |
| 7 | SQLite vector search (sqlite-vec) | `be3524a` |
| 8 | E2E / integration tests | `b290c2c` |
| 9 | Capability auto-install | `2b95475` |
| 10 | Learning from feedback | `64f23dd` |
| 11 | Proactive agent loop | `5a9ca82` |
| 12 | Web dashboard (read-only) | `b97bed3` |
| 13 | Unified cloud/local runtime | `939761c` |
| 14 | Skill marketplace / sharing | `4cc2760` |
| 15 | Multi-agent orchestration | `a7014f2` |
| 16 | Plugin system | `23f4ab3` |

## ChiefOfStaff iOS Phases

| Phase | Items | Status |
|-------|-------|--------|
| 4A | Domain Filtering + Multi-Note Today Tab | Done |
| 4B | Smart Notes Pipeline (Claude Haiku classification) | Done |
| 4C | Calendar Integration (Supabase + EventKit dual-source) | Done |
| 4D | Autonomous Refinement + Project Lifecycle Management | Done |

## Remaining

| # | Item | Category | Est. Build | Description |
|---|------|----------|-----------|-------------|
| 17 | Multi-user support | Platform | ~8 hr | Shared instance with per-user context isolation, auth, and separate memory/task spaces. |
| 18 | Mobile companion app | Platform | ~20 hr | iOS/Android app for on-the-go interaction, push notifications, quick task capture. |
| 19 | Push notification infrastructure | iOS | ~4 hr | APNs setup for approval bundle notifications from Trigger.dev. |
| 20 | Elle calendar sync script | Integration | ~2 hr | Scrape Omnissa calendar from Elle's Mac → upsert to calendar_events table. |
| 21 | Audio note transcription | Pipeline | ~6 hr | Upload audio → Supabase Storage → Whisper API → classify + route via Smart Notes Pipeline. |

## Anthropic Harness Compliance

Based on [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):

| Guideline | Status | Addressed by |
|-----------|--------|-------------|
| Session startup ritual | 9/10 | Already implemented |
| One-feature-per-session | 9/10 | Already implemented |
| Feature immutability / guardrails | 9/10 | Already implemented |
| Context window management | 8/10 | Already implemented |
| Init script | 7/10 | Already implemented |
| Clean state validation | 8/10 | Improved by #6 |
| Progress documentation | 9/10 | Fixed by #5 |
| E2E testing | 7/10 | Fixed by #8 |
| Checkpointing / crash recovery | 8/10 | Fixed by #6 |
