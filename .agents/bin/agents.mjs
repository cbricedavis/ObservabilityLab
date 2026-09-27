#!/usr/bin/env node
// Tier 2 helpers for ObservabilityLab's multi-agent collaboration protocol.
// Dependency-free. Protocol and formats: .agents/blueprint/BLUEPRINT.md.
// Usage: node .agents/bin/agents.mjs <command> [args...]
// Identity: $AGENT env var, else .agents/config's DEFAULT_AGENT.
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const repoRoot = L.gitTopLevel();
const commonDir = L.gitCommonDir();
const cfg = L.readConfig(repoRoot);
const icase = L.ignoreCase();
const cdir = L.claimsDir(cfg, commonDir, repoRoot);
const agent = process.env.AGENT || cfg.DEFAULT_AGENT;
const waitSeconds = Number(cfg.LOCK_WAIT_SECONDS) || 30;
const staleSeconds = Number(cfg.LOCK_STALE_SECONDS) || 120;
const staleHours = Number(cfg.STALE_CLAIM_HOURS) || 24;

const P = {
  STATUS: path.join(repoRoot, 'STATUS.md'),
  TODO: path.join(repoRoot, 'TODO.md'),
  CHANGELOG: path.join(repoRoot, 'CHANGELOG.md'),
  RECENT_ARCHIVE: path.join(repoRoot, '.agents', 'archive', 'recent-activity.md'),
  DONE_ARCHIVE: path.join(repoRoot, '.agents', 'archive', 'TODO-done.md'),
  CHANGELOG_ARCHIVE: path.join(repoRoot, '.agents', 'archive', 'CHANGELOG-archive.md'),
};

// A thrown Refusal unwinds through any withLock()/try-finally on its way up,
// so a lock is always released even when the operation holding it refuses.
// process.exit() would skip those finally blocks and leak the lock instead.
class Refusal extends Error {}

function die(msg) {
  throw new Refusal(msg);
}

function ok(msg) {
  process.stdout.write(`${msg}\n`);
}

function seenPath() {
  return path.join(L.collabStateDir(commonDir), 'seen', `${agent}.seen`);
}

function markSeen(held) {
  const p = seenPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, held ? 'held' : 'idle', 'utf8');
}

function lastSeenHeld() {
  try { return fs.readFileSync(seenPath(), 'utf8').trim() === 'held'; } catch { return false; }
}

function myClaim() {
  return L.readClaim(cdir, agent);
}

function refuseIfReaped() {
  const wasHeld = lastSeenHeld();
  const now = myClaim();
  if (wasHeld && !now) {
    die('you were reaped: your claim file is gone. Re-claim before doing anything else.');
  }
  return now;
}

// --- forbidden path check shared by commit and CI ---
function checkForbidden(paths) {
  const { patterns, invalid } = L.loadForbiddenPatterns(repoRoot, icase);
  if (invalid !== null) {
    die(`.agents/forbidden-paths has an invalid pattern; refusing (fail closed): ${invalid}`);
  }
  const hits = L.matchForbidden(paths, patterns);
  return hits;
}

function pushIfAuto() {
  if (cfg.PUSH_POLICY !== 'auto') return;
  const remotes = L.git(['remote']);
  if (remotes.status !== 0 || !remotes.stdout.trim()) return;
  const branch = L.git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const push = L.git(['push', 'origin', `HEAD:${branch}`]);
    if (push.status === 0) { ok(`pushed to origin/${branch}`); return; }
    if (/rejected|non-fast-forward/i.test(push.stderr)) {
      const pull = L.git(['pull', '--rebase', 'origin', branch]);
      if (pull.status !== 0) {
        process.stderr.write(`push: rebase failed, leaving unpushed for the user:\n${pull.stderr}\n`);
        return;
      }
      continue;
    }
    process.stderr.write(`push failed (attempt ${attempt}): ${push.stderr}\n`);
    if (attempt === 3) process.stderr.write('giving up; commit is local, push manually.\n');
  }
}

