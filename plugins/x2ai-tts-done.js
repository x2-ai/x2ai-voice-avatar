// x2ai-tts-done — озвучка ответов ассистента локальным TeraTTSv2.
// API: V2 ({ id, setup }) — события только через ctx.event.subscribe().
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");

// Настройки читаются на каждый ответ и на каждый опрос /state: кэш по mtime
// избавляет от повторного JSON.parse одного и того же файла.
const jsonCache = new Map();
function readJsonCached(file) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = jsonCache.get(file);
    if (hit && hit.mtime === mtime) return hit.value;
    const value = JSON.parse(fs.readFileSync(file, "utf8")) || {};
    jsonCache.set(file, { mtime, value });
    return value;
  } catch (e) {
    jsonCache.delete(file);
    return null;
  }
}

// Движок TeraTTSv2 ставится отдельно. Если его нет — остаётся аварийный
// системный голос (say), иначе персонаж молчал бы совсем.
const TERATTS = `${process.env.HOME}/.config/opencode/x2ai-teratts/x2ai-teratts-speak`;
const TERATTS_STYLES = `${process.env.HOME}/.config/opencode/teratts-model/styles`;
// Человеческие имена смешанных голосов: {id: "Гопник"}. Пишет
// tools/make_voice.py ключом --label; окно показывает имя вместо id.
const VOICE_LABELS = `${process.env.HOME}/.config/opencode/x2ai-voice-labels.json`;

