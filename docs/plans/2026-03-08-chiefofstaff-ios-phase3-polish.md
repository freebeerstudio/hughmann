# ChiefOfStaff iOS Phase 3: Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inline editing for north stars, guardrails, and habits; update Month/Quarter/Year plan tabs to use HughMann's backend; deepen chat context injection.

**Architecture:** Extend existing SupabaseREST + services pattern. Add `updateProject` to ProjectService for north star/guardrails PATCH. Add `updateGoal` to DomainGoalService. Replace PlanningService calls in Month/Quarter/Year views with ProjectService + TaskService + DomainGoalService. Add habit management sheet to HabitListView.

**Tech Stack:** SwiftUI, SwiftData, Supabase REST API, @Observable services

---

### Task 1: Add `updateProject` to ProjectService

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Services/ProjectService.swift`

**Step 1: Add HMProjectUpdate struct and updateProject method**

Add to `ProjectService.swift`:

```swift
struct HMProjectUpdate: Encodable {
    var northStar: String?
    var guardrails: [String]?
    var status: String?
    var refinementCadence: String?

    enum CodingKeys: String, CodingKey {
        case northStar = "north_star"
        case guardrails, status
        case refinementCadence = "refinement_cadence"
    }
}
```

And add this method to `ProjectService`:

```swift
func updateProject(id: String, update: HMProjectUpdate) async -> HMProject? {
    do {
        let result: HMProject? = try await SupabaseREST.update("projects", id: id, body: update)
        if let updated = result, let idx = projects.firstIndex(where: { $0.id == id }) {
            projects[idx] = updated
        }
        return result
    } catch { return nil }
}
```

**Step 2: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Services/ProjectService.swift
git commit -m "feat: add updateProject to ProjectService for north star/guardrails editing"
```

---

### Task 2: Add `updateGoal` to DomainGoalService

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Services/DomainGoalService.swift`

**Step 1: Add update method**

Add struct and method:

```swift
struct HMGoalUpdate: Encodable {
    var statement: String?
    var reviewedAt: String?

    enum CodingKeys: String, CodingKey {
        case statement
        case reviewedAt = "reviewed_at"
    }
}
```

Add to `DomainGoalService`:

```swift
func updateGoal(id: String, update: HMGoalUpdate) async -> HMDomainGoal? {
    do {
        let result: HMDomainGoal? = try await SupabaseREST.update("domain_goals", id: id, body: update)
        if let updated = result, let idx = goals.firstIndex(where: { $0.id == id }) {
            goals[idx] = updated
        }
        return result
    } catch { return nil }
}
```

**Step 2: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Services/DomainGoalService.swift
git commit -m "feat: add updateGoal to DomainGoalService"
```

---

### Task 3: North Star inline editing in ProjectDetailView

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/ProjectDetailView.swift`

**Step 1: Add editing state and UI**

Add to `ProjectDetailView`:

```swift
@State private var projectService = ProjectService()
@State private var editingNorthStar = false
@State private var northStarDraft = ""
```

Replace the static north star text in `projectHeader` with an editable version:

```swift
if editingNorthStar {
    HStack {
        TextField("North star vision...", text: $northStarDraft, axis: .vertical)
            .font(.subheadline)
            .fontWeight(.light)
            .italic()
            .foregroundStyle(Theme.textSecondary)
            .lineLimit(2...4)
            .onSubmit { saveNorthStar() }

        Button { saveNorthStar() } label: {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Theme.completionGreen)
        }
        Button { editingNorthStar = false } label: {
            Image(systemName: "xmark.circle")
                .foregroundStyle(Theme.textTertiary)
        }
    }
} else {
    if let northStar = project.northStar, !northStar.isEmpty {
        Text(northStar)
            .font(.subheadline)
            .fontWeight(.light)
            .italic()
            .foregroundStyle(Theme.textSecondary)
            .onTapGesture {
                northStarDraft = project.northStar ?? ""
                editingNorthStar = true
            }
    } else {
        Button {
            northStarDraft = ""
            editingNorthStar = true
        } label: {
            Text("Add north star...")
                .font(.subheadline)
                .fontWeight(.light)
                .italic()
                .foregroundStyle(Theme.textTertiary)
        }
    }
}
```

Add the save method:

```swift
private func saveNorthStar() {
    editingNorthStar = false
    let draft = northStarDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !draft.isEmpty else { return }
    Task {
        _ = await projectService.updateProject(id: project.id, update: HMProjectUpdate(northStar: draft))
    }
}
```

**Step 2: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Views/ProjectDetailView.swift
git commit -m "feat: add inline north star editing in ProjectDetailView"
```