// ---------------------------------------------------------------- status ---
function cmdStatus() {
  ok(`# ${cfg.PROJECT_NAME || repoRoot} — status @ ${L.nowUTC()}`);
  const fetch = L.git(['fetch', '--quiet']);
  const branch = L.git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
  let aheadBehind = 'no upstream';
  const rev = L.git(['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`]);
  if (fetch.status === 0 && rev.status === 0 && rev.stdout.trim()) {
    const [behind, ahead] = rev.stdout.trim().split(/\s+/);
    aheadBehind = `ahead ${ahead}, behind ${behind} of origin/${branch}`;
  } else if (fetch.status !== 0) {
    aheadBehind = 'fetch failed (offline?) — comparison skipped';
  }
  ok(`branch: ${branch} (${aheadBehind})`);
  const last = L.git(['log', '-1', '--format=%h %ad %s', '--date=short']);
  ok(`last commit: ${last.status === 0 ? last.stdout.trim() : '(none yet)'}`);
  ok(`topology: ${cfg.TOPOLOGY}  push policy: ${cfg.PUSH_POLICY}  tier: 2`);

  const dirty = L.dirtyOrStagedPaths();
  ok(`dirty/staged paths (${dirty.length}, may be another agent's):`);
  for (const p of dirty) ok(`  - ${p}`);

  const claims = L.listClaims(cdir);
  ok(`active claims (${claims.length}):`);
  for (const { agent: a, claim, path: p } of claims) {
    if (!claim) { ok(`  - ${a}: UNPARSEABLE claim file (${p})`); continue; }
    const ageH = L.claimAgeHours(claim);
    const label = L.isStale(claim, staleHours) ? 'STALE — reapable' : 'live';
    ok(`  - ${a}: "${claim.task}" paths=[${claim.paths}] touched ${ageH.toFixed(1)}h ago — ${label}`);
  }

  ok(`default task: ${defaultTask() ?? '(none open)'}`);

  const cl = fs.readFileSync(P.CHANGELOG, 'utf8');
  const m = /^## .*$/m.exec(cl);
  ok(`newest CHANGELOG entry: ${m ? m[0] : '(none)'}`);

  ok('--- lint ---');
  const lintCode = cmdLint({ quiet: false });
  ok(`--- resource probes ---`);
  ok('no resource kinds registered yet (see TODO.md follow-up)');
  process.exitCode = 0; // status itself never fails; lint issues are shown, not fatal here
  return lintCode;
}

function defaultTask() {
  const text = fs.readFileSync(P.TODO, 'utf8');
  const items = sectionItems(text, 'Next');
  const claims = L.listClaims(cdir).map((c) => c.claim).filter(Boolean);
  for (const it of items) {
    if (it.checked) continue;
    const firstLine = itemFirstLineText(it);
    const claimed = claims.some((c) => L.todoMatch(c.todo, firstLine));
    if (!claimed) return firstLine;
  }
  return null;
}

// ---------------------------------------------------------------- TODO.md sections/items ---
function findHeadingRange(lines, heading) {
  const startIdx = lines.findIndex((l) => l === `## ${heading}`);
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) { endIdx = i; break; }
  }
  return { startIdx, endIdx }; // section body is (startIdx+1 .. endIdx-1)
}

function sectionItems(text, heading) {
  const lines = text.split(/\r?\n/);
  const range = findHeadingRange(lines, heading);
  if (!range) return [];
  const body = lines.slice(range.startIdx + 1, range.endIdx);
  const items = [];
  let current = null;
  for (const line of body) {
    if (/^- \[[ xX]\] /.test(line)) {
      if (current) items.push(current);
      current = { checked: line[3] !== ' ', lines: [line] };
    } else if (current && /^ {2,}\S/.test(line)) {
      current.lines.push(line);
    } else {
      if (current) { items.push(current); current = null; }
    }
  }
  if (current) items.push(current);
  return items;
}

function itemFirstLineText(item) {
  return item.lines[0].replace(/^- \[[ xX]\] /, '');
}

function itemFullText(item) {
  return item.lines.map((l) => l.replace(/^- \[[ xX]\] /, '').trim()).join(' ');
}

// ---------------------------------------------------------------- claim ---
function cmdClaim(args) {
  const dashdash = args.indexOf('--');
  let task, todo, paths;
  if (dashdash === -1) {
    if (args.length < 3) die('usage: claim "<task>" "<todo first line or ->" <path> [path...]');
    [task, todo, ...paths] = args;
  } else {
    [task, todo] = args.slice(0, dashdash);
    paths = args.slice(dashdash + 1);
  }
  if (!task || !todo || paths.length === 0) die('usage: claim "<task>" "<todo first line or ->" <path> [path...]');
  paths = paths.map((p) => L.normalizePath(p));
  for (const p of paths) if (p === '' || p === '.') die(`invalid claim path: ${JSON.stringify(p)}`);

  return L.withLock(commonDir, agent, waitSeconds, staleSeconds, () => {
    const existing = myClaim();
    if (existing) die(`you already hold a claim: "${existing.claim.task}". finish or touch it first.`);

    if (todo !== '-') {
      const items = sectionItems(fs.readFileSync(P.TODO, 'utf8'), 'Next');
      const match = items.some((it) => !it.checked && L.todoMatch(itemFirstLineText(it), todo));
      if (!match) die(`todo text doesn't match any open "## Next" item verbatim. Use "-" or the exact first line.`);
    }

    const others = L.listClaims(cdir).filter((c) => c.claim);
    for (const { agent: a, claim: c } of others) {
      const cPaths = L.claimedPaths(c);
      for (const mine of paths) {
        for (const theirs of cPaths) {
          if (L.overlaps(mine, theirs, icase)) die(`refused: overlaps ${a}'s claim on "${theirs}" (task: ${c.task})`);
        }
      }
      if (todo !== '-' && L.todoMatch(c.todo, todo)) die(`refused: ${a} already claims the same TODO item.`);
    }

    const dirty = L.dirtyOrStagedPaths();
    for (const d of dirty) {
      for (const mine of paths) {
        if (L.overlaps(mine, d, icase)) die(`refused: unclaimed dirty/staged path overlaps your request: ${d} (may be another agent's, or leftovers from a crashed finish)`);
      }
    }

    const claim = {
      agent,
      since: L.nowUTC(),
      touched: L.nowUTC(),
      task,
      todo,
      paths: paths.join(', '),
      note: [],
      blocker: [],
    };
    fs.mkdirSync(cdir, { recursive: true });
    L.atomicWrite(L.claimPath(cdir, agent), L.serializeClaim(claim));
    markSeen(true);
    ok(`Held: ${agent} claims "${task}"`);
    ok(`  todo: ${todo}`);
    ok(`  paths: ${claim.paths}`);
  });
}

