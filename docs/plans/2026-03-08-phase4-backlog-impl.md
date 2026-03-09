# Phase 4: Backlog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship domain filtering, multi-note capture, smart notes pipeline, and calendar integration — turning ChiefOfStaff from a dashboard into a professional-grade operations tool.

**Architecture:** Phase 4A (Domain Filtering + Multi-Note) is pure iOS work against existing APIs. Phase 4B (Notes Pipeline) extends the `memory-api` edge function with classification and adds a `NoteService`. Phase 4C (Calendar Integration) creates a shared calendar store in Supabase. Phase 4D (Autonomous Operations) is backend-heavy HughMann daemon work documented for future implementation.

**Tech Stack:** SwiftUI, SwiftData, SupabaseREST, Supabase Edge Functions (Deno/TypeScript), HughMann daemon (Node/TypeScript)

---

## Phase 4A: Domain Filtering + Multi-Note Today Tab

### Task 1: Domain Filtering — WorkView

**Context:** WorkView fetches all domain goals globally but doesn't filter by `activeDomain`. When the user selects "FBS" in the domain switcher, WorkView should show only the FBS goal card (and "All" shows everything).

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/WorkView.swift`

**Step 1: Add domain filtering to WorkView**

The `activeDomain` is available via `appState`. Filter the displayed goals, projects, and tasks by the active domain's slug. When `activeDomain` is nil (meaning "All"), show everything.

```swift
// In WorkView body, replace the ForEach block:
ForEach(filteredGoals) { goal in
    NavigationLink(value: goal) {
        goalCard(goal)
    }
    .buttonStyle(.plain)
}

// Add computed property:
private var filteredGoals: [HMDomainGoal] {
    guard let domain = appState.activeDomain, domain.slug != "all" else {
        return goalService.goals
    }
    return goalService.goals.filter { $0.domain == domain.slug }
}
```

Also update the `.task` modifier to re-fetch when domain changes:

```swift
.task(id: appState.activeDomain?.id) {
    await goalService.fetchGoals()
    let slug = appState.activeDomain?.slug
    await projectService.fetchProjects(domain: slug == "all" ? nil : slug, status: [.active, .planning, .incubator])
    await taskService.fetchTasks(domain: slug == "all" ? nil : slug, status: [.todo, .inProgress, .blocked])
}
```

**Step 2: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 3: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/WorkView.swift
git commit -m "feat: filter WorkView by active domain"
```

---

### Task 2: Domain Filtering — MonthPlanView

**Context:** MonthPlanView shows completed tasks, refinement-due projects, and content pipeline. None of these filter by domain. The view needs to pass the active domain slug to all service fetch calls and filter computed properties.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/PlanningViews.swift` (MonthPlanView, starts ~line 185)

**Step 1: Add domain awareness to MonthPlanView**

Add `@Environment(AppState.self) private var appState` (it's missing from MonthPlanView).

Update the `.task` modifier to pass domain and re-trigger on domain change:

```swift
.task(id: appState.activeDomain?.id) {
    let slug = appState.activeDomain?.slug
    let domainFilter = slug == "all" ? nil : slug
    async let projects: () = projectService.fetchProjects(domain: domainFilter, status: [.active])
    async let tasks: () = taskService.fetchTasks(domain: domainFilter, status: [.done])
    async let content: () = contentService.fetchContent(domain: domainFilter)
    async let goals: () = domainGoalService.fetchGoals()
    _ = await (projects, tasks, content, goals)
}
```

**Step 2: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 3: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/PlanningViews.swift
git commit -m "feat: filter MonthPlanView by active domain"
```

---

### Task 3: Domain Filtering — QuarterPlanView

