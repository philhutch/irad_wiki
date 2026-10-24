/* Irad Wiki core: splits the volume files into articles. No DOM access, so it
   also runs in Node for testing. Edit VOLUMES if file names or layout change. */

const VOLUMES = [
  {
    file: 'Irad_Wiki_Vol1_Core.md',
    label: 'Volume 1',
    // "### 2.1. Talas" — the featured article is plain "### Irad"
    article: /^### (?:(\d+\.\d+)\.\s+)?(.+?)\s*$/,
  },
  {
    file: 'Irad_Wiki_Vol2_C_Class.md',
    label: 'Volume 2',
    article: /^### (\d+\.\d+)\.\s+(.+?)\s*$/,
  },
  {
    file: 'Irad_Wiki_Vol3_Start_Stub.md',
    label: 'Volume 3',
    // "### 5.Category: Biographies & Leadership (36 articles)"
    category: /^### \d+\.Category:\s*(.+?)\s*\(\d+ articles?\)\s*$/,
    // "#### 1. Mar Timotheos Alimbekov"
    article: /^#### (\d+)\.\s+(.+?)\s*$/,
  },
];

// "## 3. B-Class Articles (43 Entries)" starts a quality class section.
const CLASS_HEADING = /^## \d+\.\s+(.+?)\s*$/;
const META_LINE = /^\*Quality(?: Assessment)?:\s*(.+?)\s*\|\s*Category:\s*(.+?)\s*\*\s*$/;
/* [[Category:Name]] on a line of its own (normally at the end of an article, after
   the references) adds the article to an extra, Wikipedia-style category. The
   meta-line category stays the article's main one and alone drives the portals. */
const TAG_LINE = /^\s*\[\[\s*Category\s*:\s*([^\]|]+?)\s*(?:\|[^\]]*)?\]\]\s*$/i;
const STUB_TEMPLATE = /\{\{\s*([^}]+?)\s*\}\}/g;
const WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;
/* [[wp:Title]] or [[wp:Title|text]] links to the English Wikipedia article Title. */
const WP_PREFIX = /^\s*wp:/i;
function wpUrl(t) { return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(t.replace(WP_PREFIX, '').trim().replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')'); }

const CLASSES = [
  { id: 'FA', name: 'Featured articles', short: 'Featured', blurb: 'The best articles in the wiki, reviewed for completeness, sourcing and prose.' },
  { id: 'GA', name: 'Good articles', short: 'Good', blurb: 'Well-written, broad and properly sourced articles that meet the good-article criteria.' },
  { id: 'B', name: 'B-Class articles', short: 'B-Class', blurb: 'Mostly complete articles on the principal people, places and institutions of Irad.' },
  { id: 'C', name: 'C-Class articles', short: 'C-Class', blurb: 'Substantial articles that still have gaps in coverage or sourcing.' },
  { id: 'Start', name: 'Start-Class articles', short: 'Start', blurb: 'Developing articles with a basic outline and some sources.' },
  { id: 'Stub', name: 'Stub articles', short: 'Stub', blurb: 'Short entries of a paragraph or two, mostly terms, places and minor figures.' },
  { id: 'List', name: 'List-Class articles', short: 'List', blurb: 'Lists and tables of people, places, companies and other items, judged on completeness and sourcing.' },
];

function classFromHeading(text) {
  if (/\bList-Class/i.test(text)) return 'List';
  if (/featured/i.test(text)) return 'FA';
  if (/good/i.test(text)) return 'GA';
  if (/\bB-Class/i.test(text)) return 'B';
  if (/\bC-Class/i.test(text)) return 'C';
  if (/start/i.test(text)) return 'Start';
  if (/stub/i.test(text)) return 'Stub';
  return null;
}

/* Broad subject for a category name, used to group the many category names
   on the main page. Keyed on the first word of the category. */
const SUBJECTS = {
  Biographies: 'People', Biography: 'People', Historical: 'People',
  History: 'History',
  Culture: 'Culture & arts', Cultural: 'Culture & arts', Arts: 'Culture & arts', Language: 'Culture & arts',
  Media: 'Culture & arts', National: 'Culture & arts',
  Religion: 'Religion',
  Politics: 'Politics & law', Regions: 'Politics & law', Security: 'Politics & law', Military: 'Politics & law',
  Institutions: 'Politics & law', Public: 'Politics & law',
  Economy: 'Economy', Agriculture: 'Economy', Education: 'Economy',
  Infrastructure: 'Infrastructure', Transport: 'Infrastructure',
  Geography: 'Nature', Cities: 'Places', Minor: 'Places', Nation: 'Places', Demographics: 'Places',
  Physical: 'Nature', Nature: 'Nature', Wildlife: 'Nature', Equines: 'Nature', Science: 'Nature',
  // current category scheme (2026-10)
  Law: 'Politics & law', Foreign: 'Politics & law', Sport: 'Culture & arts', Horses: 'Culture & arts',
  Society: 'Society', Health: 'Society', Cities: 'Places',
};
function subjectOf(category) {
  const w = category.split(/[\s,&]+/)[0];
  return SUBJECTS[w] || 'Other';
}

