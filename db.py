"""
db.py — всё, что связано с базой данных SQLite.

SQLite — это база данных, которая живёт в ОДНОМ файле (words.db) рядом с ботом.
Не нужен отдельный сервер БД — идеально для маленького проекта.

Здесь только "чистые" функции работы с данными (сохранить/достать/удалить/обновить).
Логику Telegram сюда НЕ тащим — так проще разбираться и тестировать.

Важно про структуру: таблица words хранит user_id у каждого слова. Значит,
хотя сейчас бот для одного человека, база уже готова к нескольким пользователям —
у каждого будут "свои" слова, отфильтрованные по user_id.
"""

import sqlite3
from datetime import datetime, timezone

import config
import spaced_repetition as sr


def _connect() -> sqlite3.Connection:
    """
    Открываем соединение с файлом базы.
    row_factory = sqlite3.Row позволяет обращаться к колонкам по имени
    (row["word"]), а не по номеру — так код читается понятнее.
    """
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _now() -> str:
    """
    Текущее время в UTC в виде строки ISO (например '2026-09-26T10:00:00+00:00').
    Мы храним время как текст — SQLite так удобно, и строки ISO корректно
    сравниваются оператором сравнения (более раннее время = "меньше").
    """
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    """
    Создаём таблицы, если их ещё нет. Вызывается один раз при старте бота.

    Таблица words — как просил ТЗ:
      id, user_id, word, translation, definition, example,
      level, next_review_time, date_added.

    Таблица pending_quiz — служебная: помнит, какой вопрос мы задали
    пользователю и ждём ответ. Она нужна, чтобы понимать: пришедший текст —
    это ОТВЕТ на проверку или НОВОЕ слово для добавления.
    """
    with _connect() as conn:
        conn.execute(
            """
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
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pending_quiz (
                user_id   INTEGER PRIMARY KEY,   -- по одному активному вопросу на пользователя
                word_id   INTEGER NOT NULL,      -- какое слово спрашиваем
                mode      TEXT    NOT NULL,       -- 'en2ru' (дай перевод) или 'ru2en' (дай слово)
                asked_at  TEXT    NOT NULL
            )
            """
        )


# ---------------------------------------------------------------------------
# Работа со словами
# ---------------------------------------------------------------------------

def add_word(user_id: int, word: str, translation: str,
             definition: str, example: str) -> int:
    """
    Добавляем новое слово. Новое слово начинается с уровня 0 и первого
    повторения через 1 час (первый интервал из spaced_repetition).
    Возвращаем id созданной строки — он понадобится для кнопок.
    """
    now_dt = datetime.now(timezone.utc)
    next_review = (now_dt + sr.next_interval(0)).isoformat()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO words
                (user_id, word, translation, definition, example,
                 level, next_review_time, date_added)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (user_id, word, translation, definition, example,
             next_review, now_dt.isoformat()),
        )
        return cur.lastrowid


def get_word(word_id: int):
    """Достаём одно слово по его id. Вернёт None, если такого нет."""
    with _connect() as conn:
        cur = conn.execute("SELECT * FROM words WHERE id = ?", (word_id,))
        return cur.fetchone()


def get_word_by_text(user_id: int, word: str):
    """
    Ищем слово по тексту у конкретного пользователя (без учёта регистра),
    чтобы не создавать дубликаты.
    """
    with _connect() as conn:
        cur = conn.execute(
            "SELECT * FROM words WHERE user_id = ? AND LOWER(word) = LOWER(?)",
            (user_id, word),
        )
        return cur.fetchone()


def list_words(user_id: int):
    """Все слова пользователя, сначала новые (по дате добавления)."""
    with _connect() as conn:
        cur = conn.execute(
            "SELECT * FROM words WHERE user_id = ? ORDER BY date_added DESC",
            (user_id,),
        )
        return cur.fetchall()


