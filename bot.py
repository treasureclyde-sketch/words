"""
bot.py — главный файл. Здесь живёт сам телеграм-бот:
- реагирует на новые слова и присылает карточку с кнопками,
- в случайное время (через планировщик) устраивает проверки,
- проверяет твои ответы и двигает слова по уровням,
- понимает команды /start /help /list /stats /quiz /delete.

Библиотека python-telegram-bot асинхронная (async/await): бот может делать
несколько дел "одновременно" — принимать сообщения и по расписанию слать проверки.
"""

import html
import logging
import random
from datetime import datetime, timedelta, timezone

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
)
from telegram.constants import ParseMode
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)

import config
import db
import dictionary
import text_utils
import spaced_repetition as sr

# Настраиваем логи — чтобы в консоли было видно, что делает бот.
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("word_bot")

# Регулярка для проверки, что в тексте нет кириллицы (значит, слово английское).
import re
_CYRILLIC = re.compile(r"[а-яА-ЯёЁ]")


def _now() -> datetime:
    """Текущее время в UTC (одно место — чтобы не путаться с часовыми поясами)."""
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Проверка "это мой бот" — отвечаем только владельцу (если OWNER_USER_ID задан)
# ---------------------------------------------------------------------------

async def _guard(update: Update) -> bool:
    """
    Возвращает True, если пользователю можно пользоваться ботом.
    Если OWNER_USER_ID = 0 — пускаем всех (удобно для теста).
    Если задан — пускаем только владельца, остальным вежливо отказываем.
    """
    if config.OWNER_USER_ID == 0:
        return True
    user = update.effective_user
    if user and user.id == config.OWNER_USER_ID:
        return True
    if update.effective_message:
        await update.effective_message.reply_text(
            "Извини, этот бот личный 🙈"
        )
    return False


# ---------------------------------------------------------------------------
# Формирование карточки слова и кнопок
# ---------------------------------------------------------------------------

def _esc(text: str) -> str:
    """Экранируем спецсимволы HTML (<, >, &), чтобы разметка не сломалась."""
    return html.escape(text or "")


def build_word_card(info: dict) -> str:
    """
    Собираем красивый текст карточки слова.
    Пустые поля пропускаем, чтобы не показывать голые заголовки.
    """
    lines = []

    # Строка со словом и транскрипцией.
    head = f"🇬🇧 <b>{_esc(info['word'])}</b>"
    if info.get("phonetic"):
        head += f"  <code>{_esc(info['phonetic'])}</code>"
    lines.append(head)

    # Перевод на русский.
    if info.get("translation"):
        lines.append(f"🇷🇺 {_esc(info['translation'])}")

    # Определение на английском.
    if info.get("definition"):
        lines.append(f"\n📖 <i>{_esc(info['definition'])}</i>")

    # Пример употребления.
    if info.get("example"):
        lines.append(f"✏️ <i>{_esc(info['example'])}</i>")

    # Если слова не было в словаре — честно предупреждаем.
    if not info.get("found"):
        lines.append("\n<i>(нет в англ. словаре — показываю только перевод)</i>")

    return "\n".join(lines)


def build_keyboard(word_id: int) -> InlineKeyboardMarkup:
    """
    Кнопки под карточкой. В callback_data кладём действие и id слова,
    например 'remember:42'. По этой строке в обработчике поймём, что нажали.
    """
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Запомнил", callback_data=f"remember:{word_id}"),
            InlineKeyboardButton("🔁 Повторить позже", callback_data=f"later:{word_id}"),
        ],
        [
            InlineKeyboardButton("❌ Удалить", callback_data=f"delete:{word_id}"),
            InlineKeyboardButton("🔤 Мн. число", callback_data=f"plural:{word_id}"),
        ],
    ])


