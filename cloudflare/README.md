# ☁️ Word Bot на Cloudflare Workers

Та же логика, что и в Python-версии (из корня репозитория), но работает
**24/7 без твоего компьютера** и бесплатно — на serverless-платформе Cloudflare.

**Чем отличается от Python-версии:**

| Python (локально) | Cloudflare Workers |
|---|---|
| polling (бот сам опрашивает Telegram) | **webhook** (Telegram шлёт обновления нам) |
| JobQueue внутри процесса | **Cron Trigger** (расписание Cloudflare) |
| файл `words.db` (SQLite) | **D1** (SQLite в облаке Cloudflare) |
| `.env` + python-dotenv | **Secrets** (`wrangler secret put`) |
| `inflect` | npm-пакет `pluralize` |

---

## Что понадобится

1. Аккаунт на [cloudflare.com](https://dash.cloudflare.com/sign-up) (бесплатный).
2. Установленный [Node.js](https://nodejs.org) (LTS).
3. Токен бота от [@BotFather](https://t.me/BotFather) и твой user_id от
   [@userinfobot](https://t.me/userinfobot).

Бесплатного тарифа Cloudflare с запасом хватает: Workers — 100 000 запросов в
день, D1 — 5 ГБ, Cron Triggers — бесплатно.

---

## Деплой за 8 шагов

Все команды выполняются **внутри папки `cloudflare/`**.

### 1. Установить зависимости
```bash
cd cloudflare
npm install
```
Это поставит `wrangler` (утилита Cloudflare) и `pluralize`.

### 2. Войти в Cloudflare
```bash
npx wrangler login
```
Откроется браузер — подтверди доступ.

### 3. Создать базу D1
```bash
npx wrangler d1 create word-bot-db
```
Команда напечатает блок с `database_id = "..."`. **Скопируй этот id** и впиши
его в `wrangler.toml` вместо `ВПИШИ_СЮДА_ID_БАЗЫ_D1`.

### 4. Создать таблицы в базе
```bash
npm run db:init
```
(под капотом: `wrangler d1 execute word-bot-db --remote --file=./schema.sql`)

### 5. Задать секреты
Каждая команда спросит значение и спрячет его в Cloudflare Secrets:
```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put OWNER_USER_ID          # твой id (или 0 для всех)
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET # любая случайная строка
# по желанию:
npx wrangler secret put DEEPL_API_KEY
```
> Придумай `TELEGRAM_WEBHOOK_SECRET` сам — например длинный случайный набор
> букв и цифр. Это пароль, которым мы проверяем, что запрос реально от Telegram.

### 6. Задеплоить воркер
```bash
npm run deploy
```
В конце wrangler напечатает адрес воркера, например:
`https://word-bot.ТВОЙ-АккАунт.workers.dev`

### 7. Подключить webhook
Открой в браузере (подставь свой адрес и свой секрет из шага 5):
```
https://word-bot.ТВОЙ-АккАунт.workers.dev/registerWebhook?secret=ТВОЙ_TELEGRAM_WEBHOOK_SECRET
```
Должно вернуться `{"ok": true, "result": true, "description": "Webhook was set"}`.

### 8. Проверить
Напиши своему боту в Telegram английское слово — придёт карточка с кнопками 🎉
Проверки по расписанию пойдут сами (по умолчанию каждые 15 минут бот смотрит,
кому пора повторять).

---

## Полезные команды

```bash
npx wrangler tail          # смотреть логи воркера в реальном времени
npm run deploy             # выкатить изменения кода
npx wrangler d1 execute word-bot-db --remote --command "SELECT * FROM words"
```

Поменять частоту проверок — в `wrangler.toml`, строка `crons`
(`"*/5 * * * *"` = каждые 5 минут), затем `npm run deploy`.

---

## Локальный запуск для теста (необязательно)

```bash
cp .dev.vars.example .dev.vars   # впиши туда токен и секрет
npx wrangler dev
```
Но для приёма сообщений от Telegram всё равно нужен публичный адрес
(webhook), поэтому проще сразу деплоить в облако.

---

## Как устроен код (файлы в `src/`)

| Файл | Отвечает за | Аналог в Python |
|------|-------------|-----------------|
| `index.js` | Вход: приём webhook и запуск по расписанию | `bot.py` (main) |
| `handlers.js` | Команды, кнопки, проверки, карточки | обработчики из `bot.py` |
| `db.js` | База D1 | `db.py` |
| `dictionary.js` | Перевод, определение, мн. число | `dictionary.py` |
| `spacedRepetition.js` | Уровни и интервалы | `spaced_repetition.py` |
| `textUtils.js` | Сравнение ответа (опечатки) | `text_utils.py` |
| `telegram.js` | Запросы к Telegram API | (делала библиотека) |
