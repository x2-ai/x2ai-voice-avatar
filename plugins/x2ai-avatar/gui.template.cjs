// x2ai-avatar — аниме-спрайт в левом нижнем углу окна OpenCode Desktop.
// Персонаж соответствует голосу озвучки текущего чата: голос выбирается тем же
// хешем sessionID, что в plugins/x2ai-tts-done.js, поэтому «кто говорит» и «кто
// нарисован» всегда совпадают.
//
// Спрайты: LivLiv (livliv.ai), LivLiv Featured Characters License 1.0 —
// некоммерческое использование с указанием авторства. Кадры рта и моргания
// собраны из слоёв characters/ репозитория livliv-dev/player (см. sprites.cjs).
//
// Пишем на чистом DOM: так же, как x2ai-reasoning-translate, без сборки.

const { Plugin, Slot, createKeyed } = require("@opencode/plugin/gui");
const { createEffect, onCleanup } = require("solid-js");

// Канал «сервер → окно»: обычный HTTP-мост на 127.0.0.1, поднятый серверным
// плагином x2ai-tts-done.js. Ipc в этой сборке приложения недоступен, поэтому
// окно просто опрашивает /state и не зависит от main-процесса.
const BRIDGE_URL = "http://127.0.0.1:47821";

// Кадры паков в бандл не зашиты: они лежат файлами (plugins/x2ai-avatar/packs)
// и приходят с моста /pack — окно грузит только выбранный пак. Здесь только
// манифест: какие паки есть и какие персонажи в них.
const PACKS = {};
const PACK_INDEX = __PACK_INDEX__;
const packList = () => Object.keys(PACK_INDEX);
const CLICKS = __CLICKS__;
// Партитура рта: чистые функции из plugins/x2ai-avatar/talk-plan.js — та же
// логика проверяется тестом tools/test_talk_plan.js.
__TALK_PLAN__
const TALKPLAN = x2aiTalkPlanModule();
// Реплики панели: lines (при смене персонажа), packs (при смене пака), samples (пример голоса).
const LINES = __LINES__;

// Мужской «демон» остался голосом в меню, но спрайт у него тот же — демонесса.
const SPRITE_ALIAS = {};
const CHAR_NAMES = {
  anime: {
    ru_f1: "Аня", ru_f2: "Мила", ru_m1: "Гриша", ru_m5: "Тимур",
    fx_robot: "Робик", fx_demoness: "Азазель", fx_alien: "Зета",
    fx_cat: "Мурзик", fx_penguin: "Пико", fx_ghost: "Юки",
  },
  pixel: {
    px_ru_f1: "Тянка", px_fx_robot: "Робот", px_fx_demoness: "Демонесса",
    px_fx_penguin: "Инопланетянин", px_ru_m1: "Программист",
  },
};

// Имя зависит от пака: в пиксельном свои названия, в аниме — прежние.
function nameFor(voice) {
  const pack = CHAR_NAMES[activePack] || {};
  const key = packKey(voice);
  return pack[key] || CHAR_NAMES.anime[key] || CHAR_NAMES.anime[voice] || voice;
}
// Детализация пересказа: 0 — совсем коротко, 1 — подробно, 0.5 = 400 символов.
const detailChars = (v) => {
  const k = Math.min(1, Math.max(0, Number(v)));
  return Math.round((120 + k * 560) / 10) * 10;
};

const HEIGHT = 224; // px на экране (спрайты 336 px)

// Размер персонажа настраивается в панели и живёт в localStorage окна.
const HEIGHT_KEY = "x2ai-avatar:height";
const HEIGHT_MIN = 120;
const HEIGHT_MAX = 420;
let charHeight = HEIGHT;
try {
  const savedHeight = Number(window.localStorage.getItem(HEIGHT_KEY));
  if (Number.isFinite(savedHeight) && savedHeight >= HEIGHT_MIN && savedHeight <= HEIGHT_MAX) {
    charHeight = savedHeight;
  }
} catch (e) {}

// Размер по умолчанию: у персонажа может быть свой, он лежит в localStorage.
const DEFAULT_HEIGHT = charHeight;

// Индивидуальные настройки персонажа: размер, голос, озвучка ответа и рассуждений.
// Ключ — id персонажа внутри пака (px_ru_f1, fx_cat), поэтому паки не пересекаются.
const CHAR_SETTINGS_KEY = "x2ai-avatar:char-settings";
let charSettings = {};
try {
  const raw = JSON.parse(localStorage.getItem(CHAR_SETTINGS_KEY) || "{}");
  if (raw && typeof raw === "object") charSettings = raw;
} catch (e) {}
const charSettingsFor = (key) => (key && charSettings[key]) || {};
const saveCharSetting = (key, patch) => {
  if (!key) return;
  charSettings[key] = { ...charSettingsFor(key), ...patch };
  try {
    localStorage.setItem(CHAR_SETTINGS_KEY, JSON.stringify(charSettings));
  } catch (e) {}
};

// Кошельки для доната: список пуст — в панели вежливая заглушка.
// Формат записи: { net: "TON", addr: "UQ…" }.
const DONATE = [
  { net: "BTC", addr: "bc1p67wgr4qpp84v8zjnufhrhn62sspke4m4np5cc0slmqnsvgt7vlgqxldjux" },
  { net: "EVM", addr: "0xC74bF5C4Fc00656F713DA4FBC210C750434C662C", note: "ETH, BNB и другие сети" },
  { net: "SOL", addr: "DkKAewrMxWk8qHgk5jPorFaZeQzQXFc7p7Kygv5VYuYL" },
  { net: "TON", addr: "UQC2EciOqkEqAqWMN8wyj06Y4crwabnaJg7NGffuC1Byz4U3" },
  { net: "TRX", addr: "THEdtg5faibdsgNjxurRu6MRNwS9Vkt4aW" },
];

// Окно: мелочи интерфейса, которые не касаются движка и живут в localStorage.
const UI_KEY = "x2ai-avatar:ui";
// Пузырь с текстом: "off" — не показывать, "mute" — только при выключенном
// звуке (по умолчанию), "always" — показывать всегда.
const BUBBLE_MODES = ["off", "mute", "always"];
const UI_DEFAULT = { bubble: "mute", keys: true, react: true };
let uiPrefs = { ...UI_DEFAULT };
try {
  const raw = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
  if (raw && typeof raw === "object") {
    // Старая настройка была галочкой: true/false превращаем в режим.
    // Старый чекбокс: включён — показывали всегда, значит «always» (а не «mute»),
    // иначе после обновления пузырь у тех, кто его включил, молча исчезает.
    if (typeof raw.bubble === "boolean") raw.bubble = raw.bubble ? "always" : "off";
    if (!BUBBLE_MODES.includes(raw.bubble)) delete raw.bubble;
    uiPrefs = { ...UI_DEFAULT, ...raw };
  }
} catch (e) {}
const saveUiPref = (patch) => {
  uiPrefs = { ...uiPrefs, ...patch };
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(uiPrefs));
  } catch (e) {}
};

// Дефолтные имена по-английски. Своё имя, введённое пользователем, важнее
// и никогда не переводится.
const CHAR_NAMES_EN = {
  ru_f1: "Anya", ru_f2: "Mila", ru_m1: "Grisha", ru_m5: "Timur",
  fx_robot: "Robik", fx_demoness: "Azazel", fx_alien: "Zeta",
  fx_cat: "Murzik", fx_penguin: "Piko", fx_ghost: "Yuki",
  px_ru_f1: "Tyanka", px_fx_robot: "Robot", px_fx_demoness: "Demoness",
  px_fx_penguin: "Alien", px_ru_m1: "Programmer",
};
const charName = (key) => {
  const k = packKey(key);
  const custom = (charSettingsFor(k).name || "").trim();
  if (custom) return custom;
  const base = nameFor(k);
  return activeLang === "ru" ? base : CHAR_NAMES_EN[k] || base;
};
// Характер — галочка в настройках персонажа: сервер добавляет в правила чата
// не только имя и род, но и манеру речи. По умолчанию выключен.
const charTemper = (key) => Boolean(charSettingsFor(packKey(key)).temper);
// По умолчанию персонаж реагирует на ошибки: выключено только явно.
const charReact = (key) => charSettingsFor(packKey(key)).react !== false;

// Окраска — это и интонация, и темп. Значения в шкале движка (множитель
// длительности): 0.87 — быстрее, 1.18 — медленнее. 0 = общий темп.
const EMO_SPEED = { "": 0, up: 0.87, think: 1, down: 1.18 };
const emoSpeed = (emo) =>
  Object.prototype.hasOwnProperty.call(EMO_SPEED, emo) ? EMO_SPEED[emo] : 0;
// «Настроить»: окраска выбирается по темпу — быстро бодро, медленно устало.
const speedEmotion = (engine) => {
  const shown = 1 / (Number(engine) || 1);
  if (shown >= 1.15) return "up";
  if (shown <= 0.88) return "down";
  return "";
};

// Какие персонажи пака доступны: для новых чатов и для кнопки смены.
const ENABLED_KEY = "x2ai-avatar:enabled";
let enabledMap = {};
try {
  const raw = JSON.parse(localStorage.getItem(ENABLED_KEY) || "{}");
  if (raw && typeof raw === "object") enabledMap = raw;
} catch (e) {}
const enabledChars = (pack) => {
  const name = pack || activePack;
  const all = packVoices(name);
  const saved = enabledMap[name];
  if (!Array.isArray(saved)) return all;
  const list = all.filter((key) => saved.includes(key));
  // Пустой список оставил бы новые чаты без персонажа — тогда доступны все.
  return list.length ? list : all;
};
const isCharEnabled = (key) => enabledChars().includes(packKey(key));
const setCharEnabled = (key, on) => {
  const all = packVoices();
  const cur = enabledChars();
  const next = all.filter((k) => (on ? cur.includes(k) || k === key : cur.includes(k) && k !== key));
  if (!next.length) return false;
  enabledMap[activePack] = next;
  try {
    localStorage.setItem(ENABLED_KEY, JSON.stringify(enabledMap));
  } catch (e) {}
  return true;
};

// Порядок голосов TeraTTS: он же в серверном плагине, поэтому хеш чата
// превращается в одного и того же персонажа и в окне, и в озвучке.
const TERA_ORDER = [
  "ru_f1", "ru_f2", "ru_m1", "ru_m5",
  "fx_robot", "fx_demon", "fx_demoness", "fx_alien", "fx_cat", "fx_penguin", "fx_ghost",
];
const baseVoice = (key) => String(key || "").replace(/^px_/, "");
const enabledBases = () => {
  const keys = enabledChars();
  return TERA_ORDER.filter((base) => keys.some((key) => baseVoice(key) === base));
};

// Артикуляция: набор кадров рта в порядке «полуоткрыт → открыт → округлён → широко».
const TALK = ["half", "open", "round", "wide", "open", "half"];

function hash(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) | 0;
  return String(h);
}

function voiceFor(sid) {
  const bases = enabledBases();
  const pool = bases.length ? bases : TERA_ORDER;
  if (!pool.length) return "ru_f1";
  const base = pool[Math.abs(Number(hash(sid)) | 0) % pool.length];
  const pack = PACKS[activePack] || {};
  if (pack[`px_${base}`]) return `px_${base}`;
  if (pack[base]) return base;
  return base;
}

// Паки: наши кадры и скачанные по лицензии. Пак может быть неполным —
// отсутствующий персонаж берётся из базового пака "anime".
const PACK_NAMES = { anime: "Аниме", pixel: "Пиксельарт" };
const PACK_KEY = "x2ai-avatar:pack";

let activePack = "pixel";
try {
  const saved = localStorage.getItem(PACK_KEY);
  if (saved && PACK_INDEX[saved]) activePack = saved;
  else if (!PACK_INDEX.pixel || !PACK_INDEX.pixel.length) activePack = "anime";
} catch (e) {}
if (!PACK_INDEX[activePack]) activePack = packList()[0] || "pixel";

// Язык интерфейса: кнопки EN/RU справа вверху главного меню.
// Ключ словаря — русская строка, поэтому t() можно звать где угодно и она
// вернёт исходник, если перевода нет (имена персонажей и моделей не трогаем).
const LANG_KEY = "x2ai-avatar:lang";
const LANGS = [
  ["en", "EN"],
  ["ru", "RU"],
];
let activeLang = "ru";
try {
  const saved = localStorage.getItem(LANG_KEY);
  if (LANGS.some(([code]) => code === saved)) activeLang = saved;
} catch (e) {}

const I18N = {
  ru: {},
  en: {
    "Данные пользователя": "User data",
    "Настройка персонажей": "Characters",
    "Вспомогательная модель": "Helper model",
    "Дополнительно": "Advanced",
    "Общие настройки": "General settings",
    "Поддержать автора": "Support the author",
    "Плагин бесплатный и работает офлайн. Если он пригодился — вот кошельки.":
      "The plugin is free and works offline. If it helped, here are the wallets.",
    "Кошельки скоро появятся.": "Wallets will appear here soon.",
    "Нажми, чтобы скопировать": "Click to copy",
    "Скопировано": "Copied",
    "ETH, BNB и другие сети": "ETH, BNB and other EVM chains",
    "Модель не выбрана": "No model selected",
    "← Назад": "← Back",
    "Свой характер (пусто — готовый)": "Custom character (empty — preset)",
    "Например: «говори дерзко, подкалывай, но по делу». Пусто — готовый характер.":
      "For example: “speak boldly, tease, but stay on point”. Empty — the preset.",
    "Манера речи": "Speech style",
    "Окраска": "Tone",
    "Без окраски": "Neutral",
    "Настроить": "Custom",
    "Бодро": "Cheerful",
    "Задумчиво": "Thoughtful",
    "Устало": "Tired",
    "Окраска задаёт и интонацию, и темп: бодро — быстрее, устало — медленнее. «Настроить» — свой темп, окраска подберётся по нему. Реплика прозвучит сразу после изменения.":
      "Tone sets both intonation and tempo: cheerful is faster, tired is slower. Custom sets your own tempo and picks the tone for it. A sample plays right after you change them.",
    "Активировать": "Enable",
    "Пузырь с текстом": "Text bubble",
    "Не показывать": "Don't show",
    "Только при отключённом звуке": "Only when muted",
    "Показывать всегда": "Always show",
    "Короткая фраза, которую персонаж говорит сейчас. Если озвучка ответа или рассуждений выключена, пузырь не появляется.":
      "The short line the character is saying now. If answer or reasoning speech is off, the bubble never shows.",
    "Короткая фраза, которую персонаж говорит сейчас.": "The short phrase being spoken now.",
    "Горячие клавиши": "Hotkeys",
    "⌘/Ctrl+Shift+M — звук, +S — стоп, +A — панель.": "⌘/Ctrl+Shift+M — mute, +S — stop, +A — panel.",
    "Живой персонаж": "Living character",
    "Хмурится, когда инструмент или ответ упал.": "Frowns when a tool or an answer fails.",
    "Экспортировать настройки": "Export settings",
    "Импортировать настройки": "Import settings",
    "Сохранено: {p}": "Saved: {p}",
    "Не сохранилось": "Not saved",
    "Файла нет": "No file",
    "Загружено персонажей: {n}": "Characters loaded: {n}",
    "Имя (необязательно)": "Name (optional)",
    "Как обращаться к тебе в пересказе": "How to address you in the summary",
    "Не указан": "Not specified",
    "Мужской": "Male",
    "Женский": "Female",
    "Пак персонажей": "Character pack",
    "Доступен для новых чатов": "Available for new chats",
    "Выключен": "Disabled",
    "Выбрать персонажа": "Select character",
    "Персонаж выключен": "Character is off",
    "Настройки персонажа": "Character settings",
    "Галочка — персонаж доступен в новых чатах и при смене. Снятая — уже выбранного не убирает.":
      "Checked — the character is available in new chats and when switching. Unchecking does not remove the current one.",
    "Персонаж выключен: в новых чатах не появится, включить в текущем чате нельзя.":
      "The character is off: it will not appear in new chats and cannot be enabled in this chat.",
    "Размер персонажа": "Character size",
    "Голос персонажа": "Character voice",
    "загружаю голоса…": "loading voices…",
    "По умолчанию": "Default",
    "сейчас: {v}": "now: {v}",
    "Имя персонажа": "Character name",
    "Пусто — имя по умолчанию. Своё имя не переводится.":
      "Empty — the default name is used. A custom name is never translated.",
    "Озвучка ответа": "Answer speech",
    "Выключено": "Off",
    "Кратко": "Brief",
    "Полностью": "Full",
    "озвучки не будет": "no speech",
    "Нужно выбрать вспомогательную модель": "Choose a helper model first",
    "Озвучка рассуждений": "Reasoning speech",
    "Переводить на {lang}": "Translate into {lang}",
    "русский": "Russian",
    "английский": "English",
    "Не читает и не озвучивает ответы сама: сжимает текст для «Кратко» и переводит рассуждения на язык озвучки, если включён перевод. Локальные и бесплатные модели — в начале списка.":
      "Does not read or voice answers itself: it shortens the text for Brief mode and translates reasoning into the speech language when translation is on. Local and free models come first.",
    "Отключено": "Off",
    "Включено": "On",
    "Поиск модели": "Search model",
    "не удалось получить список": "could not load the list",
    "локальных и бесплатных моделей нет": "no local or free models",
    "{name} · локальная": "{name} · local",
    "Показать ещё {n}": "Show {n} more",
    "всего подходит: {n}": "total matching: {n}",
    "загружаю…": "loading…",
    "мост недоступен": "bridge unavailable",
    "Общие настройки движка: действуют на всех персонажей.": "Engine settings shared by all characters.",
    "Тихие часы": "Quiet hours",
    "выкл": "off",
    "вкл": "on",
    "Держать движок в памяти": "Keep the engine in memory",
    "движок занимает ~1.7 ГБ и отвечает за полсекунды": "the engine takes ~1.7 GB and answers in half a second",
    "по требованию: каждая фраза ~9 с на загрузку, память свободна":
      "on demand: ~9 s to load each phrase, memory stays free",
    "Короче": "Shorter",
    "Подробнее": "More detail",
    "≈ {n} символов": "≈ {n} characters",
    "Озвучено ответов: {n} · всего речи: {m} мин {s} с": "Answers spoken: {n} · total speech: {m} min {s} s",
    "Сбросить": "Reset",
    "Озвучено ответов: {n} · речи: {m} мин": "Answers spoken: {n} · speech: {m} min",
    "спит": "asleep",
    "злится": "angry",
    "Аниме": "Anime",
    "Характер": "Character",
    "Добавляет в чат манеру речи персонажа: как он шутит, злится и разговаривает.":
      "Adds the character's way of speaking to the chat: how they joke, get annoyed and talk.",
    "Пиксельарт": "Pixel art",
    "Следующий персонаж из пака": "Next character from the pack",
    "Выключить озвучку": "Mute speech",
    "Включить озвучку": "Unmute speech",
  },
};

