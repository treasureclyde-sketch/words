-- schema.sql — создаём таблицы в базе D1.
-- Запускается один раз командой (см. README):
--   wrangler d1 execute word-bot-db --remote --file=./schema.sql
--
-- Структура точно такая же, как в Python-версии (SQLite и D1 — родственники).

-- Таблица со словами пользователя.
CREATE TABLE IF NOT EXISTS words (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    word             TEXT    NOT NULL,
    translation      TEXT,
    definition       TEXT,
    example          TEXT,
    level            INTEGER NOT NULL DEFAULT 0,
    next_review_time TEXT    NOT NULL,
    date_added       TEXT    NOT NULL
);

-- Индекс ускоряет поиск слов "которым пора на повторение".
CREATE INDEX IF NOT EXISTS idx_words_due
    ON words (user_id, level, next_review_time);

-- Служебная таблица: какой вопрос мы задали пользователю и ждём ответ.
-- Нужна, чтобы отличать ОТВЕТ на проверку от НОВОГО слова.
CREATE TABLE IF NOT EXISTS pending_quiz (
    user_id   INTEGER PRIMARY KEY,
    word_id   INTEGER NOT NULL,
    mode      TEXT    NOT NULL,   -- 'en2ru' или 'ru2en'
    asked_at  TEXT    NOT NULL
);
