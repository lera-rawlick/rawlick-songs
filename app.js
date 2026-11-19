/*
 * «Репертуар Lera Rawlick» — экраны, навигация и хранилище в телефоне.
 *
 * Где что лежит:
 *   songs.js — публичный каталог (CATALOG), core.js — чистая логика (Core).
 *   IndexedDB «rawlick-songs», хранилище kv:
 *     'user'   — правки Леры по песням: { id: {st, k, my, c, yo, yk, ml, lyrics, tr, orig, notes, t, a} }
 *     'added'  — песни, добавленные в приложении: [{ id, t, a, ... }]
 *     'parsed' — тексты из заметки «Новая.txt»: { id: {notes, lyrics, tr, orig} }
 *     'minus'  — какие минусовки привязаны к песне: { id: [{name, shift}] }
 *     'mp3:<имя файла>' — сам файл: { buf: ArrayBuffer, type }
 *   Правки Леры важнее разобранной заметки: повторная загрузка заметки их не затирает.
 */
(function () {
  'use strict';
  const { keyShift, shiftText, prettyKey, norm, decode, parseNotes, stanzas, matchMinus, minusShift, deriveKey, decrypt, exportKey, importKey, b64dec } = Core;

  // ---------- Хранилище ----------
  const DB = (() => {
    let opening;
    const open = () =>
      opening ||
      (opening = new Promise((res, rej) => {
        const r = indexedDB.open('rawlick-songs', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
          const db = r.result;
          // Другая вкладка или сброс данных хотят удалить/обновить базу — отпускаем её, иначе они повиснут.
          db.onversionchange = () => { db.close(); opening = null; };
          res(db);
        };
        r.onerror = () => rej(r.error);
      }));
    const run = (mode, fn) =>
      open().then(
        (db) =>
          new Promise((res, rej) => {
            const t = db.transaction('kv', mode);
            const req = fn(t.objectStore('kv'));
            t.oncomplete = () => res(req.result);
            t.onerror = t.onabort = () => rej(t.error);
          })
      );
    return {
      get: (k) => run('readonly', (s) => s.get(k)),
      set: (k, v) => run('readwrite', (s) => s.put(v, k)),
      del: (k) => run('readwrite', (s) => s.delete(k)),
    };
  })();

  // mt — машинные переводы { id: {text, src: 'lyrics'|'orig'} }; key — ключ к зашифрованным данным сайта.
  let user = {}, added = [], parsed = {}, minus = {}, mt = {};
  let key = null;
  const save = (k, val) => DB.set(k, val).catch((e) => toast('Не удалось сохранить: ' + e.message));

  // ---------- Песни ----------
  const TEXT = ['notes', 'lyrics', 'tr', 'orig'];
  const isCatalog = (id) => CATALOG.some((s) => s.id === id);

  /** Песня = каталог (или добавленная) + разобранная заметка + правки Леры. */
  function merge(b) {
    const u = user[b.id] || {}, p = parsed[b.id] || {};
    const s = Object.assign({}, b, u);
    for (const f of TEXT) s[f] = u[f] != null ? u[f] : b[f] != null ? b[f] : p[f] || '';
    // Свой перевод (из заметки или формы) важнее машинного.
    if (!s.tr && mt[b.id]) { s.tr = mt[b.id].text; s.mt = mt[b.id].src; }
    s.my = s.my || [];
    s.files = minus[b.id] || [];
    return s;
  }
  const all = () => CATALOG.concat(added).map(merge);
  const byId = (id) => {
    const b = CATALOG.find((s) => s.id === id) || added.find((s) => s.id === id);
    return b ? merge(b) : null;
  };
  /** Концерт: три блока, внутри — по номеру места. */
  function blocks() {
    const L = all().filter((s) => s.c).sort((a, b) => a.c[0] - b.c[0] || a.c[1] - b.c[1] || a.t.localeCompare(b.t));
    return [1, 2, 3].map((n) => L.filter((s) => s.c[0] === n));
  }
  const flat = () => blocks().flat();
  const setUser = (id, patch) => {
    user[id] = Object.assign({}, user[id], patch);
    return save('user', user);
  };

  // ---------- Вспомогательное ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const google = (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q);
  const yt = (q) => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  // Ссылки из формы и резервной копии пускаем в href только как http(s), чтобы javascript: не стал кнопкой.
  const web = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const MARK_RE = /^\s*\[?\s*(?:♥|❤|\u{1F608})\uFE0F?\s*\]?\s*/u;
  const isLatin = (t) => (t.match(/[a-z]/gi) || []).length > (t.match(/[а-яё]/gi) || []).length;
  const fmtTime = (x) => (isFinite(x) ? Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0') : '0:00');
  const KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

  const I = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    play: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>',
    yt: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M10 9.5v5l4-2.5z"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>',
  };

  let tt;
  function toast(t) {
    const e = document.getElementById('toast');
    e.textContent = t;
    e.classList.add('on');
    clearTimeout(tt);
    tt = setTimeout(() => e.classList.remove('on'), 2600);
  }

  // ---------- Минусовки: плеер и «Поделиться» ----------
  // iOS разрешает play() и share() только прямо в обработчике нажатия, поэтому файлы песни
  // заранее достаём из базы в память, когда открыт плеер.
  const audio = new Audio();
  const cache = {}; // имя файла → { url, file }
  let playing = null; // имя играющего файла

  const loading = new Set(); // минусы, которые сейчас скачиваются
  const remote = (name) => Object.values(minus).flat().find((x) => x.name === name && x.src);

  /** Минус из телефона, а если его там ещё нет — скачивает с сайта, расшифровывает и кладёт в телефон. */
  async function getMinus(name) {
    const rec = await DB.get('mp3:' + name).catch(() => null);
    if (rec) return rec;
    const f = remote(name);
    if (!f || !key) return null;
    const r = await fetch(f.src);
    if (!r.ok) throw new Error('сайт ответил ' + r.status);
    const fresh = { buf: (await decrypt(key, await r.arrayBuffer())).buffer, type: f.type || 'audio/mpeg' };
    await DB.set('mp3:' + name, fresh);
    return fresh;
  }

  async function warm(names) {
    for (const name of names) {
      if (cache[name] || loading.has(name)) continue;
      loading.add(name);
      paintPlayer();
      try {
        const rec = await getMinus(name);
        if (rec) {
          const file = new File([rec.buf], name, { type: rec.type || 'audio/mpeg' });
          cache[name] = { file, url: URL.createObjectURL(file) };
        }
      } catch (e) {
        toast('Минус не скачался: ' + (navigator.onLine ? e.message : 'нет интернета'));
      } finally {
        loading.delete(name);
      }
    }
  }

  // ---------- Зашифрованные тексты и минусовки с сайта ----------
  /** Подтягивает тексты и список минусовок, если на сайте новая версия (или force). */
  async function syncPack(force) {
    if (!key) return false;
    const meta = await (await fetch('data/meta.json', { cache: 'no-store' })).json();
    if (!force && meta.v === (await DB.get('packV'))) return false;
    const r = await fetch('data/texts.bin?v=' + meta.v);
    if (!r.ok) throw new Error('сайт ответил ' + r.status);
    const pack = JSON.parse(new TextDecoder().decode(await decrypt(key, await r.arrayBuffer())));
    parsed = pack.parsed || {};
    // Минусовки с сайта плюс те, что Лера загрузила в телефон сама.
    const next = {};
    for (const [id, list] of Object.entries(pack.minus || {})) next[id] = list.slice();
    for (const [id, list] of Object.entries(minus)) {
      for (const f of list) if (!f.src && !(next[id] || []).some((x) => x.name === f.name)) (next[id] = next[id] || []).push(f);
    }
    minus = next;
    await Promise.all([save('parsed', parsed), save('minus', minus), DB.set('packV', meta.v)]);
    return true;
  }

  async function unlock(pass) {
    const out = document.getElementById('pw-res');
    out.textContent = 'Проверяю…';
    try {
      const meta = await (await fetch('data/meta.json', { cache: 'no-store' })).json();
      const k = await deriveKey(pass, meta.salt, meta.iter);
      try { await decrypt(k, b64dec(meta.check)); }
      catch { out.innerHTML = '<span class="err">Неверный пароль. Проверь буквы и дефисы.</span>'; return; }
      key = k;
      await DB.set('key', await exportKey(k));
      await syncPack(true);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
      toast('Тексты и минусовки открыты');
      go('home');
    } catch (e) {
      out.innerHTML = `<span class="err">Не получилось: ${esc(navigator.onLine ? e.message : 'нет интернета')}.</span>`;
    }
  }

  /** Скачивает все минусовки в телефон заранее, чтобы на концерте всё работало без интернета. */
  async function downloadAll() {
    const names = Object.values(minus).flat().filter((f) => f.src).map((f) => f.name);
    const out = document.getElementById('dl-res');
    let ok = 0;
    for (const [i, name] of names.entries()) {
      out.textContent = `Скачиваю ${i + 1} из ${names.length}…`;
      try { if (await getMinus(name)) ok++; } catch (e) { /* сообщим общим итогом ниже */ }
    }
    out.innerHTML = ok === names.length ? '<span class="ok">Все минусовки в телефоне — работают без интернета.</span>' : `<span class="err">Скачано ${ok} из ${names.length}. Проверь интернет и нажми ещё раз.</span>`;
  }

  // ---------- Машинный перевод ----------
  /** Переводит строки на русский: Google без ключа, запасной вариант — MyMemory по строке. */
  async function mtLines(lines) {
    try {
      const r = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=' + encodeURIComponent(lines.join('\n')));
      if (!r.ok) throw new Error('переводчик ответил ' + r.status);
      const j = await r.json();
      return j[0].map((x) => x[0]).join('').replace(/\n$/, '').split('\n');
    } catch (e) {
      const out = [];
      for (const l of lines) {
        const r = await fetch('https://api.mymemory.translated.net/get?langpair=en|ru&q=' + encodeURIComponent(l));
        const j = await r.json();
        if (!j.responseData) throw e;
        out.push(j.responseData.translatedText);
      }
      return out;
    }
  }

  let translating = false;
  /** Перевод по строфам; если пою по транскрипции — переводится «Оригинал» и показывается отдельным блоком. */
  async function translateSong(id) {
    if (translating) return;
    const s = byId(id);
    const fromOrig = !isLatin(s.lyrics) && !!s.orig;
    const src = fromOrig ? s.orig : s.lyrics;
    if (!src) { toast('Сначала нужен текст'); return; }
    translating = true;
    const btn = document.querySelector('[data-act="translate"]');
    try {
      const L = stanzas(src);
      const parts = [];
      for (const [i, b] of L.entries()) {
        if (btn) btn.textContent = `Перевожу ${i + 1} из ${L.length}…`;
        const lines = b.lines.map((l) => l.replace(MARK_RE, '').replace(/\([^)]*[а-яё][^)]*\)/gi, '').trim() || '·');
        let tr = await mtLines(lines);
        if (tr.length !== lines.length) tr = [tr.join(' ')]; // строки не совпали — покажем блоком после строфы
        parts.push(tr.map((x) => x.trim() || '·').join('\n'));
      }
      mt[id] = { text: parts.join('\n\n'), src: fromOrig ? 'orig' : 'lyrics' };
      await save('mt', mt);
      st.tr = true;
    } catch (e) {
      toast('Перевод не получился: ' + (navigator.onLine ? e.message : 'нет интернета'));
    }
    translating = false;
    render();
  }

  function togglePlay(name) {
    if (playing === name && !audio.paused) { audio.pause(); return paintPlayer(); }
    const c = cache[name];
    if (!c) { toast('Файл ещё загружается, нажми ещё раз'); warm([name]).then(paintPlayer); return; }
    if (playing !== name) { audio.src = c.url; playing = name; }
    audio.play().catch(() => toast('Не получилось включить звук'));
    paintPlayer();
  }
  function stopPlay() { audio.pause(); playing = null; }

  async function shareFile(name) {
    const c = cache[name];
    if (!c) { toast('Файл ещё загружается, нажми ещё раз'); warm([name]); return; }
    if (navigator.canShare && navigator.canShare({ files: [c.file] })) {
      try { await navigator.share({ files: [c.file], title: name }); }
      catch (e) { if (e.name !== 'AbortError') toast('Не получилось переслать'); }
    } else {
      const a = document.createElement('a');
      a.href = c.url;
      a.download = name;
      a.click();
    }
  }
  async function shareLink(url, title) {
    if (navigator.share) {
      try { await navigator.share({ url, title }); } catch (e) { if (e.name !== 'AbortError') toast('Не получилось переслать'); }
    } else {
      try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } catch { toast(url); }
    }
  }

  /** Обновляет кнопки и полоску плеера без перерисовки всего экрана. */
  function paintPlayer() {
    document.querySelectorAll('[data-act="play"]').forEach((b) => {
      const on = b.dataset.name === playing && !audio.paused;
      b.innerHTML = on ? I.pause : I.play;
      b.setAttribute('aria-label', on ? 'Пауза' : 'Играть');
    });
    document.querySelectorAll('.bar').forEach((bar) => {
      const mine = bar.dataset.name === playing;
      bar.firstElementChild.style.width = mine && audio.duration ? (audio.currentTime / audio.duration) * 100 + '%' : '0';
      const t = bar.nextElementSibling;
      const name = bar.dataset.name;
      if (t) t.textContent = mine ? fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration) : loading.has(name) && !cache[name] ? 'Скачиваю…' : '';
    });
  }
  audio.addEventListener('timeupdate', paintPlayer);
  audio.addEventListener('ended', paintPlayer);
  audio.addEventListener('pause', paintPlayer);

  // ---------- Навигация (через #адрес, чтобы работала кнопка «назад» и перезагрузка) ----------
  const st = { scr: 'home', tab: 'all', q: '', cur: null, from: 'songs', tr: false, orig: false, open: {}, player: false, edit: null, pick: 'know', confirmDel: false };

  function go(hash) {
    if (location.hash === '#' + hash) route();
    else location.hash = hash;
  }
  function route() {
    const [scr, a, b] = decodeURIComponent(location.hash.slice(1)).split(':');
    const prev = st.cur;
    st.scr = ['home', 'songs', 'concert', 'add', 'song', 'load'].includes(scr) ? scr : 'home';
    if (st.scr === 'songs' && a) st.tab = a;
    if (st.scr === 'song') {
      st.cur = a;
      st.from = b || 'songs';
      if (prev !== a) Object.assign(st, { open: {}, player: false, confirmDel: false });
      if (!byId(a)) st.scr = 'songs';
    }
    if (st.scr === 'add') { st.edit = a || null; st.confirmDel = false; }
    if (st.scr !== 'song' || prev !== st.cur) stopPlay();
    render();
    document.getElementById('view').scrollTop = 0;
  }
  window.addEventListener('hashchange', route);

  // ---------- Экраны ----------
  const cnt = (k) => (k === 'all' ? all().length : all().filter((s) => s.st === k).length);

  const SCR = {
    home() {
      const B = blocks();
      const files = Object.values(minus).reduce((n, l) => n + l.length, 0);
      const texts = Object.keys(parsed).length;
      return `
        <h1>Репертуар Lera Rawlick</h1>
        <p class="sub">Тексты, тональности и минусовки под рукой на сцене.</p>
        <button class="btn" style="margin-top:20px" data-act="go" data-to="add">${I.plus} Добавить песню</button>
        <div class="tiles">
          <div class="tile"><div class="tt">Песни</div>
            <div>${[['all', 'Все'], ['know', 'Знаю'], ['new', 'Новые']].map(([k, l]) => `<button class="tl" data-act="go" data-to="songs:${k}"><span>${l}</span><span>${cnt(k)}</span></button>`).join('')}</div></div>
          <div class="tile"><div class="tt">Концерт</div>
            <div>${B.map((b, i) => `<button class="tl" data-act="go" data-to="concert"><span>Блок ${i + 1}</span><span>${b.length}</span></button>`).join('')}</div></div>
        </div>
        <button class="card-link" data-act="go" data-to="load">
          <span>Тексты и минусовки<small>${texts || files ? `Текстов: ${texts} · минусовок: ${files}` : 'Открой по паролю — один раз'}</small></span>${I.next}
        </button>`;
    },

    songs() {
      return `
        <h1>Песни</h1>
        <div class="seg" style="margin-top:14px" role="tablist">${[['all', 'Все'], ['know', 'Знаю'], ['new', 'Новые']]
          .map(([k, l]) => `<button role="tab" aria-selected="${st.tab === k}" class="${st.tab === k ? 'on ' + k : ''}" data-act="go" data-to="songs:${k}">${l} ${cnt(k)}</button>`).join('')}</div>
        <input id="q" class="search" type="search" placeholder="Название или исполнитель" value="${esc(st.q)}" aria-label="Поиск" autocomplete="off">
        <div id="list"></div>`;
    },

    concert() {
      let n = 0;
      return `
        <h1>Концерт</h1><p class="sub">3 блока по 6 песен. Внутри песни — кнопка «Следующая».</p>
        ${blocks().map((b, i) => `<div class="box" style="margin-top:14px"><div class="lbl" style="margin-bottom:4px">Блок ${i + 1}</div>
          ${b.map((s) => `<div class="crow" data-act="open" data-id="${s.id}" data-from="concert"><span class="num">${++n}</span><span style="flex:1;min-width:0">${esc(s.t)}</span>${s.my[0] ? `<span class="chip">${prettyKey(s.my[0][0])}</span>` : ''}</div>`).join('') || '<p class="a">Пусто — выбери блок в «Изменить» у песни.</p>'}</div>`).join('')}`;
    },

    song() {
      const s = byId(st.cur);
      const F = flat(), p = F.findIndex((x) => x.id === s.id);
      const d = s.k && s.my[0] ? keyShift(s.k, s.my[0][0]) : null;
      const q = s.t + ' ' + s.a;
      const hasMinus = s.files.length || s.ml;
      if (st.player) warm(s.files.map((f) => f.name)).then(paintPlayer);
      return `
        <button class="back" data-act="back">${I.back}${st.from === 'concert' ? 'Концерт' : 'Песни'}</button>
        <div class="title">${esc(s.t)}</div>
        <div class="a">${esc(s.a || 'Исполнитель не указан')}${p > -1 ? ` · концерт, №${p + 1}` : ''}</div>
        ${s.about ? `<p class="about">${esc(s.about)}</p>` : ''}
        ${s.notes ? `<details class="notes"><summary>Мои заметки</summary><div>${esc(s.notes)}</div></details>` : ''}
        <div class="seg" style="margin-top:14px"><button class="${s.st === 'know' ? 'on know' : ''}" data-act="status" data-st="know">Знаю</button><button class="${s.st === 'new' ? 'on new' : ''}" data-act="status" data-st="new">Новая</button></div>
        <div class="box keys">
          <div><div class="lbl">Оригинал</div><div class="kv">${s.k ? (s.kq ? '≈ ' : '') + prettyKey(s.k) : '—'}</div></div>
          <div><div class="lbl">Моя</div>${s.my.length ? s.my.map(([k, w], i) => `<div class="kv ${i ? 'small' : 'acc'}">${prettyKey(k)}${w ? `<span class="who">${esc(w)}</span>` : ''}</div>`).join('') : '<div class="kv">—</div>'}</div>
        </div>
        ${d != null ? `<div class="hint">Моя тональность от оригинала: <b>${shiftText(d)}</b></div>` : ''}
        <div class="links">
          <button class="lk mine" data-act="player">${I.note}Мой минус</button>
          <a class="lk" href="${esc(web(s.yo) || yt(q))}" target="_blank" rel="noopener">${I.yt}Оригинал</a>
          <a class="lk" href="${esc(web(s.yk) || yt(q + ' karaoke'))}" target="_blank" rel="noopener">${I.yt}Караоке</a>
        </div>
        ${st.player ? `<div class="box" style="margin-top:8px">${hasMinus ? playerHTML(s) : `<p class="a" style="margin:0">Минуса пока нет. Загрузи mp3 в «Тексты и минусовки» или добавь ссылку в «Изменить».</p>`}</div>` : ''}
        <div class="lyh"><span class="lbl" style="font-size:12px">Текст</span>
          <div class="sws">
            ${s.tr ? `<button class="sw ${st.tr ? 'on' : ''}" data-act="sw" data-k="tr" aria-pressed="${st.tr}"><i></i>Перевод</button>` : s.lyrics || s.orig ? `<button class="sbtn" data-act="translate">Перевести</button>` : ''}
            ${s.orig ? `<button class="sw ${st.orig ? 'on' : ''}" data-act="sw" data-k="orig" aria-pressed="${st.orig}"><i></i>Оригинал</button>` : ''}
          </div></div>
        ${s.mt && st.tr ? `<p class="cue" style="margin:-4px 0 12px">Машинный перевод. Свой можно вставить в «Изменить песню».</p>` : ''}
        ${lyricsHTML(s)}
        ${st.from === 'concert' && p > -1 ? `<div class="pn">
          <button data-act="open" data-id="${p > 0 ? F[p - 1].id : ''}" data-from="concert" ${p > 0 ? '' : 'style="visibility:hidden"'}><small>← Предыдущая</small><span>${p > 0 ? esc(F[p - 1].t) : ''}</span></button>
          <button data-act="open" data-id="${p < F.length - 1 ? F[p + 1].id : ''}" data-from="concert" style="text-align:right;${p < F.length - 1 ? '' : 'visibility:hidden'}"><small>Следующая →</small><span>${p < F.length - 1 ? esc(F[p + 1].t) : ''}</span></button></div>` : ''}
        <div class="row2" style="margin-top:20px"><button class="sbtn" data-act="go" data-to="add:${s.id}">Изменить песню</button></div>`;
    },

    add() {
      const s = st.edit ? byId(st.edit) : null;
      const v = (f) => esc(s ? s[f] || '' : '');
      const opts = (cur) => '<option value="">Не знаю</option>' + KEYS.flatMap((k) => [k, k + 'm']).map((k) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${prettyKey(k)}</option>`).join('');
      const stv = s ? s.st || '' : st.pick;
      const slot = s && s.c ? s.c.join('-') : '';
      return `
        ${s ? `<button class="back" data-act="back">${I.back}Назад</button>` : ''}
        <h1 style="${s ? 'margin-top:14px' : ''}">${s ? 'Изменить песню' : 'Новая песня'}</h1>
        <form id="songf" novalidate>
          <div class="f"><label for="f-t">Название</label><input id="f-t" value="${v('t')}" placeholder="Fly Me to the Moon"><span class="err" id="f-err" hidden>Впиши название песни</span></div>
          <div class="f"><label for="f-a">Исполнитель</label><input id="f-a" value="${v('a')}" placeholder="Frank Sinatra"></div>
          <div class="two"><div class="f"><label for="f-k">Оригинал</label><select id="f-k">${opts(s && s.k)}</select></div>
            <div class="f"><label for="f-my">Моя</label><select id="f-my">${opts(s && s.my[0] && s.my[0][0])}</select></div></div>
          <div class="f"><label for="f-m">Мой минус — файл или ссылка</label><input id="f-m" type="file" accept="audio/*,.mp3,.m4a">
            <input id="f-ml" type="url" value="${v('ml')}" placeholder="или ссылка: https://x-minus.pro/…" aria-label="Ссылка на минус"></div>
          <div class="f"><label for="f-yo">Оригинал, ссылка</label><input id="f-yo" type="url" value="${v('yo')}" placeholder="https://youtu.be/…"></div>
          <div class="f"><label for="f-yk">Караоке, ссылка</label><input id="f-yk" type="url" value="${v('yk')}" placeholder="https://youtu.be/…"></div>
          <div class="f"><label for="f-lyr">Текст (♥\uFE0F — куплет, 😈 — припев)</label><textarea id="f-lyr" placeholder="Вставь текст песни">${v('lyrics')}</textarea></div>
          <div class="f"><label for="f-tr">Перевод, по строчкам как в тексте</label><textarea id="f-tr" placeholder="Вставь перевод">${v('tr')}</textarea></div>
          ${s ? `<div class="f"><label for="f-or">Оригинал текста (если поёшь по транскрипции)</label><textarea id="f-or">${v('orig')}</textarea></div>
          <div class="f"><label for="f-n">Мои заметки</label><textarea id="f-n">${v('notes')}</textarea></div>
          <div class="f"><label for="f-c">Концерт</label><select id="f-c"><option value="">Не в концерте</option>${[1, 2, 3].flatMap((b) => [1, 2, 3, 4, 5, 6].map((n) => `<option value="${b}-${n}" ${slot === b + '-' + n ? 'selected' : ''}>Блок ${b}, №${(b - 1) * 6 + n}</option>`)).join('')}</select></div>` : ''}
          <div class="f"><span class="flbl">Куда положить</span><div class="seg"><button type="button" class="${stv === 'know' ? 'on know' : ''}" data-act="pick" data-st="know">Знаю</button><button type="button" class="${stv === 'new' ? 'on new' : ''}" data-act="pick" data-st="new">Новые</button></div></div>
          <button class="btn" style="margin-top:20px" type="submit">Сохранить</button>
        </form>
        ${s && !isCatalog(s.id) ? `<div class="row2" style="margin-top:14px"><button class="sbtn danger" data-act="del">${st.confirmDel ? 'Точно удалить? Нажми ещё раз' : 'Удалить песню'}</button></div>` : ''}`;
    },

    load() {
      const texts = Object.keys(parsed).length;
      const files = Object.values(minus).reduce((n, l) => n + l.length, 0);
      return `
        <button class="back" data-act="go" data-to="home">${I.back}Главная</button>
        <h1 style="margin-top:14px">Тексты и минусовки</h1>
        <p class="sub">На сайте они зашифрованы. Открываются паролем один раз, дальше хранятся в телефоне.</p>
        <h2>Пароль</h2>
        ${key
          ? `<p class="a"><span class="ok">Открыто: текстов ${texts}, минусовок ${files}.</span> Новые версии с сайта подтягиваются сами.</p>
             <p class="a">Каждый минус скачивается, когда первый раз нажимаешь «Мой минус». Перед концертом лучше скачать все сразу (около 200 МБ, по Wi-Fi).</p>
             <div class="row2"><button class="sbtn" data-act="dl-all">Скачать все минусовки</button></div><p class="a" id="dl-res"></p>`
          : `<form id="unlockf"><div class="f"><label for="pw">Пароль</label><input id="pw" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" placeholder="xxxx-xxxx-xxxx"></div>
             <button class="btn" style="margin-top:12px" type="submit">Открыть тексты и минусовки</button></form><p class="a" id="pw-res"></p>`}
        <details class="notes" style="margin-top:22px"><summary>Загрузить свои файлы вручную</summary>
        <p class="a">Если поменяла заметку или появились новые mp3: «Файлы» → iCloud Drive → «Песни».</p>
        <h2>1. Тексты из заметки</h2>
        <p class="a" id="txt-st">${texts ? `<span class="ok">Загружено песен с текстом: ${texts}.</span> Загрузишь снова — тексты обновятся, твои правки в приложении останутся.` : 'Ещё не загружены.'}</p>
        <div class="f"><label for="in-txt">Файл заметки (.txt)</label><input id="in-txt" type="file" accept=".txt,text/plain"></div>
        <p class="a" id="txt-res"></p>
        <h2>2. Минусовки</h2>
        <p class="a" id="mp3-st">${files ? `<span class="ok">Загружено минусовок: ${files}.</span>` : 'Ещё не загружены.'} Можно выбрать все файлы сразу — приложение само разложит их по песням.</p>
        <div class="f"><label for="in-mp3">Файлы mp3</label><input id="in-mp3" type="file" accept="audio/*,.mp3,.m4a" multiple></div>
        <p class="a" id="mp3-res"></p>
        </details>
        <h2>Резервная копия</h2>
        <p class="a">Отметки, тональности, правки и тексты в одном файле (без mp3). Сохрани её в «Файлы» после больших правок.</p>
        <div class="row2"><button class="sbtn" data-act="export">Сохранить копию</button><label class="sbtn" for="in-json">Восстановить из копии</label></div>
        <input id="in-json" type="file" accept=".json,application/json" hidden>`;
    },
  };

  function playerHTML(s) {
    const rows = s.files.map((f) => `
      <div class="mrow">
        <button class="play" data-act="play" data-name="${esc(f.name)}" aria-label="Играть">${playing === f.name && !audio.paused ? I.pause : I.play}</button>
        <div class="mname"><span>${esc(f.name.replace(/\.(mp3|m4a)$/i, ''))}</span>
          <div class="bar" data-act="seek" data-name="${esc(f.name)}"><i></i></div><div class="time"></div></div>
        <button class="ghost" data-act="share" data-name="${esc(f.name)}" aria-label="Переслать">${I.share}</button>
      </div>`);
    if (s.ml) rows.push(`
      <div class="mrow">
        <a class="ghost" href="${esc(web(s.ml) || '#')}" target="_blank" rel="noopener" aria-label="Открыть ссылку">${I.link}</a>
        <div class="mname"><span>Ссылка на минус</span><span class="a">${esc(s.ml)}</span></div>
        <button class="ghost" data-act="share-link" data-url="${esc(s.ml)}" aria-label="Переслать ссылку">${I.share}</button>
      </div>`);
    return rows.join('');
  }

  /** Строка текста: подсказки произношения в скобках — мелко, служебные пометки — серым курсивом. */
  function lineHTML(l, latin) {
    const s = l.replace(MARK_RE, '').trim();
    if (!s || /^\[?\s*(chorus|verse|bridge|припев|куплет)\s*:?\s*\]?$/i.test(s)) return '';
    const cue =
      /^\d+:\d+$/.test(s) ||
      /^\(?\s*\d+\s*раз/i.test(s) ||
      (/^\(.*\)$/.test(s) && /[а-яё]/i.test(s)) ||
      (latin && /[а-яё]/i.test(s) && !/[a-z]/i.test(s));
    if (cue) return `<p class="cue">${esc(s)}</p>`;
    return `<p class="ln">${esc(s).replace(/\(([^)]*[а-яё][^)]*)\)/gi, '<span class="pr">$1</span>')}</p>`;
  }
  const clean = (l) => esc(l.replace(MARK_RE, '').trim());

  /** Текст по строфам; перевод и оригинал — слоями под строчками (если строк столько же) или блоком после строфы. */
  function lyricsHTML(s) {
    const L = stanzas(s.lyrics);
    const q = s.t + ' ' + s.a;
    if (!L.length) {
      return `<p class="empty" style="margin-top:0">Текста пока нет. Загрузи заметку или вставь текст сама.</p>
        <div class="row2"><a class="sbtn" href="${google(q + ' lyrics')}" target="_blank" rel="noopener">Найти текст</a><button class="sbtn" data-act="go" data-to="add:${s.id}">Вставить текст</button></div>`;
    }
    const latin = isLatin(s.lyrics);
    // Машинный перевод «Оригинала» (песня записана транскрипцией) по строфам не совпадёт — показываем его целиком в конце.
    const trWhole = s.mt === 'orig';
    const TR = s.tr && !trWhole ? stanzas(s.tr) : [], OR = s.orig ? stanzas(s.orig) : [];
    const body = L.map((b, bi) => {
      const layers = [];
      if (TR[bi] && (st.tr || st.open[bi])) layers.push(['tr', TR[bi]]);
      if (OR[bi] && st.orig) layers.push(['or', OR[bi]]);
      const lines = b.lines.map((l, li) => {
        let h = lineHTML(l, latin);
        // под служебными пометками (тайминги, техника) перевод не нужен
        if (h && !h.startsWith('<p class="cue"')) for (const [cls, t] of layers) if (t.lines.length === b.lines.length) h += `<span class="${cls}">${clean(t.lines[li])}</span>`;
        return h;
      }).join('');
      const after = layers.filter(([, t]) => t.lines.length !== b.lines.length).map(([cls, t]) => `<div class="${cls} blk">${t.lines.map(clean).join('<br>')}</div>`).join('');
      return `<div class="stanza ${b.chorus ? 'chorus' : ''}" data-act="stanza" data-i="${bi}">${b.chorus ? '<div class="lbl">Припев</div>' : ''}${lines}${after}</div>`;
    }).join('');
    const whole = trWhole && st.tr ? `<div class="box"><div class="lbl" style="margin-bottom:6px">Перевод</div>${stanzas(s.tr).map((b) => `<p class="tr">${b.lines.map(clean).join('<br>')}</p>`).join('')}</div>` : '';
    return body + whole;
  }

  function list() {
    const q = norm(st.q);
    const L = all()
      .filter((s) => (st.tab === 'all' || s.st === st.tab) && norm(s.t + ' ' + s.a).includes(q))
      .sort((a, b) => a.t.localeCompare(b.t, 'en'));
    let h = '', cur = '';
    if (!L.length) h = `<p class="empty">${q ? 'Ничего не нашлось. Проверь написание.' : 'Пока пусто. Открой песню и отметь «Знаю» или «Новая».'}</p>`;
    for (const s of L) {
      const l = s.t.normalize('NFD')[0].toUpperCase();
      if (l !== cur) { cur = l; h += `<div class="letter">${esc(l)}</div>`; }
      h += `<div class="row" data-act="open" data-id="${s.id}" data-from="songs"><span class="dot ${s.st || ''}"></span>
        <div style="flex:1;min-width:0"><div class="t">${esc(s.t)}</div><div class="a">${esc(s.a || 'Исполнитель не указан')}${s.files.length || s.ml ? ' · есть минус' : ''}</div></div>
        ${s.my[0] ? `<span class="chip">${prettyKey(s.my[0][0])}</span>` : ''}</div>`;
    }
    document.getElementById('list').innerHTML = h;
  }

  function render() {
    document.getElementById('view').innerHTML = SCR[st.scr]();
    if (st.scr === 'songs') list();
    if (st.scr === 'song') paintPlayer();
    const act = st.scr === 'song' ? st.from : st.scr === 'load' ? 'home' : st.scr;
    document.getElementById('tabbar').innerHTML = [['home', 'Главная', I.home], ['songs', 'Песни', I.list], ['concert', 'Концерт', I.mic], ['add', 'Добавить', I.plus]]
      .map(([k, l, ic]) => `<button class="tb ${act === k && !(k === 'add' && st.edit) ? 'on' : ''}" data-act="go" data-to="${k}" ${act === k ? 'aria-current="page"' : ''}>${ic}${l}</button>`).join('');
  }

  // ---------- Действия ----------
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const d = el.dataset;
    switch (d.act) {
      case 'go': go(d.to); break;
      case 'back': history.length > 1 ? history.back() : go(st.from); break;
      case 'open': if (d.id) go(`song:${d.id}:${d.from}`); break;
      case 'status': {
        const s = byId(st.cur), v = s.st === d.st ? null : d.st;
        setUser(s.id, { st: v });
        render();
        toast(v === 'know' ? 'В списке «Знаю»' : v === 'new' ? 'В списке «Новые»' : 'Убрано из списков');
        break;
      }
      case 'player': st.player = !st.player; if (!st.player) stopPlay(); render(); break;
      case 'play': togglePlay(d.name); break;
      case 'share': shareFile(d.name); break;
      case 'share-link': shareLink(d.url, byId(st.cur).t); break;
      case 'seek': if (d.name === playing && audio.duration) { const r = el.getBoundingClientRect(); audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration; } break;
      case 'sw': st[d.k] = !st[d.k]; st.open = {}; render(); break;
      case 'stanza': if (e.target.closest('a,button')) break; st.open[d.i] = !st.open[d.i]; render(); break;
      case 'pick': st.pick = d.st; el.parentElement.querySelectorAll('button').forEach((b) => (b.className = b === el ? 'on ' + d.st : '')); break;
      case 'del': deleteSong(); break;
      case 'export': exportBackup(); break;
      case 'translate': translateSong(st.cur); break;
      case 'dl-all': downloadAll(); break;
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') { st.q = e.target.value; list(); }
    if (e.target.id === 'f-t') document.getElementById('f-err').hidden = true;
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'in-txt') importNotes(e.target.files[0]);
    if (e.target.id === 'in-mp3') importMinus([...e.target.files]);
    if (e.target.id === 'in-json') importBackup(e.target.files[0]);
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'unlockf') { e.preventDefault(); unlock(document.getElementById('pw').value); return; }
    if (e.target.id !== 'songf') return;
    e.preventDefault();
    saveForm();
  });

  /** Сохраняет форму «Новая песня» / «Изменить песню». */
  async function saveForm() {
    const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : undefined; };
    const t = v('f-t');
    if (!t) { document.getElementById('f-err').hidden = false; document.getElementById('f-t').focus(); return; }
    const old = st.edit ? byId(st.edit) : null;
    const id = old ? old.id : 'u' + Date.now();
    const pickBtn = document.querySelector('[data-act="pick"].on');
    const myKey = v('f-my');
    // Форма меняет только первую «мою» тональность; подпись «с Артом» и другие варианты сохраняются.
    const rest = old ? old.my.slice(1) : [];
    const who = old && old.my[0] ? old.my[0][1] : '';
    const my = myKey ? [[myKey, who]].concat(rest) : rest;
    const patch = { t, a: v('f-a'), k: v('f-k') || null, kq: old && old.k === v('f-k') ? old.kq : false, my, ml: v('f-ml'), yo: v('f-yo'), yk: v('f-yk'), lyrics: v('f-lyr'), tr: v('f-tr'), st: pickBtn ? pickBtn.dataset.st : null };
    if (old) {
      patch.orig = v('f-or');
      patch.notes = v('f-n');
      // Неизменённые тексты не сохраняем как правку, иначе повторная загрузка заметки их уже не обновит.
      for (const f of TEXT) if (patch[f] === String(old[f] || '').trim()) delete patch[f];
      const c = v('f-c') ? v('f-c').split('-').map(Number) : null;
      // Место в концерте занято другой песней — меняем их местами.
      if (c) {
        const other = all().find((s) => s.id !== id && s.c && s.c[0] === c[0] && s.c[1] === c[1]);
        if (other) user[other.id] = Object.assign({}, user[other.id], { c: old.c || null });
      }
      patch.c = c;
    } else {
      added.push({ id, t });
      await save('added', added);
    }
    await setUser(id, patch);
    const file = document.getElementById('f-m').files[0];
    if (file) await storeMinus(id, file);
    toast('Песня сохранена');
    go(`song:${id}:${st.from === 'concert' && old && old.c ? 'concert' : 'songs'}`);
  }

  async function deleteSong() {
    if (!st.confirmDel) { st.confirmDel = true; render(); return; }
    const id = st.edit;
    added = added.filter((s) => s.id !== id);
    delete user[id];
    for (const f of minus[id] || []) await DB.del('mp3:' + f.name).catch(() => {});
    delete minus[id];
    await Promise.all([save('added', added), save('user', user), save('minus', minus)]);
    toast('Песня удалена');
    go('songs');
  }

  // ---------- Загрузка файлов ----------
  async function importNotes(file) {
    if (!file) return;
    const out = document.getElementById('txt-res');
    try {
      const text = decode(await file.arrayBuffer());
      const songs = CATALOG.concat(added.map((s) => Object.assign({ at: s.t }, s)));
      const res = parseNotes(text, songs);
      parsed = res.byId;
      await save('parsed', parsed);
      navigator.storage && navigator.storage.persist && navigator.storage.persist();
      const n = Object.keys(parsed).length;
      out.innerHTML = `<span class="ok">Готово: тексты нашлись у ${n} песен.</span>` + (res.missing.length ? ` Не нашлись: ${res.missing.map((id) => esc(byId(id).t)).join(', ')}.` : '');
      document.getElementById('txt-st').textContent = 'Загружено песен с текстом: ' + n + '.';
      toast('Тексты загружены');
    } catch (e) {
      out.innerHTML = `<span class="err">Не получилось прочитать файл: ${esc(e.message)}. Это точно «Новая.txt»?</span>`;
    }
  }

  async function storeMinus(id, file) {
    const buf = await file.arrayBuffer();
    await DB.set('mp3:' + file.name, { buf, type: file.type || 'audio/mpeg' });
    minus[id] = (minus[id] || []).filter((x) => x.name !== file.name).concat({ name: file.name, shift: minusShift(file.name) });
    delete cache[file.name];
    await save('minus', minus);
  }

  async function importMinus(files) {
    const out = document.getElementById('mp3-res');
    const songs = all();
    const lost = [];
    let ok = 0;
    for (const [i, f] of files.entries()) {
      out.textContent = `Загружаю ${i + 1} из ${files.length}…`;
      const id = matchMinus(f.name, songs);
      if (!id) { lost.push(f.name); continue; }
      try { await storeMinus(id, f); ok++; }
      catch (e) { lost.push(f.name + ' (' + e.message + ')'); }
    }
    navigator.storage && navigator.storage.persist && navigator.storage.persist();
    out.innerHTML = `<span class="ok">Готово: ${ok} из ${files.length}.</span>` + (lost.length ? ` Не нашла песню для: ${lost.map(esc).join(', ')}. Их можно добавить в «Изменить песню».` : '');
    document.getElementById('mp3-st').textContent = 'Загружено минусовок: ' + Object.values(minus).reduce((n, l) => n + l.length, 0) + '.';
    toast('Минусовки загружены');
  }

  async function exportBackup() {
    const data = { app: 'rawlick-songs', v: 1, date: new Date().toISOString(), user, added, parsed, minus };
    const name = 'репертуар-копия-' + new Date().toISOString().slice(0, 10) + '.json';
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name !== 'AbortError') toast('Не получилось сохранить'); }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = name;
      a.click();
    }
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (d.app !== 'rawlick-songs') throw new Error('это не копия репертуара');
      user = d.user || {}; added = d.added || []; parsed = d.parsed || {}; minus = d.minus || {};
      await Promise.all([save('user', user), save('added', added), save('parsed', parsed), save('minus', minus)]);
      toast('Копия восстановлена');
      render();
    } catch (e) {
      toast('Не получилось: ' + e.message);
    }
  }

  // ---------- Запуск ----------
  async function boot() {
    let k = null;
    try {
      const load = Promise.all(['user', 'added', 'parsed', 'minus', 'mt', 'key'].map((x) => DB.get(x)));
      // Если хранилище не отвечает (его держит другая вкладка), не висим на «Загружаю…».
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('не отвечает, закрой другие вкладки с приложением')), 5000));
      [user, added, parsed, minus, mt, k] = await Promise.race([load, timeout]);
      if (k) key = await importKey(k);
    } catch (e) {
      toast('Хранилище телефона: ' + e.message);
    }
    user = user || {}; added = added || []; parsed = parsed || {}; minus = minus || {}; mt = mt || {};
    // Стартовые отметки «Знаю/Новые» берутся из каталога, пока Лера их не поменяла.
    route();
    // Новая версия текстов на сайте подтягивается тихо; без интернета просто остаёмся на сохранённой.
    syncPack(false).then((changed) => { if (changed) render(); }).catch(() => {});
  }
  boot();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
