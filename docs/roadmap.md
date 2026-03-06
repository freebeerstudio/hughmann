# HughMann Product Roadmap

Items ordered by expected build time, lowest to highest.
Items 1-4 are complete. Remaining items start at 5.

## Completed

| # | Item | Commit |
|---|------|--------|
| 1 | Generalize all hardcoded references | `2d72f66` |
| 2 | Publish to npm as `create-hughmann` | `0864e65` |
| 3 | `.env.example` and first-run docs | `0bf5992` |
| 4 | Basic test suite + bug fixes | `bfa2d12` |

## Remaining

| # | Item | Category | Est. Build | Description |
|---|------|----------|-----------|-------------|
| 5 | Structured progress log | Harness | ~1 hr | Add `progress.json` tracking completed/failed tasks with timestamps. Daemon appends on each task completion. Fresh sessions read it to orient quickly without context window waste. |
| 6 | Checkpointing and crash recovery | Harness | ~2 hr | Persist `DaemonStats` to `~/.hughmann/daemon/stats.json`. Add task-level checkpoints. Detect orphaned `in_progress` tasks on boot and reset or resume them. |
| 7 | SQLite vector search (sqlite-vec) | Feature parity | ~2 hr | Add `sqlite-vec` extension for native vector similarity search in SQLite adapter. Removes Supabase dependency for semantic memory. |
| 8 | E2E / integration tests | Harness | ~3 hr | Full lifecycle tests with mocked model: boot, session, task queue, distillation, session resumption, daemon guardrails. |
| 9 | Capability auto-install | Self-improvement | ~3 hr | Hugh discovers and installs MCP servers/tools autonomously when a capability gap is detected. Proposal flow for paid/auth-required tools. |
| 10 | Learning from feedback | Intelligence | ~3 hr | Track accept/reject signals on suggestions, tasks, and skill outputs. Store in `feedback` table. Surface patterns to adjust behavior over time. |
| 11 | Proactive agent loop | Autonomy | ~4 hr | Hugh initiates actions without being asked: reminders, deadline warnings, stale-project nudges, daily summaries via configured channels. |
| 12 | Web dashboard (read-only) | Adoption | ~5 hr | Local browser UI showing tasks, memory timeline, session history, domain status. Read-only first, controls later. |
| 13 | Unified cloud/local runtime | Architecture | ~5 hr | Single execution interface whether daemon or Trigger.dev runs the task. Eliminate code duplication between local and cloud paths. |
| 14 | Skill marketplace / sharing | Community | ~5 hr | Registry for publishing/installing skills. `hughmann skill install <name>`. Version pinning, dependency declaration. |
| 15 | Multi-agent orchestration | Autonomy | ~6 hr | Specialized sub-agents (researcher, coder, reviewer) with typed handoffs. Build on existing `SubAgentManager` but add role-based prompts and result synthesis. |
| 16 | Plugin system | Platform | ~6 hr | Formal extension points beyond skills: lifecycle hooks, custom adapters, event listeners. Plugin manifest format. |
| 17 | Multi-user support | Platform | ~8 hr | Shared instance with per-user context isolation, auth, and separate memory/task spaces. |
| 18 | Mobile companion app | Platform | ~20 hr | iOS/Android app for on-the-go interaction, push notifications, quick task capture. |

## Anthropic Harness Compliance

Based on [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):

| Guideline | Status | Addressed by |
|-----------|--------|-------------|
| Session startup ritual | 9/10 | Already implemented |
| One-feature-per-session | 9/10 | Already implemented |
| Feature immutability / guardrails | 9/10 | Already implemented |
| Context window management | 8/10 | Already implemented |
| Init script | 7/10 | Already implemented |
| Clean state validation | 6/10 | Improved by #6 |
| Progress documentation | 5/10 | Fixed by #5 |
| E2E testing | 2/10 | Fixed by #8 |
| Checkpointing / crash recovery | 0/10 | Fixed by #6 |