/* Extra categories that sit inside a broader one (shown as a subcategory). */
const TAG_PARENT = {
  EPs: 'Albums', 'Compilation albums': 'Albums',
  'Documentary films': 'Films', 'Lost films': 'Films', 'Short films': 'Films',
  'National anthems': 'Songs',
  Bands: 'Musical artists', Painters: 'Visual artists',
};
/* Portal an extra category belongs to. Unlisted ones take the portal of most of
   their members' main categories. */
const TAG_PORTAL = {
  'Musical artists': 'Culture & arts', 'Visual artists': 'Culture & arts', Painters: 'Culture & arts',
  Filmmakers: 'Culture & arts', Actors: 'Culture & arts', Writers: 'Culture & arts',
};
function tagPortal(name, list) {
  if (TAG_PORTAL[name]) return TAG_PORTAL[name];
  const n = new Map();
  for (const a of list) { const s = subjectOf(a.category); n.set(s, (n.get(s) || 0) + 1); }
  return [...n].sort((x, y) => y[1] - x[1])[0]?.[0] || 'Other';
}

function slugOf(title) { return title.replace(/\s+/g, '_'); }
function categorySlug(name) { return name.replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, ''); }
function fold(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[’‘]/g, "'").toLowerCase();
}

function parseVolume(text, cfg, volIndex) {
  const lines = text.split(/\r?\n/);
  const articles = [];
  const pre = [];
  let cls = null, cat = null, cur = null, inFence = false;

  const close = () => {
    if (!cur) return;
    finishArticle(cur);
    articles.push(cur);
    cur = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence) {
      let m = line.match(CLASS_HEADING);
      if (m && classFromHeading(m[1])) { close(); cls = classFromHeading(m[1]); cat = null; continue; }
      if (cfg.category && (m = line.match(cfg.category))) { close(); cat = m[1]; continue; }
      if ((m = line.match(cfg.article))) {
        close();
        cur = { title: m[2], number: m[1] || '', cls, heading: cat, vol: volIndex, line: i + 1, lines: [] };
        continue;
      }
    }
    (cur ? cur.lines : pre).push(line);
  }
  close();
  return { articles, pre: pre.join('\n') };
}

function finishArticle(a) {
  const ls = a.lines;
  // quality / category line near the top
  for (let i = 0; i < Math.min(ls.length, 4); i++) {
    const m = ls[i].match(META_LINE);
    if (m) {
      a.category = m[2];
      // In the Start/Stub volume an article's own quality line wins over the section it sits in,
      // so a Start-class article appended at the end (under the Stub section) is counted as Start.
      const q = classFromHeading(m[1] || '');
      if ((a.cls === 'Start' || a.cls === 'Stub') && (q === 'Start' || q === 'Stub')) a.cls = q;
      ls.splice(i, 1); break;
    }
  }
  if (!a.category) a.category = a.heading || 'Uncategorized';
  const trim = l => {
    while (l.length && /^\s*(---)?\s*$/.test(l[l.length - 1])) l.pop();
    while (l.length && /^\s*$/.test(l[0])) l.shift();
    return l;
  };
  trim(ls);
  a.source = ls.join('\n');  // as written, for "View source"
  a.tags = [];
  let fence = false;
  const body = ls.filter(l => {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && l.match(TAG_LINE);
    if (!m) return true;
    const t = m[1].replace(/\s+/g, ' ');
    if (t !== a.category && !a.tags.includes(t)) a.tags.push(t);
    return false;
  });
  a.src = trim(body).join('\n');
  delete a.lines;
  const stub = a.src.match(/\{\{\s*([^}]*?stub[^}]*?)\s*\}\}/i);
  a.stubType = stub ? stub[1] : null;
  a.slug = slugOf(a.title);
  a.links = new Set();
  for (const m of a.src.matchAll(WIKILINK)) if (!WP_PREFIX.test(m[1])) a.links.add(m[1].trim());
}

