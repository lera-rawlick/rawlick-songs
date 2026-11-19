/*
 * Чистая логика без интерфейса: тональности, разбор заметки «Новая.txt», привязка минусовок.
 * Один и тот же файл работает в телефоне (window.Core) и в node для тестов (module.exports).
 */
(function (root) {
  // --- Тональности ---------------------------------------------------------

  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  /** Номер тональности 0–11, приведённый к параллельному мажору (Am и C → 0). null, если не распознана. */
  function keyIndex(k) {
    const m = String(k || '').match(/^([A-G])([#♯b♭]?)(m?)/);
    if (!m) return null;
    let n = NOTE[m[1]] + (/[#♯]/.test(m[2]) ? 1 : 0) - (/[b♭]/.test(m[2]) ? 1 : 0);
    if (m[3]) n += 3; // минор считаем от параллельного мажора, чтобы Em и G давали сдвиг 0
    return ((n % 12) + 12) % 12;
  }

  /** Сдвиг в полутонах от тональности a к b, в пределах −5…+6. null, если одна из них неизвестна. */
  function keyShift(a, b) {
    const x = keyIndex(a), y = keyIndex(b);
    if (x == null || y == null) return null;
    const d = (((y - x) % 12) + 12) % 12;
    return d > 6 ? d - 12 : d;
  }

  function plural(n) {
    n = Math.abs(n);
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return 'полутон';
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'полутона';
    return 'полутонов';
  }

  /** «+3 полутона», «−1 полутон», «как в оригинале». */
  function shiftText(d) {
    if (d == null) return '';
    if (d === 0) return 'как в оригинале';
    return (d > 0 ? '+' : '−') + Math.abs(d) + ' ' + plural(d);
  }

  /** F#m → F♯m, Bb → B♭. */
  function prettyKey(k) {
    return String(k || '').replace('#', '♯').replace(/^([A-G])b/, '$1♭');
  }

  // --- Текст ---------------------------------------------------------------

  /** Строка для сравнения названий: без эмодзи, цифр-эмодзи, знаков, регистра и диакритики. */
  function norm(s) {
    return String(s || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\d\uFE0F?\u20E3/g, '')
      .toLowerCase()
      .replace(/[’'`]/g, '')
      .replace(/[^a-z0-9а-яё\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Байты файла → текст. Заметки из iPhone часто в UTF-16, остальное — UTF-8. */
  function decode(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    let zeros = 0;
    for (let i = 1; i < Math.min(b.length, 400); i += 2) if (b[i] === 0) zeros++;
    if (zeros > 100) return new TextDecoder('utf-16le').decode(b);
    return new TextDecoder('utf-8').decode(b).replace(/^\uFEFF/, '');
  }

  const SPLIT = /\r\n|\r|\n|\u2028|\u2029/;
  const MARK = /^\s*\[?\s*(?:♥|❤|\u{1F608})/u; // ♥\uFE0F ❤\uFE0F 😈 в начале строки
  // Строки, после которых в заметке начинаются служебные списки, а не песни.
  const STOP = ['Тональность', 'Новые :'];

  /** Делит строки на абзацы по пустым строкам; строка с ♥\uFE0F/❤\uFE0F/😈 тоже начинает новый абзац. */
  function paragraphs(lines) {
    const out = [];
    let cur = [];
    for (const l of lines) {
      if (cur.length && MARK.test(l)) { out.push(cur); cur = []; }
      if (l.trim()) cur.push(l.trim());
      else if (cur.length) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out;
  }

  const count = (s, re) => (String(s).match(re) || []).length;
  const CYR = /[а-яё]/gi, LAT = /[a-z]/gi;

  /**
   * Абзац — это заметка Леры о песне, а не текст: списки, длинные фразы, подписи с двоеточием.
   * latin — текст песни латиницей: тогда абзац на русском в начале или в конце тоже заметка
   * (у французских и грузинских песен Лера пишет текст кириллицей, там это правило не работает).
   */
  function isNote(p, latin) {
    if (MARK.test(p[0])) return false;
    const all = p.join(' ');
    const words = all.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
    const cyr = count(all, CYR);
    return (
      p.some((l) => /^(•|👉|[-—]\s|\d+\.\s)/u.test(l) || /:\s*$/.test(l) || l.length > 70) ||
      (cyr > 0 && words <= 2) ||
      (latin && cyr > count(all, LAT))
    );
  }

  /**
   * Кусок заметки одной песни → { notes, lyrics, tr, orig }.
   * В заметке после текста бывают разделы «Перевод» и «Оригинал»; заметки о песне стоят в начале или в конце.
   */
  function segment(lines, song) {
    const skip = new Set([norm(song.t), norm(song.a), norm(song.at)].filter(Boolean));
    const sec = { main: [], tr: [], orig: [] };
    let cur = 'main';
    for (const l of lines) {
      if (/https?:\/\//.test(l) || /^\s*-\s*\[[ xX]?\]/.test(l)) continue; // ссылки и пункты чек-листа
      const n = norm(l);
      if (n === 'перевод') { cur = 'tr'; continue; }
      if (n === 'оригинал') { cur = 'orig'; continue; }
      // Повтор названия или исполнителя в самом начале раздела (в тексте «Yesterday» — это строчка, её не трогаем).
      if (skip.has(n) && !sec[cur].some((x) => x.trim())) continue;
      sec[cur].push(l);
    }
    const notes = [];
    const body = (key, minLines) => {
      const all = sec[key].join(' ');
      const latin = count(all, LAT) > count(all, CYR);
      const P = paragraphs(sec[key]);
      while (P.length && isNote(P[0], latin)) notes.push(P.shift());
      while (P.length && isNote(P[P.length - 1], latin)) notes.push(P.pop());
      // Короткий остаток без пометок ♥\uFE0F/😈 — это тоже заметки, а не текст песни.
      const n = P.reduce((a, p) => a + p.length, 0);
      if (n < minLines && !P.some((p) => p.some((l) => MARK.test(l)))) { notes.push(...P); return ''; }
      return P.map((p) => p.join('\n')).join('\n\n');
    };
    const lyrics = body('main', 8);
    const tr = body('tr', 3);
    const orig = body('orig', 3);
    const seen = new Set();
    const noteText = notes
      .map((p) => p.join('\n'))
      .filter((t) => (seen.has(t) ? false : seen.add(t)))
      .join('\n\n');
    return { notes: noteText, lyrics, tr, orig };
  }

  /**
   * Разбор всей заметки. Начало песни — строка, совпадающая с полем `at` из каталога.
   * Возвращает { byId: {id: {notes, lyrics, tr, orig}}, missing: [id] }.
   */
  function parseNotes(text, catalog) {
    const lines = String(text).split(SPLIT);
    const N = lines.map(norm);
    const starts = [];
    for (const s of catalog) {
      if (!s.at) continue;
      const i = N.indexOf(norm(s.at));
      if (i >= 0) starts.push([i, s]);
    }
    const stops = STOP.map((w) => N.indexOf(norm(w))).filter((i) => i >= 0);
    starts.sort((x, y) => x[0] - y[0]);
    const byId = {};
    starts.forEach(([i, s], n) => {
      const next = n + 1 < starts.length ? starts[n + 1][0] : lines.length;
      const end = Math.min(next, ...stops.filter((e) => e > i));
      const seg = segment(lines.slice(i + 1, end), s);
      if (seg.lyrics || seg.notes) byId[s.id] = seg;
    });
    const missing = catalog.filter((s) => s.at && !byId[s.id]).map((s) => s.id);
    return { byId, missing };
  }

  // --- Строфы для показа ---------------------------------------------------

  // Строка-разделитель: только черты, точки, огоньки и стрелки.
  const SEP = /^[\s⸻—–\-_=.…🔥⬆⬇☝👆👇\uFE0F]+$/u;

  /**
   * Текст → строфы [{lines, chorus}]. Новая строфа — после пустой строки, разделителя
   * или строки с ♥\uFE0F/❤\uFE0F/😈. Припев — строфа с 😈, со словом chorus/припев или повторяющаяся.
   */
  function stanzas(text) {
    const out = [];
    let cur = null;
    for (const raw of String(text || '').split(SPLIT)) {
      const l = raw.trim();
      if (!l || SEP.test(l)) { cur = null; continue; }
      if (!cur || (MARK.test(l) && cur.lines.length)) { cur = { lines: [] }; out.push(cur); }
      cur.lines.push(l);
    }
    const key = (s) => s.lines.map(norm).join('|');
    const seen = {};
    out.forEach((s) => { seen[key(s)] = (seen[key(s)] || 0) + 1; });
    const repeated = (s) => seen[key(s)] > 1 && s.lines.length > 1;
    // Если повторяется больше половины строф, песня просто вставлена в заметку дважды — повтор не признак припева.
    const useRepeats = out.filter(repeated).length <= out.length / 2;
    out.forEach((s) => {
      const f = s.lines[0];
      s.chorus = /^\s*\[?\s*\u{1F608}/u.test(f) || /chorus|припев/i.test(f) || (useRepeats && repeated(s));
    });
    return out;
  }

  // --- Минусовки -----------------------------------------------------------

  /** id песни для файла минусовки: сначала точное имя из каталога, потом название песни внутри имени. */
  function matchMinus(fileName, catalog) {
    const f = norm(fileName);
    for (const s of catalog) if ((s.mf || []).some((m) => norm(m) === f)) return s.id;
    let best = null;
    for (const s of catalog) {
      const t = norm(s.t);
      if (t.length > 3 && f.includes(t) && (!best || t.length > norm(best.t).length)) best = s;
    }
    return best ? best.id : null;
  }

  /** «+3 semitones» в имени файла → 3; нет пометки → null. */
  function minusShift(fileName) {
    const m = String(fileName).match(/([+-]\s?\d+)\s*semitone/i);
    return m ? parseInt(m[1].replace(/\s/g, ''), 10) : null;
  }

  // --- Шифрование ----------------------------------------------------------
  // Тексты и минусовки лежат на публичном сайте только зашифрованными (AES-GCM, ключ из пароля через PBKDF2).
  // Формат зашифрованного файла: 12 байт IV, затем шифротекст с тегом. Код общий для node (упаковка) и телефона.

  const subtle = () => globalThis.crypto.subtle;
  const b64enc = (u8) => btoa(String.fromCharCode(...u8));
  const b64dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(pass, saltB64, iter) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(String(pass).trim()), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', salt: b64dec(saltB64), iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }
  async function encrypt(key, data) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, data));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }
  /** Неверный ключ или испорченный файл → исключение (OperationError). */
  async function decrypt(key, data) {
    const b = new Uint8Array(data);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12)));
  }
  const exportKey = async (key) => b64enc(new Uint8Array(await subtle().exportKey('raw', key)));
  const importKey = (b64) => subtle().importKey('raw', b64dec(b64), 'AES-GCM', true, ['encrypt', 'decrypt']);

  const Core = {
    keyIndex, keyShift, shiftText, prettyKey, norm, decode, parseNotes, stanzas, matchMinus, minusShift, isNote,
    b64enc, b64dec, deriveKey, encrypt, decrypt, exportKey, importKey,
  };
  root.Core = Core;
  if (typeof module !== 'undefined') module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