---

### Task 4: Guardrails add/remove in ProjectDetailView

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/ProjectDetailView.swift`

**Step 1: Add guardrails editing state**

Add state:
```swift
@State private var editingGuardrails = false
@State private var guardrailsDraft: [String] = []
@State private var newGuardrail = ""
```

**Step 2: Replace the guardrails section in projectHeader**

Replace the static guardrails display with an editable version. When `showGuardrails` is true:

```swift
if showGuardrails {
    VStack(alignment: .leading, spacing: 4) {
        if editingGuardrails {
            ForEach(guardrailsDraft.indices, id: \.self) { idx in
                HStack(spacing: 6) {
                    Text("·")
                        .foregroundStyle(Theme.textSecondary)
                    TextField("Guardrail", text: $guardrailsDraft[idx])
                        .font(.caption)
                        .fontWeight(.light)
                        .foregroundStyle(Theme.textSecondary)
                    Button {
                        guardrailsDraft.remove(at: idx)
                    } label: {
                        Image(systemName: "minus.circle")
                            .font(.caption2)
                            .foregroundStyle(Theme.urgencyRed)
                    }
                }
            }

            HStack(spacing: 6) {
                Text("+")
                    .foregroundStyle(Theme.textTertiary)
                TextField("Add guardrail...", text: $newGuardrail)
                    .font(.caption)
                    .fontWeight(.light)
                    .onSubmit {
                        let trimmed = newGuardrail.trimmingCharacters(in: .whitespacesAndNewlines)
                        if !trimmed.isEmpty {
                            guardrailsDraft.append(trimmed)
                            newGuardrail = ""
                        }
                    }
            }

            HStack(spacing: 12) {
                Button {
                    saveGuardrails()
                } label: {
                    Text("Save")
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Theme.completionGreen)
                }
                Button {
                    editingGuardrails = false
                } label: {
                    Text("Cancel")
                        .font(.caption)
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .padding(.top, 4)
        } else {
            ForEach(project.guardrails, id: \.self) { rail in
                Text("· \(rail)")
                    .font(.caption)
                    .fontWeight(.light)
                    .foregroundStyle(Theme.textSecondary)
            }

            Button {
                guardrailsDraft = project.guardrails
                newGuardrail = ""
                editingGuardrails = true
            } label: {
                Text("Edit")
                    .font(.caption2)
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(.top, 2)
        }
    }
    .transition(.opacity.combined(with: .move(edge: .top)))
}
```

Add save method:

```swift
private func saveGuardrails() {
    editingGuardrails = false
    let cleaned = guardrailsDraft
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    Task {
        _ = await projectService.updateProject(id: project.id, update: HMProjectUpdate(guardrails: cleaned))
    }
}
```

**Step 3: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add ChiefOfStaffApp/Views/ProjectDetailView.swift
git commit -m "feat: add guardrails add/remove editing in ProjectDetailView"
```

---

### Task 5: Habit management (add/edit/reorder/delete)

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/HabitListView.swift`

**Step 1: Add manage habits sheet**

Add state to `HabitListView`:

```swift
@State private var showManageSheet = false
@State private var newHabitName = ""
```

Add a "Manage" button below the habit list:

```swift
Button {
    showManageSheet = true
} label: {
    Text("Manage")
        .font(.caption2)
        .foregroundStyle(Theme.textTertiary)
}
.padding(.top, 4)
```

Add sheet:

```swift
.sheet(isPresented: $showManageSheet) {
    habitManageSheet
}
```

**Step 2: Build the manage sheet**

```swift
private var habitManageSheet: some View {
    NavigationStack {
        List {
            ForEach(habits) { habit in
                HStack {
                    Text(habit.name)
                        .font(.body)
                    Spacer()
                    Text("🔥 \(habit.currentStreak)d")
                        .font(.caption)
                        .foregroundStyle(Theme.textTertiary)
                }
            }
            .onDelete { indexSet in
                for idx in indexSet {
                    modelContext.delete(habits[idx])
                }
                try? modelContext.save()
            }
            .onMove { from, to in
                var ordered = habits.map { $0 }
                ordered.move(fromOffsets: from, toOffset: to)
                for (i, habit) in ordered.enumerated() {
                    habit.sortOrder = i
                }
                try? modelContext.save()
            }

            Section {
                HStack {
                    TextField("New habit name", text: $newHabitName)
                        .font(.body)
                    Button {
                        addHabit()
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .foregroundStyle(Theme.completionGreen)
                    }
                    .disabled(newHabitName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .navigationTitle("Manage Habits")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                EditButton()
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") { showManageSheet = false }
            }
        }
    }
    .presentationDetents([.medium])
}

private func addHabit() {
    let name = newHabitName.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty else { return }
    let habit = Habit(name: name, icon: "circle", colorRed: 0.6, colorGreen: 0.6, colorBlue: 0.6, sortOrder: habits.count)
    modelContext.insert(habit)
    try? modelContext.save()
    newHabitName = ""
}
```

**Step 3: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add ChiefOfStaffApp/Views/HabitListView.swift
git commit -m "feat: add habit management sheet (add, delete, reorder)"
```

---

### Task 6: Update Month plan tab to use HughMann backend

Replace the old `MonthPlanView` (which uses `PlanningService` edge functions) with a version backed by ProjectService, TaskService, and ContentService — showing projects due for refinement, completed tasks this month, and content pipeline summary.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/PlanningViews.swift` — Replace `MonthPlanView`

**Step 1: Rewrite MonthPlanView**

Replace the entire `MonthPlanView` struct (lines ~170-271) with:

```swift
struct MonthPlanView: View {
    @State private var projectService = ProjectService()
    @State private var taskService = TaskService()
    @State private var contentService = ContentService()
    @State private var goalService = DomainGoalService()
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme

    private var fg: Color { colorScheme == .dark ? Theme.textPrimaryDark : Theme.textPrimary }
    private var bg: Color { colorScheme == .dark ? Theme.backgroundDark : Theme.backgroundLight }
    private var borderColor: Color { colorScheme == .dark ? Theme.borderDark : Theme.border }
    private var cardBg: Color { colorScheme == .dark ? Theme.surfaceDark : .white }

    private var monthLabel: String {
        let fmt = DateFormatter()
        fmt.dateFormat = "MMMM yyyy"
        return fmt.string(from: Date())
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(monthLabel)
                    .font(.title)
                    .fontWeight(.light)
                    .foregroundStyle(fg)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                // Projects due for refinement
                refinementDueSection
                    .padding(.horizontal, 16)

                // Completed tasks this month
                completedTasksSection
                    .padding(.horizontal, 16)

                // Content pipeline summary
                contentSummarySection
                    .padding(.horizontal, 16)

                Spacer().frame(height: 24)
            }
        }
        .background(bg)
        .task {
            await goalService.fetchGoals()
            await projectService.fetchProjects(status: [.active])
            await taskService.fetchTasks(status: [.done])
            await contentService.fetchContent()
        }
    }

    private var refinementDueSection: some View {
        let due = projectService.projectsDueForRefinement()
        return VStack(alignment: .leading, spacing: 8) {
            Text("REFINEMENT DUE")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.textSecondary)
                .tracking(1.2)

            if due.isEmpty {
                Text("All projects up to date")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textTertiary)
            } else {
                ForEach(due) { project in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(project.name)
                                .font(.subheadline)
                                .fontWeight(.medium)
                                .foregroundStyle(fg)
                            if let next = project.nextRefinementDate {
                                Text("Due \(next, format: .dateTime.month(.abbreviated).day())")
                                    .font(.caption)
                                    .foregroundStyle(Theme.urgencyRed)
                            }
                        }
                        Spacer()
                        Text(project.refinementCadence.rawValue)
                            .font(.caption2)
                            .foregroundStyle(Theme.textTertiary)
                    }
                    .padding(12)
                    .background(cardBg)
                    .clipShape(.rect(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(borderColor, lineWidth: 0.5))
                }
            }
        }
    }

    private var completedTasksSection: some View {
        let completed = taskService.tasks.filter { $0.status == .done }
        let byProject = Dictionary(grouping: completed, by: { $0.projectId ?? "none" })

        return VStack(alignment: .leading, spacing: 8) {
            Text("COMPLETED THIS MONTH")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.textSecondary)
                .tracking(1.2)

            if completed.isEmpty {
                Text("No completed tasks yet")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textTertiary)
            } else {
                Text("\(completed.count) task\(completed.count == 1 ? "" : "s") completed")
                    .font(.subheadline)
                    .foregroundStyle(fg)

                ForEach(Array(byProject.keys.sorted()), id: \.self) { projectId in
                    let tasks = byProject[projectId] ?? []
                    let projectName = projectService.projects.first(where: { $0.id == projectId })?.name ?? "Other"
                    HStack {
                        Text(projectName)
                            .font(.caption)
                            .foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Text("\(tasks.count)")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundStyle(Theme.completionGreen)
                    }
                }
            }
        }
    }

    private var contentSummarySection: some View {
        let pieces = contentService.pieces
        let statusCounts = Dictionary(grouping: pieces, by: { $0.status })

        return VStack(alignment: .leading, spacing: 8) {
            Text("CONTENT PIPELINE")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.textSecondary)
                .tracking(1.2)

            if pieces.isEmpty {
                Text("No content pieces")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textTertiary)
            } else {
                let stages: [HMContentStatus] = [.idea, .drafting, .review, .approved, .scheduled, .published]
                HStack(spacing: 12) {
                    ForEach(stages, id: \.self) { stage in
                        VStack(spacing: 2) {
                            Text("\(statusCounts[stage]?.count ?? 0)")
                                .font(.subheadline)
                                .fontWeight(.medium)
                                .foregroundStyle(fg)
                            Text(stage.label)
                                .font(.system(size: 8))
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                }
            }
        }
    }
}
```

**Step 2: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Views/PlanningViews.swift
git commit -m "feat: rewrite MonthPlanView to use HughMann backend (projects, tasks, content)"
```