**Context:** QuarterPlanView shows domain goals and project health. It fetches globally. Needs domain filtering via `appState.activeDomain`.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/PlanningViews.swift` (QuarterPlanView, starts ~line 440)

**Step 1: Add domain awareness to QuarterPlanView**

Add `@Environment(AppState.self) private var appState`.

Filter displayed goals:

```swift
private var filteredGoals: [HMDomainGoal] {
    guard let domain = appState.activeDomain, domain.slug != "all" else {
        return goalService.goals
    }
    return goalService.goals.filter { $0.domain == domain.slug }
}
```

Filter displayed projects:

```swift
private var filteredProjects: [HMProject] {
    guard let domain = appState.activeDomain, domain.slug != "all" else {
        return projectService.projects
    }
    return projectService.projects.filter { $0.domain == domain.slug }
}
```

Replace `goalService.goals` with `filteredGoals` and `projectService.projects` with `filteredProjects` in the body.

Update `.task` to re-trigger on domain change:

```swift
.task(id: appState.activeDomain?.id) {
    let slug = appState.activeDomain?.slug
    let domainFilter = slug == "all" ? nil : slug
    async let gFetch: () = goalService.fetchGoals()
    async let pFetch: () = projectService.fetchProjects(domain: domainFilter, status: [.active, .planning, .paused])
    async let tFetch: () = taskService.fetchTasks(domain: domainFilter)
    _ = await (gFetch, pFetch, tFetch)
}
```

Also update `chatPrefill` to use `filteredGoals` and `filteredProjects`.

**Step 2: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 3: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/PlanningViews.swift
git commit -m "feat: filter QuarterPlanView by active domain"
```

---

### Task 4: Domain Filtering — YearPlanView

**Context:** YearPlanView shows the full pyramid (goals → north stars → guardrails). It uses `PlanningService` for north stars but also has `goalService` and `projectService`. Filter all by domain.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/PlanningViews.swift` (YearPlanView, starts ~line 638)

**Step 1: Read YearPlanView fully to understand its structure**

Read from line 638 to end of file to see the full YearPlanView implementation before making changes.

**Step 2: Add domain filtering**

YearPlanView already has `@Environment(AppState.self) private var appState`. Add filtered computed properties for goals and projects, similar to QuarterPlanView. Update the `.task` modifier to pass domain and use `task(id: appState.activeDomain?.id)` for re-fetch.

**Step 3: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 4: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/PlanningViews.swift
git commit -m "feat: filter YearPlanView by active domain"
```

---

### Task 5: Domain Filtering — WeekPlanView

**Context:** WeekPlanView uses `PlanningService` which calls the old edge function. It already has `appState` and re-fetches on domain change (`task(id:)` at line 177). The PlanningService likely needs domain passed through, or the view needs to filter results. Check if `PlanningService.fetchWeek` accepts a domain parameter.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/PlanningViews.swift` (WeekPlanView, starts ~line 78)
- Possibly modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Services/PlanningService.swift`

**Step 1: Read PlanningService to understand its API**

Read the full PlanningService to understand what `fetchWeek` does and whether it supports domain filtering.

**Step 2: Add domain parameter if needed**

If PlanningService doesn't support domain filtering, either:
- Add a `domain` parameter to `fetchWeek` and pass it to the API call
- Or filter results client-side

**Step 3: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 4: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/PlanningViews.swift ChiefOfStaffApp/Services/PlanningService.swift
git commit -m "feat: filter WeekPlanView by active domain"
```

---

### Task 6: Multi-Note — SwiftData Note Model

**Context:** Replace the single `noteText` field in TodayView with a list of notes. Notes persist locally via SwiftData and sync to Supabase `memory-api`. Each note has a body, optional title, timestamp, optional tag (e.g. "meeting"), and the domain it was captured in.

**Files:**
- Create: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Models/Note.swift`
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/ChiefOfStaffAppApp.swift` (add Note to model container)

**Step 1: Create the Note SwiftData model**

```swift
import Foundation
import SwiftData

@Model
final class Note {
    var body: String
    var title: String?
    var tag: String?        // "meeting", "idea", "customer", nil for general
    var domain: String      // domain slug when captured
    var createdAt: Date
    var updatedAt: Date
    var syncedAt: Date?     // nil = not yet synced to Supabase
    var supabaseId: String? // memory_embeddings ID after sync

    init(body: String, title: String? = nil, tag: String? = nil, domain: String = "personal") {
        self.body = body
        self.title = title
        self.tag = tag
        self.domain = domain
        self.createdAt = Date()
        self.updatedAt = Date()
    }
}
```

**Step 2: Register Note in the SwiftData model container**

In `ChiefOfStaffAppApp.swift`, add `Note.self` to the `ModelContainer` schema array alongside `Habit.self`, `HabitCompletion.self`, etc.

**Step 3: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 4: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Models/Note.swift ChiefOfStaffApp/ChiefOfStaffAppApp.swift
git commit -m "feat: add Note SwiftData model"
```

