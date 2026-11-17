# AGENTS — x2ai-voice-avatar

Плагин-компаньон для OpenCode Desktop: пиксельный персонаж в левом нижнем углу,
озвучка ответов и рассуждений локальным TeraTTSv2, артикуляция по длительности
звука, своя панель настроек. Всё офлайн. Общие правила процесса — в
`~/Documents/AGENTS.md`, здесь только проектное.

## Три части

| Что | Исходник | Живая копия |
| --- | --- | --- |
| GUI | `plugins/x2ai-avatar/gui.template.cjs` → сборка `gui-experimental.cjs` | `~/.config/opencode/plugins/x2ai-avatar/` |
| Серверный плагин | `plugins/x2ai-tts-done.js` | `~/.config/opencode/plugins/` |
| TTS-сервер | `x2ai-teratts/server.py` | `~/.config/opencode/x2ai-teratts/` |

Паки спрайтов: `packs/pixel/` (наш, в git), `packs/anime/` (чужой, в `.gitignore`).
Черновые кадры и прочий локальный мусор — `custom/` (в `.gitignore`).

## Цикл разработки

```sh
python3 tools/pack_sprites.py && python3 tools/build.py
cp plugins/x2ai-avatar/gui-experimental.cjs ~/.config/opencode/plugins/x2ai-avatar/
cp -R plugins/x2ai-avatar/packs ~/.config/opencode/plugins/x2ai-avatar/  # кадры паков
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
cp x2ai-teratts/server.py ~/.config/opencode/x2ai-teratts/   # если менялся сервер
pkill -x x2ai-voice                                          # перезапуск TTS
python3 tools/smoke.py                                       # ждём «Всё в порядке»
```

`smoke.py` ничего не копирует — он сверяет байты репо с `~/.config` (включая
`packs/`) и пишет «устарело: … — скопируй …». GUI подхватывается только после
**Cmd+R** в окне; серверный плагин перезагружается на каждом шаге сам.

## Ловушки

1. Бандл исполняется через `new Function` — в нём нет `require`, только
   аргументы, переданные сборкой.
2. Серверный плагин перезагружается на каждом шаге: любое состояние (правила,
   лимиты, mute, имена, счётчики имён) обязано жить в файле.
3. `pkill -f x2ai-teratts` сервер не находит (argv переписан `setproctitle`).
   Только `pkill -x x2ai-voice`, проверка — `ps -p PID -o comm`.
4. Английский тег обязан доехать до движка: в `speakTera` в stdin пишется
   `<en>…</en>`, иначе фраза звучит с русской фонетикой.
5. `/state` отдаёт **остаток** `ms` и `at`; окно считает `elapsed = now − at`
   и пропускает прошедшие кадры партитуры.
6. `apply()` меняет голос после анимации 175 мс — перерисовку панели после
   выбора персонажа делать с задержкой 430 мс.
7. Голоса хранятся по языкам (`voiceByLang`); русский выбор не подставлять в
   английский.
8. `mute` — отдельный флаг, не подмена `mode`/`reason`.
9. `/test` идёт через `speak()`, а не `speakTera`: иначе в state нет текста и
   губы не двигаются.
10. Стоп глушит только свой чат: STATE гасится, только если останавливаемый
    sid совпадает с текущим.
11. Губами двигает только чат, чей sid в state; при переходе в другой чат
    артикуляцию надо гасить (`pollBridge`).
12. `<dcp-…>` в выводе shell съедается как HTML-тег — regex в `stripCode`
    проверять через `read`/`grep`, а не через `sed`.
13. Кадров спрайтов в бандле нет: окно берёт пак с моста (`GET /pack?name=`),
    манифест — `GET /packs`. Пустой пак рисует прозрачный кадр, поэтому пак
    обязательно копировать в `~/.config/opencode/plugins/x2ai-avatar/packs/`.
14. Настройки движка (mode, speed, lang, muted, quiet) — в
    `x2ai-speech.json`; настройки окна (пузырь, хоткеи, реакция на ошибки) — в
    localStorage `x2ai-avatar:ui`; манера речи персонажа — в
    `x2ai-char-style.json` по sid.
15. В серверном плагине POST-маршруты обязаны жить в обработчике `req.on("end")`:
    выше тела запроса `payload` не существует, и `POST /settings/export`
    отвечал пустотой. GET-маршруты — до чтения тела.
16. Закрытые вкладки не озвучиваются: окно шлёт список открытых чатов
    (`POST /open` → `x2ai-open-sessions.json`, изменение + heartbeat раз в 5 с),
    сервер сверяет sid в `tabOpen()`. Файл устарел (>30 с) или пуст — озвучка
    не блокируется, иначе окно без отчёта немое. Пропавшие sid сразу глушатся.
17. `mute` теперь на чат: `x2ai-muted.json` = `{last, bySid}`; при mute сервер
    пишет фразу в `x2ai-avatar-note.json` (`noteSilent`), `/state?sid=` отдаёт
    её в `note`, окно показывает пузырь без звука и артикуляции.
18. Режим пузыря — `uiPrefs.bubble`: `off` / `mute` (только при выключенном
    звуке, по умолчанию) / `always`; главнее всегда режимы озвучки: если ответ
    или рассуждения «отключено», пузырь не появляется (`bubbleChannelOn`).
19. Эмоции: сон (`IDLE_MS` 3 мин, наклон через кейфрейм `x2ai-sleep`) и злость
    на ошибки (`rageQueue` + `x2ai-rage`, красная подсветка, кадр `wide`).
    Речь эмоцию не сбрасывает; гасит только галочка «Живой персонаж».
20. Клик по персонажу — только по самому спрайту (`box.onclick` проверяет
    `event.target === img`); панель и пузырь кликом по персонажу не считаются.
