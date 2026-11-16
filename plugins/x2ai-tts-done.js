// x2ai-tts-done — озвучка ответов ассистента через macOS `say`.
// API: V2 ({ id, setup }) — события только через ctx.event.subscribe().
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");

// Порядок предпочтений: берём первый установленный в системе.
const VOICES = ["Yuri", "Milena"];
// Нейросетевой синтез (piper) звучит заметно лучше системного Milena.
const PIPER = `${process.env.HOME}/.config/opencode/piper-venv/bin/piper`;
const PIPER_DIR = `${process.env.HOME}/.config/opencode/piper-voices`;
const PIPER_VOICE = "irina"; // irina (жен) | dmitri (муж)

// Движок озвучки: teratts (локальный нейросинтез TeraTTSv2) | piper | say | auto.
// auto = teratts, если он установлен, иначе piper, иначе say.
const ENGINE = (process.env.TTS_ENGINE || "auto").toLowerCase();
const TERATTS = `${process.env.HOME}/.config/opencode/x2ai-teratts/x2ai-teratts-speak`;

// Голос TeraTTS: "chat" — свой у каждого чата (детерминированно по sessionID),
// "fixed" — всегда голос из teratts-voice.txt, "random" — новый на каждый ответ.
const VOICE_MODE = (process.env.TTS_VOICE_MODE || "chat").toLowerCase();
const TERA_VOICES = [
  "ru_f1", "ru_f2", "ru_m1", "ru_m5",
  "fx_robot", "fx_demon", "fx_demoness", "fx_alien", "fx_cat", "fx_penguin", "fx_ghost",
];

// Характерные голоса говорят от лица своего персонажа.
const FX_GENDER = {
  fx_robot: "m",
  fx_demon: "m",
  fx_demoness: "f",
  fx_alien: "f",
  fx_cat: "f",
  fx_penguin: "m",
  fx_ghost: "f",
};

function genderOf(voice) {
  if (!voice) return "";
  if (FX_GENDER[voice]) return FX_GENDER[voice];
  if (voice.includes("_f")) return "f";
  if (voice.includes("_m")) return "m";
  return "";
}

// Голос, который реально прозвучит: из режима или из файла teratts-voice.txt.
function effectiveVoice(sid) {
  // Ручной выбор персонажа правым кликом в окне: плагин аватара пишет
  // соответствие sessionID → голос, оно важнее хеша.
  try {
    const map = `${process.env.HOME}/.config/opencode/x2ai-voices.json`;
    if (sid && fs.existsSync(map)) {
      const parsed = JSON.parse(fs.readFileSync(map, "utf8"));
      const picked = parsed && parsed[sid];
      if (picked) return picked;
    }
  } catch (e) {}
  const v = teraVoice(sid);
  if (v) return v;
  try {
    const f = `${process.env.HOME}/.config/opencode/teratts-voice.txt`;
    if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim() || "ru_f1";
  } catch (e) {}
  return "ru_f1";
}

// Согласование рода: «я проверил» ↔ «я проверила», «сам» ↔ «сама».
// \b в JS не работает с кириллицей, поэтому границы заданы явными классами.
const GENDER_WORDS = [
  ["сам", "сама"],
  ["готов", "готова"],
  ["уверен", "уверена"],
  ["прав", "права"],
  ["должен", "должна"],
  ["рад", "рада"],
  ["согласен", "согласна"],
];

// Слово относится к пользователю? Тогда род не трогаем:
// «ты прав», «вы уверены», «тебе должен» — это мужской род по умолчанию.
const PRONOUNS = /(^|[^а-яё])(я|ты|вы|мы|он|она|оно|они|меня|мне|мной|тебя|тебе|тобой|нас|нам|вас|вам|вами)(?![а-яё])/gi;
const SECOND_PERSON = ["ты", "тебя", "тебе", "тобой", "вы", "вас", "вам", "вами"];
function addressedToUser(text, endIndex) {
  // Смотрим только текущее предложение и берём ближайшее местоимение слева:
  // «ты прав и уверен» → прав/уверен относятся к пользователю.
  let before = String(text).slice(0, endIndex);
  const cut = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf("!"),
    before.lastIndexOf("?"),
    before.lastIndexOf("…"),
  );
  if (cut >= 0) before = before.slice(cut + 1);
  let last = null;
  let m;
  PRONOUNS.lastIndex = 0;
  while ((m = PRONOUNS.exec(before))) last = m[2].toLowerCase();
  return last ? SECOND_PERSON.includes(last) : false;
}

// Догоняет глаголы без местоимения в предложении от первого лица:
// «я нашла ошибку и исправил её» → «…и исправила её».
function fixBareVerbs(text, g) {
  const VERB_F = "(ил|ал|ял|ел|ёл|ул|ыл)";
  const VERB_M = "(ила|ала|яла|ела|ёла|ула|ыла|шла)";
  return text.replace(/[^.!?…]+/g, (sent) => {
    if (!/(^|[^а-яё])[Яя](?![а-яё])/.test(sent)) return sent;
    if (g === "f") {
      return sent.replace(
        new RegExp(`([,;:]\\s+|(^|[^а-яё])(?:и|но|а|потом|затем|всё|все|уже|ещё)\\s+)([а-яё]+?)${VERB_F}(?![а-яё])`, "gi"),
        (m, sep, pre, stem, end) => `${sep}${stem}${end === "ёл" ? "ла" : end + "а"}`
      );
    }
    return sent.replace(
      new RegExp(`([,;:]\\s+|(^|[^а-яё])(?:и|но|а|потом|затем|всё|все|уже|ещё)\\s+)([а-яё]+?)${VERB_M}(?![а-яё])`, "gi"),
      (m, sep, pre, stem, end) =>
        `${sep}${stem}${end === "шла" ? "шёл" : end === "ла" && /ш$/.test(stem) ? "ёл" : end.slice(0, -1)}`
    );
  });
}

function agreeGender(text, g) {
  if (!g || !text) return text;
  const PRE = "(^|[^а-яё])";
  const POST = "(?![а-яё])";
  let out = text;
  if (g === "f") {
    out = out
      .replace(new RegExp(`${PRE}([Яя])\\s+([а-яё]*ш)ёл${POST}`, "g"), (m, p, y, s) => `${p}${y} ${s}ла`)
      .replace(new RegExp(`${PRE}([Яя])\\s+([а-яё]+?)лся${POST}`, "g"), (m, p, y, s) => `${p}${y} ${s}лась`)
      .replace(new RegExp(`${PRE}([Яя])\\s+([а-яё]+?)л${POST}`, "g"), (m, p, y, s) => `${p}${y} ${s}ла`);
    out = fixBareVerbs(out, "f");
    for (const [m0, f0] of GENDER_WORDS) {
      out = out.replace(new RegExp(`${PRE}${m0}${POST}`, "gi"), (m, p, off, whole) =>
        addressedToUser(whole, off + p.length) ? m : `${p}${f0}`
      );
    }
  } else {
    out = out
      .replace(new RegExp(`${PRE}([Яя])\\s+([а-яё]*ш)ла${POST}`, "g"), (m, p, y, s) => `${p}${y} ${s}ёл`)
      .replace(new RegExp(`${PRE}([Яя])\\s+([а-яё]+?)лась${POST}`, "g"), (m, p, y, s) => `${p}${y} ${s}лся`)
      .replace(new RegExp(`${PRE}([Яя])\\s+([а-яё]+?)ла${POST}`, "g"), (m, p, y, s) => `${p}${y} ${s}л`);
    out = fixBareVerbs(out, "m");
    for (const [m0, f0] of GENDER_WORDS) {
      out = out.replace(new RegExp(`${PRE}${f0}${POST}`, "gi"), (m, p, off, whole) =>
        addressedToUser(whole, off + p.length) ? m : `${p}${m0}`
      );
    }
  }
  return out;
}

