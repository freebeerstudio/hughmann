# ChiefOfStaff iOS Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the existing ChiefOfStaff iOS app to work with HughMann's current Supabase schema and implement the new 4-tab navigation (Today / Work / Plan / Settings).

**Architecture:** The iOS app talks directly to HughMann's Supabase tables (`tasks`, `projects`, `domain_goals`, `content`, `topics`, `content_sources`, `planning_sessions`) via REST API. No edge functions needed for Phase 1 CRUD — direct REST with RLS. Chat remains via the existing `agent-runtime` edge function. Domain isolation uses the existing `domain` TEXT column (not customer_id UUID) for HughMann's tables, while keeping the `X-Customer-Id` header for legacy tables (agents, messages).

**Tech Stack:** Swift 6, SwiftUI, Supabase Swift SDK (auth only), URLSession REST, SwiftData (habits, offline cache)

**Codebase:** `/Users/waynebridges/chief-of-staff-ios/`

**Design doc:** `docs/plans/2026-03-08-chiefofstaff-ios-rebuild-design.md`

**Key reference — HughMann's Supabase schema:** `/Users/waynebridges/HughMann/src/adapters/data/supabase.ts` lines 1051-1227

---

## Domain Mapping

HughMann uses `domain` TEXT (`fbs`, `omnissa`, `personal`). The iOS app uses `customer_id` UUID. Both must work.

| iOS Domain | domain TEXT | customer_id UUID |
|---|---|---|
| Personal | `personal` | `fc64558e-2740-4005-883f-53388b7edad7` |
| Omnissa | `omnissa` | `926a785c-2964-4eef-973c-c82f768d8a56` |
| Free Beer Studio | `fbs` | `fdd7ce7f-5194-4dae-91c5-fd6b1b4d6a88` |

The `Domain` model already has `slug` (maps to domain TEXT) and `id` (maps to customer_id UUID). Services for HughMann tables will filter by `domain=eq.{slug}`. Services for legacy tables keep using `customer_id`.

---

### Task 1: Create HMTask Model

**Files:**
- Create: `ChiefOfStaffApp/Models/HMTask.swift`

**Step 1: Create the model file**

This replaces `WorkItem` for HughMann's `tasks` table. The old `WorkItem` model stays for now (legacy code references it) but all new views use `HMTask`.

```swift
import Foundation

// MARK: - Task Status

enum HMTaskStatus: String, Codable, CaseIterable {
    case backlog
    case todo
    case inProgress = "in_progress"
    case done
    case blocked
}

// MARK: - Task Type

enum HMTaskType: String, Codable, CaseIterable {
    case must
    case mit
    case bigRock = "big_rock"
    case standard
}

// MARK: - Task

struct HMTask: Codable, Identifiable, Sendable {
    let id: String
    var title: String
    var description: String?
    var status: HMTaskStatus
    var taskType: HMTaskType
    var domain: String?
    var projectId: String?
    var sprint: String?
    var priority: Int
    var assignee: String?
    var assignedAgentId: String?
    var blockedReason: String?
    var dueDate: String?
    var cwd: String?
    var completionNotes: String?
    var createdAt: String?
    var updatedAt: String?
    var completedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, status, domain, sprint, priority
        case assignee, cwd
        case taskType = "task_type"
        case projectId = "project_id"
        case assignedAgentId = "assigned_agent_id"
        case blockedReason = "blocked_reason"
        case dueDate = "due_date"
        case completionNotes = "completion_notes"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case completedAt = "completed_at"
    }
}

// MARK: - Create / Update

struct HMTaskCreate: Codable {
    var title: String
    var description: String?
    var status: String = "todo"
    var taskType: String = "standard"
    var domain: String?
    var projectId: String?
    var sprint: String?
    var priority: Int = 3
    var assignee: String?
    var dueDate: String?

    enum CodingKeys: String, CodingKey {
        case title, description, status, domain, sprint, priority, assignee
        case taskType = "task_type"
        case projectId = "project_id"
        case dueDate = "due_date"
    }
}

struct HMTaskUpdate: Codable {
    var title: String?
    var description: String?
    var status: String?
    var taskType: String?
    var domain: String?
    var projectId: String?
    var sprint: String?
    var priority: Int?
    var assignee: String?
    var dueDate: String?
    var completionNotes: String?
    var completedAt: String?

    enum CodingKeys: String, CodingKey {
        case title, description, status, domain, sprint, priority, assignee
        case taskType = "task_type"
        case projectId = "project_id"
        case dueDate = "due_date"
        case completionNotes = "completion_notes"
        case completedAt = "completed_at"
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build (Cmd+B) or `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 16' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED (new file, no dependencies yet)

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Models/HMTask.swift
git commit -m "feat: add HMTask model matching HughMann tasks table schema"
```

---

### Task 2: Create HMProject Model

**Files:**
- Create: `ChiefOfStaffApp/Models/HMProject.swift`

**Step 1: Create the model file**

```swift
import Foundation

// MARK: - Project Status

enum HMProjectStatus: String, Codable, CaseIterable {
    case planning
    case incubator
    case active
    case paused
    case completed
    case archived
}

// MARK: - Refinement Cadence

enum HMRefinementCadence: String, Codable, CaseIterable {
    case weekly
    case biweekly
    case monthly
}

// MARK: - Project Infrastructure

struct HMProjectInfrastructure: Codable, Sendable {
    var repoUrl: String?
    var vercelProject: String?
    var productionUrl: String?
    var stagingUrl: String?
    var domain: String?

    enum CodingKeys: String, CodingKey {
        case repoUrl = "repo_url"
        case vercelProject = "vercel_project"
        case productionUrl = "production_url"
        case stagingUrl = "staging_url"
        case domain
    }
}

// MARK: - Project

