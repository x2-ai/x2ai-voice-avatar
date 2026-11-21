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
// Виртуальный пак: все персонажи всех паков сразу. Включения и настройки
// у него свои (ключи с префиксом "@all::"), с отдельными паками не связаны.
const ALL_PACK = "@all";
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
    px_fx_penguin: "Инопланетянин", px_ru_m1: "Программист", px_ru_m5: "Гопник",
    px_fx_ghost: "Призрак",
    px_x2ai_ment: "Мент",
    px_x2ai_alkash: "Алкаш",
    px_x2ai_bratok: "Браток",
    px_x2ai_babka: "Бабка",
    px_x2ai_sosochka: "Сосочка",
    px_x2ai_telochka: "Тёлочка",
    px_x2ai_narik: "Нарик",
    px_x2ai_novyi_russkiy: "Новый русский",
    px_x2ai_kotohaker: "Котохакер",
    px_x2ai_tsundere: "Цундере",
    px_x2ai_sakura: "Сакура",
    px_x2ai_neko: "Нэко",
    px_x2ai_gakusei: "Отличница",
    px_x2ai_senpai: "Сенпай",
    px_x2ai_samurai: "Самурай",
    px_x2ai_mahou: "Махо-сёдзё",
    px_x2ai_onime: "Онимэ",
    px_x2ai_ninja: "Ниндзя",
  },
  bit16night: {
    px_x2ai_kotohaker: "Котохакер",
    px_fx_demoness: "Демонесса",
    px_fx_robot: "Робот",
    px_fx_penguin: "Инопланетянин",
    px_fx_ghost: "Призрак",
  },
  bit16: {
    px_ru_m1: "Программист",
    px_x2ai_coder: "Кодер",
    px_x2ai_programmer: "Программистка",
    px_x2ai_codergirl: "Кодерша",
  },
  bit16ninety: {
    px_ru_m5: "Гопник",
    px_x2ai_telochka: "Тёлочка",
    px_x2ai_ment: "Мент",
    px_x2ai_bratok: "Браток",
    px_x2ai_sosochka: "Сосочка",
    px_x2ai_novyi_russkiy: "Новый Русский",
    px_x2ai_babka: "Бабка",
    px_x2ai_alkash: "Алкаш",
    px_x2ai_narik: "Нарик",
  },
};

// Имя зависит от пака: в пиксельном свои названия, в аниме — прежние.
// В «все доступные» ищем пак, которому принадлежит персонаж, иначе пиксельные
// id остались бы без имени.
function nameFor(voice) {
  const key = packKey(voice);
  if (activePack === ALL_PACK) {
    for (const name of packList()) {
      const pack = CHAR_NAMES[name] || {};
      if (pack[key]) return pack[key];
    }
  }
  const pack = CHAR_NAMES[activePack] || {};
  return pack[key] || CHAR_NAMES.anime[key] || CHAR_NAMES.anime[voice] || voice;
}
// Детализация пересказа: 0 — совсем коротко, 1 — подробно, 0.5 = 400 символов.
const detailChars = (v) => {
  const k = Math.min(1, Math.max(0, Number(v)));
  return Math.round((120 + k * 560) / 10) * 10;
};

const HEIGHT = 224; // px на экране (спрайты 336 px)

// Персонажи с обрезанным левым краем кадра (широкие плечи уходят за экран):
// справа их отражаем по горизонтали, чтобы обрез ушёл за правый край окна.
const MIRROR_CHARS = new Set(["x2ai_novyi_russkiy", "x2ai_bratok"]);
// Призрак нарисован смотрящей вправо: слева его отражаем, справа — как есть.
const MIRROR_LEFT_CHARS = new Set(["fx_ghost"]);

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
// Ключ — id персонажа внутри пака (px_ru_f1, fx_cat). В виртуальном паке
// «все доступные» те же персонажи получают свой набор: ключ получает префикс
// "@all::", поэтому настройки паков и общего режима не пересекаются.
const CHAR_SETTINGS_KEY = "x2ai-avatar:char-settings";
let charSettings = {};
try {
  const raw = JSON.parse(localStorage.getItem(CHAR_SETTINGS_KEY) || "{}");
  if (raw && typeof raw === "object") charSettings = raw;
} catch (e) {}
const settingsKey = (key) => {
  const base = packKey(key);
  if (!base) return "";
  return activePack === ALL_PACK ? `${ALL_PACK}::${base}` : base;
};
const charSettingsFor = (key) => (key && charSettings[settingsKey(key)]) || {};
const saveCharSetting = (key, patch) => {
  if (!key) return;
  const sk = settingsKey(key);
  charSettings[sk] = { ...(charSettings[sk] || {}), ...patch };
  try {
    localStorage.setItem(CHAR_SETTINGS_KEY, JSON.stringify(charSettings));
  } catch (e) {
    console.warn("x2ai: настройки персонажа не сохранились", e);
  }
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
// Сторона окна, с которой висит персонаж. На панели это «Слева/Справа»,
// у каждого персонажа может быть своё значение (иначе — общее).
const SIDES = ["left", "right"];
const UI_DEFAULT = { bubble: "mute", keys: true, react: true, logs: false, side: "left", enabled: true };
let uiPrefs = { ...UI_DEFAULT };
try {
  const raw = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
  if (raw && typeof raw === "object") {
    // Старая настройка была галочкой: true/false превращаем в режим.
    // Старый чекбокс: включён — показывали всегда, значит «always» (а не «mute»),
    // иначе после обновления пузырь у тех, кто его включил, молча исчезает.
    if (typeof raw.bubble === "boolean") raw.bubble = raw.bubble ? "always" : "off";
    if (!BUBBLE_MODES.includes(raw.bubble)) delete raw.bubble;
    if (!SIDES.includes(raw.side)) delete raw.side;
    if (typeof raw.enabled !== "boolean") delete raw.enabled;
    uiPrefs = { ...UI_DEFAULT, ...raw };
  }
} catch (e) {}
const saveUiPref = (patch) => {
  uiPrefs = { ...uiPrefs, ...patch };
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(uiPrefs));
  } catch (e) {
    console.warn("x2ai: настройки окна не сохранились", e);
  }
};
// Общий выключатель плагина: персонаж, реакции, клики, звук. Когда выключен,
// на экране остаётся только кнопка питания.
const pluginOn = () => uiPrefs.enabled !== false;

// Дефолтные имена по-английски. Своё имя, введённое пользователем, важнее
// и никогда не переводится.
const CHAR_NAMES_EN = {
  ru_f1: "Anya", ru_f2: "Mila", ru_m1: "Grisha", ru_m5: "Timur",
  fx_robot: "Robik", fx_demoness: "Azazel", fx_alien: "Zeta",
  fx_cat: "Murzik", fx_penguin: "Piko", fx_ghost: "Yuki",
  px_ru_f1: "Tyanka", px_fx_robot: "Robot", px_fx_demoness: "Demoness",
  px_fx_penguin: "Alien", px_ru_m1: "Programmer", px_ru_m5: "Gopnik",
  px_fx_ghost: "Ghost",
  px_x2ai_ment: "Cop",
  px_x2ai_alkash: "Drunkard",
  px_x2ai_bratok: "Bratok",
  px_x2ai_babka: "Granny",
  px_x2ai_sosochka: "Cutie",
  px_x2ai_telochka: "Babe",
  px_x2ai_narik: "Junkie",
  px_x2ai_novyi_russkiy: "New Russian",
  px_x2ai_kotohaker: "Cat Hacker",
  px_x2ai_coder: "Coder",
  px_x2ai_programmer: "Programmer",
  px_x2ai_codergirl: "Code Girl",
  px_x2ai_tsundere: "Tsundere",
  px_x2ai_sakura: "Sakura",
  px_x2ai_neko: "Neko",
  px_x2ai_gakusei: "Honor Student",
  px_x2ai_senpai: "Senpai",
  px_x2ai_samurai: "Samurai",
  px_x2ai_mahou: "Magical Girl",
  px_x2ai_onime: "Onime",
  px_x2ai_ninja: "Ninja",
};
const charName = (key) => {
  const k = packKey(key);
  const custom = (charSettingsFor(k).name || "").trim();
  if (custom) return custom;
  const base = nameFor(k);
  return activeLang === "ru" ? base : CHAR_NAMES_EN[k] || base;
};
// Характер — галочка в настройках персонажа: сервер добавляет в правила чата
// не только имя и род, но и манеру речи. По умолчанию включён у всех;
// выключается только явно (false в настройках персонажа).
const charTemper = (key) => charSettingsFor(packKey(key)).temper !== false;
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

// Пак и персонажи по проектам: { [каталог]: { pack, enabled: { [пак]: [id] } } }.
// pack === "" — «по умолчанию»: берутся глобальные настройки.
const PROJECTS_KEY = "x2ai-avatar:projects";
let projects = {};
try {
  const raw = JSON.parse(localStorage.getItem(PROJECTS_KEY) || "{}");
  if (raw && typeof raw === "object") projects = raw;
} catch (e) {}
let projectDir = "";
const saveProjects = () => {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch (e) {}
};
const projectEntry = (dir) => (dir && projects[dir]) || {};
const projectPack = (dir) => {
  const value = projectEntry(dir).pack;
  return typeof value === "string" ? value : "";
};
const packKnown = (name) => name === ALL_PACK || Boolean(PACK_INDEX[name]);
const hasProjectPack = (dir) => Boolean(projectPack(dir)) && packKnown(projectPack(dir));
const PROJECTS_OFF = true; // временно выключено: окно падало на этой фиче
const projectEnabled = (pack) => {
  if (PROJECTS_OFF) return null;
  if (!hasProjectPack(projectDir) || projectPack(projectDir) !== pack) return null;
  const list = projectEntry(projectDir).enabled && projectEntry(projectDir).enabled[pack];
  return Array.isArray(list) ? list : null;
};
const projectDirs = () => {
  const list = Object.keys(projects);
  if (projectDir && !list.includes(projectDir)) list.unshift(projectDir);
  return list;
};
function restoreProjectPack() {
  if (PROJECTS_OFF) return Promise.resolve(false);
  return bridge("/project")
    .then((data) => {
      projectDir = String((data && data.dir) || "");
      const name = projectPack(projectDir);
      if (!name || !packKnown(name) || name === activePack) return false;
      setPack(name, false);
      return ensurePack(name).then(() => true);
    })
    .catch(() => false);
}
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
  const saved = projectEnabled(name) || enabledMap[name];
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
  if (hasProjectPack(projectDir) && projectPack(projectDir) === activePack) {
    const entry = projects[projectDir] || (projects[projectDir] = { pack: activePack, enabled: {} });
    entry.enabled = entry.enabled || {};
    entry.enabled[activePack] = next;
    saveProjects();
    return true;
  }
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
  "x2ai_ment", "x2ai_alkash", "x2ai_bratok", "x2ai_babka", "x2ai_sosochka", "x2ai_telochka",
  "x2ai_narik", "x2ai_novyi_russkiy", "x2ai_kotohaker",
  "x2ai_coder", "x2ai_programmer", "x2ai_codergirl",
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
  // «Все доступные»: в объединении id бывают и с префиксом пака, и без.
  if (activePack === ALL_PACK) {
    const available = packVoices();
    if (available.includes(`px_${base}`)) return `px_${base}`;
    if (available.includes(base)) return base;
    return base;
  }
  const pack = PACKS[activePack] || {};
  if (pack[`px_${base}`]) return `px_${base}`;
  if (pack[base]) return base;
  return base;
}

// Паки: только собственные арты. Отсутствующий персонаж ищется по всем пакам.
const PACK_NAMES = { pixel: "16Bit - Аниме", bit16: "16Bit - Кодеры", bit16night: "16Bit - Ночная смена", bit16ninety: "16Bit - Девяностые", [ALL_PACK]: "Все доступные" };
const PACK_KEY = "x2ai-avatar:pack";

