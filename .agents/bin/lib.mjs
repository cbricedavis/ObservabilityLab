// Shared helpers for .agents/bin/agents.mjs. Dependency-free (Node built-ins
// only). Formats and protocol: .agents/blueprint/BLUEPRINT.md §6-§8.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function git(args, opts = {}) {
  return sh('git', args, opts);
}

export function gitCommonDir() {
  const r = git(['rev-parse', '--git-common-dir']);
  if (r.status !== 0) throw new Error('not a git repository');
  return path.resolve(r.stdout.trim());
}

export function gitTopLevel() {
  const r = git(['rev-parse', '--show-toplevel']);
  if (r.status !== 0) throw new Error('not a git repository');
  return path.resolve(r.stdout.trim());
}

export function ignoreCase() {
  const r = git(['config', '--bool', 'core.ignorecase']);
  return r.stdout.trim() === 'true';
}

export function nowUTC() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
}

export function todayUTC() {
  return nowUTC().slice(0, 10);
}

export function parseUTC(s) {
  // "YYYY-MM-DDTHH:MMZ" -> epoch ms
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/.exec(String(s).trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi);
}

// §8: \ -> /, strip any number of leading ./, collapse //. Never strip
// leading dots character-wise.
export function normalizePath(p) {
  let s = String(p).replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/\/{2,}/g, '/');
  return s;
}

function stripOneTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

const LEDGER_NAMES = new Set(['STATUS.md', 'TODO.md', 'CHANGELOG.md']);

export function isLedgerPath(p) {
  const n = normalizePath(p);
  return LEDGER_NAMES.has(n) || n.startsWith('.agents/archive/');
}

// §7.1 overlap.
export function overlaps(a, b, icase) {
  if (isLedgerPath(a) || isLedgerPath(b)) return false;
  let na = stripOneTrailingSlash(normalizePath(a));
  let nb = stripOneTrailingSlash(normalizePath(b));
  if (icase) { na = na.toLowerCase(); nb = nb.toLowerCase(); }
  if (na === nb) return true;
  if (nb.startsWith(na + '/')) return true;
  if (na.startsWith(nb + '/')) return true;
  return false;
}

// §6.1 TODO reference matching: trim both, compare case-insensitively.
export function todoMatch(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

export function readConfig(repoRoot) {
  const p = path.join(repoRoot, '.agents', 'config');
  const cfg = {
    RECENT_ACTIVITY_MAX: '10',
    DONE_KEEP: '25',
    CHANGELOG_KEEP: '20',
    LEDGER_WARN_LINES: '400',
    STALE_CLAIM_HOURS: '24',
    LOCK_WAIT_SECONDS: '30',
    LOCK_STALE_SECONDS: '120',
    DEFAULT_AGENT: 'codex',
    PUSH_POLICY: 'ask',
    INTEGRATION_BRANCH: 'main',
  };
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return cfg; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    cfg[key] = val;
  }
  return cfg;
}

export function claimsDir(cfg, commonDir, repoRoot) {
  if (cfg.TOPOLOGY === 'clones') return path.join(repoRoot, '.agents', 'claims');
  return path.join(commonDir, 'agent-collab', 'claims');
}

export function collabStateDir(commonDir) {
  return path.join(commonDir, 'agent-collab');
}

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