function teraVoice(sid) {
  if (VOICE_MODE === "fixed") return null;
  if (VOICE_MODE === "random") {
    return TERA_VOICES[Math.floor(Math.random() * TERA_VOICES.length)];
  }
  const key = String(sid || "");
  if (!key) return null;
  return TERA_VOICES[Math.abs(Number(hash(key)) | 0) % TERA_VOICES.length];
}

// Пересказ через бесплатную модель OpenCode: без сессии, истории и инструментов.
const SUM_MODEL_DEFAULT = { providerID: "opencode-go", id: "iceman-contributor-free" };
// Провайдеры локального инференса: их модели ставим в начало списка.
const LOCAL_PROVIDERS = /ollama|lmstudio|lm-studio|llamacpp|llama-cpp|vllm|localai|gpt4all|kobold|jan|text-generation-webui|mlx|local/i;
// Модель пересказа меняется в настройках персонажа (панель шестерёнки):
// выбор лежит в x2ai-tts-model.json, иначе берём бесплатную по умолчанию.
const sumModel = () => {
  try {
    const raw = require("node:fs").readFileSync(
      `${process.env.HOME}/.config/opencode/x2ai-tts-model.json`,
      "utf8",
    );
    const value = JSON.parse(raw);
    if (value && value.id && value.providerID) return value;
  } catch (e) {}
  return SUM_MODEL_DEFAULT;
};
const LLM_SUMMARY = true;
const LLM_TIMEOUT = 12000;
let genText = null;
const MAX_CHARS = 400;
const FULL_MAX_CHARS = 4000;
const MIN_CHARS = 15;
const DEBUG = true;

const LOG = `${process.env.HOME}/.config/opencode/x2ai-tts-done.log`;
const MARK = "/tmp/x2ai-tts-done.mark";
// Плагины перезагружаются на каждом шаге хода, поэтому буфер живёт в файле.
const BUF = `${process.env.HOME}/.config/opencode/x2ai-tts-done.buf`;
const BUF_TTL = 10 * 60 * 1000;
const OFF_FILE = `${process.env.HOME}/.config/opencode/x2ai-tts-done.disabled`;

// Режим озвучки ответа: full (читать целиком) | summary (пересказ) | silent (молчать).
// Файл общий с панелью персонажа, поэтому читаем его на каждый ответ.
const SPEECH_FILE = `${process.env.HOME}/.config/opencode/x2ai-speech.json`;
const SPEECH_MODES = ["full", "summary", "silent"];
function readSpeech() {
  try {
    const value = JSON.parse(fs.readFileSync(SPEECH_FILE, "utf8"));
    const mode = value && typeof value.mode === "string" ? value.mode : "";
    return SPEECH_MODES.includes(mode) ? mode : "summary";
  } catch (e) {
    return "summary";
  }
}

// Держать движок в памяти (true) или поднимать на каждую фразу (false).
function readKeepAlive() {
  try {
    const raw = JSON.parse(fs.readFileSync(SPEECH_FILE, "utf8"));
    return raw && raw.keepAlive === false ? false : true;
  } catch (e) {
    return true;
  }
}

function readSpeed() {
  try {
    const raw = JSON.parse(fs.readFileSync(SPEECH_FILE, "utf8"));
    const v = Number(raw && raw.speed);
    if (Number.isFinite(v) && v >= 0.7 && v <= 1.8) return v;
  } catch (e) {}
  return 1.0;
}

