// Проверка логики: node --test test/
// Тесты разбора используют настоящую заметку и минусовки из ~/Desktop/Песни — в репозиторий они не попадают,
// поэтому без этой папки такие тесты пропускаются.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Core = require('../core.js');
const CATALOG = require('../songs.js');

const DIR = process.env.SONGS_DIR || path.join(os.homedir(), 'Desktop', 'Песни');
const NOTES = path.join(DIR, 'Новая.txt');
const hasNotes = fs.existsSync(NOTES);

test('сдвиг тональности считается с учётом параллельных ладов', () => {
  assert.equal(Core.keyShift('Cm', 'Em'), 4);
  assert.equal(Core.keyShift('Am', 'Cm'), 3);
  assert.equal(Core.keyShift('G', 'Em'), 0); // параллельные: тот же звукоряд
  assert.equal(Core.keyShift('C', 'D'), 2);
  assert.equal(Core.keyShift('Dm', 'Bm'), -3);
  assert.equal(Core.keyShift('Em', 'Am'), 5); // Zombie: оригинал Em, с Артом Am
  assert.equal(Core.keyShift('', 'Am'), null);
  assert.equal(Core.shiftText(3), '+3 полутона');
  assert.equal(Core.shiftText(-1), '−1 полутон');
  assert.equal(Core.shiftText(5), '+5 полутонов');
  assert.equal(Core.prettyKey('F#m'), 'F♯m');
  assert.equal(Core.prettyKey('Ebm'), 'E♭m');
});

test('каталог: уникальные id, концерт 3 блока по 6 без дублей', () => {
  const ids = CATALOG.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  const slots = CATALOG.filter((s) => s.c).map((s) => s.c.join('-'));
  assert.equal(slots.length, 18);
  assert.equal(new Set(slots).size, 18);
  for (const s of CATALOG) for (const [k] of s.my || []) assert.notEqual(Core.keyIndex(k), null, `${s.id}: ${k}`);
});

test('строфы: припев по 😈 и по повтору', () => {
  const st = Core.stanzas('♥\uFE0FСтрока один\nстрока два\n\n😈Припев раз\nприпев два\n\nКуплет\nещё\n\nПрипев раз\nприпев два');
  assert.equal(st.length, 4);
  assert.deepEqual(st.map((s) => s.chorus), [false, true, false, true]);
});

test('шифрование: расшифровка своим паролем и отказ чужому', async () => {
  const salt = Core.b64enc(new Uint8Array(16).fill(7));
  const key = await Core.deriveKey('abcd-efgh', salt, 1000);
  const box = await Core.encrypt(key, new TextEncoder().encode('Припев'));
  assert.equal(new TextDecoder().decode(await Core.decrypt(key, box)), 'Припев');
  const same = await Core.importKey(await Core.exportKey(key)); // ключ, сохранённый в телефоне
  assert.equal(new TextDecoder().decode(await Core.decrypt(same, box)), 'Припев');
  const wrong = await Core.deriveKey('abcd-efgX', salt, 1000);
  await assert.rejects(Core.decrypt(wrong, box));
});

const PASS = path.join(__dirname, '..', '.pack-password');
test('упаковка data/: тексты и минусовки расшифровываются паролем', { skip: !fs.existsSync(PASS) }, async () => {
  const data = path.join(__dirname, '..', 'data');
  const meta = JSON.parse(fs.readFileSync(path.join(data, 'meta.json'), 'utf8'));
  const key = await Core.deriveKey(fs.readFileSync(PASS, 'utf8'), meta.salt, meta.iter);
  const pack = JSON.parse(new TextDecoder().decode(await Core.decrypt(key, fs.readFileSync(path.join(data, 'texts.bin')))));
  assert.ok(Object.keys(pack.parsed).length >= 40);
  const files = Object.values(pack.minus).flat();
  assert.ok(files.length >= 30);
  for (const f of files) assert.ok(fs.existsSync(path.join(__dirname, '..', f.src)), f.src);
  const mp3 = await Core.decrypt(key, fs.readFileSync(path.join(__dirname, '..', files[0].src)));
  assert.equal(String.fromCharCode(mp3[0], mp3[1], mp3[2]) === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0), true, 'это mp3');
});

test('минусовки: номер сдвига из имени', () => {
  assert.equal(Core.minusShift('1. Twist In My Sobriety (драйв) +3 semitones.mp3'), 3);
  assert.equal(Core.minusShift('Adele - Rolling in the Deep (minus 7) -1 semitone.mp3'), -1);
  assert.equal(Core.minusShift('7. ton heritage.mp3'), null);
});

test('минусовки: каждый файл из папки привязывается к своей песне', { skip: !fs.existsSync(DIR) }, () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mp3'));
  assert.ok(files.length >= 30);
  for (const f of files) {
    const id = Core.matchMinus(f, CATALOG);
    assert.ok(id, `не привязан: ${f}`);
    const song = CATALOG.find((s) => s.id === id);
    assert.ok((song.mf || []).some((m) => Core.norm(m) === Core.norm(f)), `${f} → ${id}`);
  }
});

test('заметка: у песен концерта найден текст, припевы с 😈 распознаны', { skip: !hasNotes }, () => {
  const text = Core.decode(fs.readFileSync(NOTES));
  const { byId, missing } = Core.parseNotes(text, CATALOG);
  assert.deepEqual(missing, [], 'не нашлись в заметке');
  // У «Чито-гврито» в заметке только рассказ о фильме, текста нет.
  for (const s of CATALOG.filter((x) => x.c && x.at && x.id !== 'chito-gvrito')) {
    assert.ok(byId[s.id] && byId[s.id].lyrics.split('\n').length > 6, `нет текста: ${s.id}`);
  }
  for (const [id, seg] of Object.entries(byId)) {
    if (/\u{1F608}/u.test(seg.lyrics)) {
      assert.ok(Core.stanzas(seg.lyrics).some((x) => x.chorus), `нет припева: ${id}`);
    }
    // ссылки и пункты чек-листа в текст не попадают
    assert.ok(!/https?:\/\//.test(seg.lyrics + seg.tr + seg.orig), `ссылка в тексте: ${id}`);
  }
});