// ---------------------------------------------------------------- touch ---
function cmdTouch() {
  return L.withLock(commonDir, agent, waitSeconds, staleSeconds, () => {
    const existing = refuseIfReaped();
    if (!existing) die('no claim held; nothing to touch.');
    const claim = existing.claim;
    claim.touched = L.nowUTC();
    L.atomicWrite(existing.path, L.serializeClaim(claim));
    markSeen(true);
    ok(`touched ${agent}'s claim at ${claim.touched}`);
  });
}

// ---------------------------------------------------------------- block ---
function cmdBlock(args) {
  const note = args.join(' ').trim();
  if (!note) die('usage: block "<note>"');
  return L.withLock(commonDir, agent, waitSeconds, staleSeconds, () => {
    const existing = refuseIfReaped();
    if (!existing) die('no claim held; nothing to block.');
    const claim = existing.claim;
    claim.blocker = claim.blocker || [];
    claim.blocker.push(`${L.nowUTC()} ${note}`);
    L.atomicWrite(existing.path, L.serializeClaim(claim));
    markSeen(true);

    let text = fs.readFileSync(P.TODO, 'utf8');
    const lines = text.split(/\r?\n/);
    const range = findHeadingRange(lines, 'Next');
    const insertAt = range ? range.startIdx + 1 : lines.length;
    const newLine = `- [ ] **Blocker (${agent}, ${claim.task}):** ${note}`;
    lines.splice(insertAt, 0, newLine);
    L.atomicWrite(P.TODO, lines.join('\n'));

    commitPaths(`chore(todo): ${agent} blocked on "${claim.task}"`, ['TODO.md'], { skipLock: true, skipTouch: true });
    ok(`blocked: ${note}`);
  });
}

// ---------------------------------------------------------------- commit ---
const BULK_SPECS = new Set(['.', '*', '-A', '--all']);

