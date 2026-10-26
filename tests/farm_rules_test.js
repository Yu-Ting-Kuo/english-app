// 學習農場規則測試（不需要瀏覽器）：node tests/farm_rules_test.js
// 用假的時鐘與 localStorage 載入 game.js + farm.js，模擬好幾天的練習，檢查成長、缺水、枯死、救援、收成與成就。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const SRC = ['game.js', 'farm.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');

let NOW = 0;
const store = {};
const toasts = [];
function boot() {
  const ctx = {
    console, Math, JSON, Object, Array, Set, Promise, Number, String, Error, Intl,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { hidden: false, addEventListener() {}, getElementById: () => null, querySelector: () => null, createElement: () => ({ addEventListener() {}, querySelector: () => ({}) }), body: { appendChild() {} } },
    toast: m => toasts.push(m), esc: s => String(s), fmtDate: () => '', currentView: 'home', show() {}, practiceId: null,
    setTimeout: (f) => { f(); return 0; }, clearTimeout() {},
  };
  ctx.window = ctx;
  ctx.Date = class extends Date { constructor(...a) { a.length ? super(...a) : super(NOW); } static now() { return NOW; } };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\n;this.Game = Game; this.Farm = Farm;', ctx);
  return ctx;
}
// 台灣時間 → 時間戳
const at = (day, hour = 9, min = 0) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d, hour - 8, min); };
const addDay = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('✅ ' + name); } else { fail++; console.log('❌ ' + name + (extra ? '  → ' + extra : '')); }
}

let G = boot();
const F = () => G.Farm._.state();
const practice = (n, kind = 'quiz', arg = true) => { for (let i = 0; i < n; i++) G.Game.award(kind, arg); };
const go = (day, hour = 9, min = 0) => { NOW = at(day, hour, min); };
const plant = () => F().plant;
const sync = () => G.Farm._.reconcile();

const D0 = '2026-11-02';
go(D0, 8);
// 1. 初次開啟
check('1. 初次開啟：田地空著、只解鎖小番茄', F().plant === null && F().unlocked.join() === 'tomato');
G.Farm._.sow('tomato');
check('1. 播種小番茄 → 種子階段、解鎖「第一顆種子」', plant().crop === 'tomato' && plant().growth === 0 && !!F().ach.seed);

// 2-4. 14 題不長、第 15 題只長一次、分次累計
go(D0, 9); practice(5);
go(D0, 13); practice(5);
go(D0, 20); practice(4);
check('2. 當日 14 題不會澆水成長', plant().growth === 0, `growth=${plant().growth}`);
practice(1);
check('3/4. 分三次累計到第 15 題 → 成長 1 天', plant().growth === 1 && plant().wateredToday);
practice(20);
check('3/5. 繼續練到 35 題，同一天不會重複成長', plant().growth === 1, `growth=${plant().growth}`);
check('   每日題數和原本統計一致（Game 紀錄 35 題）', G.Game.days()[D0].n === 35);

// 13. 重新整理（重新載入程式）結果不變
G = boot(); sync();
check('13. 重新載入後植物狀態一致', plant().growth === 1 && plant().status === 'growing');

// 6. 漏一天 → 缺水
const D1 = addDay(D0, 1), D2 = addDay(D0, 2), D3 = addDay(D0, 3);
go(D1, 10); practice(3);  // 有練但沒達標
go(D2, 7); sync();
check('6. 前一天沒達 15 題 → 缺水，不成長', plant().status === 'thirsty' && plant().growth === 1);
check('   缺水不扣經驗值、不清除其他紀錄', F().ach.seed && G.Game.days()[D0].n === 35);

// 5. 缺水當天 15 題撐住、30 題救回且只長一次
go(D2, 8); practice(15);
check('5. 缺水時練 15 題 → 還是缺水，不成長', plant().status === 'thirsty' && plant().growth === 1);
practice(15);
check('5. 同一天累計 30 題 → 救回並成長 1 天，解鎖「起死回生」', plant().status === 'growing' && plant().growth === 2 && !!F().ach.rescue);
practice(30);
check('5. 救回後再練也不會重複成長或重複救援', plant().growth === 2 && plant().rescues.length === 1);
const rescueT = F().ach.rescue;

