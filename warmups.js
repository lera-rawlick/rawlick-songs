/*
 * Распевки с YouTube (подобраны 19.11.2026). g: 'soprano' | 'rasp'. Свои Лера добавляет в приложении —
 * они хранятся в телефоне (ключ 'warm'). Порядок внутри группы — от разогрева к сложному.
 */
(function (root) {
  const WARMUPS = [
    { id: 'GJKSorA09-o', g: 'soprano', t: 'Распевка за 10 минут — ежедневная распевка сопрано', ch: 'Даниэль Ефременко', len: '9:37' },
    { id: '8usdrulk8GE', g: 'soprano', t: 'Нескучная распевка на 10 минут', ch: 'Margo Solovey', len: '10:04' },
    { id: '9jRTCFATeeA', g: 'soprano', t: 'Вокальные упражнения (распевки) для сопрано', ch: 'Секреты вокального голоса', len: '6:46' },
    { id: '8l-oLmg_gvQ', g: 'soprano', t: 'Разминка для сопрано, для высоких голосов', ch: 'Vocal Warmups with Kathleen', len: '9:12' },
    { id: '77TFatDIDZM', g: 'soprano', t: 'Soprano Vocal Warm Up', ch: 'Jacobs Vocal Academy', len: '6:29' },
    { id: 'UhNpLwNLAVw', g: 'rasp', t: 'Тренинг для чистого вокала: как подготовить голос к расщеплению', ch: 'Sasha Sova', len: '17:26' },
    { id: 'XqrneMKD1uU', g: 'rasp', t: 'Распевки на расщепление', ch: 'Sasha Sova', len: '15:24' },
    { id: 'P0D_7z9NROA', g: 'rasp', t: 'Топ-5 упражнений на расщепление', ch: 'Zhenya Frantseva', len: '4:20' },
    { id: '0EwRNscUYpc', g: 'rasp', t: 'Урок расщепления №1', ch: 'Иван Радьков', len: '1:48' },
    { id: 'a5e0remwnao', g: 'rasp', t: 'Raspy Vocal Warm Up', ch: 'Jacobs Vocal Academy', len: '4:30' },
    { id: 'bNNvB8Ry5Go', g: 'rasp', t: 'Ежедневная разминка для дисторшна и агрессивного вокала', ch: 'Chris Liepe', len: '11:54' },
  ];
  root.WARMUPS = WARMUPS;
  if (typeof module !== 'undefined') module.exports = WARMUPS;
})(typeof window !== 'undefined' ? window : globalThis);