const t = (s) => (I18N[activeLang] && I18N[activeLang][s]) || s;
const tf = (s, vars) => {
  let out = t(s);
  for (const k of Object.keys(vars || {})) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
};

// Язык озвучки: движок TeraTTSv2 знает только русский и английский.
const voiceLang = () => (activeLang === "ru" ? "ru" : "en");
const LANG_NAME = { ru: "русский", en: "английский" };

// Голоса по умолчанию для английского: подобраны по полу и характеру
// русского голоса персонажа. Русские голоса остаются исходными.
const EN_VOICE_BY_BASE = {
  ru_f1: "eng_f3",
  ru_f2: "eng_f5",
  ru_m1: "eng_m3",
  ru_m5: "eng_m4",
  fx_robot: "eng_m3",
  fx_demon: "eng_m4",
  fx_demoness: "eng_f3",
  fx_alien: "eng_f5",
  fx_cat: "eng_f5",
  fx_penguin: "eng_m2_whisper",
  fx_ghost: "eng_f4_whisper",
};
// Точечные исключения по id персонажа: важнее общей привязки по голосу.
const EN_VOICE_BY_KEY = { px_ru_f1: "eng_f5" };
const defaultVoiceFor = (base, lang, key) => {
  if (lang === "ru") return base;
  if (key && EN_VOICE_BY_KEY[key]) return EN_VOICE_BY_KEY[key];
  if (EN_VOICE_BY_BASE[base]) return EN_VOICE_BY_BASE[base];
  return /_m$|^fx_(robot|demon|penguin)$/.test(base) ? "eng_m3" : "eng_f3";
};

// Персонажи пака известны из манифеста, кадры могут быть ещё не загружены.
function packVoices(name) {
  const key = name || activePack;
  const pack = PACKS[key] || {};
  const list = Object.keys(pack).length ? Object.keys(pack) : PACK_INDEX[key] || [];
  return list.filter((voice) => !pack[voice] || (pack[voice] && pack[voice].closed));
}

function setPack(name) {
  if (!PACK_INDEX[name]) return;
  activePack = name;
  try {
    localStorage.setItem(PACK_KEY, name);
  } catch (e) {}
}

// Ключ персонажа внутри пака: у пиксельного пака id с префиксом px_,
// а голос чата может быть без него (ru_f1 вместо px_ru_f1).
function packKey(voice) {
  const key = SPRITE_ALIAS[voice] || voice;
  const known = packVoices();
  if (known.includes(key)) return key;
  const prefixed = "px_" + key;
  if (known.includes(prefixed)) return prefixed;
  const bare = key.replace(/^px_/, "");
  if (known.includes(bare)) return bare;
  return key;
}

// Прозрачный пиксель: кадры пака приходят с моста асинхронно, и до ответа
// картинка не должна ломаться (битый src вместо пустого места).
const EMPTY_FRAME =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function frame(voice, state) {
  const key = packKey(voice);
  const pack = PACKS[activePack] || {};
  const base = PACKS.anime || {};
  const set = pack[key] || base[key] || base.ru_f1 || EMPTY_FRAME;
  if (typeof set === "string") return set; // пустой пак ещё не загружен
  return set[state] || set.closed || EMPTY_FRAME;
}

// Таймеры пинга живут на уровне модуля: при повторном рендере слота старый
// вид не должен продолжать напоминать своим таймером.
const PING = { timers: new Map(), delays: new Map(), activity: new Map(), say: null };
function pingReset() {
  for (const t of PING.timers.values()) clearTimeout(t);
  PING.timers.clear();
  PING.delays.clear();
  PING.activity.clear();
}

