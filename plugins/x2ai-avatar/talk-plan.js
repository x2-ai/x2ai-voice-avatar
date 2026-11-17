// Артикуляция: чистые функции без DOM. Живут отдельным файлом, чтобы их
// можно было проверить тестом (tools/test_talk_plan.js), а не глазами на окне.
// Сборщик подставляет содержимое в gui-experimental.cjs перед строкой
// `const TALKPLAN = x2aiTalkPlanModule();`.
const x2aiTalkPlanModule = () => {
  // Гласные дают свою форму рта, согласные — закрытый кадр.
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
    // Латинские гласные: без них английская речь шла без движения рта.
    a: "wide",
    o: "open",
    u: "round",
    e: "half",
    i: "half",
    y: "half",
  };

  const frameFor = (ch) => VOWEL_FRAME[ch] || "closed";

  const charWeight = (ch) => {
    if (VOWEL_FRAME[ch]) return 1.7;
    if (/[.!?…]/.test(ch)) return 3.5;
    if (/[,;:]/.test(ch)) return 2.2;
    if (/[—–-]/.test(ch)) return 2.5;
    if (/\s/.test(ch)) return 1.2;
    return 0.9;
  };

  // Партитура: каждый звук — «подход → держим → отпускаем». Теги <ru>/<en>
  // и любые не-буквы отбрасываем, иначе рот дёргается на разметке.
  const buildTalkPlan = (text, ms) => {
    const chars = String(text || "")
      .toLowerCase()
      .replace(/<\/?[a-z]{2}>/gi, " ")
      .replace(/[^a-zа-яё\s.,!?;:—–…-]/g, "")
      .split("");
    if (!chars.length) return null;
    const total = chars.reduce((acc, ch) => acc + charWeight(ch), 0) || 1;
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

  // State приходит с задержкой до 0.8 с: прошедшие кадры надо выкинуть, иначе
  // рот отстаёт от звука и замолкает раньше него. Возвращает новый массив,
  // исходный план не мутирует. Если `skip` попал в середину кадра, остаток
  // его задержки сохраняется.
  const skipPassed = (plan, ms) => {
    let skip = Math.max(0, Number(ms) || 0);
    const rest = [];
    for (const item of plan) {
      if (skip > 0) {
        if (item.delay <= skip) {
          skip -= item.delay;
          continue;
        }
        rest.push({ frame: item.frame, delay: item.delay - skip });
        skip = 0;
        continue;
      }
      rest.push(item);
    }
    return rest;
  };

  return { VOWEL_FRAME, frameFor, charWeight, buildTalkPlan, skipPassed };
};

// В GUI (`new Function`) module нет — проверка через typeof, а не прямое чтение.
if (typeof module !== "undefined" && module.exports) module.exports = x2aiTalkPlanModule;