---

### Task 7: Update Quarter plan tab to use HughMann backend

Replace `QuarterPlanView` with domain goals review, project health cards, and "Start quarterly review with Hugh" button.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/PlanningViews.swift` — Replace `QuarterPlanView`

**Step 1: Rewrite QuarterPlanView**

Replace the entire `QuarterPlanView` struct with:

```swift
struct QuarterPlanView: View {
    @State private var goalService = DomainGoalService()
    @State private var projectService = ProjectService()
    @State private var taskService = TaskService()
    @State private var showChat = false
    @State private var chatService = ChatService()
    @Environment(AppState.self) private var appState
    @Environment(\.colorScheme) private var colorScheme

    private var fg: Color { colorScheme == .dark ? Theme.textPrimaryDark : Theme.textPrimary }
    private var bg: Color { colorScheme == .dark ? Theme.backgroundDark : Theme.backgroundLight }
    private var borderColor: Color { colorScheme == .dark ? Theme.borderDark : Theme.border }
    private var cardBg: Color { colorScheme == .dark ? Theme.surfaceDark : .white }

    private var quarterLabel: String {
        let month = Calendar.current.component(.month, from: Date())
        let quarter = ((month - 1) / 3) + 1
        let year = Calendar.current.component(.year, from: Date())
        return "Q\(quarter) \(year)"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(quarterLabel)
                    .font(.title)
                    .fontWeight(.light)
                    .foregroundStyle(fg)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                // Domain goals review
                domainGoalsSection
                    .padding(.horizontal, 16)

                // Project health
                projectHealthSection
                    .padding(.horizontal, 16)

                // Start review button
                Button {
                    showChat = true
                } label: {
                    Text("Start Quarterly Review with Hugh")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundStyle(fg)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(borderColor, lineWidth: 1)
                        )
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
        }
        .background(bg)
        .task {
            await goalService.fetchGoals()
            await projectService.fetchProjects(status: [.active, .planning, .paused])
            await taskService.fetchTasks()
        }
        .sheet(isPresented: $showChat) {
            ChatSheetView(
                chatService: chatService,
                prefill: quarterReviewPrefill
            )
        }
    }

    private var domainGoalsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("DOMAIN GOALS")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.textSecondary)
                .tracking(1.2)

            if goalService.goals.isEmpty {
                Text("No domain goals defined")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textTertiary)
            } else {
                ForEach(goalService.goals) { goal in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(goal.domainLabel)
                                .font(.subheadline)
                                .fontWeight(.semibold)
                                .foregroundStyle(fg)
                            Spacer()
                            if !goal.isReviewedThisQuarter {
                                Text("Needs Review")
                                    .font(.caption2)
                                    .foregroundStyle(Theme.urgencyRed)
                            } else {
                                Text("Reviewed")
                                    .font(.caption2)
                                    .foregroundStyle(Theme.completionGreen)
                            }
                        }
                        Text(goal.statement)
                            .font(.subheadline)
                            .fontWeight(.light)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .padding(12)
                    .background(cardBg)
                    .clipShape(.rect(cornerRadius: 8))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(borderColor, lineWidth: 0.5))
                }
            }
        }
    }

    private var projectHealthSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PROJECT HEALTH")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Theme.textSecondary)
                .tracking(1.2)

            ForEach(projectService.projects) { project in
                let projectTasks = taskService.tasks.filter { $0.projectId == project.id }
                let activeTasks = projectTasks.filter { $0.status != .done }.count
                let blockedTasks = projectTasks.filter { $0.status == .blocked }.count

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(project.name)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundStyle(fg)
                        Spacer()
                        Text(project.status.rawValue)
                            .font(.caption2)
                            .foregroundStyle(Theme.textTertiary)
                    }

                    if let northStar = project.northStar, !northStar.isEmpty {
                        Text(northStar)
                            .font(.caption)
                            .fontWeight(.light)
                            .italic()
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                    }

                    HStack(spacing: 12) {
                        Text("\(activeTasks) active")
                            .font(.caption2)
                            .foregroundStyle(Theme.textTertiary)
                        if blockedTasks > 0 {
                            Text("\(blockedTasks) blocked")
                                .font(.caption2)
                                .foregroundStyle(Theme.urgencyRed)
                        }
                    }

                    if !project.guardrails.isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            ForEach(project.guardrails.prefix(3), id: \.self) { rail in
                                Text("· \(rail)")
                                    .font(.system(size: 10))
                                    .foregroundStyle(Theme.textTertiary)
                            }
                        }
                    }
                }
                .padding(12)
                .background(cardBg)
                .clipShape(.rect(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(borderColor, lineWidth: 0.5))
            }
        }
    }

    private var quarterReviewPrefill: String? {
        let goals = goalService.goals.map { "\($0.domainLabel): \($0.statement)" }.joined(separator: "\n")
        let projects = projectService.projects.map { $0.name }.joined(separator: ", ")
        return "Let's do a quarterly review.\n\nDomain goals:\n\(goals)\n\nActive projects: \(projects)\n\nHow are we tracking? What should we adjust?"
    }
}
```

**Step 2: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 3: Commit**

```bash
git add ChiefOfStaffApp/Views/PlanningViews.swift
git commit -m "feat: rewrite QuarterPlanView with domain goals review and project health"
```

---

### Task 8: Update Year plan tab to show full north stars by project

The existing YearPlanView is extensive and already functional with annual planning (themes, vision, misogi, anti-goals). We keep it but add a section showing all project north stars and guardrails grouped by domain — the "full pyramid view" the design doc calls for.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/PlanningViews.swift` — Add HughMann project data to `YearPlanView`