# ---------------------------------------------------------------------------
# Команды
# ---------------------------------------------------------------------------

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Приветствие и краткая инструкция."""
    if not await _guard(update):
        return
    await update.effective_message.reply_text(
        "Привет! Я помогу учить английские слова 📚\n\n"
        "• Просто пришли мне английское слово — я дам перевод, определение и пример.\n"
        "• Нажми кнопку, чтобы сохранить слово в свою базу.\n"
        "• Я сам буду в случайное время проверять тебя по сохранённым словам.\n\n"
        "Команды:\n"
        "/list — все мои слова\n"
        "/stats — статистика\n"
        "/quiz — проверка прямо сейчас\n"
        "/delete слово — удалить слово\n"
        "/help — помощь"
    )


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """То же, что /start — короткая справка."""
    await cmd_start(update, context)


async def cmd_list(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Показать все слова пользователя со статусами."""
    if not await _guard(update):
        return
    user_id = update.effective_user.id
    words = db.list_words(user_id)
    if not words:
        await update.effective_message.reply_text(
            "База пока пустая. Пришли мне английское слово, чтобы начать 🙂"
        )
        return

    lines = ["<b>Мои слова:</b>\n"]
    for w in words:
        level = w["level"]
        if sr.is_learned(level):
            badge = "✅ выучено"
        elif level == 0:
            badge = "🔴 новое"
        else:
            badge = f"🟡 ур. {level}/{sr.MAX_LEVEL}"
        translation = _esc(w["translation"] or "—")
        lines.append(f"• <b>{_esc(w['word'])}</b> — {translation}  [{badge}]")

    # Телеграм не даёт слать сообщения длиннее 4096 символов — режем на части.
    await _send_long(update.effective_message, "\n".join(lines))


async def cmd_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Статистика: сколько всего / выучено / на повторении."""
    if not await _guard(update):
        return
    s = db.get_stats(update.effective_user.id)
    await update.effective_message.reply_text(
        "📊 <b>Статистика</b>\n\n"
        f"Всего слов: <b>{s['total']}</b>\n"
        f"Выучено: <b>{s['learned']}</b>\n"
        f"На повторении: <b>{s['in_review']}</b>",
        parse_mode=ParseMode.HTML,
    )


async def cmd_quiz(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Запустить проверку прямо сейчас, не дожидаясь случайного времени."""
    if not await _guard(update):
        return
    user_id = update.effective_user.id

    # Если уже висел старый вопрос — начинаем свежий (перезапишем его).
    db.clear_pending_quiz(user_id)

    word = db.get_any_word_for_quiz(user_id)
    if not word:
        await update.effective_message.reply_text(
            "Нет слов для проверки 🤷 Добавь слова или ты уже всё выучил!"
        )
        return
    await send_quiz(context.bot, user_id, word)


