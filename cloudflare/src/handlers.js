// handlers.js — вся логика бота: команды, кнопки, проверки.
// Это аналог обработчиков из bot.py.

import * as db from "./db.js";
import * as dict from "./dictionary.js";
import * as sr from "./spacedRepetition.js";
import { isCorrect } from "./textUtils.js";
import {
  sendMessage,
  answerCallbackQuery,
  editMessageReplyMarkup,
  sendChatAction,
} from "./telegram.js";

// Экранируем символы, опасные для HTML-разметки Telegram.
function esc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Проверка "это мой бот": отвечаем только владельцу (если OWNER_USER_ID задан).
function isOwner(env, userId) {
  const owner = (env.OWNER_USER_ID || "0").toString().trim();
  if (owner === "0" || owner === "") return true; // 0 = отвечать всем
  return String(userId) === owner;
}

// ------------------- Карточка слова и кнопки -------------------

function buildWordCard(info) {
  const lines = [];
  let head = `🇬🇧 <b>${esc(info.word)}</b>`;
  if (info.phonetic) head += `  <code>${esc(info.phonetic)}</code>`;
  lines.push(head);
  if (info.translation) lines.push(`🇷🇺 ${esc(info.translation)}`);
  if (info.note) lines.push(`\n💡 ${esc(info.note)}`);
  if (info.definition) lines.push(`\n📖 <i>${esc(info.definition)}</i>`);
  if (info.example) lines.push(`✏️ <i>${esc(info.example)}</i>`);
  return lines.join("\n");
}

function buildKeyboard(wordId) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Запомнил", callback_data: `remember:${wordId}` },
        { text: "🔁 Повторить позже", callback_data: `later:${wordId}` },
      ],
      [
        { text: "❌ Удалить", callback_data: `delete:${wordId}` },
        { text: "🔤 Мн. число", callback_data: `plural:${wordId}` },
      ],
    ],
  };
}

// ------------------- Команды -------------------

const HELP_TEXT =
  "Привет! Я помогу учить английские слова 📚\n\n" +
  "• Просто пришли мне английское слово — я дам перевод, определение и пример.\n" +
  "• Нажми кнопку, чтобы сохранить слово в свою базу.\n" +
  "• Я сам буду в случайное время проверять тебя по сохранённым словам.\n\n" +
  "Команды:\n" +
  "/list — все мои слова\n" +
  "/stats — статистика\n" +
  "/quiz — проверка прямо сейчас\n" +
  "/delete слово — удалить слово\n" +
  "/help — помощь";

async function cmdStart(env, chatId) {
  await sendMessage(env, chatId, HELP_TEXT);
}

async function cmdList(env, chatId, userId) {
  const words = await db.listWords(env, userId);
  if (words.length === 0) {
    await sendMessage(env, chatId, "База пока пустая. Пришли мне английское слово, чтобы начать 🙂");
    return;
  }
  const lines = ["<b>Мои слова:</b>\n"];
  for (const w of words) {
    let badge;
    if (sr.isLearned(w.level)) badge = "✅ выучено";
    else if (w.level === 0) badge = "🔴 новое";
    else badge = `🟡 ур. ${w.level}/${sr.MAX_LEVEL}`;
    lines.push(`• <b>${esc(w.word)}</b> — ${esc(w.translation || "—")}  [${badge}]`);
  }
  // Telegram не даёт сообщения длиннее 4096 символов — режем на части.
  await sendLong(env, chatId, lines.join("\n"));
}

async function cmdStats(env, chatId, userId) {
  const s = await db.getStats(env, userId);
  await sendMessage(
    env,
    chatId,
    "📊 <b>Статистика</b>\n\n" +
      `Всего слов: <b>${s.total}</b>\n` +
      `Выучено: <b>${s.learned}</b>\n` +
      `На повторении: <b>${s.in_review}</b>`
  );
}

async function cmdQuiz(env, chatId, userId) {
  await db.clearPendingQuiz(env, userId); // начинаем свежий вопрос
  const word = await db.getAnyWordForQuiz(env, userId);
  if (!word) {
    await sendMessage(env, chatId, "Нет слов для проверки 🤷 Добавь слова или ты уже всё выучил!");
    return;
  }
  await sendQuiz(env, userId, word);
}

