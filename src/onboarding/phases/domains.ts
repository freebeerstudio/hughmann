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

async function collectOneDomain(systemName: string, domainNumber: number, existing?: LifeDomain): Promise<LifeDomain | symbol | null> {
  if (!existing && domainNumber > 1) {
    const addMore = await p.confirm({
      message: 'Add another domain?',
      initialValue: domainNumber <= 3,
    })
    if (p.isCancel(addMore)) return addMore
    if (!addMore) return null
  }

  if (existing) {
    p.log.step(pc.bold(`Editing: ${existing.name}`))
  } else {
    p.log.step(pc.bold(`Domain ${domainNumber}`))
  }

  const name = await p.text({
    message: 'What do you call this domain?',
    placeholder: domainNumber === 1
      ? 'e.g., "Work - Acme Corp" or "My Business - Studio Name"'
      : 'e.g., "Personal" or "Side Project - App Name"',
    defaultValue: existing?.name,
    validate: (v) => {
      if (!v?.trim()) return 'Give this domain a name'
    },
  })
  if (p.isCancel(name)) return name

  const type = await p.select({
    message: `What type of domain is "${String(name)}"?`,
    initialValue: existing?.type,
    options: DOMAIN_TYPES,
  })
  if (p.isCancel(type)) return type

  const description = await p.text({
    message: 'Describe this domain in a sentence or two.',
    placeholder: 'What is it? What does it involve?',
    defaultValue: existing?.description,
    validate: (v) => {
      if (!v?.trim()) return 'A brief description helps the system understand context'
    },
  })
  if (p.isCancel(description)) return description

  const domainGoal = await p.text({
    message: `What's the permanent guiding goal for "${String(name)}"?`,
    placeholder: 'One aspirational sentence — e.g., "Increase revenue daily" or "Build the life I want"',
    defaultValue: existing?.domainGoal || existing?.primaryGoal,
    validate: (v) => {
      if (!v?.trim()) return 'Even a rough goal helps the system prioritize'
    },
  })
  if (p.isCancel(domainGoal)) return domainGoal

  return {
    name: String(name),
    type: String(type),
    description: String(description),
    primaryGoal: String(domainGoal),
    domainGoal: String(domainGoal),
    activeProjects: existing?.activeProjects ?? '',
    tools: existing?.tools ?? '',
    biggestChallenge: existing?.biggestChallenge ?? '',
  }
}

export async function collectDomains(systemName: string, existing?: LifeDomain[]): Promise<LifeDomain[] | symbol> {
  if (existing && existing.length > 0) {
    // Editing mode — show existing domains, allow edit/add/remove
    p.note(
      `You have ${existing.length} domain${existing.length > 1 ? 's' : ''} configured.\n` +
      `You can edit existing ones, add new ones, or remove any.`,
      'Edit Life Domains'
    )

    const domains: LifeDomain[] = []

    for (const domain of existing) {
      const action = await p.select({
        message: `${domain.name} (${domain.type})`,
        options: [
          { value: 'keep', label: 'Keep as-is', hint: domain.primaryGoal.slice(0, 50) },
          { value: 'edit', label: 'Edit', hint: 'Update this domain' },
          { value: 'remove', label: 'Remove', hint: 'Delete this domain' },
        ],
      })
      if (p.isCancel(action)) return action

      if (String(action) === 'keep') {
        domains.push(domain)
      } else if (String(action) === 'edit') {
        const edited = await collectOneDomain(systemName, domains.length + 1, domain)
        if (p.isCancel(edited)) return edited as symbol
        if (edited) domains.push(edited)
      }
      // 'remove' — just don't add it
    }

    // Offer to add more
    let domainNumber = domains.length + 1
    while (true) {
      const addMore = await p.confirm({
        message: 'Add another domain?',
        initialValue: false,
      })
      if (p.isCancel(addMore)) return addMore
      if (!addMore) break

      const result = await collectOneDomain(systemName, domainNumber)
      if (p.isCancel(result)) return result as symbol
      if (result) {
        domains.push(result)
        domainNumber++
      }
    }

    if (domains.length === 0) {
      p.log.warn('You need at least one domain.')
      const result = await collectOneDomain(systemName, 1)
      if (p.isCancel(result)) return result as symbol
      if (result) domains.push(result)
    }

    return domains
  }

  // First time — guided setup
  p.note(
    `Map the areas of your life that ${systemName} will manage.\n\n` +
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
  // Check if any domains need deep dive (missing active projects)
  const needsDeepDive = domains.some(d => !d.activeProjects)
  if (!needsDeepDive) {
    const goDeeper = await p.confirm({
      message: 'All domains have detail already. Want to review and update the deep-dive info?',
      initialValue: false,
    })
    if (p.isCancel(goDeeper)) return goDeeper
    if (!goDeeper) return domains
  }

  p.note(
    `Let's go deeper on each domain. This is where ${systemName}\n` +
    `builds real understanding of your world.\n\n` +
    `For each domain, we'll define active projects. Each project\n` +
    `should have a North Star (vivid vision of success) that traces\n` +
    `back to the domain goal.\n\n` +
    `Take your time here. The more context you provide,\n` +
    `the better ${systemName} can plan and execute autonomously.`,
    'Going Deeper'
  )

  for (const domain of domains) {
    p.log.step(pc.bold(domain.name))
    p.log.message(pc.dim(`Domain goal: ${domain.domainGoal}`))

    const activeProjects = await p.text({
      message: `What projects are currently active in "${domain.name}"?`,
      placeholder: 'List each project. Include status if you know it (planning, building, launching, maintaining).',
      defaultValue: domain.activeProjects || undefined,
    })
    if (p.isCancel(activeProjects)) return activeProjects
    domain.activeProjects = String(activeProjects)

    const tools = await p.text({
      message: `What tools, systems, or platforms do you use for "${domain.name}"?`,
      placeholder: 'e.g., "Slack, Salesforce, Obsidian, Figma, GitHub"',
      defaultValue: domain.tools || undefined,
    })
    if (p.isCancel(tools)) return tools
    domain.tools = String(tools)

    const challenge = await p.text({
      message: `What's the biggest challenge or blocker in "${domain.name}" right now?`,
      placeholder: 'What keeps you stuck? What would you fix if you had a magic wand?',
      defaultValue: domain.biggestChallenge || undefined,
    })
    if (p.isCancel(challenge)) return challenge
    domain.biggestChallenge = String(challenge)
  }

  return domains
}
