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

const { Plugin, Slot, createKeyed, Ipc } = require("@opencode/plugin/gui");
const { createEffect, onCleanup } = require("solid-js");

// Канал main ↔ окно: момент старта wav и ручной выбор персонажа.
// Всё Ipc-хозяйство создаётся лениво и в try/catch: если экспериментальный
// Ipc-API в этой сборке приложения недоступен, спрайт всё равно отрисуется.
let AvatarIpc = null;
let ipcTried = false;

function avatarIpc() {
  if (ipcTried) return AvatarIpc;
  ipcTried = true;
  try {
    const { Schema } = require("effect");
    const VoiceMap = Schema.Record({ key: Schema.String, value: Schema.String });
    AvatarIpc = Ipc.define({
      id: "x2ai-avatar.speaking",
      methods: {
        voices: { output: VoiceMap },
        setVoice: { input: Schema.Struct({ sid: Schema.String, voice: Schema.String }) },
        stop: {},
      },
      events: {
        speaking: Schema.Struct({ ms: Schema.Number }),
        voices: VoiceMap,
      },
    });
  } catch (e) {
    AvatarIpc = null;
  }
  return AvatarIpc;
}

const SPRITES = __SPRITES__;
const CLICKS = __CLICKS__;

const VOICES = ["ru_f1","ru_f2","ru_m1","ru_m5","fx_robot","fx_demon","fx_alien","fx_cat","fx_penguin","fx_ghost"];
const NAMES = {
  ru_f1: "Аня", ru_f2: "Мила", ru_m1: "Гриша", ru_m5: "Тимур",
  fx_robot: "Робик", fx_demon: "Азазель", fx_alien: "Зета",
  fx_cat: "Мурзик", fx_penguin: "Пико", fx_ghost: "Юки",
};
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

function frame(voice, state) {
  const set = SPRITES[voice] || SPRITES.ru_f1;
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

  const apply = (next) => {
    if (!next || next === voice) return;
    voice = next;
    img.src = frame(voice, "closed");
    root.title = `x2ai · ${NAMES[voice] || voice} · ${voice}`;
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
  let currentSid = "";

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
  };

  let ipc = null;
  try {
    const spec = avatarIpc();
    if (!spec) throw new Error("ipc unavailable");
    ipc = ctx.main(spec);
    ipc.on("speaking", (data) => {
      stopClick();
      startSpeaking(data && data.ms > 0 ? data.ms : 9000);
    });
    const adopt = (map) => {
      voiceMap = map || {};
      localMap = loadLocal();
      for (const [sid, value] of Object.entries(voiceMap)) {
        if (sid && typeof value === "string" && !localMap[sid]) localMap[sid] = value;
      }
      applyForSession(currentSid);
    };
    ipc.on("voices", adopt);
    Promise.resolve(ipc.voices())
      .then(adopt)
      .catch(() => {});
  } catch (e) {
  }

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
    if (ipc) {
      try {
        ipc.stop();
      } catch (e) {}
    }
  };

  box.onclick = () => {
    stopAll();
    const list = CLICKS[voice] || CLICKS.ru_f1 || [];
    const item = list.length ? list[Math.floor(Math.random() * list.length)] : null;
    if (item) {
      try {
        clickAudio = new Audio(item.src);
        clickAudio.play();
      } catch (e) {
        clickAudio = null;
      }
    }
    startSpeaking(item && item.ms > 0 ? item.ms : 1200);
  };

  // Правый клик — следующий персонаж вместе с его голосом.
  // Выбор запоминается за текущим чатом, чтобы озвучка говорила тем же голосом.
  box.oncontextmenu = (event) => {
    if (event) event.preventDefault();
    stopAll();
    const index = VOICES.indexOf(voice);
    const next = VOICES[(index + 1) % VOICES.length];
    apply(next);
    saveLocal(currentSid, next);
    if (ipc && currentSid) {
      try {
        ipc.setVoice({ sid: currentSid, voice: next });
      } catch (e) {}
    }
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
    if (String(id).startsWith("ses_")) {
      lastSid = id;
      applyForSession(id);
    }
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
              if (String(id).startsWith("ses_")) {
                lastSid = id;
                applyForSession(id);
              }
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
    if (talkTimer) clearInterval(talkTimer);
    if (typeof unsub === "function") {
      try {
        unsub();
      } catch (e) {}
    }
  };

  return root;
}

function watchTtsState(ctx) {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const net = require("node:net");
  const file = path.join(os.homedir(), ".config/opencode/x2ai-teratts.state");
  const mapFile = path.join(os.homedir(), ".config/opencode/x2ai-voices.json");
  const sockFile = "/tmp/x2ai-teratts.sock";
  const readMap = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(mapFile, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  };
  const writeMap = (map) => {
    try {
      fs.writeFileSync(mapFile, JSON.stringify(map, null, 2) + "\n");
    } catch (e) {}
  };
  const tellTtsStop = () => {
    try {
      const conn = net.connect(sockFile, () => conn.write(JSON.stringify({ stop: true }) + "\n"));
      conn.on("error", () => {});
      conn.on("data", () => conn.end());
      setTimeout(() => conn.destroy(), 700);
    } catch (e) {}
  };
  let last = "";
  let provider = null;
  try {
    const spec = avatarIpc();
    if (!spec) return;
    provider = ctx.provide(spec, {
      voices: () => readMap(),
      setVoice: ({ sid, voice }) => {
        if (!sid || !voice) return;
        const map = readMap();
        map[sid] = voice;
        writeMap(map);
        provider.emit("voices", map);
      },
      stop: () => tellTtsStop(),
    });
  } catch (e) {
    ctx.log.write("error", "x2ai-avatar ipc provide failed: " + e.message);
    return;
  }
  const tick = () => {
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8").trim();
    } catch (e) {
      return;
    }
    if (!raw || raw === last) return;
    last = raw;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (data && data.speaking) provider.emit("speaking", { ms: Number(data.ms) || 9000 });
  };
  tick();
  setInterval(tick, 150);
}

module.exports = Plugin.define({
  main: (ctx) => watchTtsState(ctx),
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
