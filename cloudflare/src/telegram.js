// telegram.js — общение с Telegram через его HTTP API.
// В Python за нас это делала библиотека python-telegram-bot. Здесь мы шлём
// запросы сами: любой метод Telegram — это POST на
//   https://api.telegram.org/bot<ТОКЕН>/<метод>
// с JSON-телом.

async function callApi(env, method, payload) {
  const resp = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  const data = await resp.json();
  if (!data.ok) {
    // Логи воркера видно командой `wrangler tail`.
    console.error("Ошибка Telegram API:", method, JSON.stringify(data));
  }
  return data;
}

export function sendMessage(env, chatId, text, extra = {}) {
  return callApi(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

export function answerCallbackQuery(env, callbackQueryId, text = "") {
  return callApi(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export function editMessageReplyMarkup(env, chatId, messageId, replyMarkup = null) {
  return callApi(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup, // null — убрать кнопки
  });
}

export function sendChatAction(env, chatId, action = "typing") {
  return callApi(env, "sendChatAction", { chat_id: chatId, action });
}

// Зарегистрировать webhook: сказать Telegram, куда присылать обновления.
export function setWebhook(env, url, secretToken) {
  return callApi(env, "setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
  });
}