async function cmdDelete(env, chatId, userId, args) {
  const word = args.trim();
  if (!word) {
    await sendMessage(env, chatId, "Напиши, что удалить. Пример: <code>/delete streamline</code>");
    return;
  }
  const deleted = await db.deleteWordByText(env, userId, word);
  await sendMessage(env, chatId, deleted ? `Удалил «${esc(word)}» 🗑` : `Слова «${esc(word)}» нет в базе.`);
}

// ------------------- Новое слово / ответ на проверку -------------------

async function handleNewWord(env, chatId, userId, word) {
  // Русские буквы → это не английское слово.
  if (/[а-яА-ЯёЁ]/.test(word)) {
    await sendMessage(env, chatId, "Кажется, это русское слово 🙂 Пришли, пожалуйста, английское.");
    return;
  }
  const existing = await db.getWordByText(env, userId, word);
  if (existing) {
    await sendMessage(env, chatId, `«${esc(word)}» уже есть в твоей базе 👍 (уровень ${existing.level}/${sr.MAX_LEVEL})`);
    return;
  }

  await sendChatAction(env, chatId, "typing"); // показываем "печатает…"
  const info = await dict.lookup(word, env);

  if (!info.translation && !info.found) {
    await sendMessage(env, chatId, "Не смог найти перевод 😔 Проверь написание или попробуй позже.");
    return;
  }

  const wordId = await db.addWord(env, userId, info.word, info.translation, info.definition, info.example);
  await sendMessage(env, chatId, buildWordCard(info), { reply_markup: buildKeyboard(wordId) });
}

async function handleAnswer(env, chatId, userId, pending, userAnswer) {
  const word = await db.getWord(env, pending.word_id);
  if (!word) {
    await db.clearPendingQuiz(env, userId);
    await sendMessage(env, chatId, "Это слово уже удалено 🤷");
    return;
  }

  const correctAnswer = pending.mode === "en2ru" ? word.translation : word.word;
  await db.clearPendingQuiz(env, userId); // вопрос использован

  const correct = isCorrect(userAnswer, correctAnswer);
  const level = word.level;

  if (correct) {
    const newLevel = sr.applyCorrect(level);
    await db.setLevelAndReview(env, word.id, newLevel, sr.nextReviewISO(newLevel));
    if (sr.isLearned(newLevel)) {
      await sendMessage(env, chatId, `🎉 Верно! Ты <b>выучил</b> слово «${esc(word.word)}». Поздравляю!`);
    } else {
      await sendMessage(
        env, chatId,
        `✅ Верно! Уровень слова «${esc(word.word)}»: ${level} → <b>${newLevel}</b>/${sr.MAX_LEVEL}. Покажу его снова попозже.`
      );
    }
  } else {
    // Ошибка → уровень 0, показать снова скоро (через 10 минут).
    const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await db.setLevelAndReview(env, word.id, sr.applyWrong(), soon);
    await sendMessage(
      env, chatId,
      `❌ Не совсем. Правильный ответ: <b>${esc(correctAnswer)}</b>\n(слово «${esc(word.word)}»)\nНичего страшного — скоро повторим ещё раз 💪`
    );
  }
}

// ------------------- Кнопки -------------------

async function handleCallback(env, cq) {
  await answerCallbackQuery(env, cq.id); // убираем "часики" на кнопке
  const userId = cq.from.id;
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;

  if (!isOwner(env, userId)) return;

  const [action, wordIdStr] = cq.data.split(":");
  const wordId = parseInt(wordIdStr, 10);
  const word = await db.getWord(env, wordId);

  if (!word) {
    await editMessageReplyMarkup(env, chatId, messageId, null);
    await sendMessage(env, chatId, "Это слово уже удалено 🤷");
    return;
  }

  if (action === "plural") {
    const pl = dict.plural(word.word);
    await sendMessage(env, chatId, `🔤 Мн. число: <b>${esc(word.word)}</b> → <b>${esc(pl)}</b>`);
    return;
  }

  if (action === "remember") {
    const newLevel = sr.applyCorrect(word.level);
    await db.setLevelAndReview(env, wordId, newLevel, sr.nextReviewISO(newLevel));
    await editMessageReplyMarkup(env, chatId, messageId, null);
    await sendMessage(env, chatId, `✅ Отметил «${esc(word.word)}» как запомненное (уровень ${newLevel}/${sr.MAX_LEVEL}).`);
  } else if (action === "later") {
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await db.setLevelAndReview(env, wordId, 0, soon);
    await editMessageReplyMarkup(env, chatId, messageId, null);
    await sendMessage(env, chatId, `🔁 Ок, скоро напомню про «${esc(word.word)}».`);
  } else if (action === "delete") {
    await db.deleteWordById(env, wordId);
    await editMessageReplyMarkup(env, chatId, messageId, null);
    await sendMessage(env, chatId, `🗑 Удалил «${esc(word.word)}».`);
  }
}

