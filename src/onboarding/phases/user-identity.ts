import * as p from '@clack/prompts'
import type { UserIdentity } from '../types.js'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)', hint: 'New York, Miami, Atlanta' },
  { value: 'America/Chicago', label: 'Central (CT)', hint: 'Chicago, Dallas, Houston' },
  { value: 'America/Denver', label: 'Mountain (MT)', hint: 'Denver, Phoenix, Salt Lake' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)', hint: 'LA, San Francisco, Seattle' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)', hint: 'Anchorage, Fairbanks' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)', hint: 'Honolulu' },
  { value: 'Europe/London', label: 'GMT / BST', hint: 'London, Dublin, Lisbon' },
  { value: 'Europe/Paris', label: 'CET / CEST', hint: 'Paris, Berlin, Madrid, Rome' },
  { value: 'Europe/Helsinki', label: 'EET / EEST', hint: 'Helsinki, Athens, Bucharest' },
  { value: 'Asia/Dubai', label: 'GST', hint: 'Dubai, Abu Dhabi' },
  { value: 'Asia/Kolkata', label: 'IST', hint: 'Mumbai, Delhi, Bangalore' },
  { value: 'Asia/Shanghai', label: 'CST (China)', hint: 'Beijing, Shanghai, Hong Kong' },
  { value: 'Asia/Tokyo', label: 'JST', hint: 'Tokyo, Osaka, Seoul' },
  { value: 'Australia/Sydney', label: 'AEST / AEDT', hint: 'Sydney, Melbourne' },
  { value: 'other', label: 'Other...', hint: 'Enter your IANA timezone manually' },
]

export async function collectUserIdentity(systemName: string, existing?: UserIdentity): Promise<UserIdentity | symbol> {
  p.note(
    `Build a picture of who you are.\n` +
    `This helps ${systemName} understand your world, your work style,\n` +
    `and how to best support you. Be as honest and specific as you can.`,
    existing ? 'Edit Your Identity' : 'Your Identity'
  )

  const name = await p.text({
    message: "What's your name?",
    placeholder: 'First name or whatever you go by',
    defaultValue: existing?.name,
    validate: (v) => {
      if (!v?.trim()) return 'A name is required'
    },
  })
  if (p.isCancel(name)) return name

  const description = await p.text({
    message: `Tell ${systemName} about yourself. What do you do? What drives you? What matters most?`,
    placeholder: 'e.g., "Sales engineer by day, building a web design business on the side. I value deep work, clear systems, and helping people solve real problems."',
    defaultValue: existing?.description,
    validate: (v) => {
      if (!v?.trim()) return 'This is important for building context'
      if (v.trim().length < 20) return 'Give a bit more detail so the system really understands you'
    },
  })
  if (p.isCancel(description)) return description

  // Determine initial timezone value for the select
  const existingTzInList = TIMEZONES.some(tz => tz.value === existing?.timezone)
  const tzInitial = existing ? (existingTzInList ? existing.timezone : 'other') : undefined

  const tz = await p.select({
    message: "What's your timezone?",
    initialValue: tzInitial,
    options: TIMEZONES,
  })
  if (p.isCancel(tz)) return tz

  let timezone = String(tz)
  if (timezone === 'other') {
    const custom = await p.text({
      message: 'Enter your IANA timezone (e.g., Asia/Singapore):',
      placeholder: 'Continent/City',
      defaultValue: existingTzInList ? undefined : existing?.timezone,
      validate: (v) => {
        if (!v?.includes('/')) return 'Use IANA format: Continent/City'
      },
    })
    if (p.isCancel(custom)) return custom
    timezone = String(custom)
  }

  const peakHours = await p.select({
    message: 'When do you do your best, most focused work?',
    initialValue: existing?.peakHours,
    options: [
      { value: 'early-morning', label: 'Early morning (5am-8am)', hint: 'Before the world wakes up' },
      { value: 'morning', label: 'Morning (8am-12pm)', hint: 'Fresh mind, clear thinking' },
      { value: 'afternoon', label: 'Afternoon (12pm-5pm)', hint: 'After lunch, warmed up' },
      { value: 'evening', label: 'Evening (5pm-9pm)', hint: 'After the day winds down' },
      { value: 'night', label: 'Night (9pm+)', hint: 'When it gets quiet' },
    ],
  })
  if (p.isCancel(peakHours)) return peakHours

  const communicationStyle = await p.select({
    message: 'How do you prefer to receive information?',
    initialValue: existing?.communicationStyle,
    options: [
      { value: 'bullets', label: 'Bullet points & data', hint: 'Quick to scan, numbers over narratives' },
      { value: 'narrative', label: 'Narrative & context', hint: 'Full picture with the "why" behind things' },
      { value: 'actionable', label: 'Quick & actionable', hint: 'Just tell me what to do next' },
      { value: 'thorough', label: 'Detailed & thorough', hint: 'Deep analysis, all the options, trade-offs included' },
    ],
  })
  if (p.isCancel(communicationStyle)) return communicationStyle

  const habits = await p.text({
    message: 'What daily habits do you want to track? (comma-separated, or leave blank for defaults)',
    placeholder: 'e.g., exercise, reading, meditation, inbox zero, learning',
    defaultValue: existing?.habits,
  })
  if (p.isCancel(habits)) return habits

  return {
    name: String(name),
    description: String(description),
    timezone,
    peakHours: String(peakHours),
    communicationStyle: String(communicationStyle),
    habits: String(habits).trim() || undefined,
  }
}