function commitPaths(message, paths, { skipLock = false, skipTouch = false } = {}) {
  if (!paths || paths.length === 0) die('commit refused: empty path list.');
  const norm = paths.map((p) => L.normalizePath(p));
  for (const p of norm) if (BULK_SPECS.has(p)) die(`commit refused: bulk pathspec not allowed: ${p}`);
  for (const p of norm) {
    const abs = path.join(repoRoot, p);
    let stat;
    try { stat = fs.statSync(abs); } catch { stat = null; }
    if (stat && stat.isDirectory()) die(`commit refused: "${p}" is a directory — list files, not the claim root; claims may name directories, commits may not.`);
    if (!stat && !L.isTracked(repoRoot, p)) die(`commit refused: "${p}" neither exists nor is tracked.`);
  }
  const hits = checkForbidden(norm);
  if (hits.length) die(`commit refused: forbidden paths: ${hits.join(', ')}`);

  if (!skipTouch) refuseIfReaped();

  if (!/^(feat|fix|chore|docs|refactor|test)(\([^)]+\))?: /.test(message)) {
    process.stderr.write(`warning: non-conventional commit message: ${JSON.stringify(message)}\n`);
  }

  const claimNow = myClaim();
  if (!claimNow) {
    process.stderr.write('warning: no claim held for this commit.\n');
  } else {
    const claimedSet = L.claimedPaths(claimNow.claim);
    for (const p of norm) {
      if (L.isLedgerPath(p)) continue;
      const inside = claimedSet.some((c) => L.overlaps(p, c, icase));
      if (!inside) process.stderr.write(`warning: "${p}" is outside your claim.\n`);
    }
  }

  const doTouch = () => {
    if (skipTouch) return;
    const c = myClaim();
    if (!c) return;
    if (skipLock) {
      c.claim.touched = L.nowUTC();
      L.atomicWrite(c.path, L.serializeClaim(c.claim));
    } else {
      L.withLock(commonDir, agent, waitSeconds, staleSeconds, () => {
        const fresh = myClaim();
        if (!fresh) return;
        fresh.claim.touched = L.nowUTC();
        L.atomicWrite(fresh.path, L.serializeClaim(fresh.claim));
      });
    }
  };
  doTouch();

  const dirtyBefore = new Set(L.dirtyOrStagedPaths().map((p) => L.normalizePath(p)));
  for (const p of norm) dirtyBefore.delete(p);

  let attempt = 0;
  for (;;) {
    attempt++;
    // Stage exactly these paths (§6.9), then commit scoped to the same
    // pathspec: `git commit -- <paths>` alone won't pick up a path that was
    // never staged and isn't already tracked (brand-new files), so both
    // steps are required, and both stay pathspec-scoped (never -A/.).
    const add = L.git(['add', '--', ...norm], { cwd: repoRoot });
    if (add.status !== 0) die(`git add failed:\n${add.stderr}`);
    const r = L.git(['commit', '-m', message, '--', ...norm], { cwd: repoRoot });
    if (r.status === 0) break;
    if (/index\.lock/.test(r.stderr) && attempt < 3) {
      const buf = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(buf, 0, 0, 300);
      continue;
    }
    die(`commit failed:\n${r.stderr}`);
  }
  markSeen(!!myClaim());
  ok(`committed: ${message} (${norm.length} path(s)); ${dirtyBefore.size} other dirty path(s) left alone.`);
  pushIfAuto();
}

function cmdCommit(args) {
  const dashdash = args.indexOf('--');
  if (dashdash === -1) die('usage: commit "<message>" -- <path> [path...]');
  const message = args.slice(0, dashdash).join(' ');
  const paths = args.slice(dashdash + 1);
  commitPaths(message, paths);
}

// ---------------------------------------------------------------- Recent activity ---
function prependRecentActivity(line) {
  let text = fs.readFileSync(P.STATUS, 'utf8');
  const lines = text.split(/\r?\n/);
  const range = findHeadingRange(lines, 'Recent activity');
  if (!range) throw new Error('STATUS.md missing "## Recent activity"');
  let insertAt = range.startIdx + 1;
  if (insertAt < range.endIdx && lines[insertAt].trim() && !lines[insertAt].startsWith('- ')) insertAt++;
  lines.splice(insertAt, 0, line);
  // enforce budget
  const max = Number(cfg.RECENT_ACTIVITY_MAX) || 10;
  const bulletIdxs = [];
  for (let i = insertAt; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    if (lines[i].startsWith('- ')) bulletIdxs.push(i);
  }
  if (bulletIdxs.length > max) {
    const overflowIdxs = bulletIdxs.slice(max);
    const overflowLines = overflowIdxs.map((i) => lines[i]);
    for (let i = overflowIdxs[overflowIdxs.length - 1]; i >= overflowIdxs[0]; i--) lines.splice(i, 1);
    let archive = '';
    try { archive = fs.readFileSync(P.RECENT_ARCHIVE, 'utf8'); } catch { archive = ''; }
    const newArchive = overflowLines.join('\n') + '\n' + archive;
    L.atomicWrite(P.RECENT_ARCHIVE, newArchive);
  }
  L.atomicWrite(P.STATUS, lines.join('\n'));
}

// ---------------------------------------------------------------- finish ---
function cmdFinish(args) {
  const dashdash = args.indexOf('--');
  if (dashdash === -1) die('usage: finish "<outcome>" ["<refs>"] -- <path> [path...]');
  const head = args.slice(0, dashdash);
  const paths = args.slice(dashdash + 1);
  const outcome = head[0];
  const refs = head[1] || '';
  if (!outcome) die('usage: finish "<outcome>" ["<refs>"] -- <path> [path...]');

  return L.withLock(commonDir, agent, waitSeconds, staleSeconds, () => {
    const existing = myClaim();
    if (!existing) die('no claim held; nothing to finish.');
    const claim = existing.claim;

    const line = `- ${L.nowUTC()} — ${agent} — **${claim.task}.** ${outcome}${refs ? ` (${refs})` : ''}`;
    prependRecentActivity(line);

    const allPaths = Array.from(new Set([...paths.map((p) => L.normalizePath(p)), 'STATUS.md']));
    try {
      commitPaths(`chore(finish): ${agent} finishes "${claim.task}"`, allPaths, { skipLock: true, skipTouch: true });
    } catch (e) {
      die(`finish: closing commit failed; claim kept, STATUS.md edit left in place for you to fix. (${e.message})`);
    }

    fs.rmSync(existing.path, { force: true });
    markSeen(false);
    ok(`finished: ${agent} released claim on "${claim.task}"`);
  });
}

