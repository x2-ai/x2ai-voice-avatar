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

const PACKS = __SPRITES__;
const CLICKS = __CLICKS__;
// Реплики панели: lines (при смене персонажа), packs (при смене пака), samples (пример голоса).
const LINES = __LINES__;

const VOICES = ["ru_f1","ru_f2","ru_m1","ru_m5","fx_robot","fx_demoness","fx_alien","fx_cat","fx_penguin","fx_ghost"];
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
  if (saved && PACKS[saved]) activePack = saved;
  else if (!PACKS.pixel || !Object.keys(PACKS.pixel).length) activePack = "anime";
} catch (e) {}

function packVoices(name) {
  const pack = PACKS[name || activePack] || {};
  return Object.keys(pack).filter((voice) => pack[voice] && pack[voice].closed);
}

function setPack(name) {
  if (!PACKS[name]) return;
  activePack = name;
  try {
    localStorage.setItem(PACK_KEY, name);
  } catch (e) {}
}

// Ключ персонажа внутри пака: у пиксельного пака id с префиксом px_,
// а голос чата может быть без него (ru_f1 вместо px_ru_f1).
function packKey(voice) {
  const key = SPRITE_ALIAS[voice] || voice;
  const pack = PACKS[activePack] || {};
  if (pack[key]) return key;
  const prefixed = "px_" + key;
  if (pack[prefixed]) return prefixed;
  const bare = key.replace(/^px_/, "");
  if (pack[bare]) return bare;
  return key;
}