export function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmp = path.join(path.dirname(filePath), `.tmp-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

function sleepSync(ms) {
  const buf = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buf, 0, 0, ms);
}

// §6.10 the lock: one lock per repo, <common dir>/agent-collab.lock, atomic mkdir.
export function acquireLock(commonDir, agent, waitSeconds, staleSeconds) {
  ensureDir(commonDir);
  const lockPath = path.join(commonDir, 'agent-collab.lock');
  const deadline = Date.now() + waitSeconds * 1000;
  let lastOwner = 'unknown owner';
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      fs.writeFileSync(path.join(lockPath, 'owner'), `${agent} ${process.pid} ${nowUTC()}\n`, 'utf8');
      return lockPath;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { lastOwner = fs.readFileSync(path.join(lockPath, 'owner'), 'utf8').trim(); } catch { /* racing */ }
      let ageMs = 0;
      try { ageMs = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { continue; }
      if (ageMs > staleSeconds * 1000) {
        const staleName = `${lockPath}.stale.${process.pid}`;
        try {
          fs.renameSync(lockPath, staleName);
          fs.rmSync(staleName, { recursive: true, force: true });
          continue; // retry mkdir immediately; exactly one concurrent breaker wins the rename
        } catch {
          // another breaker won the rename race; fall through to wait/retry
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`lock held by ${lastOwner}`);
      }
      sleepSync(100);
    }
  }
}

export function releaseLock(lockPath) {
  try { fs.rmSync(path.join(lockPath, 'owner'), { force: true }); } catch { /* ignore */ }
  try { fs.rmdirSync(lockPath); } catch { /* ignore */ }
}

export function withLock(commonDir, agent, waitSeconds, staleSeconds, fn) {
  const lockPath = acquireLock(commonDir, agent, waitSeconds, staleSeconds);
  try {
    return fn();
  } finally {
    releaseLock(lockPath);
  }
}

const CLAIM_KEY_ORDER = ['agent', 'since', 'touched', 'task', 'todo', 'paths'];

export function parseClaim(text) {
  const claim = { note: [], blocker: [] };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i === -1) return null;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key === 'note' || key === 'blocker') claim[key].push(value);
    else if (CLAIM_KEY_ORDER.includes(key)) claim[key] = value;
    else return null;
  }
  for (const k of CLAIM_KEY_ORDER) if (claim[k] === undefined) return null;
  return claim;
}

export function serializeClaim(claim) {
  const lines = CLAIM_KEY_ORDER.map((k) => `${k}: ${claim[k]}`);
  for (const n of claim.note ?? []) lines.push(`note: ${n}`);
  for (const b of claim.blocker ?? []) lines.push(`blocker: ${b}`);
  return lines.join('\n') + '\n';
}

export function claimPath(cdir, agent) {
  return path.join(cdir, `${agent}.claim`);
}

export function readClaim(cdir, agent) {
  const p = claimPath(cdir, agent);
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return null; }
  return { raw, claim: parseClaim(raw), path: p };
}

export function listClaims(cdir) {
  let names;
  try { names = fs.readdirSync(cdir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.claim')) continue;
    const agent = name.slice(0, -'.claim'.length);
    const p = path.join(cdir, name);
    let raw;
    try { raw = fs.readFileSync(p, 'utf8'); } catch { continue; }
    out.push({ agent, fileAgent: agent, raw, claim: parseClaim(raw), path: p });
  }
  return out;
}

export function claimedPaths(claim) {
  return String(claim.paths ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

// §7.5 liveness for shared-tree/worktrees: touch/commit update the claim
// instantly, so staleness is judged directly from `touched:`.
export function claimAgeHours(claim) {
  const t = parseUTC(claim.touched);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3_600_000;
}

export function isStale(claim, staleHours) {
  return claimAgeHours(claim) > staleHours;
}

// --- forbidden paths (§6.3) ---

export function loadForbiddenPatterns(repoRoot, icase) {
  const p = path.join(repoRoot, '.agents', 'forbidden-paths');
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); } catch { return { patterns: [], invalid: null }; }
  const lines = raw.replace(/\r/g, '').split('\n');
  const patterns = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try {
      patterns.push(new RegExp(line.trim(), icase ? 'i' : ''));
    } catch {
      return { patterns: [], invalid: line };
    }
  }
  return { patterns, invalid: null };
}

export function matchForbidden(paths, patterns) {
  const hits = [];
  for (const raw of paths) {
    const p = normalizePath(raw);
    for (const re of patterns) {
      if (re.test(p)) { hits.push(p); break; }
    }
  }
  return hits;
}

// --- git status parsing ---

export function dirtyOrStagedPaths() {
  const r = git(['-c', 'core.quotePath=off', 'status', '--porcelain']);
  if (r.status !== 0) return [];
  const out = [];
  for (const line of r.stdout.split('\n')) {
    if (!line) continue;
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    out.push(arrow === -1 ? rest : rest.slice(arrow + 4));
  }
  return out;
}

export function isTracked(repoRoot, p) {
  const r = git(['ls-files', '--error-unmatch', '--', p], { cwd: repoRoot });
  return r.status === 0;
}

export function lastCommitShort() {
  const r = git(['rev-parse', '--short', 'HEAD']);
  return r.status === 0 ? r.stdout.trim() : null;
}

// --- ledger section helpers ---

export function splitSections(text, requiredHeadings) {
  // Returns { intro, sections: Map<heading, lines[]>, order: [headings as seen], issues: [] }
  const lines = text.split(/\r?\n/);
  const sections = new Map();
  const order = [];
  const issues = [];
  let current = null;
  let intro = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const heading = line.slice(3).trimEnd();
      if (/\s$/.test(line.slice(3)) === false && line !== line.trimEnd()) issues.push(`trailing whitespace on heading line: ${JSON.stringify(line)}`);
      if (line !== `## ${heading}` && !requiredHeadings) {
        // changelog-style headings tolerated by caller
      }
      current = heading;
      if (sections.has(heading)) issues.push(`duplicated heading: ${heading}`);
      sections.set(heading, sections.get(heading) ?? []);
      order.push(heading);
    } else if (current === null) {
      intro.push(line);
    } else {
      sections.get(current).push(line);
    }
  }
  return { intro, sections, order, issues };
}

export function hasMergeMarkers(text) {
  return /^(<{7}|={7}|>{7})/m.test(text);
}

export function hasBlankRun(text) {
  return /\n[ \t]*\n[ \t]*\n/.test(text);
}
