// spacedRepetition.js — логика интервального повторения.
// Это точный аналог spaced_repetition.py, только на JavaScript.
// Время в JS удобно считать в миллисекундах, поэтому интервалы задаём в мс.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Интервалы для уровней 0..4 (индекс = уровень).
export const INTERVALS_MS = [
  1 * HOUR,   // уровень 0 → через 1 час
  1 * DAY,    // уровень 1 → через 1 день
  3 * DAY,    // уровень 2 → через 3 дня
  7 * DAY,    // уровень 3 → через 7 дней
  14 * DAY,   // уровень 4 → через 14 дней
];

// Максимальный уровень. Дошёл до него → слово "выучено".
export const MAX_LEVEL = INTERVALS_MS.length; // = 5

// Через сколько миллисекунд показывать слово при данном уровне.
export function nextIntervalMs(level) {
  if (level < 0) level = 0;
  if (level >= INTERVALS_MS.length) return INTERVALS_MS[INTERVALS_MS.length - 1];
  return INTERVALS_MS[level];
}

// Удобный помощник: вернуть ISO-строку "сейчас + интервал уровня".
export function nextReviewISO(level) {
  return new Date(Date.now() + nextIntervalMs(level)).toISOString();
}

// Ответ верный → уровень +1, но не выше максимума.
export function applyCorrect(level) {
  return Math.min(level + 1, MAX_LEVEL);
}

// Ответ неверный → уровень сбрасывается в 0.
export function applyWrong() {
  return 0;
}

// Слово выучено?
export function isLearned(level) {
  return level >= MAX_LEVEL;
}
