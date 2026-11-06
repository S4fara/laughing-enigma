# Бот-облако для плеера

Telegram-бот принимает ваши mp3, а Cloudflare Worker хранит список треков и плейлисты и отдаёт файлы плееру.
Всё работает на бесплатных тарифах (Cloudflare Workers + D1, Telegram Bot API).

Нужен Node.js (он у вас уже есть). Команды ниже выполняйте в папке `worker`.

## 1. Создайте бота в Telegram
Откройте @BotFather → `/newbot` → придумайте имя. Скопируйте **токен бота** (длинная строка с двоеточием).

## 2. Аккаунт Cloudflare
Зарегистрируйтесь на https://dash.cloudflare.com (бесплатно).

## 3. Установка и вход
```
npm install
npx wrangler login
```

## 4. База данных
```
npx wrangler d1 create player-db
```
В ответе будет `database_id`. Вставьте его в `wrangler.toml` вместо `ПОДСТАВЬТЕ_ID_ИЗ_ШАГА_4`. Затем создайте таблицы:
```
npx wrangler d1 execute player-db --remote --file=schema.sql
```

## 5. Первый деплой
```
npx wrangler deploy
```
Wrangler может предложить выбрать поддомен `workers.dev`, согласитесь. В конце появится адрес вида
`https://player-bot.<ваш-поддомен>.workers.dev`: это **адрес сервера**, он понадобится в плеере.

## 6. Секреты
Придумайте два случайных значения (можно сгенерировать командой
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`):
- `APP_TOKEN`: пароль для плеера. Никому его не показывайте.
- `WEBHOOK_SECRET`: служебный секрет для Telegram (только буквы и цифры).

Сохраните секреты (каждая команда попросит ввести значение):
```
npx wrangler secret put BOT_TOKEN
npx wrangler secret put APP_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put OWNER_ID
```
Для `OWNER_ID` пока введите `0`, настоящий номер узнаем на шаге 8.

## 7. Подключите бота к серверу
Откройте в браузере:
```
https://player-bot.<ваш-поддомен>.workers.dev/setup?token=ВАШ_APP_TOKEN
```
Должно вернуться `"ok":true`.

## 8. Ваш Telegram ID
Напишите боту любое сообщение. Он ответит «Это личный бот. Ваш Telegram ID: 123456789».
Сохраните этот номер:
```
npx wrangler secret put OWNER_ID
```
После этого бот отвечает только вам.

## 9. Проверка
Отправьте боту mp3. Под файлом появится реакция 👍. Затем в плеере откройте вкладку **«Облако»**,
введите адрес сервера и `APP_TOKEN`.

## Команды бота
- подпись к файлу `#Название` добавляет трек в плейлист (пробелы заменяйте на `_`: `#Моя_дорога`)
- `/playlist Название`: все следующие треки идут в этот плейлист; `/playlist off`: выключить
- `/playlists`, `/stats`, `/help`

## Важно
- Бот отдаёт файлы до 20 МБ (ограничение Telegram).
- Telegram хранит файлы, но вечности не гарантирует. Оригиналы лучше держать у себя.
- Если сменили домен приложения, поправьте `ALLOWED_ORIGIN` в `wrangler.toml` и выполните `npx wrangler deploy`.
