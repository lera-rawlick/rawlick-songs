#!/usr/bin/env node
/*
 * Упаковка для сайта: тексты из «Новая.txt» и минусовки из папки «Песни» → зашифрованные файлы в data/.
 *   node tools/pack.js            (папка по умолчанию ~/Desktop/Песни, другая — SONGS_DIR=...)
 *
 * Пароль лежит в .pack-password (в git не попадает). При первом запуске создаётся случайный.
 * data/meta.json — открытые параметры (соль, число итераций, версия, контрольная строка);
 * data/texts.bin — зашифрованные { parsed, minus }; data/m/*.bin — зашифрованные mp3.
 * Минусовка шифруется один раз: её файл называется по хешу имени и содержимого и при повторной упаковке
 * не переписывается, поэтому в git меняются только новые или изменённые mp3.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const Core = require('../core.js');
const CATALOG = require('../songs.js');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const M = path.join(DATA, 'm');
const DIR = process.env.SONGS_DIR || path.join(os.homedir(), 'Desktop', 'Песни');
const PASSFILE = path.join(ROOT, '.pack-password');
const ITER = 250000;

/** Пароль из файла или новый: 12 знаков без похожих букв, группами по 4 (удобно набирать на телефоне). */
function password() {
  if (fs.existsSync(PASSFILE)) return fs.readFileSync(PASSFILE, 'utf8').trim();
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const p = Array.from({ length: 12 }, () => A[nodeCrypto.randomInt(A.length)]).join('').replace(/(.{4})(?=.)/g, '$1-');
  fs.writeFileSync(PASSFILE, p + '\n', { mode: 0o600 });
  console.log('Создан новый пароль, он в', PASSFILE);
  return p;
}

(async () => {
  fs.mkdirSync(M, { recursive: true });
  const metaPath = path.join(DATA, 'meta.json');
  const old = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
  const salt = old ? old.salt : nodeCrypto.randomBytes(16).toString('base64');
  const iter = old ? old.iter : ITER;
  const key = await Core.deriveKey(password(), salt, iter);

  // Старые файлы зашифрованы прежним паролем — если пароль сменился, молча смешивать нельзя.
  if (old) {
    try { await Core.decrypt(key, Core.b64dec(old.check)); }
    catch { throw new Error('Пароль в .pack-password не подходит к уже выложенным данным. Удали data/ целиком, чтобы зашифровать заново.'); }
  }

  const text = Core.decode(fs.readFileSync(path.join(DIR, 'Новая.txt')));
  const { byId: parsed, missing } = Core.parseNotes(text, CATALOG);

  const minus = {};
  const used = new Set();
  let fresh = 0;
  for (const f of fs.readdirSync(DIR).filter((x) => /\.(mp3|m4a)$/i.test(x)).sort()) {
    const name = f.normalize('NFC'); // в macOS имена файлов разложены (NFD), в телефоне — собраны
    const id = Core.matchMinus(name, CATALOG);
    if (!id) { console.warn('Не нашла песню для файла:', f); continue; }
    const buf = fs.readFileSync(path.join(DIR, f));
    const bin = nodeCrypto.createHash('sha256').update(name).update(buf).digest('hex').slice(0, 24) + '.bin';
    used.add(bin);
    const out = path.join(M, bin);
    if (!fs.existsSync(out)) { fs.writeFileSync(out, await Core.encrypt(key, buf)); fresh++; }
    (minus[id] = minus[id] || []).push({ name, shift: Core.minusShift(name), src: 'data/m/' + bin, type: /\.m4a$/i.test(f) ? 'audio/mp4' : 'audio/mpeg' });
  }
  let removed = 0;
  for (const f of fs.readdirSync(M)) if (!used.has(f)) { fs.unlinkSync(path.join(M, f)); removed++; }

  const payload = Buffer.from(JSON.stringify({ parsed, minus }));
  const v = nodeCrypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
  if (!old || old.v !== v || !fs.existsSync(path.join(DATA, 'texts.bin'))) {
    fs.writeFileSync(path.join(DATA, 'texts.bin'), await Core.encrypt(key, payload));
  }
  const check = old ? old.check : Core.b64enc(await Core.encrypt(key, new TextEncoder().encode('ok')));
  fs.writeFileSync(metaPath, JSON.stringify({ v, salt, iter, check }, null, 2) + '\n');

  console.log(`Тексты: ${Object.keys(parsed).length} песен${missing.length ? ', не нашлись: ' + missing.join(', ') : ''}.`);
  console.log(`Минусовки: ${used.size} (новых зашифровано ${fresh}, удалено старых ${removed}). Версия ${v}.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