def delete_word_by_id(word_id: int) -> None:
    """Удаляем слово по id (например, по кнопке ❌)."""
    with _connect() as conn:
        conn.execute("DELETE FROM words WHERE id = ?", (word_id,))
        conn.execute("DELETE FROM pending_quiz WHERE word_id = ?", (word_id,))


def delete_word_by_text(user_id: int, word: str) -> bool:
    """
    Удаляем слово по тексту (команда /delete слово).
    Возвращаем True, если что-то реально удалили.
    """
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM words WHERE user_id = ? AND LOWER(word) = LOWER(?)",
            (user_id, word),
        )
        return cur.rowcount > 0


def set_level_and_review(word_id: int, level: int, next_review_dt: datetime) -> None:
    """Обновляем уровень слова и время следующего показа."""
    with _connect() as conn:
        conn.execute(
            "UPDATE words SET level = ?, next_review_time = ? WHERE id = ?",
            (level, next_review_dt.isoformat(), word_id),
        )


def get_due_word(user_id: int):
    """
    Берём ОДНО слово, которому пора на повторение:
    - время next_review_time уже наступило (<= сейчас),
    - и слово ещё НЕ выучено (level < MAX_LEVEL).
    ORDER BY RANDOM() — чтобы выбор был случайным среди подходящих.
    """
    with _connect() as conn:
        cur = conn.execute(
            """
            SELECT * FROM words
            WHERE user_id = ?
              AND level < ?
              AND next_review_time <= ?
            ORDER BY RANDOM()
            LIMIT 1
            """,
            (user_id, sr.MAX_LEVEL, _now()),
        )
        return cur.fetchone()


def get_any_word_for_quiz(user_id: int):
    """
    Для команды /quiz: берём любое НЕ выученное слово случайно,
    даже если его время ещё не подошло (пользователь сам захотел проверку).
    """
    with _connect() as conn:
        cur = conn.execute(
            """
            SELECT * FROM words
            WHERE user_id = ? AND level < ?
            ORDER BY RANDOM()
            LIMIT 1
            """,
            (user_id, sr.MAX_LEVEL),
        )
        return cur.fetchone()


def get_stats(user_id: int):
    """
    Считаем статистику одним проходом:
    - total: всего слов,
    - learned: выучено (level >= MAX_LEVEL),
    - in_review: в процессе (level < MAX_LEVEL).
    """
    with _connect() as conn:
        cur = conn.execute(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN level >= ? THEN 1 ELSE 0 END) AS learned
            FROM words
            WHERE user_id = ?
            """,
            (sr.MAX_LEVEL, user_id),
        )
        row = cur.fetchone()
        total = row["total"] or 0
        learned = row["learned"] or 0
        return {"total": total, "learned": learned, "in_review": total - learned}


def all_user_ids():
    """Список всех user_id, у кого есть слова — чтобы обойти их в планировщике."""
    with _connect() as conn:
        cur = conn.execute("SELECT DISTINCT user_id FROM words")
        return [r["user_id"] for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Активный вопрос (pending quiz)
# ---------------------------------------------------------------------------

def set_pending_quiz(user_id: int, word_id: int, mode: str) -> None:
    """Запоминаем, что мы задали пользователю вопрос и ждём его ответ."""
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO pending_quiz (user_id, word_id, mode, asked_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                word_id = excluded.word_id,
                mode = excluded.mode,
                asked_at = excluded.asked_at
            """,
            (user_id, word_id, mode, _now()),
        )


def get_pending_quiz(user_id: int):
    """Возвращаем активный вопрос пользователя или None, если его нет."""
    with _connect() as conn:
        cur = conn.execute(
            "SELECT * FROM pending_quiz WHERE user_id = ?", (user_id,)
        )
        return cur.fetchone()


def clear_pending_quiz(user_id: int) -> None:
    """Убираем активный вопрос (после того как пользователь ответил)."""
    with _connect() as conn:
        conn.execute("DELETE FROM pending_quiz WHERE user_id = ?", (user_id,))
