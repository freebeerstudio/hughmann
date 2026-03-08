import EventKit
import Foundation

// Read tomorrow's calendar events using EventKit and output JSON.
// Usage: swift calendar-events.swift [calendarName]

let calendarName = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Calendar"

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
var accessGranted = false

if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { granted, _ in
        accessGranted = granted
        semaphore.signal()
    }
} else {
    store.requestAccess(to: .event) { granted, _ in
        accessGranted = granted
        semaphore.signal()
    }
}
semaphore.wait()

guard accessGranted else {
    fputs("Error: Calendar access denied. Grant access in System Settings > Privacy & Security > Calendars.\n", stderr)
    print("[]")
    exit(1)
}

// Find matching calendar
let calendars = store.calendars(for: .event).filter { $0.title == calendarName }
guard !calendars.isEmpty else {
    fputs("Warning: No calendar named '\(calendarName)' found.\n", stderr)
    print("[]")
    exit(0)
}

// Tomorrow's date range
let cal = Calendar.current
let today = cal.startOfDay(for: Date())
let tomorrow = cal.date(byAdding: .day, value: 1, to: today)!
let dayAfter = cal.date(byAdding: .day, value: 2, to: today)!

let predicate = store.predicateForEvents(withStart: tomorrow, end: dayAfter, calendars: calendars)
let events = store.events(matching: predicate)

let formatter = DateFormatter()
formatter.dateFormat = "h:mm a"
formatter.locale = Locale(identifier: "en_US")

var results: [[String: Any]] = []
for event in events {
    var attendeeEmails: [String] = []
    if let attendees = event.attendees {
        for a in attendees {
            let url = a.url
            if url.scheme == "mailto" {
                attendeeEmails.append(url.absoluteString.replacingOccurrences(of: "mailto:", with: ""))
            }
        }
    }

    let entry: [String: Any] = [
        "title": event.title ?? "",
        "startTime": event.isAllDay ? "" : formatter.string(from: event.startDate),
        "endTime": event.isAllDay ? "" : formatter.string(from: event.endDate),
        "location": event.location ?? "",
        "attendees": attendeeEmails,
        "notes": event.notes ?? "",
        "calendarName": event.calendar.title,
        "isAllDay": event.isAllDay
    ]
    results.append(entry)
}

let jsonData = try! JSONSerialization.data(withJSONObject: results, options: .prettyPrinted)
print(String(data: jsonData, encoding: .utf8)!)