// ---------------------------------------------------------------- reap ---
function cmdReap(args) {
  const [target, ...rest] = args;
  const reason = rest.join(' ').trim();
  if (!target || !reason) die('usage: reap <target-agent> "<reason>"');
  const targetClaim = L.readClaim(cdir, target);
  if (!targetClaim) die(`refused: ${target} holds no claim.`);
  const { claim } = targetClaim;
  if (!L.isStale(claim, staleHours)) {
    die(`refused: ${target}'s claim is live (touched ${L.claimAgeHours(claim).toFixed(1)}h ago; stale window is ${staleHours}h). Reap only on the user's explicit instruction.`);
  }
  const claimedSet = L.claimedPaths(claim);
  const dirty = L.dirtyOrStagedPaths();
  const inside = dirty.filter((d) => claimedSet.some((c) => L.overlaps(d, c, icase)));
  if (inside.length) {
    die(`stop: ${target}'s claimed paths have uncommitted changes — may be unfinished work. Not reaping.\n${inside.map((p) => `  - ${p}`).join('\n')}`);
  }

  return L.withLock(commonDir, agent, waitSeconds, staleSeconds, () => {
    fs.rmSync(targetClaim.path, { force: true });
    const line = `- ${L.nowUTC()} — ${agent} — **Reaped ${target}: ${claim.task}.** ${reason}`;
    prependRecentActivity(line);

    const commitFiles = ['STATUS.md'];
    if (claim.todo && claim.todo !== '-') {
      let text = fs.readFileSync(P.TODO, 'utf8');
      const lines = text.split(/\r?\n/);
      const range = findHeadingRange(lines, 'Next');
      const insertAt = range ? range.startIdx + 1 : lines.length;
      lines.splice(insertAt, 0, `- [ ] **Resume (reaped from ${target}):** ${claim.task}`, `  ${claim.todo}`);
      L.atomicWrite(P.TODO, lines.join('\n'));
      commitFiles.push('TODO.md');
    }

    commitPaths(`chore(claims): ${agent} reaps ${target}`, commitFiles, { skipLock: true, skipTouch: true });
    markSeen(!!myClaim());
    ok(`reaped ${target}: ${claim.task}`);
  });
}

// ---------------------------------------------------------------- done ---
function cmdDone(args) {
  const [match, ...rest] = args;
  const note = rest.join(' ').trim();
  if (!match) die('usage: done "<match text>" ["<note>"]');
  const text = fs.readFileSync(P.TODO, 'utf8');
  const lines = text.split(/\r?\n/);
  const nextRange = findHeadingRange(lines, 'Next');
  const laterRange = findHeadingRange(lines, 'Later');
  const doneRange = findHeadingRange(lines, 'Done');

  const candidates = [];
  for (const range of [nextRange, laterRange]) {
    if (!range) continue;
    const items = sectionItems(text, range === nextRange ? 'Next' : 'Later');
    for (const it of items) {
      if (it.checked) continue;
      if (itemFullText(it).toLowerCase().includes(match.trim().toLowerCase())) {
        candidates.push({ item: it, section: range === nextRange ? 'Next' : 'Later' });
      }
    }
  }
  if (candidates.length === 0) die(`done refused: no open item matches "${match}".`);
  if (candidates.length > 1) die(`done refused: "${match}" matches ${candidates.length} open items; be more specific.`);
  const { item, section } = candidates[0];
  const firstLine = itemFirstLineText(item);

  const others = L.listClaims(cdir).filter((c) => c.claim && c.agent !== agent);
  for (const { agent: a, claim: c } of others) {
    if (L.todoMatch(c.todo, firstLine)) die(`done refused: referenced by ${a}'s claim ("${c.task}").`);
  }

  const range = section === 'Next' ? nextRange : laterRange;
  const body = lines.slice(range.startIdx + 1, range.endIdx);
  let offset = 0;
  let removed = null;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === item.lines[0]) {
      removed = body.splice(i, item.lines.length);
      offset = i;
      break;
    }
  }
  lines.splice(range.startIdx + 1, range.endIdx - range.startIdx - 1, ...body);

  const newLines = lines;
  // recompute doneRange after removal (headings before Done unaffected in count if Done is after Next/Later, which it is)
  const doneRange2 = findHeadingRange(newLines, 'Done');
  const prior = L.lastCommitShort() || '(no prior commit)';
  const doneEntry = [`- [x] ${L.todayUTC()}: ${firstLine}`, `  ${prior}${note ? ` — ${note}` : ''}`];
  const doneBody = newLines.slice(doneRange2.startIdx + 1, doneRange2.endIdx);
  const isPlaceholder = doneBody.every((l) => l.trim() === '' || l.trim() === 'None.');
  if (isPlaceholder) {
    newLines.splice(doneRange2.startIdx + 1, doneRange2.endIdx - doneRange2.startIdx - 1, ...doneEntry);
  } else {
    newLines.splice(doneRange2.startIdx + 1, 0, ...doneEntry);
  }

  L.atomicWrite(P.TODO, newLines.join('\n'));
  ok(`done: moved "${firstLine}" to Done (${L.todayUTC()}).`);
}