// ------------------- Проверки (quiz) -------------------

export async function sendQuiz(env, userId, word) {
  // Режим выбираем случайно (чередуем). Если перевода нет — только en2ru.
  const mode = word.translation && Math.random() < 0.5 ? "ru2en" : "en2ru";

  let question;
  if (mode === "en2ru") {
    question =
      "🧠 <b>Проверка!</b>\n\n" +
      `Как переводится слово <b>${esc(word.word)}</b>?\n` +
      "Напиши перевод на русском.";
  } else {
    question = "🧠 <b>Проверка!</b>\n\n" + `Напиши по-английски: <b>${esc(word.translation)}</b>`;
  }

  await db.setPendingQuiz(env, userId, word.id, mode);
  await sendMessage(env, userId, question);
}

// Вызывается по расписанию (Cron Trigger) — аналог check_due_words из Python.
export async function checkDueWords(env) {
  const userIds = await db.allUserIds(env);
  for (const userId of userIds) {
    // Если пользователь ещё не ответил на прошлый вопрос — не шлём новый.
    if (await db.getPendingQuiz(env, userId)) continue;
    const word = await db.getDueWord(env, userId);
    if (word) {
      try {
        await sendQuiz(env, userId, word);
      } catch (e) {
        console.error("Не смог отправить проверку", userId, e);
      }
    }
  }
}

// ------------------- Точка входа для одного обновления -------------------

export async function handleUpdate(env, update) {
  try {
    if (update.callback_query) {
      await handleCallback(env, update.callback_query);
      return;
    }

    const message = update.message;
    if (!message || !message.text) return;

    const userId = message.from.id;
    const chatId = message.chat.id;
    const text = message.text.trim();

    if (!isOwner(env, userId)) {
      await sendMessage(env, chatId, "Извини, этот бот личный 🙈");
      return;
    }

    // Команды начинаются с "/".
    if (text.startsWith("/")) {
      // Разбиваем "/delete streamline" → команда "delete", аргументы "streamline".
      // Учитываем формат "/command@BotName".
      const spaceIdx = text.indexOf(" ");
      let cmd = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);
      cmd = cmd.slice(1).split("@")[0].toLowerCase();

      if (cmd === "start" || cmd === "help") await cmdStart(env, chatId);
      else if (cmd === "list") await cmdList(env, chatId, userId);
      else if (cmd === "stats") await cmdStats(env, chatId, userId);
      else if (cmd === "quiz") await cmdQuiz(env, chatId, userId);
      else if (cmd === "delete") await cmdDelete(env, chatId, userId, args);
      else await sendMessage(env, chatId, "Не знаю такую команду. Напиши /help.");
      return;
    }

    // Не команда: это либо ОТВЕТ на проверку, либо НОВОЕ слово.
    const pending = await db.getPendingQuiz(env, userId);
    if (pending) {
      await handleAnswer(env, chatId, userId, pending, text);
    } else {
      await handleNewWord(env, chatId, userId, text);
    }
  } catch (e) {
    console.error("Ошибка при обработке обновления:", e);
  }
}

// Отправка длинного текста частями (лимит Telegram — 4096 символов).
async function sendLong(env, chatId, text) {
  const limit = 4000;
  const lines = text.split("\n");
  let chunk = "";
  for (const line of lines) {
    if (chunk.length + line.length + 1 > limit) {
      await sendMessage(env, chatId, chunk);
      chunk = "";
    }
    chunk += line + "\n";
  }
  if (chunk.trim()) await sendMessage(env, chatId, chunk);
}
