// dictionary.js — умный словарь через Claude (Anthropic API) + множественное число.
//
// Один запрос к Claude возвращает транскрипцию, перевод, смысл идиомы,
// определение и пример. Нужен секрет ANTHROPIC_API_KEY; модель задаётся
// секретом CLAUDE_MODEL (по умолчанию claude-sonnet-5-5).

import pluralize from "pluralize";

async function askClaude(word, env) {
  const empty = { phonetic: "", translation: "", definition: "", example: "", note: "" };
  if (!env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY не задан — добавь секрет в настройках воркера.");
    return empty;
  }
  const system =
    "Ты — англо-русский учебный словарь для студента, который готовится к Duolingo English Test. " +
    "По английскому слову или фразе ответь СТРОГО в этом формате — каждое поле с новой строки, без markdown и лишнего текста:\n" +
    "PHONETIC: <транскрипция IPA в слешах, например /ˈstriːmlaɪn/; если не уверен — оставь пустым>\n" +
    "TRANSLATION: <перевод на русский в начальной форме; для идиом и фраз передай СМЫСЛ, а не дословно>\n" +
    "NOTE: <по-русски кратко объясни смысл и когда так говорят, если это идиома/устойчивое выражение или есть важный нюанс; если обычное слово — поставь прочерк ->\n" +
    "DEFINITION: <короткое простое определение на английском>\n" +
    "EXAMPLE: <одно короткое естественное предложение-пример на английском>";
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || "claude-sonnet-5-5",
        max_tokens: 600,
        system,
        messages: [{ role: "user", content: word }],
      }),
    });
    if (!resp.ok) {
      console.error("Anthropic API error:", resp.status, (await resp.text()).slice(0, 300));
      return empty;
    }
    const data = await resp.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const pick = (key) => {
      const m = text.match(new RegExp("^\\s*" + key + "\\s*:?\\s*(.+)$", "mi"));
      return m ? m[1].trim() : "";
    };
    let note = pick("NOTE");
    if (note === "-" || note === "—" || note.toLowerCase() === "none") note = "";
    return {
      phonetic: pick("PHONETIC"),
      translation: pick("TRANSLATION"),
      note,
      definition: pick("DEFINITION"),
      example: pick("EXAMPLE"),
    };
  } catch (e) {
    console.error("askClaude failed:", e && e.message ? e.message : String(e));
    return empty;
  }
}

export async function lookup(word, env) {
  word = word.trim();
  const ai = await askClaude(word, env);
  return {
    word,
    phonetic: ai.phonetic,
    translation: ai.translation,
    definition: ai.definition,
    example: ai.example,
    note: ai.note,
    found: !!(ai.translation || ai.definition),
  };
}

// Множественное число (car → cars, child → children) — офлайн, через pluralize.
export function plural(word) {
  return pluralize.plural(word.trim());
}