let activePack = "pixel";
try {
  const saved = localStorage.getItem(PACK_KEY);
  if (saved === ALL_PACK || (saved && PACK_INDEX[saved])) activePack = saved;
} catch (e) {}
if (activePack !== ALL_PACK && !PACK_INDEX[activePack]) activePack = packList()[0] || "pixel";

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
    "Поведение": "Behaviour",
    "Пузырь с текстом": "Text bubble",
    "Не показывать": "Don't show",
    "Только при отключённом звуке": "Only when muted",
    "Показывать всегда": "Always show",
    "Короткая фраза, которую персонаж говорит сейчас. Если озвучка ответа или рассуждений выключена, пузырь не появляется.":
      "The short line the character is saying now. If answer or reasoning speech is off, the bubble never shows.",
    "Короткая фраза, которую персонаж говорит сейчас.": "The short phrase being spoken now.",
    "Горячие клавиши": "Hotkeys",
    "⌘/Ctrl+Shift+M — звук, +S — стоп, +A — панель.": "⌘/Ctrl+Shift+M — mute, +S — stop, +A — panel.",
    "Реакции": "Reactions",
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
    "Все доступные": "All available",
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
    "Расположение персонажа": "Character position",
    "Как в общих настройках": "Use global setting",
    "Слева": "Left",
    "Справа": "Right",
    "Слева или справа от окна. «Как в общих настройках» — значение из «Дополнительно».":
      "Left or right of the window. “Use global setting” takes the value from Advanced.",
    "Применится не ко всем: у персонажей со своей стороной останется та, что выбрана в их настройках.":
      "Not everyone will move: characters with their own side keep the one chosen in their settings.",
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
    "Не читает и не озвучивает ответы сама: сжимает текст для «Кратко» и переводит рассуждения на язык озвучки, если включён перевод. Локальные и бесплатные модели — в начале списка. Если модель недоступна, персонаж молчит: машинного перевода нет.":
      "Does not read or voice answers itself: it shortens the text for Brief mode and translates reasoning into the speech language when translation is on. Local and free models come first. If the model is unavailable, the character stays silent: there is no machine translation.",
    "Отключено": "Off",
    "Включено": "On",
    "Поиск модели": "Search model",
    "не удалось получить список": "could not load the list",
    "локальных и бесплатных моделей нет": "no local or free models",
    "ничего не найдено": "nothing found",
    "Обновить список": "Refresh list",
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
    "дремлет": "dozing",
    "Показывать логи": "Show logs",
    "Проекты": "Projects",
    "по умолчанию": "default",
    "По умолчанию": "Default",
    "Пак и персонажи для конкретного проекта. «По умолчанию» — общие настройки.":
      "Pack and characters for this project. \"Default\" uses the global settings.",
    "правила чата: выданы": "chat rules: sent",
    "правила чата: ещё нет": "chat rules: not yet",
    "правила чата: неизвестно": "chat rules: unknown",
    "Потягивание": "Stretching",
    "Улыбка": "Smile",
    "Радость": "Joy",
    "Гордость": "Pride",
    "Любопытство": "Curiosity",
    "Тревога": "Worry",
    "Смена чата": "Chat switch",
    "Смущение": "Blush",
    "Скука": "Boredom",
    "Злость": "Anger",
    "злится": "angry",
    "Аниме": "Anime",
    "Характер": "Character",
    "Добавляет в чат манеру речи персонажа: как он шутит, злится и разговаривает.":
      "Adds the character's way of speaking to the chat: how they joke, get annoyed and talk.",
    "Пиксельарт": "Pixel art",
    "Следующий персонаж из пака": "Next character from the pack",
    "Выключить озвучку": "Mute speech",
    "Выключить плагин": "Turn plugin off",
    "Включить плагин": "Turn plugin on",
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
  x2ai_ment: "eng_m3",
  x2ai_alkash: "eng_m3",
  x2ai_bratok: "eng_m3",
  x2ai_babka: "eng_f3",
  x2ai_sosochka: "eng_f3",
  x2ai_telochka: "eng_f3",
  x2ai_narik: "eng_m3",
  x2ai_novyi_russkiy: "eng_m3",
    x2ai_kotohaker: "eng_m3",
    x2ai_coder: "eng_m3",
    x2ai_programmer: "eng_f3",
    x2ai_codergirl: "eng_f3",
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
// У «все доступные» — объединение всех паков без повторов.
function packVoices(name) {
  const key = name || activePack;
  if (key === ALL_PACK) {
    const out = [];
    for (const packName of packList()) {
      for (const voice of packVoices(packName)) {
        if (!out.includes(voice)) out.push(voice);
      }
    }
    return out;
  }
  const pack = PACKS[key] || {};
  const list = Object.keys(pack).length ? Object.keys(pack) : PACK_INDEX[key] || [];
  return list.filter((voice) => !pack[voice] || (pack[voice] && pack[voice].closed));
}

