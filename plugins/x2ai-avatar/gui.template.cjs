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
const SPRITE_ALIAS = { fx_demon: "fx_demoness" };
const CHAR_NAMES = {
  anime: {
    ru_f1: "Аня", ru_f2: "Мила", ru_m1: "Гриша", ru_m5: "Тимур",
    fx_robot: "Робик", fx_demoness: "Азазель", fx_alien: "Зета",
    fx_cat: "Мурзик", fx_penguin: "Пико", fx_ghost: "Юки",
  },
  pixel: {
    ru_f1: "Тянка", fx_robot: "Робот", fx_demoness: "Демонесса",
    fx_penguin: "Инопланетянин", ru_m1: "Программист",
  },
};

// Имя зависит от пака: в пиксельном свои названия, в аниме — прежние.
function nameFor(voice) {
  const pack = CHAR_NAMES[activePack] || {};
  return pack[voice] || CHAR_NAMES.anime[voice] || voice;
}
const HEIGHT = 224; // px на экране (спрайты 336 px)

// Артикуляция: набор кадров рта в порядке «полуоткрыт → открыт → округлён → широко».
const TALK = ["half", "open", "round", "wide", "open", "half"];

function hash(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) | 0;
  return String(h);
}

function voiceFor(sid) {
  if (!sid) return "ru_f1";
  return VOICES[Math.abs(Number(hash(sid)) | 0) % VOICES.length];
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

function frame(voice, state) {
  const key = SPRITE_ALIAS[voice] || voice;
  const pack = PACKS[activePack] || {};
  const base = PACKS.anime || {};
  const set = pack[key] || base[key] || base.ru_f1 || Object.values(PACKS)[0].ru_f1;
  return set[state] || set.closed;
}

function createView(ctx) {
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
    `height:${HEIGHT}px`,
    "width:auto",
    "display:block",
    "filter:drop-shadow(0 2px 6px rgba(0,0,0,.28))",
    "transition:opacity 90ms linear",
  ].join(";");
  box.appendChild(img);

  let evCount = 0;
  let lastSid = "";

  let voice = "ru_f1";
  img.src = frame(voice, "closed");

  const apply = (next, force) => {
    if (!next || (next === voice && !force)) return;
    voice = next;
    img.src = frame(voice, "closed");
    root.title = `x2ai · ${nameFor(voice)} · ${voice}`;
  };

  // Шестерёнка появляется при наведении: выбор пака персонажей.
  const gear = document.createElement("button");
  gear.type = "button";
  gear.textContent = "⚙";
  gear.title = "Настройки персонажа";
  gear.style.cssText = [
    "position:absolute",
    "right:-4px",
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

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:absolute",
    `bottom:${HEIGHT + 30}px`,
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
  const nextCharacter = () => {
    stopAll();
    const list = packVoices();
    const index = list.indexOf(voice);
    const next = list[(index + 1) % list.length] || voice;
    apply(next);
    saveLocal(currentSid, next);
    if (currentSid) bridge("/voice", { sid: currentSid, voice: charVoice(next) }).catch(() => {});
    playClip(pickClip(LINES.lines && LINES.lines[next]));
    return next;
  };

  // Раскрывающиеся блоки настроек: по умолчанию свёрнуты.
  const sectionOpen = { pack: false, voice: false, speech: false, model: false };

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
      sectionOpen[key] = !sectionOpen[key];
      renderPanel();
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
    const switchPack = (name) => {
      setPack(name);
      const list = packVoices();
      const pick = list.includes(voice) ? voice : list[0];
      if (pick) {
        apply(pick, true);
        saveLocal(currentSid, pick);
        if (currentSid) bridge("/voice", { sid: currentSid, voice: charVoice(pick) }).catch(() => {});
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
    const settings = document.createElement("div");
    settings.style.cssText = [
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
    panel.appendChild(settings);

    const pBody = collapsible("Пак персонажей", "pack", settings);

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

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "↻ Следующий персонаж из пака";
    nextBtn.style.cssText = [
      "display:block",
      "width:100%",
      "margin:0 0 10px",
      "padding:7px 8px",
      "border-radius:7px",
      "cursor:pointer",
      "font:inherit",
      "font-size:12px",
      "font-weight:600",
      "color:inherit",
      "text-align:center",
      "border:1px solid rgba(120,180,255,.6)",
      "background:rgba(80,130,220,.18)",
    ].join(";");
    nextBtn.onclick = (ev) => {
      ev.stopPropagation();
      nextCharacter();
      renderPanel();
    };
    settings.appendChild(nextBtn);

    const rule = document.createElement("hr");
    rule.style.cssText = "border:none;border-top:1px solid rgba(255,255,255,.12);margin:0 0 2px";
    settings.appendChild(rule);

    const vBody = collapsible("Голос персонажа", "voice", settings);

    const curVoice = charVoices[voice] || voice;

    const vCur = document.createElement("div");
    vCur.textContent = `сейчас: ${labelOf(curVoice)}`;
    vCur.style.cssText = "font-size:11px;opacity:.7;margin-bottom:6px";
    vBody.appendChild(vCur);

    const vList = keepScroll(document.createElement("div"), "voice");
    vList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
    vBody.appendChild(vList);

    // Строки списка голосов: подсветку обновляем на месте, панель не перерисовываем.
    const voiceRows = [];
    const refreshVoiceSelection = () => {
      const cur = charVoices[voice] || voice;
      vCur.textContent = `сейчас: ${labelOf(cur)}`;
      for (const item of voiceRows) item.row.setActive(item.id ? item.id === cur : !charVoices[voice]);
    };

    const bindVoice = (id) => {
      // Пример голоса звучит сразу, не дожидаясь ответа моста.
      playClip((LINES.samples && (LINES.samples[id] || LINES.samples[voice])) || null);
      bridge("/charvoice", { charId: voice, voice: id })
        .then((out) => {
          charVoices = (out && out.charVoices) || {};
          if (currentSid) bridge("/voice", { sid: currentSid, voice: charVoice(voice) }).catch(() => {});
          refreshVoiceSelection();
        })
        .catch(() => {});
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
        const row = vRow(v.label, v.id === curVoice, () => bindVoice(v.id));
        voiceRows.push({ id: v.id, row });
        vList.appendChild(row);
      }
      const defRow = vRow(
        "По умолчанию",
        !charVoices[voice],
        () => bindVoice(null),
        "margin-top:2px;opacity:.85;justify-content:center",
      );
      voiceRows.push({ id: null, row: defRow });
      vList.appendChild(defRow);
    }

    // Режим озвучки: полное чтение ответа, пересказ или тишина.
    const sBody = collapsible("Озвучка ответа", "speech", settings);
    const SPEECH_LABELS = [
      ["full", "Полное прочтение ответа"],
      ["summary", "Пересказ"],
      ["silent", "Молчание"],
    ];
    // Блок модели строится всегда, а виден только в режиме пересказа:
    // так переключение режима не требует перерисовки всей панели.
    const mBody = collapsible("Модель пересказа", "model", settings);
    const mWrap = mBody.parentNode;
    const mList = keepScroll(document.createElement("div"), "model");
    mList.style.cssText = "max-height:150px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
    mBody.appendChild(mList);

    const modelRows = [];
    let modelsLoaded = false;
    let modelsLoading = false;

    const renderModels = (data) => {
      mList.textContent = "";
      modelRows.length = 0;
      const models = (data && data.models) || [];
      const current = (data && data.current) || {};
      const free = models.filter((m) => m.free);
      const shown = free.slice(0, 40);
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.textContent = data && data.error ? "не удалось получить список" : "бесплатных моделей нет";
        empty.style.cssText = "opacity:.5;font-size:11px";
        mList.appendChild(empty);
        return;
      }
      for (const m of shown) {
        const active = m.providerID === current.providerID && m.id === current.id;
        const row = vRow(m.name, active, () => {
          for (const item of modelRows) item.row.setActive(item.model === m);
          bridge("/model", { providerID: m.providerID, id: m.id }).catch(() => {});
        });
        row.title = `${m.providerID}/${m.id}`;
        modelRows.push({ model: m, row });
        mList.appendChild(row);
      }
      if (free.length > shown.length) {
        const more = document.createElement("div");
        more.textContent = `и ещё ${free.length - shown.length} бесплатных`;
        more.style.cssText = "opacity:.45;font-size:10px;padding:2px 7px";
        mList.appendChild(more);
      }
    };

    const loadModels = () => {
      if (modelsLoaded || modelsLoading) return;
      modelsLoading = true;
      mList.textContent = "";
      const note = document.createElement("div");
      note.textContent = "загружаю…";
      note.style.cssText = "opacity:.5;font-size:11px";
      mList.appendChild(note);
      bridge("/models")
        .then((data) => {
          modelsLoaded = true;
          modelsLoading = false;
          renderModels(data);
        })
        .catch(() => {
          modelsLoading = false;
          note.textContent = "мост недоступен";
        });
    };

    const sList = keepScroll(document.createElement("div"), "speech");
    sList.style.cssText = "max-height:132px;overflow-y:auto;display:flex;flex-direction:column;gap:4px";
    const speechRows = [];
    const speechNote = document.createElement("div");
    speechNote.textContent = "озвучки не будет";
    speechNote.style.cssText = "font-size:11px;opacity:.55;margin-top:6px";

    const refreshSpeech = () => {
      const cur = speechMode || "summary";
      for (const item of speechRows) item.row.setActive(item.mode === cur);
      speechNote.style.display = cur === "silent" ? "block" : "none";
      mWrap.style.display = cur === "summary" ? "block" : "none";
      if (cur === "summary") loadModels();
    };

    const setSpeech = (mode) => {
      speechMode = mode;
      refreshSpeech();
      bridge("/speech", { mode })
        .then((out) => {
          if (out && out.mode) {
            speechMode = out.mode;
            refreshSpeech();
          }
        })
        .catch(() => {});
    };

    for (const [value, text] of SPEECH_LABELS) {
      const row = vRow(text, value === (speechMode || "summary"), () => setSpeech(value));
      speechRows.push({ mode: value, row });
      sList.appendChild(row);
    }
    sBody.appendChild(sList);
    sBody.appendChild(speechNote);

    if (!speechMode) {
      bridge("/speech")
        .then((data) => {
          speechMode = (data && data.mode) || "summary";
          refreshSpeech();
        })
        .catch(() => {
          speechMode = "summary";
          refreshSpeech();
        });
    } else {
      refreshSpeech();
    }

    restoreScroll();
  };

  let panelOpen = false;
  const togglePanel = (on) => {
    panelOpen = on === undefined ? !panelOpen : on;
    if (panelOpen) renderPanel();
    panel.style.display = panelOpen ? "block" : "none";
    gear.style.opacity = panelOpen ? "1" : "";
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
  };
  box.onmouseleave = () => {
    if (!panelOpen) gear.style.opacity = "0";
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

  let speaking = false;
  let talkTimer = null;
  let talkStep = 0;
  let blinkTimer = null;
  let speakTimer = null;

  const startSpeaking = (ms) => {
    speaking = true;
    if (talkTimer) clearInterval(talkTimer);
    if (speakTimer) clearTimeout(speakTimer);
    speakTimer = setTimeout(stopSpeaking, (ms > 0 ? ms : 9000) + 500);
    talkTimer = setInterval(() => {
      const state = TALK[talkStep % TALK.length];
      img.src = frame(voice, state);
      talkStep++;
      box.style.transform = `translateY(${talkStep % 2 ? -1 : 0}px) rotate(${talkStep % 2 ? -0.12 : 0.06}deg)`;
    }, 110);
  };

  const stopSpeaking = () => {
    speaking = false;
    if (talkTimer) clearInterval(talkTimer);
    talkTimer = null;
    talkStep = 0;
    box.style.transform = "";
    img.src = frame(voice, "closed");
  };

  // Главный канал: TeraTTS пишет state-файл ровно в момент старта afplay,
  // main-процесс плагина читает его и пушит событие в окно.
  let voiceMap = {};
  let charVoices = {};
  let currentSid = "";
  // Персонаж и голос — разные вещи: по умолчанию голос персонажа совпадает
  // с его id, но в настройках можно привязать любой другой голос.
  const charVoice = (id) => (id && charVoices[id]) || id;

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
  const applyForSession = (sid) => {
    if (sid) currentSid = sid;
    apply(resolveVoice(currentSid));
    // Локальный выбор мог появиться раньше, чем мост: досылаем его на сервер,
    // иначе TTS озвучит этот чат голосом по хешу.
    if (currentSid && localMap[currentSid] && voiceMap[currentSid] !== localMap[currentSid]) {
      const picked = localMap[currentSid];
      voiceMap[currentSid] = picked;
      try {
        bridge("/voice", { sid: currentSid, voice: charVoice(picked) }).catch(() => {});
      } catch (e) {}
    }
  };

  const bridge = (route, body) => {
    const init = body
      ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : undefined;
    return fetch(BRIDGE_URL + route, init).then((r) => r.json());
  };

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
  const pollBridge = () => {
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
          if (!bridgeSpeaking) {
            bridgeSpeaking = true;
            stopClick();
            startSpeaking(state.ms > 0 ? state.ms : 9000);
          }
        } else {
          bridgeSpeaking = false;
        }
      })
      .catch(() => {});
  };
  const bridgeTimer = setInterval(pollBridge, 250);
  pollBridge();

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
  const stopAll = () => {
    stopClick();
    stopSpeaking();
    bridge("/stop", { stop: true }).catch(() => {});
  };

  box.onclick = () => {
    stopAll();
    playClip(pickClip(CLICKS[voice] || CLICKS.ru_f1));
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
        onCleanup(() => {
          for (const off of offs) if (typeof off === "function") off();
        });
      },
    );
  } catch (e) {
  }

  root.destroy = () => {
    clearTimeout(blinkTimer);
    clearTimeout(speakTimer);
    clearInterval(sidePoll);
    clearInterval(bridgeTimer);
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