function frame(voice, state) {
  const key = packKey(voice);
  const pack = PACKS[activePack] || {};
  const base = PACKS.anime || {};
  const set = pack[key] || base[key] || base.ru_f1 || Object.values(PACKS)[0].ru_f1;
  return set[state] || set.closed;
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
    img.src = frame(voice, moodState.value === "awake" ? "closed" : "blink");
    if (moodState.value !== "awake") setMood(moodState.value, true);
    root.title = `x2ai · ${nameFor(voice)} · ${voice}`;
    applyHeightFor(packKey(next));
    applyPrefsFor(packKey(next));
  };

  // Шестерёнка появляется при наведении: выбор пака персонажей.
  const gear = document.createElement("button");
  gear.type = "button";
  gear.textContent = "⚙";
  gear.title = "Настройки персонажа";
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

  // Вторая кнопка — сменить персонажа (то же, что кнопка в панели).
  const swapBtn = document.createElement("button");
  swapBtn.type = "button";
  swapBtn.textContent = "↻";
  swapBtn.title = "Следующий персонаж из пака";
  // Стиль задаём явно: чтение gear.style.cssText нормализует пробелы
  // («top: 2px»), и replace не срабатывал — кнопка накрывала шестерёнку.
  swapBtn.style.cssText = [
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
  let speechMode = null; // "full" | "summary" | "silent"; null = ещё не загружен
  let speechSpeed = null; // 0.7–1.8; null = ещё не загружена
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
  function applyPrefsFor(key) {
    if (!bridgeReady) return;
    const cs = charSettingsFor(key);
    if (cs.speech && cs.speech !== speechMode) {
      speechMode = cs.speech;
      bridge("/speech", { mode: speechMode }).catch(() => {});
    }
    if (cs.reason) {
      const cur = reasonState || { mode: "off", translate: true };
      if (cs.reason.mode !== cur.mode || Boolean(cs.reason.translate) !== Boolean(cur.translate)) {
        reasonState = { mode: cs.reason.mode || "off", translate: cs.reason.translate !== false };
        bridge("/speech", { reason: reasonState }).catch(() => {});
      }
    }
  }
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
  function pickClip(list) {
    return list && list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  function playClip(item) {
    if (!item || !item.src) return 0;
    stopClick();
    try {
      clickAudio = new Audio(item.src);
      clickAudio.play();
    } catch (e) {
      clickAudio = null;
    }
    startSpeaking(item.ms > 0 ? item.ms : 1200);
    return item.ms || 1200;
  }

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
    if (currentSid) bridge("/voice", { sid: currentSid, voice: charVoice(next), name: nameFor(next) }).catch(() => {});
    // Реплики есть по голосу, а не по id персонажа.
    const line = pickClip(LINES.lines && (LINES.lines[charVoice(next)] || LINES.lines[next]));
    playClip(line);
    if (line && line.text) startSpeaking(line.ms || 1200, "", line.text);
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
    if (panelOpen) renderPanel();
  };

  // Раскрывающиеся блоки настроек: по умолчанию свёрнуты.
  const sectionOpen = { pack: false, voice: false, char: false, speech: false, model: false, user: false, stats: false, reason: false };

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
    badge.title = `Озвучено ответов: ${stats.count} · речи: ${mins} мин`;
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
    label.textContent = titleText;
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

  const renderPanel = () => {
    panel.textContent = "";
    const view = panelView || { name: "root" };
    const go = (next) => {
      panelView = next;
      renderPanel();
    };

    const switchPack = (name) => {
      setPack(name);
      seedPackSettings();
      syncEnabled();
      const list = enabledChars();
      const pick = list.includes(voice) ? voice : list[0] || packVoices()[0];
      if (pick) {
        apply(pick, true);
        saveLocal(currentSid, pick);
        if (currentSid) bridge("/voice", { sid: currentSid, voice: charVoice(pick), name: nameFor(pick) }).catch(() => {});
      }
      // Персонаж называет пак своим голосом.
      const packClips = LINES.packs && LINES.packs[name];
      playClip(packClips && packClips[pick || voice]);
    };

    // Подписи голоса и общая строка-кнопка для всех списков панели.
    const labelOf = (id) => {
      const found = (voiceCatalog || []).find((v) => v.id === id);
      return found ? found.label : id;
    };

    const vRow = (text, active, onClick, extra) => {
      const row = document.createElement("button");
      row.type = "button";
      row.textContent = text;
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
    const head = (title, back) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;flex-direction:column;gap:2px;margin:0 0 8px";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.textContent = "← Назад";
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
      const titleEl = document.createElement("div");
      titleEl.textContent = title;
      titleEl.style.cssText = "font-size:12px;font-weight:600;opacity:.95;padding-left:2px";
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
      label.textContent = text;
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
      btn.title = title;
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
      el.textContent = text;
      el.style.cssText = "font-size:10px;line-height:1.45;opacity:.5;margin:2px 0 0 2px";
      (parent || panel).appendChild(el);
      return el;
    };

    if (view.name === "root") {
      const menu = document.createElement("div");
      menu.style.cssText = "display:flex;flex-direction:column;gap:6px";
      const items = [
        ["Данные пользователя", "user"],
        ["Настройка персонажей", "chars"],
        ["Вспомогательная модель", "model"],
        ["Статистика", "stats"],
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
      uInput.placeholder = "Имя (необязательно)";
      uInput.value = userName;
      uInput.style.cssText =
        "width:100%;box-sizing:border-box;font:inherit;font-size:12px;padding:5px 7px;" +
        "border:1px solid rgba(255,255,255,.16);border-radius:7px;" +
        "background:rgba(255,255,255,.05);color:inherit;outline:none";
      box.appendChild(uInput);

      const uHint = document.createElement("div");
      uHint.textContent = "Как обращаться к тебе в пересказе";
      uHint.style.cssText = "opacity:.5;font-size:10px;line-height:1.4;margin:3px 0 0 2px";
      box.appendChild(uHint);

      const gRow = document.createElement("div");
      gRow.style.cssText = "display:flex;gap:4px;margin-top:5px";
      box.appendChild(gRow);

      const GENDERS = [
        ["", "Не указывать"],
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
        row.style.justifyContent = "center";
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
      const pList = keepScroll(document.createElement("div"), "pack");
      pList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      for (const name of Object.keys(PACKS)) {
        const count = Object.keys(PACKS[name] || {}).length;
        pList.appendChild(
          vRow(`${PACK_NAMES[name] || name} · ${count}`, name === activePack, () => {
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
        name.textContent = nameFor(key);
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
      head(nameFor(key), { name: "chars" });
      const box = boxEl();

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
      const defaultVoiceOf = () => VOICE_ALIAS[key] || key;
      const pickedVoice = () => charSettingsFor(key).voice || charVoices[key] || "";
      const isDefaultVoice = () => {
        const picked = pickedVoice();
        return !picked || picked === defaultVoiceOf();
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
        vCur.textContent = `сейчас: ${labelOf(pickedVoice() || defaultVoiceOf())}`;
        for (const item of voiceRows) {
          item.row.setActive(item.id ? !isDefaultVoice() && item.id === pickedVoice() : isDefaultVoice());
        }
      };

      const bindVoice = (id) => {
        // Пример голоса звучит сразу, не дожидаясь ответа моста.
        playClip((LINES.samples && (LINES.samples[id] || LINES.samples[key])) || null);
        const value = id || defaultVoiceOf();
        saveCharSetting(key, { voice: value });
        charVoices[key] = value;
        bridge("/charvoice", { charId: key, voice: value }).catch(() => {});
        if (key === packKey(voice) && currentSid) {
          bridge("/voice", { sid: currentSid, voice: value, name: nameFor(key) }).catch(() => {});
        }
        refreshVoiceSelection();
      };

      if (!voiceCatalog) {
        const loading = document.createElement("div");
        loading.textContent = "загружаю голоса…";
        loading.style.cssText = "opacity:.5;font-size:11px";
        vList.appendChild(loading);
        bridge("/voices")
          .then((data) => {
            voiceCatalog = (data && data.voices) || [];
            renderPanel();
          })
          .catch(() => {});
      } else {
        for (const v of voiceCatalog) {
          const row = vRow(v.label, v.id === pickedVoice() && !isDefaultVoice(), () => bindVoice(v.id));
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

      // Озвучка ответа: полное чтение, пересказ или тишина — своё у каждого персонажа.
      const sBody = collapsible("Озвучка ответа", "speech", box);
      const SPEECH_LABELS = [
        ["full", "Полное прочтение ответа"],
        ["summary", "Пересказ"],
        ["silent", "Молчание"],
      ];
      const sList = keepScroll(document.createElement("div"), "speech");
      sList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      const speechRows = [];
      const speechNote = document.createElement("div");
      speechNote.textContent = "озвучки не будет";
      speechNote.style.cssText = "font-size:11px;opacity:.55;margin-top:6px";

      const speechFor = () => charSettingsFor(key).speech || speechMode || "summary";
      const refreshSpeech = () => {
        const cur = speechFor();
        for (const item of speechRows) item.row.setActive(item.mode === cur);
        speechNote.style.display = cur === "silent" ? "block" : "none";
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
      sBody.appendChild(sList);
      sBody.appendChild(speechNote);

      // Скорость речи: общая для движка, применяется к следующей озвучке.
      const spRow = document.createElement("div");
      spRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:8px";
      const spInput = document.createElement("input");
      spInput.type = "range";
      spInput.min = "0.7";
      spInput.max = "1.8";
      spInput.step = "0.05";
      spInput.value = String(speechSpeed || 1);
      spInput.style.cssText = "flex:1;accent-color:#5b8dee;cursor:pointer";
      const spVal = document.createElement("span");
      spVal.style.cssText = "font-size:11px;opacity:.7;width:48px;text-align:right";
      spVal.textContent = `${(speechSpeed || 1).toFixed(2)}×`;
      spInput.oninput = () => {
        speechSpeed = Number(spInput.value);
        spVal.textContent = `${speechSpeed.toFixed(2)}×`;
      };
      // Пишем на отпускании ползунка, чтобы не долбить мост на каждый пиксель.
      spInput.onchange = () => {
        bridge("/speech", { speed: speechSpeed }).catch(() => {});
      };
      spRow.append(spInput, spVal);
      sBody.appendChild(spRow);

      // Кнопки: проверить скорость своим голосом и заглушить текущую озвучку.
      const actRow = document.createElement("div");
      actRow.style.cssText = "display:flex;gap:6px;margin-top:8px";
      const actBtn = (text, title) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = text;
        btn.title = title;
        btn.style.cssText = [
          "flex:1",
          "padding:5px 8px",
          "border-radius:7px",
          "cursor:pointer",
          "font:inherit",
          "font-size:11px",
          "color:inherit",
          "text-align:center",
          "border:1px solid rgba(255,255,255,.16)",
          "background:rgba(255,255,255,.05)",
        ].join(";");
        btn.onclick = (ev) => {
          ev.stopPropagation();
          btn.onclickAction && btn.onclickAction();
        };
        return btn;
      };
      const testBtn = actBtn("▶ Проверить", "Озвучить пробную фразу голосом этого персонажа");
      testBtn.onclickAction = () => {
        bridge("/test", { voice: charVoice(key), sid: currentSid }).catch(() => {});
      };
      const stopBtn = actBtn("■ Стоп", "Заглушить текущую озвучку");
      stopBtn.onclickAction = () => {
        stopAll();
      };
      const replayBtn = actBtn("↻ Повторить", "Озвучить последний текст ещё раз");
      replayBtn.onclickAction = () => {
        bridge("/replay", {}).catch(() => {});
      };

      // Тихие часы: в этом окне персонаж молчит сам, режим озвучки не меняется.
      const qBox = document.createElement("div");
      qBox.style.cssText = "margin-top:10px;display:flex;flex-direction:column;gap:6px";
      const qTop = document.createElement("div");
      qTop.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px";
      const qLabel = document.createElement("span");
      qLabel.textContent = "Тихие часы";
      qLabel.style.cssText = "font-size:11px;opacity:.75";
      const qToggle = document.createElement("button");
      qToggle.type = "button";
      qToggle.style.cssText =
        "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:inherit;border-radius:7px;padding:3px 9px;font-size:11px;cursor:pointer";
      qToggle.textContent = "выкл";
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
        qToggle.textContent = quietState.on ? "вкл" : "выкл";
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
      sBody.appendChild(qBox);

      // Память против скорости: держать движок загруженным или поднимать на фразу.
      const memRow = document.createElement("div");
      memRow.style.cssText = "display:flex;flex-direction:column;gap:4px;margin-top:10px";
      const memBtn = vRow("Держать движок в памяти", keepAlive, () => {
        keepAlive = !keepAlive;
        refreshMem();
        bridge("/speech", { keepAlive }).catch(() => {});
      });
      const memHint = document.createElement("div");
      memHint.style.cssText = "font-size:10px;line-height:1.4;opacity:.5";
      const refreshMem = () => {
        memBtn.setActive(keepAlive);
        memHint.textContent = keepAlive
          ? "движок занимает ~1.7 ГБ и отвечает за полсекунды"
          : "по требованию: каждая фраза ~9 с на загрузку, память свободна";
      };
      memRow.append(memBtn, memHint);
      refreshMem();
      sBody.appendChild(memRow);

      actRow.append(testBtn, replayBtn, stopBtn);
      sBody.appendChild(actRow);

      // Озвучка рассуждений: своя у каждого персонажа.
      const rBody = collapsible("Озвучка рассуждений", "reason", box);
      const rList = keepScroll(document.createElement("div"), "reason");
      rList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      const reasonRows = [];
      const rTrans = document.createElement("div");
      rTrans.style.cssText = "display:flex;margin-top:6px";
      const rTransRow = vRow("Переводить на русский", false, () => {
        const next = !reasonFor().translate;
        setReason({ translate: next });
      });
      rTransRow.style.flex = "1";
      rTrans.appendChild(rTransRow);

      const reasonFor = () => charSettingsFor(key).reason || reasonState || { mode: "off", translate: true };
      const refreshReason = () => {
        const st = reasonFor();
        for (const item of reasonRows) item.row.setActive(item.mode === st.mode);
        rTransRow.setActive(Boolean(st.translate));
        rList.style.opacity = st.mode === "off" ? ".5" : "1";
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
      refreshReason();
      rBody.append(rList, rTrans);

      const applySpeechState = (data) => {
        if (!data) return;
        if (data.mode) speechMode = data.mode;
        const sp = Number(data.speed);
        if (Number.isFinite(sp) && sp >= 0.7 && sp <= 1.8) {
          speechSpeed = sp;
          spInput.value = String(sp);
          spVal.textContent = `${sp.toFixed(2)}×`;
        }
        if (data.keepAlive !== undefined) {
          keepAlive = Boolean(data.keepAlive);
          refreshMem();
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
          refreshQuiet();
        }
        seedPackSettings();
        refreshSpeech();
        refreshReason();
      };

      if (!speechLoaded) {
        speechLoaded = true;
        bridge("/speech")
          .then(applySpeechState)
          .catch(() => {});
      }
    } else if (view.name === "model") {
      head("Вспомогательная модель");
      const box = boxEl();

      const desc = document.createElement("div");
      desc.textContent =
        "Читает ответы вслух, когда выбран пересказ: сокращает текст, переводит рассуждения на русский и озвучивает мысли. Локальные и бесплатные модели — в начале списка.";
      desc.style.cssText = "font-size:10px;line-height:1.45;opacity:.55;margin:0 0 2px 2px";
      box.appendChild(desc);

      const mList = keepScroll(document.createElement("div"), "model");
      mList.style.cssText = "max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
      const mSearch = document.createElement("input");
      mSearch.type = "text";
      mSearch.placeholder = "Поиск модели";
      mSearch.value = modelQuery;
      mSearch.style.cssText =
        "width:100%;box-sizing:border-box;font:inherit;font-size:11px;padding:4px 7px;margin-bottom:2px;" +
        "border:1px solid rgba(255,255,255,.16);border-radius:7px;background:rgba(255,255,255,.04);color:inherit";
      mSearch.oninput = () => {
        modelQuery = mSearch.value;
        modelLimit = 40;
        renderModels();
      };
      mSearch.onclick = (ev) => ev.stopPropagation();
      box.append(mSearch, mList);

      const modelRows = [];

      const renderModels = (data) => {
        if (data) modelsData = data;
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
          empty.textContent =
            data && data.error ? "не удалось получить список" : "локальных и бесплатных моделей нет";
          empty.style.cssText = "opacity:.5;font-size:11px";
          mList.appendChild(empty);
          return;
        }
        for (const m of shown) {
          const active = m.providerID === current.providerID && m.id === current.id;
          const row = vRow(m.local ? `${m.name} · локальная` : m.name, active, () => {
            for (const item of modelRows) item.row.setActive(item.model === m);
            bridge("/model", { providerID: m.providerID, id: m.id }).catch(() => {});
          });
          row.title = `${m.providerID}/${m.id}`;
          modelRows.push({ model: m, row });
          mList.appendChild(row);
        }
        if (free.length > shown.length) {
          const more = document.createElement("button");
          more.type = "button";
          more.textContent = `Показать ещё ${Math.min(40, free.length - shown.length)}`;
          more.style.cssText =
            "margin-top:4px;padding:4px 8px;font:inherit;font-size:11px;cursor:pointer;border-radius:7px;" +
            "border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:inherit";
          more.onclick = (ev) => {
            ev.stopPropagation();
            modelLimit += 40;
            renderModels();
          };
          mList.appendChild(more);
          const left = document.createElement("div");
          left.textContent = `всего подходит: ${free.length}`;
          left.style.cssText = "opacity:.4;font-size:10px;padding:2px 7px";
          mList.appendChild(left);
        }
      };

      const loadModels = () => {
        if (modelsLoaded) {
          renderModels();
          return;
        }
        if (modelsLoading) return;
        modelsLoading = true;
        mList.textContent = "";
        const noteEl = document.createElement("div");
        noteEl.textContent = "загружаю…";
        noteEl.style.cssText = "opacity:.5;font-size:11px";
        mList.appendChild(noteEl);
        bridge("/models")
          .then((data) => {
            modelsLoaded = true;
            modelsLoading = false;
            renderModels(data);
          })
          .catch(() => {
            modelsLoading = false;
            noteEl.textContent = "мост недоступен";
          });
      };
      loadModels();
    } else if (view.name === "stats") {
      head("Статистика");
      const box = boxEl();

      const stText = document.createElement("div");
      stText.style.cssText = "font-size:11px;line-height:1.5;opacity:.8";
      const stReset = document.createElement("button");
      stReset.type = "button";
      stReset.textContent = "Сбросить";
      stReset.style.cssText =
        "margin-top:6px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:inherit;border-radius:7px;padding:3px 9px;font-size:11px;cursor:pointer;align-self:flex-start";
      const refreshStats = () => {
        const mins = Math.floor(stats.ms / 60000);
        const secs = Math.round((stats.ms % 60000) / 1000);
        stText.textContent = `Озвучено ответов: ${stats.count} · всего речи: ${mins} мин ${secs} с`;
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
    }

    restoreScroll();
  };

  let panelOpen = false;
  // Открытие панели всегда начинается с корневого меню.
  let panelView = { name: "root" };
  const togglePanel = (on) => {
    panelOpen = on === undefined ? !panelOpen : on;
    if (panelOpen) {
      panelView = { name: "root" };
      renderPanel();
    }
    panel.style.display = panelOpen ? "block" : "none";
    gear.style.display = panelOpen ? "none" : "";
    gear.style.opacity = panelOpen ? "1" : "";
    swapBtn.style.display = panelOpen ? "none" : "";
    swapBtn.style.opacity = panelOpen ? "1" : "";
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
  };
  box.onmouseleave = () => {
    if (!panelOpen) {
      gear.style.opacity = "0";
      swapBtn.style.opacity = "0";
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

  // --- Настроение: сон при простое, грусть при ошибке, звук пробуждения ---
  try {
    const st = document.createElement("style");
    st.textContent = [
      "@keyframes x2ai-breathe{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}",
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
  bubble.textContent = "…";
  bubble.style.cssText = [
    "position:absolute",
    "right:-10px",
    "top:-4px",
    "display:none",
    "padding:1px 5px 3px",
    "border-radius:9px",
    "background:rgba(140,175,255,.22)",
    "border:1px solid rgba(150,185,255,.45)",
    "font-size:10px",
    "line-height:1",
    "letter-spacing:1px",
    "color:rgba(235,242,255,.9)",
    "pointer-events:none",
  ].join(";");
  box.appendChild(bubble);

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

  const setMood = (next, quiet) => {
    const prev = moodState.value;
    moodState.value = next;
    if (next === "sleeping") {
      if (!quiet) img.src = frame(voice, "blink");
      img.style.filter = `${SHADOW} saturate(.7) brightness(.9)`;
      box.style.animation = "x2ai-breathe 3.6s ease-in-out infinite";
      zzz.style.animation = "x2ai-zzz 2.6s ease-out infinite";
      zzz.style.opacity = "0";
      root.title = `x2ai · ${nameFor(voice)} · спит`;
    } else if (next === "sad") {
      if (!quiet) img.src = frame(voice, "blink");
      img.style.filter = `${SHADOW} grayscale(.55) brightness(.88)`;
      box.style.animation = "";
      box.style.transform = "translateY(2px) rotate(-2deg)";
      zzz.style.animation = "";
      zzz.style.opacity = "0";
      root.title = `x2ai · ${nameFor(voice)} · расстроен`;
    } else {
      if (!quiet) img.src = frame(voice, "closed");
      img.style.filter = SHADOW;
      box.style.animation = "";
      box.style.transform = "";
      zzz.style.animation = "";
      zzz.style.opacity = "0";
      root.title = `x2ai · ${nameFor(voice)} · ${voice}`;
    }
    return prev;
  };

  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (speaking || panelOpen || moodState.value === "sad") {
        resetIdle();
        return;
      }
      setMood("sleeping");
    }, IDLE_MS);
  };

  // Любая активность будит персонажа; из сна — со звуком.
  const wake = () => {
    const wasAsleep = moodState.value === "sleeping";
    if (moodState.value !== "awake") {
      if (moodTimer) clearTimeout(moodTimer);
      setMood("awake");
    }
    if (wasAsleep) wakeBlip();
    resetIdle();
  };

  const sadFor = (ms) => {
    wake();
    setMood("sad");
    if (moodTimer) clearTimeout(moodTimer);
    moodTimer = setTimeout(() => {
      if (moodState.value === "sad") setMood("awake");
      resetIdle();
    }, ms || 4200);
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

  // Артикуляция по тексту: гласные дают свою форму рта, согласные — закрытый.
  const VOWEL_FRAME = {
    а: "wide",
    о: "open",
    у: "round",
    ы: "half",
    э: "half",
    е: "half",
    ё: "half",
    и: "half",
    ю: "round",
    я: "wide",
  };
  // Без сглаживания: согласные закрывают рот, гласные держат свою форму.
  const frameFor = (ch) => VOWEL_FRAME[ch] || "closed";
  const charWeight = (ch) => {
    if (VOWEL_FRAME[ch]) return 1.7;
    if (/[.!?…]/.test(ch)) return 3.5;
    if (/[,;:]/.test(ch)) return 2.2;
    if (/[—–-]/.test(ch)) return 2.5;
    if (/\s/.test(ch)) return 1.2;
    return 0.9;
  };

  const buildTalkPlan = (text, ms) => {
    const chars = String(text || "")
      .toLowerCase()
      .replace(/[^а-яё\s.,!?;:—–…-]/g, "")
      .split("");
    if (!chars.length) return null;
    const total = chars.reduce((acc, ch) => acc + charWeight(ch), 0) || 1;
    // Каждый звук разбиваем на «подход — держим — отпускаем»: кадры меняются
    // чаще, и речь выглядит живее, а не как один застывший кадр на букву.
    const plan = [];
    for (const ch of chars) {
      const dur = Math.max(45, Math.round((ms * charWeight(ch)) / total));
      const target = frameFor(ch);
      if (target === "closed") {
        plan.push({ frame: "closed", delay: dur });
        continue;
      }
      plan.push({ frame: "half", delay: Math.max(70, Math.round(dur * 0.22)) });
      plan.push({ frame: target, delay: Math.max(80, Math.round(dur * 0.56)) });
      plan.push({ frame: "half", delay: Math.max(70, Math.round(dur * 0.22)) });
    }
    return plan;
  };

  let talkTimeout = null;
  const runPlan = (plan, thinking) => {
    let i = 0;
    const step = () => {
      if (!speaking) return;
      if (i >= plan.length) {
        // План доиграл раньше звука — держим закрытый рот, не открываем заново.
        img.src = frame(voice, "closed");
        return;
      }
      const item = plan[i++];
      img.src = frame(voice, item.frame);
      box.style.transform = `translateY(${i % 2 ? -1 : 0}px) rotate(${i % 2 ? -0.12 : 0.06}deg)`;
      talkTimeout = setTimeout(step, thinking ? item.delay * 1.4 : item.delay);
    };
    step();
  };

  const startSpeaking = (ms, kind, text) => {
    speaking = true;
    const thinking = kind === "reason";
    bubble.style.display = thinking ? "block" : "none";
    box.style.filter = thinking ? "saturate(.85) brightness(1.02)" : "";
    if (moodState.value !== "awake") {
      if (moodTimer) clearTimeout(moodTimer);
      setMood("awake");
    }
    resetIdle();
    if (talkTimer) clearInterval(talkTimer);
    if (talkTimeout) clearTimeout(talkTimeout);
    if (speakTimer) clearTimeout(speakTimer);
    const total = ms > 0 ? ms : 9000;
    speakTimer = setTimeout(stopSpeaking, total + 500);

    const plan = buildTalkPlan(text, total);
    if (plan) {
      runPlan(plan, thinking);
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
    bubble.style.display = "none";
    box.style.filter = "";
    if (talkTimer) clearInterval(talkTimer);
    if (talkTimeout) clearTimeout(talkTimeout);
    talkTimer = null;
    talkTimeout = null;
    talkStep = 0;
    box.style.transform = "";
    img.src = frame(voice, "closed");
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
  const charVoice = (id) => {
    if (!id) return id;
    const key = packKey(id);
    return charSettingsFor(key).voice || charVoices[key] || VOICE_ALIAS[id] || VOICE_ALIAS[key] || id;
  };
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
  // Голос чата на сервер: до готовности моста молчим, потом дошлём.
  function pushVoice(key) {
    if (!bridgeReady || !currentSid || !key) return;
    bridge("/voice", { sid: currentSid, voice: charVoice(key), name: nameFor(key) }).catch(() => {});
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
  // Имя персонажа синхронизируем с мостом, чтобы правила в промпте знали пак.
  let lastSyncedName = "";
  const syncName = () => {
    if (!currentSid) return;
    const nm = nameFor(voice);
    if (!nm || nm === lastSyncedName) return;
    lastSyncedName = nm;
    bridge("/voice", { sid: currentSid, voice: charVoice(voice), name: nm }).catch(() => {});
  };

  const pollBridge = () => {
    syncName();
    bridge("/state")
      .then((state) => {
        if (!state) return;
        const key = JSON.stringify([state.voices || {}, state.charVoices || {}]);
        if (key !== adoptedKey) {
          adoptedKey = key;
          charVoices = state.charVoices || {};
          adopt(state.voices);
        }
        // Губами двигает только тот чат, чья это озвучка: сервер пишет sid
        // в state-файл, а окно сравнивает его с текущим чатом.
        const mine = !state.sid || !currentSid || state.sid === currentSid;
        if (state.speaking && mine) {
          if (moodState.value === "sleeping") wake();
          const at = Number(state.at) || 0;
          if (!bridgeSpeaking || (at && at !== lastSpeakAt)) {
            bridgeSpeaking = true;
            lastSpeakAt = at;
            stopClick();
            stopSynth();
            stats.count += 1;
            if (state.ms > 0) stats.ms += state.ms;
            saveStats();
            refreshBadge();
            startSpeaking(state.ms > 0 ? state.ms : 9000, state.kind || "", state.text || "");
          }
        } else {
          bridgeSpeaking = false;
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
        const list = PING_PHRASES[voiceGender(charVoice(voiceOf(key)))] || PING_PHRASES.n;
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

  box.onclick = () => {
    // Пока персонаж говорит, клик его замолкает; в тишине — просто реплика.
    const wasSpeaking = speaking;
    stopAll();
    if (!wasSpeaking) {
      const clip = pickClip(CLICKS[charVoice(voice)] || CLICKS.ru_f1);
      playClip(clip);
      if (clip && clip.text) startSpeaking(clip.ms || 1200, "", clip.text);
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
      if (!speaking) {
        img.src = frame(voice, "blink");
        setTimeout(() => {
          if (!speaking) img.src = frame(voice, "closed");
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
    startSynth();
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
        for (const name of ["session.execution.succeeded", "session.execution.interrupted"]) {
          try {
            offs.push(data.on(name, onSpeak(name)));
          } catch (err) {
          }
        }
        let answerStartedAt = 0;
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
        for (const name of [
          "session.execution.succeeded",
        ]) {
          try {
            offs.push(
              data.on(name, () => {
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
        // Инструмент упал — персонаж на пару секунд грустнеет.
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
                sadFor(2500);
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
                sadFor(4200);
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

  const teardown = () => {
    pingReset();
    clearTimeout(blinkTimer);
    clearTimeout(idleTimer);
    clearTimeout(moodTimer);
    clearTimeout(speakTimer);
    clearTimeout(bridgeTimer);
    clearInterval(sidePoll);
    if (talkTimer) clearInterval(talkTimer);
    if (typeof unsub === "function") {
      try {
        unsub();
      } catch (e) {}
    }
  };
  globalThis.__x2aiAvatarTeardown = teardown;

  root.destroy = () => {
    pingReset();
    clearTimeout(blinkTimer);
    clearTimeout(idleTimer);
    clearTimeout(moodTimer);
    clearTimeout(speakTimer);
    clearInterval(sidePoll);
    clearTimeout(bridgeTimer);
    document.removeEventListener("mousedown", onDocDown, true);
    if (talkTimer) clearInterval(talkTimer);
    if (typeof unsub === "function") {
      try {
        unsub();
      } catch (e) {}
    }
  };

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