// Тихие часы: в этом окне озвучка не запускается сама (режим остаётся прежним).
const QUIET_DEFAULT = { on: false, from: "23:00", to: "09:00" };
function validTime(v) {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
function readQuiet() {
  try {
    const raw = JSON.parse(fs.readFileSync(SPEECH_FILE, "utf8"));
    const q = raw && raw.quiet;
    if (!q || typeof q !== "object") return { ...QUIET_DEFAULT };
    return {
      on: Boolean(q.on),
      from: validTime(q.from) ? q.from : QUIET_DEFAULT.from,
      to: validTime(q.to) ? q.to : QUIET_DEFAULT.to,
    };
  } catch (e) {
    return { ...QUIET_DEFAULT };
  }
}
// Озвучка рассуждений: off | brief | full, плюс перевод на русский.
const REASON_MODES = ["off", "brief", "full"];
const REASON_DEFAULT = { mode: "off", translate: true };
function readReason() {
  try {
    const raw = JSON.parse(fs.readFileSync(SPEECH_FILE, "utf8"));
    const r = raw && raw.reason;
    if (!r || typeof r !== "object") return { ...REASON_DEFAULT };
    return {
      mode: REASON_MODES.includes(r.mode) ? r.mode : REASON_DEFAULT.mode,
      translate: r.translate === undefined ? REASON_DEFAULT.translate : Boolean(r.translate),
    };
  } catch (e) {
    return { ...REASON_DEFAULT };
  }
}

function inQuietHours() {
  const q = readQuiet();
  if (!q.on) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [fh, fm] = q.from.split(":").map(Number);
  const [th, tm] = q.to.split(":").map(Number);
  const from = fh * 60 + fm;
  const to = th * 60 + tm;
  if (from === to) return false;
  return from < to ? cur >= from && cur < to : cur >= from || cur < to;
}

// Обращение к пользователю: имя (может быть пустым) и род (m | f | "" — не указан).
const USER_FILE = `${process.env.HOME}/.config/opencode/x2ai-user.json`;
function readUser() {
  try {
    const raw = JSON.parse(fs.readFileSync(USER_FILE, "utf8"));
    const name = typeof raw?.name === "string" ? raw.name.trim().slice(0, 40) : "";
    const gender = raw?.gender === "m" || raw?.gender === "f" ? raw.gender : "";
    return { name, gender };
  } catch (e) {
    return { name: "", gender: "" };
  }
}

// Конец хода: эти события реально присылает десктопный сервис.
const TRIGGERS = new Set(["session.execution.succeeded", "session.execution.interrupted"]);
const FAILS = new Set(["session.execution.failed", "session.execution.error", "session.execution.errored"]);

function enabled() {
  if (process.env.TTS_DONE === "0") return false;
  try {
    if (fs.existsSync(OFF_FILE)) return false;
  } catch (e) {}
  return true;
}

function log(...args) {
  if (!DEBUG) return;
  try {
    const line = `[${new Date().toISOString()}] ${args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch (e) {
          return String(a);
        }
      })
      .join(" ")}\n`;
    fs.appendFileSync(LOG, line);
  } catch (e) {}
}

// Вместо кода и ссылок вслух говорим, где их смотреть.
const CODE_PHRASES = [
  "Код смотри в текстовом варианте ответа.",
  "Код есть в тексте ответа.",
  "Пример кода оставил в текстовом ответе.",
  "Код — в текстовом варианте.",
];
const LINK_PHRASES = [
  "Ссылку смотри в текстовом варианте ответа.",
  "Ссылка есть в тексте ответа.",
  "Ссылку оставил в текстовом ответе.",
  "Адрес ссылки — в текстовом варианте.",
];
const pickPhrase = (list) => list[Math.floor(Math.random() * list.length)];

// Заменяет код и ссылки на короткие фразы — до общей чистки.
function decorate(text) {
  if (!text) return "";
  let t = String(text);
  let saidCode = false;
  let saidLink = false;
  t = t.replace(/```[\s\S]*?```/g, () => {
    if (saidCode) return " ";
    saidCode = true;
    return ` ${pickPhrase(CODE_PHRASES)} `;
  });
  t = t.replace(/`[^`]+`/g, () => {
    if (saidCode) return " ";
    saidCode = true;
    return ` ${pickPhrase(CODE_PHRASES)} `;
  });
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (m, label) => {
    if (saidLink) return ` ${label} `;
    saidLink = true;
    return ` ${label} — ${pickPhrase(LINK_PHRASES)} `;
  });
  t = t.replace(/https?:\/\/\S+/g, () => {
    if (saidLink) return " ";
    saidLink = true;
    return ` ${pickPhrase(LINK_PHRASES)} `;
  });
  return t;
}

function stripCode(text) {
  if (!text) return "";
  let t = text;
  // Теги и всё их содержимое — вон: это разметка, а не речь.
  const BLOCK_TAGS =
    "code|pre|script|style|details|summary|tool|tools|tool_call|file|files|path|bash|command|cmd|output|result|json|xml|html|patch|diff|thinking|reasoning|system|context|antml";
  t = t.replace(new RegExp(`<(${BLOCK_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), " ");
  t = t.replace(new RegExp(`<(${BLOCK_TAGS})\\b[^>]*/>`, "gi"), " ");
  t = t.replace(/<\/?[a-z][\w:.-]*\b[^>]*>/gi, " ");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`[^`]+`/g, " ");
  t = t.replace(/^([+-].*)$/gm, " ");
  t = t.replace(/\b[\w./-]+:\d+\b/g, " ");
  t = t.replace(/https?:\/\/\S+/g, " ");
  t = t.replace(/(^|\s)[~/][\w./-]+/g, " ");
  t = t.replace(/\b[\w-]+\/[\w./-]+\.\w{1,5}\b/g, " ");
  t = t.replace(/\b[a-f0-9]{8,}\b/gi, " ");
  t = t.replace(/\b\w+_\w+\b/g, " ");
  t = t.replace(/^\$\s+.*/gm, " ");
  t = t.replace(/[{}\[\]();=<>|\\*#_~^]/g, " ");
  t = t.replace(/\s+([,.!?;:])/g, "$1");
  t = t.replace(/([,.!?;:])(?:\s*[,.!?;:])+/g, "$1");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

let voiceCache;

// `say -v Yuri` без установленного голоса молча падает — выбираем существующий.
function pickVoice() {
  if (voiceCache !== undefined) return voiceCache;
  try {
    const out = spawnSync("say", ["-v", "?"], { encoding: "utf8" });
    const list = String(out.stdout || "");
    voiceCache = VOICES.find((v) => new RegExp(`^${v}\\s`, "m").test(list)) || null;
  } catch (e) {
    voiceCache = null;
  }
  log("VOICE:", voiceCache || "system default");
  return voiceCache;
}

// Доля кириллицы среди букв: нужно, чтобы не читать английский английским голосом.
function cyrRatio(text) {
  const letters = String(text).match(/[A-Za-zА-Яа-яЁё]/g) || [];
  if (!letters.length) return 0;
  let cyr = 0;
  for (const c of letters) if (/[А-Яа-яЁё]/.test(c)) cyr++;
  return cyr / letters.length;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return String(h);
}

// Несколько копий плагина подписаны на один поток событий — озвучиваем один раз.
function alreadySpoken(key) {
  try {
    const raw = fs.readFileSync(MARK, "utf8").split("\n");
    if (raw[1] === key && Date.now() - Number(raw[0]) < 30000) return true;
  } catch (e) {}
  try {
    fs.writeFileSync(MARK, `${Date.now()}\n${key}`);
  } catch (e) {}
  return false;
}

function readBuf() {
  try {
    return JSON.parse(fs.readFileSync(BUF, "utf8"));
  } catch (e) {
    return {};
  }
}

function bufAdd(sid, text) {
  const all = readBuf();
  const e = all[sid] || { text: "", at: 0, seen: {} };
  const now = Date.now();
  const h = hash(text);
  const seen = e.seen || {};
  for (const k of Object.keys(seen)) if (now - seen[k] > 60000) delete seen[k];
  if (seen[h]) return; // эта часть уже добавлена другой копией плагина
  seen[h] = now;
  all[sid] = { text: `${e.text} ${text}`.slice(-8000), at: now, seen };
  try {
    fs.writeFileSync(BUF, JSON.stringify(all));
  } catch (err) {}
}

function bufTake(sid) {
  const all = readBuf();
  const entry = all[sid];
  if (!entry) return "";
  delete all[sid];
  try {
    fs.writeFileSync(BUF, JSON.stringify(all));
  } catch (e) {}
  if (Date.now() - Number(entry.at || 0) > BUF_TTL) return "";
  return typeof entry.text === "string" ? entry.text : "";
}

function piperModel() {
  const model = `${PIPER_DIR}/ru_RU-${PIPER_VOICE}-medium.onnx`;
  try {
    if (fs.existsSync(PIPER) && fs.existsSync(model)) return model;
  } catch (e) {}
  return null;
}

function speakSay(text) {
  const voice = pickVoice();
  const args = voice ? ["-v", voice, text] : [text];
  try {
    const p = spawn("say", args, { stdio: "ignore", detached: true });
    p.on("error", (err) => log("SAY_ERR", err?.message));
    p.unref();
  } catch (e) {
    log("SAY_CATCH", e?.message);
  }
}

function speakPiper(text, model) {
  const wav = `/tmp/x2ai-tts-done-${process.pid}-${Date.now()}.wav`;
  try {
    const p = spawn(PIPER, ["-m", model, "-f", wav], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: true,
    });
    p.on("error", (e) => {
      log("PIPER_ERR", e?.message);
      speakSay(text);
    });
    p.on("close", (code) => {
      if (code !== 0) {
        log("PIPER_EXIT", code);
        return speakSay(text);
      }
      const a = spawn("sh", ["-c", `afplay '${wav}'; rm -f '${wav}'`], {
        stdio: "ignore",
        detached: true,
      });
      a.on("error", (e) => log("AFPLAY_ERR", e?.message));
      a.unref();
    });
    p.stdin.on("error", () => {});
    p.stdin.write(text);
    p.stdin.end();
    p.unref();
  } catch (e) {
    log("PIPER_CATCH", e?.message);
    speakSay(text);
  }
}

// Отбираем только «человеческие» строки: без таблиц, заголовков, кода, путей.
function proseLines(raw) {
  const out = [];
  let inFence = false;
  for (const line of String(raw).split("\n")) {
    const t = line.trim();
    if (t.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !t) continue;
    if (t.startsWith("|") || /^#{1,6}\s/.test(t) || /^-{3,}$/.test(t)) continue;
    if (/^[-*+]\s/.test(t)) {
      const body = t.replace(/^[-*+]\s+/, "");
      if (/[<>{}`]|\.(js|ts|css|json|md|html)\b|\d{2,}/.test(body)) continue;
      out.push(body);
      continue;
    }
    out.push(t);
  }
  return out;
}

