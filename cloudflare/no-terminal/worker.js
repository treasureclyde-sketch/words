// =============================================================================
//  WORD BOT — ОДНОФАЙЛОВАЯ ВЕРСИЯ ДЛЯ ВСТАВКИ В ПАНЕЛЬ CLOUDFLARE (без терминала)
// =============================================================================
//
//  Это та же логика, что в папке src/, но собранная в один файл и без внешних
//  библиотек — чтобы можно было просто вставить её в онлайн-редактор Cloudflare
//  и нажать Deploy. Как это сделать по шагам — см. no-terminal/README.md.
//
//  Что нужно настроить в панели (инструкция в README):
//    • Binding (привязка) базы D1 с именем  DB
//    • Секреты:  BOT_TOKEN,  OWNER_USER_ID,  TELEGRAM_WEBHOOK_SECRET
//    • (необязательно)  DEEPL_API_KEY
//    • Cron Trigger (расписание), например  */15 * * * *
// =============================================================================


// ------------------------- Интервальное повторение -------------------------

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Интервалы для уровней 0..4 (индекс = уровень).
const INTERVALS_MS = [1 * HOUR, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY];
const MAX_LEVEL = INTERVALS_MS.length; // = 5

function nextIntervalMs(level) {
  if (level < 0) level = 0;
  if (level >= INTERVALS_MS.length) return INTERVALS_MS[INTERVALS_MS.length - 1];
  return INTERVALS_MS[level];
}
function nextReviewISO(level) {
  return new Date(Date.now() + nextIntervalMs(level)).toISOString();
}
function applyCorrect(level) { return Math.min(level + 1, MAX_LEVEL); }
function applyWrong() { return 0; }
function isLearned(level) { return level >= MAX_LEVEL; }


// ------------------------- Сравнение ответов -------------------------

function normalize(text) {
  if (!text) return "";
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}
function allowedTypos(length) {
  if (length <= 4) return 0;
  if (length <= 7) return 1;
  return 2;
}
function isCorrect(userAnswer, correctAnswer) {
  const user = normalize(userAnswer);
  if (!user) return false;
  for (const variant of (correctAnswer || "").split(/[,;/|]/)) {
    const target = normalize(variant);
    if (!target) continue;
    if (user === target) return true;
    const allowed = allowedTypos(Math.max(user.length, target.length));
    if (allowed > 0 && levenshtein(user, target) <= allowed) return true;
  }
  return false;
}


// ------------------------- Множественное число (своя функция) -------------------------
// Заменяет библиотеку pluralize. Покрывает основные правила английского и частые
// исключения. Для учебного бота этого достаточно.

const PLURAL_IRREGULAR = {
  man: "men", woman: "women", child: "children", person: "people",
  tooth: "teeth", foot: "feet", mouse: "mice", goose: "geese",
  ox: "oxen", cactus: "cacti", focus: "foci", datum: "data",
  die: "dice", penny: "pence",
};
// Слова, которые во множественном числе не меняются.
const PLURAL_SAME = new Set([
  "sheep", "fish", "deer", "series", "species", "aircraft", "salmon", "news", "information",
]);

function pluralOf(word) {
  const w = word.trim();
  const lower = w.toLowerCase();
  if (PLURAL_SAME.has(lower)) return w;
  if (PLURAL_IRREGULAR[lower]) return PLURAL_IRREGULAR[lower];

  // analysis → analyses, crisis → crises
  if (lower.endsWith("sis")) return w.slice(0, -3) + "ses";
  // -s, -x, -z, -ch, -sh  →  +es   (bus→buses, box→boxes, church→churches)
  if (/(s|x|z|ch|sh)$/.test(lower)) return w + "es";
  // согласная + y  →  -y + ies   (city→cities), гласная + y  →  +s (day→days)
  if (/[^aeiou]y$/.test(lower)) return w.slice(0, -1) + "ies";
  // -fe → -ves (knife→knives);  некоторые -f → -ves (leaf→leaves)
  if (lower.endsWith("fe")) return w.slice(0, -2) + "ves";
  if (/(leaf|loaf|half|calf|wolf|shelf|thief|self)$/.test(lower)) return w.slice(0, -1) + "ves";
  // частые -o → -oes
  if (/(tomato|potato|hero|echo|veto|torpedo)$/.test(lower)) return w + "es";
  // по умолчанию просто +s
  return w + "s";
}


