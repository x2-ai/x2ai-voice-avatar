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
const MIN_CHARS = 15;
const DEBUG = true;

const LOG = `${process.env.HOME}/.config/opencode/x2ai-tts-done.log`;
const MARK = "/tmp/x2ai-tts-done.mark";
// Плагины перезагружаются на каждом шаге хода, поэтому буфер живёт в файле.
const BUF = `${process.env.HOME}/.config/opencode/x2ai-tts-done.buf`;
const BUF_TTL = 10 * 60 * 1000;
const OFF_FILE = `${process.env.HOME}/.config/opencode/x2ai-tts-done.disabled`;

// Конец хода: эти события реально присылает десктопный сервис.
const TRIGGERS = new Set(["session.execution.succeeded", "session.execution.interrupted"]);

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

function stripCode(text) {
  if (!text) return "";
  let t = text;
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`[^`]+`/g, " ");
  t = t.replace(/^([+-].*)$/gm, " ");
  t = t.replace(/\b[\w./-]+:\d+\b/g, " ");
  t = t.replace(/^\$\s+.*/gm, " ");
  t = t.replace(/[{}\[\]();=<>|\\*#_~^]/g, " ");
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
function dedupeSentences(text) {
  const norm = (s) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  const out = [];
  for (const raw of String(text).split(/(?<=[.!?…])\s+/)) {
    const s = raw.trim();
    const n = norm(s);
    if (n.length < 3) continue;
    const dup = out.some((o) => {
      const on = norm(o);
      return on === n || on.includes(n) || n.includes(on);
    });
    if (!dup) out.push(s);
    if (out.length >= 3) break;
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

// Пересказ моделью (бесплатной, без сессии). Пустая строка = не получилось.
async function llmSummary(raw, gender) {
  if (!LLM_SUMMARY || !genText) return "";
  const src = stripCode(raw).slice(0, 6000).trim();
  if (src.length < 40) return "";
  // Пользователь всегда мужчина: женский род касается ТОЛЬКО речи ассистента о себе.
  const ABOUT_USER =
    "Пользователь — мужчина. Обращаясь к нему, всегда используй мужской род: «ты проверил», «ты попросил», «ты прав», «ты уверен». Никогда не пиши о пользователе в женском роде.";
  const GENDER_RULE = {
    f: `Пиши от лица ассистента. О себе (первое лицо, «я») говори в женском роде: «я проверила», «я сделала», «я нашла», «я уверена». ${ABOUT_USER}`,
    m: `Пиши от лица ассистента. О себе (первое лицо, «я») говори в мужском роде: «я проверил», «я сделал», «я нашёл», «я уверен». ${ABOUT_USER}`,
  };
  const prompt = [
    "Сожми текст в 1–3 коротких предложения по-русски для озвучки вслух.",
    "Только суть: что сделано и зачем это нужно. Без путей, имён файлов, команд, кода, цифр, markdown и списков.",
    "Пиши связной прозой, без вступлений вроде «в этом ответе».",
    "Пиши только по-русски. Английские слова и термины переводи, латиницу оставляй только в крайнем случае.",
    "Каждое предложение — новая мысль. Не повторяй одну и ту же фразу разными словами.",
    GENDER_RULE[gender] ||
      `Пиши безлично или в третьем лице, избегая форм прошедшего времени от первого лица. ${ABOUT_USER}`,
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

function speakTera(text, sid, forced) {
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
    delete env.X2AI_TTS_TEXT;
    log("TERA_VOICE:", voice || "(default)", sid || "");
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

function speak(text, sid, voice) {
  const toSay = (text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text).replace(/\s+/g, " ").trim();
  if (!toSay) return;
  log("SPEAK:", toSay.slice(0, 100));
  if (ENGINE === "say") return speakSay(toSay);
  if (ENGINE === "teratts" || ENGINE === "auto") {
    if (speakTera(toSay, sid, voice)) return;
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
  const readJson = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      return null;
    }
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
    { id: "fx_penguin", label: "Пингвин — высокий писк", kind: "effect" },
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
        models.push({
          providerID: m.providerID || m.provider || "",
          id: m.modelID || m.id,
          name: m.name || m.modelID || m.id,
          free: input === 0 && output === 0,
        });
      }
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
        voices: readVoices(),
        charVoices: readCharVoices(),
      });
      return;
    }
    if (req.method === "GET" && route === "/voices") {
      send(res, 200, { voices: VOICE_LIST, charVoices: readCharVoices() });
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

          if (type === "session.text.ended") {
            const sid = data.sessionID;
            if (!sid || typeof data.text !== "string" || !data.text) continue;
            bufAdd(sid, data.text);
            log("TEXT:", sid, data.text.length);
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
          const summary = agreeGender(
            dedupeSentences((await llmSummary(raw, gender)) || summarize(raw) || clean.slice(0, 300)),
            gender
          );
          log("GENDER:", gender || "-", voice);
          if (cyrRatio(summary) < 0.5) {
            log("SKIP: not russian", summary.slice(0, 60));
            continue;
          }
          speak(summary, sid, voice);
        }
      } catch (e) {
        log("SUBSCRIBE_END", e?.message);
      }
    })();

    return () => ac.abort();
  },
};
