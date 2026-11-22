# x2ai-avatar — плагин окна

Плагин GUI для OpenCode Desktop: пиксельный персонаж в левом нижнем углу,
пузырь с произносимой фразой, панель настроек. Работает в связке с серверным
плагином `plugins/x2ai-tts-done.js` (озвучка) и TTS-сервером
`x2ai-teratts/`. Всё офлайн.

Полная документация по проекту, установке и созданию своих паков — в
[корневом README](../../README.md).

## Как устроено

- Исходник — `gui.template.cjs`. Сборка: `python3 tools/build.py` →
  `gui-experimental.cjs`. Именно собранный файл лежит в
  `~/.config/opencode/plugins/x2ai-avatar/`.
- Бандл исполняется через `new Function`: внутри него **нет `require`**, кроме
  двух модулей, которые передаёт сборка (`@opencode/plugin/gui` и `solid-js`).
  Попытка `require("./файл")` внутри бандла роняет плагин.
- `bridge()` объявлен как `function` (hoisting) — доступен с момента
  инициализации; все запросы к мосту идут через него.
- Данные подставляются в шаблон маркерами при сборке:
  `__PACK_INDEX__` (`plugins/x2ai-avatar/packs/index.json`), `__CLICKS__`
  (`clicks.json`), `__LINES__` (`lines.json`), `__CHARACTERS__`
  (`plugins/x2ai-avatar/packs/characters.json`), `__TALK_PLAN__`
  (`talk-plan.js`).
- Кадры **не лежат в бандле**: окно лениво грузит их с моста
  `GET /pack?name=<пак>` через `ensurePack(name)`. `packList()` — ключи
  `PACK_INDEX`; `packForVoice()` автоматически переключает пак под выбранного
  персонажа; виртуальный пак `@all` грузит все паки сразу.
- Размер на экране: `const HEIGHT = 224` (`gui.template.cjs:114`), спрайты
  336 px. Границы `HEIGHT_MIN = 120`, `HEIGHT_MAX = 420`; значение хранится в
  `localStorage` окна под ключом `x2ai-avatar:height`.

## Паки и персонажи

Сейчас 4 пака и 28 персонажей. Источник истины — `packs/<пак>/characters.json`:

```json
{
  "name": "16Bit - Кодеры",
  "prefix": "px_",
  "characters": {
    "px_hero": {
      "name": "Герой", "nameEn": "Hero", "gender": "m",
      "voice": "ru_m1", "temper": "...",
      "clicks": ["..."],
      "rage":   { "ru": ["..."], "en": ["..."] },
      "compact": { "ru": { "start": ["..."], "done": ["..."] },
                   "en": { "start": ["..."], "done": ["..."] } },
      "lines": ["..."]
    }
  }
}
```

`prefix` добавляется к id персонажа при сборке пака. `tools/pack_sprites.py`
собирает агрегат `plugins/x2ai-avatar/packs/characters.json`, а
`tools/build.py` вшивает его в бандл как `__CHARACTERS__`. GUI мёржит имена,
пол, голос, характер, клики, реплики злости/компактизации и приветствия поверх
таблиц кода (код остаётся фолбэком). Серверный плагин читает тот же файл с
кешем по mtime. Поэтому имя, характер и реплики персонажа правятся в
`characters.json`, а не в коде.

## Кадры

- Достаточно **двух**: `closed` (покой) и хотя бы одного кадра разговора —
  `half`, `open`, `round` или `wide`.
- Разговор строится из доступных кадров рта: `buildTalkPlan()` мапит гласные в
  `wide/open/round/half`, а `frame()` подменяет отсутствующие состояния
  доступными по кругу.
- `blink` необязателен — вместо него используется `closed`.
- `idle2` необязателен — если есть, используется для «сна»/второй позы покоя.
- Пока идёт озвучка, кадры меняются каждые 110 мс; в тишине персонаж моргает
  раз в 2.6–5.4 с.

