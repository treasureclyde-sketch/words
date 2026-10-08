// db.js — работа с базой D1 (это SQLite внутри Cloudflare).
// Аналог db.py. Главное отличие: все вызовы АСИНХРОННЫЕ (await), потому что
// база живёт отдельно от воркера, и запрос к ней — это сетевой вызов.
//
// D1 API:
//   env.DB.prepare(SQL).bind(...значения).first()  → одна строка (или null)
//                                        .all()    → { results: [...] }
//                                        .run()    → выполнить (INSERT/UPDATE/DELETE)

import { MAX_LEVEL, nextReviewISO } from "./spacedRepetition.js";

const nowISO = () => new Date().toISOString();

// ---------------------- Слова ----------------------

// Добавить новое слово (уровень 0, первое повторение через 1 час).
// Возвращаем id созданной строки.
export async function addWord(env, userId, word, translation, definition, example) {
  const result = await env.DB.prepare(
    `INSERT INTO words
        (user_id, word, translation, definition, example, level, next_review_time, date_added)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(userId, word, translation, definition, example, nextReviewISO(0), nowISO())
    .run();
  return result.meta.last_row_id;
}

export async function getWord(env, wordId) {
  return env.DB.prepare(`SELECT * FROM words WHERE id = ?`).bind(wordId).first();
}

export async function getWordByText(env, userId, word) {
  return env.DB.prepare(
    `SELECT * FROM words WHERE user_id = ? AND LOWER(word) = LOWER(?)`
  ).bind(userId, word).first();
}

export async function listWords(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM words WHERE user_id = ? ORDER BY date_added DESC`
  ).bind(userId).all();
  return results || [];
}

export async function deleteWordById(env, wordId) {
  await env.DB.prepare(`DELETE FROM words WHERE id = ?`).bind(wordId).run();
  await env.DB.prepare(`DELETE FROM pending_quiz WHERE word_id = ?`).bind(wordId).run();
}

export async function deleteWordByText(env, userId, word) {
  const result = await env.DB.prepare(
    `DELETE FROM words WHERE user_id = ? AND LOWER(word) = LOWER(?)`
  ).bind(userId, word).run();
  return result.meta.changes > 0; // true, если что-то реально удалили
}

// Обновить уровень и время следующего показа.
export async function setLevelAndReview(env, wordId, level, nextReviewIso) {
  await env.DB.prepare(
    `UPDATE words SET level = ?, next_review_time = ? WHERE id = ?`
  ).bind(level, nextReviewIso, wordId).run();
}

// Одно слово, которому ПОРА на повторение (время пришло и оно не выучено).
export async function getDueWord(env, userId) {
  return env.DB.prepare(
    `SELECT * FROM words
     WHERE user_id = ? AND level < ? AND next_review_time <= ?
     ORDER BY RANDOM() LIMIT 1`
  ).bind(userId, MAX_LEVEL, nowISO()).first();
}

// Любое не выученное слово (для команды /quiz — проверка прямо сейчас).
export async function getAnyWordForQuiz(env, userId) {
  return env.DB.prepare(
    `SELECT * FROM words WHERE user_id = ? AND level < ? ORDER BY RANDOM() LIMIT 1`
  ).bind(userId, MAX_LEVEL).first();
}

export async function getStats(env, userId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN level >= ? THEN 1 ELSE 0 END) AS learned
     FROM words WHERE user_id = ?`
  ).bind(MAX_LEVEL, userId).first();
  const total = row?.total || 0;
  const learned = row?.learned || 0;
  return { total, learned, in_review: total - learned };
}

// Все user_id, у кого есть слова — чтобы обойти их в cron-проверке.
export async function allUserIds(env) {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM words`
  ).all();
  return (results || []).map((r) => r.user_id);
}

// ---------------------- Активный вопрос ----------------------

export async function setPendingQuiz(env, userId, wordId, mode) {
  // UPSERT: если вопрос для пользователя уже есть — перезапишем его.
  await env.DB.prepare(
    `INSERT INTO pending_quiz (user_id, word_id, mode, asked_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
        word_id = excluded.word_id,
        mode = excluded.mode,
        asked_at = excluded.asked_at`
  ).bind(userId, wordId, mode, nowISO()).run();
}

export async function getPendingQuiz(env, userId) {
  return env.DB.prepare(
    `SELECT * FROM pending_quiz WHERE user_id = ?`
  ).bind(userId).first();
}

export async function clearPendingQuiz(env, userId) {
  await env.DB.prepare(`DELETE FROM pending_quiz WHERE user_id = ?`).bind(userId).run();
}
