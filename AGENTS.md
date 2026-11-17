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
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
cp x2ai-teratts/server.py ~/.config/opencode/x2ai-teratts/   # если менялся сервер
pkill -x x2ai-voice                                          # перезапуск TTS
python3 tools/smoke.py                                       # ждём «Всё в порядке»
```

`smoke.py` ничего не копирует — он сверяет байты репо с `~/.config` и пишет
«устарело: … — скопируй …». GUI подхватывается только после **Cmd+R** в окне;
серверный плагин перезагружается на каждом шаге сам.

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