Кадры собираются `tools/pack_sprites.py` в WebP data-URI (высота 336 px);
`normalize()` заполняет недостающие состояния, `tools/smoke.py` проверяет
наличие `closed`, `blink` и хотя бы одного talk-кадра.

## Реплики

Предгенерированного аудио нет: все реплики — **текст**. Синтез идёт через
`POST /say` (`playClip()` → `bridge("/say", { text, sid, voice, token })`).
Клики берутся из `CLICKS[packKey(voice)]`, приветствие при смене персонажа —
из `LINES.lines[clipVoice(voice)]`; обе таблицы приходят из данных пака.
Токены `sayToken` / `sayTokens` отсекают устаревшие запросы при быстрой смене
персонажа.

## Добавление своего пака

В панели «Пак персонажей» есть кнопка **«Добавить пак»**: она открывает выбор
папки, читает файлы в base64 и отправляет `POST /packs/install` серверному
плагину. Тот проверяет состав (имя пака, `sprites.json` или PNG с `closed` +
одним talk-кадром, валидный `characters.json`, не более 600 файлов / 30 МБ,
только `.png/.jpg/.webp/.json`, запрет имён встроенных паков), пишет папку в
`packs/<name>/`, запускает `pack_sprites.py` и `build.py`, копирует результат
в `~/.config/opencode/plugins/x2ai-avatar/` и при любой ошибке откатывает
изменения. После успеха окно перезагружается само.

Внешние паки можно положить и без сборки — в
`~/.config/opencode/x2ai-avatar-packs/<name>/sprites.json`. Мост отдаёт их как
есть, а резолвер `frame()` в окне подставит недостающие кадры.

Подробная инструкция, пример `sprites.json` и схема `characters.json` — в
[корневом README](../../README.md), раздел «Свои паки / Custom packs».

## Мост

Серверный плагин поднимает HTTP-мост на `127.0.0.1:47821` (порт меняется
`X2AI_BRIDGE_PORT`). Окно опрашивает `GET /state` раз в 250 мс и сверяет `sid`,
чтобы артикулировал только тот чат, который сейчас озвучивается.

| маршрут | назначение |
| --- | --- |
| `GET /state` | состояние озвучки (`ms`, `at`, текст), пузырь |
| `GET /packs`, `GET /pack?name=` | список паков и кадры пака |
| `POST /packs/install` | установка своего пака |
| `GET /voices`, `GET /chars`, `/charvoice`, `/models`, `/model`, `/user` | голоса, характеры, модели, пользователь |
| `GET /log`, `GET /demo`, `/limits`, `/project` | логи, демо, лимиты, каталог проекта |
| `POST /say`, `/stop`, `/test`, `/voice`, `/speech` | реплика, стоп, проверка, смена голоса/режима |
| `POST /power`, `/open`, `/settings/export`, `/settings/import` | питание, открытые чаты, экспорт/импорт настроек |

## Сборка и деплой

```sh
node --check plugins/x2ai-avatar/gui.template.cjs
python3 tools/pack_sprites.py          # если менялись кадры или characters.json
python3 tools/build.py
cp plugins/x2ai-avatar/gui-experimental.cjs ~/.config/opencode/plugins/x2ai-avatar/
cp -R plugins/x2ai-avatar/packs ~/.config/opencode/plugins/x2ai-avatar/
python3 tools/smoke.py
```

Серверный плагин копируется отдельно (`cp plugins/x2ai-tts-done.js
~/.config/opencode/plugins/`) и перезагружается сам; TTS-сервер —
`cp x2ai-teratts/server.py ~/.config/opencode/x2ai-teratts/` и
`pkill -x x2ai-voice`. `smoke.py` ничего не копирует — только сверяет байты
и маркеры. Окно подхватывает новый бандл только после **Cmd+R**.

## Отключить

Убрать `~/.config/opencode/plugins/x2ai-avatar` из массива `plugins` в
`~/.config/opencode/opencode.jsonc`. Кнопка питания в окне делает мягкое
выключение: пишет `~/.config/opencode/x2ai-tts-done.disabled`, глушит
`x2ai-voice` и режет события и `/say`, не удаляя настройки.