**Step 1: Add services to YearPlanView**

Add to the existing state declarations:

```swift
@State private var goalService = DomainGoalService()
@State private var projectService = ProjectService()
```

**Step 2: Add pyramid section**

After the existing plan content (before the closing of the ScrollView VStack), add:

```swift
// Full pyramid — all north stars + guardrails by domain
pyramidSection
    .padding(.horizontal, 16)
    .padding(.bottom, 24)
```

Add the pyramid section computed property:

```swift
private var pyramidSection: some View {
    VStack(alignment: .leading, spacing: 16) {
        Text("THE PYRAMID")
            .font(.caption)
            .fontWeight(.semibold)
            .foregroundStyle(Theme.textSecondary)
            .tracking(1.2)

        ForEach(goalService.goals) { goal in
            let domainProjects = projectService.projects.filter { $0.domain == goal.domain }

            VStack(alignment: .leading, spacing: 8) {
                Text(goal.domainLabel)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(fg)

                Text(goal.statement)
                    .font(.caption)
                    .fontWeight(.light)
                    .italic()
                    .foregroundStyle(Theme.textSecondary)

                ForEach(domainProjects) { project in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(project.name)
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundStyle(fg)
                            Spacer()
                            Text(project.status.rawValue)
                                .font(.system(size: 9))
                                .foregroundStyle(Theme.textTertiary)
                        }

                        if let ns = project.northStar, !ns.isEmpty {
                            Text(ns)
                                .font(.caption)
                                .fontWeight(.light)
                                .italic()
                                .foregroundStyle(Theme.textSecondary)
                        }

                        ForEach(project.guardrails, id: \.self) { rail in
                            Text("· \(rail)")
                                .font(.system(size: 10))
                                .foregroundStyle(Theme.textTertiary)
                        }
                    }
                    .padding(.leading, 12)
                }
            }
            .padding(12)
            .background(surface)
            .clipShape(.rect(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(border, lineWidth: 0.5))
        }
    }
}
```