// ---------------------------------------------------------------- rotate ---
function cmdRotate() {
  rotateTodoDone();
  rotateChangelog();
  ok('rotate: done.');
}

function rotateTodoDone() {
  const doneKeep = Number(cfg.DONE_KEEP) || 25;
  const text = fs.readFileSync(P.TODO, 'utf8');
  const lines = text.split(/\r?\n/);
  const range = findHeadingRange(lines, 'Done');
  if (!range) return;
  const items = sectionItems(text, 'Done');
  if (items.length <= doneKeep) return;
  const overflow = items.slice(doneKeep);
  const keep = items.slice(0, doneKeep);
  const body = keep.length ? keep.flatMap((it) => it.lines) : ['None.'];
  lines.splice(range.startIdx + 1, range.endIdx - range.startIdx - 1, ...body);
  L.atomicWrite(P.TODO, lines.join('\n'));

  let archive = '';
  try { archive = fs.readFileSync(P.DONE_ARCHIVE, 'utf8'); } catch { archive = ''; }
  const overflowText = overflow.flatMap((it) => it.lines).join('\n') + '\n';
  L.atomicWrite(P.DONE_ARCHIVE, overflowText + archive);
}

const CHANGELOG_POINTER = '> Older entries archived: `.agents/archive/CHANGELOG-archive.md`';

function rotateChangelog() {
  const keep = Number(cfg.CHANGELOG_KEEP) || 20;
  let text = fs.readFileSync(P.CHANGELOG, 'utf8');
  const hadPointer = text.includes(CHANGELOG_POINTER);
  text = text.split(CHANGELOG_POINTER).join('').replace(/\n{3,}$/, '\n');
  const lines = text.split(/\r?\n/);
  const headingIdxs = [];
  lines.forEach((l, i) => { if (l.startsWith('## ')) headingIdxs.push(i); });
  if (headingIdxs.length <= keep) {
    if (hadPointer) L.atomicWrite(P.CHANGELOG, ensureTrailingPointer(text));
    return;
  }
  const cutIdx = headingIdxs[keep];
  const keepLines = lines.slice(0, cutIdx);
  const overflowLines = lines.slice(cutIdx);
  L.atomicWrite(P.CHANGELOG, ensureTrailingPointer(keepLines.join('\n')));

  let archive = '';
  try { archive = fs.readFileSync(P.CHANGELOG_ARCHIVE, 'utf8'); } catch { archive = ''; }
  const overflowText = overflowLines.join('\n').replace(/\n+$/, '') + '\n\n';
  L.atomicWrite(P.CHANGELOG_ARCHIVE, overflowText + archive);
}

function ensureTrailingPointer(text) {
  const trimmed = text.replace(/\n+$/, '');
  return `${trimmed}\n\n${CHANGELOG_POINTER}\n`;
}

// ---------------------------------------------------------------- lint ---
const REQUIRED_FILES = [
  'AGENTS.md', 'STATUS.md', 'TODO.md', 'CHANGELOG.md',
  '.agents/config', '.agents/forbidden-paths', '.agents/archive/README',
];
if (cfg.TOPOLOGY === 'clones') REQUIRED_FILES.push('.agents/claims/README');

const STATUS_HEADINGS = ['Active work', 'Shared resources', 'Recent activity'];
const TODO_HEADINGS = ['Current Goal', 'Next', 'Later', 'Done'];

