import * as p from '@clack/prompts'
import pc from 'picocolors'
import type { LifeDomain } from '../types.js'

const DOMAIN_TYPES = [
  { value: 'career', label: 'Career / Day Job', hint: 'Your primary employment' },
  { value: 'business', label: 'Business / Entrepreneurship', hint: 'A business you own or are building' },
  { value: 'personal', label: 'Personal / Lifestyle', hint: 'Health, habits, relationships, home' },
  { value: 'education', label: 'Education / Learning', hint: 'Courses, certifications, skill building' },
  { value: 'health', label: 'Health / Wellness', hint: 'Fitness, nutrition, mental health' },
  { value: 'creative', label: 'Creative / Side Project', hint: 'Content creation, art, open source, hobbies' },
  { value: 'community', label: 'Community / Social', hint: 'Volunteering, mentoring, networking' },
]

async function collectOneDomain(systemName: string, domainNumber: number): Promise<LifeDomain | symbol | null> {
  if (domainNumber > 1) {
    const addMore = await p.confirm({
      message: 'Add another domain?',
      initialValue: domainNumber <= 3,
    })
    if (p.isCancel(addMore)) return addMore
    if (!addMore) return null
  }

  p.log.step(pc.bold(`Domain ${domainNumber}`))

  const name = await p.text({
    message: 'What do you call this domain?',
    placeholder: domainNumber === 1
      ? 'e.g., "Work - Acme Corp" or "My Business - Studio Name"'
      : 'e.g., "Personal" or "Side Project - App Name"',
    validate: (v) => {
      if (!v?.trim()) return 'Give this domain a name'
    },
  })
  if (p.isCancel(name)) return name

  const type = await p.select({
    message: `What type of domain is "${String(name)}"?`,
    options: DOMAIN_TYPES,
  })
  if (p.isCancel(type)) return type

  const description = await p.text({
    message: 'Describe this domain in a sentence or two.',
    placeholder: 'What is it? What does it involve?',
    validate: (v) => {
      if (!v?.trim()) return 'A brief description helps the system understand context'
    },
  })
  if (p.isCancel(description)) return description

  const primaryGoal = await p.text({
    message: `What's your primary goal in "${String(name)}" right now?`,
    placeholder: 'The one thing that matters most in this area',
    validate: (v) => {
      if (!v?.trim()) return 'Even a rough goal helps the system prioritize'
    },
  })
  if (p.isCancel(primaryGoal)) return primaryGoal

  return {
    name: String(name),
    type: String(type),
    description: String(description),
    primaryGoal: String(primaryGoal),
    quarterlyGoals: '',
    activeProjects: '',
    tools: '',
    biggestChallenge: '',
  }
}

export async function collectDomains(systemName: string): Promise<LifeDomain[] | symbol> {
  p.note(
    `Now let's map the areas of your life that ${systemName} will manage.\n\n` +
    `Domains are the big categories: your job, your business, your health,\n` +
    `your side projects. Each gets its own context, goals, and priorities.\n\n` +
    `Most people have 2-5 domains. You can always add more later.`,
    'Life Domains'
  )

  const domains: LifeDomain[] = []
  let domainNumber = 1

  while (true) {
    const result = await collectOneDomain(systemName, domainNumber)
    if (p.isCancel(result)) return result as symbol
    if (result === null) break
    domains.push(result)
    domainNumber++

    if (domainNumber > 7) {
      p.log.warn('That\'s a lot of domains. You can always add more later.')
      break
    }
  }

  if (domains.length === 0) {
    p.log.warn('You need at least one domain. Let\'s add one.')
    const result = await collectOneDomain(systemName, 1)
    if (p.isCancel(result)) return result as symbol
    if (result) domains.push(result)
  }

  return domains
}

export async function deepDiveDomains(systemName: string, domains: LifeDomain[]): Promise<LifeDomain[] | symbol> {
  p.note(
    `Let's go deeper on each domain. This is where ${systemName}\n` +
    `builds real understanding of your world.\n\n` +
    `Take your time here. The more context you provide,\n` +
    `the better ${systemName} can plan and execute autonomously.`,
    'Going Deeper'
  )

  for (const domain of domains) {
    p.log.step(pc.bold(domain.name))

    const quarterlyGoals = await p.text({
      message: `What are your top goals for "${domain.name}" this quarter?`,
      placeholder: 'List 2-3 goals, one per line. These become your guiding objectives.',
      validate: (v) => {
        if (!v?.trim()) return 'Even rough goals help. What are you working toward?'
      },
    })
    if (p.isCancel(quarterlyGoals)) return quarterlyGoals
    domain.quarterlyGoals = String(quarterlyGoals)

    const activeProjects = await p.text({
      message: `What projects are currently active in "${domain.name}"?`,
      placeholder: 'List each project. Include status if you know it (planning, building, launching, maintaining).',
    })
    if (p.isCancel(activeProjects)) return activeProjects
    domain.activeProjects = String(activeProjects)

    const tools = await p.text({
      message: `What tools, systems, or platforms do you use for "${domain.name}"?`,
      placeholder: 'e.g., "Slack, Salesforce, Obsidian, Figma, GitHub"',
    })
    if (p.isCancel(tools)) return tools
    domain.tools = String(tools)

    const challenge = await p.text({
      message: `What's the biggest challenge or blocker in "${domain.name}" right now?`,
      placeholder: 'What keeps you stuck? What would you fix if you had a magic wand?',
    })
    if (p.isCancel(challenge)) return challenge
    domain.biggestChallenge = String(challenge)
  }

  return domains
}
