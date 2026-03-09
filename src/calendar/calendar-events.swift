import EventKit
import Foundation

// Read calendar events using EventKit and output JSON.
//
// Usage:
//   calendar-events <calendarName>                    # tomorrow's events (legacy)
//   calendar-events --range <start> <end>             # date range, all calendars
//   calendar-events --range <start> <end> <calendar>  # date range, specific calendar
//
// Dates: YYYY-MM-DD format. End date is exclusive.

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

// Parse arguments
let args = CommandLine.arguments
var startDate: Date
var endDate: Date
var calendarFilter: String? = nil

let isoFormatter = ISO8601DateFormatter()
isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

let dateOnlyFormatter = DateFormatter()
dateOnlyFormatter.dateFormat = "yyyy-MM-dd"
dateOnlyFormatter.timeZone = TimeZone.current

let isoOutputFormatter = ISO8601DateFormatter()
isoOutputFormatter.formatOptions = [.withInternetDateTime]

if args.count >= 4 && args[1] == "--range" {
    // Range mode: calendar-events --range 2026-03-09 2026-03-16 [CalendarName]
    guard let start = dateOnlyFormatter.date(from: args[2]),
          let end = dateOnlyFormatter.date(from: args[3]) else {
        fputs("Error: Invalid date format. Use YYYY-MM-DD.\n", stderr)
        print("[]")
        exit(1)
    }
    startDate = start
    endDate = end
    if args.count >= 5 {
        calendarFilter = args[4]
    }
} else {
    // Legacy mode: calendar-events [CalendarName] — tomorrow only
    let cal = Calendar.current
    let today = cal.startOfDay(for: Date())
    startDate = cal.date(byAdding: .day, value: 1, to: today)!
    endDate = cal.date(byAdding: .day, value: 2, to: today)!
    if args.count > 1 && args[1] != "--range" {
        calendarFilter = args[1]
    }
}

// Get calendars
var calendars: [EKCalendar]
if let filter = calendarFilter {
    calendars = store.calendars(for: .event).filter { $0.title == filter }
    if calendars.isEmpty {
        fputs("Warning: No calendar named '\(filter)' found.\n", stderr)
        print("[]")
        exit(0)
    }
} else {
    calendars = store.calendars(for: .event)
}

let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: calendars)
let events = store.events(matching: predicate)

let timeFormatter = DateFormatter()
timeFormatter.dateFormat = "h:mm a"
timeFormatter.locale = Locale(identifier: "en_US")

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
        "startTime": isoOutputFormatter.string(from: event.startDate),
        "endTime": isoOutputFormatter.string(from: event.endDate),
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
