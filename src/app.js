/* Irad Wiki app: loading, routing and rendering. Depends on core.js and markdown-it. */
(function () {
  'use strict';
  const BASE = '/';                  // site root: holds the volume files and webflag.svg (pages also live under /wiki/)
  const FLAG = BASE + 'webflag.svg';
  // Images are listed in images/images.json (file, article, section or placement, width, caption, alt, and for section images optional align "left" and after: n paragraphs); captions may use [[links]] and *italics*.
  // As on Wikipedia, articles show PNG thumbnails at 1x and 2x and link to the full file.
  const IMAGES = BASE + 'images/';
  const THEME_KEY = 'iradwiki-theme';
  const $ = s => document.querySelector(s);
  const main = $('#main'), side = $('#side'), foot = $('#foot'), menuPanel = $('#menuPanel');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Articles have real addresses (/wiki/Talas); everything else (portals, categories,
  // special pages, files, red links) stays a fragment on the main page (/#Category.Media).
  const hashOf = key => '/#' + encodeURIComponent(key).replace(/%2C/g, ',').replace(/%3A/g, ':');
  const href = slug => (wiki && wiki.bySlug.has(slug) ? pagePath(slug) : hashOf(slug));
  const classOf = id => CLASSES.find(c => c.id === id);
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const sortKey = t => t.replace(/^the\s+/i, '');
  const byTitle = (a, b) => collator.compare(sortKey(a.title), sortKey(b.title));
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plural = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : (many || one + 's')}`;

  let locators = null, renderingTitle = '';
  let wiki = null, md = null, infobox = null, query = '', searchIndex = null, images = [], fileInfo = {}, media = null, mediaQuery = '';
  const ledeCache = new Map();
  const ledeOf = a => { if (!ledeCache.has(a)) ledeCache.set(a, lede(a.src)); return ledeCache.get(a); };

  /* ---------- icons ---------- */
  const ICON = {
    FA: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="var(--fa)" stroke="var(--fa)" stroke-width="1" stroke-linejoin="round" d="m10 1.8 2.5 5.3 5.7.7-4.2 4 1.1 5.7L10 14.7l-5.1 2.8L6 11.8 1.8 7.8l5.7-.7z"/></svg>',
    GA: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.5" fill="var(--ga)"/><path d="M10 5.5v9M5.5 10h9" stroke="var(--bg)" stroke-width="2.4" stroke-linecap="round"/></svg>',
    dot: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4" fill="var(--border)"/></svg>',
    moon: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M16.5 12.2A7 7 0 0 1 7.8 3.5a7 7 0 1 0 8.7 8.7Z"/></svg>',
    sun: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.5"/><path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M4 16l1.4-1.4M14.6 5.4 16 4"/></svg>',
    search: '<svg class="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m17 17-4.5-4.5"/></svg>',
    stub: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  };

  /* ---------- theme ---------- */
  const themeBtn = $('#themeBtn');
  function currentTheme() { return document.documentElement.getAttribute('data-wiki-theme') === 'dark' ? 'dark' : 'light'; }
  function paintThemeBtn() {
    const dark = currentTheme() === 'dark';
    themeBtn.innerHTML = dark ? `${ICON.sun}<span>Light</span>` : `${ICON.moon}<span>Dark</span>`;
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    themeBtn.title = themeBtn.getAttribute('aria-label');
  }
  themeBtn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-wiki-theme', 'dark');
    else document.documentElement.removeAttribute('data-wiki-theme');
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage unavailable: the choice lasts for this visit */ }
    paintThemeBtn();
  });
  paintThemeBtn();

  /* ---------- loading ---------- */
  async function load() {
    if (!window.markdownit) return fail('The Markdown library did not load. Check your internet connection, then reload the page.');
    md = window.markdownit({ html: true, linkify: false, typographer: false });
    let done = 0;
    const bar = $('#loadBar') || { style: {} }, msg = $('#loadMsg') || {};
    // The image list is optional: without it, articles simply show no images.
    const imageList = fetch(IMAGES + 'images.json').then(r => (r.ok ? r.json() : [])).catch(() => []);
    // Pixel and byte sizes for the media gallery, made by tools/maps/thumbs.py. Optional too.
    // Settlement dots for the shared location map (tools/maps/src/locators.mjs). Optional.
    const navboxList = fetch(BASE + 'navboxes.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
    const locatorList = fetch(IMAGES + 'locators.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    const fileList = fetch(IMAGES + 'thumb/files.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}));
    try {
      const texts = await Promise.all(VOLUMES.map(async v => {
        const r = await fetch(BASE + v.file);
        if (!r.ok) throw new Error(`${v.file} returned ${r.status} ${r.statusText}`);
        const t = await r.text();
        done++;
        bar.style.width = (done / VOLUMES.length * 100) + '%';
        msg.textContent = 'Loading…';
        return t;
      }));
      wiki = buildWiki(texts);
      wiki.byPage = new Map(wiki.articles.map(a => [pageName(a.slug).toLowerCase(), a]));
    } catch (e) {
      const local = location.protocol === 'file:';
      return fail(local
        ? 'Browsers block a page opened straight from disk from reading the volume files. Serve the folder over HTTP instead, for example with <code>python3 -m http.server</code> in this folder, then open <code>http://localhost:8000</code>.'
        : `Irad Wiki could not load its articles (${esc(e.message)}). Please try again in a few minutes.`);
    }
    images = await imageList;
    fileInfo = await fileList;
    locators = await locatorList;
    navboxes = await navboxList;
    if (wiki.warnings.length) console.warn('Irad Wiki:\n' + wiki.warnings.join('\n'));
    const block = (wiki.pre[0] || '').match(/```\s*\n([\s\S]*?)```/);
    infobox = block ? parseInfobox(block[1]) : null;
    wiki.sorted = [...wiki.articles].sort(byTitle);
    wiki.subjects = new Map();
    for (const [cat, list] of wiki.categories) {
      const s = subjectOf(cat);
      if (!wiki.subjects.has(s)) wiki.subjects.set(s, new Map());
      wiki.subjects.get(s).set(cat, list);
    }
    wiki.subjectOrder = [...wiki.subjects.keys()].sort((a, b) => subjectSize(b) - subjectSize(a));
    wiki.catBySlug = new Map([...wiki.categories.keys()].map(c => [categorySlug(c), c]));
    // Extra categories from [[Category:…]] lines share the address space; a main category wins a clash.
    for (const t of wiki.tagCategories.keys()) if (!wiki.catBySlug.has(categorySlug(t))) wiki.catBySlug.set(categorySlug(t), t);
    wiki.subjBySlug = new Map([...wiki.subjects.keys()].map(s => [categorySlug(s), s]));
    // irad.wiki/?search=Talas (the address search engines use for a site search box) opens the results page.
    const q = new URLSearchParams(location.search).get('search');
    if (q) {
      query = q.trim();
      history.replaceState(null, '', '/#Special.Search');
    }
    route();
  }
  function subjectSize(s) { return [...wiki.subjects.get(s).values()].reduce((n, l) => n + l.length, 0); }
  function classCount(id) { return wiki.articles.filter(a => a.cls === id).length; }

  function fail(html) {
    main.innerHTML = `<div class="status err"><img src="${FLAG}" alt=""><h1>The wiki couldn't load</h1><p>${html}</p></div>`;
  }

  /* ---------- routing ---------- */
  let byClick = false, current = null;
  const scrolls = new Map();
  addEventListener('scroll', () => { if (current !== null) scrolls.set(current, scrollY); spy(); }, { passive: true });
  // Same-site links (/, /wiki/…, /#…) change the address without reloading the page.
  function navigate(url, replace) {
    if (replace) history.replaceState(null, '', url); else if (url !== location.pathname + location.hash) history.pushState(null, '', url);
    route();
  }
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download')) return;
    const h = a.getAttribute('href');
    if (h === '#' || h.startsWith('#')) return;            // in-page controls (contents, "more facts")
    if (!(h === '/' || h.startsWith('/wiki/') || h.startsWith('/#'))) return;
    e.preventDefault();
    byClick = true;
    navigate(h);
  });
  addEventListener('hashchange', route);
  addEventListener('popstate', route);

  function route() {
    if (!wiki) return;
    let key = '';
    const dec = t => { try { return decodeURIComponent(t); } catch { return t; } };
    const hash = dec(location.hash.slice(1));
    const art0 = k => wiki.bySlug.get(k) || resolve(wiki, k.replace(/_/g, ' '));
    if (hash) {
      // Old addresses (irad.wiki/#Talas) move to the article's own address.
      const a = !/^(Special|Class|Category|Subject)\.|^File:|~source$/.test(hash) && art0(hash);
      if (a) { history.replaceState(null, '', pagePath(a.slug)); key = a.slug; }
      else { key = hash; if (location.pathname !== '/') history.replaceState(null, '', hashOf(hash)); }
    } else if (location.pathname.startsWith('/wiki/')) {
      const name = dec(location.pathname.slice(6)).replace(/\.html$/, '').replace(/\/$/, '');
      const a = wiki.byPage.get(name.toLowerCase()) || art0(name);
      key = a ? a.slug : name;
    }
    const fresh = byClick; byClick = false;
    current = key;
    closeSuggest(); closeMenu();
    headings = [];

    if (key === 'Special.Random') {
      const a = wiki.articles[Math.floor(Math.random() * wiki.articles.length)];
      navigate(href(a.slug), true);
      return;
    }
    let title, article = null;
    const art = k => wiki.bySlug.get(k) || resolve(wiki, k.replace(/_/g, ' '));
    if (!key) title = renderHome();
    else if (key === 'Special.All') title = renderIndex();
    else if (key === 'Special.Search') title = renderSearch();
    else if (key === 'Special.Media' || key.startsWith('Special.Media?')) title = renderMedia(new URLSearchParams(key.split('?')[1] || ''));
    else if (key.startsWith('File:') && mediaFiles().byName.has(key.slice(5))) title = renderFile(mediaFiles().byName.get(key.slice(5)));
    else if (key.startsWith('Class.') && classOf(key.slice(6))) title = renderClass(key.slice(6));
    else if (key.startsWith('Category.') && wiki.catBySlug.has(key.slice(9))) title = renderCategory(wiki.catBySlug.get(key.slice(9)));
    else if (key.startsWith('Subject.') && wiki.subjBySlug.has(key.slice(8))) title = renderSubject(wiki.subjBySlug.get(key.slice(8)));
    else if (key.endsWith('~source') && (article = art(key.slice(0, -7)))) title = renderSource(article);
    else if ((article = art(key))) title = renderArticle(article);
    else title = renderMissing(key);

    document.title = title ? `${title} – Irad Wiki` : 'Irad Wiki, the free encyclopedia';
    setMeta(key, title, article && !key.endsWith('~source') ? article : null);
    if (!headings.length) side.innerHTML = `<div class="nav-h">Main menu</div>${menuHtml(key)}`;
    renderFooter(article && !key.endsWith('~source') ? article : null);
    const y = !fresh && scrolls.has(key) ? scrolls.get(key) : 0;
    requestAnimationFrame(() => { scrollTo(0, y); spy(); });
  }

  /* ---------- page metadata ----------
     Keeps the description, canonical address and social-preview tags in the
     <head> in step with the page shown, for search engines that run scripts.
     The values set at build time (see build.sh) describe the site as a whole. */
  const SITE = 'https://irad.wiki/';
  const siteDescription = document.querySelector('meta[name="description"]')?.content || '';
  function setMeta(key, title, article) {
    const full = document.title;
    const desc = article ? ledeOf(article) : siteDescription;
    const url = article ? 'https://irad.wiki' + pagePath(article.slug) : SITE + (key ? hashOf(key).slice(1) : '');
    const set = (sel, value) => { const el = document.querySelector(sel); if (el) el.content = value; };
    set('meta[name="description"]', desc);
    set('meta[property="og:title"]', full);
    set('meta[property="og:description"]', desc);
    set('meta[property="og:url"]', url);
    set('meta[property="og:type"]', article ? 'article' : 'website');
    set('meta[name="twitter:title"]', full);
    set('meta[name="twitter:description"]', desc);
    const canon = document.querySelector('link[rel="canonical"]');
    if (canon) canon.href = url;
  }

  /* ---------- main menu ---------- */
  function menuHtml(key) {
    const here = k => (k === key ? ' class="here" aria-current="page"' : '');
    return `
      <ul class="nav-list">
        <li><a href="/"${here('')}>Main page</a></li>
        <li><a href="/#Special.All"${here('Special.All')}>All pages</a></li>
        <li><a href="/#Special.Random">Random article</a></li>
        <li><a href="/#Special.Media"${key && (key === 'Special.Media' || key.startsWith('Special.Media?') || key.startsWith('File:')) ? ' class="here" aria-current="page"' : ''}>Media</a><span class="n">${mediaFiles().list.length}</span></li>
      </ul>
      <div class="nav-sub">Article quality</div>
      <ul class="nav-list">${CLASSES.map(c => `<li><a href="/#Class.${c.id}"${here('Class.' + c.id)}>${esc(c.name)}</a><span class="n">${classCount(c.id)}</span></li>`).join('')}</ul>
      <div class="nav-sub">Portals</div>
      <ul class="nav-list">${wiki.subjectOrder.map(s => `<li><a href="/#Subject.${categorySlug(s)}"${here('Subject.' + categorySlug(s))}>${esc(s)}</a><span class="n">${subjectSize(s)}</span></li>`).join('')}</ul>`;
  }
  const menuBtn = $('#menuBtn');
  function closeMenu() { menuPanel.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!wiki) return;
    if (!menuPanel.hidden) return closeMenu();
    menuPanel.innerHTML = `<div class="nav-h">Main menu</div>${menuHtml(current)}`;
    menuPanel.hidden = false; menuBtn.setAttribute('aria-expanded', 'true');
  });
  document.addEventListener('click', e => { if (!menuPanel.hidden && !e.target.closest('#menuPanel')) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); closeSuggest(); } });

  /* ---------- contents (scroll-spy) ---------- */
  let headings = [];
  function renderToc(list) {
    headings = list;
    side.innerHTML = `<div class="nav-h">Contents</div>
      <nav class="toc" aria-label="Contents"><ol>
        <li><a href="#" data-to="top">(Top)</a></li>
        ${list.map(h => `<li><a href="#" data-to="${h.id}">${esc(h.text)}</a></li>`).join('')}
      </ol></nav>`;
  }
  side.addEventListener('click', e => {
    const a = e.target.closest('a[data-to]'); if (!a) return;
    e.preventDefault();
    if (a.dataset.to === 'top') scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
    else document.getElementById(a.dataset.to)?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
  });
  function spy() {
    if (!headings.length) return;
    let active = 'top';
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el && el.getBoundingClientRect().top < 90) active = h.id;
    }
    side.querySelectorAll('.toc a').forEach(a => a.classList.toggle('active', a.dataset.to === active));
  }

  /* ---------- markdown ---------- */
  const STUB_WORDS = {
    geo: 'the geography of Irad', culture: 'Iradi culture', bio: 'an Iradi person', org: 'an Iradi organization',
    settlement: 'a settlement in Irad', plant: 'a plant of Irad', fauna: 'the animals of Irad', mountain: 'a mountain in Irad',
    craft: 'an Iradi craft', lake: 'a lake in Irad', river: 'a river in Irad', history: 'the history of Irad',
    horse: 'Iradi horses', sport: 'sport in Irad', glacier: 'a glacier in Irad',
  };

  function toHtml(src) {
    // links first, so templates such as {{Hatnote|… see [[Talas River]]}} keep working links
    const pre = src
      .replace(WIKILINK, (_, t, label) => {
        if (WP_PREFIX.test(t)) {
          const name = t.replace(WP_PREFIX, '').trim();
          return `<a class="ext" href="${wpUrl(name)}" target="_blank" rel="noopener" title="${esc(name)} (Wikipedia)">${esc(label || name)}</a>`;
        }
        const target = resolve(wiki, t);
        const text = label || t;
        return target
          ? `<a class="wl" href="${href(target.slug)}" title="${esc(target.title)}">${esc(text)}</a>`
          : `<a class="red" href="${href(slugOf(t.trim()))}" title="${esc(t)} (page does not exist)">${esc(text)}</a>`;
      })
      .replace(STUB_TEMPLATE, (_, body) => {
        const [name, ...args] = body.split('|');
        if (/^listen$/i.test(name.trim())) {
          const o = {};
          for (const raw of args) { const i = raw.indexOf('='); if (i > 0) o[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim(); }
          if (!o.file) return '';
          const file = o.file.replace(/[^\w.\-]/g, '');
          return `<div class="listen" role="group" aria-label="Audio"><div class="listen-head">Listen</div>${o.title ? `<div class="listen-title">${o.title}</div>` : ''}<audio controls preload="none" src="/audio/${file}"></audio>${o.description ? `<div class="listen-desc">${o.description}</div>` : ''}</div>`;
        }
        if (/^hatnote$/i.test(name.trim())) return `<div class="hatnote" role="note">${args.join('|')}</div>`;
        if (/^(main|see also|further)$/i.test(name.trim())) {
          const kind = name.trim().toLowerCase();
          const links = args.map(x => x.trim()).filter(Boolean).map(t => { const tg = resolve(wiki, t); return tg ? `<a class="wl" href="${href(tg.slug)}">${esc(tg.title)}</a>` : `<a class="red" href="${href(slugOf(t))}">${esc(t)}</a>`; });
          const lead = kind === 'main' ? (links.length > 1 ? 'Main articles' : 'Main article') : kind === 'further' ? 'Further information' : 'See also';
          return `<div class="hatnote" role="note">${lead}: ${links.join(', ').replace(/, ([^,]*)$/, links.length > 1 ? ' and $1' : ', $1')}</div>`;
        }
        if (/^coord$/i.test(name.trim())) return coordHtml(args[0], args[1]);
        if (/^navbox$/i.test(name.trim())) return navboxHtml(args.join('|').trim());
        if (/^weather box$/i.test(name.trim())) return weatherBox(templateArgs(args));
        if (/^infobox album$/i.test(name.trim())) return albumInfobox(templateArgs(args));
        if (/^album ratings$/i.test(name.trim())) return albumRatings(templateArgs(args));
        if (/^infobox musical artist$/i.test(name.trim())) return artistInfobox(templateArgs(args));
        if (/^infobox book$/i.test(name.trim())) return bookInfobox(templateArgs(args));
        if (/^infobox person$/i.test(name.trim())) return personInfobox(templateArgs(args));
        if (/^infobox artist$/i.test(name.trim())) return artInfobox(templateArgs(args));
        if (/^infobox ethnic group$/i.test(name.trim())) return ethnicInfobox(templateArgs(args));
        if (/^infobox military conflict$/i.test(name.trim())) return conflictInfobox(templateArgs(args), false);
        if (/^infobox civil conflict$/i.test(name.trim())) return conflictInfobox(templateArgs(args), true);
        const gen = name.trim().match(/^infobox (.+)$/i);
        if (gen && GENERIC_INFOBOXES[gen[1].trim().toLowerCase()]) return genericInfobox(GENERIC_INFOBOXES[gen[1].trim().toLowerCase()], templateArgs(args));
        const fix = maintenanceHtml(name, args);
        if (fix) return fix;
        const m = name.match(/^Irad-(\w+)-stub$/i);
        if (m || /^Irad-stub$/i.test(name)) {
          const about = m ? (STUB_WORDS[m[1].toLowerCase()] || m[1].toLowerCase() + ' in Irad') : 'Irad';
          return `<div class="stub-note">${ICON.stub}<span>This article about ${about} is a stub. You can help Irad Wiki by expanding it.</span></div>`;
        }
        return `<div class="stub-note">${esc(name)}${args.length ? ': ' + args.join(' | ') : ''}</div>`;
      });
    return md.render(pre);
  }

  /* {{Infobox album|name=…|artist=…}} and {{Album ratings|…}}, after Wikipedia's templates.
     Arguments are "key = value", one per line; values may hold *italics* and [[links]]. */
  function templateArgs(args) {
    const o = {}, order = [];
    for (const raw of args) {
      const i = raw.indexOf('=');
      if (i < 0) continue;
      const k = raw.slice(0, i).trim().toLowerCase(), v = raw.slice(i + 1).trim();
      if (k && v) { o[k] = v; order.push(k); }
    }
    o._order = order;
    return o;
  }
  const inl = v => md.renderInline(v).replace(/\n/g, ' ');
  const ALBUM_TYPES = {
    studio: ['Studio album', 'album-studio'], compilation: ['Compilation album', 'album-comp'],
    live: ['Live album', 'album-live'], ep: ['EP', 'album-ep'], single: ['Single', 'album-single'],
    soundtrack: ['Soundtrack album', 'album-comp'], demo: ['Demo album', 'album-demo'],
  };
  function albumInfobox(o) {
    const [typeName, typeCls] = ALBUM_TYPES[(o.type || 'studio').toLowerCase()] || ALBUM_TYPES.studio;
    const fileEntry = o.image ? images.find(e => e.file === o.image) : null;
    const img = o.image ? `<figure><a href="${fileHref(o.image)}"><img src="${IMAGES}${esc(o.image)}" alt="${esc(o.alt || (fileEntry && fileEntry.alt) || 'Cover art')}" loading="lazy"></a>${o.caption ? `<figcaption>${inl(o.caption)}</figcaption>` : ''}</figure>` : '';
    const ROWS = [['released', 'Released'], ['recorded', 'Recorded'], ['venue', 'Venue'], ['studio', 'Studio'], ['genre', 'Genre'],
      ['length', 'Length'], ['language', 'Language'], ['label', 'Label'], ['producer', 'Producer']];
    const rows = ROWS.filter(([k]) => o[k]).map(([k, label]) => `<dt>${label}</dt><dd>${inl(o[k].replace(/(?<!&#?\w+)\s*;\s*/g, '<br>'))}</dd>`).join('');
    let chron = '';
    if (o.prev || o.next) {
      const cell = (t, y, cls) => t ? `<div class="${cls}">${inl(t)}${y ? `<br>(${esc(y)})` : ''}</div>` : '<div></div>';
      chron = `<div class="band ${typeCls}">${esc(o.artist_plain || (o.artist || '').replace(/<[^>]+>/g, '').replace(/[*_]/g, ''))} chronology</div>
        <div class="chron">${cell(o.prev, o.prev_year, 'prev')}<div><b>${inl('*' + o.name + '*')}</b>${o.year ? `<br>(${esc(o.year)})` : ''}</div>${cell(o.next, o.next_year, 'next')}</div>`;
    }
    const singles = o.singles ? `<div class="band ${typeCls}">Singles from ${inl('*' + o.name + '*')}</div><ol class="singles">${o.singles.split(/\s*;\s*/).map(x => `<li>${inl(x)}</li>`).join('')}</ol>` : '';
    const above = (o.type || '').toLowerCase() === 'single' ? `"${esc(o.name || '')}"` : `<i>${esc(o.name || '')}</i>`;
    return `<aside class="infobox album"><div class="above">${above}</div>${img}<div class="band ${typeCls}">${typeName} by ${inl(o.artist || '')}</div><dl>${rows}</dl>${chron}${singles}</aside>`;
  }
  /* Infoboxes that are a title, an optional image and labelled rows, after the Wikipedia templates of the
     same names. Each entry: the band under the image (optional) and its rows as [key, label, format?].
     Values take [[links]], *italics* and ";" for line breaks. A lead image listed in images.json moves
     into the box when the box has no image of its own (placeImages). */
  const ibNum = v => /^\d+(\.\d+)?$/.test(v) ? Number(v).toLocaleString('en') : v;
  const unit = u => v => `${ibNum(v)} ${u}`;
  const GENERIC_INFOBOXES = {
    settlement: { band: o => o.settlement_type || '', rows: [['subdivision', 'Region'], ['district', 'District'], ['established', 'Established'],
      ['leader_name', o => o.leader_title || 'Leader'], ['area_km2', 'Area', unit('km²')], ['elevation_m', 'Elevation', unit('m')],
      ['population', o => o.population_year ? `Population (${esc(o.population_year)})` : 'Population', ibNum], ['demonym', 'Demonym'],
      ['coordinates', 'Coordinates'], ['postal_code', 'Postal code'], ['area_code', 'Dialling code'], ['website', 'Website']] },
    company: { rows: [['type', 'Type'], ['industry', 'Industry'], ['predecessor', 'Predecessor'], ['founded', 'Founded'], ['founder', 'Founder'],
      ['hq', 'Headquarters'], ['locations', 'Number of locations'], ['area_served', 'Area served'], ['key_people', 'Key people'],
      ['products', 'Products'], ['services', 'Services'], ['revenue', 'Revenue'], ['employees', 'Employees', ibNum], ['owner', 'Owner'],
      ['parent', 'Parent'], ['subsidiaries', 'Subsidiaries'], ['website', 'Website']] },
    'political party': { rows: [['leader', 'Leader'], ['founder', 'Founder'], ['founded', 'Founded'], ['dissolved', 'Dissolved'], ['hq', 'Headquarters'],
      ['newspaper', 'Newspaper'], ['youth_wing', 'Youth wing'], ['ideology', 'Ideology'], ['position', 'Political position'], ['colours', 'Colours'],
      ['seats1', o => o.seats1_title || 'Seats'], ['website', 'Website']] },
    legislature: { band: o => o.house_type || '', rows: [['leader1', o => o.leader1_type || 'Speaker'], ['leader2', o => o.leader2_type || 'Deputy'],
      ['members', 'Seats'], ['groups', 'Political groups'], ['voting_system', 'Voting system'], ['last_election', 'Last election'],
      ['next_election', 'Next election'], ['meeting_place', 'Meeting place'], ['website', 'Website']] },
    'football club': { rows: [['full_name', 'Full name'], ['nickname', 'Nickname(s)'], ['founded', 'Founded'], ['ground', 'Ground'],
      ['capacity', 'Capacity', ibNum], ['owner', 'Owner'], ['chairman', 'Chairman'], ['manager', 'Head coach'], ['league', 'League'],
      ['position', o => o.season ? `${esc(o.season)}` : 'Last season'], ['colours', 'Colours'], ['website', 'Website']] },
    'sports league': { rows: [['sport', 'Sport'], ['founded', 'Founded'], ['country', 'Country'], ['teams', 'No. of teams'], ['levels', 'Level on pyramid'],
      ['champion', 'Current champions'], ['most_champs', 'Most titles'], ['tv', 'TV partners'], ['website', 'Website']] },
    'horse race': { rows: [['location', 'Location'], ['inaugurated', 'Inaugurated'], ['race_type', 'Race type'], ['distance', 'Distance'],
      ['surface', 'Surface'], ['qualification', 'Qualification'], ['purse', 'Purse'], ['website', 'Website']] },
    newspaper: { rows: [['type', 'Type'], ['format', 'Format'], ['owner', 'Owner(s)'], ['publisher', 'Publisher'], ['editor', 'Editor'],
      ['founded', 'Founded'], ['political', 'Political alignment'], ['language', 'Language'], ['hq', 'Headquarters'],
      ['circulation', 'Circulation'], ['website', 'Website']] },
    river: { rows: [['countries', 'Country'], ['source', 'Source'], ['mouth', 'Mouth'], ['length_km', 'Length', unit('km')],
      ['basin_km2', 'Basin size', unit('km²')], ['discharge', 'Discharge'], ['tributaries_left', 'Left tributaries'],
      ['tributaries_right', 'Right tributaries']] },
    'mountain range': { rows: [['countries', 'Country'], ['highest', 'Highest point'], ['elevation_m', 'Elevation', unit('m')],
      ['length_km', 'Length', unit('km')], ['width_km', 'Width', unit('km')], ['parent', 'Parent range'], ['geology', 'Rock type']] },
    'christian denomination': { rows: [['type', 'Type'], ['classification', 'Classification'], ['polity', 'Polity'], ['leader', o => o.leader_title || 'Leader'],
      ['liturgy', 'Liturgy'], ['language', 'Language'], ['region', 'Region'], ['hq', 'Headquarters'], ['founded', 'Origin'],
      ['members', 'Members'], ['parishes', 'Parishes'], ['clergy', 'Clergy'], ['website', 'Website']] },
    'television channel': { rows: [['country', 'Country'], ['broadcast_area', 'Broadcast area'], ['language', 'Language'], ['owner', 'Owner'],
      ['sister_channels', 'Sister channels'], ['launched', 'Launched'], ['hq', 'Headquarters'], ['website', 'Website']] },
    university: { rows: [['motto', 'Motto'], ['established', 'Established'], ['type', 'Type'], ['rector', 'Rector'], ['students', 'Students', ibNum],
      ['staff', 'Academic staff', ibNum], ['city', 'Location'], ['campus', 'Campus'], ['language', 'Language'], ['website', 'Website']] },
    venue: { rows: [['location', 'Location'], ['opened', 'Opened'], ['owner', 'Owner'], ['operator', 'Operator'], ['capacity', 'Capacity', ibNum],
      ['surface', 'Surface'], ['tenants', 'Tenants'], ['website', 'Website']] },
    organization: { rows: [['formation', 'Formation'], ['type', 'Type'], ['purpose', 'Purpose'], ['hq', 'Headquarters'],
      ['leader_name', o => o.leader_title || 'Head'], ['parent_organization', 'Parent organization'], ['staff', 'Staff', ibNum], ['budget', 'Budget'], ['website', 'Website']] },
    military: { rows: [['founded', 'Founded'], ['current_form', 'Current form'], ['branches', 'Service branches'],
      ['hq', 'Headquarters'], ['commander_in_chief', o => o.commander_in_chief_title || 'Commander-in-chief'],
      ['minister', o => o.minister_title || 'Minister of Defense'], ['commander', o => o.commander_title || 'Commander'],
      ['age', 'Military age'], ['conscription', 'Conscription'], ['active', 'Active personnel', ibNum], ['reserve', 'Reserve personnel', ibNum],
      ['budget', 'Budget'], ['percent_gdp', 'Percent of GDP'], ['website', 'Website']] },
    'military installation': { band: o => o.type || '', rows: [['location', 'Location'], ['coordinates', 'Coordinates'], ['operator', 'Operator'],
      ['controlled_by', 'Controlled by'], ['built', 'Built'], ['in_use', 'In use'], ['garrison', 'Garrison'], ['occupants', 'Occupants'],
      ['elevation_m', 'Elevation', unit('m')], ['runways', 'Runways'], ['website', 'Website']] },
    treaty: { band: o => o.long_name || '', rows: [['type', 'Type'], ['drafted', 'Drafted'], ['signed', 'Signed'], ['location', 'Location'],
      ['effective', 'Effective'], ['condition', 'Condition'], ['expiration', 'Expiration'], ['mediators', 'Mediators'],
      ['signatories', 'Signatories'], ['parties', 'Parties'], ['depositor', 'Depositary'], ['language', 'Languages']] },
    court: { rows: [['established', 'Established'], ['jurisdiction', 'Jurisdiction'], ['location', 'Location'], ['coordinates', 'Coordinates'],
      ['composition', 'Composition method'], ['authority', 'Authorized by'], ['appeals_to', 'Appeals to'], ['terms', 'Judge term length'],
      ['positions', 'Number of positions', ibNum], ['chief_name', o => o.chief_title || 'Chief Justice'], ['website', 'Website']] },
    currency: { rows: [['iso_code', 'ISO 4217 code'], ['symbol', 'Symbol'], ['subunit', 'Subunit'], ['banknotes', 'Banknotes'], ['coins', 'Coins'],
      ['issuer', 'Central bank'], ['user', 'User(s)'], ['pegged_with', 'Pegged with'], ['inflation', 'Inflation'], ['website', 'Website']] },
    flag: { band: o => o.use || '', rows: [['proportion', 'Proportion'], ['adopted', 'Adopted'], ['design', 'Design'], ['designer', 'Designed by']] },
    language: { rows: [['pronunciation', 'Pronunciation'], ['states', 'Native to'], ['region', 'Region'], ['ethnicity', 'Ethnicity'],
      ['speakers', 'Native speakers'], ['family', 'Language family'], ['early_forms', 'Early forms'], ['dialects', 'Dialects'],
      ['script', 'Writing system'], ['official', 'Official language in'], ['minority', 'Recognised minority language in'],
      ['regulator', 'Regulated by']] },
    film: { italic: true, rows: [['director', 'Directed by'], ['writer', 'Written by'], ['based_on', 'Based on'], ['starring', 'Starring'],
      ['music', 'Music by'], ['cinematography', 'Cinematography'], ['editing', 'Edited by'], ['studio', 'Production company'],
      ['distributor', 'Distributed by'], ['released', 'Release date'], ['runtime', 'Running time'], ['country', 'Country'],
      ['language', 'Language'], ['budget', 'Budget']] },
    'former country': { rows: [['status', 'Status'], ['capital', 'Capital'], ['largest_city', 'Largest city'],
      ['languages', o => o.languages_type || 'Common languages'], ['religion', 'Religion'], ['demonym', 'Demonym'], ['government', 'Government'],
      ['leader1', o => o.leader_title1 || 'Leader'], ['leader2', o => o.leader_title2 || 'Leader'], ['leader3', o => o.leader_title3 || 'Leader'],
      ['legislature', 'Legislature'], ['era', 'Historical era'], ['established', o => o.established_title || 'Established'],
      ['event1', o => o.event1_title || 'Event'], ['event2', o => o.event2_title || 'Event'],
      ['disestablished', o => o.disestablished_title || 'Disestablished'], ['area_km2', 'Area', unit('km²')],
      ['population', o => o.population_year ? `Population (${esc(o.population_year)})` : 'Population', ibNum], ['currency', 'Currency'],
      ['time_zone', 'Time zone'], ['preceded_by', 'Preceded by'], ['succeeded_by', 'Succeeded by'], ['today', 'Today part of']] },
    economy: { rows: [['country', 'Country'], ['currency', 'Currency'], ['fiscal_year', 'Fiscal year'], ['trade_orgs', 'Trade organizations'],
      ['gdp', 'GDP'], ['gdp_per_capita', 'GDP per capita'], ['gdp_sectors', 'GDP by sector'], ['inflation', 'Inflation (CPI)'],
      ['labor', 'Labor force'], ['labor_occupation', 'Labor force by occupation'], ['unemployment', 'Unemployment'], ['industries', 'Main industries'], ['exports', 'Exports'],
      ['export_goods', 'Export goods'], ['export_partners', 'Main export partners'], ['imports', 'Imports'], ['import_goods', 'Import goods'],
      ['import_partners', 'Main import partners'], ['reserves', 'Foreign reserves']] },
    election: { title: o => o.election_name, band: o => o.type || '',
      rows: [['country', 'Country'], ['date', 'Date'], ['previous_election', 'Previous election'], ['next_election', 'Next election'],
        ['registered', 'Registered', ibNum], ['turnout', 'Turnout']],
      after: (o, cell) => {
        const n = [1, 2, 3, 4, 5, 6].filter(i => o['candidate' + i]);
        // Party, Votes and % columns appear only when some candidate has a value for them.
        const cols = [['party', 'Party', v => cell(v), ''], ['votes', 'Votes', v => cell(ibNum(v)), 'right'], ['percentage', '%', v => cell(v), 'right']]
          .filter(([k]) => n.some(i => o[k + i]));
        const td = (v, align) => `<td${align ? ` style="text-align:${align}"` : ''}>${v}</td>`;
        // Styled by the article's .prose table rules; width and margins inline so no stylesheet change is needed.
        const cands = n.length ? `<table class="ib-election" style="width:100%;margin:.3em 0;font-size:100%"><thead><tr><th scope="col">Candidate</th>${
          cols.map(([, l]) => `<th scope="col">${l}</th>`).join('')}</tr></thead><tbody>${
          n.map(i => `<tr>${td(cell(o['candidate' + i]))}${cols.map(([k, , f, al]) => td(o[k + i] ? f(o[k + i]) : '', al)).join('')}</tr>`).join('')}</tbody></table>` : '';
        const foot = [['result', 'Result'], ['before_election', o.before_title || 'Before election'], ['after_election', o.after_title || 'Elected']]
          .filter(([k]) => o[k]).map(([k, l]) => `<dt>${esc(l)}</dt><dd>${cell(o[k])}</dd>`).join('');
        return cands + (foot ? `<dl>${foot}</dl>` : '');
      } },
    'religious building': { rows: [['location', 'Location'], ['coordinates', 'Coordinates'], ['affiliation', 'Affiliation'],
      ['rite', 'Rite'], ['district', 'Ecclesiastical jurisdiction'], ['status', 'Status'], ['leadership', 'Leadership'], ['founder', 'Founded by'],
      ['consecrated', 'Consecrated'], ['heritage', 'Heritage designation'], ['architect', 'Architect(s)'], ['architecture_type', 'Architectural type'],
      ['style', 'Style'], ['groundbreaking', 'Groundbreaking'], ['completed', 'Completed'], ['domes', 'Dome(s)', ibNum], ['materials', 'Materials'],
      ['website', 'Website']] },
    'horse breed': { rows: [['altname', 'Other names'], ['country', 'Country of origin'], ['features', 'Distinguishing features'], ['use', 'Use'],
      ['height', 'Height'], ['weight', 'Weight'], ['color', 'Color'], ['standard', 'Breed standard'], ['status', 'Conservation status']] },
    'protected area': { band: o => o.iucn_category || '', rows: [['location', 'Location'], ['nearest_city', 'Nearest city'], ['coordinates', 'Coordinates'],
      ['area_km2', 'Area', unit('km²')], ['elevation_m', 'Elevation', unit('m')], ['established', 'Established'], ['visitation', 'Visitors'],
      ['governing_body', 'Governing body'], ['designation', 'Designation'], ['website', 'Website']] },
    legislation: { band: o => o.long_title || '', rows: [['citation', 'Citation'], ['territorial_extent', 'Territorial extent'], ['enacted_by', 'Enacted by'],
      ['enacted', 'Enacted'], ['signed_by', 'Signed by'], ['signed', 'Signed'], ['commenced', 'Commenced'], ['bill', 'Bill'],
      ['introduced_by', 'Introduced by'], ['amended_by', 'Amended by'], ['repealed_by', 'Repealed by'], ['related', 'Related legislation'],
      ['status', 'Status']] },
  };
  // Wikipedia's {{Infobox country}} draws both; here it is the former-country box (capital, government, leaders, era …),
  // used also for sub-national polities such as the ISEZ and the tribal regions.
  GENERIC_INFOBOXES.country = GENERIC_INFOBOXES['former country'];
  /* {{Coord|lat|lon}}: decimal degrees, linked to the Kartalar map (maps.attelkom.net) at that point. */
  function coordHtml(lat, lon) {
    const a = parseFloat(lat), b = parseFloat(lon);
    if (!isFinite(a) || !isFinite(b)) return esc(`${lat} ${lon}`);
    const text = `${Math.abs(a).toFixed(2)}°${a >= 0 ? 'N' : 'S'} ${Math.abs(b).toFixed(2)}°${b >= 0 ? 'E' : 'W'}`;
    return `<a class="ext coord" href="https://maps.attelkom.net/#map=11/${a}/${b}" target="_blank" rel="noopener" title="Show on Attelkom Kartalar">${text}</a>`;
  }
  /* {{Navbox|Name}}: a footer box defined in navboxes.json (title, then groups of [[links]]). */
  let navboxes = {};
  /* {{Weather box|location=…|record_high=…|high=…|low=…|record_low=…|precip=…|precip_days=…|source=…}},
     after Wikipedia's climate tables: twelve monthly values per row, separated by ";" or ",", in °C and mm;
     the year column is worked out (mean of the means, extremes of the records, sum of precipitation).
     Temperatures are shaded from blue (cold) to red (hot) and shown with °F below. */
  function weatherBox(o) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const vals = v => String(v || '').split(/[;,]/).map(x => x.trim().replace('−', '-')).filter(Boolean).map(Number);
    const fmt = n => (n < 0 ? '−' : '') + Math.abs(Math.round(n * 10) / 10);
    const f = c => fmt(c * 9 / 5 + 32);
    const shade = t => {
      // blue below 0 °C, white near 10 °C, orange to red above 20 °C
      const c = Math.max(-30, Math.min(40, t));
      if (c < 10) { const k = (10 - c) / 40; return `rgb(${Math.round(255 - 200 * k)},${Math.round(255 - 150 * k)},255)`; }
      const k = (c - 10) / 30; return `rgb(255,${Math.round(255 - 180 * k)},${Math.round(255 - 230 * k)})`;
    };
    const rows = [];
    const temp = (key, label, year) => {
      const v = vals(o[key]);
      if (v.length !== 12) return;
      const y = year(v);
      const cell = t => `<td style="background:${shade(t)}${t < -20 || t > 36 ? ';color:#fff' : ''}">${fmt(t)}<br><small>(${f(t)})</small></td>`;
      rows.push(`<tr><th scope="row">${label} °C (°F)</th>${v.map(cell).join('')}${cell(y)}</tr>`);
    };
    temp('record_high', 'Record high', v => Math.max(...v));
    temp('high', 'Mean daily maximum', v => v.reduce((a, b) => a + b) / 12);
    temp('mean', 'Daily mean', v => v.reduce((a, b) => a + b) / 12);
    temp('low', 'Mean daily minimum', v => v.reduce((a, b) => a + b) / 12);
    temp('record_low', 'Record low', v => Math.min(...v));
    const p = vals(o.precip);
    if (p.length === 12) {
      const sum = p.reduce((a, b) => a + b);
      const cell = x => `<td style="background:rgb(${Math.round(255 - Math.min(x, 60) * 2.2)},${Math.round(255 - Math.min(x, 60) * 1.2)},255)">${fmt(x)}<br><small>(${fmt(x / 25.4)})</small></td>`;
      rows.push(`<tr><th scope="row">Average precipitation mm (inches)</th>${p.map(cell).join('')}${cell(sum)}</tr>`);
    }
    const d = vals(o.precip_days);
    if (d.length === 12) rows.push(`<tr><th scope="row">Average precipitation days</th>${d.map(x => `<td>${fmt(x)}</td>`).join('')}<td>${fmt(d.reduce((a, b) => a + b))}</td></tr>`);
    if (!rows.length) return '';
    return `<div class="weatherbox"><table><caption>Climate data for ${inl(o.location || '')}</caption>
      <thead><tr><th scope="col">Month</th>${MON.map(m => `<th scope="col">${m}</th>`).join('')}<th scope="col">Year</th></tr></thead>
      <tbody>${rows.join('')}</tbody>${o.source ? `<tfoot><tr><td colspan="14">Source: ${inl(o.source)}</td></tr></tfoot>` : ''}</table></div>`;
  }
  function navboxHtml(name) {
    const nb = navboxes[name];
    if (!nb) return `<div class="stub-note">Navbox: ${esc(name)}</div>`;
    const link = t => { const m = t.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/); const title = m ? m[1] : t; const tg = resolve(wiki, title);
      const text = m && m[2] ? m[2] : (tg ? tg.title : title);
      return tg ? (tg.title === renderingTitle ? `<b>${esc(text)}</b>` : `<a class="wl" href="${href(tg.slug)}">${esc(text)}</a>`) : esc(text); };
    const rows = nb.groups.map(([g, items]) => `<tr><th scope="row">${esc(g)}</th><td>${items.map(link).join(' · ')}</td></tr>`).join('');
    return `<table class="navbox"><caption>${nb.link ? link(nb.link) : esc(nb.title)}</caption><tbody>${rows}</tbody></table>`;
  }
  function genericInfobox(spec, o) {
    const cell = v => inl(String(v).replace(/(?<!&#?\w+)\s*;\s*/g, '<br>'));
    const pic = o.logo || o.image;
    const fileEntry = pic ? images.find(e => e.file === pic) : null;
    const img = pic ? `<figure${o.logo ? ' class="ib-logo"' : ''}><a href="${fileHref(pic)}"><img src="${IMAGES}${esc(pic)}" alt="${esc(o.alt || (fileEntry && fileEntry.alt) || o.name || '')}" loading="lazy"></a>${o.caption ? `<figcaption>${inl(o.caption)}</figcaption>` : ''}</figure>` : '';
    const rows = spec.rows.filter(([k]) => o[k]).map(([k, label, fmt]) => {
      const l = typeof label === 'function' ? label(o) : esc(label);
      const v = fmt ? fmt(o[k]) : o[k];
      const c = k === 'coordinates' && String(v).match(/^([0-9.]+)°([NS])\s+([0-9.]+)°([EW])$/);
      if (c) return `<dt>${l}</dt><dd>${coordHtml((c[2] === 'S' ? -1 : 1) * c[1], (c[4] === 'W' ? -1 : 1) * c[3])}</dd>`;
      return `<dt>${l}</dt><dd>${cell(v)}</dd>`;
    }).join('');
    const band = spec.band && spec.band(o) ? `<div class="ib-sub">${esc(spec.band(o))}</div>` : '';
    const native = o.native_name ? `<span>${inl(o.native_name)}</span>` : '';
    // Settlements get a dot on the shared location map, as Wikipedia's location maps do.
    let loc = '';
    const pt = spec === GENERIC_INFOBOXES.settlement && locators && locators.places ? locators.places[renderingTitle] || locators.places[o.name] : null;
    if (pt && o.map !== 'none') {
      loc = `<figure class="locator ib-locmap"><div class="locmap"><img src="${IMAGES}${esc(locators.map)}" alt="Location map of Irad" loading="lazy" width="${locators.width}" height="${locators.height}"><span class="dot" style="left:${pt[0]}%;top:${pt[1]}%"></span></div><figcaption>Location of ${esc(o.name || renderingTitle)} in Irad</figcaption></figure>`;
    }
    const title = esc((spec.title && spec.title(o)) || o.name || '');
    const after = spec.after ? spec.after(o, cell) : '';
    return `<aside class="infobox generic">${'<div class="above">' + (spec.italic ? `<i>${title}</i>` : title) + native + '</div>'}${band}${img}${loc}<dl>${rows}</dl>${after}</aside>`.replace(/<dl><\/dl>/g, '');
  }
  /* {{Infobox book|name=…|author=…}}, after Wikipedia's {{Infobox book}}. */
  function bookInfobox(o) {
    const img = o.image ? `<figure><a href="${fileHref(o.image)}"><img src="${IMAGES}${esc(o.image)}" alt="${esc(o.alt || 'Cover')}" loading="lazy"></a>${o.caption ? `<figcaption>${inl(o.caption)}</figcaption>` : ''}</figure>` : '';
    const ROWS = [['title_orig', 'Original title'], ['author', 'Author'], ['translator', 'Translator'], ['cover_artist', 'Cover artist'],
      ['country', 'Country'], ['language', 'Language'], ['genre', 'Genre'], ['set_in', 'Set in'], ['publisher', 'Publisher'],
      ['pub_date', 'Publication date'], ['english_pub_date', 'Published in English'], ['media_type', 'Media type'], ['pages', 'Pages'],
      ['deposit', 'Legal deposit'], ['website', 'Online']];
    const rows = ROWS.filter(([k]) => o[k]).map(([k, label]) => `<dt>${label}</dt><dd>${inl(o[k].replace(/(?<!&#?\w+)\s*;\s*/g, '<br>'))}</dd>`).join('');
    return `<aside class="infobox book"><div class="above"><i>${esc(o.name || '')}</i></div>${img}<dl>${rows}</dl></aside>`;
  }
  function artistInfobox(o) {
    const kind = (o.background || 'group_or_band').toLowerCase();
    const cls = kind.startsWith('solo') ? 'artist-solo' : kind.startsWith('classical') ? 'artist-classical' : 'artist-group';
    const img = o.image ? `<figure><a href="${fileHref(o.image)}"><img src="${IMAGES}${esc(o.image)}" alt="${esc(o.alt || o.name || '')}" loading="lazy"></a>${o.caption ? `<figcaption>${inl(o.caption)}</figcaption>` : ''}</figure>` : '';
    const ROWS = [['also_known_as', 'Also known as'], ['origin', 'Origin'], ['genre', 'Genres'], ['years_active', 'Years active'],
      ['labels', 'Labels'], ['spinoff_of', 'Spinoff of'], ['spinoffs', 'Spinoffs'], ['members', 'Members'], ['past_members', 'Past members'], ['website', 'Website']];
    const rows = ROWS.filter(([k]) => o[k]).map(([k, label]) => `<dt>${label}</dt><dd>${inl(o[k].replace(/(?<!&#?\w+)\s*;\s*/g, '<br>'))}</dd>`).join('');
    return `<aside class="infobox artist"><div class="above">${esc(o.name || '')}</div>${img}<div class="band ${cls}">Background information</div><dl>${rows}</dl></aside>`;
  }
  /* {{Infobox person|…}}, after Wikipedia's {{Infobox person}}, {{Infobox officeholder}} and
     {{Infobox military person}}. Offices are numbered: office1, term_start1, term_end1, plus
     governor1, lieutenant1, appointer1, preceded_by1, succeeded_by1 (up to office6). A term_start
     with no term_end shows as "Incumbent". birth_date and death_date are "1954-04-12", "1954-04"
     or "1954"; the age is worked out from today's date. Dates are written "12 April 1954"; df = mdy writes "April 12, 1954". */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function personDate(v, dmy) {
    const m = String(v || '').trim().match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
    if (!m) return v ? { text: v } : null;
    const [y, mo, d] = [+m[1], m[2] ? +m[2] : 0, m[3] ? +m[3] : 0];
    const text = d ? (dmy ? `${d} ${MONTHS[mo - 1]} ${y}` : `${MONTHS[mo - 1]} ${d}, ${y}`) : mo ? `${MONTHS[mo - 1]} ${y}` : String(y);
    return { text, y, mo, d };
  }
  function yearsBetween(a, b) {
    // Exact age when both dates are complete, otherwise the possible range.
    if (a.d && b.d) return String(b.y - a.y - ((b.mo < a.mo || (b.mo === a.mo && b.d < a.d)) ? 1 : 0));
    const hi = b.y - a.y, lo = hi - 1;
    return `${lo}–${hi}`;
  }
  /* {{Infobox artist|…}}, after Wikipedia's template for painters and sculptors: name, image, caption,
     birth_name, birth_date, birth_place, death_date, death_place, nationality, education, alma_mater,
     known_for, notable_works, style, movement, spouse, awards, patrons, memorials. Drawn by personInfobox;
     awards sit with the personal details rather than under a military band. */
  function artInfobox(o) {
    const a = { ...o };
    if (a.awards) { a.artist_awards = a.awards; delete a.awards; }
    return personInfobox(a);
  }
  function personInfobox(o) {
    const dmy = !/^mdy$/i.test(o.df || '');
    const cell = v => inl(v.replace(/(?<!&#?\w+)\s*;\s*/g, '<br>'));
    const row = (label, v) => v ? `<dt>${label}</dt><dd>${cell(v)}</dd>` : '';
    const band = t => `</dl><div class="band person-band">${t}</div><dl>`;
    const now = new Date(), today = { y: now.getFullYear(), mo: now.getMonth() + 1, d: now.getDate() };
    const born = personDate(o.birth_date, dmy), died = personDate(o.death_date, dmy);
    let bornText = '', diedText = '';
    if (born || o.birth_place || o.birth_name) {
      const date = born ? born.text + (born.y && !died ? ` (age ${yearsBetween(born, today)})` : '') : '';
      bornText = [o.birth_name ? esc(o.birth_name) : '', date ? esc(date) : '', o.birth_place ? inl(o.birth_place) : ''].filter(Boolean).join('<br>');
    }
    if (died || o.death_place) {
      const date = died ? died.text + (born && born.y && died.y ? ` (aged ${yearsBetween(born, died)})` : '') : '';
      diedText = [date ? esc(date) : '', o.death_place ? inl(o.death_place) : ''].filter(Boolean).join('<br>');
    }
    let offices = '';
    for (let i = 1; i <= 6; i++) {
      const title = o['office' + i];
      if (!title) continue;
      const start = personDate(o['term_start' + i], dmy), end = personDate(o['term_end' + i], dmy);
      let term = '';
      if (start && end) term = `<div class="term">In office<br>${esc(start.text)} – ${esc(end.text)}</div>`;
      else if (start) term = `<div class="term"><i>Incumbent</i><br>Assumed office<br>${esc(start.text)}</div>`;
      else if (end) term = `<div class="term">In office<br>? – ${esc(end.text)}</div>`;
      const rows = [['governor', 'Governor'], ['lieutenant', 'Lieutenant Governor'], ['appointer', 'Appointed by'],
        ['preceded_by', 'Preceded by'], ['succeeded_by', 'Succeeded by']]
        .map(([k, label]) => row(label, o[k + i])).join('');
      offices += `<div class="band person-band office">${inl(title)}</div>${term}${rows ? `<dl>${rows}</dl>` : ''}`;
    }
    const PERSONAL = [['other_names', 'Other names'], ['nickname', 'Nickname'], ['_born', 'Born'], ['_died', 'Died'],
      ['resting_place', 'Resting place'], ['citizenship', 'Citizenship'], ['nationality', 'Nationality'],
      ['party', 'Political party'], ['spouse', 'Spouse'], ['children', 'Children'], ['parents', 'Parents'],
      ['relatives', 'Relatives'], ['residence', 'Residence'], ['education', 'Education'], ['alma_mater', 'Alma mater'],
      ['occupation', 'Occupation'], ['title', 'Title'], ['known_for', 'Known for'], ['notable_works', 'Notable work'],
      ['style', 'Style'], ['movement', 'Movement'], ['artist_awards', 'Awards'], ['patrons', 'Patron(s)'], ['memorials', 'Memorials'], ['net_worth', 'Net worth'],
      ['church', 'Church'], ['ordination', 'Ordination'], ['religion', 'Religion']];
    const personal = PERSONAL.map(([k, label]) =>
      k === '_born' ? (bornText ? `<dt>${label}</dt><dd>${bornText}</dd>` : '') :
      k === '_died' ? (diedText ? `<dt>${label}</dt><dd>${diedText}</dd>` : '') : row(label, o[k])).join('');
    const MILITARY = [['allegiance', 'Allegiance'], ['branch', 'Branch/service'], ['serviceyears', 'Years of service'],
      ['rank', 'Rank'], ['unit', 'Unit'], ['commands', 'Commands'], ['battles', 'Battles/wars'], ['awards', 'Awards']];
    const military = MILITARY.map(([k, label]) => row(label, o[k])).join('');
    const img = o.image ? `<figure><a href="${fileHref(o.image)}"><img src="${IMAGES}${esc(o.image)}" alt="${esc(o.alt || o.name || '')}" loading="lazy"></a>${o.caption ? `<figcaption>${inl(o.caption)}</figcaption>` : ''}</figure>` : '';
    const above = `<div class="above">${o.honorific_prefix ? `<span class="hon">${inl(o.honorific_prefix)}</span>` : ''}${esc(o.name || '')}${o.native_name ? `<span>${inl(o.native_name)}</span>` : ''}</div>`;
    let body = '';
    if (personal) body += (offices ? band('Personal details') : '') + personal;
    if (military) body += (offices || personal ? band('Military service') : '') + military;
    return `<aside class="infobox person">${above}${img}${offices}<dl>${body}</dl></aside>`.replace(/<dl><\/dl>/g, '');
  }
  /* {{Infobox military conflict|…}} and {{Infobox civil conflict|…}}, after Wikipedia's templates.
     Military: conflict, partof, image, caption, date, place, result, territory, status, then sides
     numbered 1–3: combatant, commander, units, strength, casualties; casualties3 with only two
     sides (or casualties4 with three) is a full-width civilian line; notes at the foot.
     Civil: title, partof, image, caption, date, place, causes, goals, methods, result, status,
     side1–3, leadfigures1–3, howmany1–3, casualties1–3, then fatalities, injuries, arrests,
     detentions as full-width totals. Values may hold [[links]] and *italics*; ";" breaks a line. */
  /* {{Infobox ethnic group|…}}, after Wikipedia's template: group, native_name, image, caption,
     popplace (total), region1–10 with pop1–10, languages, religions, related. */
  function ethnicInfobox(o) {
    const cell = v => inl(v.replace(/(?<!&#?\w+)\s*;\s*/g, '<br>'));
    const img = o.image ? `<figure><a href="${fileHref(o.image)}"><img src="${IMAGES}${esc(o.image)}" alt="${esc(o.alt || o.caption || '')}" loading="lazy"></a>${o.caption ? `<figcaption>${inl(o.caption)}</figcaption>` : ''}</figure>` : '';
    const above = `<div class="above">${esc(o.group || '')}${o.native_name ? `<span>${inl(o.native_name)}</span>` : ''}</div>`;
    let regions = '';
    for (let i = 1; i <= 10; i++) if (o['region' + i]) regions += `<dt>${cell(o['region' + i])}</dt><dd>${o['pop' + i] ? cell(o['pop' + i]) : ''}</dd>`;
    const sec = (label, v) => v ? `<div class="band ethnic-band">${label}</div><div class="full">${cell(v)}</div>` : '';
    return `<aside class="infobox ethnic">${above}${img}`
      + (o.popplace ? sec('Total population', o.popplace) : '')
      + (regions ? `<div class="band ethnic-band">Regions with significant populations</div><dl>${regions}</dl>` : '')
      + sec('Languages', o.languages) + sec('Religion', o.religions) + sec('Related ethnic groups', o.related)
      + `</aside>`;
  }
  function conflictInfobox(o, civil) {
    const cell = v => inl(v.replace(/(?<!&#?\w+)\s*;\s*/g, '<br>'));
    const row = (label, v) => v ? `<dt>${label}</dt><dd>${cell(v)}</dd>` : '';
    const img = o.image ? `<figure><a href="${fileHref(o.image)}"><img src="${IMAGES}${esc(o.image)}" alt="${esc(o.alt || o.caption || '')}" loading="lazy"></a>${o.caption ? `<figcaption>${inl(o.caption)}</figcaption>` : ''}</figure>` : '';
    const title = civil ? (o.title || o.name || '') : (o.conflict || o.name || '');
    const partof = o.partof ? `<div class="partof">Part of ${inl(o.partof)}</div>` : '';
    const top = civil
      ? [['date', 'Date'], ['place', 'Location'], ['causes', 'Caused by'], ['goals', 'Goals'], ['methods', 'Methods'],
         ['result', 'Resulted in'], ['status', 'Status']]
      : [['date', 'Date'], ['place', 'Location'], ['result', 'Result'], ['territory', 'Territorial changes'], ['status', 'Status']];
    const head = `<dl>${top.map(([k, label]) => row(label, o[k])).join('')}</dl>`;
    const sideKey = civil ? 'side' : 'combatant';
    const n = [3, 2, 1].find(i => o[sideKey + i] || o[(civil ? 'leadfigures' : 'commander') + i]) || 0;
    const groups = civil
      ? [['side', 'Parties'], ['leadfigures', 'Lead figures'], ['howmany', 'Number'], ['casualties', 'Casualties']]
      : [['combatant', 'Belligerents'], ['commander', 'Commanders and leaders'], ['units', 'Units involved'],
         ['strength', 'Strength'], ['casualties', 'Casualties and losses']];
    let sides = '';
    for (const [k, label] of groups) {
      const vals = Array.from({ length: n }, (_, i) => o[k + (i + 1)] || '');
      const extra = k === 'casualties' && !civil ? o['casualties' + (n + 1)] : '';
      if (!vals.some(Boolean) && !extra) continue;
      sides += `<div class="band conflict-band">${label}</div>`;
      if (vals.some(Boolean)) sides += `<div class="sides n${n}">${vals.map(v => `<div>${v ? cell(v) : ''}</div>`).join('')}</div>`;
      if (extra) sides += `<div class="full">${cell(extra)}</div>`;
    }
    if (civil) {
      const totals = [['fatalities', 'Death(s)'], ['injuries', 'Injuries'], ['arrests', 'Arrested'], ['detentions', 'Detained']]
        .map(([k, label]) => row(label, o[k])).join('');
      if (totals) sides += `${o.casualties1 || o.casualties2 ? '' : '<div class="band conflict-band">Casualties</div>'}<dl>${totals}</dl>`;
    }
    const notes = o.notes ? `<div class="full notes">${cell(o.notes)}</div>` : '';
    return `<aside class="infobox conflict"><div class="above conflict-title">${inl(title)}</div>${partof}${img}${head}${sides}${notes}</aside>`.replace(/<dl><\/dl>/g, '');
  }
  function albumRatings(o) {
    const rows = o._order.filter(k => !k.startsWith('_')).map(k => {
      const v = o[k];
      const stars = v.match(/^(\d(?:\.5)?)\/(\d)$/);
      const shown = stars ? `<span class="stars" title="${esc(v)} stars">${'★'.repeat(Math.floor(+stars[1]))}${+stars[1] % 1 ? '½' : ''}${'☆'.repeat(+stars[2] - Math.ceil(+stars[1]))}</span>` : inl(v);
      return `<tr><td>${inl(k.replace(/(^|\s)\S/g, c => c.toUpperCase()))}</td><td>${shown}</td></tr>`;
    }).join('');
    return `<table class="ratings"><caption>Professional ratings</caption><thead><tr><th colspan="2">Review scores</th></tr><tr><th>Source</th><th>Rating</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  /* Wraps tables and makes citation markers clickable. */
  function enhance(root) {
    root.querySelectorAll('table').forEach(t => {
      if (t.parentElement.classList.contains('tbl') || t.classList.contains('ratings')) return;
      const w = document.createElement('div'); w.className = 'tbl'; t.replaceWith(w); w.appendChild(t);
    });
    root.querySelectorAll('sup').forEach(s => {
      const m = s.textContent.trim().match(/^\[(\d+|[a-z])\]$/);
      if (!m) return;
      const note = /^[a-z]$/.test(m[1]);
      s.classList.add('cite'); s.tabIndex = 0; s.setAttribute('role', 'link'); s.dataset.n = m[1];
      s.dataset.target = note ? `note-${m[1]}` : `cite_note-${m[1]}`;
      s.setAttribute('aria-label', note ? `Note ${m[1]}` : `Reference ${m[1]}`);
    });
  }
  main.addEventListener('click', e => { const s = e.target.closest('sup.cite'); if (s) jumpCite(s); });
  main.addEventListener('keydown', e => { const s = e.target.closest('sup.cite'); if (s && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); jumpCite(s); } });
  function jumpCite(s) {
    const li = s.closest('.prose').querySelector(`[id="${s.dataset.target || 'cite_note-' + s.dataset.n}"]`);
    if (!li) return;
    li.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash');
    setTimeout(() => li.classList.remove('flash'), 2000);
  }

  /* ---------- article ---------- */
  function indicators(a) {
    if (a.cls === 'FA') return `<a href="/#Class.FA" title="This is a featured article. Click here for more information.">${ICON.FA}</a>`;
    if (a.cls === 'GA') return `<a href="/#Class.GA" title="This is a good article. Click here for more information.">${ICON.GA}</a>`;
    return '';
  }
  function articleHead(a, view) {
    return `
      <div class="title-row"><h1 class="firstHeading">${view === 'source' ? `View source for ${esc(a.title)}` : esc(a.title)}</h1><div class="indicators">${indicators(a)}</div></div>
      <div class="tabs">
        <nav aria-label="Namespaces"><a class="sel" href="${href(a.slug)}">Article</a></nav>
        <nav aria-label="Views"><a ${view === 'read' ? 'class="sel" aria-current="page"' : ''} href="${href(a.slug)}">Read</a><a ${view === 'source' ? 'class="sel" aria-current="page"' : ''} href="${href(a.slug + '~source')}">View source</a></nav>
      </div>`;
  }
  function catlinks(a) {
    const c = classOf(a.cls);
    const stub = a.stubType ? (a.stubType.match(/^Irad-(\w+)-stub$/i) || [])[1] : null;
    return `<div class="catlinks"><a href="/#Special.All">Categories</a>: <ul>
      <li><a href="/#Category.${categorySlug(a.category)}">${esc(a.category)}</a></li>
      ${a.tags.map(t => `<li><a href="/#Category.${categorySlug(t)}">${esc(t)}</a></li>`).join('')}
      <li><a href="/#Class.${a.cls}">${esc(c ? c.name : a.cls)}</a></li>
      <li><a href="/#Subject.${categorySlug(subjectOf(a.category))}">Portal: ${esc(subjectOf(a.category))}</a></li>
      ${stub ? `<li>${esc(stub[0].toUpperCase() + stub.slice(1))} stubs</li>` : ''}
    </ul></div>`;
  }

  /* ---------- images ---------- */
  const imagesFor = a => images.filter(e => e.article === a.title);
  function thumbImg(e) {
    const stem = e.file.replace(/\.svg$/i, '');
    const isSvg = /\.svg$/i.test(e.file);
    const src = isSvg ? `${IMAGES}thumb/${e.width}px-${stem}.png` : IMAGES + e.file;
    const srcset = isSvg ? ` srcset="${IMAGES}thumb/${e.width * 2}px-${stem}.png 2x"` : '';
    return `<a href="${fileHref(e.file)}" title="${esc(fileTitle(e.file))}"><img src="${src}"${srcset} width="${e.width}" alt="${esc(e.alt || (e.caption || '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\*/g, ''))}" loading="lazy"></a>`;
  }
  // Captions may hold [[links]] and *italics*.
  function capHtml(t) {
    return esc(t).replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, tt, label) => {
      const target = resolve(wiki, tt), text = label || tt;
      return target ? `<a class="wl" href="${href(target.slug)}" title="${esc(target.title)}">${text}</a>` : text;
    }).replace(/\*([^*]+)\*/g, '<i>$1</i>');
  }
  // Caption plus, for photos from Wikimedia Commons, the attribution their licences require.
  function figCaption(e) {
    let credit = e.notice ? `<span class="credit">${esc(e.notice)}</span>` : '';
    if (e.source) {
      const lic = e.license_url ? `<a href="${esc(e.license_url)}" target="_blank" rel="noopener">${esc(e.license || 'licence')}</a>` : esc(e.license || '');
      credit = `<span class="credit">Photo: <a href="${esc(e.source)}" target="_blank" rel="noopener">${esc(e.author || 'Wikimedia Commons')}</a>${lic ? ', ' + lic : ''}</span>`;
    }
    return (e.caption || credit) ? `<figcaption>${capHtml(e.caption || '')}${credit}</figcaption>` : '';
  }
  // Puts each image after its section heading (and after a "Main article" note, as Wikipedia does).
  // "placement": "lead" puts it at the top right of the article instead, as for a company logo.
  function placeImages(body, a) {
    // As on Wikipedia, the lead picture goes inside the infobox, under its title (and above a
    // settlement's location map), unless the box already has a picture of its own.
    let box = body.querySelector('aside.infobox');
    const h2 = body.querySelector('h2');
    if (box && h2 && (h2.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING)) box = null; // a box further down
    let leads = imagesFor(a).filter(x => x.placement === 'lead');
    const ownPic = box && [...box.querySelectorAll('figure, img')].some(el => !el.closest('.locator, .locmap'));
    if (box && leads.length && !ownPic) {
      const e = leads[0], fig = document.createElement('figure');
      fig.className = 'ib-lead';
      fig.innerHTML = thumbImg(e) + figCaption(e);
      const top = [...box.children].filter(el => el.matches('.above, .ib-sub, .partof, .conflict-partof')).pop();
      if (top) top.after(fig); else box.prepend(fig);
      leads = leads.slice(1);
    }
    for (const e of leads.slice().reverse()) {
      const fig = document.createElement('figure');
      fig.className = 'thumb lead';
      fig.style.width = (e.width + 8) + 'px';
      fig.innerHTML = thumbImg(e) + figCaption(e);
      // After any hatnotes at the top, before the first paragraph.
      let at = null;
      for (const el of body.children) { if (el.classList.contains('hatnote')) at = el; else break; }
      if (at) at.after(fig); else body.prepend(fig);
    }
    for (const e of imagesFor(a)) {
      if (!e.section) continue;
      const h = [...body.querySelectorAll('h2, h3, h4')].find(x => x.textContent.trim() === e.section);
      if (!h) { console.warn(`Irad Wiki: no section "${e.section}" in ${a.title} for ${e.file}`); continue; }
      const fig = document.createElement('figure');
      fig.className = e.align === 'left' ? 'thumb tleft' : 'thumb';
      fig.style.width = (e.width + 8) + 'px';
      fig.innerHTML = thumbImg(e) + figCaption(e);
      let at = h;
      const next = h.nextElementSibling;
      if (next && /^Main articles?:/i.test(next.textContent.trim())) at = next;
      // "after": n moves it down past the section's first n paragraphs (never past the next heading).
      for (let n = e.after || 0; n > 0; n--) {
        let el = at.nextElementSibling;
        while (el && !/^H[1-6]$/.test(el.tagName) && el.tagName !== 'P') el = el.nextElementSibling;
        if (!el || el.tagName !== 'P') break;
        at = el;
      }
      at.after(fig);
    }
  }

  function renderArticle(a) {
    const body = document.createElement('div');
    body.className = 'prose';
    renderingTitle = a.title;
    body.innerHTML = toHtml(a.src);
    renderingTitle = '';
    enhance(body);
    placeImages(body, a);
    const hs = [...body.querySelectorAll('h2')];
    hs.forEach((h, i) => { h.id = 'sec-' + (i + 1); });
    if (hs.length >= 2) {
      const t = document.createElement('details');
      t.className = 'inline-toc';
      t.innerHTML = `<summary>Contents</summary><ol>${hs.map(h => `<li><a href="#" data-to="${h.id}">${esc(h.textContent)}</a></li>`).join('')}</ol>`;
      t.addEventListener('click', e => { const l = e.target.closest('a[data-to]'); if (l) { e.preventDefault(); document.getElementById(l.dataset.to)?.scrollIntoView(); } });
      hs[0].before(t);
    }
    if (a.slug === 'Irad' && infobox) body.prepend(renderInfobox(infobox));

    const back = [...(wiki.backlinks.get(a.slug) || [])].sort(byTitle);
    main.innerHTML = `
      <article>
        ${articleHead(a, 'read')}
        <div class="siteSub">From Irad Wiki, the free encyclopedia</div>
        <div id="body"></div>
        ${back.length ? `<details class="backlinks"><summary>What links here (${back.length})</summary><ul>${back.map(b => `<li><a href="${href(b.slug)}">${esc(b.title)}</a></li>`).join('')}</ul></details>` : ''}
        ${catlinks(a)}
      </article>`;
    $('#body').replaceWith(body);
    renderToc(hs.map(h => ({ id: h.id, text: h.textContent })));
    return a.title;
  }

  function renderSource(a) {
    main.innerHTML = `
      ${articleHead(a, 'source')}
      <div class="siteSub">From Irad Wiki, the free encyclopedia</div>
      <p class="source-note">You can view and copy the source of this page.</p>
      <pre class="source-view">${esc(a.source)}</pre>
      <p><a href="${href(a.slug)}">Return to ${esc(a.title)}.</a></p>`;
    return `View source for ${a.title}`;
  }

  function linkNames(text) {
    // Links values in the infobox that are exactly an article title, e.g. "Talas".
    return esc(text).replace(/^([^(;,]+?)(\s*\(|$)/, (m, name, rest) => {
      const t = resolve(wiki, name.trim());
      return t ? `<a href="${href(t.slug)}">${esc(name)}</a>${rest}` : m;
    });
  }

  function renderInfobox(box) {
    const el = document.createElement('aside');
    el.className = 'infobox';
    const flag = box.rows.find(r => r.key === 'Flag');
    const emblem = box.rows.find(r => r.key === 'Emblem');
    const emblemFile = emblem && (emblem.value.match(/\(([^()\s]+\.(?:svg|png|jpg))\)\s*$/) || [])[1];
    const locator = images.find(e => e.article === 'Irad' && e.placement === 'infobox');
    const rows = box.rows.filter(r => r !== flag && r !== emblem);
    // As on Wikipedia, the location map sits after the flag and anthem, before the capital and the rest.
    const anthemAt = rows.findIndex(r => /^anthem/i.test(r.key));
    const top = rows.slice(0, anthemAt + 1), rest = rows.slice(anthemAt + 1);
    // Note markers such as [a] in a value become superscripts, as on Wikipedia; the notes are in the article.
    const val = v => linkNames(v).replace(/\[([a-z])\]/g, '<sup class="ib-note">[$1]</sup>');
    // The anthem row links its title to the article and, as on Wikipedia, carries an audio player:
    // Anthem: 'The Spirit of Irad' (The_Spirit_of_Irad.mp3)
    const anthemCell = v => {
      const file = (v.match(/\(([\w.\-]+\.mp3)\)\s*$/) || [])[1];
      const title = v.replace(/\([^()]*\.mp3\)\s*$/, '').trim().replace(/^['"‘“]|['"’”]$/g, '');
      const t = resolve(wiki, title);
      const name = t ? `<a href="${href(t.slug)}">${esc(title)}</a>` : esc(title);
      // The player goes in a full-width cell under the row, as on Wikipedia.
      return `"${name}"</dd>${file ? `<dd class="ib-wide"><audio class="ib-audio" controls preload="none" src="/audio/${file}"></audio>` : ''}`;
    };
    const dl = list => list.length ? `<dl>${list.map(r => `<dt>${esc(r.key)}</dt><dd>${r.value ? (/^anthem/i.test(r.key) ? anthemCell(r.value) : val(r.value)) : ''}${r.items.length ? `<ul>${r.items.map(i => `<li>${i.label ? `${esc(i.label)}: ` : ''}${val(i.value)}</li>`).join('')}</ul>` : ''}</dd>`).join('')}</dl>` : '';
    el.innerHTML = `
      <div class="above">${esc(box.name)}${box.subtitle ? `<span>${esc(box.subtitle)}</span>` : ''}</div>
      ${emblemFile ? `<div class="ib-symbols">
        <figure class="ib-flag"><img src="${FLAG}" alt="Flag of Irad" title="${flag ? esc(flag.value) : ''}"><figcaption><a href="${href('Flag_of_Irad')}">Flag</a></figcaption></figure>
        <figure class="ib-emblem"><img src="${BASE}images/${emblemFile}" alt="Emblem of Irad" title="${esc(emblem.value)}"><figcaption><a href="${href('Emblem_of_Irad')}">Emblem</a></figcaption></figure>
      </div>` : `<figure><img src="${FLAG}" alt="Flag of Irad">${flag ? `<figcaption>Flag: ${esc(flag.value)}</figcaption>` : ''}</figure>`}
      ${dl(top)}
      ${locator ? `<figure class="locator">${thumbImg(locator)}${locator.caption ? `<figcaption>${esc(locator.caption)}</figcaption>` : ''}</figure>` : ''}
      ${dl(rest)}`;
    return el;
  }

  function renderMissing(key) {
    const t = key.replace(/_/g, ' ');
    main.innerHTML = `
      <div class="title-row"><h1 class="firstHeading">${esc(t)}</h1></div>
      <div class="siteSub">From Irad Wiki, the free encyclopedia</div>
      <div class="cat-intro"><p><b>Irad Wiki does not have an article with this exact name.</b> Please <a href="/#Special.Search" id="searchFor">search for <i>${esc(t)}</i> in Irad Wiki</a> to check for alternative titles or spellings.</p></div>`;
    $('#searchFor').addEventListener('click', () => { query = t; });
    return t;
  }

  /* ---------- media: a Commons-style gallery and a page for every file ----------
     Every file in images/images.json gets a page at #File:Name.jpg with its preview,
     description, source, licence and the articles that use it. #Special.Media is the
     gallery, filtered by type and portal (#Special.Media?type=Maps&portal=History).
     A file's type comes from its credit and extension; an entry can override it with "type". */
  const MEDIA_TYPES = ['Photographs', 'Maps', 'Charts and diagrams', 'Emblems and symbols', 'Logos', 'Screenshots'];
  const fileTitle = f => 'File:' + f.replace(/_/g, ' ');
  const fileHref = f => href('File:' + f);
  const isSvgFile = f => /\.svg$/i.test(f);
  const num = n => n.toLocaleString('en');
  function fmtBytes(n) {
    if (n < 1024) return `${num(n)} bytes`;
    if (n < 1024 * 1024) return `${num(Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(2).replace(/\.?0+$/, '')} MB`;
  }
  function mediaType(e) {
    if (MEDIA_TYPES.includes(e.type)) return e.type;
    const c = `${e.credit || ''} ${e.notice || ''}`;
    if (/screenshot/i.test(c)) return 'Screenshots';
    if (/\blogo\b/i.test(c) || /_logo[_.]/i.test(e.file)) return 'Logos';
    if (isSvgFile(e.file)) return /natural earth/i.test(c) || /map/i.test(e.file) ? 'Maps' : 'Charts and diagrams';
    return 'Photographs';
  }
  function mediaFiles() {
    if (media) return media;
    const byName = new Map();
    for (const e of images) {
      if (!e.file) continue;
      if (!byName.has(e.file)) byName.set(e.file, { file: e.file, entries: [] });
      byName.get(e.file).entries.push(e);
    }
    const list = [...byName.values()].sort((a, b) => collator.compare(a.file, b.file));
    list.forEach((m, i) => {
      m.index = i;
      m.type = mediaType(m.entries.find(x => x.type) || m.entries[0]);
      m.info = fileInfo[m.file] || null;
      m.commons = m.entries.find(x => x.source) || null;
      m.uses = m.entries.filter(x => x.article).map(x => ({ e: x, a: resolve(wiki, x.article) }));
      m.portals = [...new Set(m.uses.filter(u => u.a).map(u => subjectOf(u.a.category)))];
      m.text = fold([m.file.replace(/_/g, ' '), ...m.entries.map(x => `${x.caption || ''} ${x.article || ''} ${x.alt || ''} ${x.author || ''}`)].join(' '));
    });
    return (media = { list, byName });
  }
  function galleryThumb(m) {
    if (m.info && m.info.thumb) return `${IMAGES}thumb/${m.info.thumb}`;
    const e = m.entries[0];
    return isSvgFile(m.file) ? `${IMAGES}thumb/${e.width}px-${m.file.replace(/\.svg$/i, '')}.png` : IMAGES + encodeURI(m.file);
  }
  const sizeLine = m => m.info ? `${num(m.info.width)} × ${num(m.info.height)}; ${fmtBytes(m.info.bytes)}` : '';
  function mediaHref(type, portal) {
    const q = [];
    if (type) q.push('type=' + encodeURIComponent(type));
    if (portal) q.push('portal=' + encodeURIComponent(categorySlug(portal)));
    return '#Special.Media' + (q.length ? '?' + q.join('&') : '');
  }

  function renderMedia(params) {
    const { list } = mediaFiles();
    const type = MEDIA_TYPES.includes(params.get('type')) ? params.get('type') : '';
    const portal = wiki.subjBySlug.get(params.get('portal') || '') || '';
    const ofType = t => m => !t || m.type === t;
    const ofPortal = p => m => !p || m.portals.includes(p);
    const scope = list.filter(ofType(type)).filter(ofPortal(portal));
    const types = MEDIA_TYPES.map(t => [t, list.filter(ofType(t)).filter(ofPortal(portal)).length]).filter(([, n]) => n);
    const portals = wiki.subjectOrder.map(p => [p, list.filter(ofType(type)).filter(ofPortal(p)).length]).filter(([, n]) => n);
    const name = type && portal ? `${type} – ${portal}` : type || (portal ? `${portal} (media)` : '');
    const title = name ? `Category:${name}` : 'Media';
    const chip = (label, n, to, on) => `<a class="chip${on ? ' on' : ''}" href="${to}"${on ? ' aria-current="page"' : ''}>${esc(label)} <small>${num(n)}</small></a>`;
    const photos = list.filter(m => m.type === 'Photographs').length, maps = list.filter(m => m.type === 'Maps').length;
    main.innerHTML = `
      <div class="title-row"><h1 class="firstHeading">${esc(title)}</h1></div>
      <div class="tabs"><nav><a class="sel" href="${mediaHref(type, portal)}">${name ? 'Category' : 'Special page'}</a></nav><nav><a class="sel" href="${mediaHref(type, portal)}">Browse</a></nav></div>
      <div class="siteSub">From Irad Wiki, the free encyclopedia</div>
      ${name ? `<p class="cat-intro">Files on Irad Wiki${type ? ` of the type <b>${esc(type.toLowerCase())}</b>` : ''}${portal ? ` used in articles of the <a href="/#Subject.${categorySlug(portal)}">${esc(portal)}</a> portal` : ''}. <a href="/#Special.Media">All media</a>.</p>`
        : `<div class="commons-banner"><img src="${FLAG}" alt=""><div><div class="cb-name">Irad Wiki Commons</div><p>The media repository of Irad Wiki: ${num(list.length)} files, including ${num(photos)} photographs and ${num(maps)} maps, every one used in at least one article. Click a file to see its description, source, licence and the pages that use it.</p></div></div>`}
      <div class="media-browse">
        <div><span class="mb-h">Type</span>${chip('All', list.filter(ofPortal(portal)).length, mediaHref('', portal), !type)}${types.map(([t, n]) => chip(t, n, mediaHref(t, portal), t === type)).join('')}</div>
        <div><span class="mb-h">Portal</span>${chip('All', list.filter(ofType(type)).length, mediaHref(type, ''), !portal)}${portals.map(([p, n]) => chip(p, n, mediaHref(type, p), p === portal)).join('')}</div>
      </div>
      <h2 class="cat-h2">Media in ${name ? `category "${esc(name)}"` : 'Irad Wiki'}</h2>
      <div class="media-filter"><input id="mq" type="search" placeholder="Filter by file name, caption or article" aria-label="Filter these files" value="${esc(mediaQuery)}"><span id="mcount" class="r-data" aria-live="polite"></span></div>
      <ul class="gallery" id="gallery"></ul>`;
    const paint = () => {
      const f = fold(mediaQuery.trim());
      const shown = f ? scope.filter(m => m.text.includes(f)) : scope;
      $('#mcount').textContent = f
        ? `${plural(shown.length, 'file matches', 'files match')} "${mediaQuery.trim()}", out of ${num(scope.length)}.`
        : `The following ${plural(scope.length, 'file is', 'files are')} in this ${name ? 'category' : 'collection'}, out of ${num(scope.length)} total.`;
      $('#gallery').innerHTML = shown.map(m => `
        <li class="gbox"><a class="gthumb" href="${fileHref(m.file)}" title="${esc(fileTitle(m.file))}"><img src="${galleryThumb(m)}" alt="${esc(m.entries[0].alt || m.entries[0].caption || '')}" loading="lazy" decoding="async"></a>
        <div class="gtext"><a href="${fileHref(m.file)}">${esc(m.file.replace(/_/g, ' '))}</a><span>${sizeLine(m)}</span></div></li>`).join('')
        || `<li class="gnone">No files match. <a href="#" id="mclear">Clear the filter</a>.</li>`;
      $('#mclear')?.addEventListener('click', e => { e.preventDefault(); mediaQuery = ''; $('#mq').value = ''; paint(); });
    };
    $('#mq').addEventListener('input', e => { mediaQuery = e.target.value; paint(); });
    paint();
    return title;
  }

  function renderFile(m) {
    const { list } = mediaFiles();
    const prev = list[m.index - 1], next = list[m.index + 1];
    const first = m.entries[0], c = m.commons, i = m.info;
    const url = IMAGES + encodeURI(m.file);
    const uniq = k => [...new Set(m.entries.map(e => e[k]).filter(Boolean))];
    const captions = uniq('caption'), alts = uniq('alt'), notices = uniq('notice');
    const row = (k, v) => v ? `<tr><th scope="row">${k}</th><td>${v}</td></tr>` : '';
    const lic = c && c.license ? (c.license_url ? `<a href="${esc(c.license_url)}" target="_blank" rel="noopener">${esc(c.license)}</a>` : esc(c.license)) : '';
    const where = e => e.placement === 'infobox' ? 'infobox' : e.placement === 'lead' ? 'top of the article' : e.section ? `section "${esc(e.section)}"` : '';
    main.innerHTML = `
      <div class="title-row"><h1 class="firstHeading">${esc(fileTitle(m.file))}</h1></div>
      <div class="tabs"><nav><a class="sel" href="${fileHref(m.file)}">File</a></nav><nav><a class="sel" aria-current="page" href="${fileHref(m.file)}">Read</a><a href="${url}" target="_blank" rel="noopener">Open original</a></nav></div>
      <div class="siteSub">From Irad Wiki, the free encyclopedia</div>
      <nav class="file-nav" aria-label="Browse files">
        ${prev ? `<a href="${fileHref(prev.file)}" rel="prev" title="${esc(fileTitle(prev.file))}">← Previous file</a>` : '<span></span>'}
        <a href="${mediaHref(m.type, '')}">${esc(m.type)} (${num(list.filter(x => x.type === m.type).length)})</a>
        ${next ? `<a href="${fileHref(next.file)}" rel="next" title="${esc(fileTitle(next.file))}">Next file →</a>` : '<span></span>'}
      </nav>
      <div class="file-preview${isSvgFile(m.file) || /\.png$/i.test(m.file) ? ' drawn' : ''}"><a href="${url}" target="_blank" rel="noopener" title="Open the full-size file"><img src="${url}" alt="${esc(first.alt || first.caption || '')}"${i ? ` width="${i.width}" height="${i.height}"` : ''}></a></div>
      <p class="file-info"><a href="${url}" target="_blank" rel="noopener">Original file</a>${i ? ` (${num(i.width)} × ${num(i.height)} pixels, file size: ${fmtBytes(i.bytes)}, MIME type: <span>${esc(i.mime)}</span>)` : ''}</p>
      <h2 class="cat-h2">Summary</h2>
      <div class="tbl"><table class="file-summary"><tbody>
        ${row('Description', captions.map(t => `<p>${esc(t)}</p>`).join(''))}
        ${row('Alt text', alts.map(t => `<p>${esc(t)}</p>`).join(''))}
        ${row('Source', c ? `<a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(c.commons_file || 'Wikimedia Commons')}</a> on Wikimedia Commons` : esc(first.credit || ''))}
        ${row('Author', c && c.author ? esc(c.author) : '')}
        ${row('Type', `<a href="${mediaHref(m.type, '')}">${esc(m.type)}</a>`)}
      </tbody></table></div>
      ${lic || notices.length ? `<h2 class="cat-h2">Licensing</h2>
      <div class="lic-box">${lic ? `<p>This file is licensed under the ${lic} licence. Attribution: ${esc(c.credit || c.author || '')}.</p>` : ''}${notices.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
      <h2 class="cat-h2">File usage</h2>
      ${m.uses.length ? `<p>${m.uses.length === 1 ? 'The following page uses' : `The following ${num(m.uses.length)} pages use`} this file:</p>
      <ul class="file-uses">${m.uses.map(u => `<li>${u.a ? `<a href="${href(u.a.slug)}">${esc(u.a.title)}</a>` : `<a class="red" href="${href(slugOf(u.e.article))}">${esc(u.e.article)}</a>`}${where(u.e) ? ` <small>(${where(u.e)})</small>` : ''}</li>`).join('')}</ul>`
        : '<p>No pages on Irad Wiki use this file.</p>'}
      <div class="catlinks"><a href="/#Special.Media">Media</a>: <ul>
        <li><a href="${mediaHref(m.type, '')}">${esc(m.type)}</a></li>
        ${m.portals.map(p => `<li><a href="${mediaHref('', p)}">${esc(p)}</a></li>`).join('')}
      </ul></div>`;
    return fileTitle(m.file);
  }
  // Left and right arrow keys step through the files, as in a media viewer.
  document.addEventListener('keydown', e => {
    if (!current || !current.startsWith('File:') || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input, textarea')) return;
    const a = e.key === 'ArrowLeft' ? $('.file-nav a[rel="prev"]') : e.key === 'ArrowRight' ? $('.file-nav a[rel="next"]') : null;
    if (a) { byClick = true; navigate(a.getAttribute('href')); }
  });

  /* ---------- category-style lists ---------- */
  function letterOf(title) {
    const L = (fold(sortKey(title))[0] || '#').toUpperCase();
    return /[A-Z]/.test(L) ? L : '#';
  }
  function pagesColumns(list) {
    const groups = new Map();
    [...list].sort(byTitle).forEach(a => { const L = letterOf(a.title); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(a); });
    return `<div class="cat-cols">${[...groups].map(([L, as]) => `<div><h3>${L}</h3><ul>${as.map(a => `<li><a href="${href(a.slug)}">${esc(a.title)}</a></li>`).join('')}</ul></div>`).join('')}</div>`;
  }
  function listPage(title, intro, list, subcats) {
    main.innerHTML = `
      <div class="title-row"><h1 class="firstHeading">${esc(title)}</h1></div>
      <div class="tabs"><nav><a class="sel" href="${href(current)}">${title.startsWith('Portal:') ? 'Portal' : 'Category'}</a></nav><nav><a class="sel" href="${href(current)}">Read</a></nav></div>
      <div class="siteSub">From Irad Wiki, the free encyclopedia</div>
      ${intro ? `<div class="cat-intro">${intro}</div>` : ''}
      ${subcats ? `<h2 class="cat-h2">Categories</h2><p>This portal has the following ${plural(subcats.length, 'category', 'categories')}.</p><ul class="subcats">${subcats.map(([c, l]) => `<li><a href="/#Category.${categorySlug(c)}">${esc(c)}</a> <small>(${l.length} P)</small></li>`).join('')}</ul>` : ''}
      <h2 class="cat-h2">Pages in ${subcats ? 'this portal' : `category "${esc(title.replace(/^Category:/, ''))}"`}</h2>
      <p>The following ${plural(list.length, 'page is', 'pages are')} in this ${subcats ? 'portal' : 'category'}, out of ${list.length.toLocaleString('en')} total.</p>
      ${pagesColumns(list)}`;
    return title;
  }
  function renderClass(id) {
    const c = classOf(id);
    return listPage(`Category:${c.name[0].toUpperCase() + c.name.slice(1)}`, `<p>${esc(c.blurb)}</p>`, wiki.articles.filter(a => a.cls === id));
  }
  function renderCategory(cat) {
    const main = wiki.categories.get(cat) || [], tagged = wiki.tagCategories.get(cat) || [];
    const list = [...new Set([...main, ...tagged])];
    const s = main.length ? subjectOf(cat) : tagPortal(cat, list);
    const catLink = c => `<a href="/#Category.${categorySlug(c)}">${esc(c)}</a>`;
    const parent = TAG_PARENT[cat] && wiki.tagCategories.has(TAG_PARENT[cat]) ? TAG_PARENT[cat] : null;
    const subs = [...wiki.tagCategories.keys()].filter(c => TAG_PARENT[c] === cat).sort();
    let intro = main.length
      ? `<p>Part of the <a href="/#Subject.${categorySlug(s)}">${esc(s)}</a> portal.</p>`
      : `<p>This category collects ${esc(/^.[A-Z]/.test(cat) ? cat : cat[0].toLowerCase() + cat.slice(1))} from across the wiki's main categories. Part of the <a href="/#Subject.${categorySlug(s)}">${esc(s)}</a> portal.</p>`;
    if (parent) intro += `<p>A subcategory of ${catLink(parent)}.</p>`;
    if (subs.length) intro += `<p>${subs.length === 1 ? 'Subcategory' : 'Subcategories'}: ${subs.map(c => `${catLink(c)} <small>(${wiki.tagCategories.get(c).length} P)</small>`).join(' · ')}.</p>`;
    return listPage(`Category:${cat}`, intro, list);
  }
  function renderSubject(s) {
    const cats = [...wiki.subjects.get(s)].sort((a, b) => b[1].length - a[1].length);
    return listPage(`Portal:${s}`, `<p>Articles on ${esc(s.toLowerCase())} in Irad, grouped from ${plural(cats.length, 'category', 'categories')}.</p>`, cats.flatMap(([, l]) => l), cats);
  }

  function renderIndex() {
    const groups = new Map();
    for (const a of wiki.sorted) { const L = letterOf(a.title); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(a); }
    main.innerHTML = `
      <div class="title-row"><h1 class="firstHeading">All pages</h1></div>
      <div class="siteSub">From Irad Wiki, the free encyclopedia</div>
      <p class="cat-intro">Every article in Irad Wiki, ${wiki.articles.length.toLocaleString('en')} in total.</p>
      <div class="az-letters">${[...groups.keys()].map(L => `<button type="button" data-to="L-${L}">${L}</button>`).join('')}</div>
      ${[...groups].map(([L, list]) => `<h2 class="cat-h2 az-h" id="L-${L}">${L}</h2><div class="cat-cols"><ul>${list.map(a => `<li><a href="${href(a.slug)}">${esc(a.title)}</a></li>`).join('')}</ul></div>`).join('')}`;
    main.querySelector('.az-letters').addEventListener('click', e => {
      const b = e.target.closest('button'); if (b) document.getElementById(b.dataset.to)?.scrollIntoView();
    });
    return 'All pages';
  }

  /* ---------- search ---------- */
  function titleMatches(q, limit) {
    const f = fold(q.trim());
    if (!f) return [];
    const starts = [], words = [], contains = [];
    for (const a of wiki.sorted) {
      const t = fold(a.title);
      if (t.startsWith(f)) starts.push(a);
      else if (t.includes(' ' + f) || t.includes('(' + f) || t.includes('-' + f)) words.push(a);
      else if (t.includes(f)) contains.push(a);
    }
    return [...starts, ...words, ...contains].slice(0, limit);
  }
  function buildSearchIndex() {
    searchIndex = wiki.articles.map(a => { const text = plainText(a.src); return { a, text, f: fold(text), words: text.split(/\s+/).length }; });
  }

  function renderSearch() {
    if (!searchIndex) buildSearchIndex();
    const q = query.trim();
    const form = `<form class="search-big" id="bigSearch" role="search"><input id="q2" type="search" value="${esc(q)}" aria-label="Search Irad Wiki"><button type="submit">Search</button></form>`;
    const head = `<div class="title-row"><h1 class="firstHeading">Search results</h1></div>${form}`;
    const bind = () => $('#bigSearch').addEventListener('submit', e => { e.preventDefault(); query = $('#q2').value.trim(); route(); });
    if (!q) { main.innerHTML = head; bind(); return 'Search'; }
    const f = fold(q);
    const titleHits = new Set(titleMatches(q, 50));
    const results = [];
    for (const e of searchIndex) {
      const i = e.f.indexOf(f);
      if (i < 0 && !titleHits.has(e.a)) continue;
      let n = 0, p = i;
      while (p >= 0 && n < 50) { n++; p = e.f.indexOf(f, p + f.length); }
      results.push({ e, i, score: (titleHits.has(e.a) ? 1000 : 0) + (fold(e.a.title) === f ? 1000 : 0) + n });
    }
    results.sort((x, y) => y.score - x.score || byTitle(x.e.a, y.e.a));
    const exact = wiki.byFold.get(f);
    const snip = ({ e, i }) => {
      if (i < 0) return esc(ledeOf(e.a));
      const s = Math.max(0, e.text.lastIndexOf(' ', Math.max(0, i - 80)));
      const end = Math.min(e.text.length, i + f.length + 120);
      // fold() keeps string length for these scripts, so the indexes line up
      return `${s > 0 ? '… ' : ''}${esc(e.text.slice(s, i).trimStart())}<span class="searchmatch">${esc(e.text.slice(i, i + f.length))}</span>${esc(e.text.slice(i + f.length, end))}${end < e.text.length ? ' …' : ''}`;
    };
    const kb = e => Math.max(1, Math.round(e.a.src.length / 1024));
    main.innerHTML = `${head}
      ${exact ? `<p><b>There is a page named "<a href="${href(exact.slug)}">${esc(exact.title)}</a>" on Irad Wiki</b></p>` : ''}
      <div class="r-count">${results.length ? `Results 1 – ${Math.min(results.length, 100)} of ${results.length.toLocaleString('en')}` : `There were no results matching the query "${esc(q)}".`}</div>
      <ul class="results">${results.slice(0, 100).map(r => `
        <li><div class="r-title"><a href="${href(r.e.a.slug)}">${esc(r.e.a.title)}</a></div>
        <div class="r-snip">${snip(r)}</div>
        <div class="r-data">${kb(r.e)} KB (${r.e.words.toLocaleString('en')} words) · ${esc(classOf(r.e.a.cls)?.short || '')}</div></li>`).join('')}</ul>
      ${results.length > 100 ? `<p class="r-data">Only the first 100 results are shown. Add another word to narrow the search.</p>` : ''}`;
    bind();
    return `Search results for "${q}"`;
  }

  const input = $('#q'), sug = $('#suggest');
  let sel = -1;
  function closeSuggest() { sug.hidden = true; sel = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function openSuggest() {
    if (!wiki) return;
    const q = input.value.trim();
    if (!q) return closeSuggest();
    const hits = titleMatches(q, 8);
    sug.innerHTML = hits.map((a, i) => `<li role="option" id="opt${i}"><a href="${href(a.slug)}"><b>${esc(a.title)}</b><small>${esc(ledeOf(a))}</small></a></li>`).join('')
      + `<li class="all" role="option" id="opt${hits.length}"><a href="/#Special.Search" data-search="1">${ICON.search}<span>Search for pages containing <b>${esc(q)}</b></span></a></li>`;
    sug.hidden = false; sel = -1; input.setAttribute('aria-expanded', 'true');
  }
  input.addEventListener('input', openSuggest);
  input.addEventListener('focus', openSuggest);
  input.addEventListener('keydown', e => {
    const items = [...sug.querySelectorAll('li')];
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !sug.hidden) {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle('on', i === sel));
      input.setAttribute('aria-activedescendant', items[sel].id);
    }
  });
  $('#searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const items = [...sug.querySelectorAll('li')];
    if (!sug.hidden && sel >= 0 && items[sel] && !items[sel].classList.contains('all')) { items[sel].querySelector('a').click(); return; }
    const q = input.value.trim();
    if (!q || !wiki) return;
    const exact = wiki.byFold.get(fold(q));
    closeSuggest(); input.blur(); input.value = '';
    byClick = true;
    if (exact) { navigate(href(exact.slug)); return; }   // Wikipedia's "Go" behaviour
    runSearch(q);
  });
  sug.addEventListener('mousedown', e => e.preventDefault());
  sug.addEventListener('click', e => {
    const a = e.target.closest('a'); if (!a) return;
    if (a.dataset.search) { e.preventDefault(); const q = input.value.trim(); input.value = ''; closeSuggest(); input.blur(); runSearch(q); return; }
    input.value = ''; closeSuggest(); input.blur();
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) closeSuggest(); });
  function runSearch(q) {
    query = q;
    byClick = true;
    if (location.hash === '#Special.Search') route(); else navigate('/#Special.Search');
  }

  /* ---------- main page ---------- */
  function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // Turns "X is a …." into "… that X is a …?" for the Did you know box.
  function dykFact(a) {
    const para = a.src.split(/\n\s*\n/).find(p => p.trim() && !/^\s*[#<{|]/.test(p));
    if (!para) return null;
    const text = plainText(para);
    const parts = text.split(/(?<=[a-z0-9\)”"'][.!?])\s+(?=[A-Z“"])/);
    let first = parts[0] || '', k = 1;
    while (k < parts.length && /\b(St|Sts|Mt|Fr|Dr|Mr|Mrs|No|Jr|Gen|Col|Lt|Maj|Capt|Rev|vs|ca|c)\.$/.test(first)) first += ' ' + parts[k++];
    if (!fold(first).startsWith(fold(a.title)) || first.length > 230 || first.length < 40) return null;
    const rest = first.slice(a.title.length).replace(/\s*\(see [^()]*(\([^()]*\))?[^()]*\)/g, '').replace(/[.!]$/, '');
    if (!/^\s*(\(|,|is|was|are|were|has|had)/.test(rest)) return null;
    return `… that <b><a href="${href(a.slug)}">${esc(a.title)}</a></b>${esc(rest)}?`;
  }

  /* The main page changes once a day (Irad Time, UTC+6): the featured article and picture rotate through
     fixed pools by day number, Did you know is shuffled with the day as seed, and two boxes read the
     project's public feeds: IradOne's story index (In the news) and today's numbers.
     data/home.json, written by tools/seo/home.js at each build, holds the dated events for On this day
     and the new and expanded articles (Recent changes, and the pool for Did you know). */
  const IRADONE = 'https://iradone.com/';
  const feeds = { news: null, today: null, home: null, asked: false };
  const irDay = () => Math.floor((Date.now() + 6 * 3600e3) / 864e5);
  function seeded(arr, seed) {
    let t = seed >>> 0;
    const rnd = () => { t += 0x6D2B79F5; let r = Math.imul(t ^ t >>> 15, 1 | t); r ^= r + Math.imul(r ^ r >>> 7, 61 | r); return ((r ^ r >>> 14) >>> 0) / 4294967296; };
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function firstParaOf(a) { return a ? a.src.split(/\n\s*\n/).find(p => p.trim() && !/^\s*([#<{|]|\*(?!\*))/.test(p)) || '' : ''; }
  /* Main-page blurb: the article's first paragraph, with the bold title linked to the article (as on
     Wikipedia's main page), footnote marks removed and, past max characters, cut at a word with "…". */
  function fillBlurb(el, a, max) {
    if (!el || !a) return;
    const para = firstParaOf(a);
    if (!para) { el.textContent = ledeOf(a); return; }
    el.innerHTML = toHtml(para);
    el.querySelectorAll('sup').forEach(s => s.remove());
    const b = el.querySelector('b, strong');
    if (b && !b.closest('a') && !b.querySelector('a')) {
      const link = document.createElement('a');
      link.href = href(a.slug);
      while (b.firstChild) link.appendChild(b.firstChild);
      b.appendChild(link);
    }
    if (max && el.textContent.length > max) {
      let left = max;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const cut = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (left <= 0) { cut.push(n); continue; }
        if (n.nodeValue.length > left) { n.nodeValue = n.nodeValue.slice(0, left).replace(/\s+\S*$/, '') + '…'; left = 0; }
        else left -= n.nodeValue.length;
      }
      cut.forEach(n => n.remove());
    }
    const p = el.querySelector('p');
    if (p && el.tagName === 'SPAN') { while (p.firstChild) el.insertBefore(p.firstChild, p); p.remove(); }
  }
  function featuredPool() { return wiki.articles.filter(a => ['FA', 'GA', 'B'].includes(a.cls)).sort(byTitle); }
  function pictureFor(a) {
    const list = imagesFor(a);
    return list.find(e => e.placement === 'lead' || e.placement === 'infobox') || list[0] || null;
  }
  function picturePool() { return images.filter(e => !/\.svg$/i.test(e.file) && e.caption && wiki.bySlug.has(slugOf(e.article))); }
  // Bold link to the longest wiki title found in a headline, as Wikipedia's In the news does.
  function linkHeadline(h) {
    let best = null;
    for (const a of wiki.articles) {
      const t = a.title;
      if (t.length < 4 || (best && t.length <= best.title.length)) continue;
      const re = new RegExp('(^|[^\\p{L}])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}])', 'u');
      if (re.test(h)) best = a;
    }
    if (!best) return esc(h);
    const i = h.indexOf(best.title);
    return esc(h.slice(0, i)) + `<b><a href="${href(best.slug)}">${esc(best.title)}</a></b>` + esc(h.slice(i + best.title.length));
  }
  function fillNews() {
    const box = $('#itnList');
    if (!box) return;
    if (!feeds.news) { box.innerHTML = '<li class="muted">Loading the latest reports…</li>'; return; }
    if (!feeds.news.length) { box.innerHTML = '<li class="muted">No reports could be loaded.</li>'; return; }
    box.innerHTML = feeds.news.slice(0, 5).map(n => `<li>${linkHeadline(n.headline)} <a class="ext itn-src" href="${IRADONE}news/${encodeURIComponent(n.slug)}.html" target="_blank" rel="noopener">IradOne</a></li>`).join('');
  }
  function fillToday() {
    const box = $('#todayBox');
    if (!box) return;
    const t = feeds.today;
    if (!t) { box.innerHTML = '<p class="muted">Loading…</p>'; return; }
    if (t.error) { box.innerHTML = '<p class="muted">Today\'s figures could not be loaded.</p>'; return; }
    const f2 = v => Number(v).toFixed(2);
    const off = t.rates && t.rates.official, baz = t.rates && t.rates.bazaar;
    const bazUsd = baz && baz.rows ? baz.rows.find(r => r.code === 'USD') : null;
    const w = t.weather && t.weather.places ? t.weather.places.find(p => p.id === 'talas') : null;
    const tok = t.water && t.water.toktogul;
    const rows = [];
    if (off) rows.push(['Official rate', `${f2(off.usd)} som per US dollar`]);
    if (bazUsd) rows.push(['Bazaar, Talas', `${f2(bazUsd.buy)} buy · ${f2(bazUsd.sell)} sell`]);
    if (w) rows.push(['Talas weather', `${esc(w.label.en)}, ${w.high}° / ${w.low}°C`]);
    if (tok) rows.push(['Toktogul', `${Math.round(tok.fill_pct)}% full (${tok.storage_km3} of ${tok.total_km3} km³), ${esc((tok.trend_label && tok.trend_label.en || '').toLowerCase())}`]);
    if (t.power && t.power.supply) rows.push(['Power', esc(t.power.supply.en)]);
    const date = (t.label && t.label.en || '').replace(/^Market data,\s*/, '');
    box.innerHTML = `<dl class="mp-today">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="mp-more">${esc(date)} · figures from the Bank of Irad, Bazar-i Kalan money changers and Iradenergo via <a class="ext" href="${IRADONE}" target="_blank" rel="noopener">IradOne</a></div>`;
  }
  function askFeeds() {
    if (feeds.asked) return;
    feeds.asked = true;
    fetch(IRADONE + 'news/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : []).catch(() => [])
      .then(list => { feeds.news = (Array.isArray(list) ? list : []).slice().sort((a, b) => String(b.published).localeCompare(String(a.published))); fillNews(); });
    fetch('/data/home.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { error: true }).catch(() => ({ error: true }))
      .then(h => { feeds.home = h; fillOtd(); fillChanges(); if (!dykShuffled) fillDyk(false); });
    fetch(IRADONE + 'data/today.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { error: true }).catch(() => ({ error: true }))
      .then(t => { feeds.today = t; fillToday(); });
  }

  /* Did you know: hooks from articles new or expanded in the last 30 days first, as on Wikipedia,
     topped up from Start-class articles and stubs. */
  let dykShuffled = false;
  function fillDyk(reshuffle) {
    const box = $('#dykList');
    if (!box) return;
    dykShuffled = dykShuffled || reshuffle;
    const day = irDay();
    const fresh = new Set();
    const h = feeds.home;
    if (h && h.changes) {
      const since = new Date(Date.now() + 6 * 3600e3 - 30 * 864e5).toISOString().slice(0, 10);
      for (const d of h.changes) if (d.date >= since) for (const a of [...d.new, ...d.expanded]) fresh.add(a.slug);
    }
    const order = list => reshuffle ? shuffle(list) : seeded(list, day);
    const recent = wiki.articles.filter(a => fresh.has(a.slug) && a.slug !== 'Irad');
    const rest = wiki.articles.filter(a => !fresh.has(a.slug) && (a.cls === 'Start' || a.cls === 'Stub'));
    const facts = [];
    for (const a of [...order(recent), ...order(rest)]) {
      const f = dykFact(a);
      if (f) facts.push(f);
      if (facts.length === 6) break;
    }
    box.innerHTML = facts.map(f => `<li>${f}</li>`).join('');
  }
  /* On this day: the dated events of today's date (Irad Time) in the volumes, with births and
     deaths; on a day with fewer than three, events of the same month in other years. */
  function irToday() { const d = new Date(Date.now() + 6 * 3600e3); return { mo: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
  function linkIn(text, a) {
    // Bold link to the article the event comes from when its title is in the sentence, else a link after it.
    const i = text.indexOf(a.title);
    if (i >= 0) return esc(text.slice(0, i)) + `<b><a href="${href(a.slug)}">${esc(a.title)}</a></b>` + esc(text.slice(i + a.title.length));
    return linkHeadline(text) + ` (<a href="${href(a.slug)}">${esc(a.title)}</a>)`;
  }
  function fillOtd() {
    const box = $('#otdBox'), head = $('#otdHead');
    if (!box) return;
    const h = feeds.home;
    if (!h) { box.innerHTML = '<p class="muted">Loading…</p>'; return; }
    if (h.error || !h.onThisDay) { box.innerHTML = '<p class="muted">The anniversaries could not be loaded.</p>'; return; }
    const t = irToday(), pad = n => String(n).padStart(2, '0');
    const live = e => wiki.bySlug.get(e.slug);
    const list = (h.onThisDay[`${pad(t.mo)}-${pad(t.d)}`] || []).filter(live);
    const events = list.filter(e => e.kind === 'event');
    const people = list.filter(e => e.kind !== 'event');
    let html = '';
    if (events.length + people.length >= 3 || (events.length && !(h.thisMonth || {})[pad(t.mo)])) {
      head.textContent = `On this day: ${t.d} ${MONTHS[t.mo - 1]}`;
      html = `<ul class="mp-otd">${events.slice(0, 5).map(e => `<li><b>${e.year}</b> – ${linkIn(e.text, live(e))}</li>`).join('')}</ul>`;
    } else {
      head.textContent = `This month in Irad history: ${MONTHS[t.mo - 1]}`;
      const month = ((h.thisMonth || {})[pad(t.mo)] || []).filter(live);
      const pick = [...events.map(e => ({ ...e, day: true })), ...seeded(month, irDay()).slice(0, 5 - events.length)].sort((a, b) => a.year - b.year);
      html = pick.length ? `<ul class="mp-otd">${pick.map(e => `<li><b>${e.day ? `${t.d} ${MONTHS[t.mo - 1]} ` : ''}${e.year}</b> – ${linkIn(e.text, live(e))}</li>`).join('')}</ul>`
        : '<p class="muted">No anniversaries are recorded for this month yet.</p>';
    }
    if (people.length) {
      const born = people.filter(e => e.kind === 'birth'), died = people.filter(e => e.kind === 'death');
      const names = l => l.map(e => `<a href="${href(e.slug)}">${esc(live(e).title)}</a> (${e.kind === 'birth' ? 'b.' : 'd.'} ${e.year})`).join(', ');
      html += `<p class="mp-otd-people">${born.length ? `Born on this day: ${names(born)}` : ''}${born.length && died.length ? '. ' : ''}${died.length ? `Died: ${names(died)}` : ''}</p>`;
    }
    box.innerHTML = html;
  }
  /* Recent changes: new and expanded articles by day, from the git history of the volumes. */
  function fillChanges() {
    const box = $('#rcBox');
    if (!box) return;
    const h = feeds.home;
    if (!h) { box.innerHTML = '<p class="muted">Loading…</p>'; return; }
    const days = (h.changes || []).map(d => ({ ...d, new: d.new.filter(a => wiki.bySlug.has(a.slug)), expanded: d.expanded.filter(a => wiki.bySlug.has(a.slug)) }))
      .filter(d => d.new.length || d.expanded.length).slice(0, 3);
    if (h.error || !days.length) { box.innerHTML = '<p class="muted">No recent changes.</p>'; return; }
    const links = (l, n) => l.slice(0, n).map(a => `<a href="${href(a.slug)}">${esc(wiki.bySlug.get(a.slug).title)}</a>`).join(', ') + (l.length > n ? ` and ${l.length - n} more` : '');
    const date = s => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
    box.innerHTML = `<dl class="mp-rc">${days.map(d => `<dt>${date(d.date)}</dt><dd>${d.new.length ? `<b>New:</b> ${links(d.new, 5)}` : ''}${d.new.length && d.expanded.length ? '<br>' : ''}${d.expanded.length ? `<b>Expanded:</b> ${links(d.expanded, 5)}` : ''}</dd>`).join('')}</dl>`;
  }

  function renderHome(reshuffle) {
    const day = irDay();
    const pool = featuredPool();
    const fa = pool.length ? pool[((day % pool.length) + pool.length) % pool.length] : null;
    const recent = [1, 2, 3].map(k => pool[(((day - k) % pool.length) + pool.length) % pool.length]).filter(Boolean);
    const faPic = pictureFor(fa);
    const pics = picturePool();
    const pic = pics.length ? pics[(day * 7) % pics.length] : null;
    const picArticle = pic ? wiki.bySlug.get(slugOf(pic.article)) : null;
    const ga = wiki.articles.filter(a => a.cls === 'GA').sort(byTitle);
    const gaAt = k => ga.length ? ga[((((day * 5 + k) % ga.length) + ga.length) % ga.length)] : null;
    const gaToday = gaAt(0), gaRecent = ga.length > 3 ? [1, 2, 3].map(k => gaAt(-k)).filter(a => a && a !== gaToday) : [];
    const gaPic = gaToday ? pictureFor(gaToday) : null;

    main.innerHTML = `
      <h1 class="sr-only">Main Page</h1>
      <div class="mp-welcome">
        <div class="hello">Welcome to <a href="/#Irad">Irad Wiki</a>,</div>
        <p>the free encyclopedia of Iradistan.</p>
        <p><a href="/#Special.All">${wiki.articles.length.toLocaleString('en')}</a> articles in English</p>
      </div>
      <div class="mp-grid">
        <div class="mp-col">
          <section class="mp-box mp-green">
            <h2>From today's featured article</h2>
            ${fa ? `<div class="mp-tfa">${faPic ? thumbImg(faPic) : `<a href="${href(fa.slug)}"><img src="${FLAG}" alt="Flag of Irad"></a>`}<div id="tfaText"></div><p><b>(<a href="${href(fa.slug)}">Full article…</a>)</b></p></div>
            <p class="recent">Recently featured: ${recent.map(a => `<a href="${href(a.slug)}">${esc(a.title)}</a>`).join(' – ')}</p>
            <div class="mp-more"><a href="/#Class.FA">Featured articles</a> · <a href="/#Class.GA">Good articles</a> · <a href="/#Class.B">B-class articles</a></div>` : ''}
          </section>
          <section class="mp-box mp-green">
            <h2>Did you know …</h2>
            <ul id="dykList"></ul>
            <div class="mp-more"><a href="#" id="moreDyk">More facts</a> · <a href="/#Special.Random">Random article</a></div>
          </section>
          ${pic ? `<section class="mp-box mp-green">
            <h2>Today's featured picture</h2>
            <figure class="mp-pic">${thumbImg(pic)}<figcaption>${capHtml(pic.caption)}${picArticle ? ` (<a href="${href(picArticle.slug)}">${esc(picArticle.title)}</a>)` : ''}</figcaption></figure>
            <div class="mp-more"><a href="/#Special.Media">All media</a></div>
          </section>` : ''}
        </div>
        <div class="mp-col">
          <section class="mp-box mp-blue">
            <h2>In the news</h2>
            <ul id="itnList"></ul>
            <div class="mp-more"><a class="ext" href="${IRADONE}news/index.html" target="_blank" rel="noopener">More from IradOne</a></div>
          </section>
          <section class="mp-box mp-blue">
            <h2 id="otdHead">On this day</h2>
            <div id="otdBox"></div>
          </section>
          ${gaToday ? `<section class="mp-box mp-blue">
            <h2>Today's good article</h2>
            <div class="mp-tfa">${gaPic ? thumbImg(gaPic) : ''}<p><span id="gaText"></span> <b>(<a href="${href(gaToday.slug)}">Full article…</a>)</b></p></div>
            <p class="recent">Recently: ${gaRecent.map(a => `<a href="${href(a.slug)}">${esc(a.title)}</a>`).join(' – ')}</p>
            <div class="mp-more"><a href="/#Class.GA">All ${ga.length} good articles</a></div>
          </section>` : ''}
          <section class="mp-box mp-blue">
            <h2>Recent changes</h2>
            <div id="rcBox"></div>
          </section>
        </div>
      </div>
      <section class="mp-box mp-purple">
        <h2>Irad Wiki portals</h2>
        <div class="mp-subjects">${wiki.subjectOrder.map(s => {
          const cats = [...wiki.subjects.get(s)].sort((a, b) => b[1].length - a[1].length);
          return `<div><h3><a href="/#Subject.${categorySlug(s)}">${esc(s)}</a></h3><p>${cats.slice(0, 4).map(([c]) => `<a href="/#Category.${categorySlug(c)}">${esc(c)}</a>`).join(' · ')}${cats.length > 4 ? ` · <a href="/#Subject.${categorySlug(s)}">more…</a>` : ''}</p></div>`;
        }).join('')}</div>
      </section>
      <div class="mp-other">
        <h2>Other areas of Irad Wiki</h2>
        <ul>
          <li><b><a href="/#Special.All">All pages</a></b> – every article in the encyclopedia, A to Z.</li>
          <li><b><a href="/#Special.Random">Random article</a></b> – open an article picked at random.</li>
          <li><b><a href="/#Class.Stub">Stubs</a></b> – short articles waiting to be expanded.</li>
          <li><b><a href="/#Special.Media">Media</a></b> – every photograph, map, chart and logo used on the wiki, ${mediaFiles().list.length} files.</li>
          <li><b><a href="/#Irad">Irad</a></b> – the country article, with the national infobox.</li>
        </ul>
      </div>`;
    fillBlurb($('#tfaText'), fa);
    fillBlurb($('#gaText'), gaToday, 420);
    fillDyk(reshuffle); fillNews(); fillToday(); fillOtd(); fillChanges(); askFeeds();
    $('#moreDyk').addEventListener('click', e => { e.preventDefault(); fillDyk(true); });
    return '';
  }

  /* ---------- footer ---------- */
  // Last edit times (data/edited.json, written by the build). Optional: without it the line is left out.
  let editedTimes = null;
  fetch(BASE + 'data/edited.json').then(r => (r.ok ? r.json() : {})).catch(() => ({}))
    .then(e => { editedTimes = e; if (footArticle) renderFooter(footArticle); });
  let footArticle = null;
  function lastEdited(a) {
    const t = editedTimes && editedTimes[a.slug];
    if (!t) return '';
    const d = new Date(t * 1000), pad = n => String(n).padStart(2, '0');
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `<p>This page was last edited on ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, at ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} (UTC).</p>`;
  }
  function renderFooter(a) {
    footArticle = a || null;
    foot.innerHTML = `
      ${a ? lastEdited(a) : ''}
      <ul><li><a href="/">Main page</a></li><li><a href="/#Special.All">All pages</a></li><li><a href="/#Special.Random">Random article</a></li><li><a href="/#Class.FA">Featured articles</a></li><li><a href="/#Special.Media">Media</a></li></ul>`;
  }

  load();
})();