function setPack(name, remember = true) {
  if (name !== ALL_PACK && !PACK_INDEX[name]) return;
  activePack = name;
  if (!remember) return;
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

// Набор кадров персонажа: в «все доступные» ищем по всем пакам, иначе —
// выбранный пак с запасным аниме.
function frameSetFor(voice) {
  const key = packKey(voice);
  if (activePack === ALL_PACK) {
    for (const name of packList()) {
      const set = PACKS[name] && PACKS[name][key];
      if (set) return set;
    }
  }
  const pack = PACKS[activePack] || {};
  if (pack[key]) return pack[key];
  // Персонаж мог переехать в другой пак (pixel → bit16): ищем по всем пакам,
  // иначе окно покажет чужой кадр из базового anime.
  for (const name of packList()) {
    const set = PACKS[name] && PACKS[name][key];
    if (set && set.closed) return set;
  }
  const base = PACKS[packList()[0]] || {};
  return base[key] || EMPTY_FRAME;
}

function frame(voice, state) {
  const set = frameSetFor(voice);
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
    // Кадры рисуются в 336 px, а на экране обычно 224 — при сглаживании
    // браузер размазывает контур и белую рубашку в кайму. Nearest-neighbor
    // держит пиксель-арт чистым, без серой обводки.
    "image-rendering:pixelated",
    "filter:drop-shadow(0 2px 6px rgba(0,0,0,.28))",
    "transition:opacity 90ms linear",
  ].join(";");
  // Спрайты бывают выше 336 px (самурай с пучком): при загрузке кадра
  // пересчитываем высоту, чтобы он выглядел пропорционально выше остальных.
  img.addEventListener("load", () => {
    const px = spritePx();
    img.style.height = `${px}px`;
    panel.style.bottom = `${px + 30}px`;
  });
  box.appendChild(img);


  let evCount = 0;
  let lastSid = "";

  // Настроение персонажа: awake | sad | sleeping. Храним в объекте, чтобы
  // функции, объявленные выше, могли читать его без TDZ.
  const moodState = { value: "awake" };

  let voice = "ru_f1";
  img.src = frame(voice, "closed");

  // Какой пак сейчас держит этого персонажа (null — уже текущий или «все доступные»).
  const packForVoice = (v) => {
    const key = packKey(v);
    if (activePack === ALL_PACK) return null;
    if ((PACK_INDEX[activePack] || []).includes(key)) return null;
    for (const name of packList()) {
      if (name === ALL_PACK) continue;
      if ((PACK_INDEX[name] || []).includes(key)) return name;
    }
    return null;
  };

  const apply = (next, force) => {
    if (!next || (next === voice && !force)) return;
    voice = next;
    // Пак, в котором сейчас лежит персонаж: после переезда pixel → bit16
    // сохранённый пак может его уже не содержать.
    const owner = packForVoice(next);
    if (owner) {
      setPack(owner);
      ensurePack(owner)
        .then(() => {
          if (voice === next) img.src = frame(voice, moodFrame());
        })
        .catch(() => {});
    }
    img.src = frame(voice, moodFrame());
    moodFrameShown = moodFrame();
    if (moodState.value !== "awake") setMood(moodState.value, true);
    root.title = `x2ai · ${charName(voice)} · ${voice}`;
    applyHeightFor(packKey(next));
    applySide(packKey(next));
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

  // Кнопка питания: общий выключатель плагина. Живёт прямо в root, а не в box:
  // при выключении box вместе со спрайтом и панелью прячется, а кнопка
  // остаётся на нижнем краю окна — иначе включить было бы нечем.
  const powerBtn = document.createElement("button");
  powerBtn.type = "button";
  powerBtn.textContent = "⏻";
  powerBtn.title = t("Выключить плагин");
  powerBtn.style.cssText = [
    "position:absolute",
    "left:10px",
    "bottom:12px",
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
    "z-index:4",
    "pointer-events:auto",
    "transition:opacity 120ms ease",
  ].join(";");
  root.appendChild(powerBtn);

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
  // charHeight — высота «эталонного» спрайта в 336 px. Если спрайт выше
  // (например, у самурая пучок волос торчит над головой), он рисуется
  // пропорционально выше, а низ остаётся на месте — как у остальных.
  const spritePx = () => {
    const nat = img.naturalHeight || 336;
    return Math.max(1, Math.round((charHeight * nat) / 336));
  };
  function applyHeight(value) {
    const h = Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, Number(value) || DEFAULT_HEIGHT)));
    charHeight = h;
    const px = spritePx();
    img.style.height = `${px}px`;
    panel.style.bottom = `${px + 30}px`;
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
  // дальше каждый живёт отдельно. Для «все доступные» правило то же самое:
  // дефолты у паков и виртуального пака одинаковы.
  function seedPackSettings() {
    for (const k of packVoices()) {
      const cs = charSettingsFor(k);
      if (!cs.speech) saveCharSetting(k, { speech: speechMode || "summary" });
      if (!cs.reason) {
        saveCharSetting(k, { reason: reasonState || { mode: "off", translate: true } });
      }
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
  // Зеркальный персонаж? Проверяем и id пака (px_…), и базовый голос.
  const isMirror = (id) => {
    const key = packKey(id || voice);
    return MIRROR_CHARS.has(key) || MIRROR_CHARS.has(VOICE_ALIAS[key] || key);
  };
  // Левостороннее зеркало: кадр отражается, когда персонаж стоит слева.
  const isMirrorLeft = (id) => {
    const key = packKey(id || voice);
    return MIRROR_LEFT_CHARS.has(key) || MIRROR_LEFT_CHARS.has(VOICE_ALIAS[key] || key);
  };
  function pickClip(list) {
    return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  // Поколение реплик: смена персонажа, клик-стоп и стоп по кнопке поднимают
  // метку. Всё, что было отправлено раньше, отменяется — и таймер повтора в
  // окне, и уже летящий запрос на сервере (он сверяет token).
  let sayToken = 0;
  const bumpSayToken = () => (sayToken = Math.max(Date.now(), sayToken + 1));

  // voiceId — чей голос: при смене персонажа voice ещё старый (apply ждёт
  // конца анимации), поэтому реплику озвучиваем голосом того, на кого уходим.
  function playClip(item, text = "", voiceId, rawVoice = false) {
    const line = text || (item && item.text) || "";
    if (!item || !line) return 0;
    // Звук выключен — клика не слышно, но текст реплики уходит в пузырь
    // (если пузырь вообще разрешён настройкой).
    if (mutedState) {
      showLineOnly(line);
      return 0;
    }
    // Клик озвучивает движок: готовых звуков в плагине нет, артикуляция
    // приходит из /state как обычно. Движок может быть занят чужой фразой —
    // тогда ждём её конца и повторяем один раз, иначе клик пропадал бы молча.
    // rawVoice — озвучить ровно этот голос, не глядя на настройки персонажа:
    // так пример в списке голосов звучит выбранным голосом, а не прежним.
    const sayVoice = rawVoice && voiceId ? voiceId : charVoice(voiceId || voice);
    // Токен фиксируем на момент запроса: если персонажа успели сменить или
    // нажать стоп, повтор уже не отправится и старая реплика не зазвучит.
    const token = sayToken;
    const postSay = () =>
      bridge("/say", { text: line, sid: currentSid || "", voice: sayVoice, token });
    const ask = () =>
      postSay()
        .then((res) => {
          const wait = Number(res && res.wait) || 0;
          if (res && res.ok === false && res.reason === "busy" && wait > 0) {
            setTimeout(() => {
              if (token !== sayToken) return;
              postSay().catch(() => {});
            }, Math.min(5000, wait + 200));
          }
        })
        .catch(() => {});
    ask();
    return 0;
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
        else bridge("/say", { text, sid: currentSid, voice: charVoice(next), token: sayToken }).catch(() => {});
      }
    } else {
      // Реплики есть по голосу, а не по id персонажа.
      const line = pickClip(LINES.lines && (LINES.lines[clipVoice(next)] || LINES.lines[next]));
      playClip(line, line && line.text, next);
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
  const sectionOpen = { pack: false, voice: false, char: false, side: false, speech: false, model: false, user: false, stats: false, reason: false, temper: false };

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
        const packKeyNow = pick || voice;
        playClip(packClips && (packClips[packKeyNow] || packClips[clipVoice(packKeyNow)]));
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
      // «Все доступные» — виртуальный пак: все персонажи всех паков сразу,
      // со своими включениями и настройками (не наследует настройки паков).
      for (const name of [ALL_PACK, ...packList()]) {
        const count = packVoices(name).length;
        pList.appendChild(
          vRow(`${t(PACK_NAMES[name] || name)} · ${count}`, name === activePack, () => {
            switchPack(name);
            renderPanel();
          }),
        );
      }
      pBody.appendChild(pList);
      hint("«Все доступные» — персонажи всех паков сразу. Его галочки доступности и настройки персонажей хранятся отдельно и не меняют настройки самих паков.", pBody);

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

      // Проекты: у каждого каталога свой пак и свой набор доступных персонажей.
      // «По умолчанию» — общие настройки окна, «Все доступные» — виртуальный пак.
      const prBody = collapsible("Проекты", "projects", box);
      const prHint = document.createElement("div");
      prHint.style.cssText = "font-size:10px;line-height:1.5;opacity:.6;margin:2px 0 6px";
      prHint.textContent = t("Пак и персонажи для конкретного проекта. «По умолчанию» — общие настройки.");
      prBody.append(prHint);
      const prList = document.createElement("div");
      prList.style.cssText = "display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto";
      prBody.append(prList);

      const projectRow = (dir) => {
        const entry = projects[dir] || (projects[dir] = {});
        const wrap = document.createElement("div");
        wrap.style.cssText = "border:1px solid rgba(255,255,255,.08);border-radius:7px;background:rgba(255,255,255,.03)";
        const headBtn = document.createElement("button");
        headBtn.type = "button";
        headBtn.style.cssText = "display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;padding:4px 7px;border:none;background:transparent;color:inherit;font:inherit;font-size:11px;text-align:left;cursor:pointer";
        const caret = document.createElement("span");
        caret.textContent = "▸";
        caret.style.cssText = "width:10px;opacity:.7";
        const base = dir.split("/").filter(Boolean).pop() || dir;
        const title = document.createElement("span");
        title.textContent = base;
        title.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        const mark = document.createElement("span");
        const chosen = projectPack(dir);
        mark.textContent = chosen ? (PACK_NAMES[chosen] || chosen) : t("по умолчанию");
        mark.style.cssText = "font-size:10px;opacity:.6;flex:0 0 auto";
        headBtn.append(caret, title, mark);

        const body = document.createElement("div");
        body.style.cssText = "display:none;padding:0 7px 7px";
        headBtn.onclick = (ev) => {
          ev.stopPropagation();
          const open = body.style.display === "none";
          body.style.display = open ? "block" : "none";
          caret.textContent = open ? "▾" : "▸";
        };

        const sel = document.createElement("select");
        sel.style.cssText = "box-sizing:border-box;width:100%;margin:2px 0 5px;padding:3px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:#23262c;color:inherit;font:inherit;font-size:11px";
        const add = (value, label) => {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = label;
          sel.append(opt);
        };
        add("", t("По умолчанию"));
        add(ALL_PACK, t("Все доступные"));
        for (const name of packList()) add(name, PACK_NAMES[name] || name);
        sel.value = chosen;
        body.append(sel);

        const charsBox = document.createElement("div");
        charsBox.style.cssText = "display:flex;flex-direction:column;gap:3px;max-height:170px;overflow-y:auto";
        body.append(charsBox);

        const fillChars = () => {
          charsBox.textContent = "";
          const name = projectPack(dir);
          if (!name || !packKnown(name)) return;
          const all = packVoices(name);
          const saved = entry.enabled && Array.isArray(entry.enabled[name]) ? entry.enabled[name] : null;
          for (const key of all) {
            const row = document.createElement("label");
            row.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 4px;border-radius:6px;background:rgba(255,255,255,.03);font-size:11px;cursor:pointer";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = saved ? saved.includes(key) : true;
            cb.style.cssText = "width:13px;height:13px;flex:0 0 13px;margin:0;accent-color:#5b8dee;cursor:pointer";
            cb.onchange = () => {
              const cur = entry.enabled && Array.isArray(entry.enabled[name]) ? entry.enabled[name].slice() : all.slice();
              const next = all.filter((k) => (cb.checked ? cur.includes(k) || k === key : cur.includes(k) && k !== key));
              if (!next.length) {
                cb.checked = true;
                return;
              }
              entry.enabled = entry.enabled || {};
              entry.enabled[name] = next;
              saveProjects();
              if (dir === projectDir && name === activePack) renderPanel();
            };
            const text = document.createElement("span");
            text.textContent = charName(key);
            text.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
            row.append(cb, text);
            charsBox.append(row);
          }
        };
        fillChars();

        sel.onchange = () => {
          entry.pack = sel.value;
          saveProjects();
          mark.textContent = entry.pack ? (PACK_NAMES[entry.pack] || entry.pack) : t("по умолчанию");
          fillChars();
          if (dir !== projectDir) return;
          if (entry.pack) {
            setPack(entry.pack, false);
            ensurePack(entry.pack).then(() => renderPanel());
          } else {
            let globalPack = "";
            try {
              globalPack = localStorage.getItem(PACK_KEY) || "";
            } catch (e) {}
            if (globalPack && packKnown(globalPack)) {
              setPack(globalPack, true);
              ensurePack(globalPack).then(() => renderPanel());
            } else {
              renderPanel();
            }
          }
        };

        wrap.append(headBtn, body);
        return wrap;
      };

      const refreshProjects = () => {
        prList.textContent = "";
        for (const dir of projectDirs()) prList.append(projectRow(dir));
      };
      try {
        refreshProjects();
      } catch (e) {
        console.warn("x2ai: список проектов", e);
      }
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


      // Поведение: галочка «Характер», своё описание и реакции персонажа —
      // всё в одном блоке: в правила чата уходит именно манера речи
      // персонажа, а не только имя и род.
      const tBody = collapsible("Поведение", "temper", box);
      const temperRow = document.createElement("label");
      temperRow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:11px;cursor:pointer";
      const temperCb = document.createElement("input");
      temperCb.type = "checkbox";
      temperCb.checked = charTemper(key);
      temperCb.style.cssText = "width:14px;height:14px;margin:0;accent-color:#5b8dee;cursor:pointer";
      const temperLabel = document.createElement("span");
      temperLabel.textContent = t("Характер");
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
      temperText.rows = 5;
      temperText.maxLength = 400;
      temperText.placeholder = temperPreset || t("Свой характер (пусто — готовый)");
      temperText.value = String(charSettingsFor(packKey(key)).temperText || "");
      temperText.style.cssText =
        "width:100%;box-sizing:border-box;min-height:104px;resize:vertical;display:block;" +
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
      reactLabel.textContent = t("Реакции");
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
      tBody.appendChild(reactRow);
      hint("Хмурится, когда инструмент или ответ упал, и засыпает, если ничего не происходит.", tBody);

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

      // Сторона окна: своя у персонажа; пусто — как в общих настройках.
      const sideBody = collapsible("Расположение персонажа", "side", box);
      const sideSel = document.createElement("select");
      sideSel.style.cssText =
        "display:block;width:100%;font:inherit;font-size:11px;padding:3px 6px;border-radius:7px;cursor:pointer;color:inherit;" +
        "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05)";
      for (const [val, label] of [
        ["", "Как в общих настройках"],
        ["left", "Слева"],
        ["right", "Справа"],
      ]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = t(label);
        sideSel.appendChild(opt);
      }
      const ownSide = charSettingsFor(packKey(key)).side;
      sideSel.value = SIDES.includes(ownSide) ? ownSide : "";
      sideSel.onchange = () => {
        saveCharSetting(packKey(key), { side: SIDES.includes(sideSel.value) ? sideSel.value : "" });
        applySide(packKey(key));
      };
      sideBody.appendChild(sideSel);
      hint("Слева или справа от окна. «Как в общих настройках» — значение из «Дополнительно».", sideBody);

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
        // FX-голоса (fx_cat, fx_ghost) — пресеты движка, а не папки в styles,
        // поэтому сверяемся ещё и с каталогом: он знает и их.
        const known = (voiceCatalog || []).some((v) => v && v.id === base);
        let msg = "";
        if (ttsEngine === false) {
          msg = t("Движок TeraTTS не установлен — поставь его, иначе персонаж говорит системным голосом без артикуляции.");
        } else if (installedVoices && installedVoices.length === 0) {
          msg = t("Голоса TeraTTS не установлены — поставь их в teratts-model/styles, иначе персонаж молчит.");
        } else if (installedVoices && installedVoices.length && base && !known && !installedVoices.includes(base)) {
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

      // Манера озвучки: скорость и окраска (эмоция движка) этого персонажа.
      const mTitle = document.createElement("div");
      mTitle.textContent = t("Манера речи");
      mTitle.style.cssText = "font-size:11px;font-weight:600;opacity:.85;margin:12px 0 6px";
      vBody.appendChild(mTitle);
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
      vBody.appendChild(emoRow);
      vBody.appendChild(mRow);
      syncSpeedRow();
      hint(
        "Окраска задаёт и интонацию, и темп: бодро — быстрее, устало — медленнее. «Настроить» — свой темп, окраска подберётся по нему. Реплика прозвучит сразу после изменения.",
        vBody,
      );

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
        // Пример озвучиваем именно выбранным голосом (rawVoice), иначе playClip
        // брал голос персонажа из настроек и звучал прежний выбор. Если своего
        // сэмпла у голоса нет — говорим нейтральную фразу, а не молчим.
        const sample = (LINES.samples && (LINES.samples[id] || LINES.samples[key])) || null;
        const text =
          (sample && sample.text) ||
          (voiceLang() === "en" ? pickClip(EN_SAMPLE) : "Привет. Это мой голос.");
        if (text) playClip({ text }, text, value, true);
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
        "Не читает и не озвучивает ответы сама: сжимает текст для «Кратко» и переводит рассуждения на язык озвучки, если включён перевод. Локальные и бесплатные модели — в начале списка. Если модель недоступна, персонаж молчит: машинного перевода нет.",
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
        const matches = models.filter((m) => {
          if (!q) return true;
          return `${m.name} ${m.providerID}/${m.id}`.toLowerCase().includes(q);
        });
        // Сначала локальные и бесплатные. Если таких нет вовсе (все провайдеры
        // платные), показываем весь список: пустая панель хуже, чем модель
        // не из начала списка.
        const preferred = matches.filter((m) => m.local || m.free);
        const free = preferred.length ? preferred : matches;
        const shown = free.slice(0, modelLimit);
        if (!shown.length) {
          const empty = document.createElement("div");
          empty.textContent = t(
            data && (data.error || data.source === "error")
              ? "не удалось получить список"
              : models.length
                ? "ничего не найдено"
                : "локальных и бесплатных моделей нет",
          );
          empty.style.cssText = "opacity:.5;font-size:11px";
          mList.appendChild(empty);
          // Мост мог быть ещё не готов на старте окна — даём перезапросить,
          // не закрывая настройки.
          const retry = document.createElement("button");
          retry.type = "button";
          retry.textContent = t("Обновить список");
          retry.style.cssText =
            "margin:6px 0 0;padding:4px 8px;font:inherit;font-size:11px;cursor:pointer;border-radius:7px;" +
            "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:inherit";
          retry.onclick = (ev) => {
            ev.stopPropagation();
            loadModels(true);
          };
          mList.appendChild(retry);
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

      const loadModels = (force) => {
        // Кеш пустого ответа не держим: мост мог ещё не подняться, когда окно
        // стартовало. При пустом списке пробуем ещё раз при открытии раздела.
        if (!force && modelsLoaded && modelsData && ((modelsData.models || []).length || modelsData.error)) {
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
            const list = (data && data.models) || [];
            // Пустой ответ не считаем загруженным, иначе панель останется
            // пустой до Cmd+R.
            modelsLoaded = list.length > 0;
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

      // Расположение: общее для всех, у кого не выбрана своя сторона.
      const posRow = document.createElement("div");
      posRow.style.cssText = "margin-top:10px;font-size:11px";
      const posLabel = document.createElement("div");
      posLabel.textContent = t("Расположение персонажа");
      posLabel.style.cssText = "margin-bottom:4px";
      const posSel = document.createElement("select");
      posSel.style.cssText = bubbleSel.style.cssText;
      for (const [val, label] of [
        ["left", "Слева"],
        ["right", "Справа"],
      ]) {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = t(label);
        posSel.appendChild(opt);
      }
      posSel.value = SIDES.includes(uiPrefs.side) ? uiPrefs.side : "left";
      const posHint = document.createElement("div");
      posHint.style.cssText =
        bubbleHint.style.cssText + ";display:none;color:#f0a24a;opacity:.95;margin-top:6px";
      // Показываем только после смены: иначе подсказка висит постоянно и
      // читается как ошибка ещё до того, как что-то выбрали.
      posHint.textContent = t(
        "Применится не ко всем: у персонажей со своей стороной останется та, что выбрана в их настройках.",
      );
      posSel.onchange = () => {
        saveUiPref({ side: posSel.value });
        applySide(voice);
        posHint.style.display = "block";
      };
      posRow.append(posLabel, posSel);
      box.append(posRow, posHint);
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
            applySide(voice);
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
      };
      refreshStats();
      box.append(stText, stReset);

      // Логи: по умолчанию выключены, включаются галочкой. Показывают,
      // получал ли этот чат правила общения, и хвост журнала плагина.
      const logsRow = document.createElement("label");
      logsRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;cursor:pointer";
      const logsCb = document.createElement("input");
      logsCb.type = "checkbox";
      logsCb.checked = Boolean(uiPrefs.logs);
      logsCb.style.cssText = "width:14px;height:14px;accent-color:#5b8dee;cursor:pointer";
      logsCb.onclick = (ev) => ev.stopPropagation();
      const logsLabel = document.createElement("span");
      logsLabel.textContent = t("Показывать логи");
      logsRow.append(logsCb, logsLabel);

      const logBox = document.createElement("pre");
      logBox.style.cssText =
        "margin:6px 0 0;padding:6px 7px;border-radius:7px;background:rgba(0,0,0,.25);" +
        "font-family:ui-monospace,Menlo,monospace;font-size:9px;line-height:1.35;" +
        "max-height:150px;overflow:auto;white-space:pre-wrap;word-break:break-word;opacity:.85";

      const refreshLog = () => {
        if (!uiPrefs.logs) {
          logBox.style.display = "none";
          return;
        }
        logBox.style.display = "block";
        logBox.textContent =
          chatRules === null
            ? t("правила чата: неизвестно")
            : chatRules
              ? t("правила чата: выданы")
              : t("правила чата: ещё нет");
        bridge("/log?lines=15")
          .then((data) => {
            const lines = (data && data.lines) || [];
            if (lines.length) logBox.textContent += "\n" + lines.join("\n");
          })
          .catch(() => {});
      };
      logsCb.onchange = () => {
        saveUiPref({ logs: logsCb.checked });
        refreshLog();
      };
      refreshLog();
      box.append(logsRow, logBox);


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
    if (pluginOn()) powerBtn.style.opacity = "1";
  };
  box.onmouseleave = () => {
    if (!panelOpen) {
      gear.style.opacity = "0";
      swapBtn.style.opacity = "0";
      muteBtn.style.opacity = "0";
      if (pluginOn()) powerBtn.style.opacity = "0";
    }
  };
  // Выключенный плагин прячет box, поэтому кнопка питания должна показываться
  // и без наведения на персонажа.
  powerBtn.onmouseenter = () => {
    if (pluginOn()) powerBtn.style.opacity = "1";
  };
  powerBtn.onmouseleave = () => {
    if (pluginOn()) powerBtn.style.opacity = "0";
  };

  // Персонаж показывается только в реальном чате: на Home и в черновике
  // ctx.sessions.current() === undefined, там его нет.
  const setVisible = (on) => {
    box.style.display = on && pluginOn() ? "flex" : "none";
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

  // Кнопка питания: когда плагин выключен, она единственная остаётся на экране.
  const paintPower = () => {
    const on = pluginOn();
    powerBtn.title = t(on ? "Выключить плагин" : "Включить плагин");
    powerBtn.style.opacity = on ? "0" : "1";
    powerBtn.style.color = on ? "#ddd" : "#ffc2b8";
    powerBtn.style.borderColor = on ? "rgba(255,255,255,.25)" : "rgba(255,120,100,.75)";
    powerBtn.style.background = on ? "rgba(20,20,24,.78)" : "rgba(70,20,20,.92)";
  };
  powerBtn.onclick = (ev) => {
    ev.stopPropagation();
    const next = !pluginOn();
    saveUiPref({ enabled: next });
    if (!next) {
      stopAll();
      togglePanel(false);
      if (moodState.value !== "awake") setMood("awake");
    }
    bridge("/power", { on: next }).catch(() => {});
    paintPower();
    refreshVisibility();
    if (next) resetIdle();
  };
  paintPower();

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
      // Реакции: всплывающая эмодзи/румянец — появляется и растворяется.
      "@keyframes x2ai-fx{0%{opacity:0;transform:translateX(-50%) translateY(4px) scale(.8)}",
      "18%{opacity:1}70%{opacity:.9}100%{opacity:0;transform:translateX(-50%) translateY(-14px) scale(1.05)}}",
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
    // Пузырь спрятан — «работа идёт» больше не держим: иначе персонаж
    // никогда не заснёт после мысли, показанной без звука.
    bubbleThinking = false;
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
    const show =
      pluginOn() && !panelOpen && want && !bubbleDismissed && bubbleChannelOn() && (hasLine || bubbleThinking);
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

  // Сторона окна: общая настройка плюс своя у персонажа. Панель, кнопки и
  // пузырь переезжают вместе со спрайтом и прижимаются к тому же краю,
  // иначе на правой стороне они уезжают за границу окна.
  let sideReady = false;
  const charSide = (key) => {
    const own = charSettingsFor(packKey(key || voice)).side;
    if (SIDES.includes(own)) return own;
    return SIDES.includes(uiPrefs.side) ? uiPrefs.side : "left";
  };
  function applySide(key) {
    if (!sideReady) return;
    const right = charSide(key) === "right";
    box.style.left = right ? "auto" : "10px";
    box.style.right = right ? "10px" : "auto";
    for (const btn of [gear, muteBtn, swapBtn]) {
      btn.style.left = right ? "auto" : "0";
      btn.style.right = right ? "0" : "auto";
    }
    // Кнопка питания живёт в root, а не в box: у неё свой отступ от края,
    // такой же, как у box (10 px), иначе она съезжает к самому краю окна.
    powerBtn.style.left = right ? "auto" : "10px";
    powerBtn.style.right = right ? "10px" : "auto";
    panel.style.left = right ? "auto" : "0";
    panel.style.right = right ? "0" : "auto";
    bubble.style.left = right ? "auto" : "0";
    bubble.style.right = right ? "0" : "auto";
    bubbleTail.style.left = right ? "auto" : "12px";
    bubbleTail.style.right = right ? "12px" : "auto";
    bubbleTail.style.alignItems = right ? "flex-end" : "flex-start";
    const shifts = [0, 3, 7];
    for (let i = 0; i < bubbleTail.children.length; i++) {
      bubbleTail.children[i].style.marginLeft = right ? "0" : `${shifts[i]}px`;
      bubbleTail.children[i].style.marginRight = right ? `${shifts[i]}px` : "0";
    }
    dots.style.left = right ? "-6px" : "auto";
    dots.style.right = right ? "auto" : "-6px";
    zzz.style.left = right ? "-4px" : "auto";
    zzz.style.right = right ? "auto" : "-4px";
    // scale — отдельное свойство, не конфликтует с transform (нырок при
    // смене персонажа и наклон эмоций остаются как были). У правосторонних
    // персонажей кадр обрезан с краю: справа отражаем, чтобы обрез ушёл за
    // край окна. У призрака наоборот — отражаем только слева.
    const flip = right ? isMirror(key) : isMirrorLeft(key);
    img.style.scale = flip ? "-1 1" : "";
  }

  const IDLE_MS = 3 * 60 * 1000;
  const SHADOW = "drop-shadow(0 2px 6px rgba(0,0,0,.28))";
  // Красная подсветка злости: одна строка на все места, где речь её касается.
  const ANGRY_GLOW = "drop-shadow(0 0 7px rgba(255,64,64,.6))";
  let moodTimer = null;
  // Какой кадр настроения сейчас стоит в img: речь и перерисовки могли
  // вернуть «closed», хотя персонаж спит или злится.
  let moodFrameShown = "closed";
  // Кадр, которым персонаж спит: blink или (с шансом 25 %) idle2.
  let sleepFrame = "blink";
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
    moodState.value === "angry"
      ? "wide"
      : moodState.value === "sleeping"
        ? sleepFrame
        : moodState.value === "dozing"
          ? sleepFrame
          : "closed";

  const setMood = (next, quiet) => {
    const prev = moodState.value;
    moodState.value = next;
    if (next === "sleeping" || next === "dozing") {
      const dozing = next === "dozing";
      if (!dozing) {
        // Кадр сна выбираем один раз за эпизод: 25 % — idle2, иначе blink.
        // idle2Supported объявлен ниже; на случай раннего вызова — try/catch.
        let hasIdle2 = false;
        try {
          hasIdle2 = idle2Supported();
        } catch (e) {
          hasIdle2 = false;
        }
        sleepFrame = hasIdle2 && Math.random() < SLEEP_IDLE2_CHANCE ? "idle2" : "blink";
      }
      const shown = sleepFrame;
      img.src = frame(voice, shown);
      moodFrameShown = shown;
      img.style.filter = dozing ? `${SHADOW} saturate(.85) brightness(.95)` : `${SHADOW} saturate(.7) brightness(.9)`;
      // Наклон живёт внутри кейфреймов: animation перебивает inline-transform.
      box.style.transform = "";
      box.style.filter = "";
      box.style.animation = dozing ? "x2ai-breathe 4.2s ease-in-out infinite" : "x2ai-sleep 3.6s ease-in-out infinite";
      zzz.style.animation = dozing ? "x2ai-zzz 4.2s ease-out infinite" : "x2ai-zzz 2.6s ease-out infinite";
      zzz.style.opacity = "0";
      root.title = `x2ai · ${charName(voice)} · ${t(dozing ? "дремлет" : "спит")}`;
    } else if (next === "angry") {
      img.src = frame(voice, "wide");
      moodFrameShown = "wide";
      img.style.filter = `${SHADOW} saturate(1.35) brightness(1.05)`;
      box.style.transform = "";
      // Красная подсветка + дрожь: злость видно боковым зрением.
      box.style.filter = ANGRY_GLOW;
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
    // Плагин выключен — никаких таймеров сна и злости.
    if (!pluginOn()) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      return;
    }
    if (idleTimer) clearTimeout(idleTimer);
    // Живость выключена — персонаж не засыпает и не злится (см. sadFor).
    if (!charReact(voice)) {
      idleTimer = null;
      return;
    }
    idleSince = Date.now();
    idleTimer = setTimeout(() => {
      // Пока идёт работа (звук, открытая панель, чужая мысль в пузыре) —
      // спать рано: при выключенном звуке это единственный признак жизни.
      if (speaking || panelOpen || bubbleThinking || reactPlaying || moodState.value === "angry") {
        resetIdle();
        return;
      }
      // Ночью — не полный сон, а дремота: приоткрытые глаза без наклона.
      setMood(isNight() ? "dozing" : "sleeping");
    }, IDLE_MS);
  };

  // Любая активность будит персонажа; из сна — со звуком. Грусть не трогаем:
  // она доигрывает свою очередь и не может быть сбита ответом.
  const wake = () => {
    const wasAsleep = moodState.value === "sleeping" || moodState.value === "dozing";
    if (wasAsleep) {
      if (moodTimer) clearTimeout(moodTimer);
      setMood("awake");
      wakeBlip();
      // Потягивание: глаза широко, прищур, обычный кадр.
      playReact("stretch", [
        { frame: "wide", hold: 260, tilt: 2 },
        { frame: "half", hold: 240, tilt: -1 },
        { frame: "closed", hold: 160 },
      ]);
    }
    resetIdle();
  };

  // Ошибки встают в очередь: каждая отыгрывается целиком, следующая — после
  // неё. Речь и другие действия злость не сбрасывают.
  // Злость голосом: короткая реплика в начале вспышки, а не на каждую
  // ошибку серии — иначе персонаж начинает бубнить без остановки.
  // Mute и тихие часы режет уже мост (/say), поэтому здесь только пауза
  // между репликами и галочка «Реакции».
  const RAGE_BANK = {
    ru: {
      chars: {
        ru_m5: ["Да ты издеваешься?!", "Ну всё, достал.", "Опять двадцать пять!", "Слышь, так не пойдёт.", "Да ёлки-палки!"],
        ru_m1: ["Опять этот баг.", "Плохо. Очень плохо.", "Логи бы сюда.", "Классика. Как в туториале.", "Ну конечно, на проде."],
        ru_f1: ["Да что ж такое!", "Ну вот опять…", "Это уже не смешно.", "Ох, как обидно.", "Так, без паники. Но обидно."],
        fx_robot: ["Ошибка. Гнев.", "Сбой. Повторите.", "Это неприемлемо.", "Система раздражена.", "Диагностика: виноват человек."],
        fx_penguin: ["На вашей планете всё ломается!", "Ужас! Снова сбой!", "Как это по-земному глупо!", "У нас такого не бывает. У нас нечему падать.", "Зачем вы вообще это нажали?"],
        fx_demoness: ["Скучно и бесит.", "Ну кто так делает?!", "Жалкое зрелище.", "Я даже не удивлена.", "Смертные, вы предсказуемы."],
        fx_ghost: ["Не надо было.", "Я расстроена… очень.", "Ты слышишь этот скрип?", "Зря ты так.", "Я запомню. Я всё помню."],
        x2ai_ment: ["Ну ё-моё, опять.", "Ты чё, не по-хорошему?", "Да я ж по-человечески просил.", "Слышь, ты нарушаешь.", "Опять двадцать пять, ёлки."],
        x2ai_alkash: ["Эх, опять…", "Ну вот, всю малину испортили.", "Да ты чё, брат…", "Вот же ж, а я только успокоился.", "Ох, ёлки-моталки."],
        x2ai_bratok: ["Да ты чё, в натуре?!", "Э, чё за шляпа?", "Ну это ваще беспредел.", "Слышь, аккуратнее.", "Да я тебя… ладно, спокойно."],
        x2ai_babka: ["Да что ты говоришь.", "Ох, горе с тобой.", "Вот у нас во дворе такого не было.", "Тьфу, безрукий.", "Да я тебя ещё щами кормила бы…"],
        x2ai_sosochka: ["Ну и что это было, зайка?", "Милый, ты серьёзно?", "Опять ты всё сломал.", "За такое доплачивать надо.", "Я так и думала, честно."],
        x2ai_telochka: ["Фу, бред какой.", "Ну капец вообще.", "Чо, ты серьёзно?", "Это что сейчас было?", "Я аж растерялась."],
        x2ai_narik: ["Да ну на…", "Опять, блин.", "Ну это… не работает.", "Блин, как так-то.", "Эх, ёлки…"],
        x2ai_novyi_russkiy: ["Да ты чё, братан?!", "Это уже беспредел.", "У меня всё схвачено, а тут такое.", "Ну это не по понятиям.", "Я вопрос решу. Но я недоволен."],
        x2ai_kotohaker: ["Мяу. Это баг.", "Кто трогал мой терминал?", "Хвост мешает, но я в логах.", "Без паники. Сейчас взломаю обратно.", "Опять без файрвола? Серьёзно?"],
        x2ai_coder: ["Опять легаси.", "Кто это писал?", "Тесты бы не помешали.", "Классика. Как в туториале.", "Даже не удивлён."],
        x2ai_programmer: ["Ох, опять…", "Ну кто так пишет?", "Я же предупреждала.", "Спокойно. Сейчас починим.", "Костыли. Опять костыли."],
        x2ai_codergirl: ["Серьёзно?", "Кто трогал прод?", "Это уже стыд.", "Ладно, сейчас починю.", "Без паники. Но руки убрал."],
        x2ai_sakura: ["Ой… что-то пошло не так.", "Жаль, очень жаль.", "Не расстраивайся, нэ.", "Я расстроилась, но не сержусь.", "Давай попробуем ещё раз, хорошо?"],
        x2ai_neko: ["Ня! Всё сломалось!", "Мур… мне это не нравится.", "Фыр. Нехорошо.", "Я расстроилась, ня.", "Ушки вянут… но я помогу."],
        x2ai_tsundere: ["Дурак! Я же предупреждала.", "Вот и всё, да? Как всегда.", "Не смотри на меня так.", "Я не расстроилась! Просто обидно.", "Ладно… сейчас починю. Не думай, что ради тебя."],
        x2ai_gakusei: ["Ошибка. Так быть не должно.", "Я же говорила, проверяй.", "Это неаккуратно. Очень.", "Придётся переделать.", "Тихо. Сейчас разберём по пунктам."],
        x2ai_senpai: ["Хм. Так не должно было выйти.", "Ничего, бывает. Но давай аккуратнее.", "Спокойно. Сначала посмотрим логи.", "Я не злюсь. Просто неприятно.", "Ладно, откатим и попробуем иначе."],
        x2ai_onime: ["Скучно. И как-то жалко.", "Смертные, вы всё ломаете.", "Даже я бы сделала лучше.", "Ох, какие же вы хрупкие.", "Ладно. Исправлю. Не благодари."],
        x2ai_samurai: ["Недостойно. Но исправимо.", "Я разочарован. Спокойно.", "Ошибка. Примем как урок.", "Терпение. Сейчас всё исправим.", "Так быть не должно. Идём дальше."],
        x2ai_mahou: ["Нет-нет! Так нельзя!", "Свет, помоги мне!", "Зло не пройдёт!", "Я не сдамся! Слышишь?", "Соберись. Справедливость ждёт!"],
      },
      neutral: {
        m: ["Я так и знал.", "Ну что за дела.", "Я же говорил.", "Опять сломалось. Классика.", "Да сколько можно, а?"],
        f: ["Я так и знала.", "Ну что за дела.", "Я же говорила.", "Опять сломалось. Классика.", "Да сколько можно, а?"],
      },
    },
    en: {
      chars: {
        ru_m5: ["Oh, come on!", "You've got to be kidding.", "Not again, seriously.", "What is this mess?", "I told you not to touch it."],
        ru_m1: ["Another bug.", "This is bad. Really bad.", "Where are the logs.", "Classic. Straight from the tutorial.", "Of course. On production."],
        ru_f1: ["Oh, what now!", "Not this again…", "That's not funny anymore.", "Oh, that's just sad.", "Okay, no panic. But still."],
        fx_robot: ["Error. Anger.", "Malfunction. Retry.", "Unacceptable.", "System irritated.", "Diagnosis: human error."],
        fx_penguin: ["Everything breaks on your planet!", "Horror! A failure!", "How very human.", "Nothing like this falls on my planet.", "Why did you even press that?"],
        fx_demoness: ["Boring and infuriating.", "Who does it like that?!", "Pathetic.", "I'm not even surprised.", "Mortals. So predictable."],
        fx_ghost: ["Shouldn't have done that.", "I'm upset… very.", "Do you hear that creak?", "You shouldn't have.", "I'll remember. I remember everything."],
        x2ai_ment: ["Not again, damn it.", "We can do this the easy way.", "I asked you nicely.", "You're in violation, friend.", "Oh, for heaven's sake."],
        x2ai_alkash: ["Ah, not again…", "There goes the mood.", "Come on, brother…", "Just when I settled down.", "Oh, for crying out loud."],
        x2ai_bratok: ["Are you for real?!", "Hey, what's this mess?", "That's out of line, man.", "Watch it, friend.", "I ought to… fine, calm down."],
        x2ai_babka: ["Oh, listen to you.", "What a burden you are.", "We never had this in my day.", "Useless, honestly.", "I'd have fed you soup, you know."],
        x2ai_sosochka: ["And what was that, sweetie?", "Seriously, darling?", "You broke it again.", "That costs extra, you know.", "I knew it, honestly."],
        x2ai_telochka: ["Ew, so cringe.", "Ugh, seriously?", "What was that even?", "I\u2019m literally lost.", "Total mess, babe."],
        x2ai_narik: ["Oh, come on…", "Again, man.", "It's just… not working.", "How does that even happen.", "Ugh, whatever…"],
        x2ai_novyi_russkiy: ["Come on, brother!", "This is a mess.", "I've got everything covered, and this happens.", "That's not how we do business.", "I'll sort it out. But I'm not happy."],
        x2ai_kotohaker: ["Meow. That's a bug.", "Who touched my terminal?", "Tail in the way, but I'm in the logs.", "Easy. I'll hack it back.", "No firewall again? Seriously?"],
        x2ai_coder: ["Legacy again.", "Who wrote this?", "Tests would help.", "Classic. Straight from a tutorial.", "Not even surprised."],
        x2ai_programmer: ["Oh, not again…", "Who writes it like that?", "I warned you.", "Easy. We'll fix it.", "Spaghetti. Again."],
        x2ai_codergirl: ["Seriously?", "Who touched prod?", "This is embarrassing.", "Fine, I'll fix it.", "No panic. But hands off."],
        x2ai_sakura: ["Oh… something went wrong.", "That's a shame, truly.", "Don't be upset, ne.", "I'm sad, but not angry.", "Let's try once more, okay?"],
        x2ai_neko: ["Nya! It broke!", "Mur… don't like it.", "Hmph. Not nice.", "I'm upset, nya.", "My ears droop… but I'll help."],
        x2ai_tsundere: ["Idiot! I warned you.", "Of course. As always.", "Don't look at me like that.", "I'm not upset! Just annoyed.", "Fine… I'll fix it. Not for you, though."],
        x2ai_gakusei: ["An error. That should not happen.", "I told you to check it.", "This is careless. Very.", "We will have to redo it.", "Quiet. Let us go through it point by point."],
        x2ai_senpai: ["Hmm. That should not have happened.", "It is fine, it happens. But let us be careful.", "Easy. Let us look at the logs first.", "I am not angry. Just unpleasant.", "All right, we roll back and try another way."],
        x2ai_onime: ["Boring. And a bit sad.", "Mortals break everything.", "Even I would have done better.", "Oh, how fragile you are.", "Fine. I will fix it. No thanks needed."],
        x2ai_samurai: ["Unworthy. But fixable.", "I am disappointed. Calmly.", "A mistake. We take it as a lesson.", "Patience. We fix it now.", "This should not be. We move on."],
        x2ai_mahou: ["No, no! This cannot be!", "Light, help me!", "Evil shall not pass!", "I will not give up! Hear me?", "Pull yourself together. Justice awaits!"],
      },
      neutral: {
        m: ["I knew it.", "Come on, really.", "I told you so.", "Broken again. Classic.", "How much longer."],
        f: ["I knew it.", "Come on, really.", "I told you so.", "Broken again. Classic.", "How much longer."],
      },
    },
  };
  // Пол нужен только для нейтральных реплик: у персонажа с выключенным
  // характером своей манеры нет, но род у фразы остаётся (говорил/говорила).
  const lineGender = () => {
    const v = clipVoice(voice);
    if (/^ru_m|^fx_robot|^fx_penguin|^fx_demon$|^x2ai_(ment|alkash|bratok|narik|novyi_russkiy|kotohaker|coder)$/.test(v)) return "m";
    if (/^ru_f|^fx_demoness|^fx_alien|^fx_cat|^fx_ghost|^x2ai_(babka|sosochka|telochka|programmer|codergirl)$/.test(v)) return "f";
    return "m";
  };
  // Характер включён — свои реплики персонажа; выключен — нейтральные по полу.
  // Незнакомый персонаж (пак без своих строк) тоже получает нейтральные.
  const pickByTemper = (bank) => {
    const own = charTemper(voice) ? bank.chars && bank.chars[clipVoice(voice)] : null;
    return own || bank.neutral[lineGender()] || bank.neutral.m;
  };
  let lastRageSay = 0;
  const rageSay = (retry) => {
    if (!charReact(voice)) return;
    const now = Date.now();
    if (!retry) {
      if (now - lastRageSay < 15000) return;
      lastRageSay = now;
    }
    const bank = RAGE_BANK[voiceLang()] || RAGE_BANK.ru;
    const text = pickClip(pickByTemper(bank));
    if (!text) return;
    // down — ниже и медленнее: та же фраза звучит раздражённо.
    // kind=rage — по нему окно держит красный фон, пока реплика звучит.
    bridge("/say", { text, sid: currentSid || "", voice: charVoice(voice), emotion: "down", kind: "rage" })
      .then((r) => {
        // Персонаж ещё говорил — повторяем один раз, когда голос освободится:
        // ошибка чаще всего и приходит во время ответа.
        if (!retry && r && r.ok === false && r.reason === "busy") {
          const wait = Math.max(400, Math.min((Number(r.wait) || 1200) + 250, 20000));
          setTimeout(() => rageSay(true), wait);
        }
      })
      .catch(() => {});
  };

  const rageQueue = [];
  let ragePlaying = false;
  let moodEndsAt = 0;
  const rageDone = () => {
    ragePlaying = false;
    if (rageQueue.length) {
      playRage();
      return;
    }
    if (moodState.value === "angry") setMood("awake");
    resetIdle();
  };
  // Красный фон держится, пока звучит злая реплика: продлеваем её концом,
  // а не фиксированными секундами (реплика бывает длиннее вспышки).
  const holdRage = (ms) => {
    if (!ragePlaying) return;
    const end = Date.now() + Math.max(0, Number(ms) || 0);
    if (end <= moodEndsAt) return;
    moodEndsAt = end;
    if (moodTimer) clearTimeout(moodTimer);
    moodTimer = setTimeout(rageDone, Math.max(0, moodEndsAt - Date.now()));
  };
  const playRage = () => {
    if (ragePlaying) return;
    const ms = rageQueue.shift();
    if (!ms) return;
    ragePlaying = true;
    const wasAngry = moodState.value === "angry";
    setMood("angry");
    moodEndsAt = Date.now() + ms;
    if (moodTimer) clearTimeout(moodTimer);
    moodTimer = setTimeout(rageDone, ms);
    if (!wasAngry) rageSay();
  };

  const sadFor = (ms) => {
    rageQueue.push(ms || 4200);
    // Длинная серия ошибок не должна держать злость минутами.
    if (rageQueue.length > 5) rageQueue.shift();
    playRage();
  };

  // --- Реакции: короткие сценки поверх настроения, строго по очереди ---
  // Каждая сценка доигрывает до конца; новая встаёт в очередь и не сбивает
  // текущую. Всё выключается той же галочкой «Реакции», что и эмоции.
  const REACT_MAX = 3;
  const reactQueue = [];
  let reactPlaying = false;
  let reactTimer = null;
  let idleSince = Date.now();
  let lastBoredAt = 0;

  // Слой эффектов: эмодзи и румянец живут отдельно от спрайта.
  const fx = document.createElement("div");
  fx.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:visible";
  box.appendChild(fx);

  const fxFloat = (text, ms, top, size) => {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText =
      `position:absolute;left:50%;top:${top || "6%"};font-size:${size || 13}px;line-height:1;` +
      "opacity:0;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.55);" +
      `animation:x2ai-fx ${ms || 1600}ms ease-out forwards`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), (ms || 1600) + 150);
  };

  const blushOn = (ms) => {
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:50%;top:50%;width:54%;height:18%;" +
      "background:radial-gradient(ellipse at center,rgba(255,120,140,.55),rgba(255,120,140,0) 70%);" +
      `opacity:0;pointer-events:none;animation:x2ai-fx ${ms || 1800}ms ease-out forwards`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), (ms || 1800) + 150);
  };

  const showReactFrame = (name) => {
    if (!name) return;
    img.src = frame(voice, name);
    moodFrameShown = name;
  };

  const isNight = () => {
    const h = new Date().getHours();
    return h >= 23 || h < 9;
  };

  // Демо: название реакции произносим и пишем в пузырь — иначе сценки
  // мелькают одна за другой без подписи.
  const sayReactName = (text) => {
    setBubbleText(text);
    bubbleKind = "answer";
    bubbleThinking = false;
    paintBubble();
    if (!mutedState) {
      bridge("/say", { text, sid: currentSid || "", voice: charVoice(voice) }).catch(() => {});
    }
  };

  const runReact = () => {
    if (reactPlaying) return;
    const task = reactQueue.shift();
    if (!task) return;
    reactPlaying = true;
    idleSince = Date.now();
    const finish = () => {
      reactPlaying = false;
      if (reactTimer) clearTimeout(reactTimer);
      reactTimer = null;
      box.style.transform = "";
      box.style.animation = "";
      const mood = moodState.value;
      if (mood === "sleeping" || mood === "dozing" || mood === "angry") setMood(mood, true);
      else setMood("awake", true);
      idleSince = Date.now();
      if (reactQueue.length) runReact();
      else resetIdle();
    };
    let i = 0;
    const step = () => {
      if (i >= task.steps.length) {
        finish();
        return;
      }
      const s = task.steps[i++];
      if (s.say) sayReactName(s.say);
      // Во время речи кадры принадлежат артикуляции: кадр сценки мгновенно
      // затирался планом рта, и сценка была не видна. Пока звучит голос,
      // показываем только эффект и наклон.
      if (s.frame && !speaking) showReactFrame(s.frame);
      // Наклон корпуса убран: сценка играет только мимикой (кадры, эффекты,
      // румянец). Поворот сбрасываем, чтобы старый наклон не залипал.
      if (s.tilt !== undefined) box.style.transform = "";
      if (s.shake) box.style.animation = "x2ai-rage .34s linear infinite";
      if (s.blush) blushOn(s.ms);
      if (s.fx) fxFloat(s.fx, s.ms, s.top, s.size);
      reactTimer = setTimeout(step, s.hold || s.ms || 260);
    };
    step();
  };

  const playReact = (name, steps, opts) => {
    if (!charReact(voice)) return;
    // Очередь переполнена — не выбрасываем сценку, а подклеиваем её шаги в
    // последнюю в очереди и чуть укорачиваем: так ничего не теряется и
    // персонаж не отстаёт от чата. force (демо) идёт как есть.
    if (!(opts && opts.force) && reactPlaying && reactQueue.length >= REACT_MAX) {
      const tail = reactQueue[reactQueue.length - 1];
      if (tail && Array.isArray(tail.steps)) {
        const extra = (steps || []).map((st) => ({
          ...st,
          hold: Math.max(140, Math.round(Number(st.hold || st.ms || 300) * 0.7)),
        }));
        tail.steps = tail.steps.concat(extra);
        return;
      }
    }
    if (!reactPlaying && !reactQueue.length && (moodState.value === "sleeping" || moodState.value === "dozing")) wake();
    reactQueue.push({ name, steps, opts });
    runReact();
  };

  // Реплики компактизации: короткая фраза на старте и на финише. Саму сводку
  // не читаем — персонаж только комментирует, что уложил мысли.
  const COMPACT_BANK = {
    ru: {
      chars: {
        ru_m5: {
          start: ["Так, мысли в кучу…", "Ща всё утрамбуем.", "Погоди, приберусь в голове.", "Лишнее — в сторону.", "Сжимаю. Не мешай."],
          done: ["Всё, уложил.", "Готово, чисто.", "Утрамбовал. Погнали.", "Всё влезло.", "Ну вот, порядок."],
        },
        ru_m1: {
          start: ["Сжимаю…", "Схлопываю контекст.", "Отжимаю лишнее.", "Оптимизирую память.", "Собираю всё в один дифф."],
          done: ["Готово.", "Готово. Контекст чист.", "Сжал. Сборка зелёная.", "Оптимизация завершена.", "Всё, без потерь."],
        },
        ru_f1: {
          start: ["Так, всё лишнее в сторону…", "Секунду, соберу мысли.", "Приберусь немного, ладно?", "Оставлю только важное.", "Сейчас всё аккуратно сложу."],
          done: ["Уложила.", "Готово, всё под рукой.", "Сложила. Ничего не потеряла.", "Всё, теперь легко.", "Прибралась!"],
        },
        fx_robot: {
          start: ["Сжатие контекста.", "Уплотняю память.", "Архивирую лишнее.", "Рекурсивная очистка.", "Сжатие. Не двигайтесь."],
          done: ["Оптимизация завершена.", "Готово.", "Контекст уплотнён.", "Память очищена. Продолжаем.", "Сжатие успешно."],
        },
        fx_penguin: {
          start: ["Сейчас всё утрамбую!", "Ой, тут много всего. Секунду!", "У нас так не складывают. Попробую!", "Важное — в карман.", "Сейчас всё проверю и сложу!"],
          done: ["Готово, всё влезло!", "Уложил! Как у нас, только хуже.", "Всё поместилось. Удивительно!", "Готово! Ничего не потерялось?", "Сложил. На вашей планете это работает!"],
        },
        fx_demoness: {
          start: ["Складываю ваши мысли.", "Секунду. Разложу по полочкам.", "Сожму это в приличный вид.", "Убираю мусор из головы. Вашей.", "Лишнее — в бездну."],
          done: ["Компактно. Продолжаем.", "Готово. Даже приятно.", "Уложила. Не благодарите.", "Чисто. Как в аду после уборки.", "Всё. Теперь дышится легче."],
        },
        fx_ghost: {
          start: ["Собираю мысли в туман…", "Сейчас лишнее растворится…", "Тише… я складываю.", "Развею всё ненужное.", "Погоди, я в тени."],
          done: ["Всё. Только важное осталось.", "Растворила лишнее.", "Готово… тихо.", "Всё уместилось в тень.", "Я закончила. Слышишь эхо?"],
        },
        x2ai_ment: {
          start: ["Ну чё, сожмём по-тихому…", "Погоди, разложу бумажки.", "Так, всё лишнее — в урну.", "Убираю показания, оставляю суть.", "Сейчас всё по папочкам."],
          done: ["Всё, подшито.", "Готово, дело закрыто.", "Утрамбовал. Никто не видел.", "Всё, чисто, как в отделении.", "Подписал и в сейф."],
        },
        x2ai_alkash: {
          start: ["Ща, соберу мысли в кучку…", "Погоди, у меня в голове туман.", "Так, выкинем лишнее, ага.", "Секунду, брат, соображу.", "Мысли-то разбежались… сейчас."],
          done: ["Всё, вроде уложил.", "Ну вот, теперь ясно.", "Утрамбовал, вроде ничего не забыл.", "Готово. А что было-то?", "Всё, брат, по полочкам."],
        },
        x2ai_bratok: {
          start: ["Ща, втрамбую всё по-быстрому.", "Погоди, раскидаю по понятиям.", "Так, всё лишнее — за борт.", "Обожди! Соберу в кучу.", "Сжимаю. Не лезь."],
          done: ["Всё, уложил, в натуре.", "Готово!", "Утрамбовал. Ничё не потерял.", "Всё, вычищено, как после шмона.", "Готово. Погнали дальше."],
        },
        x2ai_babka: {
          start: ["Так, приберусь тут.", "Сейчас всё по местам разложу.", "Ох, намусорили-то.", "Дай-ка, я лучше знаю.", "Так, лишнее — на помойку."],
          done: ["Всё, чисто.", "Готово, не благодари.", "Разложила, как надо.", "Всё убрано, наконец-то.", "Ну вот, другое дело."],
        },
        x2ai_sosochka: {
          start: ["Так, зайка, я всё приберу.", "Секунду, милый, не мешай.", "Складываю ваши мысли, ага.", "Лишнее — мне, нужное — вам.", "Сейчас всё будет красиво."],
          done: ["Всё, чисто и красиво.", "Готово, можешь не благодарить.", "Уложила. Со скидкой.", "Всё, зайка, порядок.", "Готово. И это мне тоже зачтётся."],
        },
        x2ai_telochka: {
          start: ["Так, сейчас всё будет красиво.", "Секунду, я подумаю.", "Убираю лишнее, ага.", "Так-сс, подожди немного.", "Сейчас всё уложу по полочкам."],
          done: ["Всё, готово, красота.", "Уложила. Даже приятно.", "Готово, все чотенько.", "Всё влезло, вообще легко.", "Капец, как чисто."],
        },
        x2ai_narik: {
          start: ["Ну это… сейчас соберу.", "Погоди, я подумаю…", "Бутор весь выкидываем.", "Ща, только соберусь.", "Как бы это… сжать."],
          done: ["Всё, уложил… вроде.", "Готово. Кажется.", "Ну вот, чисто.", "Утрамбовал, как смог.", "Всё, мысли на месте."],
        },
        x2ai_novyi_russkiy: {
          start: ["Так, братан, сейчас всё порешаем.", "Секунду, вопрос закрою.", "Уберу лишнее, по понятиям.", "Ща, только соберу всё в кучу.", "Всё под контролем, сжимаю."],
          done: ["Всё, братан, чисто.", "Готово. Вопрос закрыт.", "Уложил. Всё по понятиям.", "Компактно, как в лучших домах.", "Всё, теперь можно и отдохнуть."],
        },
        x2ai_kotohaker: {
          start: ["Сворачиваю вкладки…", "Секунду, чищу кэш.", "Упаковываю мысли в архив.", "Мяу. Сжимаю без потерь.", "Сейчас всё сожму в один файл."],
          done: ["Готово. Всё в архиве.", "Сжал. Хвост не пострадал.", "Чисто. Можно продолжать.", "Упаковано. Мур.", "Всё, контекст оптимизирован."],
        },
        x2ai_coder: {
          start: ["Сворачиваю лишнее…", "Секунду, чищу контекст.", "Соберу всё в один коммит.", "Убираю шум из логов.", "Сжимаю без потерь."],
          done: ["Готово. Можно мержить.", "Контекст чист.", "Сжал. Сборка зелёная.", "Всё, без регрессий.", "Готово. Открываю PR."],
        },
        x2ai_programmer: {
          start: ["Так, приберусь в мыслях…", "Секунду, только важное.", "Складываю всё по полочкам.", "Оставлю только суть.", "Аккуратно всё сожму."],
          done: ["Готово, всё на месте.", "Сложила. Ничего не потеряла.", "Чисто и понятно.", "Всё, можно продолжать.", "Готово. Дышится легче."],
        },
        x2ai_codergirl: {
          start: ["Сжимаю этот хаос…", "Убираю мусор из головы. Вашей.", "Секунду, соберу мысли в кучу.", "Лишнее — в архив.", "Сейчас всё упакую."],
          done: ["Готово. Красиво.", "Упаковала. Продолжаем.", "Чисто. Даже приятно.", "Всё влезло.", "Готово. Не благодарите."],
        },
        x2ai_sakura: {
          start: ["Сейчас я тихонько всё разложу…", "Погоди, соберу лепестки мыслей.", "Оставлю только важное, нэ.", "Не спеша, аккуратно…", "Уберу лишнее, как ветер."],
          done: ["Всё, стало легко.", "Готово, нэ.", "Сложила, ничего не потеряла.", "Чисто и спокойно.", "Всё уместилось."],
        },
        x2ai_neko: {
          start: ["Мур… сейчас всё сверну.", "Ня, подожди, собираю клубочек.", "Лишнее — под диван.", "Секунду, только хвост уберу.", "Мурр, сжимаю…"],
          done: ["Ня! Всё уместилось.", "Готово, мур.", "Смотала в клубочек.", "Чисто. Можно спать.", "Всё, клубок на месте."],
        },
        x2ai_tsundere: {
          start: ["Так, не смотри. Я просто уберусь.", "Секунду. Только не подглядывай.", "Лишнее — вон, и без вопросов.", "Я не для тебя это делаю, ясно?", "Хм. Сейчас всё сложу."],
          done: ["Всё. И не благодари.", "Готово. Не то чтобы я старалась.", "Сложила. Хватит смотреть.", "Ну вот. Чисто.", "Всё, доволен? …Ладно, продолжай."],
        },
        x2ai_gakusei: {
          start: ["Так, разложим всё по пунктам…", "Секунду, структурирую.", "Лишнее — в черновик.", "Сейчас приведу мысли в порядок.", "Аккуратно, шаг за шагом."],
          done: ["Готово. Всё по полочкам.", "Уложила. Ничего не потеряно.", "Чисто и структурировано.", "Всё, можно продолжать по плану.", "Прибралась. Хвали меня."],
        },
        x2ai_senpai: {
          start: ["Так, спокойно разложим по шагам…", "Секунду, приберу мысли.", "Лишнее оставим в стороне.", "Не спеша, по порядку.", "Сейчас всё соберу в одно."],
          done: ["Готово. Дальше будет проще.", "Всё на месте. Продолжаем.", "Сложил, ничего важного не потерял.", "Чисто. Молодец, что подождал.", "Всё, можно двигаться дальше."],
        },
        x2ai_samurai: {
          start: ["Соберу мысли. Молча.", "Секунду. Отсекаю лишнее.", "Как клинок: только суть.", "Спокойно. Убираю шум.", "Немного терпения."],
          done: ["Готово. Ясно и коротко.", "Всё лишнее отсечено.", "Чисто. Продолжим путь.", "Уложено. Ничего не забыто.", "Дело сделано."],
        },
        x2ai_onime: {
          start: ["Соберу вашу суету в горсть…", "Секунду. Отсею лишнее.", "Смертное — в сторону.", "Мм. Всё это — пыль.", "Уберу шум. Тихо."],
          done: ["Всё. Осталось только вечное.", "Уложила. Даже изящно.", "Чисто. Как до вас.", "Всё уместилось в одну мысль.", "Готово. Не суетись."],
        },
        x2ai_mahou: {
          start: ["Сейчас соберу мысли в луч!", "Секунду! Превращение контекста!", "Лишнее — в звёздную пыль!", "Сила концентрации, вперёд!", "Свет, помоги мне всё уложить!"],
          done: ["Готово! Сияет как надо!", "Всё уложено! Справедливость восторжествовала!", "Чисто! Даже звёзды завидуют!", "Готово! Дружба победила!", "Всё на месте! Вперёд, к новым свершениям!"],
        },
      },
      neutral: {
        m: {
          start: ["Так, я готов. Сжимаю…", "Сейчас всё уложу.", "Прибираюсь в контексте.", "Лишнее — в сторону.", "Сжимаю, секунду."],
          done: ["Готово. Всё уложил.", "Всё, я закончил.", "Уложил, ничего не потерял.", "Готово, контекст чистый.", "Всё влезло."],
        },
        f: {
          start: ["Так, я готова. Сжимаю…", "Сейчас всё уложу.", "Прибираюсь в контексте.", "Лишнее — в сторону.", "Сжимаю, секунду."],
          done: ["Готово. Всё уложила.", "Всё, я закончила.", "Уложила, ничего не потеряла.", "Готово, контекст чистый.", "Всё влезло."],
        },
      },
    },
    en: {
      chars: {
        ru_m5: {
          start: ["Right, thoughts together…", "Let me pack this up.", "Hold on, clearing my head.", "Extras aside.", "Compressing. Don't distract me."],
          done: ["There, packed.", "Done, all clean.", "Packed it. Let's go.", "It all fits.", "Right, sorted."],
        },
        ru_m1: {
          start: ["Compressing…", "Collapsing context.", "Squeezing out the noise.", "Optimizing memory.", "Gathering it into one diff."],
          done: ["Done.", "Done. Context is clean.", "Compressed. Build is green.", "Optimization complete.", "All done, nothing lost."],
        },
        ru_f1: {
          start: ["Setting the clutter aside…", "One sec, gathering my thoughts.", "Let me tidy up a bit, okay?", "Keeping only the important bits.", "Folding it all neatly."],
          done: ["All packed.", "Done, everything at hand.", "Packed it. Nothing lost.", "There, much lighter.", "Tidied up!"],
        },
        fx_robot: {
          start: ["Compressing context.", "Densifying memory.", "Archiving the excess.", "Recursive cleanup.", "Compressing. Do not move."],
          done: ["Optimization complete.", "Done.", "Context densified.", "Memory cleaned. Proceeding.", "Compression successful."],
        },
        fx_penguin: {
          start: ["Let me pack it all!", "Oh, so much stuff. One moment!", "We don't fold things like this at home. Trying!", "Important bits into the pocket.", "One sec, I'll check and pack everything!"],
          done: ["Done, it fits!", "Packed! Like home, only worse.", "It all fit. Amazing!", "Done! Did we lose anything?", "Packed. This works on your planet!"],
        },
        fx_demoness: {
          start: ["Folding your thoughts.", "One moment. Sorting it out.", "Let me compress this into something decent.", "Taking out the trash. From your head.", "The extras go into the void."],
          done: ["Compact. Moving on.", "Done. Almost pleasant.", "Packed. No thanks needed.", "Clean. Like hell after cleaning.", "There. Easier to breathe."],
        },
        fx_ghost: {
          start: ["Gathering thoughts into mist…", "Letting the extra fade…", "Quiet… I'm folding it.", "I'll scatter what's unnecessary.", "Wait, I'm in the shadows."],
          done: ["There. Only what matters remains.", "The extra has dissolved.", "Done… quietly.", "It all fits in the shadow.", "I'm done. Hear the echo?"],
        },
        x2ai_ment: {
          start: ["Right, let's pack this quietly…", "Hold on, sorting the paperwork.", "Everything extra goes in the bin.", "Cutting the testimony to the point.", "Filing it all, folder by folder."],
          done: ["All stapled.", "Done, case closed.", "Packed. Nobody saw a thing.", "Clean as the precinct.", "Signed and in the safe."],
        },
        x2ai_alkash: {
          start: ["Hold on, gathering my thoughts…", "Wait, it's foggy in my head.", "Right, tossing out the extra.", "One sec, brother, let me think.", "Thoughts ran off… one moment."],
          done: ["There, I think it's packed.", "Right, now it's clear.", "Packed it, hope nothing's lost.", "Done. What was it again?", "All set, brother, on the shelves."],
        },
        x2ai_bratok: {
          start: ["Right, stuffing it in, quick.", "One sec, sorting it the way we do.", "Right, all the extras overboard.", "Hold on! Gathering it up.", "Compressing. Don't touch."],
          done: ["All packed, for real.", "Done!", "Packed it. Lost nothing.", "All cleared out, like after a shakedown.", "Done. Let's move on."],
        },
        x2ai_babka: {
          start: ["Right, let me tidy up here.", "Putting everything in its place.", "Oh, what a mess you've made.", "Let me do it, I know better.", "The extras go in the bin."],
          done: ["There, clean.", "Done, no need to thank me.", "Put away properly.", "Finally, all cleared.", "There, that's better."],
        },
        x2ai_sosochka: {
          start: ["Right, sweetie, I'll tidy it up.", "One moment, darling, don't interfere.", "Folding your thoughts, uh-huh.", "The extras go to me, the useful to you.", "Let me make it pretty."],
          done: ["There, clean and pretty.", "Done, no thanks needed.", "Packed. With a discount.", "All set, sweetie.", "Done. And I get credit for that."],
        },
        x2ai_telochka: {
          start: ["Right, let's make it pretty.", "One sec, I'm thinking.", "Clearing the extras, uh-huh.", "Wait a bit, okay?", "Putting it all in place."],
          done: ["There, done. Pretty.", "Packed. Even nice.", "Done, babe.", "It all fits, so easy.", "So clean, honestly."],
        },
        x2ai_narik: {
          start: ["Uh… let me gather it.", "Hold on, I'm thinking…", "All the junk goes out.", "Just a sec, let me focus.", "How do I… compress this."],
          done: ["There, packed… I think.", "Done. I guess.", "Right, clean.", "Squeezed it as best I could.", "Okay, thoughts are in place."],
        },
        x2ai_novyi_russkiy: {
          start: ["Right, brother, we'll sort it out.", "One sec, closing the matter.", "Clearing the extras, by the rules.", "Just a moment, gathering it all.", "Everything's under control, compressing."],
          done: ["All clean, brother.", "Done. Matter closed.", "Packed. All by the rules.", "Compact, like in the best houses.", "There, now we can relax."],
        },
        x2ai_kotohaker: {
          start: ["Closing tabs…", "One sec, clearing the cache.", "Packing my thoughts into an archive.", "Meow. Lossless compression.", "Compressing it all into one file."],
          done: ["Done. All archived.", "Compressed. Tail intact.", "Clean. We can continue.", "Packed. Purr.", "Done, context optimized."],
        },
        x2ai_coder: {
          start: ["Closing the extras…", "One sec, clearing the context.", "Packing it into one commit.", "Removing noise from the logs.", "Lossless compression."],
          done: ["Done. Ready to merge.", "Context is clean.", "Compressed. Build is green.", "All done, no regressions.", "Done. Opening the PR."],
        },
        x2ai_programmer: {
          start: ["Let me tidy my thoughts…", "One sec, just the important bits.", "Sorting everything into place.", "Keeping only the essence.", "Compressing it neatly."],
          done: ["Done, everything in place.", "Packed. Nothing lost.", "Clean and clear.", "There, we can continue.", "Done. Much lighter."],
        },
        x2ai_codergirl: {
          start: ["Compressing this chaos…", "Taking the trash out of your head.", "One sec, gathering my thoughts.", "The extras go to the archive.", "Packing it all up."],
          done: ["Done. Beautiful.", "Packed. Moving on.", "Clean. Almost pleasant.", "It all fits.", "Done. No thanks needed."],
        },
        x2ai_sakura: {
          start: ["Let me lay it all out gently…", "One moment, gathering the petals.", "Only the important things, ne.", "Slowly and carefully…", "Blowing the extra away like wind."],
          done: ["There, it feels light.", "Done, ne.", "Packed it, lost nothing.", "Clean and calm.", "Everything fits."],
        },
        x2ai_neko: {
          start: ["Mur… winding it up now.", "Nya, hold on, gathering the yarn.", "All the extra under the sofa.", "One second, just moving my tail.", "Purr, compressing…"],
          done: ["Nya! It all fits.", "Done, mur.", "Wound into a ball.", "Clean. Time to nap.", "All set, ball's in place."],
        },
        x2ai_tsundere: {
          start: ["Right, don't look. I'm just tidying.", "One second. And no peeking.", "The extra goes out, no questions.", "I'm not doing this for you, got it?", "Hmph. Folding it now."],
          done: ["Done. Don't thank me.", "Finished. Not that I tried.", "Packed. Stop staring.", "There. Clean.", "Done, happy? …Fine, continue."],
        },
        x2ai_gakusei: {
          start: ["Right, let us go point by point…", "One second, structuring it.", "The extra goes to the draft.", "Putting my thoughts in order now.", "Carefully, step by step."],
          done: ["Done. Everything in its place.", "Packed. Nothing lost.", "Clean and structured.", "There, we can continue per plan.", "Tidied up. Praise me."],
        },
        x2ai_senpai: {
          start: ["Right, let us take it step by step…", "One moment, clearing my head.", "The extras we leave aside.", "Slowly, in order.", "Let me gather it into one."],
          done: ["Done. It gets easier from here.", "Everything is in place. Let us continue.", "Packed it, nothing important lost.", "Clean. Good that you waited.", "There, we can move on."],
        },
        x2ai_samurai: {
          start: ["I will gather my thoughts. In silence.", "One moment. Cutting away the rest.", "Like a blade: only the essence.", "Calmly. Clearing the noise.", "A little patience."],
          done: ["Done. Clear and brief.", "All excess is cut away.", "Clean. We continue the path.", "Packed. Nothing forgotten.", "The deed is done."],
        },
        x2ai_onime: {
          start: ["Let me gather your bustle in one palm…", "One moment. Sifting out the rest.", "Mortal things aside.", "Mm. All of this is dust.", "Clearing the noise. Quietly."],
          done: ["There. Only the eternal remains.", "Packed it. Elegant, even.", "Clean. Like before you came.", "Everything fits in one thought.", "Done. Do not fuss."],
        },
        x2ai_mahou: {
          start: ["Gathering my thoughts into a beam!", "One moment! Context transformation!", "The extra goes to stardust!", "Power of concentration, go!", "Light, help me pack it all!"],
          done: ["Done! Shining as it should!", "All packed! Justice prevails!", "Clean! Even the stars are jealous!", "Done! Friendship wins!", "Everything in place! On to new deeds!"],
        },
      },
      neutral: {
        m: {
          start: ["Right, gathering my thoughts…", "Packing it up now.", "Tidying the context.", "Extras aside.", "Compressing, one second."],
          done: ["Done. All packed.", "All done, nothing lost.", "Packed, context is clean.", "Everything fits.", "Done."],
        },
        f: {
          start: ["Right, gathering my thoughts…", "Packing it up now.", "Tidying the context.", "Extras aside.", "Compressing, one second."],
          done: ["Done. All packed.", "All done, nothing lost.", "Packed, context is clean.", "Everything fits.", "Done."],
        },
      },
    },
  };
  // Старт и финиш приходят по пять раз (копии плагина): сценку дедупит
  // playCompactScene, а голос страхуем своим окном в 8 с.
  let lastCompactSayStage = "";
  let lastCompactSayAt = 0;
  const compactSay = (stage, retry) => {
    if (!charReact(voice)) return;
    const now = Date.now();
    if (!retry) {
      if (stage === lastCompactSayStage && now - lastCompactSayAt < 8000) return;
      lastCompactSayStage = stage;
      lastCompactSayAt = now;
    }
    const bank = COMPACT_BANK[voiceLang()] || COMPACT_BANK.ru;
    const pair = pickByTemper(bank);
    const text = pair && pickClip(pair[stage]);
    if (!text) return;
    bridge("/say", { text, sid: currentSid || "", voice: charVoice(voice) })
      .then((r) => {
        // Персонаж ещё говорил (частый случай: сжатие сразу после ответа) —
        // один повтор, когда голос освободится.
        if (!retry && r && r.ok === false && r.reason === "busy") {
          const wait = Math.max(400, Math.min((Number(r.wait) || 1200) + 250, 20000));
          setTimeout(() => compactSay(stage, true), wait);
        }
      })
      .catch(() => {});
  };

  // Сценки компактизации: событие приходит с моста (/state.react), потому
  // что в шине окна это семейство событий не гарантировано. Виды: «сжимаю
  // мысли» на старте, «готово» в конце, грусть на провале.
  // Злость по событию моста: пять копий серверного плагина пишут одну и ту
  // же метку почти одновременно, поэтому вспышку гасим по времени.
  let lastRageAt = 0;
  const rageOnce = (ms) => {
    const now = Date.now();
    if (now - lastRageAt < 3000) return;
    lastRageAt = now;
    sadFor(ms || 4200);
  };

  const playCompactScene = (kind, at) => {
    if (kind === "rage") {
      rageOnce(4200);
      return;
    }
    // Дубли того же события (несколько копий плагина) не играем дважды.
    const seenAt = Number(at) || Date.now();
    if (kind === lastReactKind && seenAt - lastReactKindAt < 2500) return;
    lastReactKind = kind;
    lastReactKindAt = seenAt;
    if (kind === "compactFailed") {
      sadFor(2500);
      return;
    }
    if (kind === "compactDone") {
      compactSay("done");
      playReact("compactDone", [
        { frame: "half", hold: 180, tilt: 2 },
        { frame: "wide", hold: 260, fx: "✓", top: "2%", size: 12 },
        { frame: "closed", hold: 140 },
      ]);
      return;
    }
    compactSay("start");
    playReact("compact", [
      { frame: "wide", hold: 220, fx: "✧", top: "2%", size: 12 },
      { frame: "half", hold: 420, tilt: -3, fx: "⋯", top: "4%", size: 12 },
      { frame: "closed", hold: 240, tilt: 0 },
    ]);
  };

  // Демо всех сценок подряд: сервер считает нажатия (POST /demo), окно видит
  // новое число в /state и ставит всю цепочку в очередь — одну за другой.
  const runDemo = () => {
    const scenes = [
      ["Потягивание", [{ frame: "wide", hold: 260, tilt: 2 }, { frame: "half", hold: 240, tilt: -1 }, { frame: "closed", hold: 160 }]],
      ["Улыбка", [{ frame: "half", hold: 220 }, { frame: "wide", hold: 380, fx: "✦", top: "2%", size: 12 }, { frame: "closed", hold: 180 }]],
      ["Радость", [{ frame: "wide", hold: 300, fx: "✦", top: "1%", size: 13 }, { frame: "half", hold: 260, tilt: -3 }, { frame: "closed", hold: 160 }]],
      ["Гордость", [{ frame: "wide", hold: 520, fx: "✧", top: "1%", size: 13 }, { frame: "closed", hold: 200, tilt: 2 }]],
      ["Любопытство", [{ frame: "half", hold: 420, tilt: 3 }, { frame: "closed", hold: 180, tilt: 0 }]],
      ["Тревога", [{ frame: "half", hold: 520, shake: true, fx: "…", top: "3%", size: 12 }, { frame: "closed", hold: 200 }]],
      ["Смена чата", [{ tilt: 4, hold: 340, fx: "∙", top: "4%", size: 11 }]],
      ["Смущение", [{ frame: "half", hold: 300, blush: 1800 }, { frame: "closed", hold: 200 }]],
      ["Скука", [{ frame: "open", hold: 420 }, { frame: "half", hold: 300, tilt: -2 }, { frame: "closed", hold: 160 }]],
      ["Злость", [{ frame: "wide", hold: 420, shake: true }, { frame: "closed", hold: 200 }]],
    ];
    for (const [raw, steps] of scenes) {
      // Сначала название: пока оно звучит, персонаж уже смотрит на тебя.
      const name = t(raw);
      playReact(raw, [{ say: name, hold: 1600 }, ...steps], { force: true });
    }
  };

  // Скука и случайное подмигивание: только когда персонаж один и бодр.
  const boredTimer = setInterval(() => {
    if (!charReact(voice) || speaking || panelOpen || reactPlaying) return;
    if (moodState.value !== "awake" || reactQueue.length) return;
    const idle = Date.now() - idleSince;
    if (idle > 5 * 60 * 1000 && Date.now() - lastBoredAt > 40000) {
      // Зевок: рот открылся, глаза прикрылись, лёгкий кивок.
      lastBoredAt = Date.now();
      playReact("bored", [
        { frame: "open", hold: 420 },
        { frame: "half", hold: 300, tilt: -2 },
        { frame: "closed", hold: 160 },
      ]);
      return;
    }
  }, 15000);

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

  // «Второй праздный» кадр (idle2): изредка, когда персонаж долго молчит,
  // на 15 секунд показываем его вместо покоя — без моргания и без эффектов.
  // Любая речь сбрасывает idle2 сразу.
  const IDLE2_AFTER_MS = 60 * 1000;
  const IDLE2_HOLD_MS = 15 * 1000;
  const IDLE2_CHANCE = 0.2;
  // Во сне кадр с закрытыми глазами иногда подменяется на idle2.
  const SLEEP_IDLE2_CHANCE = 0.25;
  let idle2Active = false;
  let idle2Timer = null;
  let idle2Poll = null;

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
      // Только подскок, без поворота: поворот заставлял браузер
      // пере-ресемпливать спрайт на каждом кадре, и пиксель-арт выглядел
      // бледнее и мягче, чем в покое.
      box.style.transform = `translateY(${i % 2 ? -1 : 0}px)`;
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
    // Речь прерывает idle2: сначала вернуть покой, потом включать рот.
    endIdle2();
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
    // Смущение на благодарность и лёгкое удивление на вопрос: только
    // эффекты, кадры не трогаем — иначе поедет артикуляция.
    if (!thinking && line && charReact(voice)) {
      if (/спасибо|молодец|умниц|thank/i.test(line)) blushOn(2000);
      if (line.trim().endsWith("?")) fxFloat("?", 1400, "2%", 13);
    }
    // Рассуждения раньше гасились saturate(.85) — во время речи персонаж
    // становился бледнее, чем в покое. Палитру не трогаем: думает он
    // лёгким затемнением и «⋯» над плечом.
    // Злость не гасим речью: пока персонаж ругается, красная подсветка
    // остаётся — раньше обводка пропадала на первом же слове.
    const glow = moodState.value === "angry" ? ANGRY_GLOW : "";
    box.style.filter = glow;
    // Грусть не сбрасываем: ответ накладывается поверх, рот анимируется
    // кадрами партитуры, а настроение доигрывает свою очередь.
    if (moodState.value === "sleeping" || moodState.value === "dozing") {
      if (moodTimer) clearTimeout(moodTimer);
      setMood("awake");
    }
    if (thinking) {
      box.style.filter = glow ? `${glow} brightness(.98)` : "brightness(.98)";
      if (charReact(voice)) fxFloat("⋯", 1400, "2%", 12);
    }
    // Подскок рта без transition: 140-мс анимация не успевала доехать до
    // целого пикселя, спрайт всё время висел в дробном смещении и мылился.
    box.style.transition = "none";
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
        box.style.transform = `translateY(${talkStep % 2 ? -1 : 0}px)`;
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
    box.style.transition = "";
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
  let projectSynced = false;
  // Персонаж и голос — разные вещи: по умолчанию голос персонажа совпадает
  // с его id, но в настройках можно привязать любой другой голос.
  // Пиксельные персонажи имеют свои id, но говорят общим голосом.
  const VOICE_ALIAS = {
    px_ru_f1: "ru_f1",
    px_ru_m1: "ru_m1",
    px_fx_robot: "fx_robot",
    px_fx_penguin: "fx_penguin",
    px_fx_ghost: "fx_ghost",
    px_fx_demoness: "fx_demoness",
    px_ru_m5: "ru_m5",
    px_x2ai_ment: "x2ai_ment",
    px_x2ai_alkash: "x2ai_alkash",
    px_x2ai_bratok: "x2ai_bratok",
    px_x2ai_babka: "x2ai_babka",
    px_x2ai_sosochka: "x2ai_sosochka",
    px_x2ai_telochka: "x2ai_telochka",
    px_x2ai_narik: "x2ai_narik",
    px_x2ai_novyi_russkiy: "x2ai_novyi_russkiy",
    px_x2ai_kotohaker: "x2ai_kotohaker",
    px_x2ai_coder: "x2ai_coder",
    px_x2ai_programmer: "x2ai_programmer",
    px_x2ai_codergirl: "x2ai_codergirl",
    px_x2ai_tsundere: "x2ai_tsundere",
    px_x2ai_sakura: "x2ai_sakura",
    px_x2ai_neko: "x2ai_neko",
    px_x2ai_gakusei: "x2ai_gakusei",
    px_x2ai_senpai: "x2ai_senpai",
    px_x2ai_samurai: "x2ai_samurai",
    px_x2ai_mahou: "x2ai_mahou",
    px_x2ai_onime: "x2ai_onime",
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
    const switched = Boolean(sid && currentSid && sid !== currentSid);
    if (switched) restoreProjectPack();
    else if (!projectSynced) {
      projectSynced = true;
      restoreProjectPack();
    }
    if (sid) currentSid = sid;
    // Смена чата: короткий наклон в сторону переключения.
    if (switched && charReact(voice)) {
      setTimeout(() => playReact("switch", [{ tilt: 4, hold: 340, fx: "∙", top: "4%", size: 11 }]), 80);
    }
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
    // «Все доступные» не файл: грузим все реальные паки, чтобы у объединения
    // были кадры каждого персонажа.
    if (name === ALL_PACK) {
      return Promise.all(packList().map((packName) => ensurePack(packName))).then(() => null);
    }
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
        if (grew && activePack === ALL_PACK) ensurePack(ALL_PACK);
        if (grew && panelOpen) renderPanel();
      })
      .catch(() => {});
  };
  // До загрузки кадров картинка пустая: перерисовываем, когда пак пришёл.
  sideReady = true;
  applySide(voice);
  ensurePack(activePack).then(() => {
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
  let lastDemo = -1;
  // Метка реакции с моста (компактизация): номер события, чтобы не играть
  // одну и ту же дважды.
  let lastReact = -1;
  // Метка «одно и то же событие» для сценок: вид и время последней.
  let lastReactKind = "";
  let lastReactKindAt = 0;
  // Пришли ли этому чату правила общения — показываем в «Дополнительно».
  let chatRules = null;
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
    if (!pluginOn()) return;
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
        // Демо всех реакций: счётчик приходит с моста, окно играет сценки.
        // Первое значение после Cmd+R только запоминаем — иначе демо
        // запускалось бы при каждой перезагрузке окна.
        if (typeof state.rules === "boolean") chatRules = state.rules;
        if (Number.isFinite(Number(state.demo))) {
          if (lastDemo < 0) lastDemo = Number(state.demo);
          else if (Number(state.demo) !== lastDemo) {
            lastDemo = Number(state.demo);
            runDemo();
          }
        }
        // Реакция с моста: компактизация контекста. Первое значение после
        // Cmd+R только запоминаем — иначе проигралась бы старая метка.
        if (state.react && state.react.kind) {
          const rn = Number(state.react.n) || 0;
          if (lastReact < 0) lastReact = rn;
          else if (rn !== lastReact) {
            lastReact = rn;
            playCompactScene(state.react.kind, state.react.at);
          }
        }
        // Красный фон злости держим до конца злой реплики: /state отдаёт
        // остаток звука (ms, at), продлеваем настроение по нему.
        if (ragePlaying && state.speaking && state.kind === "rage") {
          const rMine = !state.sid || !currentSid || state.sid === currentSid;
          if (rMine) {
            const rat = Number(state.at) || 0;
            const left = rat ? Math.max(0, rat * 1000 + (Number(state.ms) || 0) - Date.now()) : 0;
            holdRage(left + 400);
          }
        }
        if (state.note && state.note.text && Number(state.note.at) >= bootAt) {
          const nsid = state.note.sid || "";
          if (nsid && currentSid && nsid === currentSid && state.note.at !== lastNoteAt) {
            lastNoteAt = state.note.at;
            const noteLine = bubbleLine(state.note.text);
            if (noteLine) setBubbleText(noteLine);
            bubbleThinking = state.note.kind === "reason";
            bubbleKind = bubbleThinking ? "reason" : "answer";
            paintBubble();
            // Мысль пришла без звука (mute или тихие часы): персонаж явно
            // работает, будим и продлеваем бодрствование.
            if (moodState.value === "sleeping") wake();
            resetIdle();
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
            stopSynth();
            // state.ms — остаток, а elapsed уже прошёл: считаем полную
            // длительность, и только ответы (рассуждения — не «ответы»).
            if (state.kind !== "reason") {
              stats.count += 1;
              if (state.ms > 0) stats.ms += state.ms + elapsed;
            }
            saveStats();
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
  const FEMALE_VOICES = ["fx_demoness", "fx_ghost", "x2ai_babka", "x2ai_sosochka", "x2ai_telochka", "x2ai_programmer", "x2ai_codergirl"];
  const MALE_VOICES = ["fx_demon", "x2ai_ment", "x2ai_alkash", "x2ai_bratok", "x2ai_narik", "x2ai_novyi_russkiy", "x2ai_kotohaker", "x2ai_coder"];
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
      // Плагин выключен — реплики простоя не звучат и таймер не крутится.
      if (!pluginOn()) {
        pingStop(key);
        return;
      }
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

  // Клик по персонажу: реплика синтезируется движком через /say.
  box.style.cursor = "pointer";

  // Глушим только свой чат: очередь других чатов не трогаем.
  const stopAll = () => {
    stopSynth();
    stopSpeaking();
    bumpSayToken();
    bridge("/stop", { sid: currentSid, token: sayToken }).catch(() => {});
  };

  const onCharClick = (event) => {
    // Реплика — только по самому персонажу. Настройки и пузырь живут в этом
    // же контейнере, и раньше отпускание ползунка звучало как клик по нему.
    if (event && event.target !== img && event.target !== box) return;
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
          bridge("/say", { text, sid: currentSid, voice: charVoice(voice), token: sayToken }).catch(() => {});
        }
        return;
      }
      const clip = pickClip(CLICKS[packKey(voice)] || CLICKS[clipVoice(voice)] || CLICKS.ru_f1);
      playClip(clip, clip && clip.text);
    }
  };
  // Слушаем и контейнер, и сам спрайт: если поверх картинки окажется слой
  // эффектов, клик всё равно должен звучать.
  box.onclick = onCharClick;
  img.addEventListener("click", (ev) => { ev.stopPropagation(); onCharClick(ev); });

  // Правый клик — настройки персонажа.
  box.oncontextmenu = (event) => {
    if (event) event.preventDefault();
    togglePanel(true);
  };

  // Моргание только в тишине, чтобы не спорить с артикуляцией.
  const scheduleBlink = () => {
    blinkTimer = setTimeout(() => {
      // Во сне глаза уже закрыты (кадр blink): моргание только наяву, иначе
      // через 120 мс кадр возвращает открытые глаза. На idle2 не моргаем:
      // там глаза нарисованы как на самом кадре.
      if (!speaking && !idle2Active && moodState.value === "awake") {
        img.src = frame(voice, "blink");
        setTimeout(() => {
          // За 120 мс можно успеть заснуть — тогда глаза не открываем.
          if (!speaking && !idle2Active && moodState.value === "awake") {
            img.src = frame(voice, "closed");
            moodFrameShown = "closed";
          }
        }, 120);
      }
      scheduleBlink();
    }, 2600 + Math.random() * 2800);
  };
  scheduleBlink();

  // Изредка показываем idle2 в простое. Кубик бросаем раз в 5 секунд, но
  // только если персонаж бодр, один, не говорит и молчит дольше минуты.
  const idle2Supported = () => {
    const set = frameSetFor(voice);
    return !!(set && typeof set === "object" && set.idle2);
  };

  const endIdle2 = () => {
    if (!idle2Active) return;
    idle2Active = false;
    if (idle2Timer) clearTimeout(idle2Timer);
    idle2Timer = null;
    if (!speaking && moodState.value === "awake") {
      const back = moodFrame();
      img.src = frame(voice, back);
      moodFrameShown = back;
    }
  };

  const startIdle2 = () => {
    if (!idle2Supported()) return;
    idle2Active = true;
    img.src = frame(voice, "idle2");
    moodFrameShown = "idle2";
    idle2Timer = setTimeout(endIdle2, IDLE2_HOLD_MS);
  };

  idle2Poll = setInterval(() => {
    if (idle2Active || speaking || panelOpen || reactPlaying) return;
    if (moodState.value !== "awake" || reactQueue.length) return;
    if (Date.now() - idleSince < IDLE2_AFTER_MS) return;
    if (Math.random() >= IDLE2_CHANCE) return;
    startIdle2();
  }, 5000);

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
        // Счётчики реакций: серия удачных ответов и объём работы инструментами.
        let okStreak = 0;
        let toolCount = 0;
        let toolStartedAt = 0;
        let anxietyShown = false;
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
                }
                // Радость от удачного ответа; серия из трёх — подскок,
                // пять и больше инструментов в задаче — «гордость».
                okStreak += 1;
                if (okStreak >= 3) {
                  okStreak = 0;
                  playReact("cheer", [
                    { frame: "wide", hold: 300, fx: "✦", top: "4%", size: 14 },
                    { frame: "half", hold: 200, tilt: -3 },
                    { frame: "closed", hold: 160 },
                  ]);
                } else if (toolCount >= 5) {
                  toolCount = 0;
                  playReact("proud", [
                    { frame: "wide", hold: 620, fx: "✧", top: "2%", size: 16 },
                    { frame: "closed", hold: 200, tilt: 2 },
                  ]);
                } else {
                  playReact("smile", [
                    { frame: "half", hold: 220 },
                    { frame: "wide", hold: 240 },
                    { frame: "closed", hold: 160 },
                  ]);
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
                // Новая задача: инструменты считаем с нуля.
                toolCount = 0;
                toolStartedAt = 0;
                anxietyShown = false;
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
                // Любопытство: инструмент начал работу — голову набок.
                if ((!id || !currentSid || id === currentSid) && charReact(voice)) {
                  toolCount += 1;
                  toolStartedAt = Date.now();
                  anxietyShown = false;
                  if (!speaking) playReact("curious", [{ frame: "half", hold: 420, tilt: 3 }, { frame: "closed", hold: 140, tilt: 0 }]);
                }
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
                // Инструмент молчит больше минуты — лёгкая тревога, один раз.
                if (
                  !anxietyShown &&
                  toolStartedAt &&
                  Date.now() - toolStartedAt > 60000 &&
                  charReact(voice) &&
                  !speaking
                ) {
                  anxietyShown = true;
                  playReact("anxiety", [
                    { frame: "half", hold: 500, shake: true, fx: "…", top: "2%", size: 12 },
                    { frame: "closed", hold: 200 },
                  ]);
                }
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
                if (charReact(voice)) rageOnce(2500);
              }),
            );
          } catch (err) {
          }
        }
        // Компактизация (/compact или автосжатие контекста): реакцию играет
        // не шина окна, а мост — серверный плагин видит событие и кладёт
        // метку в /state.react (см. pollBridge).
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
                if (charReact(voice)) rageOnce(4200);
              }),
            );
          } catch (err) {
          }
        }
        onCleanup(() => {
          for (const off of offs) if (typeof off === "function") off();
          clearInterval(boredTimer);
          if (reactTimer) clearTimeout(reactTimer);
        });
      },
    );
  } catch (e) {
  }

  // Горячие клавиши окна: не надо лезть в панель, чтобы замолчать.
  // В полях ввода не перехватываем — там Cmd/Ctrl+Shift могут значить другое.
  const onHotkey = (ev) => {
    if (!uiPrefs.keys || !pluginOn()) return;
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
    clearTimeout(idle2Timer);
    clearInterval(idle2Poll);
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