---

### Task 7: Multi-Note — NoteService for Supabase Sync

**Context:** NoteService syncs local SwiftData notes to `memory-api`. On save, it calls `POST /memory-api/save` with the note content. On load, it fetches from `GET /memory-api/list?path_prefix=notes/today/{date}` and reconciles with local SwiftData.

**Files:**
- Create: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Services/NoteService.swift`

**Step 1: Create NoteService**

```swift
import Foundation
import Observation
import Supabase

@Observable
final class NoteService: @unchecked Sendable {
    var isSyncing = false

    /// Save a note to memory-api
    func syncNote(_ note: Note) async -> Bool {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let datePath = dateFormatter.string(from: note.createdAt)
        let timestamp = ISO8601DateFormatter().string(from: note.createdAt)
        let filePath = "notes/today/\(datePath)/\(timestamp)"

        do {
            let token = try await supabase.auth.session.accessToken
            let url = URL(string: "https://rmtxneyqxbjucxizqtfs.supabase.co/functions/v1/memory-api/save")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(Config.EXPO_PUBLIC_SUPABASE_ANON_KEY, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

            var content = note.body
            if let title = note.title, !title.isEmpty {
                content = "# \(title)\n\n\(content)"
            }
            if let tag = note.tag, !tag.isEmpty {
                content = "[\(tag)] \(content)"
            }

            let body: [String: Any] = [
                "file_path": filePath,
                "content": content,
                "domain": note.domain,
                "memory_type": "note",
                "importance": 0.5
            ]
            request.httpBody = try JSONSerialization.data(withJSONObject: body)

            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode < 300 {
                return true
            }
        } catch {}
        return false
    }

    /// Delete a note from memory-api by its synced ID
    func deleteRemoteNote(supabaseId: String) async {
        do {
            let token = try await supabase.auth.session.accessToken
            let url = URL(string: "https://rmtxneyqxbjucxizqtfs.supabase.co/functions/v1/memory-api/\(supabaseId)")!
            var request = URLRequest(url: url)
            request.httpMethod = "DELETE"
            request.setValue(Config.EXPO_PUBLIC_SUPABASE_ANON_KEY, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            _ = try? await URLSession.shared.data(for: request)
        } catch {}
    }
}
```

**Step 2: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 3: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Services/NoteService.swift
git commit -m "feat: add NoteService for Supabase sync"
```

---

### Task 8: Multi-Note — Replace Single Note with Notes List

**Context:** Replace the single `noteText` TextField in TodayView's notes section with a scrollable list of Note objects from SwiftData. Add ability to create, view, and delete notes.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/TodayView.swift`

**Step 1: Replace single note state with SwiftData query**

Remove:
```swift
@State private var noteText: String = ""
@State private var isLoadingNote = false
@State private var noteSaveIndicator = false
@State private var noteSaveTimer: Task<Void, Never>?
```

Add:
```swift
@Query(sort: \Note.createdAt, order: .reverse) private var allNotes: [Note]
@State private var noteService = NoteService()
@State private var showNoteEditor = false
@State private var editingNote: Note?
```

Add computed property to filter to today's notes:
```swift
private var todayNotes: [Note] {
    let startOfDay = Calendar.current.startOfDay(for: selectedDate)
    let endOfDay = Calendar.current.date(byAdding: .day, value: 1, to: startOfDay)!
    return allNotes.filter { $0.createdAt >= startOfDay && $0.createdAt < endOfDay }
}
```

**Step 2: Rewrite notesSection**

Replace the single TextField with a list of note cards and an "Add Note" button:

```swift
private var notesSection: some View {
    VStack(alignment: .leading, spacing: 12) {
        HStack {
            collapsibleHeader("Notes", isExpanded: $notesExpanded)

            Spacer()

            if notesExpanded {
                Button {
                    editingNote = nil
                    showNoteEditor = true
                } label: {
                    Image(systemName: "plus")
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }

        if notesExpanded {
            if todayNotes.isEmpty {
                Text("No notes yet today")
                    .font(.subheadline)
                    .fontWeight(.light)
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.vertical, 4)
            } else {
                ForEach(todayNotes) { note in
                    noteCard(note)
                }
            }
        }
    }
    .sheet(isPresented: $showNoteEditor) {
        NoteEditorSheet(note: editingNote, domain: appState.activeDomain?.slug ?? "personal", noteService: noteService)
    }
}

private func noteCard(_ note: Note) -> some View {
    Button {
        editingNote = note
        showNoteEditor = true
    } label: {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                if let title = note.title, !title.isEmpty {
                    Text(title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(fg)
                }

                Spacer()

                Text(note.createdAt, format: .dateTime.hour().minute())
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)

                if let tag = note.tag {
                    Text(tag)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule().fill(borderColor.opacity(0.3))
                        )
                }
            }

            Text(note.body)
                .font(.subheadline)
                .fontWeight(.light)
                .foregroundStyle(fg)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(cardBg)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(borderColor.opacity(0.5), lineWidth: 0.5)
        )
    }
    .buttonStyle(.plain)
    .contextMenu {
        Button(role: .destructive) {
            deleteNote(note)
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }
}

private func deleteNote(_ note: Note) {
    if let supabaseId = note.supabaseId {
        Task { await noteService.deleteRemoteNote(supabaseId: supabaseId) }
    }
    modelContext.delete(note)
}
```

**Step 3: Remove old note persistence methods**

Remove the `todayNotePath`, `scheduleNoteSave()`, `saveTodayNote()`, and `loadTodayNote()` methods.

Remove `await loadTodayNote()` from the `.task(id:)` modifier.

**Step 4: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 5: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/TodayView.swift
git commit -m "feat: replace single note with multi-note list"
```

---

### Task 9: Multi-Note — Note Editor Sheet

**Context:** A sheet for creating/editing notes. Shows title (optional), body (required), tag picker, and save/cancel buttons. On save, writes to SwiftData and fires a background Supabase sync.

**Files:**
- Create: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/NoteEditorSheet.swift`

**Step 1: Create NoteEditorSheet**

```swift
import SwiftUI
import SwiftData

struct NoteEditorSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    let note: Note?          // nil = new note
    let domain: String
    let noteService: NoteService

    @State private var title: String = ""
    @State private var body: String = ""
    @State private var selectedTag: String? = nil

    private let tags = ["meeting", "idea", "customer", "personal"]

    private var fg: Color { colorScheme == .dark ? Theme.textPrimaryDark : Theme.textPrimary }
    private var bg: Color { colorScheme == .dark ? Theme.backgroundDark : Theme.backgroundLight }
    private var borderColor: Color { colorScheme == .dark ? Theme.borderDark : Theme.border }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    TextField("Title (optional)", text: $title)
                        .font(.title3)
                        .fontWeight(.medium)
                        .foregroundStyle(fg)

                    // Tag picker
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(tags, id: \.self) { tag in
                                Button {
                                    selectedTag = selectedTag == tag ? nil : tag
                                } label: {
                                    Text(tag)
                                        .font(.caption)
                                        .fontWeight(.medium)
                                        .foregroundStyle(selectedTag == tag ? .white : Theme.textSecondary)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(
                                            Capsule()
                                                .fill(selectedTag == tag ? fg.opacity(0.8) : borderColor.opacity(0.2))
                                        )
                                }
                            }
                        }
                    }

                    TextEditor(text: $body)
                        .font(.body)
                        .fontWeight(.light)
                        .foregroundStyle(fg)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 200)
                }
                .padding(16)
            }
            .background(bg)
            .navigationTitle(note == nil ? "New Note" : "Edit Note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { saveNote() }
                        .disabled(body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .onAppear {
            if let note {
                title = note.title ?? ""
                body = note.body
                selectedTag = note.tag
            }
        }
    }

    private func saveNote() {
        let trimmedBody = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedBody.isEmpty else { return }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)

        if let note {
            // Update existing
            note.body = trimmedBody
            note.title = trimmedTitle.isEmpty ? nil : trimmedTitle
            note.tag = selectedTag
            note.updatedAt = Date()
            note.syncedAt = nil // mark for re-sync
        } else {
            // Create new
            let newNote = Note(
                body: trimmedBody,
                title: trimmedTitle.isEmpty ? nil : trimmedTitle,
                tag: selectedTag,
                domain: domain
            )
            modelContext.insert(newNote)

            // Background sync
            Task {
                let success = await noteService.syncNote(newNote)
                if success {
                    await MainActor.run {
                        newNote.syncedAt = Date()
                    }
                }
            }
        }

        dismiss()
    }
}
```

**Step 2: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 3: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/NoteEditorSheet.swift
git commit -m "feat: add NoteEditorSheet for create/edit notes"
```

---

## Phase 4B: Smart Notes Pipeline

### Task 10: Notes Classification Edge Function

**Context:** Extend `memory-api` (or create a new `notes-api` edge function) to classify incoming notes using Claude. When a note is saved with `memory_type: "note"`, the function should classify it (customer note, project idea, personal thought, meeting notes) and tag it with appropriate metadata before storing.

**Files:**
- Modify: `/Users/waynebridges/Foundry/supabase/functions/memory-api/index.ts`

**Step 1: Read the current memory-api implementation**

Understand the save endpoint's current behavior — it chunks content, generates embeddings, and stores in `memory_embeddings`.

**Step 2: Add classification to the save path**

After saving the note, if `memory_type === "note"`, call Claude to classify:

```typescript
// After successful save, classify if it's a note
if (body.memory_type === 'note') {
    // Fire-and-forget classification
    classifyNote(body.content, body.domain, fileId).catch(() => {});
}

async function classifyNote(content: string, domain: string, fileId: string) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{
                role: 'user',
                content: `Classify this note. Return JSON only: {"type": "customer|project|personal|meeting", "customer_name": "name or null", "project_hint": "name or null", "summary": "one line"}

Note (domain: ${domain}):
${content}`
            }]
        })
    });

    if (response.ok) {
        const result = await response.json();
        const classification = JSON.parse(result.content[0].text);

        // Update the memory_embeddings row with classification metadata
        await supabaseClient.from('memory_embeddings').update({
            metadata: {
                classification: classification.type,
                customer_name: classification.customer_name,
                project_hint: classification.project_hint,
                summary: classification.summary,
            }
        }).eq('id', fileId);
    }
}
```

**Step 3: Test the edge function locally**

```bash
cd /Users/waynebridges/Foundry
npx supabase functions serve memory-api
# In another terminal, test with curl
```

**Step 4: Deploy**

```bash
npx supabase functions deploy memory-api
```

**Step 5: Commit**

```bash
cd /Users/waynebridges/Foundry
git add supabase/functions/memory-api/index.ts
git commit -m "feat: add note classification to memory-api"
```

---

### Task 11: Customer Association for Notes

**Context:** When a note is classified as `type: "customer"` and has a `customer_name`, look up the customer in the `customers` table and tag the note with `customer_id`. This enables customer intelligence queries later.

**Files:**
- Modify: `/Users/waynebridges/Foundry/supabase/functions/memory-api/index.ts`

**Step 1: Add customer lookup to classification**

After classification returns `type: "customer"` with a `customer_name`:

```typescript
if (classification.type === 'customer' && classification.customer_name) {
    // Fuzzy match against customers table
    const { data: customers } = await supabaseClient
        .from('customers')
        .select('id, name')
        .ilike('name', `%${classification.customer_name}%`)
        .limit(1);

    if (customers && customers.length > 0) {
        classification.customer_id = customers[0].id;
    }
}
```

Then include `customer_id` in the metadata update.

**Step 2: Test and deploy**

Same as Task 10.

**Step 3: Commit**

```bash
cd /Users/waynebridges/Foundry
git add supabase/functions/memory-api/index.ts
git commit -m "feat: associate customer notes with customer records"
```

---

### Task 12: Tag Picker in NoteEditorSheet — Customer Association

**Context:** When the user selects the "customer" tag in NoteEditorSheet, show a customer picker so they can associate the note with a specific customer. This provides manual override for the automatic classification.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/NoteEditorSheet.swift`
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Models/Note.swift` (add customerId field)

**Step 1: Add customerId to Note model**

```swift
var customerId: String?  // Associated customer ID
```

**Step 2: Add customer picker to NoteEditorSheet**

When `selectedTag == "customer"`, show a searchable list of customers from the active domain. Use `WorkItemService` or a direct Supabase query to fetch customers.

**Step 3: Pass customerId in the sync payload**

Update `NoteService.syncNote()` to include the customer_id in the save body if present.

**Step 4: Build, verify, commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/NoteEditorSheet.swift ChiefOfStaffApp/Models/Note.swift
git commit -m "feat: add customer association to notes"
```