function cmdLint() {
  const errors = [];
  const warnings = [];

  for (const f of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(repoRoot, f))) errors.push(`missing required file: ${f}`);
  }

  checkLedger(P.STATUS, STATUS_HEADINGS, errors, warnings, 'STATUS.md');
  checkLedger(P.TODO, TODO_HEADINGS, errors, warnings, 'TODO.md');
  checkChangelog(errors, warnings);

  for (const f of ['AGENTS.md', 'STATUS.md', 'TODO.md', 'CHANGELOG.md', '.agents/config', '.agents/forbidden-paths']) {
    const abs = path.join(repoRoot, f);
    if (fs.existsSync(abs) && L.hasMergeMarkers(fs.readFileSync(abs, 'utf8'))) errors.push(`merge markers in ${f}`);
  }

  // claim files
  const claims = L.listClaims(cdir);
  const todoText = fs.readFileSync(P.TODO, 'utf8');
  const openItems = [...sectionItems(todoText, 'Next'), ...sectionItems(todoText, 'Later')].filter((i) => !i.checked);
  for (const { agent: a, claim, path: p } of claims) {
    if (!claim) { errors.push(`claim file doesn't parse: ${p}`); continue; }
    if (claim.agent !== a) errors.push(`claim file ${p} has agent: ${claim.agent}, expected ${a}`);
    const paths = L.claimedPaths(claim);
    if (paths.length === 0 || paths.includes('.')) errors.push(`claim ${a} has empty or "." paths`);
    if (claim.todo && claim.todo !== '-') {
      const match = openItems.some((it) => L.todoMatch(itemFirstLineText(it), claim.todo));
      if (!match) errors.push(`claim ${a}'s todo: matches no open item: ${claim.todo}`);
    }
    if (L.isStale(claim, staleHours)) {
      warnings.push(`claim ${a} is stale (not live)`);
    } else {
      const ageH = L.claimAgeHours(claim);
      const topLevelDirs = paths.filter((pp) => pp.endsWith('/') && !pp.slice(0, -1).includes('/'));
      if (topLevelDirs.length && ageH > staleHours / 2) {
        warnings.push(`claim ${a} holds top-level directory claim(s) [${topLevelDirs.join(', ')}] untouched for ${ageH.toFixed(1)}h (over half the ${staleHours}h stale window)`);
      }
    }
  }

  const warnLines = Number(cfg.LEDGER_WARN_LINES) || 400;
  for (const f of ['STATUS.md', 'TODO.md', 'CHANGELOG.md']) {
    const abs = path.join(repoRoot, f);
    if (!fs.existsSync(abs)) continue;
    const n = fs.readFileSync(abs, 'utf8').split('\n').length;
    if (n > warnLines) warnings.push(`${f} is ${n} lines (over ${warnLines})`);
  }

  const { patterns: fpPatterns, invalid: fpInvalid } = L.loadForbiddenPatterns(repoRoot, icase);
  if (fpInvalid !== null) {
    errors.push(`.agents/forbidden-paths has an invalid pattern; refusing (fail closed): ${fpInvalid}`);
  } else {
    const lsFiles = L.git(['ls-files'], { cwd: repoRoot });
    const trackedHits = lsFiles.status === 0 ? L.matchForbidden(lsFiles.stdout.split('\n').filter(Boolean), fpPatterns) : [];
    for (const h of trackedHits) errors.push(`forbidden tracked file: ${h} — git rm --cached it and rotate any exposed secret`);
  }

  // BLUEPRINT §6.11: an active pre-commit hook that isn't the tracked one.
  const HOOK_MANAGER_MARKERS = ['.husky', '.pre-commit-config.yaml', 'lefthook.yml', 'lefthook.yaml', '.overcommit.yml'];
  const hasHookManager = HOOK_MANAGER_MARKERS.some((m) => fs.existsSync(path.join(repoRoot, m)));
  if (!hasHookManager) {
    const hooksPath = L.git(['config', 'core.hooksPath'], { cwd: repoRoot }).stdout.trim();
    if (hooksPath !== '.githooks') {
      errors.push(`core.hooksPath is ${hooksPath ? `"${hooksPath}"` : 'unset'}, not ".githooks" — run "node .agents/bin/agents.mjs setup" (no hook manager registered).`);
    }
  }

  for (const e of errors) ok(`ERROR: ${e}`);
  for (const w of warnings) ok(`WARN: ${w}`);
  if (!errors.length && !warnings.length) ok('lint: clean.');
  process.exitCode = errors.length ? 1 : 0;
  return process.exitCode;
}

function checkLedger(file, requiredHeadings, errors, warnings, label) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const seen = [];
  const counts = new Map();
  for (const line of lines) {
    if (!line.startsWith('## ')) continue;
    if (line !== line.trimEnd()) errors.push(`${label}: heading has trailing whitespace: ${JSON.stringify(line)}`);
    const heading = line.slice(3).trimEnd();
    seen.push(heading);
    counts.set(heading, (counts.get(heading) || 0) + 1);
  }
  for (const h of requiredHeadings) if (!counts.has(h)) errors.push(`${label}: missing heading "## ${h}"`);
  for (const [h, n] of counts) {
    if (!requiredHeadings.includes(h)) errors.push(`${label}: unexpected heading "## ${h}"`);
    else if (n > 1) errors.push(`${label}: duplicated heading "## ${h}"`);
  }
  if (seen.join('|') !== requiredHeadings.filter((h) => counts.has(h)).join('|') && seen.length === requiredHeadings.length) {
    // order check only when the set is exactly right
    if (JSON.stringify(seen) !== JSON.stringify(requiredHeadings)) errors.push(`${label}: headings out of order: ${seen.join(', ')}`);
  }
  if (L.hasBlankRun(text)) errors.push(`${label}: contains a run of blank lines`);

  if (label === 'STATUS.md') {
    const range = findHeadingRange(lines, 'Recent activity');
    if (range) {
      for (let i = range.startIdx + 1; i < range.endIdx; i++) {
        const line = lines[i];
        if (!line.startsWith('- ')) continue;
        const next = lines[i + 1];
        if (next && next.trim() && !next.startsWith('- ') && !next.startsWith('## ')) {
          errors.push(`${label}: multi-line Recent activity item at line ${i + 1}`);
        }
      }
    }
  }
}

