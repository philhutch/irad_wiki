#!/usr/bin/env node
/* Writes data/home.json for the main page, run by ./build.sh:
   - onThisDay: every full date written in the volumes ("4 June 2007", "(born 12 April 1954)"),
     keyed by "MM-DD", with the sentence it appears in and the article it comes from; births and
     deaths from person infoboxes. thisMonth: the same for "June 1956"-style dates, keyed by "MM",
     shown on days that have nothing of their own.
   - changes: new and expanded articles by day, worked out from the git history of the
     three volumes (each commit compared with the one before it; uncommitted edits count
     as today). An article is "expanded" when its prose (references, categories and
     template lines left out) grew by EXPANDED characters or more.
   - data/edited.json: when each article's text last changed ({slug: unix seconds}), from the
     same history, for the "last edited" line in the footer and the pages' dateModified.
     An article unchanged in the window gets the time of the commit before it. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..', '..');
const core = require(path.join(root, 'src', 'core.js'));

const COMMITS = 80, EXPANDED = 400, DAYS = 45;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 1 << 28 }).toString();
const files = core.VOLUMES.map(v => v.file);
const hash = s => require('crypto').createHash('sha1').update(s).digest('hex');
const edited = {};
const irDate = ms => new Date(ms + 6 * 3600e3).toISOString().slice(0, 10);  // Irad Time, UTC+6

function snapshot(texts) {
  const wiki = core.buildWiki(texts);
  const m = new Map();
  // Prose only: references, categories, navboxes and infobox lines don't count towards "expanded".
  const prose = src => src.replace(/<ol class="references">[\s\S]*?<\/ol>/g, '').split('\n')
    .filter(l => !/^\s*(\||\{\{|\}\}|\[\[Category:|<li|- \[|- <a)/.test(l)).join('\n').length;
  for (const a of wiki.articles) if (!m.has(a.slug)) m.set(a.slug, { title: a.title, len: prose(a.source), h: hash(a.source) });
  return m;
}

/* ---------- On this day ---------- */
const PRONOUN = /^(It|He|She|They|This|These|That|Its|His|Her|Their|There)\b/;
const pad = n => String(n).padStart(2, '0');
function eventText(s, whole) {
  if (PRONOUN.test(s)) return null;  // needs the sentence before it
  let t = s.replace(new RegExp(`^(On|By|From|In) (the (morning|night|evening) of )?${whole},? `), '');
  if (/^(it|he|she|they|this|these|its|his|her|their|there)\b/i.test(t)) return null;
  if (t !== s && !/^(the|a|an)\b|^[A-Z0-9“"*]/.test(t)) t = s;  // "On 11 March 1992, now celebrated…" reads better whole
  if (/ - |\([^()]*\d{4}\)\.?$/.test(t)) return null;  // a citation or caption, not a sentence
  t = t.replace(/\s*\(see [^()]*(\([^()]*\))?[^()]*\)/g, '');
  if (t.length > 260 || t.length < 30) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function onThisDay(texts) {
  const wiki = core.buildWiki(texts);
  const DAY = new RegExp(`\\b([0-3]?\\d) (${MONTHS.join('|')}) (\\d{4})\\b`, 'g');
  const MONTH = new RegExp(`(?<!\\d )\\b(${MONTHS.join('|')}) (\\d{4})\\b`, 'g');
  const days = {}, months = {};
  const push = (o, k, e) => (o[k] = o[k] || []).push(e);
  for (const a of wiki.articles) {
    // Births and deaths from person infoboxes (birth_date = 1954-04-12).
    for (const [field, kind] of [['birth_date', 'birth'], ['death_date', 'death']]) {
      const m = a.source.match(new RegExp(`^\\|\\s*${field}\\s*=\\s*(\\d{4})-(\\d{1,2})-(\\d{1,2})\\s*$`, 'm'));
      if (m) push(days, `${pad(+m[2])}-${pad(+m[3])}`, { year: +m[1], title: a.title, slug: a.slug, kind });
    }
    const paras = a.source.split(/\n\s*\n/).filter(p => p.trim() && !/^\s*([#{|<*-]|\[\[Category)/.test(p));
    paras.forEach((p, pi) => {
      const text = core.plainText(p.replace(/\s*\(\[\[[^\]]+\]\]\)/g, '')).replace(/\s+/g, ' ').trim();
      for (const s of text.split(/(?<=[a-z0-9\)”"'][.!?])\s+(?=[A-Z“"])/)) {
        for (const [whole, d, mon, y] of s.matchAll(DAY)) {
          if (+d < 1 || +d > 31) continue;
          const key = `${pad(MONTHS.indexOf(mon) + 1)}-${pad(+d)}`;
          if (pi === 0 && new RegExp(`\\bborn ${whole}`).test(s)) { push(days, key, { year: +y, title: a.title, slug: a.slug, kind: 'birth' }); continue; }
          const t = eventText(s, whole);
          if (t) push(days, key, { year: +y, title: a.title, slug: a.slug, kind: 'event', text: t });
        }
        for (const [whole, mon, y] of s.matchAll(MONTH)) {
          const t = eventText(s, whole);
          if (t) push(months, pad(MONTHS.indexOf(mon) + 1), { year: +y, title: a.title, slug: a.slug, kind: 'event', text: t });
        }
      }
    });
  }
  // One event per year on each day or month (the article that is about it first), one birth/death per person.
  const score = x => (x.kind === 'event' && x.text.includes(x.title) ? 2 : 0) - (x.text || '').length / 1000;
  const tidy = o => {
    for (const k of Object.keys(o)) {
      const by = new Map();
      for (const e of o[k]) {
        const id = e.kind === 'event' ? 'e' + e.year : e.kind + e.slug;
        const cur = by.get(id);
        if (!cur || score(e) > score(cur)) by.set(id, e);
      }
      o[k] = [...by.values()].sort((a, b) => a.year - b.year);
    }
    return o;
  };
  return { days: tidy(days), months: tidy(months) };
}

/* ---------- Recent changes ---------- */
function changes(current) {
  let log = [];
  try { log = git(['log', `-${COMMITS}`, '--format=%H %ct', '--', ...files]).trim().split('\n').filter(Boolean).map(l => l.split(' ')); }
  catch { return []; }
  if (!log.length) return [];
  const show = (rev, f) => { try { return git(['show', `${rev}:${f}`]); } catch { return ''; } };
  const versions = log.map(([h, t]) => ({ h, ms: +t * 1000 })).reverse();  // oldest first
  const parent = (() => { try { return git(['rev-parse', versions[0].h + '^']).trim(); } catch { return null; } })();
  let prev = parent ? snapshot(files.map(f => show(parent, f))) : null;
  if (prev) {
    const t = +git(['log', '-1', '--format=%ct', parent]).trim();
    for (const slug of prev.keys()) edited[slug] = t;
  }
  const days = new Map();
  const add = (date, kind, a) => {
    if (!days.has(date)) days.set(date, { date, new: new Map(), expanded: new Map() });
    days.get(date)[kind].set(a.slug, a.title);
  };
  const compare = (snap, ms) => {
    for (const [slug, a] of snap) {
      const b = prev && prev.get(slug);
      if (!b || b.h !== a.h) edited[slug] = Math.round(ms / 1000);
      if (!prev) continue;
      if (!b) add(irDate(ms), 'new', { slug, title: a.title });
      else if (a.len - b.len >= EXPANDED) add(irDate(ms), 'expanded', { slug, title: a.title });
    }
    prev = snap;
  };
  for (const v of versions) compare(snapshot(files.map(f => show(v.h, f))), v.ms);
  compare(current, Date.now());
  const cutoff = irDate(Date.now() - DAYS * 864e5);
  return [...days.values()].filter(d => d.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date)).map(d => {
    for (const s of d.new.keys()) d.expanded.delete(s);
    const list = m => [...m].map(([slug, title]) => ({ slug, title })).sort((a, b) => a.title.localeCompare(b.title));
    return { date: d.date, new: list(d.new), expanded: list(d.expanded) };
  }).filter(d => d.new.length || d.expanded.length);
}

const texts = files.map(f => fs.readFileSync(path.join(root, f), 'utf8'));
const otd = onThisDay(texts);
const home = { built: irDate(Date.now()), onThisDay: otd.days, thisMonth: otd.months, changes: changes(snapshot(texts)) };
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'home.json'), JSON.stringify(home));
fs.writeFileSync(path.join(root, 'data', 'edited.json'), JSON.stringify(edited));
const n = Object.values(otd.days).reduce((s, l) => s + l.length, 0);
console.log(`data/home.json: ${n} dated entries on ${Object.keys(otd.days).length} days, ${Object.values(otd.months).reduce((s, l) => s + l.length, 0)} month entries; ${home.changes.length} days of changes`);