struct HMProject: Codable, Identifiable, Sendable {
    let id: String
    var name: String
    var slug: String
    var description: String?
    var domain: String
    var status: HMProjectStatus
    var priority: Int
    var domainGoalId: String?
    var northStar: String?
    var guardrails: [String]
    var infrastructure: HMProjectInfrastructure
    var refinementCadence: HMRefinementCadence
    var lastRefinementAt: String?
    var createdAt: String?
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, name, slug, description, domain, status, priority, guardrails, infrastructure
        case domainGoalId = "domain_goal_id"
        case northStar = "north_star"
        case refinementCadence = "refinement_cadence"
        case lastRefinementAt = "last_refinement_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    /// Next refinement date based on cadence + last refinement
    var nextRefinementDate: Date? {
        guard let lastStr = lastRefinementAt,
              let last = ISO8601DateFormatter().date(from: lastStr) else { return nil }
        let cal = Calendar.current
        switch refinementCadence {
        case .weekly: return cal.date(byAdding: .weekOfYear, value: 1, to: last)
        case .biweekly: return cal.date(byAdding: .weekOfYear, value: 2, to: last)
        case .monthly: return cal.date(byAdding: .month, value: 1, to: last)
        }
    }

    /// Whether refinement is overdue
    var isRefinementDue: Bool {
        guard let next = nextRefinementDate else { return true }
        return Date() >= next
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Models/HMProject.swift
git commit -m "feat: add HMProject model with north_star, guardrails, refinement cadence"
```

---

### Task 3: Create HMDomainGoal Model

**Files:**
- Create: `ChiefOfStaffApp/Models/HMDomainGoal.swift`

**Step 1: Create the model file**

```swift
import Foundation

struct HMDomainGoal: Codable, Identifiable, Sendable {
    let id: String
    var domain: String
    var statement: String
    var reviewedAt: String?
    var createdAt: String?
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, domain, statement
        case reviewedAt = "reviewed_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    /// Friendly domain label for display
    var domainLabel: String {
        switch domain {
        case "fbs": return "Free Beer Studio"
        case "omnissa": return "Omnissa"
        case "personal": return "Personal"
        default: return domain.capitalized
        }
    }

    /// Whether the goal has been reviewed in the current quarter
    var isReviewedThisQuarter: Bool {
        guard let str = reviewedAt,
              let date = ISO8601DateFormatter().date(from: str) else { return false }
        let cal = Calendar.current
        return cal.component(.quarter, from: date) == cal.component(.quarter, from: Date()) &&
               cal.component(.year, from: date) == cal.component(.year, from: Date())
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Models/HMDomainGoal.swift
git commit -m "feat: add HMDomainGoal model for domain_goals table"
```

---

### Task 4: Create HMContentPiece and HMTopic Models

**Files:**
- Create: `ChiefOfStaffApp/Models/HMContent.swift`

**Step 1: Create the model file**

```swift
import Foundation

// MARK: - Content Status

enum HMContentStatus: String, Codable, CaseIterable {
    case idea
    case drafting
    case review
    case approved
    case scheduled
    case published
    case rejected

    var label: String {
        switch self {
        case .idea: return "Idea"
        case .drafting: return "Drafting"
        case .review: return "Review"
        case .approved: return "Approved"
        case .scheduled: return "Scheduled"
        case .published: return "Published"
        case .rejected: return "Rejected"
        }
    }
}

// MARK: - Content Platform

enum HMContentPlatform: String, Codable, CaseIterable {
    case blog
    case linkedin
    case x
    case newsletter
    case youtube
    case shorts
}

// MARK: - Source Material

struct HMSourceMaterial: Codable, Sendable {
    var url: String
    var title: String
    var summary: String
}

// MARK: - Content Piece

struct HMContentPiece: Codable, Identifiable, Sendable {
    let id: String
    var domain: String
    var topicId: String?
    var projectId: String?
    var title: String
    var status: HMContentStatus
    var platform: HMContentPlatform
    var body: String?
    var sourceMaterial: [HMSourceMaterial]
    var scheduledAt: String?
    var publishedAt: String?
    var publishedUrl: String?
    var createdBy: String
    var createdAt: String?
    var updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, domain, title, status, platform, body
        case topicId = "topic_id"
        case projectId = "project_id"
        case sourceMaterial = "source_material"
        case scheduledAt = "scheduled_at"
        case publishedAt = "published_at"
        case publishedUrl = "published_url"
        case createdBy = "created_by"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// MARK: - Topic

struct HMTopic: Codable, Identifiable, Sendable {
    let id: String
    var domain: String
    var name: String
    var description: String?
    var active: Bool
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, domain, name, description, active
        case createdAt = "created_at"
    }
}

// MARK: - Content Source

struct HMContentSource: Codable, Identifiable, Sendable {
    let id: String
    var domain: String
    var name: String
    var type: String
    var url: String?
    var active: Bool
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, domain, name, type, url, active
        case createdAt = "created_at"
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Models/HMContent.swift
git commit -m "feat: add HMContentPiece, HMTopic, HMContentSource models"
```

---

### Task 5: Create HMPlanningSession Model

**Files:**
- Create: `ChiefOfStaffApp/Models/HMPlanningSession.swift`

**Step 1: Create the model file**

```swift
import Foundation

struct HMPlanningSession: Codable, Identifiable, Sendable {
    let id: String
    var sessionId: String
    var focusArea: String
    var topicsCovered: [String]
    var decisionsMade: [String]
    var tasksCreated: [String]
    var projectsTouched: [String]
    var openQuestions: [String]
    var nextSteps: [String]
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case sessionId = "session_id"
        case focusArea = "focus_area"
        case topicsCovered = "topics_covered"
        case decisionsMade = "decisions_made"
        case tasksCreated = "tasks_created"
        case projectsTouched = "projects_touched"
        case openQuestions = "open_questions"
        case nextSteps = "next_steps"
        case createdAt = "created_at"
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Models/HMPlanningSession.swift
git commit -m "feat: add HMPlanningSession model for planning_sessions table"
```

---

### Task 6: Create SupabaseREST Helper

**Files:**
- Create: `ChiefOfStaffApp/Services/SupabaseREST.swift`

**Step 1: Create the REST helper**

All HughMann table services use the same pattern: GET/POST/PATCH against Supabase REST API with auth headers. Extract this into a shared helper.

```swift
import Foundation

/// Lightweight REST helper for direct Supabase table access.
/// Used by HM* services to talk to HughMann's tables (tasks, projects, domain_goals, content, etc.)
enum SupabaseREST {
    static let baseURL = "https://rmtxneyqxbjucxizqtfs.supabase.co/rest/v1"

    /// Build a URLRequest with standard Supabase headers
    static func request(_ path: String, method: String = "GET", query: [String: String] = [:]) async throws -> URLRequest {
        var components = URLComponents(string: "\(baseURL)/\(path)")!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }

        var req = URLRequest(url: components.url!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(Config.EXPO_PUBLIC_SUPABASE_ANON_KEY, forHTTPHeaderField: "apikey")
        req.setValue("return=representation", forHTTPHeaderField: "Prefer")

        // Auth: try live session token, fall back to SharedAuth
        if let token = try? await supabase.auth.session.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if let token = SharedAuth.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return req
    }

    /// GET and decode an array of T
    static func fetch<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> [T] {
        let req = try await request(path, query: query)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode < 300 else {
            return []
        }
        return try JSONDecoder().decode([T].self, from: data)
    }

    /// POST a new row and decode the returned row
    static func insert<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T? {
        var req = try await request(path, method: "POST")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode < 300 else {
            return nil
        }
        let rows = try JSONDecoder().decode([T].self, from: data)
        return rows.first
    }

    /// PATCH a row by id and decode the returned row
    static func update<T: Decodable, B: Encodable>(_ path: String, id: String, body: B) async throws -> T? {
        var req = try await request(path, method: "PATCH", query: ["id": "eq.\(id)"])
        req.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode < 300 else {
            return nil
        }
        let rows = try JSONDecoder().decode([T].self, from: data)
        return rows.first
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Services/SupabaseREST.swift
git commit -m "feat: add SupabaseREST helper for direct table access"
```

---

### Task 7: Create TaskService

**Files:**
- Create: `ChiefOfStaffApp/Services/TaskService.swift`

**Step 1: Create the service**

```swift
import Foundation
import Observation

@Observable
final class TaskService: Sendable {
    var tasks: [HMTask] = []
    var isLoading = false

    /// Fetch tasks, optionally filtered by domain and/or status
    func fetchTasks(domain: String? = nil, status: [HMTaskStatus]? = nil, projectId: String? = nil) async {
        isLoading = true
        defer { isLoading = false }

        var query: [String: String] = ["order": "priority.asc,created_at.desc"]

        if let domain {
            query["domain"] = "eq.\(domain)"
        }
        if let status {
            if status.count == 1 {
                query["status"] = "eq.\(status[0].rawValue)"
            } else {
                query["status"] = "in.(\(status.map(\.rawValue).joined(separator: ",")))"
            }
        }
        if let projectId {
            query["project_id"] = "eq.\(projectId)"
        }

        do {
            tasks = try await SupabaseREST.fetch("tasks", query: query)
        } catch {
            // Best-effort — keep existing data on failure
        }
    }

    /// Fetch today's tasks: status=todo, type=must or mit
    func fetchTodayTasks(domain: String? = nil) async {
        var query: [String: String] = [
            "status": "eq.todo",
            "task_type": "in.(must,mit)",
            "order": "task_type.asc,priority.asc",
        ]
        if let domain {
            query["domain"] = "eq.\(domain)"
        }
        do {
            tasks = try await SupabaseREST.fetch("tasks", query: query)
        } catch {}
    }

    /// Create a task
    func createTask(_ create: HMTaskCreate) async -> HMTask? {
        do {
            let task: HMTask? = try await SupabaseREST.insert("tasks", body: create)
            if let task { tasks.insert(task, at: 0) }
            return task
        } catch {
            return nil
        }
    }

    /// Update a task (status change, completion, etc.)
    func updateTask(id: String, update: HMTaskUpdate) async -> HMTask? {
        do {
            let updated: HMTask? = try await SupabaseREST.update("tasks", id: id, body: update)
            if let updated, let idx = tasks.firstIndex(where: { $0.id == id }) {
                tasks[idx] = updated
            }
            return updated
        } catch {
            return nil
        }
    }

    // MARK: - Computed Helpers

    var mustTask: HMTask? {
        tasks.first { $0.taskType == .must && $0.status == .todo }
    }

    var mits: [HMTask] {
        Array(tasks.filter { $0.taskType == .mit && $0.status == .todo && $0.id != mustTask?.id }.prefix(3))
    }

    func tasksForProject(_ projectId: String) -> [HMTask] {
        tasks.filter { $0.projectId == projectId }
    }

    func tasksGroupedByType() -> [(type: HMTaskType, tasks: [HMTask])] {
        let order: [HMTaskType] = [.must, .mit, .bigRock, .standard]
        return order.compactMap { type in
            let matching = tasks.filter { $0.taskType == type }
            return matching.isEmpty ? nil : (type: type, tasks: matching)
        }
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Services/TaskService.swift
git commit -m "feat: add TaskService for HughMann tasks table"
```

---

### Task 8: Create ProjectService

**Files:**
- Create: `ChiefOfStaffApp/Services/ProjectService.swift`

**Step 1: Create the service**

```swift
import Foundation
import Observation

@Observable
final class ProjectService: Sendable {
    var projects: [HMProject] = []
    var isLoading = false

    /// Fetch projects, optionally filtered by domain or status
    func fetchProjects(domain: String? = nil, status: [HMProjectStatus]? = nil, domainGoalId: String? = nil) async {
        isLoading = true
        defer { isLoading = false }

        var query: [String: String] = ["order": "priority.asc,name.asc"]

        if let domain {
            query["domain"] = "eq.\(domain)"
        }
        if let status {
            if status.count == 1 {
                query["status"] = "eq.\(status[0].rawValue)"
            } else {
                query["status"] = "in.(\(status.map(\.rawValue).joined(separator: ",")))"
            }
        }
        if let domainGoalId {
            query["domain_goal_id"] = "eq.\(domainGoalId)"
        }

        do {
            projects = try await SupabaseREST.fetch("projects", query: query)
        } catch {}
    }

    /// Fetch a single project by ID
    func fetchProject(id: String) async -> HMProject? {
        do {
            let results: [HMProject] = try await SupabaseREST.fetch("projects", query: ["id": "eq.\(id)"])
            return results.first
        } catch {
            return nil
        }
    }

    /// Projects grouped by domain
    func projectsByDomain() -> [String: [HMProject]] {
        Dictionary(grouping: projects, by: \.domain)
    }

    /// Active projects for a domain goal
    func projectsForGoal(_ goalId: String) -> [HMProject] {
        projects.filter { $0.domainGoalId == goalId }
    }

    /// Projects due for refinement
    func projectsDueForRefinement() -> [HMProject] {
        projects.filter { $0.status == .active && $0.isRefinementDue }
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Services/ProjectService.swift
git commit -m "feat: add ProjectService for HughMann projects table"
```

---

### Task 9: Create DomainGoalService

**Files:**
- Create: `ChiefOfStaffApp/Services/DomainGoalService.swift`

**Step 1: Create the service**

```swift
import Foundation
import Observation

@Observable
final class DomainGoalService: Sendable {
    var goals: [HMDomainGoal] = []
    var isLoading = false

    /// Fetch all domain goals
    func fetchGoals() async {
        isLoading = true
        defer { isLoading = false }
        do {
            goals = try await SupabaseREST.fetch("domain_goals", query: ["order": "domain.asc"])
        } catch {}
    }

    /// Get goal for a specific domain
    func goalForDomain(_ domain: String) -> HMDomainGoal? {
        goals.first { $0.domain == domain }
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Services/DomainGoalService.swift
git commit -m "feat: add DomainGoalService for domain_goals table"
```

---

### Task 10: Create ContentService

**Files:**
- Create: `ChiefOfStaffApp/Services/ContentService.swift`

**Step 1: Create the service**

```swift
import Foundation
import Observation

@Observable
final class ContentService: Sendable {
    var pieces: [HMContentPiece] = []
    var topics: [HMTopic] = []
    var isLoading = false

    /// Fetch content pieces, optionally filtered
    func fetchContent(domain: String? = nil, status: HMContentStatus? = nil, projectId: String? = nil) async {
        isLoading = true
        defer { isLoading = false }

        var query: [String: String] = ["order": "created_at.desc"]

        if let domain { query["domain"] = "eq.\(domain)" }
        if let status { query["status"] = "eq.\(status.rawValue)" }
        if let projectId { query["project_id"] = "eq.\(projectId)" }

        do {
            pieces = try await SupabaseREST.fetch("content", query: query)
        } catch {}
    }

    /// Fetch topics for a domain
    func fetchTopics(domain: String? = nil) async {
        var query: [String: String] = ["active": "eq.true", "order": "name.asc"]
        if let domain { query["domain"] = "eq.\(domain)" }
        do {
            topics = try await SupabaseREST.fetch("topics", query: query)
        } catch {}
    }

    /// Update content status (e.g., idea → approved)
    func updateStatus(id: String, status: HMContentStatus) async -> HMContentPiece? {
        struct StatusUpdate: Codable {
            let status: String
            let updatedAt: String

            enum CodingKeys: String, CodingKey {
                case status
                case updatedAt = "updated_at"
            }
        }
        let update = StatusUpdate(
            status: status.rawValue,
            updatedAt: ISO8601DateFormatter().string(from: Date())
        )
        do {
            let updated: HMContentPiece? = try await SupabaseREST.update("content", id: id, body: update)
            if let updated, let idx = pieces.firstIndex(where: { $0.id == id }) {
                pieces[idx] = updated
            }
            return updated
        } catch {
            return nil
        }
    }

    /// Topic name lookup
    func topicName(for id: String?) -> String? {
        guard let id else { return nil }
        return topics.first { $0.id == id }?.name
    }

    /// Pieces grouped by status
    func piecesByStatus() -> [HMContentStatus: [HMContentPiece]] {
        Dictionary(grouping: pieces, by: \.status)
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Services/ContentService.swift
git commit -m "feat: add ContentService for content and topics tables"
```

---

### Task 11: Build WorkView — Domain Goal Cards (Level 1)

**Files:**
- Create: `ChiefOfStaffApp/Views/WorkView.swift`

**Step 1: Create the Work tab root view**

```swift
import SwiftUI

struct WorkView: View {
    @State private var goalService = DomainGoalService()
    @State private var projectService = ProjectService()
    @State private var taskService = TaskService()
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme

    private var bg: Color { colorScheme == .dark ? Theme.backgroundDark : Theme.backgroundLight }
    private var fg: Color { colorScheme == .dark ? Theme.textPrimaryDark : Theme.textPrimary }
    private var borderColor: Color { colorScheme == .dark ? Theme.borderDark : Theme.border }
    private var cardBg: Color { colorScheme == .dark ? Theme.surfaceDark : .white }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(goalService.goals) { goal in
                        NavigationLink(value: goal) {
                            goalCard(goal)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(bg)
            .navigationDestination(for: HMDomainGoal.self) { goal in
                ProjectListView(goal: goal)
            }
            .task {
                await goalService.fetchGoals()
                await projectService.fetchProjects(status: [.active, .planning, .incubator])
                await taskService.fetchTasks(status: [.todo, .inProgress, .blocked])
            }
        }
    }

    private func goalCard(_ goal: HMDomainGoal) -> some View {
        let domainProjects = projectService.projects.filter { $0.domain == goal.domain }
        let activeCount = domainProjects.filter { $0.status == .active }.count
        let domainTasks = taskService.tasks.filter { $0.domain == goal.domain }
        let activeTasks = domainTasks.filter { $0.status != .done }.count

        return VStack(alignment: .leading, spacing: 8) {
            Text(goal.domainLabel)
                .font(.headline)
                .fontWeight(.semibold)
                .foregroundStyle(fg)

            Text(goal.statement)
                .font(.body)
                .fontWeight(.light)
                .foregroundStyle(fg)

            Text("\(activeCount) active project\(activeCount == 1 ? "" : "s") · \(activeTasks) task\(activeTasks == 1 ? "" : "s")")
                .font(.caption)
                .foregroundStyle(Theme.textTertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(cardBg)
        .clipShape(.rect(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(borderColor, lineWidth: 0.5)
        )
    }
}
```

**Step 2: Add Hashable conformance to HMDomainGoal**

In `HMDomainGoal.swift`, add `Hashable` conformance (needed for NavigationLink value):

Add after `Sendable`:

```swift
struct HMDomainGoal: Codable, Identifiable, Sendable, Hashable {
    // (Hashable auto-synthesized from Codable properties)
```

**Step 3: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add ChiefOfStaffApp/Views/WorkView.swift ChiefOfStaffApp/Models/HMDomainGoal.swift
git commit -m "feat: add WorkView with domain goal cards (pyramid level 1)"
```

---

### Task 12: Build ProjectListView (Level 2)

**Files:**
- Create: `ChiefOfStaffApp/Views/ProjectListView.swift`

**Step 1: Create the project list view**

```swift
import SwiftUI

struct ProjectListView: View {
    let goal: HMDomainGoal
    @State private var projectService = ProjectService()
    @State private var taskService = TaskService()
    @Environment(\.colorScheme) private var colorScheme

    private var bg: Color { colorScheme == .dark ? Theme.backgroundDark : Theme.backgroundLight }
    private var fg: Color { colorScheme == .dark ? Theme.textPrimaryDark : Theme.textPrimary }
    private var borderColor: Color { colorScheme == .dark ? Theme.borderDark : Theme.border }
    private var cardBg: Color { colorScheme == .dark ? Theme.surfaceDark : .white }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if projectService.projects.isEmpty && !projectService.isLoading {
                    Text("No projects yet")
                        .font(.subheadline)
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.top, 40)
                } else {
                    ForEach(projectService.projects) { project in
                        NavigationLink(value: project) {
                            projectCard(project)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(16)
        }
        .background(bg)
        .navigationTitle(goal.domainLabel)
        .navigationBarTitleDisplayMode(.large)
        .navigationDestination(for: HMProject.self) { project in
            ProjectDetailView(project: project)
        }
        .task {
            await projectService.fetchProjects(domain: goal.domain)
            await taskService.fetchTasks(domain: goal.domain)
        }
    }

    private func projectCard(_ project: HMProject) -> some View {
        let projectTasks = taskService.tasks.filter { $0.projectId == project.id }
        let taskCount = projectTasks.filter { $0.status != .done }.count

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(project.name)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundStyle(fg)

                Spacer()

                Text(project.status.rawValue)
                    .font(.caption2)
                    .fontWeight(.medium)
                    .foregroundStyle(Theme.textSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(
                        Capsule().fill(borderColor.opacity(0.5))
                    )
            }

            if let northStar = project.northStar, !northStar.isEmpty {
                Text(northStar)
                    .font(.subheadline)
                    .fontWeight(.light)
                    .italic()
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(2)
            }

            HStack(spacing: 12) {
                Text("\(taskCount) task\(taskCount == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(Theme.textTertiary)

                if let next = project.nextRefinementDate {
                    Text("Refine \(next, format: .dateTime.month(.abbreviated).day())")
                        .font(.caption)
                        .foregroundStyle(project.isRefinementDue ? Theme.urgencyRed : Theme.textTertiary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(cardBg)
        .clipShape(.rect(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(borderColor, lineWidth: 0.5)
        )
    }
}
```

**Step 2: Add Hashable to HMProject**

In `HMProject.swift`, add `Hashable`:

```swift
struct HMProject: Codable, Identifiable, Sendable, Hashable {
    // Need custom Hashable since HMProjectInfrastructure is not auto-Hashable
    static func == (lhs: HMProject, rhs: HMProject) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
```

**Step 3: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add ChiefOfStaffApp/Views/ProjectListView.swift ChiefOfStaffApp/Models/HMProject.swift
git commit -m "feat: add ProjectListView — pyramid level 2 drill-down"
```

---

### Task 13: Build ProjectDetailView with Tasks Sub-Tab (Level 3)

**Files:**
- Create: `ChiefOfStaffApp/Views/ProjectDetailView.swift`

**Step 1: Create the project detail view**

```swift
import SwiftUI

struct ProjectDetailView: View {
    let project: HMProject
    @State private var taskService = TaskService()
    @State private var contentService = ContentService()
    @State private var selectedTab = "Tasks"
    @State private var showGuardrails = false
    @Environment(\.colorScheme) private var colorScheme

    private var bg: Color { colorScheme == .dark ? Theme.backgroundDark : Theme.backgroundLight }
    private var fg: Color { colorScheme == .dark ? Theme.textPrimaryDark : Theme.textPrimary }
    private var borderColor: Color { colorScheme == .dark ? Theme.borderDark : Theme.border }

    var body: some View {
        VStack(spacing: 0) {
            // North Star + Guardrails header
            projectHeader

            // Tasks | Content toggle
            segmentedControl

            Rectangle().fill(borderColor).frame(height: 0.5)

            // Content area
            if selectedTab == "Tasks" {
                tasksView
            } else {
                contentView
            }
        }
        .background(bg)
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await taskService.fetchTasks(projectId: project.id)
            await contentService.fetchContent(projectId: project.id)
            await contentService.fetchTopics(domain: project.domain)
        }
    }

    // MARK: - Header

    private var projectHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let northStar = project.northStar, !northStar.isEmpty {
                Text(northStar)
                    .font(.subheadline)
                    .fontWeight(.light)
                    .italic()
                    .foregroundStyle(Theme.textSecondary)
            }

            if !project.guardrails.isEmpty {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showGuardrails.toggle()
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text("Guardrails")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundStyle(Theme.textTertiary)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 8))
                            .foregroundStyle(Theme.textTertiary)
                            .rotationEffect(.degrees(showGuardrails ? 90 : 0))
                    }
                }

                if showGuardrails {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(project.guardrails, id: \.self) { rail in
                            Text("· \(rail)")
                                .font(.caption)
                                .fontWeight(.light)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Segmented Control

    private var segmentedControl: some View {
        HStack(spacing: 0) {
            ForEach(["Tasks", "Content"], id: \.self) { tab in
                Button { selectedTab = tab } label: {
                    VStack(spacing: 6) {
                        Text(tab)
                            .font(.subheadline)
                            .fontWeight(selectedTab == tab ? .semibold : .regular)
                            .foregroundStyle(selectedTab == tab ? fg : Theme.textTertiary)
                        Rectangle()
                            .fill(selectedTab == tab ? fg : .clear)
                            .frame(height: 2)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }

    // MARK: - Tasks

    private var tasksView: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
                let groups = taskService.tasksGroupedByType()
                if groups.isEmpty {
                    Text("No tasks")
                        .font(.subheadline)
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.top, 20)
                }
                ForEach(groups, id: \.type) { group in
                    taskTypeSection(group.type, tasks: group.tasks)
                }
            }
            .padding(16)
        }
    }

    private func taskTypeSection(_ type: HMTaskType, tasks: [HMTask]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(type.rawValue.replacingOccurrences(of: "_", with: " ").uppercased())
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.textSecondary)
                .tracking(1.2)

            ForEach(tasks) { task in
                taskRow(task)
            }
        }
    }

    private func taskRow(_ task: HMTask) -> some View {
        let isCompleted = task.status == .done
        return Button {
            Task {
                if isCompleted {
                    _ = await taskService.updateTask(id: task.id, update: HMTaskUpdate(status: "todo", completedAt: nil))
                } else {
                    _ = await taskService.updateTask(id: task.id, update: HMTaskUpdate(
                        status: "done",
                        completedAt: ISO8601DateFormatter().string(from: Date())
                    ))
                }
            }
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .stroke(isCompleted ? Theme.completionGreen : borderColor, lineWidth: 1.5)
                    .fill(isCompleted ? Theme.completionGreen.opacity(0.15) : .clear)
                    .frame(width: 20, height: 20)
                    .overlay {
                        if isCompleted {
                            Image(systemName: "checkmark")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Theme.completionGreen)
                        }
                    }

                VStack(alignment: .leading, spacing: 2) {
                    Text(task.title)
                        .font(.body)
                        .fontWeight(.medium)
                        .foregroundStyle(isCompleted ? Theme.textTertiary : fg)
                        .strikethrough(isCompleted, color: Theme.textTertiary)

                    if let assignee = task.assignee {
                        Text(assignee.capitalized)
                            .font(.caption2)
                            .foregroundStyle(Theme.textTertiary)
                    }
                }

                Spacer()

                if task.status == .blocked {
                    Text("blocked")
                        .font(.caption2)
                        .foregroundStyle(Theme.urgencyRed)
                }
            }
            .padding(.vertical, 4)
        }
        .sensoryFeedback(.impact(flexibility: .soft), trigger: isCompleted)
    }

    // MARK: - Content (placeholder — Phase 2 will flesh this out)

    private var contentView: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                if contentService.pieces.isEmpty {
                    Text("No content")
                        .font(.subheadline)
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.top, 20)
                }
                ForEach(contentService.pieces) { piece in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(piece.title)
                                .font(.body)
                                .fontWeight(.medium)
                                .foregroundStyle(fg)
                                .lineLimit(2)
                            HStack(spacing: 6) {
                                Text(piece.status.label)
                                    .font(.caption2)
                                    .foregroundStyle(Theme.textSecondary)
                                Text(piece.platform.rawValue)
                                    .font(.caption2)
                                    .foregroundStyle(Theme.textTertiary)
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 6)
                }
            }
            .padding(16)
        }
    }
}
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Views/ProjectDetailView.swift
git commit -m "feat: add ProjectDetailView with Tasks + Content sub-tabs (pyramid level 3)"
```

---

### Task 14: Update FooterNavigationView — 5 Tabs to 4

**Files:**
- Modify: `ChiefOfStaffApp/Views/FooterNavigationView.swift`

**Step 1: Update the tabs array**

Change line 7 from:
```swift
private let tabs = ["Today", "Tasks", "Plan", "Stuff", "Settings"]
```
to:
```swift
private let tabs = ["Today", "Work", "Plan", "Settings"]
```

**Step 2: Verify it compiles**

Run: Xcode build
Expected: May have warnings about unused views, but should build.

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Views/FooterNavigationView.swift
git commit -m "feat: update footer nav from 5 tabs to 4 (Today/Work/Plan/Settings)"
```

---

### Task 15: Update ContentView — Wire New Tabs

**Files:**
- Modify: `ChiefOfStaffApp/ContentView.swift`

**Step 1: Update the menu items and page routing**

Find the `menuItems` array (around line where menu items are defined) and replace with:
```swift
private let menuItems = [
    ("Today", "sun.max"),
    ("Work", "square.stack.3d.up"),
    ("Plan", "map"),
    ("Settings", "gearshape"),
]
```

Find the `pageContent` switch and replace with:
```swift
@ViewBuilder
private var pageContent: some View {
    switch selectedTab {
    case "Today": TodayView(selectedTab: $selectedTab)
    case "Work": WorkView()
    case "Plan": PlansHubView(selectedPlanTab: $selectedPlanTab)
    case "Settings": SettingsView(authService: authService)
    default: TodayView(selectedTab: $selectedTab)
    }
}
```

Also update the default `selectedTab` to `"Today"` if it isn't already:
```swift
@State private var selectedTab = "Today"
```

**Step 2: Update iPadSplitView similarly**

In `ChiefOfStaffApp/Views/iPadSplitView.swift`, update the `menuItems` and routing switch to match the same 4 tabs.

**Step 3: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED. Old views (TaskManagerView, ContentListView, AgentsPageView, StuffView) are no longer referenced from navigation but still compile.

**Step 4: Commit**

```bash
git add ChiefOfStaffApp/ContentView.swift ChiefOfStaffApp/Views/iPadSplitView.swift
git commit -m "feat: wire 4-tab navigation — Today/Work/Plan/Settings"
```

---

### Task 16: Update TodayView — Project Labels + Habit List + Daily Win

**Files:**
- Modify: `ChiefOfStaffApp/Views/TodayView.swift`
- Create: `ChiefOfStaffApp/Views/HabitListView.swift`

**Step 1: Create HabitListView**

```swift
import SwiftUI
import SwiftData

struct HabitListView: View {
    @Query(sort: \Habit.sortOrder) private var habits: [Habit]
    @Environment(\.modelContext) private var modelContext
    @Environment(\.colorScheme) private var colorScheme

    private var fg: Color { colorScheme == .dark ? Theme.textPrimaryDark : Theme.textPrimary }
    private var borderColor: Color { colorScheme == .dark ? Theme.borderDark : Theme.border }

    private var todayCompletedIds: Set<UUID> {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        var ids = Set<UUID>()
        for habit in habits {
            if habit.completions.contains(where: { cal.isDate($0.date, inSameDayAs: today) }) {
                ids.insert(habit.id)
            }
        }
        return ids
    }

    var completedCount: Int { todayCompletedIds.count }
    var totalCount: Int { habits.count }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(habits) { habit in
                let isCompleted = todayCompletedIds.contains(habit.id)
                Button {
                    toggleHabit(habit, isCompleted: isCompleted)
                } label: {
                    HStack(spacing: 10) {
                        Circle()
                            .stroke(isCompleted ? Theme.completionGreen : borderColor, lineWidth: 1.5)
                            .fill(isCompleted ? Theme.completionGreen.opacity(0.15) : .clear)
                            .frame(width: 20, height: 20)
                            .overlay {
                                if isCompleted {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(Theme.completionGreen)
                                }
                            }

                        Text(habit.name)
                            .font(.body)
                            .fontWeight(.medium)
                            .foregroundStyle(isCompleted ? Theme.textTertiary : fg)
                            .strikethrough(isCompleted, color: Theme.textTertiary)

                        Spacer()
                    }
                    .padding(.vertical, 3)
                }
                .sensoryFeedback(.impact(flexibility: .soft), trigger: isCompleted)
            }
        }
    }

    private func toggleHabit(_ habit: Habit, isCompleted: Bool) {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        if isCompleted {
            // Remove today's completion
            habit.completions.removeAll { cal.isDate($0.date, inSameDayAs: today) }
        } else {
            // Add completion for today
            let completion = HabitCompletion(habitId: habit.id, date: today)
            habit.completions.append(completion)
        }
        try? modelContext.save()
    }
}
```

**Step 2: Update TodayView**

In `TodayView.swift`, make the following changes:

a) Add a `TaskService` and `ProjectService`:
```swift
@State private var hmTaskService = TaskService()
@State private var projectService = ProjectService()
```

b) Replace the `habitsSection` to use `HabitListView` instead of `HabitWheelView`:

Replace the existing `habitsSection` computed property with:
```swift
private var habitsSection: some View {
    VStack(alignment: .leading, spacing: 12) {
        collapsibleHeader("Habits", isExpanded: $habitsExpanded)

        if habitsExpanded {
            HabitListView()
                .transition(.opacity.combined(with: .move(edge: .top)))
        }
    }
}
```

c) Replace `workItemRow` to show project context. Replace the existing `workItemRow(item:)` method with a new version that accepts `HMTask` and shows the project name:

```swift
private func hmTaskRow(_ task: HMTask) -> some View {
    let isCompleted = task.status == .done
    return Button {
        Task {
            if isCompleted {
                _ = await hmTaskService.updateTask(id: task.id, update: HMTaskUpdate(status: "todo", completedAt: nil))
            } else {
                _ = await hmTaskService.updateTask(id: task.id, update: HMTaskUpdate(
                    status: "done",
                    completedAt: ISO8601DateFormatter().string(from: Date())
                ))
            }
        }
    } label: {
        HStack(spacing: 10) {
            Circle()
                .stroke(isCompleted ? Theme.completionGreen : borderColor, lineWidth: 1.5)
                .fill(isCompleted ? Theme.completionGreen.opacity(0.15) : .clear)
                .frame(width: 20, height: 20)
                .overlay {
                    if isCompleted {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.completionGreen)
                    }
                }

            VStack(alignment: .leading, spacing: 2) {
                Text(task.title)
                    .font(.body)
                    .fontWeight(.medium)
                    .foregroundStyle(isCompleted ? Theme.textTertiary : fg)
                    .strikethrough(isCompleted, color: Theme.textTertiary)

                if let project = projectService.projects.first(where: { $0.id == task.projectId }) {
                    let domainLabel = task.domain == "fbs" ? "FBS" : task.domain == "omnissa" ? "Omnissa" : "Personal"
                    Text("\(domainLabel) · \(project.name)")
                        .font(.caption2)
                        .foregroundStyle(Theme.textTertiary)
                }
            }

            if task.taskType == .must && !isCompleted {
                Circle()
                    .fill(Theme.urgencyRed)
                    .frame(width: 6, height: 6)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
    .sensoryFeedback(.impact(flexibility: .soft), trigger: isCompleted)
}
```

d) Update `mustSection` and `mitsSection` to use `hmTaskService`:

```swift
private var mustSection: some View {
    VStack(alignment: .leading, spacing: 8) {
        sectionLabel("MUST")

        if let task = hmTaskService.mustTask {
            hmTaskRow(task)
        } else {
            Text("No critical task set")
                .font(.subheadline)
                .foregroundStyle(Theme.textTertiary)
                .padding(.vertical, 4)
        }
    }
}

private var mitsSection: some View {
    VStack(alignment: .leading, spacing: 8) {
        sectionLabel("MITs")

        if hmTaskService.mits.isEmpty {
            Text("No high-priority tasks for today")
                .font(.subheadline)
                .foregroundStyle(Theme.textTertiary)
                .padding(.vertical, 4)
        } else {
            ForEach(hmTaskService.mits) { task in
                hmTaskRow(task)
            }
        }
    }
}
```

e) Add a daily win counter at the bottom of the Today section. Add this below `allTasksLink` in `todaySection`:

```swift
private var dailyWinCounter: some View {
    let mustDone = hmTaskService.tasks.filter { $0.taskType == .must && $0.status == .done }.count
    let mustTotal = hmTaskService.tasks.filter { $0.taskType == .must }.count
    let mitDone = hmTaskService.tasks.filter { $0.taskType == .mit && $0.status == .done }.count
    let mitTotal = min(hmTaskService.tasks.filter { $0.taskType == .mit }.count, 3)

    return Text("\(mustDone)/\(max(mustTotal, 1)) MUST · \(mitDone)/\(max(mitTotal, 3)) MITs")
        .font(.caption)
        .fontWeight(.medium)
        .foregroundStyle(Theme.textTertiary)
        .padding(.top, 8)
}
```

Add `dailyWinCounter` to the `todaySection` VStack, after `allTasksLink`.

f) Update the `.task` modifier to fetch from HughMann's tables:

```swift
.task(id: appState.activeDomain?.id) {
    await calendarService.requestAccess()
    let slug = appState.activeDomain?.slug
    await hmTaskService.fetchTodayTasks(domain: slug)
    await projectService.fetchProjects(domain: slug)
    await loadTodayNote()
}
```

**Step 3: Verify it compiles**

Run: Xcode build
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add ChiefOfStaffApp/Views/HabitListView.swift ChiefOfStaffApp/Views/TodayView.swift
git commit -m "feat: update TodayView — project labels, habit list, daily win counter"
```

---

### Task 17: Verify Full Build and Test on Simulator

**Step 1: Clean build**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 16' clean build 2>&1 | tail -20`
Expected: BUILD SUCCEEDED

**Step 2: Run on simulator**

Launch in Xcode (Cmd+R) targeting iPhone 16 simulator.

Verify:
- App launches and shows sign-in or Today tab
- Footer shows 4 tabs: Today, Work, Plan, Settings
- Today tab shows MUST/MITs (may be empty if no data)
- Work tab shows domain goal cards (may be empty if no domain_goals rows)
- Plan tab works (existing planning views)
- Settings tab works
- Chat bar appears at bottom

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: Phase 1 Foundation complete — 4-tab nav, HM models, pyramid drill-down"
```

---

## Summary

| Task | What | Files |
|---|---|---|
| 1 | HMTask model | Models/HMTask.swift |
| 2 | HMProject model | Models/HMProject.swift |
| 3 | HMDomainGoal model | Models/HMDomainGoal.swift |
| 4 | HMContentPiece + HMTopic models | Models/HMContent.swift |
| 5 | HMPlanningSession model | Models/HMPlanningSession.swift |
| 6 | SupabaseREST helper | Services/SupabaseREST.swift |
| 7 | TaskService | Services/TaskService.swift |
| 8 | ProjectService | Services/ProjectService.swift |
| 9 | DomainGoalService | Services/DomainGoalService.swift |
| 10 | ContentService | Services/ContentService.swift |
| 11 | WorkView (Level 1 — goal cards) | Views/WorkView.swift |
| 12 | ProjectListView (Level 2) | Views/ProjectListView.swift |
| 13 | ProjectDetailView (Level 3) | Views/ProjectDetailView.swift |
| 14 | FooterNav 5→4 tabs | Views/FooterNavigationView.swift |
| 15 | ContentView + iPadSplitView routing | ContentView.swift, Views/iPadSplitView.swift |
| 16 | TodayView updates + HabitListView | Views/TodayView.swift, Views/HabitListView.swift |
| 17 | Full build verification | — |