async def cmd_delete(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Удалить слово командой: /delete streamline"""
    if not await _guard(update):
        return
    # context.args — это слова после команды. Для /delete streamline будет ['streamline'].
    if not context.args:
        await update.effective_message.reply_text(
            "Напиши, что удалить. Пример: <code>/delete streamline</code>",
            parse_mode=ParseMode.HTML,
        )
        return
    word = " ".join(context.args).strip()
    deleted = db.delete_word_by_text(update.effective_user.id, word)
    if deleted:
        await update.effective_message.reply_text(f"Удалил «{word}» 🗑")
    else:
        await update.effective_message.reply_text(f"Слова «{word}» нет в базе.")


# ---------------------------------------------------------------------------
# Обработка обычного текста: это либо ОТВЕТ на проверку, либо НОВОЕ слово
# ---------------------------------------------------------------------------

async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Главная развилка. Когда приходит обычный текст:
    - если у пользователя есть активный вопрос (pending_quiz) → это ОТВЕТ;
    - иначе → это НОВОЕ слово для добавления.
    """
    if not await _guard(update):
        return
    user_id = update.effective_user.id
    text = (update.effective_message.text or "").strip()
    if not text:
        return

    pending = db.get_pending_quiz(user_id)
    if pending:
        await handle_answer(update, context, pending)
    else:
        await handle_new_word(update, context, text)


async def handle_new_word(update: Update, context: ContextTypes.DEFAULT_TYPE, word: str) -> None:
    """Добавляем новое слово: ищем данные, сохраняем, показываем карточку с кнопками."""
    # Простая проверка: если прислали русские буквы — это не английское слово.
    if _CYRILLIC.search(word):
        await update.effective_message.reply_text(
            "Кажется, это русское слово 🙂 Пришли, пожалуйста, английское."
        )
        return

    # Нет ли уже такого слова в базе — не создаём дубликаты.
    existing = db.get_word_by_text(update.effective_user.id, word)
    if existing:
        await update.effective_message.reply_text(
            f"«{word}» уже есть в твоей базе 👍 (уровень {existing['level']}/{sr.MAX_LEVEL})"
        )
        return

    # Показываем "печатает…", пока ходим в интернет за данными.
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")

    info = dictionary.lookup(word)

    # Если не удалось получить вообще ничего (ни перевода, ни словаря) — сообщаем.
    if not info["translation"] and not info["found"]:
        await update.effective_message.reply_text(
            "Не смог найти перевод 😔 Проверь написание или попробуй позже."
        )
        return

    # Сохраняем в базу (уровень 0, первое повторение через 1 час).
    word_id = db.add_word(
        update.effective_user.id,
        info["word"],
        info["translation"],
        info["definition"],
        info["example"],
    )

    await update.effective_message.reply_text(
        build_word_card(info),
        parse_mode=ParseMode.HTML,
        reply_markup=build_keyboard(word_id),
    )


async def handle_answer(update: Update, context: ContextTypes.DEFAULT_TYPE, pending) -> None:
    """
    Пользователь ответил на проверку. Сверяем ответ, хвалим или показываем
    правильный вариант, и двигаем слово по уровням (spaced repetition).
    """
    user_id = update.effective_user.id
    user_answer = update.effective_message.text.strip()

    word = db.get_word(pending["word_id"])
    # Слово могли удалить, пока висел вопрос — тогда просто снимаем вопрос.
    if not word:
        db.clear_pending_quiz(user_id)
        await update.effective_message.reply_text("Это слово уже удалено 🤷")
        return

    mode = pending["mode"]
    # В зависимости от режима правильный ответ — либо перевод, либо само слово.
    if mode == "en2ru":
        correct_answer = word["translation"]
    else:  # ru2en
        correct_answer = word["word"]

    # Снимаем активный вопрос — он "использован".
    db.clear_pending_quiz(user_id)

    correct = text_utils.is_correct(user_answer, correct_answer)
    level = word["level"]

    if correct:
        new_level = sr.apply_correct(level)
        next_review = _now() + sr.next_interval(new_level)
        db.set_level_and_review(word["id"], new_level, next_review)

        if sr.is_learned(new_level):
            await update.effective_message.reply_text(
                f"🎉 Верно! Ты <b>выучил</b> слово «{_esc(word['word'])}». Поздравляю!",
                parse_mode=ParseMode.HTML,
            )
        else:
            await update.effective_message.reply_text(
                f"✅ Верно! Уровень слова «{_esc(word['word'])}»: "
                f"{level} → <b>{new_level}</b>/{sr.MAX_LEVEL}. "
                "Покажу его снова попозже.",
                parse_mode=ParseMode.HTML,
            )
    else:
        # Ошибка → уровень в 0, показать снова скоро (через 10 минут).
        new_level = sr.apply_wrong(level)
        next_review = _now() + timedelta(minutes=10)
        db.set_level_and_review(word["id"], new_level, next_review)
        await update.effective_message.reply_text(
            f"❌ Не совсем. Правильный ответ: <b>{_esc(correct_answer)}</b>\n"
            f"(слово «{_esc(word['word'])}»)\n"
            "Ничего страшного — скоро повторим ещё раз 💪",
            parse_mode=ParseMode.HTML,
        )


# ---------------------------------------------------------------------------
# Нажатия на inline-кнопки
# ---------------------------------------------------------------------------

async def on_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Обрабатываем нажатия кнопок под карточкой слова.
    callback_data имеет вид 'действие:id', например 'remember:42'.
    """
    query = update.callback_query
    # Всегда отвечаем на callback, иначе у кнопки крутится "часики".
    await query.answer()

    if config.OWNER_USER_ID != 0 and query.from_user.id != config.OWNER_USER_ID:
        return

    action, _, word_id_str = query.data.partition(":")
    word_id = int(word_id_str)
    word = db.get_word(word_id)

    if not word:
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text("Это слово уже удалено 🤷")
        return

    if action == "plural":
        # Множественное число не меняет базу — просто показываем результат.
        pl = dictionary.plural(word["word"])
        await query.message.reply_text(
            f"🔤 Мн. число: <b>{_esc(word['word'])}</b> → <b>{_esc(pl)}</b>",
            parse_mode=ParseMode.HTML,
        )
        return

    if action == "remember":
        # "Запомнил" → поднимаем уровень и откладываем следующий показ.
        new_level = sr.apply_correct(word["level"])
        next_review = _now() + sr.next_interval(new_level)
        db.set_level_and_review(word_id, new_level, next_review)
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text(
            f"✅ Отметил «{_esc(word['word'])}» как запомненное "
            f"(уровень {new_level}/{sr.MAX_LEVEL}).",
            parse_mode=ParseMode.HTML,
        )

    elif action == "later":
        # "Повторить позже" → уровень 0, показать скоро (через 30 минут).
        db.set_level_and_review(word_id, 0, _now() + timedelta(minutes=30))
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text(
            f"🔁 Ок, скоро напомню про «{_esc(word['word'])}».",
            parse_mode=ParseMode.HTML,
        )

    elif action == "delete":
        db.delete_word_by_id(word_id)
        await query.edit_message_reply_markup(reply_markup=None)
        await query.message.reply_text(f"🗑 Удалил «{_esc(word['word'])}».")


# ---------------------------------------------------------------------------
# Проверки (quiz): отправка вопроса и планировщик
# ---------------------------------------------------------------------------

async def send_quiz(bot, user_id: int, word) -> None:
    """
    Отправляем вопрос-проверку по слову. Режим выбираем случайно (чередуем):
    - en2ru: показываем английское слово, просим перевод на русский;
    - ru2en: показываем русский перевод, просим написать по-английски.
    Если перевода нет — можем спросить только en2ru.
    """
    has_translation = bool(word["translation"])
    if has_translation:
        mode = random.choice(["en2ru", "ru2en"])
    else:
        mode = "en2ru"

    if mode == "en2ru":
        question = (
            "🧠 <b>Проверка!</b>\n\n"
            f"Как переводится слово <b>{_esc(word['word'])}</b>?\n"
            "Напиши перевод на русском."
        )
    else:
        question = (
            "🧠 <b>Проверка!</b>\n\n"
            f"Напиши по-английски: <b>{_esc(word['translation'])}</b>"
        )

    # Запоминаем вопрос, чтобы следующий текст пользователя считать ответом.
    db.set_pending_quiz(user_id, word["id"], mode)
    await bot.send_message(chat_id=user_id, text=question, parse_mode=ParseMode.HTML)


async def check_due_words(context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Планировщик: запускается раз в CHECK_INTERVAL_MINUTES минут.
    Для каждого пользователя проверяет, нет ли слова, которому пора на
    повторение, и если есть — присылает проверку. Так получаются проверки
    "в случайное время": слова всплывают тогда, когда подходит их интервал.
    """
    for user_id in db.all_user_ids():
        # Если пользователь ещё не ответил на прошлый вопрос — не сыпем новыми.
        if db.get_pending_quiz(user_id):
            continue
        word = db.get_due_word(user_id)
        if word:
            try:
                await send_quiz(context.bot, user_id, word)
            except Exception as e:
                # Например, пользователь ещё не писал боту /start — пропускаем.
                logger.warning("Не смог отправить проверку %s: %s", user_id, e)


# ---------------------------------------------------------------------------
# Вспомогательное и запуск
# ---------------------------------------------------------------------------

async def _send_long(message, text: str) -> None:
    """Отправляем длинный текст частями (лимит Telegram — 4096 символов)."""
    limit = 4000
    lines = text.split("\n")
    chunk = ""
    for line in lines:
        if len(chunk) + len(line) + 1 > limit:
            await message.reply_text(chunk, parse_mode=ParseMode.HTML)
            chunk = ""
        chunk += line + "\n"
    if chunk.strip():
        await message.reply_text(chunk, parse_mode=ParseMode.HTML)


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Ловим необработанные ошибки, чтобы бот не падал, а писал их в лог."""
    logger.error("Ошибка при обработке апдейта:", exc_info=context.error)


def main() -> None:
    """Точка входа: собираем приложение, вешаем обработчики, запускаем."""
    config.validate()   # упадём с понятной ошибкой, если нет токена
    db.init_db()        # создаём таблицы, если их ещё нет

    application = Application.builder().token(config.BOT_TOKEN).build()

    # Команды
    application.add_handler(CommandHandler("start", cmd_start))
    application.add_handler(CommandHandler("help", cmd_help))
    application.add_handler(CommandHandler("list", cmd_list))
    application.add_handler(CommandHandler("stats", cmd_stats))
    application.add_handler(CommandHandler("quiz", cmd_quiz))
    application.add_handler(CommandHandler("delete", cmd_delete))

    # Нажатия кнопок
    application.add_handler(CallbackQueryHandler(on_button))

    # Любой обычный текст (не команда) — новое слово или ответ на проверку.
    application.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND, on_text)
    )

    # Обработчик ошибок
    application.add_error_handler(on_error)

    # Планировщик проверок (JobQueue). Первый запуск — через интервал,
    # дальше — каждые CHECK_INTERVAL_MINUTES минут.
    interval_seconds = config.CHECK_INTERVAL_MINUTES * 60
    application.job_queue.run_repeating(
        check_due_words,
        interval=interval_seconds,
        first=interval_seconds,
        name="check_due_words",
    )

    logger.info("Бот запущен. Проверки каждые %s мин.", config.CHECK_INTERVAL_MINUTES)
    # run_polling сам создаёт и крутит asyncio-цикл — просто спрашивает у Telegram
    # новые сообщения по кругу, пока мы не остановим бота (Ctrl+C).
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