// 11. 成熟、收成只一次、解鎖下一種
go(D3, 9); practice(15);
check('11. 小番茄 3 天成熟 → 可收成', plant().status === 'mature' && plant().growth === 3);
const D4 = addDay(D0, 4), D5 = addDay(D0, 5);
go(D5, 9); sync();
check('   成熟後兩天沒練也不會枯萎（成熟當天未收成）', plant().status === 'mature' && !plant().deadDay);
const h1 = G.Farm._.harvest(), h2 = G.Farm._.harvest();
check('10. 收成成功一次、第二次無效，解鎖向日葵與「初次收成」', !!h1 && h2 === null && F().harvests.length === 1 && F().unlocked.includes('sunflower') && !!F().ach.harvest);
check('   成就只解鎖一次（時間沒被改寫）', F().ach.rescue === rescueT);

// 播種當天已達標：那次澆水不算新植物
practice(15);
G.Farm._.sow('sunflower');
check('   播種前今天已達 15 題 → 新植物今天不成長', plant().growth === 0 && plant().need === 5);
// 7. 連續漏兩天 → 枯死
const D6 = addDay(D0, 6), D7 = addDay(D0, 7), D8 = addDay(D0, 8);
go(D8, 9); sync();
check('7. 連續兩天沒達標 → 枯死，記錄枯死日期', F().plant.deadDay === D7 && F().compost === true, JSON.stringify(F().plant && { d: F().plant.deadDay, s: F().plant.status }));
check('7. 枯死的植物不能收成', G.Farm._.harvest() === null && F().harvests.length === 1);
check('8. 枯死後成就、收成紀錄、累積題數都還在', F().ach.seed && F().ach.harvest && F().harvests.length === 1 && G.Game.days()[D0].n === 35);
// 9. 堆肥只對下一株生效一次
G.Farm._.sow('sunflower');
check('9. 枯死後的下一株：堆肥加成，向日葵 5 → 4 天', plant().need === 4 && plant().compost && F().compost === false);

// 救援失敗情境：缺水 → 隔天 15 題撐住 → 再漏一天仍缺水 → 再漏一天枯死
const E = n => addDay(D8, n);
go(E(1), 9); practice(15);                   // 長 1
go(E(3), 9); sync();                         // E2 漏 → 缺水
check('   漏一天後隔天只做 15 題：仍缺水、沒枯死', (go(E(3), 9), practice(15), plant().status === 'thirsty' && !plant().deadDay));
go(E(5), 9); sync();                         // E4 漏（連續漏 1 天）→ 仍缺水
check('   之後只漏一天（不是連續兩天）→ 還是缺水不枯死', plant().status === 'thirsty' && !plant().deadDay, plant().status);
go(E(6), 9); sync();                         // E5 也漏 → 連續兩天 → 枯死
check('   再連續漏第二天 → 枯死', !!plant().deadDay);
G.Farm._.sow('sunflower');
check('9. 再次枯死後下一株也有堆肥（每次枯死給一次）', plant().need === 4);
// 14. 台灣午夜跨日
G = boot();
const M = addDay(D0, 40);
NOW = at(M, 23, 59); practice(10);
NOW = at(M, 24, 1);  // 隔天 00:01
check('14. 台灣時間 23:59 → 00:01 跨日：今日題數歸零', G.Game.dayKey() === addDay(M, 1) && (G.Game.days()[addDay(M, 1)]?.n || 0) === 0);
check('14. 跨日用台灣時間（UTC 15:59 仍是同一天）', (() => { NOW = Date.UTC(2026, 10, 1, 15, 59); const a = G.Game.dayKey(); NOW = Date.UTC(2026, 10, 1, 16, 0); return a === '2026-11-01' && G.Game.dayKey() === '2026-11-02'; })());

// 12. 夜貓子、早起鳥、豐收日、發音、測驗
NOW = at(addDay(M, 2), 3); practice(1);
check('12. 凌晨 3 點練習 → 夜貓子', !!F().ach.owl && !F().ach.bird);
NOW = at(addDay(M, 2), 6, 30); practice(1);
check('12. 早上 6:30 練習 → 早起鳥', !!F().ach.bird);
practice(48);
check('12. 單日 50 題 → 豐收日', !!F().ach.big);
for (let i = 0; i < 9; i++) G.Game.award('speak', 92);
G.Game.award('speak', 70);
check('12. 發音 90 分以上 9 次還沒解鎖（70 分不算）', !F().ach.speak && F().speak90 === 9);
G.Game.award('speak', 95);
check('12. 第 10 次 90 分以上 → 字正腔圓', !!F().ach.speak);
G.Farm.onQuizPerfect(); G.Farm.onQuizPerfect();
check('12. 測驗全對 → 百發百中（重複呼叫不重複解鎖）', !!F().ach.quiz);