function checkChangelog(errors, warnings) {
  if (!fs.existsSync(P.CHANGELOG)) return;
  const text = fs.readFileSync(P.CHANGELOG, 'utf8');
  if (L.hasBlankRun(text)) errors.push('CHANGELOG.md: contains a run of blank lines');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('## ') && !/^## \d{4}-\d{2}-\d{2} — .+/.test(line)) {
      errors.push(`CHANGELOG.md: heading doesn't match "## YYYY-MM-DD — <headline>": ${JSON.stringify(line)}`);
    }
    if (line.startsWith('## ') && line !== line.trimEnd()) errors.push(`CHANGELOG.md: heading has trailing whitespace: ${JSON.stringify(line)}`);
  }
  const pointerCount = (text.match(/^> Older entries archived:/gm) || []).length;
  if (pointerCount > 1) errors.push('CHANGELOG.md: more than one pointer line');
}

function trackedForbiddenAudit() {
  const { patterns, invalid } = L.loadForbiddenPatterns(repoRoot, icase);
  if (invalid !== null) { ok(`ERROR: .agents/forbidden-paths has an invalid pattern (fail closed): ${invalid}`); return []; }
  const r = L.git(['ls-files'], { cwd: repoRoot });
  if (r.status !== 0) return [];
  const files = r.stdout.split('\n').filter(Boolean);
  return L.matchForbidden(files, patterns);
}

// ---------------------------------------------------------------- ci-guard ---
function cmdCiGuard(args) {
  const baseIdx = args.indexOf('--base');
  const headIdx = args.indexOf('--head');
  const base = baseIdx !== -1 ? args[baseIdx + 1] : 'HEAD~1';
  const head = headIdx !== -1 ? args[headIdx + 1] : 'HEAD';
  const diff = L.git(['diff', '--name-only', `${base}...${head}`], { cwd: repoRoot });
  if (diff.status !== 0) die(`ci-guard: git diff failed: ${diff.stderr}`);
  const changed = diff.stdout.split('\n').filter(Boolean);
  const hits = checkForbidden(changed);
  let bad = false;
  if (hits.length) { ok(`forbidden paths changed: ${hits.join(', ')}`); bad = true; }
  const trackedHits = trackedForbiddenAudit();
  if (trackedHits.length) { ok(`forbidden tracked files present: ${trackedHits.join(', ')}`); bad = true; }
  process.exitCode = bad ? 1 : 0;
  if (!bad) ok('ci-guard: clean.');
}

// ---------------------------------------------------------------- setup ---
function cmdSetup() {
  // Install by reference (BLUEPRINT.md §6.4), never by copying: a copy in
  // .git/hooks/ silently goes stale when .githooks/pre-commit changes.
  const r = L.git(['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot });
  if (r.status !== 0) die(`git config core.hooksPath failed:\n${r.stderr}`);
  ok('set core.hooksPath = .githooks (idempotent; edits to .githooks/pre-commit take effect immediately, no re-install)');
}

// ---------------------------------------------------------------- dispatch ---
const [cmd, ...rest] = process.argv.slice(2);
try {
  switch (cmd) {
    case 'status': cmdStatus(); break;
    case 'claim': cmdClaim(rest); break;
    case 'touch': cmdTouch(); break;
    case 'block': cmdBlock(rest); break;
    case 'finish': cmdFinish(rest); break;
    case 'reap': cmdReap(rest); break;
    case 'commit': cmdCommit(rest); break;
    case 'done': cmdDone(rest); break;
    case 'rotate': cmdRotate(); break;
    case 'lint': cmdLint(); break;
    case 'ci-guard': cmdCiGuard(rest); break;
    case 'setup': cmdSetup(); break;
    default:
      process.stderr.write('usage: agents.mjs <status|claim|touch|block|finish|reap|commit|done|rotate|lint|ci-guard|setup> [args...]\n');
      process.exit(1);
  }
} catch (e) {
  process.stderr.write(`agents: ${e.message}\n`);
  process.exit(1);
}