**Step 3: Add data fetch to the .task modifier**

In the existing `.task(id:)` block, add:

```swift
async let goalFetch: () = goalService.fetchGoals()
async let projFetch: () = projectService.fetchProjects()
```

And include them in the `await` tuple.

**Step 4: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 5: Commit**

```bash
git add ChiefOfStaffApp/Views/PlanningViews.swift
git commit -m "feat: add full pyramid view (north stars + guardrails by domain) to YearPlanView"
```

---

### Task 9: Deepen chat context injection

Update ContentView's chat bar `onTap` to inject richer context — project details when in Work tab drill-downs, task/content counts, and goal statements.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/ContentView.swift`
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Services/ChatService.swift`

**Step 1: Add project context fields to ChatService**

Add to `ChatService`:

```swift
/// Rich structured context about the current screen for Hugh
var projectContext: [String: Any]? = nil
```

In `executeStreamingRequest`, merge `projectContext` into the request body alongside `screenContext`.

**Step 2: Update ContentView context injection**

In the `ChatBarView` `onTap` closure for the "Work" case, check if there's a current project/goal in the navigation stack and inject it:

```swift
case "Work":
    chatService.screenContext = [
        "screen": "work",
        "view": "domain_goals"
    ]
```

This is already done. The deeper context happens in the individual views (ProjectDetailView, ProjectListView) which can set `appState.pendingChatMessage` with project-specific prefill. No further changes needed here beyond what's already built.

**Step 3: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`

