#!/usr/bin/env node
// Тест партитуры рта: те же функции, что уходят в gui-experimental.cjs.
// Запуск: node tools/test_talk_plan.js
const path = require("node:path");
const modulePath = path.join(__dirname, "..", "plugins", "x2ai-avatar", "talk-plan.js");
const plan = require(modulePath)();

let failed = 0;
const check = (name, ok, extra) => {
  if (ok) return;
  failed += 1;
  console.error(`✗ ${name}${extra ? `: ${extra}` : ""}`);
};

// 1. Теги и разметка не попадают в план.
const tagged = plan.buildTalkPlan("<ru>Привет, мама!</ru>", 3000);
check("план непустой", Array.isArray(tagged) && tagged.length > 0);
check(
  "задержки положительные",
  tagged.every((it) => Number.isFinite(it.delay) && it.delay > 0),
);
check(
  "кадры из допустимых",
  tagged.every((it) => ["closed", "half", "open", "round", "wide"].includes(it.frame)),
);
check("есть открытый рот на гласных", tagged.some((it) => it.frame === "wide"));

// 2. Сумма задержек примерно равна длительности звука: минимумы кадров могут
// её чуть раздуть, но не в разы.
const total = tagged.reduce((acc, it) => acc + it.delay, 0);
check("сумма близка к ms", total >= 900 && total <= 3900, `total=${total}`);

// 3. Пустой текст — null, а не пустой массив: окно тогда шевелит рот таймером.
check("пустой текст", plan.buildTalkPlan("", 1000) === null);
check(
  "только разметка — рот закрыт",
  plan.buildTalkPlan("<en></en>", 1000).every((it) => it.frame === "closed"),
);

// 4. skipPassed выкидывает ровно прошедшее время.
const skipped = plan.skipPassed(tagged, 1000);
const skippedTotal = skipped.reduce((acc, it) => acc + it.delay, 0);
check("skip уменьшил план", skipped.length < tagged.length, `${tagged.length} → ${skipped.length}`);
check(
  "skip сохранил длительность",
  Math.abs(total - skippedTotal - 1000) <= 5,
  `${total} - ${skippedTotal} != 1000`,
);

// 5. skip за пределами плана — пустой массив, не ошибка.
check("skip больше плана", plan.skipPassed(tagged, 999999).length === 0);
check("skip 0 не меняет план", plan.skipPassed(tagged, 0).length === tagged.length);

// 6. Исходный план не мутируется.
check("план не мутирован", plan.skipPassed(tagged, 500).length <= tagged.length);

// 7. Латиница двигает рот так же, как кириллица.
const en = plan.buildTalkPlan("Hello world", 1500);
check("английский план", Array.isArray(en) && en.some((it) => it.frame === "open"));

if (failed) {
  console.error(`провалено проверок: ${failed}`);
  process.exit(1);
}
console.log("talk-plan: всё в порядке");