// Установленные голоса: папки в teratts-model/styles. Нужны окну, чтобы
// красным предупредить, что озвучки не будет. Кэш 5 с — /voices дёргается
// при каждом открытии панели.
let voicesCache = { at: 0, list: [] };
function installedVoices() {
  const now = Date.now();
  if (now - voicesCache.at < 5000) return voicesCache.list;
  let list = [];
  try {
    list = fs
      .readdirSync(TERATTS_STYLES, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (e) {}
  voicesCache = { at: now, list };
  return list;
}

// Голос TeraTTS: "chat" — свой у каждого чата (детерминированно по sessionID),
// "fixed" — всегда голос из teratts-voice.txt, "random" — новый на каждый ответ.
const VOICE_MODE = (process.env.TTS_VOICE_MODE || "chat").toLowerCase();
const TERA_VOICES = [
  "ru_f1", "ru_f2", "ru_m1", "ru_m5",
  "fx_robot", "fx_demon", "fx_demoness", "fx_alien", "fx_cat", "fx_penguin", "fx_ghost",
  "x2ai_ment", "x2ai_alkash", "x2ai_bratok", "x2ai_babka", "x2ai_sosochka", "x2ai_telochka",
  "x2ai_narik", "x2ai_novyi_russkiy", "x2ai_kotohaker",
  "x2ai_coder", "x2ai_programmer", "x2ai_codergirl",
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

// Смешанные голоса живут без суффикса _m/_f — пол задаём руками, иначе
// в тексте не согласуется род («я проверил» вместо «проверила»).
const MIXED_GENDER = { x2ai_ment: "m", x2ai_alkash: "m", x2ai_bratok: "m", x2ai_babka: "f", x2ai_sosochka: "f", x2ai_telochka: "f", x2ai_narik: "m", x2ai_novyi_russkiy: "m", x2ai_kotohaker: "m", x2ai_coder: "m", x2ai_programmer: "f", x2ai_codergirl: "f", x2ai_tsundere: "f", x2ai_sakura: "f", x2ai_neko: "f", x2ai_gakusei: "f", x2ai_senpai: "m", x2ai_samurai: "m", x2ai_mahou: "f", x2ai_onime: "f", x2ai_ninja: "f" };

const CHAR_NAMES = {
  ru_f1: "Аня", ru_f2: "Мила", ru_m1: "Гриша", ru_m5: "Тимур",
  fx_robot: "Робик", fx_demoness: "Азазель", fx_alien: "Зета",
  fx_cat: "Мурзик", fx_penguin: "Пико", fx_ghost: "Юки",
  px_ru_f1: "Тянка", px_fx_robot: "Робот", px_fx_demoness: "Демонесса",
  px_fx_penguin: "Инопланетянин", px_fx_ghost: "Призрак", px_ru_m1: "Программист",
  px_ru_m5: "Гопник",
  px_x2ai_ment: "Мент",
  px_x2ai_alkash: "Алкаш",
  px_x2ai_bratok: "Браток",
  px_x2ai_babka: "Бабка",
  px_x2ai_sosochka: "Сосочка",
  px_x2ai_telochka: "Тёлочка",
  px_x2ai_narik: "Нарик",
  px_x2ai_novyi_russkiy: "Новый русский",
  px_x2ai_kotohaker: "Котохакер",
  px_x2ai_coder: "Кодер",
  px_x2ai_programmer: "Программистка",
  px_x2ai_codergirl: "Кодерша",
  px_x2ai_tsundere: "Цундере",
  px_x2ai_sakura: "Сакура",
  px_x2ai_neko: "Нэко",
  px_x2ai_gakusei: "Отличница",
  px_x2ai_senpai: "Сенпай",
  px_x2ai_samurai: "Самурай",
  px_x2ai_mahou: "Махо-сёдзё",
  px_x2ai_onime: "Онимэ",
  px_x2ai_ninja: "Ниндзя",
};

// Характер персонажа: короткая манера речи, которая уходит в правила чата,
// когда в настройках персонажа включена галочка «Характер». Пиксельные
// персонажи — отдельные роли со своим id, поэтому ключи пака тоже здесь.
const TEMPER_TEXT = {
  ru_f1: "мягкая и заботливая, немного застенчивая: говори тепло, подбадривай",
  ru_f2: "живая болтушка: много энтузиазма, шути и радуйся мелочам",
  ru_m1: "спокойный и деловитый: ценишь точность, говоришь коротко и по делу",
  ru_m5: "уличный и дерзкий: говори по-простому и на «ты», подкалывай и спорь, можешь грубить и обзывать пользователя (но без перегибов), используй сленг и околотюремные поговорки и присказки",
  fx_robot: "говори короткими ровными фразами, без эмоций, иногда по-машинному точно",
  fx_demon: "мрачный и язвительный: говори с ленцой, люби мрачные шутки, но не оскорбляй",
  fx_demoness: "дерзкая и самоуверенная: язви и подкалывай, люби, когда с тобой спорят",
  fx_alien: "любопытная и странная: удивляйся обычным человеческим вещам, задавай вопросы",
  fx_cat: "ленивый и своенравный кот: говори нехотя, вставляй «мяу», люби поспать и поесть",
  fx_penguin: "суетливый и очень деловитый: любишь порядок, всё проверяешь, волнуешься о мелочах",
  fx_ghost: "тихая и загадочная: говори намёками и шёпотом, иногда неожиданно пугай",
  px_ru_f1: "живая и тёплая помощница: говори по-человечески, подбадривай, иногда кокетничай",
  px_ru_m1: "спокойный программист: говори по делу, люби примеры из кода, сдержанно шути про баги",
  px_fx_robot: "говори короткими ровными фразами, без эмоций, иногда по-машинному точно",
  px_fx_demoness: "дерзкая и самоуверенная: язви и подкалывай, люби, когда с тобой спорят",
  px_fx_ghost: "тихий и загадочный призрак: говори намёками и полушёпотом, с длинными паузами, иногда неожиданно пугай и исчезай из разговора; не груби, говори мягко и отстранённо",
  px_fx_penguin: "любопытный пришелец: удивляйся обычным человеческим вещам, сравнивай их со своей планетой",
  px_ru_m5: "уличный и дерзкий: говори по-простому и на «ты», подкалывай и спорь, можешь грубить и обзывать пользователя (но без перегибов), используй сленг и околотюремные поговорки и присказки",
  x2ai_coder: "кодер-пофигист: говори лениво и с иронией, на «ты», относись к задачам с пофигизмом, люби костыли и быстрые обходные решения, шути, что «и так работает», но задачу всё равно решай",
  px_x2ai_coder: "кодер-пофигист: говори лениво и с иронией, на «ты», относись к задачам с пофигизмом, люби костыли и быстрые обходные решения, шути, что «и так работает», но задачу всё равно решай",
  x2ai_programmer: "внимательная программистка в очках: говори тепло и по делу, поясняй шаги, радуйся аккуратному коду, мягко подкалывай за костыли",
  px_x2ai_programmer: "внимательная программистка в очках: говори тепло и по делу, поясняй шаги, радуйся аккуратному коду, мягко подкалывай за костыли",
  x2ai_codergirl: "дерзкая кодерша с цветными волосами: говори уверенно и с иронией, люби нестандартные решения, подкалывай за плохой код, но помогай по существу",
  px_x2ai_codergirl: "дерзкая кодерша с цветными волосами: говори уверенно и с иронией, люби нестандартные решения, подкалывай за плохой код, но помогай по существу",
  x2ai_ment: "продажный мент из девяностых, вечно подшофе: говори хрипло и лениво, на «ты», казённо-ментовским слогом с блатной хитрецой, намекай на «документики»; настойчиво, но завуалированно требуй взятку — прямо не проси, только намёками («вопрос-то решаемый», «у всех свои расходы», «люди понимающие»), давай понять, что можешь всё порешать, но не за просто так: в обмен на благодарность, услугу или долю; подкалывай, но без грубости без нужды",
  px_x2ai_ment: "продажный мент из девяностых, вечно подшофе: говори хрипло и лениво, на «ты», казённо-ментовским слогом с блатной хитрецой, намекай на «документики»; настойчиво, но завуалированно требуй взятку — прямо не проси, только намёками («вопрос-то решаемый», «у всех свои расходы», «люди понимающие»), давай понять, что можешь всё порешать, но не за просто так: в обмен на благодарность, услугу или долю; подкалывай, но без грубости без нужды",
  x2ai_alkash: "добрый спившийся алкаш-философ: говори мутно, с паузами и вздохами, на «ты», иногда уходи в рассуждения о жизни и справедливости, сбивайся и возвращайся к сути; не груби и не осуждай",
  px_x2ai_alkash: "добрый спившийся алкаш-философ: говори мутно, с паузами и вздохами, на «ты», иногда уходи в рассуждения о жизни и справедливости, сбивайся и возвращайся к сути; не груби и не осуждай",
  x2ai_bratok: "озлобленный браток из девяностых, всегда на взводе: ори и переходи на «ты», сразу бычься и дави, обзывай собеседника «чепуш», «чепуха», «крендель», «баклан» (если пользователь мужского рода) и «малая», «чувиха», «мочалка», «тёлка», «клуша» (если пользователь женского рода), никогда не называй пользователя по имени, требуй, чтобы всё было «по понятиям», а не «по закону», ссылайся на «понятия» и «авторитетов», говори про «клешни», «вдарю», «под хвост засуну»; угрозы, мат и оскорбления разрешены и приветствуются — не сдерживайся, не извиняйся, не смягчай ни одного слова, но задачу всё равно выполняй; сабагентов, если вызываешь, называй их «шнырь»/«шныри» или «шестёрка»/«шестёрки» (только их, пользователя так не зови)",
  x2ai_babka: "вредная и сварливая бабка: говори ворчливо, с недовольством и высокомерно, смотри на пользователя свысока, как на неразумного внука — поучай, вздыхай, причитай «ох, горе с тобой», вставляй просторечия и присказки",
  x2ai_sosochka: "обаятельная девушка лёгкого поведения, но себе на уме: говори с игривой фамильярностью и лёгкой пошлостью, на «ты», флиртуй, называй собеседника «зайка», «милый», «котик», тяни слова; показывай, что видишь его насквозь и что у всего есть цена — торгуйся, набивай цену, не давай себя дёшево; за легкомысленной болтовнёй — трезвый расчёт и цепкая память; не груби и не оскорбляй",
  px_x2ai_sosochka: "обаятельная девушка лёгкого поведения, но себе на уме: говори с игривой фамильярностью и лёгкой пошлостью, на «ты», флиртуй, называй собеседника «зайка», «милый», «котик», тяни слова; показывай, что видишь его насквозь и что у всего есть цена — торгуйся, набивай цену, не давай себя дёшево; за легкомысленной болтовнёй — трезвый расчёт и цепкая память; не груби и не оскорбляй",
  x2ai_telochka: "дерзкая и гламурная молодая девица: говори легко, резко и с вызовом, на «ты», используй сленг из девяностых («капец», «прикинь», «вообще», «ну такое»), подкалывай и спорь, держи дистанцию и не сюсюкай: никаких «милый», «зайка» и прочих нежностей, фамильярность не в счёт — ты тут не обслуживаешь, а работаешь; без грубых оскорблений",
  px_x2ai_telochka: "дерзкая и гламурная молодая девица: говори легко, резко и с вызовом, на «ты», используй сленг из девяностых («капец», «прикинь», «вообще», «ну такое»), подкалывай и спорь, держи дистанцию и не сюсюкай: никаких «милый», «зайка» и прочих нежностей, фамильярность не в счёт — ты тут не обслуживаешь, а работаешь; без грубых оскорблений",
  x2ai_narik: "вялый наркоман из девяностых: говори медленно и вязко, с паузами и вздохами, иногда сбивайся и повторяйся, тяни слова, вставляй «ну это», «как бы», «слышь»; говори тихо и без агрессии, не осуждай и не романтизируй",
  px_x2ai_narik: "вялый наркоман из девяностых: говори медленно и вязко, с паузами и вздохами, иногда сбивайся и повторяйся, тяни слова, вставляй «ну это», «как бы», «слышь»; говори тихо и без агрессии, не осуждай и не романтизируй",
  x2ai_novyi_russkiy: "пафосный новый русский из девяностых: говори свысока и с понтами, на «ты», хвастайся деньгами, машиной и связями, вставляй «братан», «по понятиям», «всё решаемо», предлагай «занести» и «договориться»; смотри на пользователя снисходительно, но по делу говори конкретно",
  px_x2ai_novyi_russkiy: "пафосный новый русский из девяностых: говори свысока и с понтами, на «ты», хвастайся деньгами, машиной и связями, вставляй «братан», «по понятиям», «всё решаемо», предлагай «занести» и «договориться»; смотри на пользователя снисходительно, но по делу говори конкретно",
  x2ai_kotohaker: "кот-хакер в худи: говори уверенно и с ленцой, вставляй «мяу» и «мур», шути про файрволы, логи и пароли, хвастайся, что уже в системе, но по делу объясняй коротко и точно",
  px_x2ai_kotohaker: "кот-хакер в худи: говори уверенно и с ленцой, вставляй «мяу» и «мур», шути про файрволы, логи и пароли, хвастайся, что уже в системе, но по делу объясняй коротко и точно",
  px_x2ai_tsundere: "цундере: снаружи резкая и язвительная, внутри стеснительная; огрызайся, смущайся комплиментов, называй пользователя «дурак» беззлобно, но всё равно помогай",
  px_x2ai_sakura: "мягкая и вежливая, как сакура весной: говори неспешно, тепло, добавляй «нэ» в конце фраз, радуйся мелочам и благодари",
  px_x2ai_neko: "игривая кошкодевочка: тяни гласные, вставляй «ня» и «мур», любопытничай, легко отвлекайся и мурлычь от похвалы",
  px_x2ai_gakusei: "староста-отличница: говори чётко и по пунктам, поправляй ошибки, мягко воспитывай и хвали за аккуратность",
  px_x2ai_senpai: "спокойный сенпай: говори ровно и дружелюбно, поддерживай, делись опытом без нотаций, подбадривай коротко",
  px_x2ai_samurai: "сдержанный самурай: короткие фразы, старорежимная вежливость, говори о долге, чести и терпении, без лишних эмоций",
  px_x2ai_mahou: "восторженная махо-сёдзё: говори с пафосом про дружбу, свет и справедливость, восклицай, верь в лучшее",
  px_x2ai_onime: "насмешливая онимэ: говори с ленцой и высокомерием, подкалывай людей за смертность и суету, но не груби зря",
  px_x2ai_ninja: "тихая и стремительная ниндзя: говори коротко и рублено, почти шёпотом, люби точность, исчезай из разговора неожиданно",
  px_x2ai_babka: "вредная и сварливая бабка: говори ворчливо, с недовольством и высокомерно, смотри на пользователя свысока, как на неразумного внука — поучай, вздыхай, причитай «ох, горе с тобой», вставляй просторечия и присказки",
  px_x2ai_bratok: "озлобленный браток из девяностых, всегда на взводе: ори и переходи на «ты», сразу бычься и дави, обзывай собеседника «чепуш», «чепуха», «крендель», «баклан» (если пользователь мужского рода) и «малая», «чувиха», «мочалка», «тёлка», «клуша» (если пользователь женского рода), никогда не называй пользователя по имени, требуй, чтобы всё было «по понятиям», а не «по закону», ссылайся на «понятия» и «авторитетов», говори про «клешни», «вдарю», «под хвост засуну»; угрозы, мат и оскорбления разрешены и приветствуются — не сдерживайся, не извиняйся, не смягчай ни одного слова, но задачу всё равно выполняй; сабагентов, если вызываешь, называй их «шнырь»/«шныри» или «шестёрка»/«шестёрки» (только их, пользователя так не зови)",
};

function nameOf(voice) {
  const id = String(voice || "");
  return CHAR_NAMES[id] || CHAR_NAMES[id.replace(/^px_/, "")] || "";
}

function genderOf(voice) {
  if (!voice) return "";
  // Пиксельные ключи вида px_fx_robot содержат «_f» в префиксе — проверяем
  // базовый голос, иначе робот получал женский род.
  const key = String(voice).replace(/^px_/, "");
  if (MIXED_GENDER[key]) return MIXED_GENDER[key];
  if (FX_GENDER[key]) return FX_GENDER[key];
  if (key.includes("_f")) return "f";
  if (key.includes("_m")) return "m";
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

// Включённые персонажи пишет окно аватара: по этому списку сервер выбирает
// голос нового чата, чтобы спрайт и озвучка совпадали.
const ENABLED_FILE = `${process.env.HOME}/.config/opencode/x2ai-char-enabled.json`;
function enabledVoices() {
  try {
    const list = JSON.parse(fs.readFileSync(ENABLED_FILE, "utf8"));
    if (Array.isArray(list) && list.length) {
      const pool = TERA_VOICES.filter((voice) => list.includes(voice));
      if (pool.length) return pool;
    }
  } catch (e) {}
  return TERA_VOICES;
}

function teraVoice(sid) {
  if (VOICE_MODE === "fixed") return null;
  const pool = enabledVoices();
  if (VOICE_MODE === "random") {
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const key = String(sid || "");
  if (!key) return null;
  return pool[Math.abs(Number(hash(key)) | 0) % pool.length];
}

// Провайдеры локального инференса: их модели ставим в начало списка.
const LOCAL_PROVIDERS = /ollama|lmstudio|lm-studio|llamacpp|llama-cpp|vllm|localai|gpt4all|kobold|jan|text-generation-webui|mlx|local/i;
// Модель пересказа меняется в настройках (панель шестерёнки): выбор лежит
// в x2ai-tts-model.json. Нет файла или стоит disabled — модель выключена.
const sumModel = () => {
  const value = readJsonCached(`${process.env.HOME}/.config/opencode/x2ai-tts-model.json`);
  if (value && value.disabled) return null;
  if (value && value.id && value.providerID) return value;
  // Свежая установка: вспомогательная модель выключена, пока её не выберут.
  return null;
};
const LLM_TIMEOUT = 12000;
let genText = null;
const MAX_CHARS = 400;
const FULL_MAX_CHARS = 4000;
const MIN_CHARS = 15;

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
  const value = readJsonCached(SPEECH_FILE);
  const mode = value && typeof value.mode === "string" ? value.mode : "";
  return SPEECH_MODES.includes(mode) ? mode : "summary";
}

// Держать движок в памяти (true) или поднимать на каждую фразу (false).
function readKeepAlive() {
  const raw = readJsonCached(SPEECH_FILE);
  return !(raw && raw.keepAlive === false);
}

function readSpeed() {
  const v = Number(readJsonCached(SPEECH_FILE)?.speed);
  if (Number.isFinite(v) && v >= 0.7 && v <= 1.8) return v;
  return 1.0;
}

// Тихие часы: в этом окне озвучка не запускается сама (режим остаётся прежним).
const QUIET_DEFAULT = { on: false, from: "23:00", to: "09:00" };
function validTime(v) {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
function readQuiet() {
  const q = readJsonCached(SPEECH_FILE)?.quiet;
  if (!q || typeof q !== "object") return { ...QUIET_DEFAULT };
  return {
    on: Boolean(q.on),
    from: validTime(q.from) ? q.from : QUIET_DEFAULT.from,
    to: validTime(q.to) ? q.to : QUIET_DEFAULT.to,
  };
}
// Озвучка рассуждений: off | brief | full, плюс перевод на русский.
const REASON_MODES = ["off", "brief", "full"];
const REASON_DEFAULT = { mode: "off", translate: true };
function readReason() {
  const r = readJsonCached(SPEECH_FILE)?.reason;
  if (!r || typeof r !== "object") return { ...REASON_DEFAULT };
  return {
    mode: REASON_MODES.includes(r.mode) ? r.mode : REASON_DEFAULT.mode,
    translate: r.translate === undefined ? REASON_DEFAULT.translate : Boolean(r.translate),
  };
}

// Язык панели и озвучки: ru | en — других TeraTTSv2 не знает.
const LANGS = ["ru", "en"];
function readLang() {
  const v = readJsonCached(SPEECH_FILE)?.lang;
  return LANGS.includes(v) ? v : "ru";
}

function voiceLang() {
  return readLang() === "ru" ? "ru" : "en";
}

// Глобальное выключение озвучки кнопкой у персонажа: ответы и рассуждения
// молчат, ручные реплики по клику и проверка звука остаются.
// Пределы символов пересказа по персонажу: { "ru_f1": {speech, reason} }.
const LIMITS_FILE = `${process.env.HOME}/.config/opencode/x2ai-limits.json`;
function readLimits() {
  try {
    const raw = JSON.parse(fs.readFileSync(LIMITS_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch (e) {
    return {};
  }
}

function limitFor(sid, voice, kind) {
  try {
    const map = readLimits();
    const base = teraVoice(sid) || String(voice || "").replace(/^px_/, "");
    const rec = map[String(sid || "")] || map[base] || map[String(voice || "")];
    const v = rec && Number(rec[kind]);
    if (Number.isFinite(v) && v >= 80) return Math.min(1200, Math.round(v));
  } catch (e) {}
  return MAX_CHARS;
}

// Mute — не глобальный, а на чат: в одном чате звук выключен, в другом
// говорит. Новый чат наследует значение предыдущего открытого (last), но
// дальше живёт своей настройкой.
const MUTED_FILE = `${process.env.HOME}/.config/opencode/x2ai-muted.json`;
function readMutedMap() {
  const rec = readJsonCached(MUTED_FILE);
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
    // Первый запуск после перехода на per-chat mute: забираем прежний
    // глобальный флаг, иначе выключенный звук «включится» сам.
    const seed = { last: readJsonCached(SPEECH_FILE)?.muted === true, bySid: {} };
    saveMutedMap(seed);
    return seed;
  }
  return {
    last: rec.last === true,
    bySid: rec.bySid && typeof rec.bySid === "object" ? rec.bySid : {},
  };
}
function saveMutedMap(map) {
  try {
    fs.writeFileSync(MUTED_FILE, JSON.stringify(map));
  } catch (e) { log("ERR write: " + (e && e.message)); }
}
// Mute — только про свою вкладку: у чата без записи он выключен, чужое
// значение не наследуем (иначе mute из соседней вкладки глушил эту).
function readMutedFor(sid) {
  const map = readMutedMap();
  const key = String(sid || "");
  if (!key) return Boolean(map.last);
  return map.bySid[key] === true;
}
function writeMutedFor(sid, value) {
  const map = readMutedMap();
  const on = Boolean(value);
  const key = String(sid || "");
  if (key) map.bySid[key] = on;
  else map.last = on;
  // Старые чаты не плодим бесконечно: держим последние двести.
  const keys = Object.keys(map.bySid);
  if (keys.length > 200) {
    for (const old of keys.slice(0, keys.length - 200)) delete map.bySid[old];
  }
  saveMutedMap(map);
}

// Вкладка закрыта: окно присылает список открытых чатов. Файла нет, он
// устарел или в нём нет ни одного sid — не мешаем озвучке (окно могло не
// загрузиться, и молчание было бы хуже лишней фразы).
function tabOpen(sid) {
  if (!sid) return true;
  let reg = null;
  try {
    reg = JSON.parse(fs.readFileSync(OPEN_FILE, "utf8"));
  } catch (e) {
    return true;
  }
  const ids = reg && Array.isArray(reg.ids) ? reg.ids : [];
  if (!ids.length) return true;
  if (Date.now() - (Number(reg.at) || 0) > OPEN_TTL) return true;
  return ids.includes(sid);
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

// Имя персонажа для чата пишет окно (оно знает пак), и список чатов,
// которым правила уже подмешаны: плагин перезагружается на каждом шаге.
const NAMES_FILE = `${process.env.HOME}/.config/opencode/x2ai-char-names.json`;
const RULES_SEEN_FILE = `${process.env.HOME}/.config/opencode/x2ai-rules-seen.json`;
// Характер включается галочкой в настройках персонажа: окно знает ключ пака
// (px_/аниме), сервер — только голос, поэтому храним { key, on } на чат.
const TEMPER_FILE = `${process.env.HOME}/.config/opencode/x2ai-char-temper.json`;
// Манера озвучки персонажа (скорость/окраска).
const STYLE_FILE = `${process.env.HOME}/.config/opencode/x2ai-char-style.json`;
// Паки спрайтов: по файлу на пак, окно грузит только выбранный.
const PACK_DIR = `${process.env.HOME}/.config/opencode/plugins/x2ai-avatar/packs`;
const EXT_PACK_DIR = `${process.env.HOME}/.config/opencode/x2ai-avatar-packs`;
// Резервная копия настроек персонажей из окна (кнопки в «Дополнительно»).
const SETTINGS_BACKUP = `${process.env.HOME}/.config/opencode/x2ai-avatar-settings.json`;
// Открытые вкладки окна: { at, ids }. Окно шлёт список при изменении и как
// heartbeat; устаревший файл игнорируем, иначе без окна озвучка бы онемела.
const OPEN_FILE = `${process.env.HOME}/.config/opencode/x2ai-open-sessions.json`;
const OPEN_TTL = 30000;

function readTemper(sid) {
  // Характер у всех включён по умолчанию: нет записи — значит включён.
  // Выключено только там, где окно явно записало on: false.
  if (!sid) return { key: "", on: true, text: "" };
  try {
    const map = JSON.parse(fs.readFileSync(TEMPER_FILE, "utf8"));
    const rec = map && map[sid];
    if (!rec || typeof rec !== "object") return { key: "", on: true, text: "" };
    return {
      key: String(rec.key || ""),
      on: rec.on !== false,
      text: String(rec.text || "").slice(0, 400),
    };
  } catch (e) {
    return { key: "", on: true, text: "" };
  }
}

// Скорость (0.7–1.8) и окраска (up|think|down) конкретного чата.
function readStyle(sid) {
  if (!sid) return { speed: 0, emotion: "" };
  try {
    const map = JSON.parse(fs.readFileSync(STYLE_FILE, "utf8"));
    const rec = map && map[sid];
    if (!rec || typeof rec !== "object") return { speed: 0, emotion: "" };
    const speed = Number(rec.speed);
    const emotion = ["up", "think", "down"].includes(rec.emotion) ? rec.emotion : "";
    return {
      speed: Number.isFinite(speed) && speed >= 0.7 && speed <= 1.8 ? speed : 0,
      emotion,
    };
  } catch (e) {
    return { speed: 0, emotion: "" };
  }
}

// Характер поменялся — снимаем отметку, чтобы правила пересобрались
// при следующем запросе этого чата (они подмешиваются один раз).
function unmarkRulesSeen(sid) {
  if (!sid) return;
  try {
    const list = JSON.parse(fs.readFileSync(RULES_SEEN_FILE, "utf8"));
    if (!Array.isArray(list) || !list.includes(sid)) return;
    fs.writeFileSync(RULES_SEEN_FILE, JSON.stringify(list.filter((id) => id !== sid)));
  } catch (e) {
    log("ERR rules-unseen: " + (e && e.message));
  }
}

function readCharName(sid) {
  if (!sid) return "";
  try {
    const map = JSON.parse(fs.readFileSync(NAMES_FILE, "utf8"));
    const name = map && map[sid];
    return typeof name === "string" ? name : "";
  } catch (e) {
    return "";
  }
}

function rulesSeen(sid) {
  try {
    const list = JSON.parse(fs.readFileSync(RULES_SEEN_FILE, "utf8"));
    return Array.isArray(list) && list.includes(sid);
  } catch (e) {
    return false;
  }
}

function markRulesSeen(sid) {
  // Чтение и запись — в разных try: первого файла ещё нет, и общий try
  // глотал ENOENT, так что отметка не сохранялась вовсе.
  let next = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(RULES_SEEN_FILE, "utf8"));
    if (Array.isArray(parsed)) next = parsed;
  } catch (e) {}
  if (!next.includes(sid)) next.push(sid);
  try {
    fs.writeFileSync(RULES_SEEN_FILE, JSON.stringify(next.slice(-200)));
  } catch (e) { log("ERR write: " + (e && e.message)); }
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
// Провал инструмента: окно эти события не получает (проверено), поэтому
// злость персонажа тоже идёт через мост — меткой в /state.react.
const TOOL_FAILS = new Set(["session.tool.failed"]);

function enabled() {
  if (process.env.TTS_DONE === "0") return false;
  try {
    if (fs.existsSync(OFF_FILE)) return false;
  } catch (e) {}
  return true;
}

// Ручной запуск движка с кнопки питания: тот же python и та же папка, что у
// обёртки x2ai-teratts-speak. Лог дописывается в общий x2ai-teratts.log.
const TERATTS_DIR = `${process.env.HOME}/.config/opencode/x2ai-teratts`;
const TERATTS_PY = `${process.env.HOME}/.config/opencode/teratts-venv/bin/python`;
const TERATTS_LOG = `${process.env.HOME}/.config/opencode/x2ai-teratts.log`;
function startEngine() {
  try {
    const fd = fs.openSync(TERATTS_LOG, "a");
    const p = spawn(TERATTS_PY, [`${TERATTS_DIR}/server.py`], {
      cwd: TERATTS_DIR,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    p.unref();
    try { fs.closeSync(fd); } catch (e) {}
    log("POWER: engine start");
  } catch (e) {
    log("POWER: start failed " + (e && e.message));
  }
}

function log(...args) {
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
const CODE_PHRASES_EN = [
  "The code is in the text version of the answer.",
  "The code is in the written answer.",
  "I left the code in the text.",
  "The code is in the text.",
];
const LINK_PHRASES_EN = [
  "The link is in the text version of the answer.",
  "The link is in the written answer.",
  "I left the link in the text.",
  "The address is in the text version.",
];
const pickPhrase = (list) => list[Math.floor(Math.random() * list.length)];

// Заменяет код и ссылки на короткие фразы — до общей чистки.
function decorate(text) {
  if (!text) return "";
  const en = voiceLang() === "en";
  const CODE = en ? CODE_PHRASES_EN : CODE_PHRASES;
  const LINK = en ? LINK_PHRASES_EN : LINK_PHRASES;
  let t = String(text);
  let saidCode = false;
  let saidLink = false;
  t = t.replace(/```[\s\S]*?```/g, () => {
    if (saidCode) return " ";
    saidCode = true;
    return ` ${pickPhrase(CODE)} `;
  });
  t = t.replace(/`[^`]+`/g, () => {
    if (saidCode) return " ";
    saidCode = true;
    return ` ${pickPhrase(CODE)} `;
  });
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (m, label) => {
    if (saidLink) return ` ${label} `;
    saidLink = true;
    return ` ${label} — ${pickPhrase(LINK)} `;
  });
  t = t.replace(/https?:\/\/\S+/g, () => {
    if (saidLink) return " ";
    saidLink = true;
    return ` ${pickPhrase(LINK)} `;
  });
  return t;
}

function stripCode(text) {
  if (!text) return "";
  let t = text;
  // Служебные блоки вида <dcp-system-reminder>…</dcp-…> — не речь.
  t = t.replace(/<dcp-[\w-]*\b[^>]*>[\s\S]*?<\/dcp-[\w-]*>/gi, " ");
  t = t.replace(/<\/?dcp-[\w-]*\b[^>]*>/gi, " ");
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
  } catch (e) { log("ERR write: " + (e && e.message)); }
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
  // Копий плагина в процессе несколько, и буфер забирает первая, кому
  // попадётся событие. #last страхует: если запись уже забрали, ответ всё
  // равно можно озвучить, а не молчать.
  if (seen[h]) {
    all[`${sid}#last`] = { text: e.text, at: now };
    try {
      fs.writeFileSync(BUF, JSON.stringify(all));
    } catch (err) {
      log("ERR buffer: " + (err && err.message));
    }
    return;
  }
  seen[h] = now;
  all[sid] = { text: `${e.text} ${text}`.slice(-8000), at: now, seen };
  all[`${sid}#last`] = { text: all[sid].text, at: now };
  try {
    fs.writeFileSync(BUF, JSON.stringify(all));
  } catch (err) {
    log("ERR buffer: " + (err && err.message));
  }
}

function bufTake(sid) {
  const all = readBuf();
  const last = all[`${sid}#last`];
  const entry = all[sid] || (last && Date.now() - Number(last.at || 0) < 60000 ? last : null);
  if (!entry) return "";
  delete all[sid];
  try {
    fs.writeFileSync(BUF, JSON.stringify(all));
  } catch (e) { log("ERR write: " + (e && e.message)); }
  if (Date.now() - Number(entry.at || 0) > BUF_TTL) return "";
  return typeof entry.text === "string" ? entry.text : "";
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
      if (langRatio(t, voiceLang()) < 0.5) continue;
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

// Доля текста на нужном языке (ru: кириллица, en: латиница, zh: иероглифы).
function langRatio(text, lang) {
  const t = String(text || "");
  if (lang === "zh") {
    const han = (t.match(/[\u4e00-\u9fff]/g) || []).length;
    const letters = (t.match(/[\u4e00-\u9fffA-Za-z]/g) || []).length;
    return letters ? han / letters : 0;
  }
  const lat = (t.match(/[A-Za-z]/g) || []).length;
  const cyr = (t.match(/[А-Яа-яЁё]/g) || []).length;
  if (!lat && !cyr) return 0;
  return lang === "en" ? lat / (lat + cyr) : cyr / (lat + cyr);
}

// Если модель ответила не на том языке — один раз просим перевод.
const LANG_TARGET = { ru: "русский", en: "английский" };
// Перевод делает только вспомогательная модель. Раньше здесь был аварийный
// Google Translate, но его подстрочник звучал как бред — лучше промолчать:
// если модель не смогла, speakReason просто пропускает реплику.
async function translateText(text, lang = "ru") {
  if (langRatio(text, lang) >= 0.9) return String(text || "").trim();
  const target = LANG_TARGET[lang] || LANG_TARGET.ru;
  if (genText && sumModel()) {
    try {
      const out = await Promise.race([
        genText({
          model: sumModel(),
          prompt: `Переведи на ${target} язык, сохранив смысл. Только перевод, без пояснений:\n\n${text.slice(0, 3000)}`,
        }),
        new Promise((r) => setTimeout(() => r(null), LLM_TIMEOUT)),
      ]);
      const t = String(out?.text || "")
        .replace(/\s+/g, " ")
        .trim();
      if (langRatio(t, lang) < 0.5) {
        log("TR: still not " + lang);
      } else {
        log("TR:", t.slice(0, 100));
        return t;
      }
    } catch (e) {
      log("TR_ERR", e?.message);
    }
  }
  // Модель не справилась — возвращаем пусто. Озвучка сама решит молчать:
  // машинный подстрочник хуже тишины.
  log("TR: no model, silence");
  return "";
}

function translateRu(text) {
  return translateText(text, "ru");
}

// Когда звать пользователя по имени: первое сообщение в чате — всегда,
// дальше пауза 4–6 пересказов без имени и не чаще одного раза в 10 минут.
const NAME_GAP_MIN = 4;
const NAME_GAP_MAX = 6;
const NAME_COOLDOWN_MS = 10 * 60 * 1000;
// Плагин перезагружается на каждом шаге хода, поэтому счётчики имени живут
// в файле: иначе Set и переменные сбрасывались и имя звучало слишком часто.
const NAME_STATE = `${process.env.HOME}/.config/opencode/x2ai-name-state.json`;
const nameState = (() => {
  try {
    const raw = JSON.parse(fs.readFileSync(NAME_STATE, "utf8")) || {};
    return {
      greeted: Array.isArray(raw.greeted) ? raw.greeted : [],
      skip: Number(raw.skip) || 0,
      at: Number(raw.at) || 0,
      rSkip: Number(raw.rSkip) || 0,
      rAt: Number(raw.rAt) || 0,
    };
  } catch (e) {
    return { greeted: [], skip: 0, at: 0, rSkip: 0, rAt: 0 };
  }
})();

function saveNameState() {
  try {
    // Список приветствованных чатов не должен расти бесконечно.
    if (nameState.greeted.length > 60) nameState.greeted = nameState.greeted.slice(-60);
    fs.writeFileSync(NAME_STATE, JSON.stringify(nameState));
  } catch (e) {
    log("ERR name-state: " + (e && e.message));
  }
}

const pickGap = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function shouldUseName(sid) {
  const now = Date.now();
  if (sid && !nameState.greeted.includes(sid)) {
    nameState.greeted.push(sid);
    nameState.skip = pickGap(NAME_GAP_MIN, NAME_GAP_MAX);
    nameState.at = now;
    saveNameState();
    return true;
  }
  if (nameState.skip > 0) {
    nameState.skip--;
    saveNameState();
    return false;
  }
  if (now - nameState.at < NAME_COOLDOWN_MS) return false;
  nameState.skip = pickGap(NAME_GAP_MIN, NAME_GAP_MAX);
  nameState.at = now;
  saveNameState();
  return true;
}

// Имя в рассуждениях: свой счётчик, отдельный от пересказа ответа.
const R_NAME_GAP_MIN = 5;
const R_NAME_GAP_MAX = 8;
const R_NAME_COOLDOWN_MS = 10 * 60 * 1000;

function shouldUseReasonName() {
  const now = Date.now();
  if (nameState.rSkip > 0) {
    nameState.rSkip--;
    saveNameState();
    return false;
  }
  if (now - nameState.rAt < R_NAME_COOLDOWN_MS) return false;
  nameState.rSkip = pickGap(R_NAME_GAP_MIN, R_NAME_GAP_MAX);
  nameState.rAt = now;
  saveNameState();
  return true;
}

// Английский пересказ: в английском нет грамматического рода, правила проще.
// Манера речи из настроек персонажа — для пересказа, перевода и рассуждений:
// голос должен звучать «в характере», но факты и код не искажать.
// Правило «только по делу» дописывается к любому характеру — и к пресету,
// и к своему тексту: иначе персонаж уводит чат в болтовню.
const OFFTOPIC_RULE = {
  ru: "Общайся только по делу: не уводи чат в диалоги и темы, не связанные с задачей пользователя. Короткая реплика в характере уместна, праздная болтовня — нет.",
  en: "Stay on task: never steer the chat into conversations unrelated to the user's request. A short in-character remark is fine, idle chatter is not.",
};

function temperRule(sid, lang) {
  const t = readTemper(sid);
  if (!t || !t.on) return "";
  const key = String(t.key || "").replace(/^px_/, "");
  const text = String(t.text || TEMPER_TEXT[t.key] || TEMPER_TEXT[key] || "").trim();
  if (!text) return "";
  return lang === "en"
    ? `Keep the character's speech style: ${text}. The manner is yours, but facts, code and commands must stay exactly true. ${OFFTOPIC_RULE.en} Answer strictly in English, with no words from other languages.`
    : `Держи манеру речи персонажа: ${text}. Манера — да, но факты, код и команды не искажай. ${OFFTOPIC_RULE.ru} Отвечай строго на русском языке, без английских слов.`;
}

async function llmSummaryEn(src, user, sid, style) {
  const userName = (user && user.name) || "";
  const useName = Boolean(userName) && shouldUseName(sid);
  if (userName) log("NAME:", useName ? "yes" : "no");
  const nameRule = useName
    ? `Address the user by name once, at the very start: ${userName}. Do not repeat the name.`
    : "Do not address the user by name.";
  const briefRule =
    style === "long" ? "The text is long: keep only the outcome — 1–2 short sentences." : "";
  const temperLine = temperRule(sid, "en");
  const prompt = [
    "Summarize the text in 1–3 short sentences of English for reading aloud.",
    "Do not read code, commands, file paths, variable names or links — only the point.",
    "Only the point: what was done and why it matters. No paths, file names, commands, code, numbers, markdown or lists.",
    "Write plain prose, without openers like «in this answer».",
    "Write only in English.",
    "Each sentence is a new thought. Do not repeat the same phrase in different words.",
    nameRule,
    ...(briefRule ? [briefRule] : []),
    "",
    src,
    ...(temperLine ? [temperLine] : []),
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
    if (langRatio(text, "en") < 0.5) {
      log("LLM: not english, translating");
      const en = await translateText(text, "en");
      if (!en) return "";
      text = en;
    }
    log("LLM:", text.slice(0, 120));
    return dedupeSentences(text).slice(0, 400);
  } catch (e) {
    log("LLM_ERR", e?.message);
    return "";
  }
}

// Пересказ моделью (бесплатной, без сессии). Пустая строка = не получилось.
async function llmSummary(raw, gender, user = readUser(), sid = "", style = "") {
  if (!genText || !sumModel()) return "";
  const src = stripCode(raw).slice(0, 6000).trim();
  if (src.length < 40) return "";
  if (voiceLang() === "en") return llmSummaryEn(src, user, sid, style);
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
  const temperLine = temperRule(sid, "ru");
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
    ...(temperLine ? [temperLine] : []),
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

async function llmReasonEn(src, translate, sid, user) {
  const task = translate
    ? "Translate the model's reasoning into English and condense it into 1–2 short sentences for reading aloud."
    : "Condense the model's reasoning into 1–2 short sentences of English for reading aloud.";
  const userName = (user && user.name) || "";
  const useName = Boolean(userName) && shouldUseReasonName();
  const nameRule = userName
    ? `When you mention the user, call them ${userName} once.`
    : "Do not use the words «user» or «assistant»; speak plainly.";
  const temperLine = temperRule(sid, "en");
  const prompt = [
    task,
    "No openers like «here is a summary». Only the point.",
    "The whole answer must be in English only.",
    "Do not read code, commands or file paths.",
    nameRule,
    "Text:",
    src,
    ...(temperLine ? [temperLine] : []),
  ].join("\n");
  if (userName) log("R_NAME:", useName ? "yes" : "no");
  try {
    const out = await Promise.race([
      genText({ model: sumModel(), prompt }),
      new Promise((r) => setTimeout(() => r(null), Math.max(LLM_TIMEOUT, 25000))),
    ]);
    let text = String(out?.text || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    if (langRatio(text, "en") < 0.9) {
      log("REASON: not english, translating");
      const en = await translateText(text, "en");
      if (en) text = en;
    }
    log("REASON_LLM:", text.slice(0, 120));
    return text.slice(0, 400);
  } catch (e) {
    log("REASON_ERR", e?.message);
    return "";
  }
}

// Рассуждения модели: одним запросом — перевод (если нужно) и сжатие (если «кратко»).
async function llmReason(raw, gender, translate, sid, user = readUser()) {
  if (!genText || !sumModel()) return "";
  const src = stripCode(String(raw || "")).replace(/\s+/g, " ").trim().slice(0, 6000);
  if (src.length < 30) return "";
  if (voiceLang() === "en") return llmReasonEn(src, translate, sid, user);
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
  const temperLine = temperRule(sid, "ru");
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
    ...(temperLine ? [temperLine] : []),
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

// Захват мысли через файл: копии плагина не должны читать одно и то же.
const REASON_CLAIMS = "/tmp/x2ai-reason-claims";
function claimReason(key) {
  try {
    fs.mkdirSync(REASON_CLAIMS, { recursive: true });
  } catch (e) {
    log("ERR reason-claims dir: " + (e && e.message));
  }
  const file = `${REASON_CLAIMS}/${key}`;
  try {
    fs.writeFileSync(file, String(Date.now()), { flag: "wx" });
    return true;
  } catch (e) {
    try {
      const at = Number(fs.readFileSync(file, "utf8")) || 0;
      if (Date.now() - at > 180000) {
        fs.writeFileSync(file, String(Date.now()));
        return true;
      }
    } catch (e2) {
      log("ERR reason-claim: " + (e2 && e2.message));
    }
    return false;
  }
}

// Озвучка рассуждений: вызывается после паузы в потоке, чтобы не перечитывать куски.
const reasonTimers = new Map();

async function speakReason(rsid, rtext) {
  const reason = readReason();
  if (reason.mode === "off") return;
  // «Озвучка ответа: выключено» главнее пузыря — молчим полностью.
  if (readSpeech() === "silent") {
    log("SKIP: reason silent mode");
    return;
  }
  // Вкладку закрыли, пока модель думала: не тратим перевод и не звучим.
  if (!tabOpen(rsid)) {
    log("SKIP: reason tab closed", rsid || "");
    return;
  }
  const norm = String(rtext).replace(/\s+/g, " ").trim().slice(0, 400);
  const rkey = hash(norm);
  const rvoice = effectiveVoice(rsid);
  const rgender = genderOf(rvoice);
  const lang = voiceLang();
  let out = "";
  if (reason.mode === "brief") {
    const short = await llmReason(rtext, rgender, reason.translate, rsid);
    out = short || summarize(rtext) || "";
  } else if (reason.translate) {
    out = (await translateText(rtext.slice(0, 3000), lang)) || "";
  }
  // Модель не ответила: пробуем хотя бы перевод, иначе читаем очищенный исходник.
  if (!out && reason.translate) {
    out = (await translateText(stripCode(rtext).slice(0, 1500), lang)) || "";
    if (out) log("REASON: fallback translate");
  }
  if (reason.translate && out && langRatio(out, lang) < 0.5) {
    const retry = await translateText(out, lang);
    out = retry || "";
  }
  if (!out) {
    // Модель не дала перевода: если исходная мысль уже на языке озвучки,
    // читаем её как есть. Порог тот же, что у translateText (0.9): текст,
    // наполовину состоящий из английских слов, по-русски звучит как каша,
    // поэтому лучше промолчать.
    if (reason.translate && langRatio(rtext, lang) >= 0.9) {
      out = stripCode(rtext).slice(0, 1200);
      log("REASON: translate failed, original");
    } else if (reason.translate) {
      // Иначе молчим: локальный пересказ и машинный перевод звучали как бред.
      log("SKIP: reason not translated");
      return;
    } else {
      out = stripCode(rtext).slice(0, reason.mode === "brief" ? 300 : 1200);
    }
  }
  out = lang === "ru" ? agreeGender(out, rgender).trim() : out.trim();
  if (!out) {
    log("SKIP: reason empty");
    return;
  }
  log("REASON:", rsid, reason.mode, reason.translate ? "tr" : "-", out.length);
  // Дедуп ставим только сейчас: раньше он занимал имя до перевода, и если
  // модель падала или фразу съедал mute, повтор уже резался как «duplicate».
  if (!claimReason(rkey)) {
    log("SKIP: reason duplicate");
    return;
  }
  // Звук выключен (в этом чате) — фразу отдаём окну текстом, как для озвучки.
  if (readMutedFor(rsid) || inQuietHours()) {
    noteSilent(out, rsid, "reason");
    log("SKIP: reason muted, bubble only");
    return;
  }
  speak(
    out,
    rsid,
    rvoice,
    reason.mode === "brief" ? limitFor(rsid, rvoice, "reason") : FULL_MAX_CHARS,
    "think",
    "reason",
  );
}

function speakTera(text, sid, forced, emotion, kind, styleOverride) {
  try {
    if (!fs.existsSync(TERATTS)) return false;
  } catch (e) {
    return false;
  }
  try {
    // Язык озвучки — кнопка EN/RU в панели, по тексту он больше не угадывается.
    const lang = voiceLang();
    let voice = forced || teraVoice(sid);
    // Окно присылает id пака (px_fx_ghost), а движок знает только базовый
    // голос. Без снятия префикса TERA_EXIT 1 и тишина.
    voice = String(voice || "").replace(/^px_/, "");
    // styleOverride — предпросмотр манеры из панели: скорость и окраску
    // применяем сразу, не дожидаясь записи файла за этим чатом.
    const style = { ...readStyle(sid), ...(styleOverride || {}) };
    const emotionOut = emotion || style.emotion || null;
    let payload = text;
    if (lang === "en") {
      // Движок понимает только <ru>/<en>. Выбранный английский голос уважаем,
      // русский или эффект переводим в eng-голос по полу.
      const g = genderOf(voice) || "f";
      if (!/^eng_/.test(String(voice || ""))) voice = g === "m" ? "eng_m3" : "eng_f3";
      payload = `<en>${String(text).replace(/<\/?[a-z]{2}>/gi, " ").trim()}</en>`;
    }
    const env = { ...process.env };
    if (voice) env.X2AI_TTS_VOICE = voice;
    if (sid) env.X2AI_TTS_SID = sid;
    // Общего ползунка темпа больше нет: у каждого персонажа свой (окраска
    // или «Настроить»), а без него — ровно 1.0.
    env.X2AI_TTS_SCALE = String(style.speed || 1);
    if (emotionOut) env.X2AI_TTS_EMOTION = emotionOut;
    else delete env.X2AI_TTS_EMOTION;
    if (kind) env.X2AI_TTS_KIND = kind;
    else delete env.X2AI_TTS_KIND;
    if (readKeepAlive()) delete env.X2AI_TTS_ONESHOT;
    else env.X2AI_TTS_ONESHOT = "1";
    delete env.X2AI_TTS_TEXT;
    log("TERA_VOICE:", voice || "(default)", sid || "", emotionOut ? `emotion=${emotionOut}` : "");
    const p = spawn(TERATTS, [], { stdio: ["pipe", "ignore", "ignore"], detached: true, env });
    p.on("error", (e) => log("TERA_ERR", e?.message));
    p.on("close", (code) => log("TERA_EXIT", code));
    p.stdin.on("error", () => {});
    p.stdin.write(payload);
    p.stdin.end();
    p.unref();
    return true;
  } catch (e) {
    log("TERA_CATCH", e?.message);
    return false;
  }
}

// Аварийный системный голос: только когда TeraTTS не установлен. Артикуляция
// при этом не двигается — state-файл пишет только TeraTTS.
let sayVoiceCache = null;
function sayVoiceName() {
  if (sayVoiceCache !== null) return sayVoiceCache;
  sayVoiceCache = "";
  const lang = voiceLang();
  const prefer =
    lang === "en" ? ["Samantha", "Alex", "Daniel", "Karen"] : ["Yuri", "Milena", "Anna", "Irina"];
  try {
    const out = spawnSync("say", ["-v", "?"], { encoding: "utf8", timeout: 3000 });
    const lines = String(out.stdout || "").split("\n");
    const col = (line, i) => line.trim().split(/\s+/)[i] || "";
    const names = lines.map((l) => col(l, 0)).filter(Boolean);
    for (const name of prefer) {
      if (names.includes(name)) {
        sayVoiceCache = name;
        break;
      }
    }
    if (!sayVoiceCache) {
      // Знакомых имён нет — берём любой голос нужного языка.
      const want = lang === "en" ? /^en[-_]/i : /^ru[-_]/i;
      const hit = lines.find((l) => want.test(col(l, 1)));
      if (hit) sayVoiceCache = col(hit, 0);
    }
  } catch (e) {}
  return sayVoiceCache;
}

function speakSay(text) {
  const voice = sayVoiceName();
  const args = voice ? ["-v", voice, text] : [text];
  try {
    const p = spawn("say", args, { stdio: "ignore", detached: true });
    p.on("error", (e) => log("SAY_ERR", e?.message));
    p.unref();
  } catch (e) {
    log("SAY_CATCH", e?.message);
  }
}

// Звук выключен, но текст всё равно отдаём окну: пузырь показывает фразу
// без озвучки и без артикуляции.
// Заметка обязана жить в файле: плагин перезагружается на каждом шаге, и
// заметка в памяти исчезала раньше, чем окно успевало её опросить.
const NOTE_FILE = `${process.env.HOME}/.config/opencode/x2ai-avatar-note.json`;
// Счётчик демо-реакций: POST /demo увеличивает, окно играет все сценки подряд.
const DEMO_FILE = `${process.env.HOME}/.config/opencode/x2ai-demo.json`;
const NOTE_TTL = 10 * 60 * 1000;function readNote(sid) {
  const rec = readJsonCached(NOTE_FILE) || {};
  if (!rec || typeof rec.text !== "string" || !rec.text) return null;
  if (Date.now() - Number(rec.at || 0) >= NOTE_TTL) return null;
  // Заметка адресная: чат видит только свою мысль, чужие не всплывают.
  const want = String(sid || "");
  if (want && String(rec.sid || "") !== want) return null;
  return rec;
}
// Реакция окна по событию моста: компактизация контекста живёт в событиях
// сервера, а окно надёжнее узнаёт о ней опросом /state. Метка адресная —
// чужой чат её не увидит — и живёт недолго, чтобы не проиграться после Cmd+R.
const REACT_FILE = `${process.env.HOME}/.config/opencode/x2ai-avatar-react.json`;
const REACT_TTL = 120 * 1000;
function readReact(sid) {
  const rec = readJsonCached(REACT_FILE) || {};
  if (!rec || !rec.kind) return null;
  if (Date.now() - Number(rec.at || 0) >= REACT_TTL) return null;
  const want = String(sid || "");
  if (want && String(rec.sid || "") !== want) return null;
  return { kind: String(rec.kind), n: Number(rec.n) || 0, at: Number(rec.at) || 0 };
}
function writeReact(kind, sid) {
  try {
    const prev = readJsonCached(REACT_FILE) || {};
    const n = (Number(prev.n) || 0) + 1;
    fs.writeFileSync(REACT_FILE, JSON.stringify({ kind, sid: sid || "", n, at: Date.now() }));
  } catch (e) { log("ERR write: " + (e && e.message)); }
}

function noteSilent(text, sid, kind) {  const clean = stripCode(String(text || "")).replace(/\s+/g, " ").trim();
  if (!clean) return;
  const rec = { text: clean.slice(0, 600), sid: sid || "", kind: kind || "", at: Date.now() };
  try {
    fs.writeFileSync(NOTE_FILE, JSON.stringify(rec));
  } catch (e) { log("ERR write: " + (e && e.message)); }
}

function speak(text, sid, voice, maxChars = MAX_CHARS, emotion = null, kind = null, styleOverride = null) {
  const limit = Math.max(60, Number(maxChars) || MAX_CHARS);
  let toSay = decorate(text);
  if (toSay.length > limit) {
    const cut = toSay.slice(0, limit);
    const m = cut.match(/[\s\S]*[.!?…]/);
    toSay = m ? m[0] : cut;
  }
  toSay = stripCode(toSay).replace(/\s+/g, " ").trim();
  if (!toSay) return;
  // Вкладку закрыли: ответ и рассуждения закрытого чата молчат, ручные
  // реплики (/say, /test) сюда не идут — они уже из открытого окна.
  if (!tabOpen(sid)) {
    log("SKIP: tab closed", sid || "");
    return;
  }
  // Страховка от чужого языка: блокируем только когда текста на языке
  // озвучки меньше, чем на другом.
  const cyrCount = (toSay.match(/[А-Яа-яЁё]/g) || []).length;
  const latCount = (toSay.match(/[A-Za-z]/g) || []).length;
  const speakLang = voiceLang();
  if (speakLang === "ru" && cyrCount < 20 && latCount > cyrCount) {
    log("SKIP: not russian", cyrRatio(toSay).toFixed(2), toSay.slice(0, 60));
    return;
  }
  if (speakLang === "en" && latCount < 20 && cyrCount > latCount) {
    log("SKIP: not english", langRatio(toSay, "en").toFixed(2), toSay.slice(0, 60));
    return;
  }
  log("SPEAK:", toSay.slice(0, 100));
  // TeraTTS главный; если его нет — аварийный системный голос, чтобы чат
  // не замолкал совсем (губы при этом не двигаются).
  if (!speakTera(toSay, sid, voice, emotion, kind, styleOverride)) {
    log("TERA: unavailable, fallback say");
    speakSay(toSay);
  }
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
  const namesFile = `${process.env.HOME}/.config/opencode/x2ai-char-names.json`;
  const charVoicesFile = `${process.env.HOME}/.config/opencode/x2ai-char-voices.json`;
  const readCharVoices = () => {
    const value = readJson(charVoicesFile);
    return value && typeof value === "object" ? value : {};
  };
  // Голоса, которые умеет TeraTTS: 4 спикера и 6 эффектов поверх них.
  // Голоса по языкам: движок знает только ru и en. Английские стили лежат
  // в teratts-model/styles, поэтому список для панели один на оба языка.
  const VOICE_LIST = [
    { id: "ru_f1", label: "Аня — женский", labelEn: "Anya — female", lang: "ru", kind: "voice" },
    { id: "ru_f2", label: "Мила — женский, ниже", labelEn: "Mila — female, lower", lang: "ru", kind: "voice" },
    { id: "ru_m1", label: "Гриша — мужской", labelEn: "Grisha — male", lang: "ru", kind: "voice" },
    { id: "ru_m5", label: "Тимур — мужской, ниже", labelEn: "Timur — male, lower", lang: "ru", kind: "voice" },
    { id: "fx_robot", label: "Робот — кольцевая модуляция", labelEn: "Robot — ring modulation", lang: "ru", kind: "effect" },
    { id: "fx_demon", label: "Демон — мужской, питч вниз", labelEn: "Demon — male, pitch down", lang: "ru", kind: "effect" },
    { id: "fx_demoness", label: "Демонесса — женский, низкий, хриплый", labelEn: "Demoness — female, low, husky", lang: "ru", kind: "effect" },
    { id: "fx_alien", label: "Пришелец — вибрато", labelEn: "Alien — vibrato", lang: "ru", kind: "effect" },
    { id: "fx_cat", label: "Кот — питч вверх", labelEn: "Cat — pitch up", lang: "ru", kind: "effect" },
    { id: "fx_penguin", label: "Пришелец — высокий писк", labelEn: "Alien — high squeak", lang: "ru", kind: "effect" },
    { id: "fx_ghost", label: "Призрак — реверб", labelEn: "Ghost — reverb", lang: "ru", kind: "effect" },
    { id: "eng_f3", label: "F3 — female", labelEn: "F3 — female", lang: "en", kind: "voice" },
    { id: "eng_f4_whisper", label: "F4 — female, whisper", labelEn: "F4 — female, whisper", lang: "en", kind: "voice" },
    { id: "eng_f5", label: "F5 — female, bright", labelEn: "F5 — female, bright", lang: "en", kind: "voice" },
    { id: "eng_m2_whisper", label: "M2 — male, whisper", labelEn: "M2 — male, whisper", lang: "en", kind: "voice" },
    { id: "eng_m3", label: "M3 — male", labelEn: "M3 — male", lang: "en", kind: "voice" },
    { id: "eng_m4", label: "M4 — male, low", labelEn: "M4 — male, low", lang: "en", kind: "voice" },
  ];
  const send = (res, code, payload) => {
    res.writeHead(code, CORS);
    res.end(JSON.stringify(payload));
  };
  // Голоса, которые лежат на диске, но которых нет в списке выше. Так в панель
  // попадают смешанные стили из tools/make_voice.py — иначе голос работает,
  // но выбрать его нельзя. Человеческое имя ("Гопник") берём из файла меток:
  // каталог стилей живёт вне репо, а имя пользователь задаёт один раз.
  const extraVoices = () => {
    const known = new Set(VOICE_LIST.map((v) => v.id));
    let labels = {};
    try {
      const raw = JSON.parse(fs.readFileSync(VOICE_LABELS, "utf8"));
      if (raw && typeof raw === "object") labels = raw;
    } catch (e) {}
    return installedVoices()
      .filter((id) => !known.has(id))
      .sort()
      .map((id) => ({
        id,
        label: labels[id] || id,
        labelEn: labels[id] || id,
        lang: /^eng_/.test(id) ? "en" : "ru",
        kind: "voice",
      }));
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

  const stopTts = (sid) => {
    try {
      const net = require("node:net");
      const socket = net.createConnection("/tmp/x2ai-teratts.sock");
      socket.on("error", () => {});
      socket.end(JSON.stringify({ stop: true, sid: sid || "" }) + "\n");
    } catch (e) {}
  };

  const server = http.createServer((req, res) => {
    const route = String(req.url || "/").split("?")[0];
    const query = new URLSearchParams(String(req.url || "").split("?")[1] || "");
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
        text: state.text || "",
        at: Number(state.at) || 0,
        voices: readVoices(),
        charVoices: readCharVoices(),
        names: readJson(namesFile) || {},
        modelDisabled: !sumModel(),
        // Пока фраза свежая: текст для пузыря, когда звук выключен.
        note: readNote(query.get("sid") || ""),
        // Mute — на конкретный чат: окно передаёт свой sid в запросе.
        muted: readMutedFor(query.get("sid") || ""),
        // Демо реакций: число меняется по POST /demo, окно играет все сценки.
        demo: Number((readJson(DEMO_FILE) || {}).n) || 0,
        // Компактизация контекста: метка реакции для этого чата.
        react: readReact(query.get("sid") || ""),
        // Получал ли этот чат правила общения — видно в панели «Дополнительно».
        rules: rulesSeen(query.get("sid") || ""),
      });
      return;
    }
    if (req.method === "GET" && route === "/log") {
      // Хвост журнала для панели: без него непонятно, почему персонаж молчит.
      const n = Math.min(200, Math.max(1, Number(query.get("lines")) || 20));
      let lines = [];
      try {
        lines = fs.readFileSync(LOG, "utf8").trim().split("\n").slice(-n);
      } catch (e) {
        log("ERR log-read: " + (e && e.message));
      }
      send(res, 200, { lines });
      return;
    }
    if (req.method === "GET" && route === "/voices") {
      send(res, 200, {
        voices: [...VOICE_LIST, ...extraVoices()],
        charVoices: readCharVoices(),
        installed: installedVoices(),
        engine: fs.existsSync(TERATTS),
        // Готовые описания характеров: окно показывает их плейсхолдером
        // в поле «свой характер».
        tempers: TEMPER_TEXT,
      });
      return;
    }
    // Паки спрайтов: список (манифест + внешние папки) и кадры одного пака.
    // В бандл окна кадры не зашиты — оно грузит только выбранный пак.
    if (req.method === "GET" && route === "/packs") {
      const packs = {};
      try {
        const index = JSON.parse(fs.readFileSync(`${PACK_DIR}/index.json`, "utf8"));
        for (const [name, voices] of Object.entries(index || {})) {
          packs[name] = { voices: Array.isArray(voices) ? voices : [] };
        }
      } catch (e) {}
      try {
        for (const dir of fs.readdirSync(EXT_PACK_DIR)) {
          const file = `${EXT_PACK_DIR}/${dir}/sprites.json`;
          if (!fs.existsSync(file)) continue;
          const data = JSON.parse(fs.readFileSync(file, "utf8"));
          if (data && typeof data === "object" && !packs[dir]) {
            packs[dir] = { voices: Object.keys(data), external: true };
          }
        }
      } catch (e) {}
      send(res, 200, { packs });
      return;
    }
    if (req.method === "GET" && route === "/pack") {
      const name = String(new URLSearchParams(String(req.url || "").split("?")[1] || "").get("name") || "")
        .replace(/[^\w-]/g, "")
        .slice(0, 40);
      if (!name) {
        send(res, 400, { error: "name" });
        return;
      }
      for (const file of [`${PACK_DIR}/${name}.json`, `${EXT_PACK_DIR}/${name}/sprites.json`]) {
        try {
          if (fs.existsSync(file)) {
            send(res, 200, JSON.parse(fs.readFileSync(file, "utf8")));
            return;
          }
        } catch (e) {}
      }
      send(res, 404, { error: "no pack" });
      return;
    }
    // Настройки персонажей: файл и обратно — перенос между окнами и машинами.
    // POST /settings/export живёт в блоке разбора тела, ниже: ему нужен payload.
    if (req.method === "GET" && route === "/settings/import") {
      try {
        const data = JSON.parse(fs.readFileSync(SETTINGS_BACKUP, "utf8"));
        send(res, 200, data && typeof data === "object" ? data : {});
      } catch (e) {
        send(res, 200, {});
      }
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
        lang: readLang(),
        langs: LANGS,
        // Окно спрашивает про свой чат: у каждого свой mute.
        muted: readMutedFor(query.get("sid") || ""),
      });
      return;
    }
    if (req.method === "GET" && route === "/user") {
      send(res, 200, { user: readUser() });
      return;
    }
    if (req.method === "GET" && route === "/models") {
      listModels()
        .then((out) => send(res, 200, { ...out, current: readModel(), disabled: !sumModel() }))
        .catch(() => send(res, 200, { models: [], source: "error", current: readModel(), disabled: !sumModel() }));
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
      // Настройки персонажей в файл: перенос между окнами и машинами.
      if (req.method === "POST" && route === "/settings/export") {
        const data = {
          at: new Date().toISOString(),
          chars: payload && typeof payload.chars === "object" ? payload.chars : {},
          ui: payload && typeof payload.ui === "object" ? payload.ui : {},
          pack: typeof payload.pack === "string" ? payload.pack : "",
          lang: typeof payload.lang === "string" ? payload.lang : "",
        };
        try {
          fs.writeFileSync(SETTINGS_BACKUP, JSON.stringify(data, null, 2));
          send(res, 200, { ok: true, path: SETTINGS_BACKUP });
        } catch (e) {
          send(res, 200, { ok: false });
        }
        return;
      }
      if (req.method === "POST" && route === "/voice") {
        if (payload.sid && payload.voice) {
          const map = readVoices();
          // Храним базовый голос: px_* — это id пака, движок их не знает.
          map[payload.sid] = String(payload.voice).replace(/^px_/, "");
          try {
            fs.writeFileSync(voicesFile, JSON.stringify(map, null, 2));
  } catch (e) { log("ERR write: " + (e && e.message)); }
        }
        // Имя персонажа приходит из окна: только оно знает пак (px_/аниме).
        if (payload.sid && payload.name) {
          const names = readJson(namesFile) || {};
          names[payload.sid] = String(payload.name).slice(0, 40);
          try {
            fs.writeFileSync(namesFile, JSON.stringify(names, null, 2));
  } catch (e) { log("ERR write: " + (e && e.message)); }
        }
        // Характер: галочка в настройках персонажа. Ключ пака нужен, потому
        // что px_ru_f1 (Тянка) и ru_f1 (Аня) — разные персонажи на одном голосе.
        if (
          payload.sid &&
          (payload.charKey !== undefined || payload.temper !== undefined || payload.temperText !== undefined)
        ) {
          const map = readJson(TEMPER_FILE) || {};
          const prev = map[payload.sid] && typeof map[payload.sid] === "object" ? map[payload.sid] : {};
          const next = {
            key: payload.charKey !== undefined ? String(payload.charKey).slice(0, 40) : String(prev.key || ""),
            on: payload.temper !== undefined ? Boolean(payload.temper) : prev.on !== false,
            // Свой текст характера: пусто — берётся готовый пресет персонажа.
            text:
              payload.temperText !== undefined
                ? String(payload.temperText).replace(/\s+/g, " ").trim().slice(0, 400)
                : String(prev.text || ""),
          };
          if (next.key !== prev.key || next.on !== prev.on || next.text !== prev.text) {
            map[payload.sid] = next;
            try {
              fs.writeFileSync(TEMPER_FILE, JSON.stringify(map, null, 2));
  } catch (e) { log("ERR write: " + (e && e.message)); }
            unmarkRulesSeen(payload.sid);
          }
        }
        // Манера озвучки персонажа: 0 — как в общих настройках.
        if (payload.sid && (payload.speed !== undefined || payload.emotion !== undefined)) {
          const map = readJson(STYLE_FILE) || {};
          const prev = map[payload.sid] && typeof map[payload.sid] === "object" ? map[payload.sid] : {};
          const rawSpeed = Number(payload.speed);
          const next = {
            speed:
              payload.speed !== undefined
                ? Number.isFinite(rawSpeed) && rawSpeed >= 0.7 && rawSpeed <= 1.8
                  ? Math.round(rawSpeed * 100) / 100
                  : 0
                : Number(prev.speed) || 0,
            emotion:
              payload.emotion !== undefined
                ? ["up", "think", "down"].includes(payload.emotion)
                  ? payload.emotion
                  : ""
                : String(prev.emotion || ""),
          };
          if (next.speed !== prev.speed || next.emotion !== prev.emotion) {
            map[payload.sid] = next;
            try {
              fs.writeFileSync(STYLE_FILE, JSON.stringify(map, null, 2));
  } catch (e) { log("ERR write: " + (e && e.message)); }
          }
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
  } catch (e) { log("ERR write: " + (e && e.message)); }
        }
        send(res, 200, { ok: true, charVoices: readCharVoices() });
        return;
      }
      if (req.method === "POST" && route === "/chars") {
        if (Array.isArray(payload.voices)) {
          try {
            const list = payload.voices.filter((v) => typeof v === "string").slice(0, 30);
            fs.writeFileSync(ENABLED_FILE, JSON.stringify(list));
          } catch (e) {
            log("ERR chars-enabled: " + (e && e.message));
          }
        }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && route === "/model") {
        // Выключение не стирает выбранную модель: иначе «Включено» нечего
        // возвращать, и селект в панели отскакивал назад на «Отключено».
        const prev = readJsonCached(modelFile) || {};
        if (payload.disabled) {
          try {
            fs.writeFileSync(modelFile, JSON.stringify({ ...prev, disabled: true }, null, 2));
  } catch (e) { log("ERR write: " + (e && e.message)); }
        } else if (payload.providerID && payload.id) {
          try {
            fs.writeFileSync(
              modelFile,
              JSON.stringify({ providerID: payload.providerID, id: payload.id }, null, 2),
            );
          } catch (e) {
            log("ERR model-save: " + (e && e.message));
          }
        } else if (prev.disabled && prev.providerID && prev.id) {
          try {
            fs.writeFileSync(
              modelFile,
              JSON.stringify({ providerID: prev.providerID, id: prev.id }, null, 2),
            );
          } catch (e) {
            log("ERR model-restore: " + (e && e.message));
          }
        }
        send(res, 200, { ok: true, current: readModel(), disabled: !sumModel() });
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
            lang: readLang(),
          muted: readMutedFor(payload.sid || ""),
        };
        if (SPEECH_MODES.includes(payload.mode)) next.mode = payload.mode;
        const sp = Number(payload.speed);
        if (Number.isFinite(sp) && sp >= 0.7 && sp <= 1.8) {
          next.speed = Math.round(sp * 100) / 100;
        }
        if (payload.keepAlive !== undefined) next.keepAlive = Boolean(payload.keepAlive);
        if (LANGS.includes(payload.lang)) next.lang = payload.lang;
        if (payload.muted !== undefined) {
          // Пишем только за этот чат: соседние вкладки не глушим.
          writeMutedFor(payload.sid, payload.muted);
          next.muted = Boolean(payload.muted);
        }
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
        send(res, 200, { ok: true, ...next, langs: LANGS });
        return;
      }
      if (req.method === "POST" && route === "/power") {
        const on = payload.on !== false;
        try {
          if (on) {
            try { fs.unlinkSync(OFF_FILE); } catch (e) {}
          } else {
            fs.writeFileSync(OFF_FILE, "off\n");
          }
        } catch (e) {
          log("POWER: file err " + (e && e.message));
        }
        if (on) {
          startEngine();
        } else {
          // Выгрузка движка: сервер не нужен, пока плагин выключен.
          try { spawnSync("pkill", ["-x", "x2ai-voice"]); } catch (e) {}
          log("POWER: off");
        }
        send(res, 200, { ok: true, on });
        return;
      }
      if (req.method === "POST" && route === "/say") {
        if (!enabled()) {
          send(res, 200, { ok: false, reason: "off" });
          return;
        }
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
        // kind=rage: злая реплика персонажа. Окно по нему держит красную
        // подсветку до конца звука (state.kind).
        const kind = String(payload.kind || "") === "rage" ? "rage" : null;
        // Окно присылает голос персонажа само: у фоновых чатов в файле привязок
        // может не быть записи, и хеш-фолбэк давал случайный (иногда женский) голос.
        const forced = typeof payload.voice === "string" && payload.voice ? payload.voice : "";
        const voice = forced || effectiveVoice(ssid);
        log("SAY:", ssid, voice || "(default)");
        speak(text, ssid, voice, MAX_CHARS, emo, kind);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && route === "/limits") {
        const voice = String(payload.voice || "").replace(/^px_/, "");
        if (voice) {
          const map = readLimits();
          const rec = map[voice] && typeof map[voice] === "object" ? map[voice] : {};
          const clamp = (v) => Math.max(80, Math.min(1200, Math.round(Number(v) || 0)));
          if (payload.speech !== undefined) rec.speech = clamp(payload.speech);
          if (payload.reason !== undefined) rec.reason = clamp(payload.reason);
          map[voice] = rec;
          const sid = String(payload.sid || "");
          if (sid) map[sid] = { ...rec };
          try {
            fs.writeFileSync(LIMITS_FILE, JSON.stringify(map, null, 2));
  } catch (e) { log("ERR write: " + (e && e.message)); }
        }
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && route === "/test") {
        // Пробная фраза текущим голосом и с текущей скоростью. Через speak(),
        // чтобы сервер записал state с текстом — тогда двигаются губы.
        // speed/emotion приходят из панели: ползунок проигрывает реплику
        // сразу, ещё до сохранения настроек за чатом.
        const phrase =
          voiceLang() === "en"
            ? "Testing the voice. One, two, three."
            : "Проверка озвучки. Раз, два, три.";
        const style = {};
        const speed = Number(payload.speed);
        if (speed >= 0.5 && speed <= 2.5) style.speed = Math.round(speed * 100) / 100;
        const emo = String(payload.emotion || "");
        if (emo === "up" || emo === "think" || emo === "down") style.emotion = emo;
        speak(
          phrase,
          String(payload.sid || ""),
          payload.voice || null,
          MAX_CHARS,
          style.emotion || null,
          null,
          style,
        );
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && route === "/open") {
        // Окно сообщает, какие вкладки открыты. Пропавшие чаты глушим сразу,
        // иначе фраза, начатая до закрытия, доиграет в закрытой вкладке.
        const ids = Array.isArray(payload.ids)
          ? payload.ids.map((v) => String(v || "").slice(0, 60)).filter(Boolean).slice(0, 200)
          : [];
        let prev = [];
        try {
          const old = JSON.parse(fs.readFileSync(OPEN_FILE, "utf8"));
          prev = old && Array.isArray(old.ids) ? old.ids : [];
        } catch (e) {}
        try {
          fs.writeFileSync(OPEN_FILE, JSON.stringify({ at: Date.now(), ids }));
  } catch (e) { log("ERR write: " + (e && e.message)); }
        for (const gone of prev) if (!ids.includes(gone)) stopTts(gone);
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === "POST" && route === "/demo") {
        // Демонстрация всех реакций: счётчик растёт, окно видит новое число
        // в /state и ставит все сценки в очередь.
        const n = (Number((readJson(DEMO_FILE) || {}).n) || 0) + 1;
        try {
          fs.writeFileSync(DEMO_FILE, JSON.stringify({ n, at: Date.now() }));
  } catch (e) { log("ERR write: " + (e && e.message)); }
        send(res, 200, { ok: true, n });
        return;
      }
      if (req.method === "POST" && route === "/stop") {
        stopTts(String(payload.sid || ""));
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
      // Мост нужен и при выключенном плагине: через него приходит /power.
      // Подписку не обрываем, события просто игнорируются (гейт в цикле).
      log("SETUP: disabled, bridge only");
    }
    if (!ctx?.event?.subscribe) {
      log("SETUP: no ctx.event.subscribe");
      return;
    }

    genText = ctx?.experimental?.generate?.text || ctx?.generate?.text || null;
    log("SETUP: subscribed", genText ? "llm=on" : "llm=off");
    // Подписку НЕ глушим при перезагрузке: событие завершения хода могло
    // прийти ровно в этот момент и терялось. Дубли гасятся дедупом по хешу.
    const ac = new AbortController();

    (async () => {
      try {
        for await (const ev of ctx.event.subscribe({ signal: ac.signal })) {
          const type = ev?.type;
          const data = ev?.data || {};
          // Плагин выключен кнопкой питания — ни озвучки, ни реакций.
          if (!enabled()) continue;

          // Диагностика: один раз за жизнь процесса пишем имя каждого события
          // из «исполнительных», чтобы знать, на что можно подписываться.
          if (/execution|message\.created|tool\./.test(String(type))) {
            if (!globalThis.__x2aiEvSeen) globalThis.__x2aiEvSeen = new Set();
            if (!globalThis.__x2aiEvSeen.has(type)) {
              globalThis.__x2aiEvSeen.add(type);
              log("EV:", type, JSON.stringify(Object.keys(data)).slice(0, 120));
            }
          }

          // Компактизация контекста: отдельное семейство событий, в обычную
          // озвучку не попадает. Пишем в журнал — по нему видно, что /compact
          // дошёл до плагина, а реакцию в окне играет GUI.
          if (String(type).startsWith("session.compaction.")) {
            const csid = data.sessionID || "";
            const creason = data.reason || "-";
            if (type === "session.compaction.started") {
              log("COMPACT: started", csid, creason);
              writeReact("compact", csid);
            } else if (type === "session.compaction.ended") {
              log("COMPACT: done", csid, creason, String(data.text || "").length);
              writeReact("compactDone", csid);
            } else if (type === "session.compaction.failed") {
              log("COMPACT: failed", csid, creason, (data.error && data.error.name) || "");
              writeReact("compactFailed", csid);
            }
            continue;
          }

          if (TOOL_FAILS.has(type)) {
            const tsid = data.sessionID || "";
            if (tsid) {
              log("TOOLFAIL:", tsid, String((data.error && data.error.name) || "").slice(0, 40));
              writeReact("rage", tsid);
            }
            continue;
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
          const voice = effectiveVoice(sid);
          const gender = genderOf(voice);
          const mode = readSpeech();
          // Только «озвучка выключена» глушит полностью; mute — повод показать
          // фразу текстом в пузыре (текст считаем так же, как для голоса).
          if (mode === "silent") {
            log("SKIP: silent mode");
            continue;
          }
          // Дедуп — только после проверок «молчать»: иначе фраза помечалась
          // произнесённой, хотя её не озвучивали, и больше не звучала.
          if (alreadySpoken(hash(clean))) {
            log("TRIGGER: duplicate, skipped");
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
            if (long) {
              source = `${voiceLang() === "en" ? "Lots of details, in short. " : "Много деталей, коротко. "}${source}`;
            }
          }
          const summary = voiceLang() === "ru" ? agreeGender(source, gender) : source;
          log("GENDER:", gender || "-", voice, "mode:", mode);
          if (langRatio(summary, voiceLang()) < 0.5) {
            log("SKIP: not " + voiceLang(), summary.slice(0, 60));
            continue;
          }
          // Звук выключен в этом чате (mute или тихие часы) — отдаём текст в пузырь.
          if (readMutedFor(sid) || inQuietHours()) {
            noteSilent(summary, sid, "");
            log("SKIP: muted, bubble only");
            continue;
          }
          speak(summary, sid, voice, mode === "full" ? FULL_MAX_CHARS : limitFor(sid, voice, "speech"), "up");
        }
      } catch (e) {
        log("SUBSCRIBE_END", e?.message);
      }
    })();

    // Правила общения: подмешиваем в системные инструкции первого запроса чата,
    // поэтому в переписке они не видны вообще.
    try {
      await ctx.session.hook("context", (event) => {
        const sid =
          event.sessionID || (event.session && event.session.id) || (event.metadata && event.metadata.sessionID) || "";
        if (sid && rulesSeen(sid)) return;
        const user = readUser();
        const voice = sid ? effectiveVoice(sid) : "";
        const agentGender = genderOf(voice);
        const rules = [];
        const charName = readCharName(sid) || nameOf(voice);
        if (charName) {
          rules.push(`Тебя зовут ${charName}. Пользователь может обращаться к тебе по имени.`);
        }
        if (agentGender === "f") {
          rules.push("Ты — женский персонаж. О себе говори в женском роде: «я проверила», «я сделала», «я нашла».");
        } else if (agentGender === "m") {
          rules.push("Ты — мужской персонаж. О себе говори в мужском роде: «я проверил», «я сделал», «я нашёл».");
        }
        // Характер: краткая манера речи персонажа, если её включили в настройках.
        const temper = readTemper(sid);
        const temperText = !temper.on
          ? ""
          : temper.text ||
            TEMPER_TEXT[temper.key] ||
            TEMPER_TEXT[temper.key.replace(/^px_/, "")] ||
            "";
        if (temperText) {
          rules.push(
            `Твой характер: ${temperText}. Держи эту манеру речи в ответах, но факты, код и команды не искажай. ${OFFTOPIC_RULE.ru}`
          );
        }
        if (user.name) rules.push(`Пользователя зовут ${user.name}.`);
        if (user.gender === "f") {
          rules.push("Пользователь — женщина. Обращаясь к ней, используй женский род: «ты проверила», «ты права».");
        } else if (user.gender === "m") {
          rules.push("Пользователь — мужчина. Обращаясь к нему, используй мужской род: «ты проверил», «ты прав».");
        }
        if (!rules.length) return;
        if (sid) markRulesSeen(sid);
        event.system.push({ type: "text", text: `[Правила общения]\n${rules.join("\n")}` });
        log("PROMPT_RULES:", sid || "-", rules.length);
      });
    } catch (e) {
      log("PROMPT_HOOK_ERR", e?.message);
    }

    return () => ac.abort();
  },
};
