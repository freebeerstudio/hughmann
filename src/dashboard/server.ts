/**
 * HughMann Dashboard — read-only local web UI.
 *
 * Serves a self-contained HTML dashboard on localhost showing:
 * - Tasks by status
 * - Active projects
 * - Recent sessions
 * - Daemon stats and nudges
 *
 * Run via: hughmann dashboard
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HUGHMANN_HOME } from '../config.js'
import type { DataAdapter } from '../adapters/data/types.js'

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HughMann Dashboard</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
    --green: #3fb950; --yellow: #d29922; --red: #f85149; --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  .container { max-width: 1200px; margin: 0 auto; padding: 1rem; }
  header { display: flex; align-items: center; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; }
  header h1 { font-size: 1.5rem; font-weight: 600; }
  header .meta { color: var(--muted); font-size: 0.85rem; margin-left: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1rem; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
  .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem; }
  .card h2 .count { background: var(--border); border-radius: 10px; padding: 0 8px; font-size: 0.8rem; color: var(--muted); }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
  .badge-todo { background: #1f6feb33; color: var(--accent); }
  .badge-in_progress { background: #d2992233; color: var(--yellow); }
  .badge-done { background: #3fb95033; color: var(--green); }
  .badge-blocked { background: #f8514933; color: var(--red); }
  .badge-backlog { background: #30363d; color: var(--muted); }
  .badge-active { background: #3fb95033; color: var(--green); }
  .badge-paused { background: #d2992233; color: var(--yellow); }
  .badge-planning { background: #bc8cff33; color: var(--purple); }
  .task-item, .project-item, .session-item { padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
  .task-item:last-child, .project-item:last-child, .session-item:last-child { border-bottom: none; }
  .task-title { font-weight: 500; font-size: 0.9rem; }
  .task-meta { color: var(--muted); font-size: 0.8rem; margin-top: 2px; }
  .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
  .stat { text-align: center; }
  .stat .value { font-size: 1.8rem; font-weight: 700; }
  .stat .label { color: var(--muted); font-size: 0.8rem; }
  .stat.green .value { color: var(--green); }
  .stat.yellow .value { color: var(--yellow); }
  .stat.red .value { color: var(--red); }
  .stat.accent .value { color: var(--accent); }
  .empty { color: var(--muted); font-style: italic; padding: 1rem 0; text-align: center; }
  .refresh { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
  .refresh:hover { border-color: var(--accent); }
  .priority { font-weight: 700; margin-right: 4px; }
  .p0,.p1 { color: var(--red); }
  .p2 { color: var(--yellow); }
  .p3 { color: var(--muted); }
  .p4,.p5 { color: var(--border); }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>HughMann</h1>
    <button class="refresh" onclick="loadAll()">Refresh</button>
    <div class="meta" id="lastUpdate"></div>
  </header>
  <div class="grid">
    <div class="card">
      <h2>Stats</h2>
      <div class="stat-grid" id="stats">
        <div class="stat"><div class="value">-</div><div class="label">Loading...</div></div>
      </div>
    </div>
    <div class="card">
      <h2>Active Tasks <span class="count" id="taskCount">0</span></h2>
      <div id="tasks"><div class="empty">Loading...</div></div>
    </div>
    <div class="card">
      <h2>Projects <span class="count" id="projectCount">0</span></h2>
      <div id="projects"><div class="empty">Loading...</div></div>
    </div>
    <div class="card">
      <h2>Recent Sessions <span class="count" id="sessionCount">0</span></h2>
      <div id="sessions"><div class="empty">Loading...</div></div>
    </div>
  </div>
</div>
<script>
async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}
function badge(status) {
  return '<span class="badge badge-' + status + '">' + status.replace('_', ' ') + '</span>';
}
function priority(p) {
  return '<span class="priority p' + p + '">P' + p + '</span>';
}
function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  return Math.floor(hr / 24) + 'd ago';
}
async function loadAll() {
  try {
    const [tasks, projects, sessions, stats] = await Promise.all([
      fetchJSON('/api/tasks'),
      fetchJSON('/api/projects'),
      fetchJSON('/api/sessions'),
      fetchJSON('/api/stats'),
    ]);
    renderTasks(tasks);
    renderProjects(projects);
    renderSessions(sessions);
    renderStats(stats, tasks, projects);
    document.getElementById('lastUpdate').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error(e);
  }
}
function renderTasks(tasks) {
  const el = document.getElementById('tasks');
  document.getElementById('taskCount').textContent = tasks.length;
  if (tasks.length === 0) { el.innerHTML = '<div class="empty">No active tasks</div>'; return; }
  el.innerHTML = tasks.map(t =>
    '<div class="task-item">' +
    '<div class="task-title">' + priority(t.priority) + ' ' + esc(t.title) + ' ' + badge(t.status) + '</div>' +
    '<div class="task-meta">' + (t.domain || '') + (t.project ? ' / ' + t.project : '') +
    (t.due_date ? ' | Due: ' + t.due_date : '') + ' | ' + timeAgo(t.created_at) + '</div>' +
    '</div>'
  ).join('');
}
function renderProjects(projects) {
  const el = document.getElementById('projects');
  document.getElementById('projectCount').textContent = projects.length;
  if (projects.length === 0) { el.innerHTML = '<div class="empty">No projects</div>'; return; }
  el.innerHTML = projects.map(p =>
    '<div class="project-item">' +
    '<div class="task-title">' + esc(p.name) + ' ' + badge(p.status) + '</div>' +
    '<div class="task-meta">' + (p.domain || 'no domain') +
    (p.goals && p.goals.length ? ' | ' + p.goals.length + ' goal(s)' : '') +
    ' | ' + timeAgo(p.updated_at) + '</div>' +
    '</div>'
  ).join('');
}
function renderSessions(sessions) {
  const el = document.getElementById('sessions');
  document.getElementById('sessionCount').textContent = sessions.length;
  if (sessions.length === 0) { el.innerHTML = '<div class="empty">No sessions</div>'; return; }
  el.innerHTML = sessions.map(s =>
    '<div class="session-item">' +
    '<div class="task-title">' + esc(s.title) + '</div>' +
    '<div class="task-meta">' + (s.domain || 'general') +
    ' | ' + (s.message_count || 0) + ' messages | ' + timeAgo(s.updated_at) + '</div>' +
    '</div>'
  ).join('');
}
function renderStats(stats, tasks, projects) {
  const todo = tasks.filter(t => t.status === 'todo').length;
  const inProg = tasks.filter(t => t.status === 'in_progress').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const activeProj = projects.filter(p => p.status === 'active').length;
  document.getElementById('stats').innerHTML =
    '<div class="stat accent"><div class="value">' + todo + '</div><div class="label">To Do</div></div>' +
    '<div class="stat yellow"><div class="value">' + inProg + '</div><div class="label">In Progress</div></div>' +
    '<div class="stat red"><div class="value">' + blocked + '</div><div class="label">Blocked</div></div>' +
    '<div class="stat green"><div class="value">' + activeProj + '</div><div class="label">Active Projects</div></div>' +
    (stats.completed != null ? '<div class="stat green"><div class="value">' + stats.completed + '</div><div class="label">Completed (all time)</div></div>' : '') +
    (stats.failed != null ? '<div class="stat red"><div class="value">' + stats.failed + '</div><div class="label">Failed (all time)</div></div>' : '');
}
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
loadAll();
setInterval(loadAll, 30000);
</script>
</body>
</html>`

export async function startDashboard(
  data: DataAdapter,
  port = 3141,
): Promise<void> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)

    // CORS headers for local dev
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET')

    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(DASHBOARD_HTML)
        return
      }

      if (url.pathname === '/api/tasks') {
        const tasks = await data.listTasks({
          status: ['todo', 'in_progress', 'blocked', 'backlog'],
          limit: 50,
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(tasks))
        return
      }

      if (url.pathname === '/api/projects') {
        const projects = await data.listProjects({
          status: ['planning', 'active', 'paused'],
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(projects))
        return
      }

      if (url.pathname === '/api/sessions') {
        const sessions = await data.listSessions(10)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(sessions))
        return
      }

      if (url.pathname === '/api/stats') {
        const statsPath = join(HUGHMANN_HOME, 'daemon', 'stats.json')
        let stats: Record<string, unknown> = {}
        if (existsSync(statsPath)) {
          try {
            const raw = JSON.parse(readFileSync(statsPath, 'utf-8'))
            stats = {
              completed: raw.tasksCompleted ?? 0,
              failed: raw.tasksFailed ?? 0,
              consecutiveFailures: raw.consecutiveFailures ?? 0,
              dailyCount: raw.dailyTaskCount ?? 0,
              lastTask: raw.lastTaskAt ?? null,
            }
          } catch { /* ignore */ }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(stats))
        return
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`HughMann dashboard: http://localhost:${port}`)
  })
}