/* Plain text of an article for search and summaries. */
function plainText(src) {
  return src
    .replace(/<sup>.*?<\/sup>/g, '')
    .replace(/<ol class="references">[\s\S]*?<\/ol>/g, '')
    .replace(WIKILINK, (_, t, l) => l || t.replace(WP_PREFIX, ''))
    .replace(STUB_TEMPLATE, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\|.*\|$/gm, m => m.replace(/\|/g, ' ').replace(/-{3,}/g, ''))
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lede(src, max = 170) {
  const para = src.split(/\n\s*\n/).find(p => p.trim() && !/^\s*(#|<|\{\{|\||```)/.test(p)) || '';
  let t = plainText(para);
  if (t.length > max) {
    const cut = t.lastIndexOf(' ', max);
    t = t.slice(0, cut > 60 ? cut : max).replace(/[,;:]$/, '') + '…';
  }
  return t;
}

/* Builds the whole wiki from the volume texts (same order as VOLUMES). */
function buildWiki(texts) {
  const wiki = { articles: [], bySlug: new Map(), byFold: new Map(), categories: new Map(), tagCategories: new Map(), backlinks: new Map(), pre: [], warnings: [] };
  texts.forEach((text, vi) => {
    const { articles, pre } = parseVolume(text, VOLUMES[vi], vi);
    wiki.pre.push(pre);
    for (const a of articles) {
      if (wiki.bySlug.has(a.slug)) wiki.warnings.push(`Duplicate title "${a.title}" (${VOLUMES[vi].file}, line ${a.line}); the first copy is shown.`);
      else { wiki.bySlug.set(a.slug, a); wiki.byFold.set(fold(a.title), a); }
      wiki.articles.push(a);
      if (!wiki.categories.has(a.category)) wiki.categories.set(a.category, []);
      wiki.categories.get(a.category).push(a);
      for (const t of a.tags) {
        if (!wiki.tagCategories.has(t)) wiki.tagCategories.set(t, []);
        wiki.tagCategories.get(t).push(a);
      }
    }
  });
  for (const a of wiki.articles) {
    for (const t of a.links) {
      const target = resolve(wiki, t);
      if (!target || target === a) continue;
      if (!wiki.backlinks.has(target.slug)) wiki.backlinks.set(target.slug, new Set());
      wiki.backlinks.get(target.slug).add(a);
    }
  }
  return wiki;
}

/* Old titles of renamed or merged articles: links and addresses under the old title open the new article. */
const REDIRECTS = {
  'Nurzhan Refinery No. 1': 'Nurzhan Oil Refinery',
  'Talas Fire Station No. 2': 'Talas Municipal Fire Brigade',
  'Xinjiang Lihua Ginning Mill No. 3': 'Xinjiang Lihua Cotton Facilities',
};
const REDIRECT_BY_SLUG = new Map(Object.entries(REDIRECTS).map(([a, b]) => [slugOf(a), b]));

function resolve(wiki, title) {
  const t = title.trim();
  const hit = wiki.bySlug.get(slugOf(t)) || wiki.byFold.get(fold(t));
  if (hit) return hit;
  const to = REDIRECTS[t] || REDIRECT_BY_SLUG.get(slugOf(t));
  return to ? wiki.bySlug.get(slugOf(to)) || null : null;
}

/* Turns the "Country Overview" code block into infobox rows. */
function parseInfobox(block) {
  const parts = block.split(/^=+\s*$/m).map(s => s.replace(/^\n+|\n+$/g, '')).filter(Boolean);
  if (parts.length < 2) return null;
  const head = parts[0].split('\n');
  const box = { name: head[0].trim(), subtitle: head.slice(1).join(' ').trim(), rows: [] };
  let last = null, lastItem = null;
  const join = (prev, next) => prev + ' ' + next;
  for (const raw of parts[1].split('\n')) {
    if (!raw.trim()) continue;
    if (/^\s*•/.test(raw) && last) {
      const t = raw.replace(/^\s*•\s*/, '');
      const m = t.match(/^([^:]{1,40}):\s*(.+)$/);
      lastItem = m ? { label: m[1], value: m[2] } : { label: '', value: t };
      last.items.push(lastItem);
    } else if (/^\s/.test(raw) && last) {
      const t = raw.trim();
      if (lastItem) lastItem.value = join(lastItem.value, t); else last.value = join(last.value, t);
    } else {
      for (const seg of raw.split(/\s+\|\s+/)) {
        const m = seg.match(/^([^:]{1,70}?):\s*(.*)$/);
        if (m) { last = { key: m[1].trim(), value: m[2].trim(), items: [] }; lastItem = null; box.rows.push(last); }
        else if (last) last.value = join(last.value, seg.trim());
      }
    }
  }
  for (const r of box.rows) r.value = r.value.replace(/\s*\(webflag\.svg\)/, '');
  return box;
}

/* Maintenance templates, after Wikipedia's: message boxes ({{More citations needed|date=October 2026}},
   {{Update}}, {{Expand section}} …) on a line of their own, and inline tags ({{Citation needed|date=…}},
   {{Clarify}}, {{When}} …) inside a sentence. Returns null for other templates. */
const AMBOX = {
  'more citations needed': ['content', 'This article <b>needs additional citations for verification</b>. Please help improve this article by adding citations to reliable sources. Unsourced material may be challenged and removed.'],
  'refimprove': ['content', null],
  'more citations needed section': ['content', 'This section <b>needs additional citations for verification</b>. Please help improve this article by adding citations to reliable sources in this section. Unsourced material may be challenged and removed.'],
  'unreferenced section': ['content', 'This section <b>does not cite any sources</b>. Please help improve this section by adding citations to reliable sources. Unsourced material may be challenged and removed.'],
  'blp sources': ['content', 'This biography of a living person <b>needs additional citations for verification</b>. Please help by adding reliable sources. Contentious material about living persons that is unsourced or poorly sourced must be removed immediately.'],
  'one source': ['content', 'This article <b>relies largely or entirely on a single source</b>. Please help improve this article by introducing citations to additional sources.'],
  'primary sources': ['content', 'This article <b>relies excessively on references to primary sources</b>. Please improve this article by adding secondary or tertiary sources.'],
  'update': ['content', 'This article needs to be <b>updated</b>. Please help update this article to reflect recent events or newly available information.'],
  'update section': ['content', 'This section needs to be <b>updated</b>. Please help update this section to reflect recent events or newly available information.'],
  'expand section': ['notice', 'This section <b>needs expansion</b>. You can help by adding to it.'],
  'current': ['notice', 'This article documents a <b>current event</b>. Information may change rapidly as the event progresses, and initial news reports may be unreliable.'],
  'pov': ['content', 'The <b>neutrality of this article is disputed</b>.'],
  'original research': ['content', 'This article <b>possibly contains original research</b>. Please improve it by verifying the claims made and adding inline citations. Statements consisting only of original research should be removed.'],
  'copy edit': ['style', 'This article <b>may require copy editing</b> for grammar, style, cohesion, tone, or spelling.'],
  'too few opinions': ['content', 'This article <b>may lend undue weight to certain ideas, incidents, or controversies</b>. Please help improve it by rewriting it in a balanced fashion that contextualizes different points of view.'],
  'technical': ['style', 'This article <b>may be too technical for most readers to understand</b>. Please help improve it to make it understandable to non-experts, without removing the technical details.'],
};
AMBOX['refimprove'][1] = AMBOX['more citations needed'][1];
const INLINE_TAGS = {
  'citation needed': 'citation needed', 'cn': 'citation needed', 'fact': 'citation needed',
  'clarify': 'clarification needed', 'when': 'when?', 'who': 'who?', 'which': 'which?', 'by whom': 'by whom?',
  'dubious': 'dubious', 'failed verification': 'failed verification', 'better source needed': 'better source needed',
  'update inline': 'needs update', 'according to whom': 'according to whom?', 'page needed': 'page needed',
};
function maintenanceHtml(name, args) {
  const key = name.trim().toLowerCase();
  const date = (args.map(x => x.trim()).find(x => /^date\s*=/i.test(x)) || '').replace(/^date\s*=\s*/i, '');
  if (INLINE_TAGS[key]) {
    const t = INLINE_TAGS[key];
    return `<sup class="fix-tag">[<i><span title="${date ? 'This claim needs attention (' + date + ')' : 'This claim needs attention'}">${t}</span></i>]</sup>`;
  }
  const box = AMBOX[key];
  if (!box) return null;
  return `<div class="ambox ambox-${box[0]}" role="note"><span class="ambox-text">${box[1]}${date ? ` <small><i>(${date})</i></small>` : ''}</span></div>`;
}

/* Static article pages live at /wiki/<name>.html and are served at /wiki/<name>
   (GitHub Pages drops the .html). The name is the slug without the characters
   Windows can't put in a file name. */
function pageName(slug) { return slug.replace(/[<>:"\/\\|?*]+/g, '').replace(/__+/g, '_').replace(/^_+|_+$/g, ''); }
function pagePath(slug) { return '/wiki/' + encodeURIComponent(pageName(slug)).replace(/%2C/g, ','); }

if (typeof module !== 'undefined') module.exports = { TAG_PARENT, tagPortal, pageName, pagePath, WP_PREFIX, wpUrl, VOLUMES, CLASSES, subjectOf, buildWiki, parseInfobox, plainText, lede, fold, slugOf, categorySlug, resolve, REDIRECTS, WIKILINK, STUB_TEMPLATE, maintenanceHtml };