// 11/12. 五種作物、連續天數、完美栽培、圖鑑、千題（從乾淨的農場開始，避免前面枯死留下的堆肥加成）
delete store.farm;
G = boot();
let day = addDay(M, 10);
const grow = (crop) => {
  if (F().plant && !F().plant.harvested && !F().plant.deadDay) throw new Error('field busy');
  go(day, 7); G.Farm._.sow(crop);
  const need = plant().need, stages = [];
  for (let i = 0; i < 60 && plant().status !== 'mature'; i++) {
    go(day, 8); practice(15);
    stages.push(G.Farm._.stageOf(plant().growth, plant().need));
    day = addDay(day, 1);
  }
  const ok = plant().growth === need;
  G.Farm._.harvest();
  return { need, stages, ok };
};
const results = ['tomato', 'sunflower', 'apple', 'cherry', 'golden'].map(c => [c, grow(c)]);
for (const [c, r] of results) {
  const mono = r.stages.every((s, i) => i === 0 || s >= r.stages[i - 1]);
  check(`11. ${c}：${r.need} 天成熟，階段依序前進到 6（${[...new Set(r.stages)].join('→')}）`, r.ok && mono && r.stages[r.stages.length - 1] === 6 && r.stages.length === r.need);
}
const need = Object.fromEntries(results.map(([c, r]) => [c, r.need]));
check('11. 天數符合規格：3 / 5 / 7 / 14 / 30', need.tomato === 3 && need.sunflower === 5 && need.apple === 7 && need.cherry === 14 && need.golden === 30, JSON.stringify(need));
check('12. 五種都收成 → 植物圖鑑；全部解鎖', !!F().ach.dex && F().unlocked.length === 5);
check('12. 連續 7、30 天達標 → 一週不間斷、月月耕耘；100 天還沒', !!F().ach.s7 && !!F().ach.s30 && !F().ach.s100);
check('12. 櫻花樹與金蘋果樹都沒缺水 → 完美栽培', !!F().ach.perfect && F().harvests.filter(h => h.perfect).map(h => h.crop).sort().join() === 'cherry,golden');
check('12. 累計 1,000 題 → 千題達人', !!F().ach.k1000, `total=${Object.values(G.Game.days()).reduce((s, d) => s + d.n, 0)}`);
const achCount = Object.keys(F().ach).length;
G = boot(); sync();
check('13. 重新載入後成就數量不變', Object.keys(F().ach).length === achCount);

// 有缺水過的 14 天作物 → 不算完美栽培
store.farm = JSON.stringify({ ...JSON.parse(store.farm), ach: {}, harvests: [] });
G = boot();
go(day, 7); G.Farm._.sow('cherry');
go(day, 8); practice(15); day = addDay(day, 2);           // 漏一天
go(day, 8); practice(30);                                  // 救回
for (let i = 0; i < 20 && plant().status !== 'mature'; i++) { day = addDay(day, 1); go(day, 8); practice(15); }
G.Farm._.harvest();
check('12. 曾經缺水的櫻花樹收成 → 不算完美栽培', F().harvests[0].crop === 'cherry' && !F().harvests[0].perfect && !F().ach.perfect);

// 資料保存：壞掉的資料不會被覆蓋
store.farm = '{壞掉的資料';
G = boot();
const bak = Object.keys(store).find(k => k.startsWith('farm_corrupt_'));
check('   農場資料損毀 → 另存原始資料、不刪除', !!bak && store[bak] === '{壞掉的資料');

// 備份匯入：合併，不重複
delete store.farm;
G = boot(); day = addDay(day, 1); go(day, 7); G.Farm._.sow('tomato'); go(day, 8); practice(15); day = addDay(day, 1); go(day, 8); practice(15); day = addDay(day, 1); go(day, 8); practice(15); G.Farm._.harvest();
const exp = G.Farm.exportData();
G.Farm.importData(exp); G.Farm.importData(exp);
check('   匯入同一份備份兩次不會重複收成紀錄', exp.harvests.length === 1 && F().harvests.length === 1, `exp=${exp.harvests.length} now=${F().harvests.length} plant=${JSON.stringify(F().plant && {g:F().plant.growth,s:F().plant.status,d:F().plant.deadDay})}`);

console.log(`\n${pass}/${pass + fail} 通過`);
process.exit(fail ? 1 : 0);
