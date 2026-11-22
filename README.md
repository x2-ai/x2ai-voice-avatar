# x2ai-voice-avatar

[Русский](#русский) · [English](#english)

![Четыре пака персонажей: 16Bit — Кодеры, Ночная смена, Девяностые, Аниме](docs/preview.png)

---

## Русский

**Персонаж с голосом в окне OpenCode Desktop.**

Локальная озвучка ответов агента и пиксельный персонаж в левом нижнем углу
окна. В репозитории **4 пака и 28 персонажей** — все кадры, голоса и тексты
свои. Персонаж совпадает с голосом текущего чата: говорит, двигает ртом ровно
пока звучит wav, моргает в тишине и отвечает короткой репликой на клик.

Всё работает офлайн: синтез — TeraTTSv2 (ONNX, CPU), без облака и без torch.

> [!IMPORTANT]
> **Голосовой движок ставится отдельно.** В репозитории нет модели TeraTTSv2 —
> только код плагина. Без шага 1 персонаж появится, но будет молчать: синтез
> нечем делать. Модель занимает ~390 МБ, окружение — ещё ~225 МБ, всё качается
> один раз с Hugging Face.

### Что умеет

- Озвучка ответов: **полностью**, **кратко** (пересказ вспомогательной моделью)
  или **выключено**.
- Озвучка рассуждений: **выкл / кратко / полностью**, с переводом на язык
  озвучки. Английский текст не читается по-русски и наоборот.
- Два языка интерфейса и речи: **RU / EN**. Движок понимает только `<ru>` и
  `<en>`, поэтому других языков нет.
- **4 пака, 28 персонажей**; галочкой отмечается, кто доступен для новых чатов
  и для кнопки смены. Паки грузятся лениво, поэтому окно стартует быстрее.
- **Свои паки**: кнопка «Добавить пак» в панели принимает папку со спрайтами и
  описанием персонажей, проверяет состав, собирает и перезагружает окно.
  Инструкция — в разделе [«Свои паки»](#свои-паки).
- Индивидуальные настройки каждого персонажа: размер, голос, режимы озвучки,
  детализация пересказа, **характер** (готовая манера или свой текст) и
  **манера речи** — скорость и окраска голоса. Хранятся в `localStorage` окна.
- **Характер** подмешивается в системные инструкции чата: персонаж держит манеру
  речи, но не искажает факты и код.
- **Пузырь с фразой**, **горячие клавиши** (⌘/Ctrl+Shift+M — mute, S — стоп,
  A — панель) и реакция на ошибки — включаются в «Дополнительно».
- **Экспорт и импорт** настроек персонажей в файл.
- Кнопка **mute** (глушит ответы и рассуждения, не меняя настройки), **стоп**
  и панель настроек с персонажами, голосами и режимами озвучки.
- Пинги, пока агент работает: интервал растёт 60 с → ×1.6, максимум 10 минут,
  после ответа сбрасывается. Чужие чаты не перебиваются.
- Правила рода и имени уходят в системные инструкции первого запроса чата и в
  переписке не видны.
- Linux поддерживается; Windows пока не протестирован — что поставить, ниже.

### Требования

- macOS 13+, Linux или Windows (Windows не протестирован, см. ниже).
- Python 3.10+ и ~650 МБ на модель и окружение.
- OpenCode Desktop с поддержкой GUI-плагинов.
- Аудиоплеер: `afplay` (macOS, встроен) или `paplay` / `aplay` / `ffplay` /
  `play` (Linux).

### Установка

#### 1. Движок TeraTTS (обязательно)

```sh
python3 -m venv ~/.config/opencode/teratts-venv
~/.config/opencode/teratts-venv/bin/pip install \
  numpy onnxruntime transformers num2words huggingface_hub pillow setproctitle

~/.config/opencode/teratts-venv/bin/huggingface-cli download \
  TeraSpace/TeraTTSv2 --local-dir ~/.config/opencode/teratts-model
```

В модели должны быть `text_encoder.onnx`, `duration_predictor.onnx`,
`sampler_distilled_cfg3_8step.onnx`, `vocoder.onnx`, `teratts.py`,
`unicode_indexer.json`, папки `styles/` и `ruaccent/`.

**Английские голоса.** В репозитории модели лежат только русские стили. Для
английского скачайте стили нужных голосов:

```sh
cd ~/.config/opencode/teratts-model/styles
for v in eng_f3 eng_f4_whisper eng_f5 eng_m2_whisper eng_m3 eng_m4; do
  mkdir -p "$v"
  for f in style_dp style_ttl; do
    curl -sLO "https://huggingface.co/TeraSpace/TeraTTSv2/resolve/main/styles/$v/$f.npy"
    mv "$f.npy" "$v/"
  done
done
```

#### 2. Сервер озвучки

```sh
mkdir -p ~/.config/opencode/x2ai-teratts
cp x2ai-teratts/* ~/.config/opencode/x2ai-teratts/
chmod +x ~/.config/opencode/x2ai-teratts/x2ai-teratts-*
echo "Привет, это проверка" | ~/.config/opencode/x2ai-teratts/x2ai-teratts-speak
```

Первый вызов поднимает демон (загрузка модели ~7 с), дальше фраза синтезируется
за 0.3–1.1 с. В мониторе системы процесс называется **x2ai-voice**, а не
«Python». Остановить вручную: `pkill -x x2ai-voice`.

#### 3. Плагины

```sh
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
cp -r plugins/x2ai-avatar ~/.config/opencode/plugins/
```

`plugins/x2ai-avatar/gui-experimental.cjs` уже собран и лежит в репозитории.
Если меняли шаблон, кадры, `characters.json` или реплики — пересоберите
(см. [«Сборка»](#сборка)).

#### 4. Подключить в конфиге

`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    "~/.config/opencode/plugins/x2ai-tts-done.js",
    "~/.config/opencode/plugins/x2ai-avatar"
  ]
}
```

Перезапустите окно. Персонаж появится слева внизу.

### Первые шаги

- **Правый клик** по персонажу — следующий доступный персонаж вместе с голосом.
- **Левый клик** — короткая реплика.
- **Шестерёнка** слева — панель настроек.
- **Круглая кнопка ↻** — сменить персонажа.
- **Круглая кнопка 🔊/🔇** — мгновенно заглушить или вернуть звук.

### Панель

Главное меню — подменю с кнопкой «Назад»:

| раздел | что внутри |
| --- | --- |
| **Данные пользователя** | имя и род пользователя для пересказа и правил |
| **Настройка персонажей** | пак, список персонажей с галочками, кнопки выбрать (✓) и настроить (⚙), а также **«Добавить пак»** |
| **Вспомогательная модель** | модель для пересказа и перевода, поиск и постраничный список |
| **Дополнительно** | скорость, тихие часы, «держать движок в памяти», пузырь, горячие клавиши, реакция на ошибки, экспорт/импорт настроек, проверка/стоп/повтор |
| **Статистика** | сколько ответов озвучено и сколько всего речи |

Справа вверху — переключатель **EN / RU**.

В подменю персонажа: имя, блок «Характер» (галочка «Активировать», своё
описание и манера речи — скорость и окраска голоса), размер, голос и режимы
озвучки. Пузырь с произносимой фразой висит над персонажем и скрывается, пока
открыты настройки. Настройки индивидуальны и хранятся в `localStorage` окна
(`x2ai-avatar:char-settings`).

### Паки персонажей

Кадры, имена, характеры, реплики и голоса описаны **данными**, а не кодом:
у каждого пака есть `packs/<pack>/characters.json`. Встроенных паков четыре:

| папка | название | персонажей |
| --- | --- | --- |
| `packs/bit16/` | 16Bit — Кодеры | 4 |
| `packs/bit16night/` | 16Bit — Ночная смена | 5 |
| `packs/bit16ninety/` | 16Bit — Девяностые | 9 |
| `packs/pixel/` | 16Bit — Аниме | 10 |

Итого **28 персонажей**. В «Настройка персонажей» можно выбрать пак, либо
виртуальный пункт «Все доступные» — он показывает персонажей всех паков сразу,
но хранит галочки и настройки отдельно.

Все кадры нарисованы для этого проекта. Свой пак добавляется кнопкой
«Добавить пак», см. ниже.

### Свои паки

Папка пака — это просто каталог с кадрами и файлом `characters.json`. Правки
исходников плагина не требуются.

#### Что должно лежать в папке

Минимально — **два кадра** на персонажа:

- `closed` — покой (обязательно);
- хотя бы один кадр разговора: `half`, `open`, `round` или `wide`.

Остальные кадры необязательны:

- `blink` — если его нет, вместо него показывается `closed`;
- `idle2` — если есть, используется как вторая поза покоя/сна;
- недостающие кадры разговора подменяются доступными по кругу: с одним
  `open` все гласные будут показывать его.

Кадры задаются одним из двух способов:

**Вариант A — `sprites.json`** (готовые data-URI, например WebP/PNG):

```json
{
  "hero": {
    "closed": "data:image/webp;base64,...",
    "open": "data:image/webp;base64,..."
  }
}
```

**Вариант B — PNG-файлы** (тогда `sprites.json` соберётся сам):

```
mypack/
  hero/
    closed.png
    open.png
    idle2.png        # необязательно
  characters.json
```

`tools/pack_sprites.py` приводит кадры к высоте 336 px (LANCZOS с
премультипликацией, только если кадр ниже), кодирует в WebP q86 и пишет
`plugins/x2ai-avatar/packs/<pack>.json`.

#### `characters.json`

```json
{
  "name": "Мой пак",
  "prefix": "px_",
  "characters": {
    "px_hero": {
      "name": "Герой",
      "nameEn": "Hero",
      "gender": "m",
      "voice": "x2ai_hero",
      "temper": "спокойный и немного ироничный: говори коротко и по делу",
      "clicks": ["Я тут.", "Слушаю.", "Что по задаче?"],
      "rage": {
        "ru": ["Ошибка. Разберёмся.", "Плохо. Очень плохо."],
        "en": ["An error. We'll sort it out.", "Bad. Very bad."]
      },
      "compact": {
        "ru": {"start": ["Сжимаю…"], "done": ["Готово."]},
        "en": {"start": ["Compressing…"], "done": ["Done."]}
      },
      "lines": ["Привет.", "Я на связи."]
    }
  }
}
```

| поле | смысл |
| --- | --- |
| `name` | название пака в списке |
| `prefix` | префикс id персонажей; `px_` — как у встроенных паков |
| `characters` | ключ — итоговый id (`px_hero`), он же ключ в `sprites.json` после префикса |
| `name` / `nameEn` | имя в панели для RU / EN |
| `gender` | `m` / `f` — род реплик и нейтральных фраз |
| `voice` | id стиля голоса; необязателен |
| `temper` | характер, подмешивается в системные инструкции чата |
| `clicks` | реплики на клик (текст, синтез через `/say`) |
| `rage` | реплики на ошибки, `ru` / `en` |
| `compact` | реплики компактизации: `start` / `done` для `ru` / `en` |
| `lines` | приветствия при смене персонажа |

Все реплики — обычный текст, никаких предгенерированных аудиофайлов.

#### Голос для персонажа

Голос — пара `.npy` файлов в
`~/.config/opencode/teratts-model/styles/<voice>/`. Смешать свой стиль из
существующих можно штатным скриптом:

```sh
python3 tools/make_voice.py --mix "ru_f1:0.6,x2ai_programmer:0.4" \
  --name x2ai_hero --label "Герой"
```

Он же кладёт человеческое имя в `~/.config/opencode/x2ai-voice-labels.json`.
Если `voice` не указан или стиля нет, берётся базовый голос по полу.

#### Установка кнопкой «Добавить пак»

1. Панель → **Настройка персонажей** → **Пак персонажей** → **«Добавить пак»**.
2. Выбрать папку пака. Имя пака берётся из имени папки.
3. Окно читает файлы, шлёт `POST /packs/install`, сервер проверяет состав,
   кладёт папку в `packs/<name>/`, запускает `tools/pack_sprites.py` и
   `tools/build.py`, копирует результат в `~/.config/opencode/plugins/x2ai-avatar/`.
4. При успехе окно перезагружается, пак появляется в списке. При ошибке —
   откат, ничего не ломается.

Ограничения установки: имя пака — латиница/цифры/`-`/`_` (встроенные имена
`bit16`, `bit16night`, `bit16ninety`, `pixel` занять нельзя), не более 600
файлов и 30 МБ, только `.png` / `.jpg` / `.jpeg` / `.webp` / `.json`, пути без
`..`. Пак без `closed` или без единого кадра разговора отклоняется.

#### Установка вручную

```sh
cp -R mypack packs/
python3 tools/pack_sprites.py
python3 tools/build.py
cp plugins/x2ai-avatar/gui-experimental.cjs ~/.config/opencode/plugins/x2ai-avatar/
cp -R plugins/x2ai-avatar/packs ~/.config/opencode/plugins/x2ai-avatar/
python3 tools/smoke.py
```

Затем **Cmd+R** в окне. Повторная установка пака с тем же именем заменяет его,
старая версия остаётся в `packs/<name>.bak-<время>/`.

Внешние паки можно также положить в
`~/.config/opencode/x2ai-avatar-packs/<name>/sprites.json` — мост отдаёт их
как есть, а окно само подставляет недостающие кадры.

### Голоса

Русские голоса — базовые стили `ru_f1`, `ru_f2`, `ru_m1`, `ru_m5` плюс стили,
смешанные для персонажей (`x2ai_*`). Английские — `eng_f3`,
`eng_f4_whisper`, `eng_f5`, `eng_m2_whisper`, `eng_m3`, `eng_m4` (скачиваются
в шаге 1). Панель показывает только голоса текущего языка; переключение RU↔EN
не сбрасывает выбранные настройки.

Список голосов и их метки окно берёт с моста (`GET /voices`); новый стиль,
созданный `tools/make_voice.py`, подхватывается без перезапуска сервера.

### Сборка

```sh
python3 tools/pack_sprites.py   # паки → plugins/x2ai-avatar/packs/*.json, index.json, characters.json
python3 tools/build.py          # gui.template.cjs → gui-experimental.cjs
python3 tools/make_preview.py   # docs/preview.png из текущих кадров (не обязательно)
python3 tools/smoke.py          # сверка байтов репо и ~/.config
```

`pack_sprites.py` читает `packs/<pack>/sprites.json` (или собирает его из PNG),
нормализует кадры и собирает агрегат `characters.json`, который `build.py`
вшивает в бандл маркером `__CHARACTERS__`. GUI и серверный плагин читают данные
поверх таблиц в коде — код остаётся фолбэком.

Деплой после правок:

```sh
cp plugins/x2ai-avatar/gui-experimental.cjs ~/.config/opencode/plugins/x2ai-avatar/
cp -R plugins/x2ai-avatar/packs ~/.config/opencode/plugins/x2ai-avatar/
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
python3 tools/smoke.py
```

`smoke.py` ничего не копирует — только сверяет байты. GUI подхватывается после
**Cmd+R**, серверный плагин перезагружается сам на каждом шаге, TTS-сервер —
`pkill -x x2ai-voice`.

### Как окно узнаёт, что персонаж говорит

Серверный плагин поднимает HTTP-мост на `127.0.0.1:47821` (порт меняется
`X2AI_BRIDGE_PORT`). Окно опрашивает `/state` раз в 250 мс, получает остаток
`ms` и `at`, сверяет `sid` чата и проигрывает партитуру кадров.

| маршрут | что делает |
| --- | --- |
| `GET /state` | состояние озвучки, остаток `ms`, `at`, текст, `sid` |
| `GET /packs`, `GET /pack?name=` | список паков и кадры пака |
| `POST /packs/install` | установка своего пака |
| `GET /voices`, `GET /chars`, `GET /charvoice` | голоса, персонажи, привязка голос↔персонаж |
| `GET /models`, `GET /model`, `GET /user` | вспомогательная модель и данные пользователя |
| `GET /limits`, `GET /log`, `GET /demo` | лимиты, лог, демо |
| `GET /project` | каталог активного проекта |
| `POST /say`, `POST /stop`, `POST /test` | сказать, остановить, проверка звука |
| `POST /voice`, `POST /speech` | смена персонажа, режимы озвучки |
| `POST /power`, `POST /open` | общий выключатель, список открытых чатов |
| `POST /settings/export`, `POST /settings/import` | экспорт/импорт настроек |

### Правила рода и имени

Род и имя персонажа берутся из `characters.json`, а не из id голоса. Они
уходят в системные инструкции первого запроса чата; файл
`~/.config/opencode/x2ai-rules-seen.json` хранит, куда правила уже добавлены.

### Языки

Переключатель **EN / RU** в правом верхнем углу панели. Язык интерфейса —
`localStorage` `x2ai-avatar:lang`, язык речи — `lang` в
`~/.config/opencode/x2ai-speech.json`.

### Платформы

- **macOS** — основная платформа, `afplay` встроен.
- **Linux** — нужен один из `paplay` / `aplay` / `ffplay` / `play`:
  `sudo apt install alsa-utils` или `sudo dnf install alsa-utils`.
- **Windows** — не протестирован. Потребуется Python 3.11+ в PATH,
  `winget install Gyan.FFmpeg`, файлы в `%USERPROFILE%\.config\opencode\...`,
  unix-сокет TTS-сервера заменить на TCP и использовать `ffplay`. Нужны
  тестеры.

### Поддержать автора

- BTC: `bc1p67wgr4qpp84v8zjnufhrhn62sspke4m4np5cc0slmqnsvgt7vlgqxldjux`
- ETH / EVM: `0xC74bF5C4Fc00656F713DA4FBC210C750434C662C`
- SOL: `DkKAewrMxWk8qHgk5jPorFaZeQzQXFc7p7Kygv5VYuYL`
- TON: `UQC2EciOqkEqAqWMN8wyj06Y4crwabnaJg7NGffuC1Byz4U3`
- TRX: `THEdtg5faibdsgNjxurRu6MRNwS9Vkt4aW`

### Лицензии

- Код плагинов и инструментов — **MIT**.
- Кадры персонажей и реплики — наши, лежат в репозитории.
- **TeraTTSv2** — OpenRAIL-M, атрибуция TeraSpace. Модель в репозиторий не
  входит и скачивается отдельно.

### Отключить

Уберите оба плагина из `opencode.jsonc` либо создайте файл
`~/.config/opencode/x2ai-tts-done.disabled` — движок и события отключатся,
настройки останутся.

---

## English

**A voiced character in the OpenCode Desktop window.**

Local text-to-speech for the agent's replies and a pixel character in the
bottom-left corner. The repository ships **4 packs with 28 characters** — all
sprites, voices and texts are our own. The character matches the current chat's
voice: it talks, moves its mouth exactly while the wav plays, blinks in silence
and answers with a short line on click.

Everything runs offline: synthesis is TeraTTSv2 (ONNX, CPU), no cloud, no torch.

> [!IMPORTANT]
> **The speech engine is installed separately.** The TeraTTSv2 model is not in
> this repository — only the plugin code. Without step 1 the character appears
> but stays silent. The model is ~390 MB, the venv another ~225 MB, downloaded
> once from Hugging Face.

### Features

- Reply speech: **full**, **brief** (summarised by an auxiliary model) or
  **off**.
- Reasoning speech: **off / brief / full**, translated into the speech
  language. English text is never read with Russian phonetics and vice versa.
- Two UI and speech languages: **RU / EN**. The engine understands only `<ru>`
  and `<en>`.
- **4 packs, 28 characters**; checkboxes control who is available for new chats
  and for the switch button. Packs load lazily, so the window starts faster.
- **Custom packs**: the «Add pack» button accepts a folder with sprites and a
  character description, validates it, builds it and reloads the window. See
  [Custom packs](#custom-packs).
- Per-character settings: size, voice, speech modes, summary detail,
  **persona** (built-in manner or your own text) and **speech manner** — speed
  and voice colour. Stored in the window's `localStorage`.
- **Persona** is injected into the chat's system instructions: the character
  keeps its manner without distorting facts or code.
- **Speech bubble**, **hotkeys** (⌘/Ctrl+Shift+M — mute, S — stop, A — panel)
  and error reactions — under «Advanced».
- **Export / import** of character settings.
- **Mute** button (silences replies and reasoning without changing settings),
  **stop** and a settings panel.
- Pings while the agent works: interval grows 60 s → ×1.6, max 10 minutes,
  resets after a reply. Other chats are not interrupted.
- Gender and name rules go into the system instructions of the first chat
  request and are invisible in the conversation.
- Linux is supported; Windows is untested (see below).

### Requirements

- macOS 13+, Linux or Windows (Windows untested, see below).
- Python 3.10+ and ~650 MB for the model and venv.
- OpenCode Desktop with GUI plugin support.
- Audio player: `afplay` (built into macOS) or `paplay` / `aplay` / `ffplay` /
  `play` (Linux).

### Installation

#### 1. TeraTTS engine (required)

```sh
python3 -m venv ~/.config/opencode/teratts-venv
~/.config/opencode/teratts-venv/bin/pip install \
  numpy onnxruntime transformers num2words huggingface_hub pillow setproctitle

~/.config/opencode/teratts-venv/bin/huggingface-cli download \
  TeraSpace/TeraTTSv2 --local-dir ~/.config/opencode/teratts-model
```

The model must contain `text_encoder.onnx`, `duration_predictor.onnx`,
`sampler_distilled_cfg3_8step.onnx`, `vocoder.onnx`, `teratts.py`,
`unicode_indexer.json`, `styles/` and `ruaccent/`.

**English voices.** The model ships Russian styles only. Download the English
styles you need:

```sh
cd ~/.config/opencode/teratts-model/styles
for v in eng_f3 eng_f4_whisper eng_f5 eng_m2_whisper eng_m3 eng_m4; do
  mkdir -p "$v"
  for f in style_dp style_ttl; do
    curl -sLO "https://huggingface.co/TeraSpace/TeraTTSv2/resolve/main/styles/$v/$f.npy"
    mv "$f.npy" "$v/"
  done
done
```

#### 2. Speech server

```sh
mkdir -p ~/.config/opencode/x2ai-teratts
cp x2ai-teratts/* ~/.config/opencode/x2ai-teratts/
chmod +x ~/.config/opencode/x2ai-teratts/x2ai-teratts-*
echo "Привет, это проверка" | ~/.config/opencode/x2ai-teratts/x2ai-teratts-speak
```

The first call starts the daemon (model load ~7 s), later phrases take 0.3–1.1
s. In the system monitor the process is **x2ai-voice**, not «Python». Stop it
manually with `pkill -x x2ai-voice`.

#### 3. Plugins

```sh
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
cp -r plugins/x2ai-avatar ~/.config/opencode/plugins/
```

`plugins/x2ai-avatar/gui-experimental.cjs` is already built. If you changed the
template, sprites, `characters.json` or lines — rebuild (see [Build](#build)).

#### 4. Wire it up in the config

`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    "~/.config/opencode/plugins/x2ai-tts-done.js",
    "~/.config/opencode/plugins/x2ai-avatar"
  ]
}
```

Restart the window. The character appears bottom-left.

### First steps

- **Right-click** the character — next available character with its voice.
- **Left-click** — a short line.
- **Gear** on the left — settings panel.
- **Round ↻** — switch character.
- **Round 🔊/🔇** — mute / unmute instantly.

### Panel

The main menu opens submenus with a «Back» button:

| section | contents |
| --- | --- |
| **User data** | user name and gender for summaries and rules |
| **Characters** | pack, character list with checkboxes, select (✓) and configure (⚙), plus **«Add pack»** |
| **Auxiliary model** | model for summarising and translating, search and paginated list |
| **Advanced** | speed, quiet hours, «keep engine in memory», bubble, hotkeys, error reactions, export/import, test/stop/replay |
| **Statistics** | replies spoken and total speech time |

Top-right is the **EN / RU** switch.

A character's submenu: name, «Persona» block (enable checkbox, your own
description, speech manner — speed and colour), size, voice and speech modes.
The speech bubble floats above the character and hides while settings are open.
Settings are per-character and stored in `localStorage`
(`x2ai-avatar:char-settings`).

### Character packs

Sprites, names, personas, lines and voices are **data**, not code: every pack has
`packs/<pack>/characters.json`. Four packs ship with the project:

| folder | name | characters |
| --- | --- | --- |
| `packs/bit16/` | 16Bit — Coders | 4 |
| `packs/bit16night/` | 16Bit — Night Shift | 5 |
| `packs/bit16ninety/` | 16Bit — Nineties | 9 |
| `packs/pixel/` | 16Bit — Anime | 10 |

**28 characters** total. In «Characters» you can pick a pack or the virtual
«All available» entry — it shows every character from every pack at once but
keeps its own checkboxes and settings.

All sprites were drawn for this project. Add your own with «Add pack», see
below.

### Custom packs

A pack is just a folder with sprites and a `characters.json`. No plugin sources
need editing.

#### What the folder must contain

Minimum **two frames per character**:

- `closed` — idle (required);
- at least one talking frame: `half`, `open`, `round` or `wide`.

Everything else is optional:

- `blink` — when absent, `closed` is used instead;
- `idle2` — when present, used as a second idle/sleep pose;
- missing talking frames are substituted from the available ones in rotation:
  with a single `open`, every vowel shows that frame.

Frames can be supplied in two ways:

**Option A — `sprites.json`** (ready data-URIs, e.g. WebP/PNG):

```json
{
  "hero": {
    "closed": "data:image/webp;base64,...",
    "open": "data:image/webp;base64,..."
  }
}
```

**Option B — PNG files** (`sprites.json` is then generated):

```
mypack/
  hero/
    closed.png
    open.png
    idle2.png        # optional
  characters.json
```

`tools/pack_sprites.py` normalises frames to 336 px height (premultiplied
LANCZOS only when the frame is shorter), encodes WebP q86 and writes
`plugins/x2ai-avatar/packs/<pack>.json`.

#### `characters.json`

```json
{
  "name": "My Pack",
  "prefix": "px_",
  "characters": {
    "px_hero": {
      "name": "Hero",
      "nameEn": "Hero",
      "gender": "m",
      "voice": "x2ai_hero",
      "temper": "calm and slightly ironic: keep it short and to the point",
      "clicks": ["I'm here.", "Listening.", "What's the task?"],
      "rage": {
        "ru": ["Ошибка. Разберёмся."],
        "en": ["An error. We'll sort it out."]
      },
      "compact": {
        "ru": {"start": ["Сжимаю…"], "done": ["Готово."]},
        "en": {"start": ["Compressing…"], "done": ["Done."]}
      },
      "lines": ["Hello.", "I'm on it."]
    }
  }
}
```

| field | meaning |
| --- | --- |
| `name` | pack name in the list |
| `prefix` | character id prefix; `px_` matches the built-in packs |
| `characters` | key is the final id (`px_hero`) and the `sprites.json` key after the prefix |
| `name` / `nameEn` | panel name for RU / EN |
| `gender` | `m` / `f` — grammar of lines and neutral phrases |
| `voice` | voice style id; optional |
| `temper` | persona, injected into the chat's system instructions |
| `clicks` | lines on click (plain text, synthesised via `/say`) |
| `rage` | error lines, `ru` / `en` |
| `compact` | compaction lines: `start` / `done` for `ru` / `en` |
| `lines` | greeting lines when the character is selected |

All lines are plain text — no pre-generated audio files.

#### A voice for the character

A voice is a pair of `.npy` files in
`~/.config/opencode/teratts-model/styles/<voice>/`. Mix your own style from
existing ones with the bundled script:

```sh
python3 tools/make_voice.py --mix "ru_f1:0.6,x2ai_programmer:0.4" \
  --name x2ai_hero --label "Hero"
```

It also writes the human label into
`~/.config/opencode/x2ai-voice-labels.json`. If `voice` is omitted or the style
is missing, a base voice is chosen by gender.

#### Install with «Add pack»

1. Panel → **Characters** → **Character pack** → **«Add pack»**.
2. Pick the pack folder. The pack name comes from the folder name.
3. The window reads the files, posts `POST /packs/install`; the server validates
   the contents, writes the folder to `packs/<name>/`, runs
   `tools/pack_sprites.py` and `tools/build.py`, and copies the result into
   `~/.config/opencode/plugins/x2ai-avatar/`.
4. On success the window reloads and the pack appears in the list. On failure
   everything is rolled back.

Install limits: pack name is latin/digits/`-`/`_` (built-in names `bit16`,
`bit16night`, `bit16ninety`, `pixel` are reserved), at most 600 files and 30 MB,
only `.png` / `.jpg` / `.jpeg` / `.webp` / `.json`, no `..` in paths. A pack
without `closed` or without a single talking frame is rejected.

#### Install manually

```sh
cp -R mypack packs/
python3 tools/pack_sprites.py
python3 tools/build.py
cp plugins/x2ai-avatar/gui-experimental.cjs ~/.config/opencode/plugins/x2ai-avatar/
cp -R plugins/x2ai-avatar/packs ~/.config/opencode/plugins/x2ai-avatar/
python3 tools/smoke.py
```

Then **Cmd+R** in the window. Reinstalling a pack with the same name replaces
it; the previous version is kept in `packs/<name>.bak-<timestamp>/`.

External packs can also be placed at
`~/.config/opencode/x2ai-avatar-packs/<name>/sprites.json` — the bridge serves
them as-is and the window fills in missing frames itself.

### Voices

Russian voices are the base styles `ru_f1`, `ru_f2`, `ru_m1`, `ru_m5` plus
mixed styles made for the characters (`x2ai_*`). English voices are `eng_f3`,
`eng_f4_whisper`, `eng_f5`, `eng_m2_whisper`, `eng_m3`, `eng_m4` (downloaded in
step 1). The panel shows only the voices of the current language; switching
RU↔EN does not reset the chosen settings.

The voice list and labels come from the bridge (`GET /voices`); a new style made
with `tools/make_voice.py` is picked up without restarting the server.

### Build

```sh
python3 tools/pack_sprites.py   # packs → plugins/x2ai-avatar/packs/*.json, index.json, characters.json
python3 tools/build.py          # gui.template.cjs → gui-experimental.cjs
python3 tools/make_preview.py   # docs/preview.png from current frames (optional)
python3 tools/smoke.py          # compare repo bytes with ~/.config
```

`pack_sprites.py` reads `packs/<pack>/sprites.json` (or builds it from PNG),
normalises frames and produces the `characters.json` aggregate that `build.py`
injects into the bundle as `__CHARACTERS__`. Both the GUI and the server plugin
merge that data over the code tables — code remains a fallback.

Deploy after edits:

```sh
cp plugins/x2ai-avatar/gui-experimental.cjs ~/.config/opencode/plugins/x2ai-avatar/
cp -R plugins/x2ai-avatar/packs ~/.config/opencode/plugins/x2ai-avatar/
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
python3 tools/smoke.py
```

`smoke.py` copies nothing — it only compares bytes. The GUI needs **Cmd+R**,
the server plugin reloads itself on every step, the TTS server is restarted with
`pkill -x x2ai-voice`.

### How the window knows the character is speaking

The server plugin runs an HTTP bridge on `127.0.0.1:47821` (override with
`X2AI_BRIDGE_PORT`). The window polls `/state` every 250 ms, gets the remaining
`ms` and `at`, checks the chat `sid` and plays the frame score.

| route | purpose |
| --- | --- |
| `GET /state` | speech state, remaining `ms`, `at`, text, `sid` |
| `GET /packs`, `GET /pack?name=` | pack list and pack frames |
| `POST /packs/install` | install a custom pack |
| `GET /voices`, `GET /chars`, `GET /charvoice` | voices, characters, voice↔character mapping |
| `GET /models`, `GET /model`, `GET /user` | auxiliary model and user data |
| `GET /limits`, `GET /log`, `GET /demo` | limits, log, demo |
| `GET /project` | active project directory |
| `POST /say`, `POST /stop`, `POST /test` | speak, stop, sound check |
| `POST /voice`, `POST /speech` | switch character, speech modes |
| `POST /power`, `POST /open` | global power switch, list of open chats |
| `POST /settings/export`, `POST /settings/import` | settings export/import |

### Gender and name rules

Gender and name come from `characters.json`, not from the voice id. They are
injected into the system instructions of the first chat request;
`~/.config/opencode/x2ai-rules-seen.json` tracks where the rules were added.

### Languages

The **EN / RU** switch is in the top-right of the panel. UI language is
`localStorage` `x2ai-avatar:lang`, speech language is `lang` in
`~/.config/opencode/x2ai-speech.json`.

### Platforms

- **macOS** — primary platform, `afplay` is built in.
- **Linux** — needs one of `paplay` / `aplay` / `ffplay` / `play`:
  `sudo apt install alsa-utils` or `sudo dnf install alsa-utils`.
- **Windows** — untested. Needs Python 3.11+ on PATH,
  `winget install Gyan.FFmpeg`, files under `%USERPROFILE%\.config\opencode\...`,
  the TTS unix socket replaced with TCP, and `ffplay`. Testers welcome.

### Support the author

- BTC: `bc1p67wgr4qpp84v8zjnufhrhn62sspke4m4np5cc0slmqnsvgt7vlgqxldjux`
- ETH / EVM: `0xC74bF5C4Fc00656F713DA4FBC210C750434C662C`
- SOL: `DkKAewrMxWk8qHgk5jPorFaZeQzQXFc7p7Kygv5VYuYL`
- TON: `UQC2EciOqkEqAqWMN8wyj06Y4crwabnaJg7NGffuC1Byz4U3`
- TRX: `THEdtg5faibdsgNjxurRu6MRNwS9Vkt4aW`

### Licenses

- Plugin and tool code — **MIT**.
- Character sprites and lines — our own, in this repository.
- **TeraTTSv2** — OpenRAIL-M, attribution to TeraSpace. The model is not shipped
  here and is downloaded separately.

### Disable

Remove both plugins from `opencode.jsonc`, or create
`~/.config/opencode/x2ai-tts-done.disabled` — the engine and events switch off,
settings are kept.
