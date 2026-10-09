# 🖱️ Word Bot — установка ЧИСТО В БРАУЗЕРЕ (без компьютера и терминала)

Этот способ не требует ни Node, ни git, ни терминала. Всё делается мышкой
в панели управления Cloudflare. Нужен только браузер и файл `worker.js`
из этой папки.

> Код тут собран в один файл `worker.js` специально под этот способ
> (онлайн-редактор Cloudflare не умеет ставить npm-библиотеки).

---

## Что приготовить заранее (из блокнота)

1. **BOT_TOKEN** — от [@BotFather](https://t.me/BotFather) (`/newbot`).
2. **OWNER_USER_ID** — твой id от [@userinfobot](https://t.me/userinfobot).
3. **TELEGRAM_WEBHOOK_SECRET** — любая случайная строка, придумай сам
   (например `myWordsBot_8f3kLp92xQ`).
4. Аккаунт на [dash.cloudflare.com](https://dash.cloudflare.com) (бесплатный, карта не нужна).
5. Текст файла **`worker.js`** (открой его на GitHub и нажми «Copy raw file»,
   либо скопируй отсюда из репозитория).

---

## Шаг 1. Создать воркер

1. Зайди на **https://dash.cloudflare.com** → слева **Workers & Pages**.
2. Кнопка **Create** → **Create Worker**.
3. Придумай имя, например `word-bot` → **Deploy** (пока с примером «Hello World»).
4. После деплоя нажми **Edit code** (или **</> Edit**).
5. В редакторе **выдели весь код примера и удали**, затем **вставь весь
   текст из `worker.js`**.
6. Нажми **Deploy** (справа сверху). Код загружен — но он ещё не настроен,
   это сделаем дальше.

---

## Шаг 2. Создать базу данных D1

1. Слева в меню: **Storage & Databases** → **D1 SQL Database**.
2. **Create** → имя `word-bot-db` → **Create**.
3. Открылась база → вкладка **Console** (консоль).
4. Вставь туда весь SQL ниже и нажми **Execute** (выполнить):

```sql
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
CREATE INDEX IF NOT EXISTS idx_words_due ON words (user_id, level, next_review_time);
CREATE TABLE IF NOT EXISTS pending_quiz (
    user_id   INTEGER PRIMARY KEY,
    word_id   INTEGER NOT NULL,
    mode      TEXT    NOT NULL,
    asked_at  TEXT    NOT NULL
);
```

Должно написать, что команды выполнены успешно.

---

## Шаг 3. Привязать базу к воркеру

1. Вернись: **Workers & Pages** → открой свой воркер `word-bot`.
2. Вкладка **Settings** → раздел **Bindings** → **Add** → **D1 database**.
3. Заполни:
   - **Variable name** (имя переменной): `DB`  ← ровно так, большими буквами!
   - **D1 database**: выбери `word-bot-db`.
4. **Deploy / Save**.

---

## Шаг 4. Задать секреты

1. Там же: **Settings** → **Variables and Secrets** → **Add**.
2. Добавь по очереди три штуки. **Type обязательно `Secret`** (не Text):

   | Variable name | Value |
   |---|---|
   | `BOT_TOKEN` | твой токен |
   | `OWNER_USER_ID` | твой id (или `0`, чтобы отвечать всем) |
   | `TELEGRAM_WEBHOOK_SECRET` | твоя случайная строка |

   (по желанию: `DEEPL_API_KEY` — если есть ключ DeepL; иначе не добавляй)
3. После добавления нажми **Deploy**, чтобы секреты применились.

---

## Шаг 5. Включить расписание (Cron) — это замена «проверок в случайное время»

1. **Settings** → **Triggers** (или **Trigger Events**) → **Cron Triggers** → **Add**.
2. Впиши расписание: `*/15 * * * *` (каждые 15 минут). Можно `*/5 * * * *`.
3. **Add / Save**.

> Это заставляет бота каждые N минут проверять базу и присылать слова,
> которым подошло время повторения.

---

## Шаг 6. Подключить webhook (один раз)

1. Узнай адрес воркера: на главной странице воркера он показан сверху,
   вида `https://word-bot.твой-логин.workers.dev`.
2. Собери ссылку: **адрес** + `/registerWebhook?secret=` + **твой секрет**. Пример:
   ```
   https://word-bot.твой-логин.workers.dev/registerWebhook?secret=myWordsBot_8f3kLp92xQ
   ```
3. Вставь её в адресную строку браузера, Enter. Должно показать:
   ```
   { "ok": true, "result": true, "description": "Webhook was set" }
   ```

---

## Шаг 7. Проверить 🎉

1. Открой своего бота в Telegram, нажми **Start**.
2. Пришли слово, например `streamline` — придёт карточка с кнопками.
3. Попробуй `/stats`, `/list`, нажми кнопки.

Готово — бот живёт в облаке Cloudflare 24/7, компьютер не нужен.

---

## Если что-то не так

- **Бот молчит.** Проверь: шаг 6 вернул `"ok": true`? Секреты заданы как
  **Secret** и имена точь-в-точь (`BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`)?
  Биндинг базы называется ровно `DB`?
- **Ошибка про базу / `env.DB`**. Значит не сделан Шаг 3 (привязка D1) или
  имя переменной не `DB`.
- **Посмотреть ошибки вживую.** В воркере вкладка **Logs** → **Begin log
  stream**, и параллельно напиши боту — увидишь, что происходит.
- Застрял — пришли мне скриншот или текст ошибки, разберём.

---

## Обновить код позже

Открыл воркер → **Edit code** → вставил новый текст `worker.js` → **Deploy**.
Секреты, база и расписание при этом сохраняются — их заново настраивать не надо.
