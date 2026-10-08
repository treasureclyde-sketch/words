// index.js — точка входа воркера Cloudflare.
// У воркера два "входа":
//   fetch(...)     — когда приходит HTTP-запрос (Telegram шлёт сюда обновления);
//   scheduled(...) — когда срабатывает Cron Trigger (наши проверки по расписанию).

import { handleUpdate, checkDueWords } from "./handlers.js";
import { setWebhook } from "./telegram.js";

export default {
  // ---- Входящие HTTP-запросы ----
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) Telegram присылает обновления сюда (POST /webhook).
    if (url.pathname === "/webhook" && request.method === "POST") {
      // Проверяем секретный заголовок — чтобы к нам не стучался чужой.
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }

      const update = await request.json();
      // Отвечаем Telegram "ok" СРАЗУ, а обработку доделываем в фоне.
      // ctx.waitUntil продлевает жизнь воркеру, пока фоновая задача не закончится.
      ctx.waitUntil(handleUpdate(env, update));
      return new Response("ok");
    }

    // 2) Удобный разовый вызов из браузера, чтобы ЗАРЕГИСТРИРОВАТЬ webhook:
    //    https://<твой-воркер>.workers.dev/registerWebhook?secret=<TELEGRAM_WEBHOOK_SECRET>
    if (url.pathname === "/registerWebhook") {
      if (url.searchParams.get("secret") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const webhookUrl = `${url.origin}/webhook`;
      const result = await setWebhook(env, webhookUrl, env.TELEGRAM_WEBHOOK_SECRET);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3) Любой другой запрос — просто признак жизни.
    return new Response("Word bot is running 🤖");
  },

  // ---- Запуск по расписанию (Cron Trigger) ----
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkDueWords(env));
  },
};