// ------------------------- Словарь (перевод + определение) -------------------------

const HTTP_TIMEOUT_MS = 8000;
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function translateDeepL(word, env) {
  if (!env.DEEPL_API_KEY) return "";
  try {
    const resp = await fetchWithTimeout("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ auth_key: env.DEEPL_API_KEY, text: word, source_lang: "EN", target_lang: "RU" }),
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    return data?.translations?.[0]?.text || "";
  } catch { return ""; }
}
async function translateGoogle(word) {
  try {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ru&dt=t&q=" + encodeURIComponent(word);
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return "";
    const data = await resp.json();
    if (!Array.isArray(data?.[0])) return "";
    return data[0].map((seg) => seg[0]).join("");
  } catch { return ""; }
}
async function translateMyMemory(word) {
  try {
    const url = "https://api.mymemory.translated.net/get?langpair=en|ru&q=" + encodeURIComponent(word);
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return "";
    const data = await resp.json();
    return data?.responseData?.translatedText || "";
  } catch { return ""; }
}
// Встроенный ИИ-переводчик Cloudflare (Workers AI). Работает на серверах
// Cloudflare, без внешних лимитов — самый надёжный вариант отсюда.
// Требует привязку Workers AI с именем переменной  AI  (см. README).
async function translateWorkersAI(word, env) {
  if (!env.AI) return "";
  try {
    const r = await env.AI.run("@cf/meta/m2m100-1.2b", {
      text: word, source_lang: "english", target_lang: "russian",
    });
    return r?.translated_text || "";
  } catch (e) {
    console.error("Workers AI translate failed:", e);
    return "";
  }
}
async function translateToRussian(word, env) {
  // Порядок: DeepL (если есть ключ) → встроенный ИИ Cloudflare → Google → MyMemory.
  return (await translateDeepL(word, env))
    || (await translateWorkersAI(word, env))
    || (await translateGoogle(word))
    || (await translateMyMemory(word))
    || "";
}
async function fetchFreeDictionary(word) {
  const result = { phonetic: "", definition: "", example: "", found: false };
  try {
    const resp = await fetchWithTimeout("https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word));
    if (resp.status === 404 || !resp.ok) return result;
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return result;
    const entry = data[0];
    result.found = true;
    result.phonetic = entry.phonetic || "";
    if (!result.phonetic && Array.isArray(entry.phonetics)) {
      for (const ph of entry.phonetics) { if (ph.text) { result.phonetic = ph.text; break; } }
    }
    for (const meaning of entry.meanings || []) {
      for (const d of meaning.definitions || []) {
        if (!result.definition && d.definition) result.definition = d.definition;
        if (!result.example && d.example) result.example = d.example;
        if (result.definition && result.example) break;
      }
      if (result.definition && result.example) break;
    }
    return result;
  } catch { return result; }
}
async function lookup(word, env) {
  word = word.trim();
  const [info, translation] = await Promise.all([fetchFreeDictionary(word), translateToRussian(word, env)]);
  return { word, phonetic: info.phonetic, translation, definition: info.definition, example: info.example, found: info.found };
}


// ------------------------- База данных D1 -------------------------

const nowISO = () => new Date().toISOString();

async function addWord(env, userId, word, translation, definition, example) {
  const r = await env.DB.prepare(
    `INSERT INTO words (user_id, word, translation, definition, example, level, next_review_time, date_added)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
  ).bind(userId, word, translation, definition, example, nextReviewISO(0), nowISO()).run();
  return r.meta.last_row_id;
}
const getWord = (env, id) => env.DB.prepare(`SELECT * FROM words WHERE id = ?`).bind(id).first();
const getWordByText = (env, userId, word) =>
  env.DB.prepare(`SELECT * FROM words WHERE user_id = ? AND LOWER(word) = LOWER(?)`).bind(userId, word).first();
async function listWords(env, userId) {
  const { results } = await env.DB.prepare(`SELECT * FROM words WHERE user_id = ? ORDER BY date_added DESC`).bind(userId).all();
  return results || [];
}
async function deleteWordById(env, id) {
  await env.DB.prepare(`DELETE FROM words WHERE id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM pending_quiz WHERE word_id = ?`).bind(id).run();
}
async function deleteWordByText(env, userId, word) {
  const r = await env.DB.prepare(`DELETE FROM words WHERE user_id = ? AND LOWER(word) = LOWER(?)`).bind(userId, word).run();
  return r.meta.changes > 0;
}
const setLevelAndReview = (env, id, level, iso) =>
  env.DB.prepare(`UPDATE words SET level = ?, next_review_time = ? WHERE id = ?`).bind(level, iso, id).run();
const getDueWord = (env, userId) =>
  env.DB.prepare(`SELECT * FROM words WHERE user_id = ? AND level < ? AND next_review_time <= ? ORDER BY RANDOM() LIMIT 1`)
    .bind(userId, MAX_LEVEL, nowISO()).first();
const getAnyWordForQuiz = (env, userId) =>
  env.DB.prepare(`SELECT * FROM words WHERE user_id = ? AND level < ? ORDER BY RANDOM() LIMIT 1`).bind(userId, MAX_LEVEL).first();
async function getStats(env, userId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN level >= ? THEN 1 ELSE 0 END) AS learned FROM words WHERE user_id = ?`
  ).bind(MAX_LEVEL, userId).first();
  const total = row?.total || 0, learned = row?.learned || 0;
  return { total, learned, in_review: total - learned };
}
async function allUserIds(env) {
  const { results } = await env.DB.prepare(`SELECT DISTINCT user_id FROM words`).all();
  return (results || []).map((r) => r.user_id);
}
const setPendingQuiz = (env, userId, wordId, mode) =>
  env.DB.prepare(
    `INSERT INTO pending_quiz (user_id, word_id, mode, asked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET word_id=excluded.word_id, mode=excluded.mode, asked_at=excluded.asked_at`
  ).bind(userId, wordId, mode, nowISO()).run();
const getPendingQuiz = (env, userId) => env.DB.prepare(`SELECT * FROM pending_quiz WHERE user_id = ?`).bind(userId).first();
const clearPendingQuiz = (env, userId) => env.DB.prepare(`DELETE FROM pending_quiz WHERE user_id = ?`).bind(userId).run();


// ------------------------- Telegram API -------------------------

async function tgCall(env, method, payload) {
  const resp = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!data.ok) console.error("Telegram API error:", method, JSON.stringify(data));
  return data;
}
const sendMessage = (env, chatId, text, extra = {}) =>
  tgCall(env, "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
const answerCallbackQuery = (env, id, text = "") => tgCall(env, "answerCallbackQuery", { callback_query_id: id, text });
const editMessageReplyMarkup = (env, chatId, messageId, replyMarkup = null) =>
  tgCall(env, "editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });
const sendChatAction = (env, chatId, action = "typing") => tgCall(env, "sendChatAction", { chat_id: chatId, action });
const setWebhook = (env, url, secret) =>
  tgCall(env, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "callback_query"] });


// ------------------------- Логика бота -------------------------

function esc(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function isOwner(env, userId) {
  const owner = (env.OWNER_USER_ID || "0").toString().trim();
  if (owner === "0" || owner === "") return true;
  return String(userId) === owner;
}
function buildWordCard(info) {
  const lines = [];
  let head = `🇬🇧 <b>${esc(info.word)}</b>`;
  if (info.phonetic) head += `  <code>${esc(info.phonetic)}</code>`;
  lines.push(head);
  if (info.translation) lines.push(`🇷🇺 ${esc(info.translation)}`);
  if (info.definition) lines.push(`\n📖 <i>${esc(info.definition)}</i>`);
  if (info.example) lines.push(`✏️ <i>${esc(info.example)}</i>`);
  if (!info.found) lines.push(`\n<i>(нет в англ. словаре — показываю только перевод)</i>`);
  return lines.join("\n");
}
function buildKeyboard(wordId) {
  return {
    inline_keyboard: [
      [{ text: "✅ Запомнил", callback_data: `remember:${wordId}` }, { text: "🔁 Повторить позже", callback_data: `later:${wordId}` }],
      [{ text: "❌ Удалить", callback_data: `delete:${wordId}` }, { text: "🔤 Мн. число", callback_data: `plural:${wordId}` }],
    ],
  };
}

const HELP_TEXT =
  "Привет! Я помогу учить английские слова 📚\n\n" +
  "• Просто пришли мне английское слово — я дам перевод, определение и пример.\n" +
  "• Нажми кнопку, чтобы сохранить слово в свою базу.\n" +
  "• Я сам буду в случайное время проверять тебя по сохранённым словам.\n\n" +
  "Команды:\n/list — все мои слова\n/stats — статистика\n/quiz — проверка прямо сейчас\n/delete слово — удалить слово\n/help — помощь";

async function sendLong(env, chatId, text) {
  const limit = 4000;
  let chunk = "";
  for (const line of text.split("\n")) {
    if (chunk.length + line.length + 1 > limit) { await sendMessage(env, chatId, chunk); chunk = ""; }
    chunk += line + "\n";
  }
  if (chunk.trim()) await sendMessage(env, chatId, chunk);
}

async function handleNewWord(env, chatId, userId, word) {
  if (/[а-яА-ЯёЁ]/.test(word)) {
    await sendMessage(env, chatId, "Кажется, это русское слово 🙂 Пришли, пожалуйста, английское.");
    return;
  }
  const existing = await getWordByText(env, userId, word);
  if (existing) {
    await sendMessage(env, chatId, `«${esc(word)}» уже есть в твоей базе 👍 (уровень ${existing.level}/${MAX_LEVEL})`);
    return;
  }
  await sendChatAction(env, chatId, "typing");
  const info = await lookup(word, env);
  if (!info.translation && !info.found) {
    await sendMessage(env, chatId, "Не смог найти перевод 😔 Проверь написание или попробуй позже.");
    return;
  }
  const wordId = await addWord(env, userId, info.word, info.translation, info.definition, info.example);
  await sendMessage(env, chatId, buildWordCard(info), { reply_markup: buildKeyboard(wordId) });
}

async function handleAnswer(env, chatId, userId, pending, userAnswer) {
  const word = await getWord(env, pending.word_id);
  if (!word) { await clearPendingQuiz(env, userId); await sendMessage(env, chatId, "Это слово уже удалено 🤷"); return; }
  const correctAnswer = pending.mode === "en2ru" ? word.translation : word.word;
  await clearPendingQuiz(env, userId);
  const correct = isCorrect(userAnswer, correctAnswer);
  const level = word.level;
  if (correct) {
    const newLevel = applyCorrect(level);
    await setLevelAndReview(env, word.id, newLevel, nextReviewISO(newLevel));
    if (isLearned(newLevel)) {
      await sendMessage(env, chatId, `🎉 Верно! Ты <b>выучил</b> слово «${esc(word.word)}». Поздравляю!`);
    } else {
      await sendMessage(env, chatId, `✅ Верно! Уровень слова «${esc(word.word)}»: ${level} → <b>${newLevel}</b>/${MAX_LEVEL}. Покажу его снова попозже.`);
    }
  } else {
    const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await setLevelAndReview(env, word.id, applyWrong(), soon);
    await sendMessage(env, chatId, `❌ Не совсем. Правильный ответ: <b>${esc(correctAnswer)}</b>\n(слово «${esc(word.word)}»)\nНичего страшного — скоро повторим ещё раз 💪`);
  }
}

async function handleCallback(env, cq) {
  await answerCallbackQuery(env, cq.id);
  const userId = cq.from.id, chatId = cq.message.chat.id, messageId = cq.message.message_id;
  if (!isOwner(env, userId)) return;
  const [action, wordIdStr] = cq.data.split(":");
  const wordId = parseInt(wordIdStr, 10);
  const word = await getWord(env, wordId);
  if (!word) { await editMessageReplyMarkup(env, chatId, messageId, null); await sendMessage(env, chatId, "Это слово уже удалено 🤷"); return; }

  if (action === "plural") {
    await sendMessage(env, chatId, `🔤 Мн. число: <b>${esc(word.word)}</b> → <b>${esc(pluralOf(word.word))}</b>`);
  } else if (action === "remember") {
    const newLevel = applyCorrect(word.level);
    await setLevelAndReview(env, wordId, newLevel, nextReviewISO(newLevel));
    await editMessageReplyMarkup(env, chatId, messageId, null);
    await sendMessage(env, chatId, `✅ Отметил «${esc(word.word)}» как запомненное (уровень ${newLevel}/${MAX_LEVEL}).`);
  } else if (action === "later") {
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await setLevelAndReview(env, wordId, 0, soon);
    await editMessageReplyMarkup(env, chatId, messageId, null);
    await sendMessage(env, chatId, `🔁 Ок, скоро напомню про «${esc(word.word)}».`);
  } else if (action === "delete") {
    await deleteWordById(env, wordId);
    await editMessageReplyMarkup(env, chatId, messageId, null);
    await sendMessage(env, chatId, `🗑 Удалил «${esc(word.word)}».`);
  }
}

async function sendQuiz(env, userId, word) {
  const mode = word.translation && Math.random() < 0.5 ? "ru2en" : "en2ru";
  const question = mode === "en2ru"
    ? `🧠 <b>Проверка!</b>\n\nКак переводится слово <b>${esc(word.word)}</b>?\nНапиши перевод на русском.`
    : `🧠 <b>Проверка!</b>\n\nНапиши по-английски: <b>${esc(word.translation)}</b>`;
  await setPendingQuiz(env, userId, word.id, mode);
  await sendMessage(env, userId, question);
}

async function checkDueWords(env) {
  for (const userId of await allUserIds(env)) {
    if (await getPendingQuiz(env, userId)) continue;
    const word = await getDueWord(env, userId);
    if (word) { try { await sendQuiz(env, userId, word); } catch (e) { console.error("quiz send failed", userId, e); } }
  }
}

async function handleUpdate(env, update) {
  try {
    if (update.callback_query) { await handleCallback(env, update.callback_query); return; }
    const message = update.message;
    if (!message || !message.text) return;
    const userId = message.from.id, chatId = message.chat.id, text = message.text.trim();
    if (!isOwner(env, userId)) { await sendMessage(env, chatId, "Извини, этот бот личный 🙈"); return; }

    if (text.startsWith("/")) {
      const spaceIdx = text.indexOf(" ");
      let cmd = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);
      cmd = cmd.slice(1).split("@")[0].toLowerCase();
      if (cmd === "start" || cmd === "help") await sendMessage(env, chatId, HELP_TEXT);
      else if (cmd === "list") {
        const words = await listWords(env, userId);
        if (words.length === 0) { await sendMessage(env, chatId, "База пока пустая. Пришли мне английское слово, чтобы начать 🙂"); return; }
        const lines = ["<b>Мои слова:</b>\n"];
        for (const w of words) {
          const badge = isLearned(w.level) ? "✅ выучено" : w.level === 0 ? "🔴 новое" : `🟡 ур. ${w.level}/${MAX_LEVEL}`;
          lines.push(`• <b>${esc(w.word)}</b> — ${esc(w.translation || "—")}  [${badge}]`);
        }
        await sendLong(env, chatId, lines.join("\n"));
      }
      else if (cmd === "stats") {
        const s = await getStats(env, userId);
        await sendMessage(env, chatId, `📊 <b>Статистика</b>\n\nВсего слов: <b>${s.total}</b>\nВыучено: <b>${s.learned}</b>\nНа повторении: <b>${s.in_review}</b>`);
      }
      else if (cmd === "quiz") {
        await clearPendingQuiz(env, userId);
        const word = await getAnyWordForQuiz(env, userId);
        if (!word) { await sendMessage(env, chatId, "Нет слов для проверки 🤷 Добавь слова или ты уже всё выучил!"); return; }
        await sendQuiz(env, userId, word);
      }
      else if (cmd === "delete") {
        const w = args.trim();
        if (!w) { await sendMessage(env, chatId, "Напиши, что удалить. Пример: <code>/delete streamline</code>"); return; }
        const deleted = await deleteWordByText(env, userId, w);
        await sendMessage(env, chatId, deleted ? `Удалил «${esc(w)}» 🗑` : `Слова «${esc(w)}» нет в базе.`);
      }
      else await sendMessage(env, chatId, "Не знаю такую команду. Напиши /help.");
      return;
    }

    const pending = await getPendingQuiz(env, userId);
    if (pending) await handleAnswer(env, chatId, userId, pending, text);
    else await handleNewWord(env, chatId, userId, text);
  } catch (e) {
    console.error("handleUpdate error:", e);
  }
}


// ------------------------- Точка входа воркера -------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      ctx.waitUntil(handleUpdate(env, update));
      return new Response("ok");
    }

    if (url.pathname === "/registerWebhook") {
      if (url.searchParams.get("secret") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const result = await setWebhook(env, `${url.origin}/webhook`, env.TELEGRAM_WEBHOOK_SECRET);
      return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("Word bot is running 🤖");
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkDueWords(env));
  },
};
