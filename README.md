# Durak Empire — шпаргалка владельца

Всё лежит в репозитории GitHub `i-field/durak-mini-app`:
- `index.html` — игра (GitHub Pages)
- `welcome.jpg` — картинка в приветствии бота
- `worker/index.js`, `worker/wrangler.toml` — сервер на Cloudflare (деплоится сам при каждом коммите)

## Секреты в Cloudflare (тип Secret!)
`BOT_TOKEN`, `WEBHOOK_SECRET`, и по желанию `ADMIN_ID` (ваш числовой Telegram id из @userinfobot) —
тогда сообщения игроков боту («поддержка») приходят вам в личку.

## После обновления кода
1. Открыть `/health` — должна быть новая версия, `LOBBY: true`.
2. Один раз открыть `/admin/setup?key=СЕКРЕТ` — обновит webhook, кнопку меню и команды бота.

## Что добавить в BotFather
- Edit Bot → Edit Description Picture → `bot-description.jpg` (картинка до нажатия Start).
- Edit Description / Edit About — тексты из чата (RU/EN/UK).

## Видео вместо картинки в приветствии
Загрузите `welcome.mp4` (до ~20 МБ) в репозиторий и уберите `#` у строки `WELCOME_VIDEO` в `worker/wrangler.toml`.

## NFT
В `index.html` найдите `NFT_URL=''` и впишите ссылку на вашу коллекцию на Getgems — кнопка в магазине заработает.