function createView(ctx) {
  // Слот может рендериться повторно: прежний вид надо погасить, иначе
  // остаются его таймеры и подписки (двойные реплики, двойные пинги).
  if (typeof globalThis.__x2aiAvatarTeardown === "function") {
    try {
      globalThis.__x2aiAvatarTeardown();
    } catch (e) {}
  }

  const root = document.createElement("div");
  // Нулевая высота: полоса не занимает места, персонаж висит поверх окна.
  root.style.cssText =
    "position:relative;height:0;width:100%;pointer-events:none;user-select:none;";

  const box = document.createElement("div");
  box.style.cssText = [
    "position:absolute",
    "left:10px",
    "bottom:2px",
    "pointer-events:auto",
    "cursor:pointer",
    "display:flex",
    "align-items:flex-end",
    "line-height:0",
    "transition:transform 140ms ease",
    "transform-origin:50% 100%",
  ].join(";");
  root.appendChild(box);

  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.style.cssText = [
    `height:${charHeight}px`,
    "width:auto",
    "display:block",
    "filter:drop-shadow(0 2px 6px rgba(0,0,0,.28))",
    "transition:opacity 90ms linear",
  ].join(";");
  box.appendChild(img);

  // Бейдж: сколько ответов озвучено и сколько шёл последний.
  const badge = document.createElement("div");
  badge.style.cssText = [
    "margin-left:5px",
    "align-self:flex-end",
    "font-size:10px",
    "line-height:1",
    "opacity:.55",
    "white-space:nowrap",
    "pointer-events:auto",
    "text-shadow:0 1px 2px rgba(0,0,0,.55)",
  ].join(";");
  box.appendChild(badge);

  let evCount = 0;
  let lastSid = "";

  // Настроение персонажа: awake | sad | sleeping. Храним в объекте, чтобы
  // функции, объявленные выше, могли читать его без TDZ.
  const moodState = { value: "awake" };

  let voice = "ru_f1";
  img.src = frame(voice, "closed");

  const apply = (next, force) => {
    if (!next || (next === voice && !force)) return;
    voice = next;
    img.src = frame(voice, moodFrame());
    moodFrameShown = moodFrame();
    if (moodState.value !== "awake") setMood(moodState.value, true);
    root.title = `x2ai · ${charName(voice)} · ${voice}`;
    applyHeightFor(packKey(next));
    applyPrefsFor(packKey(next));
  };

  // Шестерёнка появляется при наведении: выбор пака персонажей.
  const gear = document.createElement("button");
  gear.type = "button";
  gear.textContent = "⚙";
  gear.title = t("Настройки персонажа");
  gear.style.cssText = [
    "position:absolute",
    "left:0",
    "top:2px",
    "width:22px",
    "height:22px",
    "padding:0",
    "border-radius:50%",
    "border:1px solid rgba(255,255,255,.25)",
    "background:rgba(20,20,24,.78)",
    "color:#ddd",
    "font-size:13px",
    "line-height:1",
    "cursor:pointer",
    "opacity:0",
    "transition:opacity 120ms ease",
  ].join(";");
  box.appendChild(gear);

  // Между настройками и сменой персонажа — включение/выключение озвучки.
  // Это отдельный флаг: настройки персонажа (режим, рассуждения) не меняются.
  let mutedState = false;
  // Пузырь объявлен ниже: тихая ссылка, чтобы mute и загрузка настроек могли
  // перерисовать его, не зная порядка объявлений.
  let repaintBubble = () => {};
  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.textContent = "🔊";
  muteBtn.title = t("Выключить озвучку");
  muteBtn.style.cssText = [
    "position:absolute",
    "left:0",
    "top:28px",
    "width:22px",
    "height:22px",
    "padding:0",
    "border-radius:50%",
    "border:1px solid rgba(255,255,255,.25)",
    "background:rgba(20,20,24,.78)",
    "color:#ddd",
    "font-size:11px",
    "line-height:1",
    "cursor:pointer",
    "opacity:0",
    "transition:opacity 120ms ease",
  ].join(";");
  const paintMute = () => {
    muteBtn.textContent = mutedState ? "🔇" : "🔊";
    muteBtn.title = t(mutedState ? "Включить озвучку" : "Выключить озвучку");
  };
  const setMuted = (next) => {
    mutedState = Boolean(next);
    paintMute();
    // Mute только для этого чата: соседние вкладки продолжают говорить.
    bridge("/speech", { muted: mutedState, sid: currentSid || "" }).catch(() => {});
    // Глушим звук и артикуляцию, но текст остаётся: при режиме «только при
    // отключённом звуке» пузырь как раз в этот момент и появляется.
    if (mutedState) stopAll();
    repaintBubble();
  };
  muteBtn.onclick = (ev) => {
    ev.stopPropagation();
    setMuted(!mutedState);
  };
  box.appendChild(muteBtn);

  // Третья кнопка — сменить персонажа (то же, что кнопка в панели).
  const swapBtn = document.createElement("button");
  swapBtn.type = "button";
  swapBtn.textContent = "↻";
  swapBtn.title = t("Следующий персонаж из пака");
  // Стиль задаём явно: чтение gear.style.cssText нормализует пробелы
  // («top: 2px»), и replace не срабатывал — кнопка накрывала шестерёнку.
  swapBtn.style.cssText = [
    "position:absolute",
    "left:0",
    "top:54px",
    "width:22px",
    "height:22px",
    "padding:0",
    "border-radius:50%",
    "border:1px solid rgba(255,255,255,.25)",
    "background:rgba(20,20,24,.78)",
    "color:#ddd",
    "font-size:13px",
    "line-height:1",
    "cursor:pointer",
    "opacity:0",
    "transition:opacity 120ms ease",
  ].join(";");
  swapBtn.onclick = (ev) => {
    ev.stopPropagation();
    nextCharacter();
  };
  box.appendChild(swapBtn);

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:absolute",
    `bottom:${charHeight + 30}px`,
    "left:0",
    "width:236px",
    "background:rgba(24,24,28,.97)",
    "color:#e6e6e6",
    "border:1px solid rgba(255,255,255,.12)",
    "border-radius:10px",
    "padding:10px",
    "font:12px/1.45 -apple-system,system-ui,sans-serif",
    "box-shadow:0 10px 30px rgba(0,0,0,.45)",
    "display:none",
  ].join(";");
  box.appendChild(panel);

  let voiceCatalog = null;
  let installedVoices = null; // папки teratts-model/styles; null = ещё не спросили
  let temperPresets = null; // готовые описания характеров с моста (/voices)
  let ttsEngine = null; // установлен ли движок TeraTTS; null = ещё не спросили
  let speechMode = null; // "full" | "summary" | "silent"; null = ещё не загружен
  let reasonState = null; // { mode: off|brief|full, translate: bool }
  let keepAlive = true; // держать движок в памяти
  let quietState = { on: false, from: "23:00", to: "09:00" };
  let bridgeReady = false; // мост объявлен ниже: до этого настройки персонажа не шлём
  // Список моделей переживает перерисовку панели и переходы по подменю.
  let modelQuery = "";
  let modelLimit = 40;
  let modelsData = null;
  let modelsLoaded = false;
  let modelsLoading = false;
  let speechLoaded = false;
  let modelDisabled = null; // null = ещё не знаем, true = вспомогательная выключена
  const REASON_LABELS = [
    ["off", "Выключено"],
    ["brief", "Кратко"],
    ["full", "Полностью"],
  ];
  // Обращение к пользователю: имя (пустое = не использовать) и род ("", "m", "f").
  let userName = "";
  let userGender = "";
  let userLoaded = false;

  // Размер персонажа: высота картинки и отступ панели над ним.
  function applyHeight(value) {
    const h = Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Number(value) || DEFAULT_HEIGHT)));
    charHeight = h;
    img.style.height = `${h}px`;
    panel.style.bottom = `${h + 30}px`;
    return h;
  }
  function applyHeightFor(key) {
    return applyHeight(charSettingsFor(key).height || DEFAULT_HEIGHT);
  }
  // Озвучка и рассуждения тоже свои у каждого персонажа: применяем при смене.
  // Предел символов для этого персонажа: мост хранит его по базовому голосу,
  // поэтому новые чаты с тем же персонажем получают ту же длину.
  const sendLimits = (key) => {
    if (!bridgeReady || !key) return;
    const cs = charSettingsFor(key);
    const base = VOICE_ALIAS[key] || key;
    bridge("/limits", {
      voice: base,
      sid: currentSid || "",
      speech: detailChars(cs.detailSpeech === undefined ? 0.5 : cs.detailSpeech),
      reason: detailChars(cs.detailReason === undefined ? 0.5 : cs.detailReason),
    }).catch(() => {});
  };
  function applyPrefsFor(key) {
    if (!bridgeReady) return;
    const cs = charSettingsFor(key);
    if (cs.speech && cs.speech !== speechMode) {
      speechMode = cs.speech;
      bridge("/speech", { mode: speechMode }).catch(() => {});
    }
    sendLimits(key);
    if (cs.reason) {
      const cur = reasonState || { mode: "off", translate: true };
      if (cs.reason.mode !== cur.mode || Boolean(cs.reason.translate) !== Boolean(cur.translate)) {
        reasonState = { mode: cs.reason.mode || "off", translate: cs.reason.translate !== false };
        bridge("/speech", { reason: reasonState }).catch(() => {});
      }
    }
  }
  // Общие настройки движка приходят с моста один раз: режимы, скорость,
  // тихие часы, память. Панель после этого перерисовывается сама.
  const applySpeechGlobals = (data) => {
    if (!data) return;
    if (data.mode) speechMode = data.mode;
    if (data.keepAlive !== undefined) keepAlive = Boolean(data.keepAlive);
    if (data.muted !== undefined) {
      mutedState = Boolean(data.muted);
      paintMute();
    }
    const rs = data.reason;
    if (rs && typeof rs === "object") {
      reasonState = {
        mode: REASON_LABELS.some(([m]) => m === rs.mode) ? rs.mode : "off",
        translate: rs.translate === undefined ? true : Boolean(rs.translate),
      };
    }
    const q = data.quiet;
    if (q && typeof q === "object") {
      quietState = {
        on: Boolean(q.on),
        from: typeof q.from === "string" ? q.from : quietState.from,
        to: typeof q.to === "string" ? q.to : quietState.to,
      };
    }
    seedPackSettings();
  };
  const loadSpeechOnce = () => {
    if (speechLoaded) return;
    bridge(`/speech?sid=${encodeURIComponent(currentSid || "")}`)
      .then((data) => {
        // Флаг ставим только после успеха: иначе первый запрос после Cmd+R
        // уходил в ещё не поднятый мост и mute не подхватывался никогда.
        speechLoaded = true;
        applySpeechGlobals(data);
        // mute мог прийти с моста — пузырь надо перерисовать под новый режим.
        repaintBubble();
        if (panelOpen) renderPanel();
      })
      .catch(() => {});
  };

  // У персонажей пака ещё нет своих настроек — запоминаем текущие общие,
  // дальше каждый живёт отдельно.
  function seedPackSettings() {
    for (const k of packVoices()) {
      const cs = charSettingsFor(k);
      if (!cs.speech) saveCharSetting(k, { speech: speechMode || "summary" });
      if (!cs.reason) saveCharSetting(k, { reason: reasonState || { mode: "off", translate: true } });
    }
  }
  const setHeight = (value, key) => {
    const target = key || packKey(voice);
    const h = Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Number(value) || DEFAULT_HEIGHT)));
    saveCharSetting(target, { height: h });
    if (target === packKey(voice)) applyHeight(h);
    return h;
  };

  // Готовые клипы: одна реплика за раз, артикуляция идёт по длительности клипа.
  // Готовые клипы записаны русскими голосами: берём базовый голос персонажа,
  // а не тот, которым он говорит на текущем языке.
  const clipVoice = (id) => VOICE_ALIAS[packKey(id)] || packKey(id);
  function pickClip(list) {
    return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  function playClip(item, text = "") {
    if (!item || !item.src) return 0;
    // Звук выключен — клика не слышно, но текст реплики уходит в пузырь
    // (если пузырь вообще разрешён настройкой).
    if (mutedState) {
      showLineOnly(text || item.text);
      return 0;
    }
    stopClick();
    try {
      clickAudio = new Audio(item.src);
      clickAudio.play();
    } catch (e) {
      clickAudio = null;
    }
    const ms = item.ms > 0 ? item.ms : 1200;
    // Артикуляцию запускаем здесь же: вызывающие раньше звали startSpeaking
    // вторым разом, и первая, бестекстовая, партитура тут же сбрасывалась.
    startSpeaking(ms, "", text || item.text || "");
    return ms;
  }

  // Реплика при выключенном звуке: без аудио и без артикуляции, только текст в
  // пузыре. Настройки пузыря («не показывать» / «только при mute» / «всегда»)
  // решают, появится он или нет.
  const showLineOnly = (text) => {
    const clean = String(text || "").trim();
    if (!clean) return false;
    bubbleKind = "answer";
    bubbleThinking = false;
    setBubbleText(bubbleLine(clean));
    paintBubble();
    return true;
  };

  // Следующий персонаж пака вместе с его голосом: и по кнопке, и по правому клику.
  // Смена персонажа с анимацией: старый ныряет вниз, новый выныривает сверху.
  let swapping = false;
  const animateSwap = (next) => {
    if (swapping || next === voice) {
      apply(next);
      return;
    }
    swapping = true;
    const h = Math.max(80, img.offsetHeight || charHeight);
    img.style.transition = "transform 170ms ease-in, opacity 170ms ease-in";
    img.style.transform = `translateY(${Math.round(h * 0.9)}px)`;
    img.style.opacity = "0";
    setTimeout(() => {
      apply(next);
      img.style.transition = "none";
      img.style.transform = `translateY(${-Math.round(h * 0.75)}px)`;
      img.style.opacity = "0";
      requestAnimationFrame(() => {
        img.style.transition = "transform 230ms cubic-bezier(.2,.85,.25,1), opacity 200ms ease-out";
        img.style.transform = "";
        img.style.opacity = "1";
        setTimeout(() => {
          img.style.transition = "";
          swapping = false;
        }, 260);
      });
    }, 175);
  };

  const switchToCharacter = (next) => {
    if (!next) return next;
    stopAll();
    animateSwap(next);
    saveLocal(currentSid, next);
    if (currentSid) bridge("/voice", voicePayload(currentSid, next)).catch(() => {});
    if (voiceLang() === "en") {
      const text = tf(pickClip(EN_SUMMON), { name: charName(next) });
      if (text) {
        if (mutedState) showLineOnly(text);
        else bridge("/say", { text, sid: currentSid, voice: charVoice(next) }).catch(() => {});
      }
    } else {
      // Реплики есть по голосу, а не по id персонажа.
      const line = pickClip(LINES.lines && (LINES.lines[clipVoice(next)] || LINES.lines[next]));
      playClip(line, line && line.text);
    }
    return next;
  };

  const nextCharacter = () => {
    const pool = enabledChars();
    const list = pool.length ? pool : packVoices();
    const index = list.indexOf(packKey(voice));
    const next = list[(index + 1) % list.length] || voice;
    return switchToCharacter(next);
  };

  // Явный выбор персонажа из панели: выключенного включить в чат нельзя.
  const selectCharacter = (key) => {
    if (!isCharEnabled(key) || key === packKey(voice)) return;
    switchToCharacter(key);
    // apply() меняет voice после анимации (175 мс), поэтому подсветку
    // перерисовываем не сразу, иначе она остаётся на прежнем персонаже.
    if (panelOpen) {
      setTimeout(() => {
        if (panelOpen) renderPanel();
      }, 430);
    }
  };

  // Раскрывающиеся блоки настроек: по умолчанию свёрнуты.
  const sectionOpen = { pack: false, voice: false, char: false, speech: false, model: false, user: false, stats: false, reason: false, temper: false };

  // Статистика: сколько ответов озвучено и сколько всего речи. Живёт в localStorage.
  const STATS_KEY = "x2ai-avatar:stats";
  const loadStats = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
      return { count: Number(raw.count) || 0, ms: Number(raw.ms) || 0 };
    } catch (e) {
      return { count: 0, ms: 0 };
    }
  };
  const stats = loadStats();
  const saveStats = () => {
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    } catch (e) {}
  };
  let lastAnswerMs = 0;
  const refreshBadge = () => {
    const mins = stats.ms > 0 ? Math.round(stats.ms / 60000) : 0;
    badge.textContent = lastAnswerMs > 0 ? `${stats.count} · ${Math.round(lastAnswerMs / 1000)}с` : `${stats.count}`;
    badge.title = tf("Озвучено ответов: {n} · речи: {m} мин", { n: stats.count, m: mins });
  };

  // Позиции прокрутки списков: панель перерисовывается целиком, поэтому
  // запоминаем offset и возвращаем его, иначе список прыгает наверх.
  const scrollMemory = { pack: 0, voice: 0, speech: 0, model: 0 };
  const scrollEls = {};
  const keepScroll = (el, key) => {
    scrollEls[key] = el;
    el.onscroll = () => {
      scrollMemory[key] = el.scrollTop;
    };
    return el;
  };
  // Возвращаем позицию уже после вставки в документ: до неё у элемента
  // нет высоты, и scrollTop просто обнуляется.
  const restoreScroll = () => {
    requestAnimationFrame(() => {
      for (const key of Object.keys(scrollEls)) {
        const el = scrollEls[key];
        if (el && el.isConnected && scrollMemory[key]) el.scrollTop = scrollMemory[key];
      }
    });
  };
  // Прокрутка списка к выбранному пункту (после раскрытия блока).
  const centerActive = (key) => {
    requestAnimationFrame(() => {
      const el = scrollEls[key];
      if (!el || !el.isConnected) return;
      const row = el.querySelector(".x2ai-active");
      if (!row) return;
      const top = row.offsetTop - (el.clientHeight - row.offsetHeight) / 2;
      el.scrollTop = Math.max(0, top);
      scrollMemory[key] = el.scrollTop;
    });
  };
  const collapsible = (titleText, key, parent) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = `margin-top:${parent && parent !== panel ? 0 : 8}px`;
    const head = document.createElement("button");
    head.type = "button";
    head.style.cssText = [
      "display:flex",
      "align-items:center",
      "gap:6px",
      "box-sizing:border-box",
      "width:100%",
      "padding:5px 8px",
      "border-radius:7px",
      "cursor:pointer",
      "font:inherit",
      "font-size:11px",
      "font-weight:600",
      "color:inherit",
      "text-align:left",
      "opacity:.9",
      "border:1px solid rgba(255,255,255,.1)",
      "background:rgba(255,255,255,.04)",
    ].join(";");
    const caret = document.createElement("span");
    caret.textContent = sectionOpen[key] ? "▾" : "▸";
    caret.style.cssText = "width:10px;opacity:.7";
    const label = document.createElement("span");
    label.textContent = t(titleText);
    head.append(caret, label);
    head.onclick = (ev) => {
      ev.stopPropagation();
      // Аккордеон: открыт всегда только один блок, иначе меню разрастается.
      const wasOpen = sectionOpen[key];
      for (const k of Object.keys(sectionOpen)) sectionOpen[k] = false;
      sectionOpen[key] = !wasOpen;
      renderPanel();
      if (sectionOpen[key]) centerActive(key);
    };
    const body = document.createElement("div");
    // Отступ слева, чтобы содержимое читалось как подпункты блока.
    body.style.cssText = `display:${sectionOpen[key] ? "block" : "none"};margin-top:6px;padding-left:10px`;
    wrap.append(head, body);
    (parent || panel).appendChild(wrap);
    return body;
  };

  // Смена языка: интерфейс сразу, сервер — для пересказа и озвучки.
  const setLang = (code) => {
    if (!LANGS.some(([c]) => c === code) || code === activeLang) return;
    activeLang = code;
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch (e) {}
    gear.title = t("Настройки персонажа");
    swapBtn.title = t("Следующий персонаж из пака");
    bridge("/speech", { lang: code }).catch(() => {});
    if (currentSid) {
      bridge("/voice", voicePayload(currentSid, voice)).catch(() => {});
    }
    if (panelOpen) renderPanel();
  };

  const renderPanel = () => {
    panel.textContent = "";
    loadSpeechOnce();
    const view = panelView || { name: "root" };
    const go = (next) => {
      panelView = next;
      renderPanel();
    };

    const switchPack = async (name) => {
      setPack(name);
      await ensurePack(name);
      seedPackSettings();
      syncEnabled();
      const list = enabledChars();
      const pick = list.includes(voice) ? voice : list[0] || packVoices()[0];
      if (pick) {
        apply(pick, true);
        saveLocal(currentSid, pick);
        if (currentSid) bridge("/voice", voicePayload(currentSid, pick)).catch(() => {});
      }
      // Персонаж называет пак своим голосом.
      if (voiceLang() === "ru") {
        const packClips = LINES.packs && LINES.packs[name];
        playClip(packClips && packClips[pick || voice]);
      }
    };

    // Подписи голоса и общая строка-кнопка для всех списков панели.
    const labelOf = (id) => {
      const found = (voiceCatalog || []).find((v) => v.id === id);
      if (!found) return id;
      return activeLang === "ru" ? found.label : found.labelEn || found.label;
    };

    const vRow = (text, active, onClick, extra) => {
      const row = document.createElement("button");
      row.type = "button";
      row.textContent = t(text);
      row.style.cssText = [
        "display:flex",
        "align-items:center",
        "box-sizing:border-box",
        "width:100%",
        "min-height:26px",
        "line-height:1.4",
        "text-align:left",
        "padding:4px 8px",
        "border-radius:6px",
        "cursor:pointer",
        "font:inherit",
        "font-size:11px",
        "color:inherit",
        "white-space:nowrap",
        "overflow:hidden",
        "text-overflow:ellipsis",
        extra || "",
      ].join(";");
      // Подсветка выбранного меняется на месте, без перерисовки панели.
      const paint = (on) => {
        row.style.border = `1px solid ${on ? "rgba(120,180,255,.75)" : "rgba(255,255,255,.1)"}`;
        row.style.background = on ? "rgba(80,130,220,.22)" : "rgba(255,255,255,.03)";
        row.classList.toggle("x2ai-active", Boolean(on));
      };
      paint(!!active);
      row.setActive = paint;
      row.onclick = (ev) => {
        ev.stopPropagation();
        onClick();
      };
      return row;
    };

    // Ползунок «короче — подробнее»: показывается только при «кратко».
    const detailSlider = (value, onChange) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "margin:2px 0 4px;padding:2px 2px 0";
      const top = document.createElement("div");
      top.style.cssText =
        "display:flex;justify-content:space-between;font-size:10px;opacity:.55;margin-bottom:2px";
      const left = document.createElement("span");
      left.textContent = t("Короче");
      const right = document.createElement("span");
      right.textContent = t("Подробнее");
      top.append(left, right);
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "1";
      input.step = "0.05";
      input.value = String(value);
      input.style.cssText = "width:100%;accent-color:#5b8dee;cursor:pointer";
      const note = document.createElement("div");
      note.style.cssText = "font-size:10px;opacity:.4;text-align:right;margin-top:1px";
      const paint = () => {
        note.textContent = tf("≈ {n} символов", { n: detailChars(Number(input.value)) });
      };
      input.oninput = paint;
      input.onchange = () => onChange(Number(input.value));
      paint();
      wrap.append(top, input, note);
      return { wrap, input };
    };

    // Общая рамка для настроек: видно, что блоки относятся к одному разделу.
    const boxEl = () => {
      const el = document.createElement("div");
      el.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:6px",
        "box-sizing:border-box",
        "margin-top:0",
        "padding:6px",
        "border:1px solid rgba(255,255,255,.12)",
        "border-radius:9px",
        "background:rgba(255,255,255,.02)",
      ].join(";");
      panel.appendChild(el);
      return el;
    };

    // Шапка подменю: «Назад» выглядит ссылкой, а не пунктом меню.
    const head = (title, back, input) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-direction:column;gap:2px;margin:0 0 8px";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.textContent = t("← Назад");
      backBtn.style.cssText = [
        "align-self:flex-start",
        "padding:1px 2px",
        "border:none",
        "background:none",
        "color:inherit",
        "font:inherit",
        "font-size:11px",
        "opacity:.5",
        "cursor:pointer",
      ].join(";");
      backBtn.onmouseenter = () => (backBtn.style.opacity = ".95");
      backBtn.onmouseleave = () => (backBtn.style.opacity = ".5");
      backBtn.onclick = (ev) => {
        ev.stopPropagation();
        go(back || { name: "root" });
      };
      let titleEl;
      if (typeof input === "function") {
        // Имя персонажа редактируется прямо в шапке.
        titleEl = document.createElement("input");
        titleEl.type = "text";
        titleEl.maxLength = 40;
        titleEl.placeholder = t("Имя персонажа");
        titleEl.value = title;
        titleEl.style.cssText = [
          "width:100%",
          "box-sizing:border-box",
          "font:inherit",
          "font-size:12px",
          "font-weight:600",
          "padding:3px 6px",
          "border-radius:6px",
          "border:1px solid rgba(255,255,255,.16)",
          "background:rgba(255,255,255,.05)",
          "color:inherit",
          "outline:none",
        ].join(";");
        titleEl.addEventListener("change", () => input(titleEl.value));
        titleEl.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") titleEl.blur();
        });
        titleEl.onclick = (ev) => ev.stopPropagation();
      } else {
        titleEl = document.createElement("div");
        titleEl.textContent = t(title);
        titleEl.style.cssText = "font-size:12px;font-weight:600;opacity:.95;padding-left:2px";
      }
      row.append(backBtn, titleEl);
      panel.appendChild(row);
    };

    const menuRow = (text, onClick) => {
      const row = document.createElement("button");
      row.type = "button";
      row.style.cssText = [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "gap:8px",
        "width:100%",
        "box-sizing:border-box",
        "padding:8px 10px",
        "border-radius:8px",
        "border:1px solid rgba(255,255,255,.12)",
        "background:rgba(255,255,255,.04)",
        "color:inherit",
        "font:inherit",
        "font-size:12px",
        "text-align:left",
        "cursor:pointer",
      ].join(";");
      const label = document.createElement("span");
      label.textContent = t(text);
      const arrow = document.createElement("span");
      arrow.textContent = "›";
      arrow.style.cssText = "opacity:.45;font-size:14px;line-height:1";
      row.append(label, arrow);
      row.onmouseenter = () => (row.style.background = "rgba(255,255,255,.08)");
      row.onmouseleave = () => (row.style.background = "rgba(255,255,255,.04)");
      row.onclick = (ev) => {
        ev.stopPropagation();
        onClick();
      };
      return row;
    };

    const iconBtn = (text, title) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.title = t(title);
      btn.style.cssText = [
        "width:24px",
        "height:24px",
        "flex:0 0 24px",
        "padding:0",
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "border-radius:6px",
        "border:1px solid rgba(255,255,255,.16)",
        "background:rgba(255,255,255,.05)",
        "color:inherit",
        "font-size:12px",
        "line-height:1",
        "cursor:pointer",
      ].join(";");
      btn.onclick = (ev) => {
        ev.stopPropagation();
        if (!btn.disabled && btn.onclickAction) btn.onclickAction();
      };
      return btn;
    };

    const hint = (text, parent) => {
      const el = document.createElement("div");
      el.textContent = t(text);
      el.style.cssText = "font-size:10px;line-height:1.45;opacity:.5;margin:2px 0 0 2px";
      (parent || panel).appendChild(el);
      return el;
    };

    if (view.name === "root") {
      // Язык: четыре квадратные кнопки справа над меню.
      const langRow = document.createElement("div");
      langRow.style.cssText = "display:flex;justify-content:flex-end;gap:4px;margin-bottom:10px";
      for (const [code, label] of LANGS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = code.toUpperCase();
        const on = code === activeLang;
        btn.style.cssText = [
          "width:28px",
          "height:20px",
          "padding:0",
          "border-radius:5px",
          "font:inherit",
          "font-size:10px",
          "line-height:1",
          "cursor:pointer",
          `border:1px solid ${on ? "rgba(120,180,255,.75)" : "rgba(255,255,255,.16)"}`,
          `background:${on ? "rgba(80,130,220,.22)" : "rgba(255,255,255,.04)"}`,
          `color:${on ? "#bcd6ff" : "inherit"}`,
        ].join(";");
        btn.onclick = (ev) => {
          ev.stopPropagation();
          setLang(code);
        };
        langRow.appendChild(btn);
      }
      panel.appendChild(langRow);

      const menu = document.createElement("div");
      menu.style.cssText = "display:flex;flex-direction:column;gap:6px";
      const items = [
        ["Данные пользователя", "user"],
        ["Настройка персонажей", "chars"],
        ["Вспомогательная модель", "model"],
        ["Общие настройки", "extra"],
        ["Дополнительно", "stats"],
      ];
      for (const [text, name] of items) menu.appendChild(menuRow(text, () => go({ name })));
      panel.appendChild(menu);
    } else if (view.name === "user") {
      head("Данные пользователя");
      const box = boxEl();

      // Обращение к пользователю: имя и род. Влияет на пересказ («Аня, ты просила…»).
      const uInput = document.createElement("input");
      uInput.type = "text";
      uInput.maxLength = 40;
      uInput.placeholder = t("Имя (необязательно)");
      uInput.value = userName;
      uInput.style.cssText =
        "width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:5px 7px;" +
        "border:1px solid rgba(255,255,255,.16);border-radius:7px;" +
        "background:rgba(255,255,255,.05);color:inherit;outline:none";
      box.appendChild(uInput);

      const uHint = document.createElement("div");
      uHint.textContent = t("Как обращаться к тебе в пересказе");
      uHint.style.cssText = "opacity:.5;font-size:10px;line-height:1.4;margin:3px 0 0 2px";
      box.appendChild(uHint);

      const gRow = document.createElement("div");
      gRow.style.cssText = "display:flex;gap:4px;margin-top:5px";
      box.appendChild(gRow);

      // «Не указан» скрыт: он остаётся значением по умолчанию (userGender = ""),
      // но вернуться к нему после выбора пола нельзя — кнопки просто нет.
      const GENDERS = [
        ["m", "Мужской"],
        ["f", "Женский"],
      ];
      const genderRows = [];
      const refreshUser = () => {
        uInput.value = userName;
        for (const item of genderRows) item.row.setActive(item.value === userGender);
      };
      const saveUser = (patch) => {
        if (patch.name !== undefined) userName = String(patch.name).replace(/\s+/g, " ").trim().slice(0, 40);
        if (patch.gender !== undefined) userGender = patch.gender;
        refreshUser();
        bridge("/user", { name: userName, gender: userGender }).catch(() => {});
      };
      for (const [value, text] of GENDERS) {
        const row = vRow(text, userGender === value, () => saveUser({ gender: value }));
        row.style.flex = "1";
        row.style.minWidth = "0";
        row.style.justifyContent = "center";
        row.style.textAlign = "center";
        row.style.whiteSpace = "normal";
        row.style.overflow = "visible";
        row.style.textOverflow = "clip";
        row.style.lineHeight = "1.25";
        row.style.padding = "4px 4px";
        gRow.appendChild(row);
        genderRows.push({ value, row });
      }
      uInput.addEventListener("change", () => saveUser({ name: uInput.value }));
      uInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") uInput.blur();
      });
      if (!userLoaded) {
        userLoaded = true;
        bridge("/user")
          .then((data) => {
            userName = (data && data.user && data.user.name) || "";
            userGender = (data && data.user && data.user.gender) || "";
            refreshUser();
          })
          .catch(() => {});
      }
    } else if (view.name === "chars") {
      head("Настройка персонажей");
      const box = boxEl();

      const pBody = collapsible("Пак персонажей", "pack", box);

      // Список паков — кнопки, как в остальных блоках (со скроллом на будущее).
      loadExternalPacks();
      const pList = keepScroll(document.createElement("div"), "pack");
      pList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      for (const name of packList()) {
        const count = packVoices(name).length;
        pList.appendChild(
          vRow(`${t(PACK_NAMES[name] || name)} · ${count}`, name === activePack, () => {
            switchPack(name);
            renderPanel();
          }),
        );
      }
      pBody.appendChild(pList);

      const rule = document.createElement("hr");
      rule.style.cssText = "border:none;border-top:1px solid rgba(255,255,255,.12);margin:2px 0";
      box.appendChild(rule);

      // Персонажи пака: чекбокс доступности и две квадратные кнопки справа.
      const list = keepScroll(document.createElement("div"), "chars");
      list.style.cssText = "max-height:230px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      const currentKey = packKey(voice);
      for (const key of packVoices()) {
        const on = isCharEnabled(key);
        const row = document.createElement("div");
        row.style.cssText = [
          "display:flex",
          "align-items:center",
          "gap:6px",
          "padding:3px 5px",
          "border-radius:7px",
          "border:1px solid rgba(255,255,255,.08)",
          "background:rgba(255,255,255,.03)",
        ].join(";");

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = on;
        cb.title = on ? "Доступен для новых чатов" : "Выключен";
        cb.style.cssText = "width:13px;height:13px;flex:0 0 13px;margin:0;accent-color:#5b8dee;cursor:pointer";
        cb.onchange = () => {
          if (!setCharEnabled(key, cb.checked)) {
            cb.checked = true;
            return;
          }
          syncEnabled();
          renderPanel();
        };

        const name = document.createElement("span");
        name.textContent = charName(key);
        name.style.cssText =
          "flex:1;min-width:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
          (on ? "" : "opacity:.45");

        const pickBtn = iconBtn("✓", on ? "Выбрать персонажа" : "Персонаж выключен");
        if (key === currentKey) {
          pickBtn.style.borderColor = "rgba(120,180,255,.75)";
          pickBtn.style.background = "rgba(80,130,220,.22)";
          pickBtn.style.color = "#bcd6ff";
        }
        if (!on) {
          pickBtn.disabled = true;
          pickBtn.style.opacity = ".3";
          pickBtn.style.cursor = "not-allowed";
        }
        pickBtn.onclickAction = () => selectCharacter(key);

        const cfgBtn = iconBtn("⚙", "Настройки персонажа");
        cfgBtn.onclickAction = () => go({ name: "char", key });

        row.append(cb, name, pickBtn, cfgBtn);
        list.appendChild(row);
      }
      box.appendChild(list);
      hint("Галочка — персонаж доступен в новых чатах и при смене. Снятая — уже выбранного не убирает.", box);
    } else if (view.name === "char") {
      const key = view.key;
      head(charName(key), { name: "chars" });
      const box = boxEl();

      // Голоса ставятся отдельно: если их нет, персонаж молчит — пишем красным
      // вверху, а не прячем внутрь свёрнутого блока голоса.
      const voiceWarn = document.createElement("div");
      voiceWarn.style.cssText = "display:none;color:#ff6b6b;font-size:10px;line-height:1.4;margin:0 0 6px";
      box.appendChild(voiceWarn);

      // Имя персонажа: поле ввода, как имя пользователя. Пусто — дефолтное имя.
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.maxLength = 40;
      nameInput.placeholder = charName(key);
      nameInput.value = (charSettingsFor(key).name || "").trim();
      nameInput.style.cssText =
        "width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:5px 7px;" +
        "border:1px solid rgba(255,255,255,.16);border-radius:7px;" +
        "background:rgba(255,255,255,.05);color:inherit;outline:none";
      nameInput.onclick = (ev) => ev.stopPropagation();
      nameInput.addEventListener("change", () => {
        const clean = nameInput.value.replace(/\s+/g, " ").trim().slice(0, 40);
        saveCharSetting(key, { name: clean });
        if (key === packKey(voice) && currentSid) {
          bridge("/voice", voicePayload(currentSid, key)).catch(() => {});
        }
        renderPanel();
      });
      nameInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") nameInput.blur();
      });
      box.appendChild(nameInput);
      hint("Пусто — имя по умолчанию. Своё имя не переводится.", box);

      // Живость персонажа: одна галочка на два поведения — злится на
      // ошибках и засыпает, когда ничего не происходит. По умолчанию включена.
      const reactRow = document.createElement("label");
      reactRow.style.cssText =
        "display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;cursor:pointer";
      const reactCb = document.createElement("input");
      reactCb.type = "checkbox";
      reactCb.checked = charSettingsFor(packKey(key)).react !== false;
      reactCb.style.cssText = "width:14px;height:14px;margin:0;accent-color:#5b8dee;cursor:pointer";
      const reactLabel = document.createElement("span");
      reactLabel.textContent = t("Живой персонаж");
      reactRow.append(reactCb, reactLabel);
      reactRow.onclick = (ev) => ev.stopPropagation();
      reactCb.onchange = () => {
        saveCharSetting(packKey(key), { react: reactCb.checked });
        // Выключили живость — сразу поднять, если он успел заснуть.
        if (!reactCb.checked && moodState.value !== "awake") {
          if (moodTimer) clearTimeout(moodTimer);
          setMood("awake");
        }
        resetIdle();
      };
      box.appendChild(reactRow);
      hint("Хмурится, когда инструмент или ответ упал, и засыпает, если ничего не происходит.", box);

      // Характер: галочка «Активировать», своё описание и манера озвучки —
      // всё в одном блоке: в правила чата уходит именно манера речи
      // персонажа, а не только имя и род.
      const tBody = collapsible("Характер", "temper", box);
      const temperRow = document.createElement("label");
      temperRow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:11px;cursor:pointer";
      const temperCb = document.createElement("input");
      temperCb.type = "checkbox";
      temperCb.checked = charTemper(key);
      temperCb.style.cssText = "width:14px;height:14px;margin:0;accent-color:#5b8dee;cursor:pointer";
      const temperLabel = document.createElement("span");
      temperLabel.textContent = t("Активировать");
      temperRow.append(temperCb, temperLabel);
      temperRow.onclick = (ev) => ev.stopPropagation();
      temperCb.onchange = () => {
        saveCharSetting(packKey(key), { temper: temperCb.checked });
        if (packKey(key) === packKey(voice) && currentSid) {
          bridge("/voice", voicePayload(currentSid, key)).catch(() => {});
        }
      };
      tBody.appendChild(temperRow);
      hint("Добавляет в чат манеру речи персонажа: как он шутит, злится и разговаривает.", tBody);

      // Свой текст характера важнее готового описания персонажа. В пустом
      // поле серым видно готовое описание — от него и правим.
      const temperPreset =
        (temperPresets && (temperPresets[packKey(key)] || temperPresets[key])) || "";
      const temperText = document.createElement("textarea");
      temperText.rows = 3;
      temperText.maxLength = 400;
      temperText.placeholder = temperPreset || t("Свой характер (пусто — готовый)");
      temperText.value = String(charSettingsFor(packKey(key)).temperText || "");
      temperText.style.cssText =
        "width:100%;box-sizing:border-box;min-height:66px;resize:vertical;display:block;" +
        "font:inherit;font-size:11px;line-height:1.4;padding:6px 8px;margin-top:6px;" +
        "border:1px solid rgba(255,255,255,.16);border-radius:7px;" +
        "background:rgba(255,255,255,.05);color:inherit;outline:none";
      temperText.onclick = (ev) => ev.stopPropagation();
      temperText.addEventListener("change", () => {
        const clean = temperText.value.replace(/\s+/g, " ").trim().slice(0, 400);
        saveCharSetting(packKey(key), { temperText: clean });
        if (packKey(key) === packKey(voice) && currentSid) {
          bridge("/voice", voicePayload(currentSid, key)).catch(() => {});
        }
      });
      // Enter в многострочном поле — перенос строки, применяем по Cmd/Ctrl+Enter.
      temperText.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) temperText.blur();
      });
      tBody.appendChild(temperText);
      hint("Например: «говори дерзко, подкалывай, но по делу». Пусто — готовый характер.", tBody);

      // Манера озвучки: скорость и окраска (эмоция движка) этого персонажа.
      const mTitle = document.createElement("div");
      mTitle.textContent = t("Манера речи");
      mTitle.style.cssText = "font-size:11px;font-weight:600;opacity:.85;margin:12px 0 6px";
      tBody.appendChild(mTitle);
      // Ползунок скрыт, пока в «Окраске» не выбрано «Настроить». Движок
      // понимает значение как множитель ДЛИТЕЛЬНОСТИ, поэтому на панели
      // показываем обратное: вправо — быстрее.
      const mRow = document.createElement("div");
      mRow.style.cssText = "display:none;align-items:center;gap:8px;margin:6px 0";
      const mInput = document.createElement("input");
      mInput.type = "range";
      mInput.min = "0.6";
      mInput.max = "1.4";
      mInput.step = "0.05";
      const curSpeed = Number(charSettingsFor(packKey(key)).speed) || 1;
      // Движок берёт множитель ДЛИТЕЛЬНОСТИ, а на панели показываем скорость:
      // длительность 1.25 — это 0.8× скорости. Больше на ползунке — быстрее.
      const clampSpeed = (v) => Math.min(1.4, Math.max(0.6, v));
      const showSpeed = (engine) => Math.round(clampSpeed(1 / (Number(engine) || 1)) * 100) / 100;
      const engineSpeed = (shown) => Math.round((1 / Number(shown)) * 100) / 100;
      mInput.value = String(showSpeed(curSpeed));
      mInput.style.cssText = "flex:1;accent-color:#5b8dee;cursor:pointer";
      const mVal = document.createElement("span");
      mVal.textContent = `${showSpeed(curSpeed).toFixed(2)}×`;
      mVal.style.cssText = "font-size:11px;opacity:.7;width:44px;text-align:right";
      mInput.oninput = () => {
        mVal.textContent = `${Number(mInput.value).toFixed(2)}×`;
      };
      mInput.onchange = () => {
        const speed = engineSpeed(mInput.value);
        saveCharSetting(packKey(key), { speed });
        if (packKey(key) === packKey(voice) && currentSid) {
          bridge("/voice", voicePayload(currentSid, key)).catch(() => {});
        }
        // Сразу слышно, что стало: искать «Проверить» больше не нужно.
        previewManner();
      };
      mRow.append(mInput, mVal);

      const emoRow = document.createElement("div");
      emoRow.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px";
      const emoLabel = document.createElement("span");
      emoLabel.textContent = t("Окраска");
      emoLabel.style.opacity = ".7";
      const emoSelect = document.createElement("select");
      emoSelect.style.cssText =
        "flex:1;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);" +
        "color:inherit;border-radius:7px;padding:3px 5px;font:inherit;font-size:11px";
      emoSelect.style.colorScheme = "dark";
      const savedStyle = charSettingsFor(packKey(key));
      let curEmo = savedStyle.emotion || "";
      // Старые персонажи со своим темпом: раньше ползунок применялся всегда,
      // теперь он живёт внутри «Настроить» — не теряем их настройку.
      if (!curEmo && Number(savedStyle.speed) && Math.abs(Number(savedStyle.speed) - 1) > 0.01) {
        curEmo = "custom";
      }
      for (const [value, label] of [
        ["", "Без окраски"],
        ["up", "Бодро"],
        ["think", "Задумчиво"],
        ["down", "Устало"],
        ["custom", "Настроить"],
      ]) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = t(label);
        opt.selected = value === curEmo;
        emoSelect.appendChild(opt);
      }
      const syncSpeedRow = () => {
        mRow.style.display = emoSelect.value === "custom" ? "flex" : "none";
      };
      emoSelect.onchange = () => {
        syncSpeedRow();
        saveCharSetting(packKey(key), { emotion: emoSelect.value });
        if (packKey(key) === packKey(voice) && currentSid) {
          bridge("/voice", voicePayload(currentSid, key)).catch(() => {});
        }
        previewManner();
      };
      emoRow.append(emoLabel, emoSelect);
      // Предпросмотр манеры: пробная фраза этим персонажем, скорость и окраска
      // с элементов панели уходят прямо в /test, не дожидаясь записи за чатом.
      const previewManner = () => {
        const custom = emoSelect.value === "custom";
        const engine = custom ? engineSpeed(mInput.value) : emoSpeed(emoSelect.value);
        bridge("/test", {
          sid: currentSid || "",
          voice: charVoice(key),
          speed: engine,
          emotion: custom ? speedEmotion(engine) : emoSelect.value,
        }).catch(() => {});
      };
      tBody.appendChild(emoRow);
      tBody.appendChild(mRow);
      syncSpeedRow();
      hint(
        "Окраска задаёт и интонацию, и темп: бодро — быстрее, устало — медленнее. «Настроить» — свой темп, окраска подберётся по нему. Реплика прозвучит сразу после изменения.",
        tBody,
      );

      if (!isCharEnabled(key)) {
        hint("Персонаж выключен: в новых чатах не появится, включить в текущем чате нельзя.", box);
      }

      // Размер персонажа: свой у каждого.
      const hBody = collapsible("Размер персонажа", "char", box);
      const hRow = document.createElement("div");
      hRow.style.cssText = "display:flex;align-items:center;gap:8px";
      const hInput = document.createElement("input");
      hInput.type = "range";
      hInput.min = String(HEIGHT_MIN);
      hInput.max = String(HEIGHT_MAX);
      hInput.step = "4";
      const curHeight = charSettingsFor(key).height || DEFAULT_HEIGHT;
      hInput.value = String(curHeight);
      hInput.style.cssText = "flex:1;accent-color:#5b8dee;cursor:pointer";
      const hVal = document.createElement("span");
      hVal.textContent = `${curHeight} px`;
      hVal.style.cssText = "font-size:11px;opacity:.7;width:48px;text-align:right";
      hInput.oninput = () => {
        hVal.textContent = `${setHeight(hInput.value, key)} px`;
      };
      hRow.append(hInput, hVal);
      hBody.appendChild(hRow);

      // Голос персонажа: свой у каждого, живёт в localStorage.
      const vBody = collapsible("Голос персонажа", "voice", box);
      const defaultVoiceOf = () => defaultVoiceFor(VOICE_ALIAS[key] || key, voiceLang(), key);
      // Голос хранится отдельно для каждого языка: русский выбор не должен
      // подставляться, когда включён английский.
      const pickedVoice = () => {
        const cs = charSettingsFor(key);
        const lang = voiceLang();
        const byLang = cs.voiceByLang || {};
        if (byLang[lang]) return byLang[lang];
        if (lang === "ru" && cs.voice) return cs.voice;
        return "";
      };
      const isDefaultVoice = () => {
        const picked = pickedVoice();
        return !picked || picked === defaultVoiceOf();
      };

      // Проверка установки: сравниваем базовый голос (px_ru_f1 → ru_f1)
      // со списком папок teratts-model/styles. Нет списка — молчим.
      const refreshVoiceWarn = () => {
        const base = VOICE_ALIAS[pickedVoice() || defaultVoiceOf()] || pickedVoice() || defaultVoiceOf();
        let msg = "";
        if (ttsEngine === false) {
          msg = t("Движок TeraTTS не установлен — поставь его, иначе персонаж говорит системным голосом без артикуляции.");
        } else if (installedVoices && installedVoices.length === 0) {
          msg = t("Голоса TeraTTS не установлены — поставь их в teratts-model/styles, иначе персонаж молчит.");
        } else if (installedVoices && installedVoices.length && base && !installedVoices.includes(base)) {
          msg = tf("Голос «{v}» не установлен — поставь его, иначе персонаж молчит.", { v: base });
        }
        voiceWarn.textContent = msg;
        voiceWarn.style.display = msg ? "block" : "none";
      };

      const vCur = document.createElement("div");
      vCur.style.cssText = "font-size:11px;opacity:.7;margin-bottom:6px";
      vBody.appendChild(vCur);

      const vList = keepScroll(document.createElement("div"), "voice");
      vList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      vBody.appendChild(vList);

      // Строки списка голосов: подсветку обновляем на месте, панель не перерисовываем.
      const voiceRows = [];
      const refreshVoiceSelection = () => {
        vCur.textContent = tf("сейчас: {v}", { v: labelOf(pickedVoice() || defaultVoiceOf()) });
        refreshVoiceWarn();
        for (const item of voiceRows) {
          item.row.setActive(item.id ? !isDefaultVoice() && item.id === pickedVoice() : isDefaultVoice());
        }
      };

      const bindVoice = (id) => {
        const value = id || defaultVoiceOf();
        if (voiceLang() === "ru") {
          // Пример голоса звучит сразу, не дожидаясь ответа моста.
          playClip((LINES.samples && (LINES.samples[id] || LINES.samples[key])) || null);
        } else {
          const text = pickClip(EN_SAMPLE);
          if (text) {
            if (mutedState) showLineOnly(text);
            else bridge("/say", { text, sid: currentSid, voice: value }).catch(() => {});
          }
        }
        const lang = voiceLang();
        const byLang = { ...(charSettingsFor(key).voiceByLang || {}) };
        byLang[lang] = value;
        saveCharSetting(key, lang === "ru" ? { voiceByLang: byLang, voice: value } : { voiceByLang: byLang });
        charVoices[key] = value;
        bridge("/charvoice", { charId: key, voice: value }).catch(() => {});
        if (key === packKey(voice) && currentSid) {
          bridge("/voice", { ...voicePayload(currentSid, key), voice: value }).catch(() => {});
        }
        refreshVoiceSelection();
      };

      if (!voiceCatalog || !installedVoices) {
        const loading = document.createElement("div");
        loading.textContent = "загружаю голоса…";
        loading.style.cssText = "opacity:.5;font-size:11px";
        vList.appendChild(loading);
        bridge("/voices")
          .then((data) => {
            voiceCatalog = (data && data.voices) || [];
            // Старые сборки моста не знают про installed: тогда пусто.
            installedVoices = Array.isArray(data && data.installed) ? data.installed : [];
            temperPresets = (data && data.tempers) || temperPresets;
            ttsEngine = data && data.engine !== false;
            renderPanel();
          })
          .catch(() => {});
      } else {
        const catalog = (voiceCatalog || []).filter((v) => (v.lang || "ru") === voiceLang());
        for (const v of catalog) {
          const row = vRow(
            activeLang === "ru" ? v.label : v.labelEn || v.label,
            v.id === pickedVoice() && !isDefaultVoice(),
            () => bindVoice(v.id),
          );
          voiceRows.push({ id: v.id, row });
          vList.appendChild(row);
        }
        const defRow = vRow(
          "По умолчанию",
          isDefaultVoice(),
          () => bindVoice(null),
          "margin-top:2px;opacity:.85;justify-content:center",
        );
        voiceRows.push({ id: null, row: defRow });
        vList.appendChild(defRow);
        refreshVoiceSelection();
      }

      // Озвучка ответа: выключено, кратко или полностью — своё у каждого персонажа.
      const sBody = collapsible("Озвучка ответа", "speech", box);
      const SPEECH_LABELS = [
        ["silent", "Выключено"],
        ["summary", "Кратко"],
        ["full", "Полностью"],
      ];
      const sList = keepScroll(document.createElement("div"), "speech");
      sList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      const speechRows = [];
      const speechNote = document.createElement("div");
      speechNote.textContent = t("озвучки не будет");
      speechNote.style.cssText = "font-size:11px;opacity:.55;margin-top:6px";
      const speechWarn = document.createElement("div");
      speechWarn.textContent = t("Нужно выбрать вспомогательную модель");
      speechWarn.style.cssText = "display:none;color:#ff6b6b;font-size:10px;line-height:1.4;margin-top:6px";

      const speechFor = () => charSettingsFor(key).speech || speechMode || "summary";
      const refreshSpeech = () => {
        const cur = speechFor();
        for (const item of speechRows) item.row.setActive(item.mode === cur);
        speechNote.style.display = cur === "silent" ? "block" : "none";
        speechWarn.style.display = cur !== "silent" && modelDisabled === true ? "block" : "none";
        speechDetail.wrap.style.display = cur === "summary" ? "block" : "none";
      };

      const setSpeech = (mode) => {
        saveCharSetting(key, { speech: mode });
        if (key === packKey(voice)) {
          speechMode = mode;
          bridge("/speech", { mode }).catch(() => {});
        }
        refreshSpeech();
      };

      for (const [value, text] of SPEECH_LABELS) {
        const row = vRow(text, value === speechFor(), () => setSpeech(value));
        speechRows.push({ mode: value, row });
        sList.appendChild(row);
      }
      const speechDetail = detailSlider(
        charSettingsFor(key).detailSpeech === undefined ? 0.5 : charSettingsFor(key).detailSpeech,
        (v) => {
          saveCharSetting(key, { detailSpeech: v });
          sendLimits(key);
        },
      );
      sList.appendChild(speechDetail.wrap);
      sBody.appendChild(sList);
      sBody.appendChild(speechNote);
      sBody.appendChild(speechWarn);
      refreshSpeech();

      // Озвучка рассуждений: своя у каждого персонажа.
      const rBody = collapsible("Озвучка рассуждений", "reason", box);
      const rList = keepScroll(document.createElement("div"), "reason");
      rList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      const reasonRows = [];
      const rTrans = document.createElement("label");
      rTrans.style.cssText =
        "display:flex;align-items:center;gap:8px;margin-top:6px;font-size:11px;cursor:pointer";
      const rTransCb = document.createElement("input");
      rTransCb.type = "checkbox";
      rTransCb.style.cssText = "width:14px;height:14px;margin:0;accent-color:#5b8dee;cursor:pointer";
      const rTransText = document.createElement("span");
      rTransText.textContent = tf("Переводить на {lang}", { lang: t(LANG_NAME[activeLang]) });
      rTrans.append(rTransCb, rTransText);
      rTransCb.onchange = () => setReason({ translate: rTransCb.checked });

      const reasonFor = () => charSettingsFor(key).reason || reasonState || { mode: "off", translate: true };
      const reasonWarn = document.createElement("div");
      reasonWarn.textContent = t("Нужно выбрать вспомогательную модель");
      reasonWarn.style.cssText = "display:none;color:#ff6b6b;font-size:10px;line-height:1.4;margin-top:6px";

      const refreshReason = () => {
        const st = reasonFor();
        for (const item of reasonRows) item.row.setActive(item.mode === st.mode);
        rTransCb.checked = Boolean(st.translate);
        rList.style.opacity = st.mode === "off" ? ".5" : "1";
        reasonDetail.wrap.style.display = st.mode === "brief" ? "block" : "none";
        reasonWarn.style.display = st.mode !== "off" && modelDisabled === true ? "block" : "none";
      };

      const setReason = (patch) => {
        const next = { ...reasonFor(), ...patch };
        saveCharSetting(key, { reason: next });
        if (key === packKey(voice)) {
          reasonState = next;
          bridge("/speech", { reason: next }).catch(() => {});
        }
        refreshReason();
      };

      for (const [value, text] of REASON_LABELS) {
        const row = vRow(text, false, () => setReason({ mode: value }));
        reasonRows.push({ mode: value, row });
        rList.appendChild(row);
      }
      const reasonDetail = detailSlider(
        charSettingsFor(key).detailReason === undefined ? 0.5 : charSettingsFor(key).detailReason,
        (v) => {
          saveCharSetting(key, { detailReason: v });
          sendLimits(key);
        },
      );
      rList.appendChild(reasonDetail.wrap);
      refreshReason();
      rBody.append(rList, rTrans, reasonWarn);

    } else if (view.name === "model") {
      head("Вспомогательная модель");
      const box = boxEl();

      const desc = document.createElement("div");
      desc.textContent = t(
        "Не читает и не озвучивает ответы сама: сжимает текст для «Кратко» и переводит рассуждения на язык озвучки, если включён перевод. Локальные и бесплатные модели — в начале списка.",
      );
      desc.style.cssText = "font-size:10px;line-height:1.45;opacity:.55;margin:0 0 2px 2px";
      box.appendChild(desc);

      // Включение вспомогательной модели: при «Отключено» пересказ и перевод не
      // зовут LLM, поэтому список моделей и поиск по нему не нужны.
      const modelRow = document.createElement("div");
      modelRow.style.cssText = "margin:2px 0 6px;font-size:11px";
      const modelLabel = document.createElement("div");
      modelLabel.textContent = t("Вспомогательная модель");
      modelLabel.style.cssText = "margin-bottom:4px";
      const modelSel = document.createElement("select");
      modelSel.style.cssText =
        "display:block;width:100%;font:inherit;font-size:11px;padding:3px 6px;border-radius:7px;cursor:pointer;color:inherit;" +
        "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05)";
      for (const [val, label] of [
        ["on", "Включено"],
        ["off", "Отключено"],
      ]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = t(label);
        modelSel.appendChild(opt);
      }
      modelRow.appendChild(modelLabel);
      modelRow.appendChild(modelSel);

      // Строка над поиском: полное имя модели. В покое — выбранная модель, а
      // при наведении на строку списка — та модель целиком (в списке она режется
      // по ширине панели).
      const mInfo = document.createElement("div");
      mInfo.style.cssText =
        "font-family:ui-monospace,Menlo,monospace;font-size:9.5px;line-height:1.35;opacity:.55;" +
        "margin:0 2px 8px;min-height:26px;overflow-wrap:anywhere";
      const currentInfo = () => {
        const cur = modelsData && modelsData.current;
        return cur && cur.providerID && cur.id ? `${cur.providerID}/${cur.id}` : t("Модель не выбрана");
      };
      mInfo.textContent = currentInfo();
      // Порядок: селект, строка модели, потом коллапс со списком (он сам
      // дописывается в box при создании).
      box.append(modelRow, mInfo);

      // Список моделей убран в раскрывающийся блок: панель не разрастается,
      // а строка с выбранной моделью остаётся на виду над ним.
      const mBody = collapsible("Список моделей", "models", box);
      const mBlock = mBody.parentElement;
      // Поиск, кнопка «Показать ещё» и счётчик должны стоять по левому краю
      // панели, без отступа, который коллапс даёт вложенным блокам.
      mBody.style.paddingLeft = "0";

      const mList = keepScroll(document.createElement("div"), "model");
      mList.style.cssText = "max-height:220px;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;gap:4px";
      // Отступ для строк моделей даём контейнеру, а кнопку «Показать ещё» и
      // счётчик тянем назад: margin-left у самих строк давал горизонтальный скролл.
      mList.style.paddingLeft = "10px";
      const mSearch = document.createElement("input");
      mSearch.type = "text";
      mSearch.placeholder = t("Поиск модели");
      mSearch.value = modelQuery;
      mSearch.style.cssText =
        "width:100%;box-sizing:border-box;font:inherit;font-size:11px;padding:4px 7px;margin-bottom:10px;" +
        "border:1px solid rgba(255,255,255,.16);border-radius:7px;background:rgba(255,255,255,.04);color:inherit";
      mSearch.oninput = () => {
        modelQuery = mSearch.value;
        modelLimit = 40;
        renderModels();
      };
      mSearch.onclick = (ev) => ev.stopPropagation();
      mBody.append(mSearch, mList);

      const syncModelMode = () => {
        const off = modelDisabled === true;
        modelSel.value = off ? "off" : "on";
        // Выключено — только сам селект, как раньше. Включено — строка модели
        // и сворачиваемый список, чтобы панель не разрасталась.
        mInfo.style.display = off ? "none" : "";
        mBlock.style.display = off ? "none" : "";
      };
      modelSel.onchange = () => {
        const off = modelSel.value === "off";
        modelDisabled = off;
        syncModelMode();
        bridge("/model", { disabled: off }).catch(() => {});
        if (!off && !modelsLoaded) loadModels();
      };
      syncModelMode();

      const modelRows = [];

      const renderModels = (data) => {
        if (data) modelsData = data;
        syncModelMode();
        mInfo.textContent = currentInfo();
        mList.textContent = "";
        modelRows.length = 0;
        const models = (modelsData && modelsData.models) || [];
        const current = (modelsData && modelsData.current) || {};
        // Порядок приходит с моста: локальные, затем бесплатные.
        const q = modelQuery.trim().toLowerCase();
        const free = models.filter((m) => {
          if (!(m.local || m.free)) return false;
          if (!q) return true;
          return `${m.name} ${m.providerID}/${m.id}`.toLowerCase().includes(q);
        });
        const shown = free.slice(0, modelLimit);
        if (!shown.length) {
          const empty = document.createElement("div");
          empty.textContent = t(
            data && data.error ? "не удалось получить список" : "локальных и бесплатных моделей нет",
          );
          empty.style.cssText = "opacity:.5;font-size:11px";
          mList.appendChild(empty);
          return;
        }
        for (const m of shown) {
          const active = m.providerID === current.providerID && m.id === current.id;
          const label = m.local
            ? tf("{name} ({provider}) · локальная", { name: m.name, provider: m.providerID })
            : tf("{name} ({provider})", { name: m.name, provider: m.providerID });
          const row = vRow(label, active, () => {
            modelDisabled = false;
            syncModelMode();
            for (const item of modelRows) item.row.setActive(item.model === m);
            const full = `${m.providerID}/${m.id}`;
            bridge("/model", { providerID: m.providerID, id: m.id })
              .then((res) => {
                if (res && res.current) modelsData = { ...modelsData, current: res.current };
                mInfo.textContent = full;
              })
              .catch(() => {});
          });
          row.title = `${m.providerID}/${m.id}`;
          // Строка над поиском: наведение показывает модель целиком.
          row.onmouseenter = () => {
            mInfo.textContent = `${m.providerID}/${m.id}`;
          };
          row.onmouseleave = () => {
            mInfo.textContent = currentInfo();
          };
          row.onfocus = row.onmouseenter;
          row.onblur = row.onmouseleave;
          modelRows.push({ model: m, row });
          mList.appendChild(row);
        }
        if (free.length > shown.length) {
          const more = document.createElement("button");
          more.type = "button";
          more.textContent = tf("Показать ещё {n}", { n: Math.min(40, free.length - shown.length) });
          more.style.cssText =
            "margin-left:-10px;margin-top:4px;padding:4px 8px;font:inherit;font-size:11px;cursor:pointer;border-radius:7px;" +
            "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:inherit";
          more.onclick = (ev) => {
            ev.stopPropagation();
            modelLimit += 40;
            renderModels();
          };
          mList.appendChild(more);
          const left = document.createElement("div");
          left.textContent = tf("всего подходит: {n}", { n: free.length });
          left.style.cssText = "margin-left:-10px;opacity:.4;font-size:10px;padding:2px 7px";
          mList.appendChild(left);
        }
      };

      const loadModels = () => {
        if (modelsLoaded) {
          renderModels();
          centerActive("model");
          return;
        }
        if (modelsLoading) return;
        modelsLoading = true;
        mList.textContent = "";
        const noteEl = document.createElement("div");
        noteEl.textContent = t("загружаю…");
        noteEl.style.cssText = "opacity:.5;font-size:11px";
        mList.appendChild(noteEl);
        bridge("/models")
          .then((data) => {
            modelsLoaded = true;
            modelsLoading = false;
            if (data && data.disabled !== undefined) modelDisabled = Boolean(data.disabled);
            renderModels(data);
            centerActive("model");
          })
          .catch(() => {
            modelsLoading = false;
            noteEl.textContent = t("мост недоступен");
          });
      };
      loadModels();
    } else if (view.name === "extra") {
      head("Общие настройки");
      const box = boxEl();
      hint("Общие настройки движка: действуют на всех персонажей.", box);

      // Тихие часы: в этом окне персонаж молчит сам, режим озвучки не меняется.
      const qBox = document.createElement("div");
      qBox.style.cssText = "margin-top:10px;display:flex;flex-direction:column;gap:6px";
      const qTop = document.createElement("div");
      qTop.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px";
      const qLabel = document.createElement("span");
      qLabel.textContent = t("Тихие часы");
      qLabel.style.cssText = "font-size:11px;opacity:.75";
      const qToggle = document.createElement("button");
      qToggle.type = "button";
      qToggle.style.cssText =
        "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:inherit;border-radius:7px;padding:3px 9px;font-size:11px;cursor:pointer";
      qToggle.textContent = t("выкл");
      const qTimes = document.createElement("div");
      qTimes.style.cssText = "display:flex;align-items:center;gap:6px;font-size:11px;opacity:.8";
      const timeInput = (value) => {
        const el = document.createElement("input");
        el.type = "time";
        el.value = value;
        el.style.cssText =
          "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:inherit;border-radius:6px;padding:2px 4px;font-size:11px";
        el.style.colorScheme = "dark";
        return el;
      };
      const qFrom = timeInput(quietState.from);
      const qTo = timeInput(quietState.to);
      const qDash = document.createElement("span");
      qDash.textContent = "—";
      qDash.style.opacity = ".6";
      qTimes.append(qFrom, qDash, qTo);

      const refreshQuiet = () => {
        qToggle.textContent = t(quietState.on ? "вкл" : "выкл");
        qToggle.style.borderColor = quietState.on ? "rgba(120,180,255,.6)" : "rgba(255,255,255,.16)";
        qToggle.style.background = quietState.on ? "rgba(80,130,220,.18)" : "rgba(255,255,255,.04)";
        qFrom.value = quietState.from;
        qTo.value = quietState.to;
        qTimes.style.opacity = quietState.on ? ".85" : ".45";
      };
      const saveQuiet = (patch) => {
        quietState = { ...quietState, ...patch };
        refreshQuiet();
        bridge("/speech", { quiet: quietState }).catch(() => {});
      };
      qToggle.onclick = () => saveQuiet({ on: !quietState.on });
      qFrom.onchange = () => saveQuiet({ from: qFrom.value || quietState.from });
      qTo.onchange = () => saveQuiet({ to: qTo.value || quietState.to });
      qTop.append(qLabel, qToggle);
      qBox.append(qTop, qTimes);
      refreshQuiet();
      box.appendChild(qBox);

      // Память против скорости: держать движок загруженным или поднимать на фразу.
      const memRow = document.createElement("label");
      memRow.style.cssText =
        "display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;cursor:pointer";
      const memCb = document.createElement("input");
      memCb.type = "checkbox";
      memCb.checked = keepAlive;
      memCb.style.cssText = "width:14px;height:14px;margin:0;accent-color:#5b8dee;cursor:pointer";
      const memText = document.createElement("span");
      memText.textContent = t("Держать движок в памяти");
      memRow.append(memCb, memText);
      const memHint = document.createElement("div");
      memHint.style.cssText = "font-size:10px;line-height:1.4;opacity:.5;margin:4px 0 0 2px";
      const refreshMem = () => {
        memCb.checked = keepAlive;
        memHint.textContent = t(
          keepAlive
            ? "движок занимает ~1.7 ГБ и отвечает за полсекунды"
            : "по требованию: каждая фраза ~9 с на загрузку, память свободна",
        );
      };
      memCb.onchange = () => {
        keepAlive = memCb.checked;
        refreshMem();
        bridge("/speech", { keepAlive }).catch(() => {});
      };
      refreshMem();
      box.append(memRow, memHint);

      // Переключатели окна: у каждого свой цвет и подпись, чтобы не плодить разметку.
      const flagRow = (label, hintText, checked, onChange) => {
        const row = document.createElement("label");
        row.style.cssText =
          "display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;cursor:pointer";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = Boolean(checked);
        cb.style.cssText = "width:14px;height:14px;margin:0;accent-color:#5b8dee;cursor:pointer";
        const text = document.createElement("span");
        text.textContent = t(label);
        cb.onchange = () => onChange(cb.checked);
        row.append(cb, text);
        box.appendChild(row);
        if (hintText) {
          const h = document.createElement("div");
          h.style.cssText = "font-size:10px;line-height:1.4;opacity:.5;margin:3px 0 0 22px";
          h.textContent = t(hintText);
          box.appendChild(h);
        }
        return cb;
      };

      // Пузырь: три режима — галочкой их не различить, поэтому селект.
      // Подпись отдельной строкой: в узкой колонке она переносилась на три
      // строки и сжимала селект до нечитаемого.
      const bubbleRow = document.createElement("div");
      bubbleRow.style.cssText = "margin-top:10px;font-size:11px";
      const bubbleLabel = document.createElement("div");
      bubbleLabel.textContent = t("Пузырь с текстом");
      bubbleLabel.style.cssText = "margin-bottom:4px";
      const bubbleSel = document.createElement("select");
      bubbleSel.style.cssText =
        "display:block;width:100%;font:inherit;font-size:11px;padding:3px 6px;border-radius:7px;cursor:pointer;color:inherit;" +
        "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05)";
      for (const [val, label] of [
        ["off", "Не показывать"],
        ["mute", "Только при отключённом звуке"],
        ["always", "Показывать всегда"],
      ]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = t(label);
        bubbleSel.appendChild(opt);
      }
      bubbleSel.value = BUBBLE_MODES.includes(uiPrefs.bubble) ? uiPrefs.bubble : "mute";
      bubbleSel.onchange = () => {
        saveUiPref({ bubble: bubbleSel.value });
        paintBubble();
      };
      bubbleRow.append(bubbleLabel, bubbleSel);
      const bubbleHint = document.createElement("div");
      bubbleHint.style.cssText = "font-size:10px;line-height:1.4;opacity:.5;margin:4px 0 0 2px";
      bubbleHint.textContent = t(
        "Короткая фраза, которую персонаж говорит сейчас. Если озвучка ответа или рассуждений выключена, пузырь не появляется.",
      );
      box.append(bubbleRow, bubbleHint);
      flagRow("Горячие клавиши", "⌘/Ctrl+Shift+M — звук, +S — стоп, +A — панель.", uiPrefs.keys, (on) =>
        saveUiPref({ keys: on }),
      );

      // Настройки персонажей — в файл и обратно: перенос между окнами и машинами.
      const ioRow = document.createElement("div");
      ioRow.style.cssText = "display:flex;gap:6px;margin-top:10px";
      const ioBtn = (label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = t(label);
        btn.style.cssText =
          // min-width:0 — иначе flex-элемент не даёт тексту переноситься и
          // кнопки вылезают за панель.
          "flex:1;min-width:0;padding:5px 6px;border-radius:7px;cursor:pointer;font:inherit;font-size:10px;" +
          "line-height:1.25;white-space:normal;overflow-wrap:anywhere;color:inherit;" +
          "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05)";
        return btn;
      };
      const ioHint = document.createElement("div");
      ioHint.style.cssText = "font-size:10px;line-height:1.4;opacity:.5;margin:4px 0 0 2px";
      const exportBtn = ioBtn("Экспортировать настройки");
      exportBtn.onclick = (ev) => {
        ev.stopPropagation();
        bridge("/settings/export", {
          chars: charSettings,
          ui: uiPrefs,
          pack: activePack,
          lang: activeLang,
        })
          .then((data) => {
            ioHint.textContent = data && data.path ? tf("Сохранено: {p}", { p: data.path }) : t("Не сохранилось");
          })
          .catch(() => {
            ioHint.textContent = t("Не сохранилось");
          });
      };
      const importBtn = ioBtn("Импортировать настройки");
      importBtn.onclick = (ev) => {
        ev.stopPropagation();
        bridge("/settings/import")
          .then((data) => {
            if (!data || !data.chars || typeof data.chars !== "object") {
              ioHint.textContent = t("Файла нет");
              return;
            }
            charSettings = { ...charSettings, ...data.chars };
            try {
              localStorage.setItem(CHAR_SETTINGS_KEY, JSON.stringify(charSettings));
            } catch (e) {}
            if (data.ui && typeof data.ui === "object") saveUiPref(data.ui);
            ioHint.textContent = tf("Загружено персонажей: {n}", { n: Object.keys(data.chars).length });
            renderPanel();
          })
          .catch(() => {
            ioHint.textContent = t("Файла нет");
          });
      };
      ioRow.append(exportBtn, importBtn);
      box.append(ioRow, ioHint);

    } else if (view.name === "stats") {
      head("Дополнительно");
      const box = boxEl();

      const stText = document.createElement("div");
      stText.style.cssText = "font-size:11px;line-height:1.5;opacity:.8";
      const stReset = document.createElement("button");
      stReset.type = "button";
      stReset.textContent = t("Сбросить");
      stReset.style.cssText =
        "margin-top:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:inherit;border-radius:7px;padding:3px 9px;font-size:11px;cursor:pointer;align-self:flex-start";
      const refreshStats = () => {
        const mins = Math.floor(stats.ms / 60000);
        const secs = Math.round((stats.ms % 60000) / 1000);
        stText.textContent = tf("Озвучено ответов: {n} · всего речи: {m} мин {s} с", { n: stats.count, m: mins, s: secs });
      };
      stReset.onclick = () => {
        stats.count = 0;
        stats.ms = 0;
        saveStats();
        refreshStats();
        refreshBadge();
      };
      refreshStats();
      box.append(stText, stReset);

      // Донат: список кошельков из DONATE. Пока он пуст — вежливая заглушка.
      const donHead = document.createElement("div");
      donHead.textContent = t("Поддержать автора");
      donHead.style.cssText = "margin-top:14px;font-size:11px;font-weight:600";
      const donHint = document.createElement("div");
      donHint.style.cssText = "font-size:10px;line-height:1.4;opacity:.55;margin:4px 0 6px";
      donHint.textContent = t("Плагин бесплатный и работает офлайн. Если он пригодился — вот кошельки.");
      box.append(donHead, donHint);
      if (!DONATE.length) {
        const soon = document.createElement("div");
        soon.textContent = t("Кошельки скоро появятся.");
        soon.style.cssText = "font-size:10px;opacity:.45";
        box.appendChild(soon);
      }
      for (const card of DONATE) {
        const row = document.createElement("button");
        row.type = "button";
        row.title = t("Нажми, чтобы скопировать");
        row.style.cssText =
          "display:flex;flex-direction:column;gap:2px;width:100%;box-sizing:border-box;text-align:left;" +
          "padding:5px 8px;margin-bottom:4px;border-radius:7px;cursor:pointer;font:inherit;font-size:10px;color:inherit;" +
          "border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04)";
        const netEl = document.createElement("span");
        netEl.textContent = card.net || "";
        netEl.style.cssText = "font-weight:600;font-size:10px;opacity:.75";
        const addrEl = document.createElement("span");
        addrEl.textContent = card.addr || "";
        addrEl.style.cssText = "font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere;opacity:.9";
        row.append(netEl, addrEl);
        if (card.note) {
          const noteEl = document.createElement("span");
          noteEl.textContent = t(card.note);
          noteEl.style.cssText = "font-size:9px;opacity:.5";
          row.appendChild(noteEl);
        }
        row.onclick = (ev) => {
          ev.stopPropagation();
          const back = () => {
            addrEl.textContent = t("Скопировано");
            setTimeout(() => {
              addrEl.textContent = card.addr || "";
            }, 1200);
          };
          try {
            navigator.clipboard.writeText(card.addr || "").then(back, () => {});
          } catch (e) {}
        };
        box.appendChild(row);
      }
    }

    restoreScroll();
  };

  let panelOpen = false;
  // Открытие панели возвращает туда, где её закрыли: раздел помним 5 минут,
  // позже шестерёнка снова открывает главную страницу.
  const PANEL_MEMORY = 5 * 60 * 1000;
  let panelClosedAt = 0;
  let panelView = { name: "root" };
  const togglePanel = (on) => {
    const next = on === undefined ? !panelOpen : on;
    if (next && !panelOpen) {
      if (!(panelClosedAt && Date.now() - panelClosedAt < PANEL_MEMORY)) {
        panelView = { name: "root" };
      }
      panelOpen = true;
      renderPanel();
    } else if (!next && panelOpen) {
      panelClosedAt = Date.now();
      panelOpen = false;
    }
    // Настройки перекрывают пузырь — при открытой панели он скрыт.
    paintBubble();
    panel.style.display = panelOpen ? "block" : "none";
    gear.style.display = panelOpen ? "none" : "";
    gear.style.opacity = panelOpen ? "1" : "";
    swapBtn.style.display = panelOpen ? "none" : "";
    swapBtn.style.opacity = panelOpen ? "1" : "";
    muteBtn.style.display = panelOpen ? "none" : "";
    muteBtn.style.opacity = panelOpen ? "1" : "";
  };
  gear.onclick = (ev) => {
    ev.stopPropagation();
    togglePanel();
  };
  // Клик мимо панели и мимо персонажа закрывает настройки.
  const onDocDown = (ev) => {
    if (!panelOpen) return;
    if (panel.contains(ev.target) || box.contains(ev.target)) return;
    togglePanel(false);
  };
  document.addEventListener("mousedown", onDocDown, true);
  box.onmouseenter = () => {
    gear.style.opacity = "1";
    swapBtn.style.opacity = "1";
    muteBtn.style.opacity = "1";
  };
  box.onmouseleave = () => {
    if (!panelOpen) {
      gear.style.opacity = "0";
      swapBtn.style.opacity = "0";
      muteBtn.style.opacity = "0";
    }
  };

  // Персонаж показывается только в реальном чате: на Home и в черновике
  // ctx.sessions.current() === undefined, там его нет.
  const setVisible = (on) => {
    box.style.display = on ? "flex" : "none";
  };
  setVisible(false);

  // Правый блок (side region) съедает ширину колонки, и персонаж начинает
  // перекрывать поле ввода — на это время его прячем.
  const sideOpen = (session) => {
    try {
      return !!(ctx.layout && ctx.layout.side && ctx.layout.side.opened(session));
    } catch (e) {
      return false;
    }
  };
  const refreshVisibility = () => {
    const session = ctx.sessions.current();
    if (!session || !session.id) {
      setVisible(false);
      return;
    }
    setVisible(!sideOpen(session));
  };

  try {
    createEffect(() => {
      const session = ctx.sessions.current();
      if (!session || !session.id) {
        setVisible(false);
        return;
      }
      lastSid = session.id;
      applyForSession(session.id);
      refreshVisibility();
    });
  } catch (e) {}

  // side.opened() не всегда реактивен — подстраховываемся дешёвым опросом.
  const sidePoll = setInterval(refreshVisibility, 500);

  // --- Настроение: сон при простое, злость при ошибке, звук пробуждения ---
  try {
    const st = document.createElement("style");
    st.textContent = [
      "@keyframes x2ai-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}",
      // Сон — с наклоном: без него «дремлющий» стоит ровно и не читается.
      "@keyframes x2ai-sleep{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-2px) rotate(-4.6deg)}}",
      // Злость — мелкая дрожь, чтобы красная подсветка читалась как эмоция.
      "@keyframes x2ai-rage{0%,100%{transform:translate(0,0) rotate(-1deg)}",
      "25%{transform:translate(-1px,0) rotate(-2deg)}50%{transform:translate(1px,0) rotate(0deg)}",
      "75%{transform:translate(-1px,1px) rotate(-1.6deg)}}",
      "@keyframes x2ai-zzz{0%{opacity:0;transform:translate(0,0) scale(.7)}25%{opacity:.85}",
      "100%{opacity:0;transform:translate(9px,-24px) scale(1.15)}}",
      "@keyframes x2ai-dot{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}",
    ].join("");
    document.head.appendChild(st);
  } catch (e) {}

  const zzz = document.createElement("div");
  zzz.textContent = "z";
  // Точки «синтезирую»: между концом ответа и стартом звука проходит до 30 с.
  const dots = document.createElement("div");
  dots.style.cssText = [
    "position:absolute",
    "right:-6px",
    "bottom:-2px",
    "display:none",
    "gap:2px",
    "pointer-events:none",
  ].join(";");
  for (let i = 0; i < 3; i++) {
    const d = document.createElement("span");
    d.style.cssText = [
      "width:3px",
      "height:3px",
      "border-radius:50%",
      "background:rgba(255,255,255,.85)",
      "box-shadow:0 1px 2px rgba(0,0,0,.5)",
      `animation:x2ai-dot 1.05s ease-in-out ${i * 0.16}s infinite`,
    ].join(";");
    dots.appendChild(d);
  }
  box.appendChild(dots);

  // Пузырь «думает»: показывается, когда озвучиваются рассуждения, а не ответ.
  const bubble = document.createElement("div");
  bubble.style.cssText = [
    "position:absolute",
    "left:0",
    "bottom:calc(100% + 8px)",
    "display:none",
    "padding:3px 7px 4px",
    "border-radius:9px",
    "background:rgba(140,175,255,.22)",
    "border:1px solid rgba(150,185,255,.45)",
    "font-size:11px",
    "line-height:1.35",
    "letter-spacing:0",
    "color:rgba(235,242,255,.9)",
    "pointer-events:auto",
    "cursor:pointer",
    "transition:opacity .3s ease, transform .3s ease",
  ].join(";");
  box.appendChild(bubble);

  // Текст живёт отдельным узлом: его подменяем на каждой новой фразе, а
  // кружочки-хвост (ниже) не затираются вместе с текстом.
  const bubbleText = document.createElement("span");
  bubbleText.textContent = "…";
  bubble.appendChild(bubbleText);

  // Хвост из кружочков, как в комиксах: звук выключен, а персонаж «говорит» —
  // значит от головы к пузырю идут точки вместо звуковой волны.
  // Висит под самим пузырём (не под авкой), поэтому кружочки всегда ниже
  // облачка и не наезжают на текст: пузырь растёт вверх, а хвост остаётся снизу.
  const bubbleTail = document.createElement("div");
  bubbleTail.style.cssText = [
    "position:absolute",
    "left:12px",
    "top:calc(100% + 2px)",
    "display:none",
    "flex-direction:column",
    "align-items:flex-start",
    "gap:2px",
    "pointer-events:none",
  ].join(";");
  for (const [size, shift] of [[7, 0], [5, 3], [3, 7]]) {
    const d = document.createElement("span");
    d.style.cssText = [
      `width:${size}px`,
      `height:${size}px`,
      "border-radius:50%",
      `margin-left:${shift}px`,
      "background:rgba(200,220,255,.75)",
      "box-shadow:0 1px 2px rgba(0,0,0,.45)",
    ].join(";");
    bubbleTail.appendChild(d);
  }
  bubble.appendChild(bubbleTail);

  // Пузырь рисуем одной функцией: при открытых настройках он всегда скрыт,
  // иначе висел бы поверх панели.
  let bubbleThinking = false;
  let bubbleKind = "answer"; // что в пузыре: ответ или рассуждения
  // Клик по пузырю = «убери», пока не придёт новая фраза: иначе следующий
  // опрос /state вернул бы его на место.
  let bubbleDismissed = false;
  // Один и тот же эффект на клик и на автоскрытие: проваливается и гаснет.
  const hideBubble = () => {
    if (!bubble.style.display || bubble.style.display === "none") return;
    bubbleDismissed = true;
    stopBubbleRotate();
    bubble.style.opacity = "0";
    bubble.style.transform = "translateY(5px) scale(.94)";
    setTimeout(() => {
      paintBubble();
      bubble.style.opacity = "1";
      bubble.style.transform = "";
    }, 320);
  };
  bubble.onclick = (event) => {
    if (event) event.stopPropagation();
    hideBubble();
  };
  // «Озвучка ответа» и «озвучка рассуждений» главнее пузыря: если канал
  // выключен, текст не показываем вовсе.
  const bubbleChannelOn = () => {
    if (bubbleKind === "reason") return Boolean(reasonState && reasonState.mode !== "off");
    const cs = charSettingsFor(packKey(voice));
    return (cs.speech || speechMode || "summary") !== "silent";
  };
  const paintBubble = () => {
    const hasLine = Boolean(bubbleText.textContent) && bubbleText.textContent !== "…";
    const mode = BUBBLE_MODES.includes(uiPrefs.bubble) ? uiPrefs.bubble : "mute";
    const want = mode === "always" ? true : mode === "mute" ? mutedState : false;
    const show = !panelOpen && want && !bubbleDismissed && bubbleChannelOn() && (hasLine || bubbleThinking);
    bubble.style.display = show ? "block" : "none";
    // Кружочки вместо звука: только когда звук выключен.
    bubbleTail.style.display = show && mutedState ? "flex" : "none";
  };
  repaintBubble = paintBubble;

  // Мысли должны сменяться, а не висеть одной строкой: длинную фразу режем по
  // предложениям и листаем, пока висит пузырь.
  let bubbleThoughts = [];
  let bubbleThoughtIdx = 0;
  let bubbleRotate = null;
  let bubbleHideTimer = null;
  const stopBubbleRotate = () => {
    if (bubbleRotate) clearInterval(bubbleRotate);
    bubbleRotate = null;
  };
  const setBubbleText = (text) => {
    const clean = String(text || "").trim();
    // Новая фраза — пузырь снова имеет право появиться после клика-«убери».
    bubbleDismissed = false;
    bubble.style.opacity = "1";
    bubble.style.transform = "";
    // Через минуту фраза уходит сама, тем же эффектом, что и по клику.
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
    bubbleHideTimer = setTimeout(hideBubble, 60000);
    bubbleThoughts = (clean.match(/[^.!?…]+[.!?…]*/g) || [])
      .map((s) => s.trim())
      .filter(Boolean);
    bubbleThoughtIdx = 0;
    bubbleText.textContent = bubbleThoughts[0] || clean;
    stopBubbleRotate();
    if (bubbleThoughts.length > 1) {
      bubbleRotate = setInterval(() => {
        if (bubble.style.display === "none") return;
        // Листаем по одному разу и останавливаемся на последней мысли:
        // по кругу старый текст всплывать не должен.
        if (bubbleThoughtIdx >= bubbleThoughts.length - 1) {
          stopBubbleRotate();
          return;
        }
        bubbleThoughtIdx += 1;
        bubbleText.textContent = bubbleThoughts[bubbleThoughtIdx];
      }, 4500);
    }
  };

  zzz.style.cssText = [
    "position:absolute",
    "right:-4px",
    "top:-2px",
    "font-size:13px",
    "line-height:1",
    "color:rgba(255,255,255,.8)",
    "text-shadow:0 1px 3px rgba(0,0,0,.55)",
    "opacity:0",
    "pointer-events:none",
  ].join(";");
  box.appendChild(zzz);

  const IDLE_MS = 3 * 60 * 1000;
  const SHADOW = "drop-shadow(0 2px 6px rgba(0,0,0,.28))";
  let moodTimer = null;
  // Какой кадр настроения сейчас стоит в img: речь и перерисовки могли
  // вернуть «closed», хотя персонаж спит или злится.
  let moodFrameShown = "closed";
  let idleTimer = null;

  // Короткий мягкий сигнал пробуждения: два синуса, без внешних файлов.
  let audioCtx = null;
  const wakeBlip = () => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      for (const [offset, freq] of [[0, 620], [0.09, 900]]) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.07, now + offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.17);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.2);
      }
    } catch (e) {}
  };

  // Кадр под текущее настроение: злость — с открытым ртом, сон — с закрытыми глазами.
  const moodFrame = () =>
    moodState.value === "angry" ? "wide" : moodState.value === "sleeping" ? "blink" : "closed";

  const setMood = (next, quiet) => {
    const prev = moodState.value;
    moodState.value = next;
    if (next === "sleeping") {
      img.src = frame(voice, "blink");
      moodFrameShown = "blink";
      img.style.filter = `${SHADOW} saturate(.7) brightness(.9)`;
      // Наклон живёт внутри кейфреймов: animation перебивает inline-transform.
      box.style.transform = "";
      box.style.filter = "";
      box.style.animation = "x2ai-sleep 3.6s ease-in-out infinite";
      zzz.style.animation = "x2ai-zzz 2.6s ease-out infinite";
      zzz.style.opacity = "0";
      root.title = `x2ai · ${charName(voice)} · ${t("спит")}`;
    } else if (next === "angry") {
      img.src = frame(voice, "wide");
      moodFrameShown = "wide";
      img.style.filter = `${SHADOW} saturate(1.35) brightness(1.05)`;
      box.style.transform = "";
      // Красная подсветка + дрожь: злость видно боковым зрением.
      box.style.filter = "drop-shadow(0 0 7px rgba(255,64,64,.6))";
      box.style.animation = "x2ai-rage .18s linear infinite";
      zzz.style.animation = "";
      zzz.style.opacity = "0";
      root.title = `x2ai · ${charName(voice)} · ${t("злится")}`;
    } else {
      img.src = frame(voice, "closed");
      moodFrameShown = "closed";
      img.style.filter = SHADOW;
      box.style.filter = "";
      box.style.animation = "";
      box.style.transform = "";
      zzz.style.animation = "";
      zzz.style.opacity = "0";
      root.title = `x2ai · ${charName(voice)} · ${voice}`;
    }
    return prev;
  };

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    // Живость выключена — персонаж не засыпает и не злится (см. sadFor).
    if (!charReact(voice)) {
      idleTimer = null;
      return;
    }
    idleTimer = setTimeout(() => {
      if (speaking || panelOpen || moodState.value === "angry") {
        resetIdle();
        return;
      }
      setMood("sleeping");
    }, IDLE_MS);
  };

  // Любая активность будит персонажа; из сна — со звуком. Грусть не трогаем:
  // она доигрывает свою очередь и не может быть сбита ответом.
  const wake = () => {
    const wasAsleep = moodState.value === "sleeping";
    if (wasAsleep) {
      if (moodTimer) clearTimeout(moodTimer);
      setMood("awake");
      wakeBlip();
    }
    resetIdle();
  };

  // Ошибки встают в очередь: каждая отыгрывается целиком, следующая — после
  // неё. Речь и другие действия злость не сбрасывают.
  const rageQueue = [];
  let ragePlaying = false;
  const playRage = () => {
    if (ragePlaying) return;
    const ms = rageQueue.shift();
    if (!ms) return;
    ragePlaying = true;
    setMood("angry");
    if (moodTimer) clearTimeout(moodTimer);
    moodTimer = setTimeout(() => {
      ragePlaying = false;
      if (rageQueue.length) {
        playRage();
        return;
      }
      if (moodState.value === "angry") setMood("awake");
      resetIdle();
    }, ms);
  };

  const sadFor = (ms) => {
    rageQueue.push(ms || 4200);
    // Длинная серия ошибок не должна держать злость минутами.
    if (rageQueue.length > 5) rageQueue.shift();
    playRage();
  };

  // --- Индикатор синтеза: точки, пока движок готовит звук ---
  let synthTimer = null;
  const stopSynth = () => {
    if (synthTimer) clearTimeout(synthTimer);
    synthTimer = null;
    dots.style.display = "none";
  };
  const startSynth = () => {
    dots.style.display = "flex";
    if (synthTimer) clearTimeout(synthTimer);
    // Страховка: если звук так и не пришёл (ошибка движка), точки гаснут.
    synthTimer = setTimeout(stopSynth, 45000);
  };

  resetIdle();

  let speaking = false;
  let talkTimer = null;
  let talkStep = 0;
  let blinkTimer = null;
  let speakTimer = null;

  // Партитура рта: считается в talk-plan.js (там же тест), здесь только
  // запуск кадров по таймеру.

  let talkTimeout = null;
  const runPlan = (plan, thinking) => {
    let i = 0;
    const step = () => {
      if (!speaking) return;
      if (i >= plan.length) {
        // План доиграл раньше звука — держим закрытый рот, не открываем заново.
        img.src = frame(voice, "closed");
        moodFrameShown = "closed";
        return;
      }
      const item = plan[i++];
      img.src = frame(voice, item.frame);
      box.style.transform = `translateY(${i % 2 ? -1 : 0}px) rotate(${i % 2 ? -0.12 : 0.06}deg)`;
      talkTimeout = setTimeout(step, thinking ? item.delay * 1.4 : item.delay);
    };
    step();
  };

  // Что реально звучит: теги языка и разметку в пузыре не показываем.
  // Длинную фразу режем по последней точке, чтобы не обрывать на полуслове,
  // и закрываем многоточием.
  const BUBBLE_CHARS = 200;
  const bubbleLine = (text) => {
    const clean = String(text || "")
      .replace(/<\/?[a-z]{2}>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (clean.length <= BUBBLE_CHARS) return clean;
    const cut = clean.slice(0, BUBBLE_CHARS);
    const sentence = cut.match(/[\s\S]*[.!?…]/);
    const base = (sentence ? sentence[0] : cut.replace(/\s+\S*$/, "")).trim();
    return `${base.replace(/[.!?…\s]+$/, "")}…`;
  };

  const startSpeaking = (ms, kind, text, offset = 0) => {
    speaking = true;
    const thinking = kind === "reason";
    const line = bubbleLine(text);
    if (line) setBubbleText(line);
    // Рассуждения показываем всегда (видно, что персонаж думает), ответы —
    // по настройке «пузырь с текстом». При открытых настройках пузырь не
    // нужен: он висел бы поверх панели.
    bubbleThinking = thinking;
    bubbleKind = thinking ? "reason" : "answer";
    paintBubble();
    box.style.filter = thinking ? "saturate(.85) brightness(1.02)" : "";
    // Грусть не сбрасываем: ответ накладывается поверх, рот анимируется
    // кадрами партитуры, а настроение доигрывает свою очередь.
    if (moodState.value === "sleeping") {
      if (moodTimer) clearTimeout(moodTimer);
      setMood("awake");
    }
    resetIdle();
    if (talkTimer) clearInterval(talkTimer);
    if (talkTimeout) clearTimeout(talkTimeout);
    if (speakTimer) clearTimeout(speakTimer);
    const total = ms > 0 ? ms : 9000;
    const skipMs = Math.max(0, Math.min(Number(offset) || 0, total));
    speakTimer = setTimeout(stopSpeaking, total - skipMs + 500);

    const plan = TALKPLAN.buildTalkPlan(text, total);
    if (plan) {
      // State приходит с задержкой до 0.8 с: прошедшие кадры выкидываем,
      // иначе рот отстаёт от звука и замолкает раньше него.
      runPlan(TALKPLAN.skipPassed(plan, skipMs), thinking);
    } else {
      // Текста нет — просто шевелим ртом, как раньше.
      talkTimer = setInterval(() => {
        const state = TALK[talkStep % TALK.length];
        img.src = frame(voice, state);
        talkStep++;
        box.style.transform = `translateY(${talkStep % 2 ? -1 : 0}px) rotate(${talkStep % 2 ? -0.12 : 0.06}deg)`;
      }, thinking ? 170 : 110);
    }
  };

  const stopSpeaking = () => {
    speaking = false;
    // Текст не стираем: при выключенном звуке пузырь должен оставаться
    // на экране, а видимость решает paintBubble().
    paintBubble();
    box.style.filter = "";
    if (talkTimer) clearInterval(talkTimer);
    if (talkTimeout) clearTimeout(talkTimeout);
    talkTimer = null;
    talkTimeout = null;
    talkStep = 0;
    box.style.transform = "";
    // Грусть и сон держат свои кадры (закрытые глаза) — не открываем их речью.
    img.src = frame(voice, moodFrame());
    // Речь сбрасывала transform/фильтры для артикуляции — вернуть позу настроения.
    if (moodState.value !== "awake") setMood(moodState.value, true);
    resetIdle();
  };

  // Главный канал: TeraTTS пишет state-файл ровно в момент старта afplay,
  // main-процесс плагина читает его и пушит событие в окно.
  let voiceMap = {};
  let charVoices = {};
  let currentSid = "";
  // Персонаж и голос — разные вещи: по умолчанию голос персонажа совпадает
  // с его id, но в настройках можно привязать любой другой голос.
  // Пиксельные персонажи имеют свои id, но говорят общим голосом.
  const VOICE_ALIAS = {
    px_ru_f1: "ru_f1",
    px_ru_m1: "ru_m1",
    px_fx_robot: "fx_robot",
    px_fx_penguin: "fx_penguin",
    px_fx_demoness: "fx_demoness",
  };
  // Голос персонажа: сначала индивидуальная настройка (localStorage), потом
  // общий файл моста, потом встроенное соответствие пиксельных id.
  // Голос для конкретного языка: авто-режим на сервере берёт нужный сам.
  const charVoiceFor = (id, lang) => {
    if (!id) return id;
    const key = packKey(id);
    const cs = charSettingsFor(key);
    const byLang = cs.voiceByLang || {};
    if (byLang[lang]) return byLang[lang];
    if (lang === "en") return defaultVoiceFor(VOICE_ALIAS[key] || key, "en", key);
    return cs.voice || charVoices[key] || VOICE_ALIAS[id] || VOICE_ALIAS[key] || id;
  };
  const charVoice = (id) => charVoiceFor(id, voiceLang());
  const voiceOf = (id) => (voiceMap && voiceMap[id]) || id;

  // Выбор персонажа храним ещё и в localStorage окна: он читается сразу,
  // не дожидаясь ответа main-процесса, и переживает переключение вкладок.
  const LOCAL_KEY = "x2ai-avatar:voices";
  const loadLocal = () => {
    try {
      const raw = window.localStorage.getItem(LOCAL_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  };
  const saveLocal = (sid, value) => {
    if (!sid) return;
    try {
      const map = loadLocal();
      map[sid] = value;
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(map));
    } catch (e) {}
  };
  let localMap = loadLocal();

  const resolveVoice = (sid) =>
    (sid && (localMap[sid] || voiceMap[sid])) || voiceFor(sid);
  // Всё о персонаже чата одним пакетом: голос, имя, ключ пака и характер.
  // Ключ нужен потому, что px_ru_f1 (Тянка) и ru_f1 (Аня) — разные персонажи.
  const voicePayload = (sid, key) => {
    const cs = charSettingsFor(packKey(key));
    // «Настроить» — это только темп, без готовой окраски движка.
    const custom = cs.emotion === "custom";
    return {
      sid,
      voice: charVoice(key),
      name: charName(key),
      charKey: packKey(key),
      temper: charTemper(key),
      temperText: (cs.temperText || "").trim().slice(0, 400),
      speed: custom ? Number(cs.speed) || 0 : emoSpeed(cs.emotion || ""),
      emotion: custom ? speedEmotion(cs.speed) : cs.emotion || "",
      // Оба голоса сразу: сервер подставит тот, что совпадёт с языком текста.
    };
  };
  // Голос чата на сервер: до готовности моста молчим, потом дошлём.
  function pushVoice(key) {
    if (!bridgeReady || !currentSid || !key) return;
    bridge("/voice", voicePayload(currentSid, key)).catch(() => {});
  }

  const applyForSession = (sid) => {
    if (sid) currentSid = sid;
    const resolved = resolveVoice(currentSid);
    apply(resolved);
    if (!currentSid) return;
    const picked = localMap[currentSid];
    if (!picked) {
      // Новый чат: закрепляем за ним случайного персонажа из включённых,
      // иначе сервер озвучил бы его голосом по своему хешу.
      saveLocal(currentSid, resolved);
      localMap = loadLocal();
      pushVoice(resolved);
      return;
    }
    // Локальный выбор мог появиться раньше, чем мост: досылаем его на сервер.
    // Сравниваем с голосом, который реально звучит: в мосте он без префикса пака.
    const spoken = charVoice(picked);
    if (voiceMap[currentSid] !== spoken) {
      voiceMap[currentSid] = spoken;
      pushVoice(picked);
    }
  };

  const bridge = (route, body) => {
    const init = body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : undefined;
    return fetch(BRIDGE_URL + route, init).then((r) => r.json());
  };
  bridgeReady = true;
  bridge("/speech", { lang: activeLang }).catch(() => {});
  // Голоса и готовые характеры нужны раньше, чем откроют их блок: без них
  // в поле характера не подставить описание персонажа плейсхолдером.
  bridge("/voices")
    .then((data) => {
      voiceCatalog = (data && data.voices) || [];
      installedVoices = Array.isArray(data && data.installed) ? data.installed : [];
      temperPresets = (data && data.tempers) || {};
      ttsEngine = data && data.engine !== false;
      if (panelOpen) renderPanel();
    })
    .catch(() => {});

  // Какие вкладки открыты: закрытый чат не должен звучать. Список открытых
  // вкладок знает хост (ctx.sessions.list), шлём его при изменении и раз в
  // 5 с как heartbeat — без свежего отчёта сервер озвучку не блокирует.
  let openSig = "";
  let openAt = 0;
  const reportOpenTabs = () => {
    if (!bridgeReady) return;
    let ids = [];
    try {
      const list = ctx.sessions.list ? ctx.sessions.list() : null;
      ids = (list || [])
        .map((s) => String((s && (s.id || s.key)) || "").match(/ses_[A-Za-z0-9]+/))
        .filter(Boolean)
        .map((m) => m[0]);
    } catch (e) {
      return;
    }
    // Пустой список — окно ещё не знает своих вкладок: не шлём, иначе
    // сервер на мгновение решит, что открытых чатов нет.
    if (!ids.length) return;
    const sig = ids.join(",");
    if (sig === openSig && Date.now() - openAt < 5000) return;
    openSig = sig;
    openAt = Date.now();
    bridge("/open", { ids }).catch(() => {});
  };
  reportOpenTabs();
  const openTimer = setInterval(reportOpenTabs, 5000);

  // Паки приходят с моста по требованию: в бандле только манифест, кадры
  // лежат файлами plugins/x2ai-avatar/packs/<пак>.json. Так окно не держит
  // в памяти второй, невыбранный пак (аниме — половина веса бандла).
  const packLoading = new Map();
  const ensurePack = (name) => {
    if (!name || !PACK_INDEX[name]) return Promise.resolve(null);
    if (PACKS[name]) return Promise.resolve(PACKS[name]);
    if (packLoading.has(name)) return packLoading.get(name);
    const job = bridge(`/pack?name=${encodeURIComponent(name)}`)
      .then((data) => {
        if (data && !data.error && typeof data === "object") PACKS[name] = data;
        return PACKS[name] || null;
      })
      .catch(() => null)
      .then((pack) => {
        packLoading.delete(name);
        return pack;
      });
    packLoading.set(name, job);
    return job;
  };
  // Внешние паки: папка в ~/.config/opencode/x2ai-avatar-packs/<имя>/sprites.json.
  // Манифест дополняется на месте — список паков сразу видит новые.
  let packsAsked = false;
  const loadExternalPacks = () => {
    if (packsAsked) return;
    packsAsked = true;
    bridge("/packs")
      .then((data) => {
        const packs = (data && data.packs) || {};
        let grew = false;
        for (const [name, info] of Object.entries(packs)) {
          if (PACK_INDEX[name]) continue;
          PACK_INDEX[name] = (info && info.voices) || [];
          grew = true;
        }
        if (grew && panelOpen) renderPanel();
      })
      .catch(() => {});
  };
  // До загрузки кадров картинка пустая: перерисовываем, когда пак пришёл.
  Promise.all([ensurePack(activePack), ensurePack("anime")]).then(() => {
    apply(voice, true);
  });

  // Сервер по этому же списку выбирает голос нового чата, поэтому хеш
  // и в окне, и в озвучке даёт одного персонажа.
  const syncEnabled = () => {
    bridge("/chars", { voices: enabledBases() }).catch(() => {});
  };
  setTimeout(() => {
    syncEnabled();
    pushVoice(resolveVoice(currentSid));
    applyPrefsFor(packKey(voice));
  }, 0);

  const adopt = (map) => {
    voiceMap = map || {};
    localMap = loadLocal();
    for (const [sid, value] of Object.entries(voiceMap)) {
      if (sid && typeof value === "string" && !localMap[sid]) localMap[sid] = value;
    }
    applyForSession(currentSid);
  };

  let adoptedKey = "";
  let bridgeSpeaking = false;
  let lastSpeakAt = 0;
  let lastNoteAt = 0;
  let bubbleSid = "";
  // Имя персонажа синхронизируем с мостом, чтобы правила в промпте знали пак.
  let lastSyncedName = "";
  const syncName = () => {
    if (!currentSid) return;
    const nm = charName(voice);
    if (!nm || nm === lastSyncedName) return;
    lastSyncedName = nm;
    bridge("/voice", { ...voicePayload(currentSid, voice), name: nm }).catch(() => {});
  };

  const bootAt = Date.now();
  const pollBridge = () => {
    syncName();
    // Кадр настроения сторожит себя сам: если спящему вернули «closed»
    // (моргание, конец фразы, перерисовка), глаза снова закрываем.
    if (!speaking && moodState.value !== "awake" && moodFrameShown !== moodFrame()) {
      moodFrameShown = moodFrame();
      img.src = frame(voice, moodFrame());
    }
    // Мост мог подняться уже после первой попытки — добираем настройки здесь.
    if (!speechLoaded) loadSpeechOnce();
    bridge(`/state?sid=${encodeURIComponent(currentSid || "")}`)
      .then((state) => {
        if (!state) return;
        // mute держим синхронным с сервером: после перезагрузки окна иконка
        // должна показывать реальное состояние, а не «звук включён».
        if (state.muted !== undefined && Boolean(state.muted) !== mutedState) {
          mutedState = Boolean(state.muted);
          paintMute();
          repaintBubble();
        }
        if (state.modelDisabled !== undefined) {
          const off = Boolean(state.modelDisabled);
          const hasModel = Boolean(modelsData && modelsData.current && modelsData.current.providerID);
          // Пока модель не выбрана, сервер отвечает «выключено»: не отбираем
          // у пользователя только что включённый селект, иначе он отскакивал.
          if (off !== modelDisabled && (off ? hasModel : true)) {
            modelDisabled = off;
            if (panelOpen) renderPanel();
          }
        }
        const key = JSON.stringify([state.voices || {}, state.charVoices || {}]);
        if (key !== adoptedKey) {
          adoptedKey = key;
          charVoices = state.charVoices || {};
          adopt(state.voices);
        }
        // Сменили чат — старую мысль не показываем: у каждого чата свой пузырь.
        if (currentSid !== bubbleSid) {
          bubbleSid = currentSid;
          lastNoteAt = 0;
          setBubbleText("");
          paintBubble();
        }
        // Звук выключен (mute или тихие часы): сервер присылает текст заметкой,
        // чтобы пузырь показал фразу без озвучки и без артикуляции.
        // Заметка живёт в файле 10 минут — берём только ту, что появилась
        // после загрузки окна, иначе после Cmd+R всплывёт вчерашняя фраза.
        if (state.note && state.note.text && Number(state.note.at) >= bootAt) {
          const nsid = state.note.sid || "";
          if (nsid && currentSid && nsid === currentSid && state.note.at !== lastNoteAt) {
            lastNoteAt = state.note.at;
            const noteLine = bubbleLine(state.note.text);
            if (noteLine) setBubbleText(noteLine);
            bubbleThinking = state.note.kind === "reason";
            bubbleKind = bubbleThinking ? "reason" : "answer";
            paintBubble();
          }
        }
        // Губами двигает только тот чат, чья это озвучка: сервер пишет sid
        // в state-файл, а окно сравнивает его с текущим чатом.
        const mine = !state.sid || !currentSid || state.sid === currentSid;
        if (state.speaking && mine) {
          if (moodState.value === "sleeping") wake();
          const at = Number(state.at) || 0;
          const elapsed = at ? Math.max(0, Date.now() - at * 1000) : 0;
          if (!bridgeSpeaking || (at && at !== lastSpeakAt)) {
            bridgeSpeaking = true;
            lastSpeakAt = at;
            stopClick();
            stopSynth();
            // state.ms — остаток, а elapsed уже прошёл: считаем полную
            // длительность, и только ответы (рассуждения — не «ответы»).
            if (state.kind !== "reason") {
              stats.count += 1;
              if (state.ms > 0) stats.ms += state.ms + elapsed;
            }
            saveStats();
            refreshBadge();
            const total = state.ms > 0 ? state.ms + elapsed : 9000;
            startSpeaking(total, state.kind || "", state.text || "", elapsed);
          }
        } else {
          // Звучит другой чат: если рот уже шёл (переключились посреди фразы),
          // гасим его — иначе артикуляция первого чата продолжается во втором.
          if (bridgeSpeaking) {
            bridgeSpeaking = false;
            stopSpeaking();
          }
        }
      })
      .catch(() => {});
  };
  refreshBadge();
  // Опрос моста адаптивный: часто только пока идёт звук, иначе — редко.
  let bridgeTimer = null;
  const schedulePoll = () => {
    bridgeTimer = setTimeout(() => {
      pollBridge();
      schedulePoll();
    }, bridgeSpeaking ? 200 : 800);
  };
  schedulePoll();

  // Пинг долгой задачи: инструмент работает дольше минуты — персонаж
  // напоминает о себе своим голосом раз в 2.5 минуты.
  // Реплики пинга — по роду персонажа, чтобы «не ушла» не звучало мужским голосом.
  const EN_CLICKS = [
    "Yes?",
    "I'm here.",
    "Did you call me?",
    "Listening.",
    "What is it?",
    "Ready.",
    "One moment.",
    "Hmm?",
  ];
  const EN_SUMMON = ["Hi! I'm {name}.", "Hello, I'm {name}.", "Nice to meet you, I'm {name}."];
  const EN_SAMPLE = ["This is my voice.", "That's how I sound.", "Hello, this is me."];
  const EN_PINGS = {
    f: ["Still working, almost done.", "Carrying on, I'm here.", "A couple more minutes."],
    m: ["Still working, almost done.", "Carrying on, I'm here.", "A couple more minutes."],
    n: ["Still working, almost done.", "Still working.", "A couple more minutes."],
  };
  const PING_PHRASES = {
    f: ["Ещё работаю, почти.", "Продолжаю, не ушла.", "Ещё пара минут."],
    m: ["Ещё работаю, почти.", "Продолжаю, не ушёл.", "Ещё пара минут."],
    n: ["Ещё работаю, почти.", "Продолжаю работу.", "Ещё пара минут."],
  };
  const FEMALE_VOICES = ["fx_demoness"];
  const MALE_VOICES = ["fx_demon"];
  const voiceGender = (id) => {
    const v = String(id || "");
    if (/_f$/.test(v) || FEMALE_VOICES.includes(v)) return "f";
    if (/_m$/.test(v) || MALE_VOICES.includes(v)) return "m";
    return "n";
  };
  // Старый вид мог оставить свои таймеры — гасим их при каждом новом рендере.
  pingReset();
  PING.say = (text, sid) =>
    bridge("/say", { text, sid, voice: charVoice(voiceOf(sid)) }).catch(() => {});

  const pingTimers = PING.timers;
  const pingDelays = PING.delays;
  const activityAt = PING.activity;
  const markActive = (sid) => {
    if (sid) activityAt.set(sid, Date.now());
  };

  const pingStop = (sid) => {
    const key = sid || "";
    const t = pingTimers.get(key);
    if (t) clearTimeout(t);
    pingTimers.delete(key);
    pingDelays.delete(key);
  };

  // Пинг говорит голосом ТОГО чата, где идёт работа, а не активной вкладки.
  const pingStart = (sid) => {
    const key = sid || "";
    if (!key || pingTimers.has(key)) return;
    const tick = () => {
      // Агент простаивает дольше полутора минут — реплики прекращаем.
      if (Date.now() - (activityAt.get(key) || 0) > 90000) {
        pingStop(key);
        return;
      }
      const KEY = `x2ai-avatar:ping:${key}`;
      let last = 0;
      try {
        last = Number(localStorage.getItem(KEY) || 0) || 0;
      } catch (e) {}
      if (Date.now() - last >= 60000) {
        try {
          localStorage.setItem(KEY, String(Date.now()));
        } catch (e) {}
        const gender = voiceGender(charVoice(voiceOf(key)));
        const list =
          voiceLang() === "en"
            ? EN_PINGS[gender] || EN_PINGS.n
            : PING_PHRASES[gender] || PING_PHRASES.n;
        const phrase = list[Math.floor(Math.random() * list.length)];
        // Если что-то уже звучит — реплику не повторяем, просто считаем сказанной.
        bridge("/say", { text: phrase, sid: key, voice: charVoice(voiceOf(key)) }).catch(() => {});
      }
      const next = Math.min(600000, Math.round((pingDelays.get(key) || 60000) * 1.6));
      pingDelays.set(key, next);
      pingTimers.set(key, setTimeout(tick, next));
    };
    pingTimers.set(key, setTimeout(tick, pingDelays.get(key) || 60000));
  };

  // Клик по персонажу: короткая заранее сгенерированная реплика его голосом.
  // Ждать TeraTTS не нужно — звук уже лежит внутри плагина.
  box.style.cursor = "pointer";

  // Одна реплика за раз: новый клик глушит предыдущую и текущую озвучку ответа.
  let clickAudio = null;
  const stopClick = () => {
    if (!clickAudio) return;
    try {
      clickAudio.pause();
      clickAudio.currentTime = 0;
    } catch (e) {}
    clickAudio = null;
  };
  // Глушим только свой чат: очередь других чатов не трогаем.
  const stopAll = () => {
    stopClick();
    stopSynth();
    stopSpeaking();
    bridge("/stop", { sid: currentSid }).catch(() => {});
  };

  box.onclick = (event) => {
    // Реплика — только по самому персонажу. Настройки и пузырь живут в этом
    // же контейнере, и раньше отпускание ползунка звучало как клик по нему.
    if (event && event.target !== img) return;
    // Пока персонаж говорит, клик его замолкает; в тишине — просто реплика.
    const wasSpeaking = speaking;
    stopAll();
    if (!wasSpeaking) {
      if (voiceLang() === "en") {
        const text = pickClip(EN_CLICKS);
        if (text) {
          if (mutedState) {
            showLineOnly(text);
            return;
          }
          bridge("/say", { text, sid: currentSid, voice: charVoice(voice) }).catch(() => {});
        }
        return;
      }
      const clip = pickClip(CLICKS[clipVoice(voice)] || CLICKS.ru_f1);
      playClip(clip, clip && clip.text);
    }
  };

  // Правый клик — настройки персонажа.
  box.oncontextmenu = (event) => {
    if (event) event.preventDefault();
    togglePanel(true);
  };

  // Моргание только в тишине, чтобы не спорить с артикуляцией.
  const scheduleBlink = () => {
    blinkTimer = setTimeout(() => {
      // Во сне глаза уже закрыты (кадр blink): моргание только наяву, иначе
      // через 120 мс кадр возвращает открытые глаза.
      if (!speaking && moodState.value === "awake") {
        img.src = frame(voice, "blink");
        setTimeout(() => {
          // За 120 мс можно успеть заснуть — тогда глаза не открываем.
          if (!speaking && moodState.value === "awake") {
            img.src = frame(voice, "closed");
            moodFrameShown = "closed";
          }
        }, 120);
      }
      scheduleBlink();
    }, 2600 + Math.random() * 2800);
  };
  scheduleBlink();

  // Озвучка стартует по событию сервера приложения ("sidecar").
  // session.server.data в окне может быть устаревшим — берём сервер по id.
  const onSpeak = (name) => (event) => {
    const id = (event && event.data && event.data.sessionID) || "no-sid";
    evCount++;
    wake();
    // При выключенном звуке нечего дожидаться: фразу покажет пузырь.
    if (!mutedState) startSynth();
    // Событие может прийти из неактивного чата: спрайт активного не трогаем.
    if (String(id).startsWith("ses_") && id === currentSid) applyForSession(id);
    // Рот НЕ двигаем по событию ответа: между концом ответа и стартом звука
    // проходит пересказ и синтез (бывает 10+ секунд, а на холодную модель
    // ещё дольше). Артикуляция идёт только по сигналу afplay через Ipc.
  };

  try {
    createKeyed(
      () => {
        const servers = ctx.servers;
        const ref = servers && servers.get ? servers.get("sidecar") : null;
        return ref && ref.data;
      },
      (data) => {
        if (!data) {
          return;
        }
        const offs = [];
        try {
          offs.push(
            data.on("session.created", (event) => {
              const id = event && event.data && event.data.id;
              if (String(id).startsWith("ses_") && id === currentSid) applyForSession(id);
            }),
          );
        } catch (err) {
        }
        let answerStartedAt = 0;
        for (const name of ["session.execution.succeeded", "session.execution.interrupted"]) {
          try {
            offs.push(
              data.on(name, (event) => {
                onSpeak(name)(event);
                // Длительность ответа считаем на том же событии, что и
                // артикуляцию: второй обработчик на succeeded не нужен.
                if (name !== "session.execution.succeeded") return;
                markActive(currentSid);
                if (answerStartedAt > 0) {
                  lastAnswerMs = Date.now() - answerStartedAt;
                  answerStartedAt = 0;
                  refreshBadge();
                }
              }),
            );
          } catch (err) {
          }
        }
        for (const name of ["session.execution.started"]) {
          try {
            offs.push(
              data.on(name, (event) => {
                const id = (event && event.data && event.data.sessionID) || "";
                if (id && currentSid && id !== currentSid) return;
                answerStartedAt = Date.now();
                markActive(id || currentSid);
                pingStart(id || currentSid);
              }),
            );
          } catch (err) {
          }
        }
        for (const name of ["session.tool.called"]) {
          try {
            offs.push(
              data.on(name, (event) => {
                const id = (event && event.data && event.data.sessionID) || "";
                markActive(id || currentSid);
              }),
            );
          } catch (err) {
          }
        }
        // Инструмент работает — просто отмечаем, что чат активен.
        for (const name of ["session.tool.progress", "session.tool.input.started", "session.tool.input.ended"]) {
          try {
            offs.push(
              data.on(name, (event) => {
                markActive((event && event.data && event.data.sessionID) || "");
              }),
            );
          } catch (err) {
          }
        }
        for (const name of ["session.tool.error", "session.tool.failed"]) {
          try {
            offs.push(
              data.on(name, (event) => {
                const id = (event && event.data && event.data.sessionID) || "";
                if (id && currentSid && id !== currentSid) return;
                if (charReact(voice)) sadFor(2500);
              }),
            );
          } catch (err) {
          }
        }
        for (const name of [
          "session.tool.success",
          "session.tool.error",
          "session.tool.failed",
          "session.execution.succeeded",
          "session.execution.failed",
          "session.execution.interrupted",
        ]) {
          try {
            offs.push(
              data.on(name, (event) => {
                const id = (event && event.data && event.data.sessionID) || "";
                pingStop(id);
                if (!id) pingStop(currentSid);
              }),
            );
          } catch (err) {
          }
        }
        for (const name of ["session.execution.failed", "session.execution.error", "session.execution.errored"]) {
          try {
            offs.push(
              data.on(name, (event) => {
                const id = (event && event.data && event.data.sessionID) || "";
                if (String(id).startsWith("ses_") && id !== currentSid) return;
                if (charReact(voice)) sadFor(4200);
              }),
            );
          } catch (err) {
          }
        }
        onCleanup(() => {
          for (const off of offs) if (typeof off === "function") off();
        });
      },
    );
  } catch (e) {
  }

  // Горячие клавиши окна: не надо лезть в панель, чтобы замолчать.
  // В полях ввода не перехватываем — там Cmd/Ctrl+Shift могут значить другое.
  const onHotkey = (ev) => {
    if (!uiPrefs.keys) return;
    if (!(ev.metaKey || ev.ctrlKey) || !ev.shiftKey) return;
    const tag = String((ev.target && ev.target.tagName) || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    const key = String(ev.key || "").toLowerCase();
    const actions = {
      m: () => setMuted(!mutedState),
      s: () => stopAll(),
      a: () => togglePanel(),
    };
    if (!actions[key]) return;
    ev.preventDefault();
    actions[key]();
  };
  document.addEventListener("keydown", onHotkey, true);

  // Единая уборка: таймеры, опросы, подписка и слушатели документа.
  const teardown = () => {
    pingReset();
    clearTimeout(blinkTimer);
    clearTimeout(idleTimer);
    clearTimeout(moodTimer);
    clearTimeout(speakTimer);
    clearTimeout(talkTimeout);
    clearTimeout(bridgeTimer);
    clearInterval(sidePoll);
    clearInterval(openTimer);
    if (talkTimer) clearInterval(talkTimer);
    stopBubbleRotate();
    if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onHotkey, true);
    if (typeof unsub === "function") {
      try {
        unsub();
      } catch (e) {}
    }
  };
  globalThis.__x2aiAvatarTeardown = teardown;

  root.destroy = teardown;

  return root;
}

module.exports = Plugin.define({
  i18n: { en: { title: "x2ai avatar" }, ru: { title: "Персонаж x2ai" } },
  setup(ctx) {
    ctx.add(Slot, {
      at: "window.bottom",
      order: 1,
      render: () => {
        const el = createView(ctx);
        el.title = "x2ai · Аня · ru_f1";
        return el;
      },
    });
  },
});
