// dictionary.js — получаем данные о слове из интернета.
// Аналог dictionary.py, но на JS: вместо библиотек делаем прямые HTTP-запросы
// через встроенный fetch (он есть в Workers "из коробки").

import pluralize from "pluralize";

const HTTP_TIMEOUT_MS = 8000;

// Небольшой помощник: fetch с таймаутом, чтобы воркер не ждал вечно.
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Перевод на русский: пробуем DeepL (если есть ключ) → Google → MyMemory ---

async function translateDeepL(word, env) {
  if (!env.DEEPL_API_KEY) return "";
  try {
    const resp = await fetchWithTimeout("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        auth_key: env.DEEPL_API_KEY,
        text: word,
        source_lang: "EN",
        target_lang: "RU",
      }),
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    return data?.translations?.[0]?.text || "";
  } catch {
    return "";
  }
}

async function translateGoogle(word) {
  // Бесплатный (неофициальный) endpoint Google Translate, без ключа.
  // Ответ — вложенные массивы; текст перевода лежит в data[0][*][0].
  try {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx" +
      "&sl=en&tl=ru&dt=t&q=" + encodeURIComponent(word);
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return "";
    const data = await resp.json();
    if (!Array.isArray(data?.[0])) return "";
    return data[0].map((seg) => seg[0]).join("");
  } catch {
    return "";
  }
}

async function translateMyMemory(word) {
  // Запасной бесплатный сервис без ключа.
  try {
    const url =
      "https://api.mymemory.translated.net/get?langpair=en|ru&q=" +
      encodeURIComponent(word);
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return "";
    const data = await resp.json();
    return data?.responseData?.translatedText || "";
  } catch {
    return "";
  }
}

// Встроенный ИИ-переводчик Cloudflare (Workers AI) — работает на серверах
// Cloudflare без внешних лимитов. Требует привязку Workers AI (переменная AI).
async function translateWorkersAI(word, env) {
  if (!env.AI) return "";
  try {
    const r = await env.AI.run("@cf/meta/m2m100-1.2b", {
      text: word, source_lang: "english", target_lang: "russian",
    });
    return r?.translated_text || "";
  } catch {
    return "";
  }
}

export async function translateToRussian(word, env) {
  return (
    (await translateDeepL(word, env)) ||
    (await translateWorkersAI(word, env)) ||
    (await translateGoogle(word)) ||
    (await translateMyMemory(word)) ||
    ""
  );
}

// --- Транскрипция, определение, пример из Free Dictionary API ---

async function fetchFreeDictionary(word) {
  const result = { phonetic: "", definition: "", example: "", found: false };
  try {
    const resp = await fetchWithTimeout(
      "https://api.dictionaryapi.dev/api/v2/entries/en/" + encodeURIComponent(word)
    );
    if (resp.status === 404) return result; // слова нет в словаре — это нормально
    if (!resp.ok) return result;
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return result;

    const entry = data[0];
    result.found = true;

    // Транскрипция
    result.phonetic = entry.phonetic || "";
    if (!result.phonetic && Array.isArray(entry.phonetics)) {
      for (const ph of entry.phonetics) {
        if (ph.text) { result.phonetic = ph.text; break; }
      }
    }

    // Определение и пример (берём первые попавшиеся)
    for (const meaning of entry.meanings || []) {
      for (const d of meaning.definitions || []) {
        if (!result.definition && d.definition) result.definition = d.definition;
        if (!result.example && d.example) result.example = d.example;
        if (result.definition && result.example) break;
      }
      if (result.definition && result.example) break;
    }
    return result;
  } catch {
    return result;
  }
}

// Собираем всё о слове в один объект.
export async function lookup(word, env) {
  word = word.trim();
  // Запускаем оба запроса параллельно — так быстрее.
  const [info, translation] = await Promise.all([
    fetchFreeDictionary(word),
    translateToRussian(word, env),
  ]);
  return {
    word,
    phonetic: info.phonetic,
    translation,
    definition: info.definition,
    example: info.example,
    found: info.found,
  };
}

// Множественное число (car → cars, city → cities). Пакет pluralize знает
// правила английского и исключения (child → children).
export function plural(word) {
  return pluralize.plural(word.trim());
}
