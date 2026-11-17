# x2ai-voice-avatar

[Русский](#русский) · [English](#english)

![Пиксельный пак: Тянка, Демонесса, Робот, Инопланетянин, Программист](docs/preview.png)

---

## Русский

**Персонаж с голосом в окне OpenCode Desktop.** Версия 0.6.0.

Локальная озвучка ответов агента и пиксельный персонаж в левом нижнем углу
окна. Основной пак — `pixel`: пять наших персонажей, кадры лежат в репозитории.
Персонаж совпадает с голосом текущего чата: говорит, двигает ртом ровно пока
звучит wav, моргает в тишине и отвечает короткой репликой на клик.

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
- Пять персонажей в пиксельном паке; галочкой отмечается, кто доступен для
  новых чатов и для кнопки смены.
- Индивидуальные настройки каждого персонажа: размер, голос, режимы озвучки,
  детализация пересказа, **характер** (готовая манера или свой текст) и
  **манера речи** — скорость и окраска голоса. Хранятся в `localStorage` окна.
- **Характер** подмешивается в системные инструкции чата: персонаж держит манеру
  речи, но не искажает факты и код.
- **Пузырь с фразой**, **горячие клавиши** (⌘/Ctrl+Shift+M — mute, S — стоп,
  A — панель) и реакция на ошибки — включаются в «Дополнительно».
- **Экспорт и импорт** настроек персонажей в файл; паки грузятся лениво, поэтому
  окно стартует быстрее, а чужие паки можно подключать из папки.
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
Если меняли шаблон, кадры или реплики — пересоберите (см. «Сборка»).

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

Главное меню — четыре кнопки, каждая открывает своё подменю с кнопкой «Назад»:

| раздел | что внутри |
| --- | --- |
| **Данные пользователя** | имя и род пользователя для пересказа и правил |
| **Настройка персонажей** | пак, список персонажей с галочками и двумя кнопками: выбрать (✓) и настроить (⚙) |
| **Вспомогательная модель** | модель для пересказа и перевода, поиск и постраничный список |
| **Дополнительно** | скорость, тихие часы, «держать движок в памяти», пузырь, горячие клавиши, реакция на ошибки, экспорт/импорт настроек, проверка/стоп/повтор |
| **Статистика** | сколько ответов озвучено и сколько всего речи |

Справа вверху — переключатель **EN / RU**.

В подменю персонажа: имя, блок «Характер» (галочка «Активировать», своё
описание и манера речи — скорость и окраска голоса), размер, голос и режимы
озвучки. Пузырь с произносимой фразой висит над персонажем и скрывается, пока
открыты настройки.
Настройки индивидуальны и хранятся в `localStorage` окна
(`x2ai-avatar:char-settings`).

### Паки персонажей

| пак | источник | персонажей | в git |
| --- | --- | --- | --- |
| `pixel` | наши кадры в `packs/pixel/` | 5 | да |
| `anime` | модели LivLiv, локальная сборка | 10 | нет, папка в `.gitignore` |

Пиксельный пак — основной: он лежит в репозитории и работает без сети.
Аниме-пак необязателен и собирается локально из публичных моделей LivLiv;
готовые кадры в репозиторий не попадают из-за лицензии.

Пак может быть неполным: если для голоса в активном паке кадров нет, плагин
берёт того же персонажа из аниме-пака, а если нет и там — базовый спрайт.

### Голоса и персонажи

| голос | пиксельный пак | аниме-пак | обработка |
| --- | --- | --- | --- |
| `ru_f1` | Тянка | Аня | — |
| `ru_f2` | — | Мила | — |
| `ru_m1` | Программист | Гриша | — |
| `ru_m5` | — | Тимур | — |
| `fx_robot` | Робот | Робик | кольцо 55 Гц, 7 бит |
| `fx_demoness` | Демонесса | Азазель | питч −16 %, вибрато, драйв, реверб |
| `fx_alien` | — | Зета | питч +16 %, вибрато 5 Гц |
| `fx_cat` | — | Мурзик | питч +34 % |
| `fx_penguin` | Инопланетянин | Пико | питч +55 %, вибрато 7 Гц |
| `fx_ghost` | — | Юки | реверб 0.55 |

Голос чата выбирается хешем `sessionID` одним и тем же кодом в плагине озвучки
и в плагине персонажа, поэтому картинка и голос не расходятся. Выбор запоминается
за чатом в `~/.config/opencode/x2ai-voices.json`.

### Английские голоса

Для английского доступны шесть голосов TeraTTS: `eng_f3`, `eng_f4_whisper`,
`eng_f5`, `eng_m2_whisper`, `eng_m3`, `eng_m4`. Панель показывает только голоса
текущего языка, а у каждого персонажа есть свой английский голос по умолчанию:

| русский голос | английский по умолчанию |
| --- | --- |
| `ru_f1` (Тянка, Аня) | `eng_f5` для Тянки, `eng_f3` для Ани |
| `ru_f2` (Мила) | `eng_f5` |
| `ru_m1` (Программист, Гриша) | `eng_m3` |
| `ru_m5` (Тимур) | `eng_m4` |
| `fx_demoness` (Демонесса) | `eng_f3` |
| `fx_alien`, `fx_cat` | `eng_f5` |
| `fx_ghost` | `eng_f4_whisper` |
| `fx_robot`, `fx_demon` | `eng_m3` / `eng_m4` |
| `fx_penguin` | `eng_m2_whisper` |

Выбор голоса запоминается отдельно для каждого языка: переключение RU ↔ EN не
сбрасывает настройки друг друга.

### Языки

Справа вверху главного меню — две кнопки: **EN / RU**.

- **RU** — интерфейс, пересказ и озвучка по-русски.
- **EN** — интерфейс, пересказ и озвучка по-английски.

Язык хранится в `localStorage` окна (`x2ai-avatar:lang`) и дублируется в
`~/.config/opencode/x2ai-speech.json` (`lang`), чтобы пересказ и перевод
рассуждений шли на том же языке, что и озвучка.

### Платформы

- **macOS** — основная платформа, всё проверено.
- **Linux** — поддерживается. Воспроизведение идёт через первый найденный плеер:
  `paplay` (pulseaudio-utils), `aplay` (alsa-utils), `ffplay` (ffmpeg) или
  `play` (sox). Поставьте любой:

  ```sh
  sudo apt install alsa-utils        # Debian/Ubuntu
  sudo dnf install alsa-utils        # Fedora
  ```

  Остальное (unix-сокет, `flock`, `setproctitle`, ONNX CPU) работает так же,
  пути те же — `~/.config/opencode/...`.
- **Windows** — не протестирован: под рукой не было машины, поэтому никто не
  проверял. Порт небольшой, и нам нужны тестеры. Сервер запускается shell-
  скриптом, слушает unix-сокет, блокируется через `fcntl.flock`, звук играет
  `afplay` / `paplay` — на Windows это `.cmd`-запуск, TCP-порт вместо
  unix-сокета и `ffplay`. Что поставить:
  1. **Python 3.11+** — с python.org, галочка «Add python.exe to PATH».
  2. **FFmpeg** — `winget install Gyan.FFmpeg` (из него берётся `ffplay`).
  3. **OpenCode Desktop** и файлы плагина: `gui-experimental.cjs` в
     `%USERPROFILE%\.config\opencode\plugins\x2ai-avatar\`,
     `x2ai-tts-done.js` в `%USERPROFILE%\.config\opencode\plugins\`,
     папку `x2ai-teratts\` — в `%USERPROFILE%\.config\opencode\`.
  4. Модель TeraTTS — как в разделе «Голосовой движок» выше, пути те же.
  Чего ждать: интерфейс, спрайты и настройки заработают сразу, а звук и
  артикуляция — только после правки сокета и лаунчера. Если готов помочь —
  запусти, пришли, что упало, и мы доведём Windows до рабочего состояния.

### Сборка

```sh
python3 tools/pack_sprites.py   # packs/*/sprites.json -> plugins/x2ai-avatar/sprites.json
python3 tools/build.py          # шаблон + спрайты + реплики -> gui-experimental.cjs
python3 tools/smoke.py          # быстрая проверка, что ничего не сломано
```

`tools/pack_sprites.py` собирает общий `sprites.json` из папок паков. Если в
папке пака нет готового `sprites.json`, но есть PNG-кадры по персонажам, файл
собирается из них. Пиксельные персонажи в общем файле получают префикс `px_`,
чтобы не пересекаться с аниме-паком.

Деплой после сборки:

```sh
cp plugins/x2ai-avatar/gui-experimental.cjs ~/.config/opencode/plugins/x2ai-avatar/
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
```

GUI подхватывается после `Cmd+R` в окне. Серверный плагин перезагружается сам.

### Свои персонажи

Плагин не рисует рот и глаза слоями: он держит по одному **цельному кадру** на
состояние и подменяет картинку. Свои персонажи — это набор PNG одного размера,
с прозрачным фоном и одинаковым положением головы:

```
packs/<пак>/<голос>/closed.png   # рот закрыт, глаза открыты — обязательно
packs/<пак>/<голос>/open.png     # рот открыт                 — обязательно
packs/<пак>/<голос>/half.png     # приоткрыт                  — необязательно
packs/<пак>/<голос>/round.png    # «о»                        — необязательно
packs/<пак>/<голос>/wide.png     # широко                     — необязательно
packs/<пак>/<голос>/blink.png    # глаза закрыты              — необязательно
```

Чего нет — подставляется: `half`, `round`, `wide` берут `open.png`, `blink`
берёт `closed.png`. Минимум из двух кадров уже даёт шевелящийся рот.

Кадры масштабируются по высоте до 336 px. Одинаковый размер важен: иначе голова
будет «прыгать» между состояниями. После добавления кадров:

```sh
python3 tools/pack_sprites.py && python3 tools/build.py
```

`<голос>` — id из таблицы выше. Новый персонаж требует ещё имени в
`CHAR_NAMES` (`plugins/x2ai-avatar/gui.template.cjs`) или своего имени в панели.

### Как окно узнаёт, что персонаж говорит

GUI-плагин в окне не имеет доступа к файлам. Озвучка поднимает крошечный
HTTP-мост на `127.0.0.1:47821` (порт переопределяется `X2AI_BRIDGE_PORT`):

| маршрут | что делает |
| --- | --- |
| `GET /state` | что играет сейчас: остаток фразы, чат, голос, текст |
| `POST /voice` | запомнить персонажа и его имя за чатом |
| `POST /speech` | режимы, скорость, тихие часы, язык, mute |
| `POST /limits` | лимиты длины пересказа для персонажа |
| `POST /say` | озвучить фразу голосом персонажа |
| `POST /test` | пробная фраза |
| `POST /stop` | заглушить текущую озвучку |

Окно опрашивает `/state` раз в 250 мс и двигает губами только если `sid`
совпадает с открытым чатом — речь в другом чате анимацию не запускает.

### Правила рода и имени

В первое сообщение чата плагин подмешивает системные инструкции: имя персонажа,
его род (из голоса), имя и род пользователя (из настроек). В переписке они не
видны. Список чатов, которые уже получили правила, хранится в
`~/.config/opencode/x2ai-rules-seen.json`, поэтому перезагрузка плагина не
заставляет повторять их на каждом шаге.

### Поддержать автора

Плагин бесплатный и работает офлайн. Если он пригодился — вот кошельки:

- **BTC** — `bc1p67wgr4qpp84v8zjnufhrhn62sspke4m4np5cc0slmqnsvgt7vlgqxldjux`
- **ETH / BNB и другие EVM-сети** — `0xC74bF5C4Fc00656F713DA4FBC210C750434C662C`
- **SOL** — `DkKAewrMxWk8qHgk5jPorFaZeQzQXFc7p7Kygv5VYuYL`
- **TON** — `UQC2EciOqkEqAqWMN8wyj06Y4crwabnaJg7NGffuC1Byz4U3`
- **TRX** — `THEdtg5faibdsgNjxurRu6MRNwS9Vkt4aW`

### Лицензии

- Код — MIT.
- Пиксельный пак — наши собственные кадры, лежат в репозитории.
- Аниме-пак — персонажи LivLiv (livliv.ai), лицензия LivLiv Featured Characters
  1.0: бесплатно для некоммерческого использования с указанием авторства.
  Готовые кадры в репозитории не публикуются.
- TeraTTSv2 — OpenRAIL-M, атрибуция TeraSpace.

### Отключить

Убрать плагины из `plugins` в `opencode.jsonc` либо создать
`~/.config/opencode/x2ai-tts-done.disabled`.

---

## English

**A voiced character in the OpenCode Desktop window.** Version 0.6.0.

Local voice-over for agent replies plus a pixel character in the bottom-left
corner of the window. The main pack is `pixel`: five characters drawn by us,
with their frames stored in the repository. The character matches the voice of
the current chat: it speaks, moves its mouth while the wav is playing, blinks in
silence, and answers a click with a short line.

Everything runs offline: synthesis is TeraTTSv2 (ONNX, CPU), no cloud and no
torch.

> [!IMPORTANT]
> **The speech engine is installed separately.** This repository contains only
> the plugin code, not the TeraTTSv2 model. Without step 1 the character appears
> but stays silent: there is nothing to synthesize with. The model takes about
> 390 MB and the environment another ~225 MB, downloaded once from Hugging Face.

### Features

- Reply voice-over: **full**, **brief** (summarized by an auxiliary model), or
  **off**.
- Reasoning voice-over: **off / brief / full**, translated into the voice-over
  language. English is never read with Russian pronunciation, and vice versa.
- Two interface and speech languages: **RU / EN**. The engine understands only
  `<ru>` and `<en>`, so there are no other languages.
- Five characters in the pixel pack; a checkbox marks who is available for new
  chats and for the switch button.
- Per-character settings: size, voice, speech modes, summary detail, and a
  **Character** block (an "Enable" checkbox, a preset temper or your own text,
  and **speech style** — voice speed and tone). Stored in the window's
  `localStorage`.
- **Character** is added to the chat's system instructions: it keeps the manner
  of speech but never distorts facts or code.
- **Speech bubble**, **hotkeys** (⌘/Ctrl+Shift+M for mute, S for stop, A for the
  panel) and error reactions are toggled in "Advanced".
- **Export and import** of character settings to a file; packs load lazily, so
  the window starts faster and third-party packs can be added from a folder.
- **Mute** button (silences replies and reasoning without changing settings)
  and **stop**, plus a settings panel with characters, voices and speech modes.
- Pings while the agent is working: the interval grows from 60 s by ×1.6 up to
  10 minutes and resets after a reply. Other chats are never interrupted.
- Gender and name rules are injected into the system instructions of the first
  request and are invisible in the conversation.
- Linux is supported; Windows has not been tested yet — see below.

### Requirements

- macOS 13+, Linux or Windows (Windows untested, see below).
- Python 3.10+ and ~650 MB for the model and environment.
- OpenCode Desktop with GUI plugin support.
- An audio player: `afplay` (macOS, built in) or `paplay` / `aplay` / `ffplay` /
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

The model directory must contain `text_encoder.onnx`, `duration_predictor.onnx`,
`sampler_distilled_cfg3_8step.onnx`, `vocoder.onnx`, `teratts.py`,
`unicode_indexer.json`, and the `styles/` and `ruaccent/` folders.

**English voices.** The model ships only Russian styles. Download the English
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
echo "Hello, this is a test" | ~/.config/opencode/x2ai-teratts/x2ai-teratts-speak
```

The first call starts the daemon (model load ~7 s); after that a phrase takes
0.3–1.1 s. In the system monitor the process is called **x2ai-voice**, not
"Python". Stop it manually with `pkill -x x2ai-voice`.

#### 3. Plugins

```sh
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
cp -r plugins/x2ai-avatar ~/.config/opencode/plugins/
```

`plugins/x2ai-avatar/gui-experimental.cjs` is already built and committed. If
you changed the template, frames, or lines, rebuild it (see "Build").

#### 4. Enable in the config

`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugins": [
    "~/.config/opencode/plugins/x2ai-tts-done.js",
    "~/.config/opencode/plugins/x2ai-avatar"
  ]
}
```

Restart the window. The character appears in the bottom-left corner.

### First steps

- **Right click** the character — next available character with its voice.
- **Left click** — a short line.
- **Gear** on the left — the settings panel.
- **Round ↻ button** — switch character.
- **Round 🔊/🔇 button** — mute or unmute instantly.

### Panel

The main menu has four buttons, each opening a submenu with a "Back" button:

| section | contents |
| --- | --- |
| **User data** | user name and gender for summaries and rules |
| **Characters** | pack, character list with checkboxes and two buttons: select (✓) and settings (⚙) |
| **Auxiliary model** | model for summaries and translation, search and paged list |
| **Advanced** | quiet hours, "keep engine in memory", bubble, hotkeys, settings export/import |
| **Statistics** | how many replies were voiced and total speech time |

Top right — the **EN / RU** switch.

The character submenu contains: name, size, voice, reply voice-over, reasoning
voice-over, a "Character" checkbox with a field for your own text, and a "Speech
style" block (voice speed and tone). Settings are per character and stored in the window's `localStorage`
(`x2ai-avatar:char-settings`).

### Character packs

| pack | source | characters | in git |
| --- | --- | --- | --- |
| `pixel` | our frames in `packs/pixel/` | 5 | yes |
| `anime` | LivLiv models, built locally | 10 | no, folder is in `.gitignore` |

The pixel pack is the main one: it is in the repository and works without a
network. The anime pack is optional and built locally from public LivLiv models;
finished frames are not published because of the license.

A pack may be incomplete: if the active pack has no frames for a voice, the
plugin takes the same character from the anime pack, and if that is missing too,
the base sprite.

### Voices and characters

| voice | pixel pack | anime pack | processing |
| --- | --- | --- | --- |
| `ru_f1` | Tyanka | Anya | — |
| `ru_f2` | — | Mila | — |
| `ru_m1` | Programmer | Grisha | — |
| `ru_m5` | — | Timur | — |
| `fx_robot` | Robot | Robik | 55 Hz ring, 7 bit |
| `fx_demoness` | Demoness | Azazel | pitch −16 %, vibrato, drive, reverb |
| `fx_alien` | — | Zeta | pitch +16 %, 5 Hz vibrato |
| `fx_cat` | — | Murzik | pitch +34 % |
| `fx_penguin` | Alien | Piko | pitch +55 %, 7 Hz vibrato |
| `fx_ghost` | — | Yuki | reverb 0.55 |

The chat voice is chosen by a `sessionID` hash with the same code in the
voice-over plugin and the character plugin, so the picture and the voice never
diverge. The choice is stored per chat in `~/.config/opencode/x2ai-voices.json`.

### English voices

Six TeraTTS voices are available for English: `eng_f3`, `eng_f4_whisper`,
`eng_f5`, `eng_m2_whisper`, `eng_m3`, `eng_m4`. The panel shows only voices for
the current language, and every character has a default English voice:

| Russian voice | default English |
| --- | --- |
| `ru_f1` (Tyanka, Anya) | `eng_f5` for Tyanka, `eng_f3` for Anya |
| `ru_f2` (Mila) | `eng_f5` |
| `ru_m1` (Programmer, Grisha) | `eng_m3` |
| `ru_m5` (Timur) | `eng_m4` |
| `fx_demoness` (Demoness) | `eng_f3` |
| `fx_alien`, `fx_cat` | `eng_f5` |
| `fx_ghost` | `eng_f4_whisper` |
| `fx_robot`, `fx_demon` | `eng_m3` / `eng_m4` |
| `fx_penguin` | `eng_m2_whisper` |

The voice choice is stored separately per language: switching RU ↔ EN does not
reset the other language's settings.

### Languages

Top right of the main menu there are two buttons: **EN / RU**.

- **RU** — Russian interface, summaries, and voice-over.
- **EN** — English interface, summaries, and voice-over.

The language is stored in the window's `localStorage` (`x2ai-avatar:lang`) and
mirrored to `~/.config/opencode/x2ai-speech.json` (`lang`), so summaries and
reasoning translation use the same language as the voice-over.

### Platforms

- **macOS** — the primary platform, fully tested.
- **Linux** — supported. Playback uses the first available player: `paplay`
  (pulseaudio-utils), `aplay` (alsa-utils), `ffplay` (ffmpeg), or `play` (sox).
  Install any of them:

  ```sh
  sudo apt install alsa-utils        # Debian/Ubuntu
  sudo dnf install alsa-utils        # Fedora
  ```

  Everything else (unix socket, `flock`, `setproctitle`, ONNX CPU) works the
  same, with the same paths — `~/.config/opencode/...`.
- **Windows** — untested: there was no Windows machine on hand, so nobody has
  verified it. The port is small and testers are welcome. The server is started
  by a shell script, listens on a unix socket, locks with `fcntl.flock`, and
  plays audio with `afplay` / `paplay`; on Windows that becomes a `.cmd`
  launcher, a TCP port instead of a unix socket, and `ffplay`. What to install:
  1. **Python 3.11+** from python.org, tick "Add python.exe to PATH".
  2. **FFmpeg** — `winget install Gyan.FFmpeg` (it provides `ffplay`).
  3. **OpenCode Desktop** and the plugin files: `gui-experimental.cjs` into
     `%USERPROFILE%\.config\opencode\plugins\x2ai-avatar\`,
     `x2ai-tts-done.js` into `%USERPROFILE%\.config\opencode\plugins\`,
     the `x2ai-teratts\` folder into `%USERPROFILE%\.config\opencode\`.
  4. The TeraTTS model as in "Voice engine" above, same paths.
  What to expect: the UI, sprites and settings work right away; sound and lip
  sync need the socket and launcher ported first. If you want to help, run it,
  send us what breaks, and we will finish Windows support together.

### Build

```sh
python3 tools/pack_sprites.py   # packs/*/sprites.json -> plugins/x2ai-avatar/sprites.json
python3 tools/build.py          # template + sprites + lines -> gui-experimental.cjs
python3 tools/smoke.py          # quick check that nothing is broken
```

`tools/pack_sprites.py` merges the per-pack `sprites.json` files into one. If a
pack folder has no `sprites.json` but has per-character PNG frames, the file is
built from them. Pixel characters get a `px_` prefix in the merged file so they
never collide with the anime pack.

Deploy after building:

```sh
cp plugins/x2ai-avatar/gui-experimental.cjs ~/.config/opencode/plugins/x2ai-avatar/
cp plugins/x2ai-tts-done.js ~/.config/opencode/plugins/
```

The GUI picks changes up after `Cmd+R` in the window. The server plugin reloads
by itself.

### Custom characters

The plugin does not draw mouth and eyes as separate layers: it keeps one
**complete frame** per state and swaps the image. Custom characters are a set of
same-size PNGs with a transparent background and the same head position:

```
packs/<pack>/<voice>/closed.png   # mouth closed, eyes open — required
packs/<pack>/<voice>/open.png     # mouth open            — required
packs/<pack>/<voice>/half.png     # slightly open         — optional
packs/<pack>/<voice>/round.png    # "o"                   — optional
packs/<pack>/<voice>/wide.png     # wide                  — optional
packs/<pack>/<voice>/blink.png    # eyes closed           — optional
```

Missing states fall back: `half`, `round`, and `wide` use `open.png`; `blink`
uses `closed.png`. Two frames are enough for a moving mouth.

Frames are scaled to 336 px in height. Keeping the same size matters: otherwise
the head jumps between states. After adding frames:

```sh
python3 tools/pack_sprites.py && python3 tools/build.py
```

`<voice>` is an id from the table above. A brand-new character also needs a name
in `CHAR_NAMES` (`plugins/x2ai-avatar/gui.template.cjs`) or a custom name in the
panel.

### How the window knows the character is speaking

The GUI plugin in the window has no file access. The voice-over plugin starts a
tiny HTTP bridge on `127.0.0.1:47821` (the port can be overridden with
`X2AI_BRIDGE_PORT`):

| route | purpose |
| --- | --- |
| `GET /state` | what is playing: phrase time left, chat, voice, text |
| `POST /voice` | remember the character and its name for a chat |
| `POST /speech` | modes, speed, quiet hours, language, mute |
| `POST /limits` | summary length limits for a character |
| `POST /say` | speak a phrase in the character's voice |
| `POST /test` | test phrase |
| `POST /stop` | stop the current voice-over |

The window polls `/state` every 250 ms and moves the lips only when `sid`
matches the open chat — speech in another chat does not start the animation.

### Gender and name rules

For the first message of a chat the plugin adds system instructions: the
character name, its gender (from the voice), and the user's name and gender
(from settings). They are invisible in the conversation. The list of chats that
already received the rules is kept in
`~/.config/opencode/x2ai-rules-seen.json`, so a plugin reload does not repeat
them on every step.

### Support the author

The plugin is free and works offline. If it helped, here are the wallets:

- **BTC** — `bc1p67wgr4qpp84v8zjnufhrhn62sspke4m4np5cc0slmqnsvgt7vlgqxldjux`
- **ETH / BNB and other EVM chains** — `0xC74bF5C4Fc00656F713DA4FBC210C750434C662C`
- **SOL** — `DkKAewrMxWk8qHgk5jPorFaZeQzQXFc7p7Kygv5VYuYL`
- **TON** — `UQC2EciOqkEqAqWMN8wyj06Y4crwabnaJg7NGffuC1Byz4U3`
- **TRX** — `THEdtg5faibdsgNjxurRu6MRNwS9Vkt4aW`

### Licenses

- Code — MIT.
- Pixel pack — our own frames, included in the repository.
- Anime pack — LivLiv characters (livliv.ai), LivLiv Featured Characters License
  1.0: free for non-commercial use with attribution. Finished frames are not
  published in the repository.
- TeraTTSv2 — OpenRAIL-M, attribution TeraSpace.

### Disable

Remove the plugins from `plugins` in `opencode.jsonc`, or create
`~/.config/opencode/x2ai-tts-done.disabled`.