**Step 4: Commit**

```bash
git add ChiefOfStaffApp/ContentView.swift ChiefOfStaffApp/Services/ChatService.swift
git commit -m "feat: deepen chat context injection with project details"
```

---

### Task 10: Domain goal statement editing from WorkView

Allow tapping the goal statement in WorkView's goal cards to edit it inline.

**Files:**
- Modify: `/Users/waynebridges/chief-of-staff-ios/ChiefOfStaffApp/Views/WorkView.swift`

**Step 1: Add editing state**

Add to `WorkView`:

```swift
@State private var editingGoalId: String? = nil
@State private var goalStatementDraft = ""
```

**Step 2: Update goalCard to support editing**

In the `goalCard` function, replace the static `Text(goal.statement)` with:

```swift
if editingGoalId == goal.id {
    HStack {
        TextField("Goal statement...", text: $goalStatementDraft, axis: .vertical)
            .font(.body)
            .fontWeight(.light)
            .foregroundStyle(fg)
            .lineLimit(1...3)
            .onSubmit { saveGoalStatement(goal) }

        Button { saveGoalStatement(goal) } label: {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Theme.completionGreen)
        }
        Button {
            editingGoalId = nil
        } label: {
            Image(systemName: "xmark.circle")
                .foregroundStyle(Theme.textTertiary)
        }
    }
} else {
    Text(goal.statement)
        .font(.body)
        .fontWeight(.light)
        .foregroundStyle(fg)
        .onLongPressGesture {
            goalStatementDraft = goal.statement
            editingGoalId = goal.id
        }
}
```

Add save method:

```swift
private func saveGoalStatement(_ goal: HMDomainGoal) {
    let draft = goalStatementDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    editingGoalId = nil
    guard !draft.isEmpty else { return }
    Task {
        _ = await goalService.updateGoal(id: goal.id, update: HMGoalUpdate(statement: draft))
    }
}
```

**Step 3: Build and verify**

Run: `cd /Users/waynebridges/chief-of-staff-ios && xcodebuild -scheme ChiefOfStaffApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -5`
Expected: BUILD SUCCEEDED

**Step 4: Commit**

```bash
git add ChiefOfStaffApp/Views/WorkView.swift
git commit -m "feat: add domain goal statement inline editing via long press"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | `updateProject` service method | ProjectService.swift |
| 2 | `updateGoal` service method | DomainGoalService.swift |
| 3 | North star inline editing | ProjectDetailView.swift |
| 4 | Guardrails add/remove | ProjectDetailView.swift |
| 5 | Habit management sheet | HabitListView.swift |
| 6 | Month plan → HughMann backend | PlanningViews.swift |
| 7 | Quarter plan → HughMann backend | PlanningViews.swift |
| 8 | Year plan pyramid section | PlanningViews.swift |
| 9 | Chat context deepening | ContentView.swift, ChatService.swift |
| 10 | Domain goal editing | WorkView.swift |