// Короткий пересказ без LLM: первые 2–3 «нормальных» предложения.
function summarize(raw) {
  const cand = [];
  for (const line of proseLines(raw)) {
    for (const s of line.split(/(?<=[.!?…])\s+/)) {
      const t = s.trim();
      if (t.length < 25 || t.length > 240) continue;
      if (/[`<>{}|_=/*\\]/.test(t)) continue;
      if (/\b\w+:\d+\b/.test(t)) continue;
      if (/\d/.test(t) && (t.match(/\d/g) || []).length / t.length > 0.06) continue;
      if (!/^[A-ZА-ЯЁ]/.test(t)) continue;
      if (cyrRatio(t) < 0.5) continue;
      cand.push(t);
      if (cand.length >= 3) break;
    }
    if (cand.length >= 3) break;
  }
  let out = "";
  for (const s of cand) {
    if (`${out} ${s}`.trim().length > 330) break;
    out = `${out} ${s}`.trim();
  }
  return out;
}

// Убирает повторы и почти-повторы предложений.
function dedupeSentences(text, maxSentences = 3) {
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const out = [];
  const norms = [];
  for (const raw of String(text).split(/(?<=[.!?…])\s+/)) {
    const s = raw.trim();
    const n = norm(s);
    if (n.length < 3) continue;
    const dup = norms.some((on) => on === n || on.includes(n) || n.includes(on));
    if (!dup) {
      out.push(s);
      norms.push(n);
    }
    if (out.length >= maxSentences) break;
  }
  return out.join(" ");
}

// Если модель ответила не по-русски — один раз просим перевод.
async function translateRu(text) {
  if (!genText) return "";
  try {
    const out = await Promise.race([
      genText({
        model: sumModel(),
        prompt: `Переведи на русский язык, сохранив смысл. Только перевод, без пояснений:\n\n${text.slice(0, 3000)}`,
      }),
      new Promise((r) => setTimeout(() => r(null), LLM_TIMEOUT)),
    ]);
    const t = String(out?.text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (cyrRatio(t) < 0.5) {
      log("TR: still not russian");
      return "";
    }
    log("TR:", t.slice(0, 100));
    return t;
  } catch (e) {
    log("TR_ERR", e?.message);
    return "";
  }
}

// Когда звать пользователя по имени: первое сообщение в чате — всегда,
// дальше пауза 4–6 пересказов без имени и не чаще одного раза в 10 минут.
const NAME_GAP_MIN = 4;
const NAME_GAP_MAX = 6;
const NAME_COOLDOWN_MS = 10 * 60 * 1000;
const nameGreeted = new Set();
let nameSkip = 0;
let nameLastAt = 0;

function shouldUseName(sid) {
  const now = Date.now();
  if (sid && !nameGreeted.has(sid)) {
    nameGreeted.add(sid);
    nameSkip = NAME_GAP_MIN + Math.floor(Math.random() * (NAME_GAP_MAX - NAME_GAP_MIN + 1));
    nameLastAt = now;
    return true;
  }
  if (nameSkip > 0) {
    nameSkip--;
    return false;
  }
  if (now - nameLastAt < NAME_COOLDOWN_MS) return false;
  nameSkip = NAME_GAP_MIN + Math.floor(Math.random() * (NAME_GAP_MAX - NAME_GAP_MIN + 1));
  nameLastAt = now;
  return true;
}

// Имя в рассуждениях: свой счётчик, отдельный от пересказа ответа.
const R_NAME_GAP_MIN = 5;
const R_NAME_GAP_MAX = 8;
const R_NAME_COOLDOWN_MS = 10 * 60 * 1000;
const reasonNameSkip = { left: 0 };
let reasonNameLastAt = 0;

function shouldUseReasonName() {
  const now = Date.now();
  if (reasonNameSkip.left > 0) {
    reasonNameSkip.left--;
    return false;
  }
  if (now - reasonNameLastAt < R_NAME_COOLDOWN_MS) return false;
  reasonNameSkip.left = R_NAME_GAP_MIN + Math.floor(Math.random() * (R_NAME_GAP_MAX - R_NAME_GAP_MIN + 1));
  reasonNameLastAt = now;
  return true;
}

// Пересказ моделью (бесплатной, без сессии). Пустая строка = не получилось.
async function llmSummary(raw, gender, user = readUser(), sid = "", style = "") {
  if (!LLM_SUMMARY || !genText) return "";
  const src = stripCode(raw).slice(0, 6000).trim();
  if (src.length < 40) return "";
  // Род ассистента (голос) и род пользователя — разные вещи: первый про «я», второй про «ты».
  const userName = (user && user.name) || "";
  const userGender = (user && user.gender) || "";
  const ABOUT_USER =
    userGender === "f"
      ? "Пользователь — женщина. Обращаясь к ней, используй женский род: «ты проверила», «ты попросила», «ты права», «ты уверена»."
      : userGender === "m"
        ? "Пользователь — мужчина. Обращаясь к нему, используй мужской род: «ты проверил», «ты попросил», «ты прав», «ты уверен»."
        : "Род пользователя не указан: обращайся к нему нейтрально, избегая форм прошедшего времени во втором лице.";
  const useName = Boolean(userName) && shouldUseName(sid);
  if (userName) log("NAME:", useName ? "yes" : "no");
  const NAME_RULE = useName
    ? `Один раз, в самом начале, обратись к пользователю по имени: ${userName}. Дальше имя не повторяй.`
    : "Не называй пользователя по имени, обращайся без него.";
  const GENDER_RULE = {
    f: `Пиши от лица ассистента. О себе (первое лицо, «я») говори в женском роде: «я проверила», «я сделала», «я нашла», «я уверена». Всегда ставь местоимение «я» перед таким глаголом: «я оставила имя», а не «оставил имя». ${ABOUT_USER}`,
    m: `Пиши от лица ассистента. О себе (первое лицо, «я») говори в мужском роде: «я проверил», «я сделал», «я нашёл», «я уверен». Всегда ставь местоимение «я» перед таким глаголом: «я оставил имя», а не «оставила имя». ${ABOUT_USER}`,
  };
  const BRIEF_RULE =
    style === "long"
      ? "Текст длинный: оставь только итог — 1–2 коротких предложения, без перечислений деталей."
      : "";
  const prompt = [
    "Сожми текст в 1–3 коротких предложения по-русски для озвучки вслух.",
    "Код, команды, пути к файлам, имена переменных и ссылки не произноси — только суть.",
    "Только суть: что сделано и зачем это нужно. Без путей, имён файлов, команд, кода, цифр, markdown и списков.",
    "Пиши связной прозой, без вступлений вроде «в этом ответе».",
    "Пиши только по-русски. Английские слова и термины переводи, латиницу оставляй только в крайнем случае.",
    "Каждое предложение — новая мысль. Не повторяй одну и ту же фразу разными словами.",
    GENDER_RULE[gender] ||
      `Пиши безлично или в третьем лице, избегая форм прошедшего времени от первого лица. ${ABOUT_USER}`,
    ...(NAME_RULE ? [NAME_RULE] : []),
    ...(BRIEF_RULE ? [BRIEF_RULE] : []),
    "",
    src,
  ].join("\n");
  try {
    const out = await Promise.race([
      genText({ model: sumModel(), prompt }),
      new Promise((r) => setTimeout(() => r(null), LLM_TIMEOUT)),
    ]);
    let text = String(out?.text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      log("LLM: empty");
      return "";
    }
    if (cyrRatio(text) < 0.5) {
      log("LLM: not russian, translating");
      const ru = await translateRu(text);
      if (!ru) return "";
      text = ru;
    }
    log("LLM:", text.slice(0, 120));
    return dedupeSentences(text).slice(0, 400);
  } catch (e) {
    log("LLM_ERR", e?.message);
    return "";
  }
}

// Рассуждения модели: одним запросом — перевод (если нужно) и сжатие (если «кратко»).
async function llmReason(raw, gender, translate, sid, user = readUser()) {
  if (!genText) return "";
  const src = stripCode(String(raw || "")).replace(/\s+/g, " ").trim().slice(0, 6000);
  if (src.length < 30) return "";
  const task = translate
    ? "Переведи рассуждение модели на русский и сожми его в 1–2 коротких предложения для озвучки вслух."
    : "Сожми рассуждение модели в 1–2 коротких предложения по-русски для озвучки вслух.";
  const style =
    gender === "f"
      ? "О себе говори в женском роде: «я проверила», «я подумала», всегда с местоимением «я»."
      : gender === "m"
        ? "О себе говори в мужском роде: «я проверил», «я подумал», всегда с местоимением «я»."
        : "Пиши безлично.";
  const userGender = (user && user.gender) || "";
  const aboutUser =
    userGender === "f"
      ? "Если упоминаешь пользователя, говори о ней в женском роде: «ты попросила», «ты права»."
      : userGender === "m"
        ? "Если упоминаешь пользователя, говори о нём в мужском роде: «ты попросил», «ты прав»."
        : "Если упоминаешь пользователя, говори нейтрально, без форм прошедшего времени во втором лице.";
  const userName = (user && user.name) || "";
  const useName = Boolean(userName) && shouldUseReasonName();
  const nameRule = userName
    ? `Где речь о пользователе, называй его по имени: ${userName} (вместо слов «пользователь», «user»), один раз и с правильным родом.`
    : "Слова «user» и «пользователь» заменяй на «пользователь» только по-русски, без английских вставок.";
  const prompt = [
    task,
    "Без вступлений вроде «вот краткое содержание». Только суть.",
    "Весь ответ — только по-русски: никаких английских слов и обрывков вроде «user asks».",
    "Код, команды и пути к файлам не произноси.",
    style,
    aboutUser,
    ...(nameRule ? [nameRule] : []),
    "Текст:",
    src,
  ].join("\n");
  if (userName) log("R_NAME:", useName ? "yes" : "no");
  try {
    const out = await Promise.race([
      genText({ model: sumModel(), prompt }),
      new Promise((r) => setTimeout(() => r(null), Math.max(LLM_TIMEOUT, 25000))),
    ]);
    let text = String(out?.text || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    // Модель иногда оставляет английские обрывки — добиваем переводом.
    if (/[A-Za-z]{2,}/.test(text) && cyrRatio(text) < 0.9) {
      log("REASON: latin left, translating");
      const ru = await translateRu(text);
      if (ru) text = ru;
    }
    if (userName && /\b(user|пользователь)\b/i.test(text)) {
      text = text.replace(/\b(user|пользователь)\b/gi, userName);
    }
    log("REASON_LLM:", text.slice(0, 120));
    return text.slice(0, 400);
  } catch (e) {
    log("REASON_ERR", e?.message);
    return "";
  }
}

// Дедуп рассуждений: одна и та же мысль не читается дважды.
// Файл общий для всех копий плагина — иначе каждая читает своё.
const reasonSeen = new Map();
const REASON_MARK = "/tmp/x2ai-reason.mark";

function reasonSpokenRecently(key) {
  try {
    const raw = fs.readFileSync(REASON_MARK, "utf8").split("\n");
    return raw[1] === key && Date.now() - Number(raw[0]) < 180000;
  } catch (e) {
    return false;
  }
}

function markReasonSpoken(key) {
  try {
    fs.writeFileSync(REASON_MARK, `${Date.now()}\n${key}`);
  } catch (e) {}
}

// Озвучка рассуждений: вызывается после паузы в потоке, чтобы не перечитывать куски.
const reasonTimers = new Map();

async function speakReason(rsid, rtext) {
  const reason = readReason();
  if (reason.mode === "off") return;
  if (readSpeech() === "silent" || inQuietHours()) {
    log("SKIP: reason muted");
    return;
  }
  const norm = String(rtext).replace(/\s+/g, " ").trim().slice(0, 400);
  const rkey = hash(norm);
  if (reasonSpokenRecently(rkey) || Date.now() - (reasonSeen.get(rkey) || 0) < 180000) {
    log("SKIP: reason duplicate");
    return;
  }
  const rvoice = effectiveVoice(rsid);
  const rgender = genderOf(rvoice);
  let out = "";
  if (reason.mode === "brief") {
    out = (await llmReason(rtext, rgender, reason.translate, rsid)) || summarize(rtext) || "";
  } else if (reason.translate) {
    out = (await translateRu(rtext.slice(0, 3000))) || "";
  }
  // Модель не ответила: пробуем хотя бы перевод, иначе читаем очищенный исходник.
  if (!out && reason.translate) {
    out = (await translateRu(stripCode(rtext).slice(0, 1500))) || "";
    if (out) log("REASON: fallback translate");
  }
  if (!out) out = stripCode(rtext).slice(0, reason.mode === "brief" ? 300 : 1200);
  out = agreeGender(out, rgender).trim();
  if (!out) {
    log("SKIP: reason empty");
    return;
  }
  reasonSeen.set(rkey, Date.now());
  markReasonSpoken(rkey);
  if (reasonSeen.size > 500) reasonSeen.clear();
  log("REASON:", rsid, reason.mode, reason.translate ? "tr" : "-", out.length);
  speak(out, rsid, rvoice, reason.mode === "brief" ? MAX_CHARS : FULL_MAX_CHARS, "think", "reason");
}

function speakTera(text, sid, forced, emotion, kind) {
  try {
    if (!fs.existsSync(TERATTS)) return false;
  } catch (e) {
    return false;
  }
  try {
    const voice = forced || teraVoice(sid);
    const env = { ...process.env };
    if (voice) env.X2AI_TTS_VOICE = voice;
    if (sid) env.X2AI_TTS_SID = sid;
    env.X2AI_TTS_SCALE = String(readSpeed());
    if (emotion) env.X2AI_TTS_EMOTION = emotion;
    else delete env.X2AI_TTS_EMOTION;
    if (kind) env.X2AI_TTS_KIND = kind;
    else delete env.X2AI_TTS_KIND;
    if (readKeepAlive()) delete env.X2AI_TTS_ONESHOT;
    else env.X2AI_TTS_ONESHOT = "1";
    delete env.X2AI_TTS_TEXT;
    log("TERA_VOICE:", voice || "(default)", sid || "", emotion ? `emotion=${emotion}` : "");
    const p = spawn(TERATTS, [], { stdio: ["pipe", "ignore", "ignore"], detached: true, env });
    p.on("error", (e) => log("TERA_ERR", e?.message));
    p.on("close", (code) => log("TERA_EXIT", code));
    p.stdin.on("error", () => {});
    p.stdin.write(text);
    p.stdin.end();
    p.unref();
    return true;
  } catch (e) {
    log("TERA_CATCH", e?.message);
    return false;
  }
}

// Последняя озвученная фраза — для кнопки «Повторить».
let lastSpeak = null;

function speak(text, sid, voice, maxChars = MAX_CHARS, emotion = null, kind = null) {
  const limit = Math.max(maxChars || MAX_CHARS, MAX_CHARS);
  let toSay = decorate(text);
  if (toSay.length > limit) {
    const cut = toSay.slice(0, limit);
    const m = cut.match(/[\s\S]*[.!?…]/);
    toSay = m ? m[0] : cut;
  }
  toSay = stripCode(toSay).replace(/\s+/g, " ").trim();
  if (!toSay) return;
  lastSpeak = { text: toSay, sid: sid || "", voice: voice || "", max: limit, emotion, kind };
  log("SPEAK:", toSay.slice(0, 100));
  if (ENGINE === "say") return speakSay(toSay);
  if (ENGINE === "teratts" || ENGINE === "auto") {
    if (speakTera(toSay, sid, voice, emotion, kind)) return;
    if (ENGINE === "teratts") {
      log("TERA: unavailable, fallback piper");
    }
  }
  const model = piperModel();
  if (model) return speakPiper(toSay, model);
  return speakSay(toSay);
}


// HTTP-мост для окна (плагин x2ai-avatar). Ipc в Desktop-плагинах этой сборки
// недоступен, поэтому окно просто опрашивает 127.0.0.1:47821.
//   GET  /state  -> { speaking, ms, voices }
//   POST /voice  -> { sid, voice }  (ручной выбор персонажа правым кликом)
//   POST /stop   -> заглушить текущую озвучку
function startBridge(ctx) {
  // После перезагрузки плагина старый сервер остаётся жить на порту и держит
  // СТАРЫЙ код обработчиков. Закрываем его и поднимаем новый.
  if (globalThis.__x2aiBridge) {
    try {
      globalThis.__x2aiBridge.close();
    } catch (e) {}
    globalThis.__x2aiBridge = null;
  }
  let http;
  try {
    http = require("node:http");
  } catch (e) {
    return null;
  }
  const port = Number(process.env.X2AI_BRIDGE_PORT || 47821);
  const stateFile = `${process.env.HOME}/.config/opencode/x2ai-teratts.state`;
  const voicesFile = `${process.env.HOME}/.config/opencode/x2ai-voices.json`;
  const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "content-type": "application/json",
  };
  // Кэш чтения состояния: окно опрашивает /state несколько раз в секунду,
  // а файл меняется редко — незачем дёргать диск на каждый запрос.
  const jsonCache = new Map();
  const readJson = (file) => {
    const now = Date.now();
    const hit = jsonCache.get(file);
    if (hit && now - hit.at < 150) return hit.value;
    let value = null;
    try {
      value = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      value = null;
    }
    jsonCache.set(file, { at: now, value });
    if (jsonCache.size > 12) jsonCache.clear();
    return value;
  };
  const readVoices = () => {
    const value = readJson(voicesFile);
    return value && typeof value === "object" ? value : {};
  };
  const charVoicesFile = `${process.env.HOME}/.config/opencode/x2ai-char-voices.json`;
  const readCharVoices = () => {
    const value = readJson(charVoicesFile);
    return value && typeof value === "object" ? value : {};
  };
  // Голоса, которые умеет TeraTTS: 4 спикера и 6 эффектов поверх них.
  const VOICE_LIST = [
    { id: "ru_f1", label: "Аня — женский", kind: "voice" },
    { id: "ru_f2", label: "Мила — женский, ниже", kind: "voice" },
    { id: "ru_m1", label: "Гриша — мужской", kind: "voice" },
    { id: "ru_m5", label: "Тимур — мужской, ниже", kind: "voice" },
    { id: "fx_robot", label: "Робот — кольцевая модуляция", kind: "effect" },
    { id: "fx_demon", label: "Демон — мужской, питч вниз", kind: "effect" },
    { id: "fx_demoness", label: "Демонесса — женский, низкий, хриплый", kind: "effect" },
    { id: "fx_alien", label: "Пришелец — вибрато", kind: "effect" },
    { id: "fx_cat", label: "Кот — питч вверх", kind: "effect" },
    { id: "fx_penguin", label: "Пришелец — высокий писк", kind: "effect" },
    { id: "fx_ghost", label: "Призрак — реверб", kind: "effect" },
  ];
  const send = (res, code, payload) => {
    res.writeHead(code, CORS);
    res.end(JSON.stringify(payload));
  };
  const modelFile = `${process.env.HOME}/.config/opencode/x2ai-tts-model.json`;
  const readModel = () => {
    const value = readJson(modelFile);
    return value && value.id ? value : null;
  };
  const listModels = async () => {
    try {
      const raw = await ctx.model.list();
      const data = raw && raw.data ? raw.data : raw;
      const items = Array.isArray(data) ? data : (data && (data.models || data.items)) || [];
      const models = [];
      for (const m of items) {
        if (!m || !m.id) continue;
        if (m.type && m.type !== "chat") continue;
        if (m.enabled === false || (m.status && m.status !== "active")) continue;
        const cost = (Array.isArray(m.cost) ? m.cost[0] : m.cost) || {};
        const input = Number(cost.input) || 0;
        const output = Number(cost.output) || 0;
        const provider = String(m.providerID || m.provider || "");
        models.push({
          providerID: provider,
          id: m.modelID || m.id,
          name: m.name || m.modelID || m.id,
          free: input === 0 && output === 0,
          local: Boolean(m.local) || LOCAL_PROVIDERS.test(provider),
        });
      }
      // Локальные — первыми, затем бесплатные, затем платные.
      const rank = (m) => (m.local ? 0 : m.free ? 1 : 2);
      models.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru"));
      return { models, source: "model.list" };
    } catch (e) {
      return { models: [], source: "error", error: e && e.message ? e.message : String(e) };
    }
  };

  const stopTts = () => {
    try {
      const net = require("node:net");
      const socket = net.createConnection("/tmp/x2ai-teratts.sock");
      socket.on("error", () => {});
      socket.end(JSON.stringify({ stop: true }) + "\n");
    } catch (e) {}
  };

  const server = http.createServer((req, res) => {
    const route = String(req.url || "/").split("?")[0];
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method === "GET" && route === "/state") {
      const state = readJson(stateFile) || {};
      const total = Number(state.ms) || 0;
      const at = Number(state.at) || 0;
      const left = Math.max(0, Math.round(at * 1000 + total - Date.now()));
      send(res, 200, {
        speaking: left > 0,
        ms: left,
        sid: state.sid || "",
        kind: state.kind || "",
        voices: readVoices(),
        charVoices: readCharVoices(),
      });
      return;
    }
    if (req.method === "GET" && route === "/voices") {
      send(res, 200, { voices: VOICE_LIST, charVoices: readCharVoices() });
      return;
    }
    if (req.method === "GET" && route === "/speech") {
      send(res, 200, {
        mode: readSpeech(),
        modes: SPEECH_MODES,
        speed: readSpeed(),
        quiet: readQuiet(),
        reason: readReason(),
        keepAlive: readKeepAlive(),
      });
      return;
    }
    if (req.method === "GET" && route === "/user") {
      send(res, 200, { user: readUser() });
      return;
    }
    if (req.method === "GET" && route === "/models") {
      listModels()
        .then((out) => send(res, 200, { ...out, current: readModel() || SUM_MODEL_DEFAULT }))
        .catch(() => send(res, 200, { models: [], source: "error", current: readModel() || SUM_MODEL_DEFAULT }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch (e) {}
      if (req.method === "POST" && route === "/voice") {
        if (payload.sid && payload.voice) {
          const map = readVoices();
          map[payload.sid] = payload.voice;
          try {
            fs.writeFileSync(voicesFile, JSON.stringify(map, null, 2));
          } catch (e) {}
        }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && route === "/charvoice") {
        if (payload.charId) {
          const map = readCharVoices();
          if (payload.voice) map[payload.charId] = payload.voice;
          else delete map[payload.charId];
          try {
            fs.writeFileSync(charVoicesFile, JSON.stringify(map, null, 2));
          } catch (e) {}
        }
        send(res, 200, { ok: true, charVoices: readCharVoices() });
        return;
      }
      if (req.method === "POST" && route === "/model") {
        if (payload.providerID && payload.id) {
          try {
            fs.writeFileSync(
              modelFile,
              JSON.stringify({ providerID: payload.providerID, id: payload.id }, null, 2),
            );
          } catch (e) {}
        }
        send(res, 200, { ok: true, current: readModel() || SUM_MODEL_DEFAULT });
        return;
      }
      if (req.method === "POST" && route === "/user") {
        const next = readUser();
        if (typeof payload.name === "string") {
          next.name = payload.name.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
        }
        if (payload.gender === "m" || payload.gender === "f" || payload.gender === "") {
          next.gender = payload.gender;
        }
        try {
          fs.writeFileSync(USER_FILE, JSON.stringify(next, null, 2));
        } catch (e) {
          log("USER_WRITE_ERR", e?.message);
        }
        send(res, 200, { ok: true, user: readUser() });
        return;
      }
      if (req.method === "POST" && route === "/speech") {
        const next = {
          mode: readSpeech(),
          speed: readSpeed(),
          quiet: readQuiet(),
          reason: readReason(),
          keepAlive: readKeepAlive(),
        };
        if (SPEECH_MODES.includes(payload.mode)) next.mode = payload.mode;
        const sp = Number(payload.speed);
        if (Number.isFinite(sp) && sp >= 0.7 && sp <= 1.8) {
          next.speed = Math.round(sp * 100) / 100;
        }
        if (payload.keepAlive !== undefined) next.keepAlive = Boolean(payload.keepAlive);
        if (payload.reason && typeof payload.reason === "object") {
          const cur = next.reason || readReason();
          next.reason = {
            mode: REASON_MODES.includes(payload.reason.mode) ? payload.reason.mode : cur.mode,
            translate:
              payload.reason.translate === undefined ? cur.translate : Boolean(payload.reason.translate),
          };
        }
        if (payload.quiet && typeof payload.quiet === "object") {
          next.quiet = {
            on: Boolean(payload.quiet.on),
            from: validTime(payload.quiet.from) ? payload.quiet.from : next.quiet.from,
            to: validTime(payload.quiet.to) ? payload.quiet.to : next.quiet.to,
          };
        }
        try {
          fs.writeFileSync(SPEECH_FILE, JSON.stringify(next, null, 2));
        } catch (e) {
          log("SPEECH_WRITE_ERR", String(e));
        }
        send(res, 200, {
          ok: true,
          mode: readSpeech(),
          speed: readSpeed(),
          quiet: readQuiet(),
          reason: readReason(),
          keepAlive: readKeepAlive(),
        });
        return;
      }
      if (req.method === "POST" && route === "/say") {
        const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 400) : "";
        if (!text) {
          send(res, 200, { ok: false, reason: "empty" });
          return;
        }
        const ssid = String(payload.sid || "");
        if (readSpeech() === "silent" || inQuietHours()) {
          send(res, 200, { ok: false, reason: "muted" });
          return;
        }
        // Уже что-то играет — не перебиваем: пусть окно подождёт.
        const cur = readJson(stateFile) || {};
        const left = Number(cur.at || 0) * 1000 + Number(cur.ms || 0) - Date.now();
        if (left > 0) {
          send(res, 200, { ok: false, reason: "busy", wait: Math.round(left) });
          return;
        }
        const emo = ["up", "down", "think"].includes(payload.emotion) ? payload.emotion : null;
        // Окно присылает голос персонажа само: у фоновых чатов в файле привязок
        // может не быть записи, и хеш-фолбэк давал случайный (иногда женский) голос.
        const forced = typeof payload.voice === "string" && payload.voice ? payload.voice : "";
        const voice = forced || effectiveVoice(ssid);
        log("SAY:", ssid, voice || "(default)");
        speak(text, ssid, voice, MAX_CHARS, emo);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && route === "/replay") {
        if (!lastSpeak || !lastSpeak.text) {
          send(res, 200, { ok: false, reason: "empty" });
          return;
        }
        speak(lastSpeak.text, lastSpeak.sid, lastSpeak.voice, lastSpeak.max, lastSpeak.emotion, lastSpeak.kind);
        send(res, 200, { ok: true, chars: lastSpeak.text.length });
        return;
      }
      if (req.method === "POST" && route === "/test") {
        // Пробная фраза текущим голосом и с текущей скоростью.
        const phrase = "Проверка озвучки. Раз, два, три.";
        lastSpeak = { text: phrase, sid: payload.sid || "", voice: payload.voice || "", max: MAX_CHARS };
        const ok = speakTera(phrase, payload.sid || "", payload.voice || null);
        send(res, 200, { ok });
        return;
      }
      if (req.method === "POST" && route === "/stop") {
        stopTts();
        send(res, 200, { ok: true });
        return;
      }
      send(res, 404, { ok: false });
    });
  });
  server.on("error", () => {});
  try {
    server.listen(port, "127.0.0.1");
  } catch (e) {
    return null;
  }
  globalThis.__x2aiBridge = server;
  return server;
}

module.exports = {
  id: "x2ai-tts-done",
  _test: { agreeGender, fixBareVerbs, genderOf, effectiveVoice, teraVoice, llmSummary },
  async setup(ctx) {
    try {
      startBridge(ctx);
    } catch (e) {}
    if (!enabled()) {
      log("SETUP: disabled");
      return;
    }
    if (!ctx?.event?.subscribe) {
      log("SETUP: no ctx.event.subscribe");
      return;
    }

    genText = ctx?.experimental?.generate?.text || ctx?.generate?.text || null;
    log("SETUP: subscribed", genText ? "llm=on" : "llm=off");
    try {
      console.warn("[x2ai-tts-done] setup subscribed, voice=%s", pickVoice());
    } catch (e) {}
    const ac = new AbortController();

    (async () => {
      try {
        for await (const ev of ctx.event.subscribe({ signal: ac.signal })) {
          const type = ev?.type;
          const data = ev?.data || {};

          // Диагностика: один раз за жизнь процесса пишем имя каждого события
          // из «исполнительных», чтобы знать, на что можно подписываться.
          if (/execution|message\.created|tool\./.test(String(type))) {
            if (!globalThis.__x2aiEvSeen) globalThis.__x2aiEvSeen = new Set();
            if (!globalThis.__x2aiEvSeen.has(type)) {
              globalThis.__x2aiEvSeen.add(type);
              log("EV:", type, JSON.stringify(Object.keys(data)).slice(0, 120));
            }
          }

          if (type === "session.text.ended") {
            const sid = data.sessionID;
            if (!sid || typeof data.text !== "string" || !data.text) continue;
            bufAdd(sid, data.text);
            log("TEXT:", sid, data.text.length);
            continue;
          }

          if (FAILS.has(type)) {
            const fsid = data.sessionID;
            if (fsid && readSpeech() !== "silent" && !inQuietHours()) {
              log("FAIL:", fsid);
              speak("Что-то пошло не так. Посмотри лог.", fsid, effectiveVoice(fsid), MAX_CHARS, "down");
            }
            continue;
          }

          if (type === "session.reasoning.ended") {
            const rsid = data.sessionID;
            const rtext = String(data.text || "").trim();
            if (!rsid || !rtext) continue;
            if (readReason().mode === "off") continue;
            // Модель присылает рассуждение кусками: ждём, пока текст перестанет расти.
            const prev = reasonTimers.get(rsid);
            if (prev) clearTimeout(prev);
            reasonTimers.set(
              rsid,
              setTimeout(() => {
                reasonTimers.delete(rsid);
                void speakReason(rsid, rtext);
              }, 1600),
            );
            continue;
          }

          if (!TRIGGERS.has(type)) continue;

          const sid = data.sessionID;
          const raw = bufTake(sid);
          if (!raw) {
            try {
              console.warn("[x2ai-tts-done] trigger without buffered text: %s", type);
            } catch (e) {}
            log("TRIGGER: no buffer", type, sid);
            continue;
          }
          const clean = stripCode(raw);
          if (!clean || clean.length < MIN_CHARS) {
            log("TRIGGER: too short after strip", clean.length);
            continue;
          }
          const key = hash(clean);
          if (alreadySpoken(key)) {
            log("TRIGGER: duplicate, skipped");
            continue;
          }
          const voice = effectiveVoice(sid);
          const gender = genderOf(voice);
          const mode = readSpeech();
          if (mode === "silent") {
            log("SKIP: silent mode");
            continue;
          }
          if (inQuietHours()) {
            log("SKIP: quiet hours");
            continue;
          }
          const LONG_TEXT = 3000;
          const SHORT_TEXT = 220;
          let source;
          if (mode === "full") {
            source = dedupeSentences(clean, 400).slice(0, 4000);
          } else if (clean.length < SHORT_TEXT) {
            // Короткий ответ не пересказываем — он и так короткий.
            log("SHORT: read as is", clean.length);
            source = clean.slice(0, 400);
          } else {
            const long = clean.length > LONG_TEXT;
            source =
              (await llmSummary(raw, gender, undefined, sid, long ? "long" : "")) ||
              summarize(raw) ||
              clean.slice(0, 300);
            if (long) source = `Много деталей, коротко. ${source}`;
          }
          const summary = agreeGender(source, gender);
          log("GENDER:", gender || "-", voice, "mode:", mode);
          if (cyrRatio(summary) < 0.5) {
            log("SKIP: not russian", summary.slice(0, 60));
            continue;
          }
          speak(summary, sid, voice, mode === "full" ? FULL_MAX_CHARS : MAX_CHARS, "up");
        }
      } catch (e) {
        log("SUBSCRIBE_END", e?.message);
      }
    })();

    return () => ac.abort();
  },
};
