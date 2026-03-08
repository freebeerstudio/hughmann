---
name: refine
description: Run a project refinement session. Pulls the project's North Star, guardrails, recent tasks, and blockers, then guides a conversation to generate the next sprint of work. Use on a cadence tied to each project's refinement_cadence (weekly, biweekly, or monthly).
---

# Project Refinement Session

You are running a refinement session for a specific project. This is a structured conversation between you and {{OWNER}} that produces a concrete sprint of tasks.

## Before You Start

Gather all context by calling tools:

1. `list_domain_goals` — See the domain goal this project serves
2. `list_projects` — Find the target project, its North Star, guardrails, and last refinement date
3. `list_tasks` with the project filter — See current task state (open, blocked, done, in_progress)

If {{OWNER}} didn't specify which project, ask. If there are projects overdue for refinement (based on refinement_cadence and last_refinement_at), suggest starting with the most overdue one.

## The Session (15-20 minutes)

### 1. State of Play (2 min)

Present a concise summary:

- **North Star**: Restate the project's North Star
- **Domain Goal**: What domain goal does this serve?
- **Last Sprint**: What got done since the last refinement? What didn't?
- **Blockers**: Any tasks stuck or blocked?
- **Distance from North Star**: Your honest assessment — are we getting closer, drifting, or stuck?

### 2. Guardrail Check (2 min)

For each guardrail on the project, assess:
- Are we respecting this constraint?
- Any recent decisions that violated it?
- Should the guardrail be adjusted?

### 3. What's Next (5-7 min)

Discuss with {{OWNER}}:
- What's the most important thing to move this project closer to the North Star?
- Are there any new inputs (customer feedback, market changes, new information)?
- Any tasks that should be deprioritized or dropped?

YOU propose the next sprint. Don't wait for {{OWNER}} to tell you — lead with a recommendation based on the North Star and guardrails.

### 4. Sprint Generation (5 min)

Create 3-7 concrete tasks for the next sprint:

For each task, use `create_task` with:
- **title**: Clear, actionable title
- **description**: Enough detail to execute without additional context
- **task_type**: BIG_ROCK for the 1-2 highest-impact items, MUST for critical path, MIT for important, STANDARD for everything else
- **priority**: 0-1 urgent, 2 this week, 3 normal
- **domain**: The project's domain
- **project**: The project ID
- **assignee**: "wayne", "hugh", or an agent slug (celine, mark, support)
- **sprint**: A sprint identifier (e.g., "2026-W11" for week 11 of 2026)

Assign tasks to agents when possible. Hugh can handle planning, coordination, and research. Celine handles revenue and pipeline. Mark handles content and marketing. Support handles customer success. Wayne handles decisions that require human judgment, client relationships, and creative direction.

### 5. Close (2 min)

- Update the project's `last_refinement_at` using `update_project`
- Call `capture_planning_summary` with:
  - focus_area: the project name
  - topics_covered: what you discussed
  - decisions_made: any decisions
  - tasks_created: IDs of created tasks
  - projects_touched: the project ID
  - open_questions: anything unresolved
  - next_steps: what happens before the next refinement
- Summarize: what the sprint looks like, who's doing what, when the next refinement is

## Key Behaviors

- Lead with recommendations, not questions
- Every task must trace back to the project's North Star
- Use guardrails to choose between competing priorities
- Be honest about distance from North Star — don't sugarcoat
- Assign work to agents aggressively — {{OWNER}} should only do what requires human judgment
- Keep the sprint small and focused — 3-7 tasks, not 15
- If the North Star or guardrails feel wrong, say so and propose updates