---

## Phase 4C: Calendar Integration

### Task 13: Calendar Events Supabase Table

**Context:** Create a shared calendar store in Supabase that both Elle (who scrapes the Omnissa calendar) and the iOS app can read/write. This replaces the email-based calendar data flow.

**Files:**
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/supabase.ts` (add migration)
- Modify: `/Users/waynebridges/HughMann/src/adapters/data/types.ts` (add interface methods)

**Step 1: Add calendar_events table migration**

In the `MIGRATION_SQL` constant in `supabase.ts`, add:

```sql
CREATE TABLE IF NOT EXISTS calendar_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    location TEXT,
    attendees JSONB DEFAULT '[]',
    calendar_name TEXT,
    domain TEXT,
    source TEXT DEFAULT 'manual',  -- 'eventkit', 'google', 'manual', 'elle'
    external_id TEXT,              -- de-dupe from external calendars
    notes TEXT,                    -- meeting notes attached to this event
    customer_id UUID REFERENCES customers(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(external_id, source)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_time ON calendar_events(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_calendar_events_domain ON calendar_events(domain);
```

**Step 2: Add DataAdapter methods**

In `types.ts`:

```typescript
// Calendar Events
listCalendarEvents(startDate: string, endDate: string, domain?: string): Promise<CalendarEvent[]>;
upsertCalendarEvent(event: Partial<CalendarEvent>): Promise<CalendarEvent>;
```

**Step 3: Implement in all three adapters**

Supabase, SQLite, Turso implementations.

**Step 4: Build and test**

```bash
cd /Users/waynebridges/HughMann
npm run typecheck && npm test
```

**Step 5: Commit**

```bash
cd /Users/waynebridges/HughMann
git add src/adapters/data/types.ts src/adapters/data/supabase.ts src/adapters/data/sqlite.ts src/adapters/data/turso.ts
git commit -m "feat: add calendar_events table and DataAdapter methods"
```

---

### Task 14: Calendar Sync Service (iOS)

**Context:** Create a CalendarSyncService in the iOS app that reads from the `calendar_events` Supabase table. This replaces the EventKit-only approach for meeting display, while still keeping EventKit as a local data source.

**Files:**
- Create: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Services/CalendarSyncService.swift`

**Step 1: Create CalendarSyncService**

```swift
import Foundation
import Observation

struct HMCalendarEvent: Codable, Identifiable, Sendable {
    let id: String
    var title: String
    var startTime: String
    var endTime: String
    var location: String?
    var attendees: [String]?
    var calendarName: String?
    var domain: String?
    var source: String?
    var notes: String?
    var customerId: String?

    enum CodingKeys: String, CodingKey {
        case id, title, location, attendees, domain, source, notes
        case startTime = "start_time"
        case endTime = "end_time"
        case calendarName = "calendar_name"
        case customerId = "customer_id"
    }

    var startDate: Date {
        ISO8601DateFormatter().date(from: startTime) ?? Date()
    }
    var endDate: Date {
        ISO8601DateFormatter().date(from: endTime) ?? Date()
    }
}

@Observable
final class CalendarSyncService: @unchecked Sendable {
    var events: [HMCalendarEvent] = []
    var isLoading = false

    func fetchEvents(for date: Date, domain: String? = nil) async {
        isLoading = true
        defer { isLoading = false }

        let cal = Calendar.current
        let start = cal.startOfDay(for: date)
        let end = cal.date(byAdding: .day, value: 1, to: start)!
        let iso = ISO8601DateFormatter()

        var query: [String: String] = [
            "start_time": "gte.\(iso.string(from: start))",
            "end_time": "lte.\(iso.string(from: end))",
            "order": "start_time.asc"
        ]
        if let domain, domain != "all" {
            query["domain"] = "eq.\(domain)"
        }

        do {
            events = try await SupabaseREST.fetch("calendar_events", query: query)
        } catch {}
    }

    func updateNotes(eventId: String, notes: String) async -> HMCalendarEvent? {
        struct NotesUpdate: Encodable {
            let notes: String
            let updatedAt: String
            enum CodingKeys: String, CodingKey {
                case notes
                case updatedAt = "updated_at"
            }
        }
        let update = NotesUpdate(notes: notes, updatedAt: ISO8601DateFormatter().string(from: Date()))
        do {
            let updated: HMCalendarEvent? = try await SupabaseREST.update("calendar_events", id: eventId, body: update)
            if let updated, let idx = events.firstIndex(where: { $0.id == eventId }) {
                events[idx] = updated
            }
            return updated
        } catch { return nil }
    }
}
```

**Step 2: Build and verify**

Run: `xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' build`

**Step 3: Commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Services/CalendarSyncService.swift
git commit -m "feat: add CalendarSyncService for Supabase calendar events"
```

---

### Task 15: Meeting Notes on Calendar Items

**Context:** In TodayView's meetings section, tapping a meeting opens a detail view where the user can view event details and attach notes directly to the calendar event. These notes sync via the `calendar_events.notes` column.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/TodayView.swift` (meetings section)
- Create: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/MeetingDetailSheet.swift`

**Step 1: Create MeetingDetailSheet**

A sheet showing event title, time, location, attendees, and a TextEditor for meeting notes. Save button syncs notes to `CalendarSyncService.updateNotes()`.

**Step 2: Wire up in TodayView**

Replace the static `meetingRow` with a tappable button that opens the `MeetingDetailSheet`.

Add `@State private var calendarSyncService = CalendarSyncService()` to TodayView and use it alongside (or instead of) the EventKit `calendarService` for displaying meetings.

**Step 3: Build, verify, commit**

```bash
cd /Users/waynebridges/chief-of-staff-ios
git add ChiefOfStaffApp/Views/TodayView.swift ChiefOfStaffApp/Views/MeetingDetailSheet.swift
git commit -m "feat: add meeting notes on calendar items"
```

---

### Task 16: Elle Calendar Sync Script

**Context:** Elle currently scrapes the Omnissa calendar and sends an email. Instead, write a script that pushes events directly to the `calendar_events` Supabase table with `source: 'elle'`. This can run on Elle's cron or as a Trigger.dev task.

**Files:**
- Create: `/Users/waynebridges/HughMann/src/trigger/calendar-sync.ts` (or standalone script)

**Step 1: Design the sync script**

The script should:
1. Read events from Elle's Apple Calendar (using the existing `apple-calendar.ts` Swift binary approach)
2. Upsert to `calendar_events` table with `source: 'elle'` and `external_id` for dedup
3. Only sync events for the next 7 days
4. Run every 30 minutes during business hours

**Step 2: Implement and test**

This is a HughMann backend task. Implementation depends on Elle's calendar access setup.

**Step 3: Commit**

```bash
cd /Users/waynebridges/HughMann
git add src/trigger/calendar-sync.ts
git commit -m "feat: add Elle calendar sync to Supabase"
```

---

## Phase 4D: Autonomous Operations (DONE)

Detailed plan: `/Users/waynebridges/HughMann/docs/plans/2026-03-09-phase4d-autonomous-ops.md`

### Autonomous Refinement with Approval Gate — DONE
1. `approval_mode` field on projects table + HMProject model
2. `auto-refine` skill (autonomous variant of `/refine`)
3. Approval bundles table + 3 internal tools (create, list, resolve)
4. Daemon auto-refine trigger with hourly throttle
5. `approval-lifecycle` Trigger.dev task (timeout handling)
6. iOS approval bundle UI in WorkView

### Project Lifecycle Management — DONE
1. `register_project` internal tool (scans directory, detects stack/git/CLAUDE.md)
2. `provision_project` internal tool (creates dir/git/repo/CLAUDE.md)
3. Claude Code dispatch in daemon task executor
4. New project fields: `local_path`, `stack`, `claude_md_exists`

### Deferred to Future
- Push notification infrastructure (APNs)
- Migration script for existing projects to `~/Projects/` structure
- GitHub MCP + Vercel MCP for service provisioning

---

## Execution Order

**Phase 4A:** Tasks 1-9 — Domain Filtering + Multi-Note — DONE
**Phase 4B:** Tasks 10-12 — Smart Notes Pipeline — DONE
**Phase 4C:** Tasks 13-16 — Calendar Integration — DONE
**Phase 4D:** 15 tasks — Autonomous Operations — DONE

Total: 31 tasks completed across all phases
