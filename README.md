# x2ai-voice-avatar — персонаж с голосом в окне OpenCode Desktop

Локальная озвучка ответов агента плюс аниме-спрайт в левом нижнем углу окна,
который совпадает с голосом текущего чата: говорит, шевелит ртом ровно пока
звучит wav, моргает в тишине и отвечает короткой репликой на клик.

Всё работает офлайн: синтез — TeraTTSv2 (ONNX, CPU), без облака и без torch.

## Что внутри

| путь | что это |
| --- | --- |
| `plugins/x2ai-tts-done.js` | плагин озвучки: ловит конец ответа, делает короткий пересказ, согласует род, зовёт TeraTTS |
| `plugins/x2ai-avatar/gui.template.cjs` | GUI-плагин персонажа (шаблон без payload'ов) |
| `plugins/x2ai-avatar/gen-clicks.py` | генератор реплик на клик |
| `tools/build.py` | собирает `gui-experimental.cjs` из шаблона + payload'ов |
| `tools/build_sprites.py` | собирает кадры персонажей из моделей LivLiv |
| `x2ai-teratts/server.py` | тёплый TTS-демон на unix-сокете |
| `x2ai-teratts/x2ai-teratts-speak` | клиент: `echo "текст" \| x2ai-teratts-speak` |
| `x2ai-teratts/x2ai-teratts-set` | сменить голос по умолчанию |

## Установка

1. **Модель и venv TeraTTS.** Скачать `TeraSpace/TeraTTSv2` с Hugging Face
   в `~/.config/opencode/teratts-model` (нужны `text_encoder.onnx`,
   `duration_predictor.onnx`, `sampler_distilled_cfg3_8step.onnx`,
   `vocoder.onnx`, `styles/`, `ruaccent/`, `teratts.py`, `unicode_indexer.json`)
   и поставить зависимости:

   ```sh
   python3 -m venv ~/.config/opencode/teratts-venv
   ~/.config/opencode/teratts-venv/bin/pip install \
     numpy onnxruntime transformers num2words huggingface_hub pillow
   ```

2. **Сервер и клиенты.**

   ```sh
   mkdir -p ~/.config/opencode/x2ai-teratts
   cp x2ai-teratts/* ~/.config/opencode/x2ai-teratts/
   chmod +x ~/.config/opencode/x2ai-teratts/x2ai-teratts-*
   echo "Привет, это проверка" | ~/.config/opencode/x2ai-teratts/x2ai-teratts-speak
   ```

   Первый вызов поднимает демон (загрузка модели ~7 с), дальше фраза
   синтезируется за 0.3–1.1 с.

3. **Плагины.** Скопировать `plugins/x2ai-tts-done.js` и каталог
   `plugins/x2ai-avatar` в `~/.config/opencode/plugins/`, затем собрать
   персонажа:

   ```sh
   cd ~/.config/opencode/plugins/x2ai-avatar
   ~/.config/opencode/teratts-venv/bin/python gen-clicks.py   # реплики на клик
   python3 /путь/к/репозиторию/tools/build.py                 # склейка в gui-experimental.cjs
   ```

   Спрайты в репозиторий не входят (см. «Лицензии»), их надо собрать
   локально скриптом `tools/build_sprites.py` — он скачивает модели
   `livliv-dev/player` и раскрашивает персонажей.

4. **Подключить в конфиге** `~/.config/opencode/opencode.jsonc`:

   ```jsonc
   {
     "plugins": [
       "~/.config/opencode/plugins/x2ai-tts-done.js",
       "~/.config/opencode/plugins/x2ai-avatar"
     ]
   }
   ```

## Голоса и персонажи

10 голосов, по одному на персонажа. Первые четыре — чистые голоса TeraTTS,
остальные — те же голоса с обработкой (питч, вибрато, кольцевая модуляция,
биткраш, перегрузка, реверб) в `server.py`.

| голос | персонаж | обработка |
| --- | --- | --- |
| `ru_f1` | Аня | — |
| `ru_f2` | Мила | — |
| `ru_m1` | Гриша | — |
| `ru_m5` | Тимур | — |
| `fx_robot` | Робик | кольцо 55 Гц, 7 бит |
| `fx_demon` | Азазель | питч −20 %, драйв, реверб |
| `fx_alien` | Зета | питч +16 %, вибрато 5 Гц |
| `fx_cat` | Мурзик | питч +34 % |
| `fx_penguin` | Пико | питч +55 %, вибрато 7 Гц |
| `fx_ghost` | Юки | реверб 0.55 |

Голос чата выбирается хешем `sessionID` — и в плагине озвучки, и в плагине
персонажа одним и тем же кодом, поэтому картинка и голос не расходятся.

**Правый клик по персонажу** переключает на следующего вместе с его голосом
и запоминает выбор за текущим чатом в `~/.config/opencode/x2ai-voices.json`.
Озвучка читает этот файл и говорит выбранным голосом.

**Левый клик** проигрывает короткую заранее сгенерированную реплику
(10 фраз на голос, m4a внутри плагина). Новая реплика глушит предыдущую и
текущую озвучку ответа — одновременно звучит только один голос.

## Как окно узнаёт, что персонаж говорит

GUI-плагин в окне не имеет доступа к файлам и не может вызвать main-процесс
напрямую (`ctx.provide` с Ipc в экспериментальном API молча зависает).
Поэтому озвучка поднимает крошечный HTTP-мост на `127.0.0.1:47821`
(порт переопределяется `X2AI_BRIDGE_PORT`):

| маршрут | что делает |
| --- | --- |
| `GET /state` | `{speaking, ms, sid, voices}` — остаток текущей фразы, её чат и карта «чат → голос» |
| `POST /voice` | `{sid, voice}` — запомнить выбор персонажа за чатом |
| `POST /stop` | заглушить текущую озвучку |

Окно опрашивает `/state` раз в 250 мс и двигает губами только если
`sid` совпадает с открытым чатом — речь в другом чате анимацию не запускает.

**Если открыт правый блок** (панели вроде «Перевод рассуждений»), колонка
чата сужается и персонаж начал бы перекрывать поле ввода — на это время
он скрывается (`ctx.layout.side.opened()`).

## Род в пересказе

Пересказ ответа делается бесплатной моделью, и в промпт подставляется род
текущего голоса: женские голоса говорят «я проверила», мужские — «я проверил».
Отдельным правилом зафиксировано, что пользователь — мужчина: «ты проверил»,
«ты прав» остаются в мужском роде при любом голосе.

## Лицензии

- Код — MIT.
- Спрайты: персонажи LivLiv (livliv.ai), лицензия LivLiv Featured Characters
  1.0 — бесплатно для некоммерческого использования с указанием авторства.
  Поэтому готовые кадры в репозитории не публикуются: `tools/build_sprites.py`
  собирает их локально из публичных моделей `livliv-dev/player`.
- TeraTTSv2 — OpenRAIL-M, атрибуция TeraSpace.

## Отключить

Убрать плагины из `plugins` в `opencode.jsonc` либо создать
`~/.config/opencode/x2ai-tts-done.disabled`.
