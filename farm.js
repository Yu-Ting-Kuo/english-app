'use strict';
// 學習農場：每天練習 15 題 = 澆一次水，植物長大一天。
//
// 題數來源：沿用 game.js 的每日練習次數（Game.days()[日期].n），也就是原本「練習次數」圖表的同一份資料，
//   每次 Game.award()（測驗作答、複習「記住了」、發音評分）算一題。農場不另外計題，所以不會和統計互相矛盾。
// 日期：Game.dayKey() 以台灣時間（UTC+8）切日。
// 成長計算：從播種日開始，逐日重算（replay）每天的題數，得到成長天數與狀態。
//   同樣的紀錄永遠算出同樣的結果，所以重新整理、關掉 App、跨好幾天才打開都不會重複成長或漏算缺席。
// 規則：
//   * 某天累計 ≥ 15 題：成長 1 天（缺水中則不長）。
//   * 某天結束時 < 15 題：缺席。第 1 次缺席 → 缺水（不長）；連續第 2 次缺席 → 枯死。
//   * 缺水時某天 ≥ 30 題：救回，並照常成長 1 天（同一天只算一次）。缺水時 15–29 題：撐住不枯，但還是缺水。
//   * 播種當天不算缺席；播種前當天已達 15 題的話，那次澆水算前一株的，新植物從隔天開始算。
//   * 成熟（可收成）後不會再缺水或枯死，等你收成。
//   * 枯死後下一株有一次堆肥加成：成長天數少 1 天（至少 1 天）。
// 資料：localStorage 的 farm（和原本的 game、quizStats 分開），有版本號；讀取失敗時把原始資料另存，不覆蓋。
const Farm = (() => {
  const KEY = 'farm';
  const VERSION = 1;
  const GOAL = 15;
  const RESCUE = 30;

  // ---------- 作物 ----------
  const STAGES = ['種子', '發芽', '幼苗', '長葉', '開花', '結果', '可收成'];
  const CROPS = [
    { id: 'tomato', name: '小番茄', days: 3, item: '番茄', stages: STAGES },
    { id: 'sunflower', name: '向日葵', days: 5, item: '向日葵', stages: STAGES },
    { id: 'apple', name: '蘋果樹', days: 7, item: '蘋果', stages: STAGES },
    { id: 'cherry', name: '櫻花樹', days: 14, item: '櫻桃', stages: ['種子', '發芽', '幼苗', '長葉', '開花', '滿開', '可收成'] },
    { id: 'golden', name: '金蘋果樹', days: 30, item: '金蘋果', stages: STAGES },
  ];
  const CROP = Object.fromEntries(CROPS.map((c, i) => [c.id, { ...c, i }]));
  const unlockText = c => { const i = CROP[c.id].i; return i === 0 ? '一開始就能種' : `收成「${CROPS[i - 1].name}」後解鎖`; };

  // 成長天數 → 7 個階段（0 種子 … 6 可收成）。不同天數的作物各自分配，成熟前一天一定是「結果」（櫻花樹為「滿開」）
  function stageOf(g, need) {
    if (g <= 0) return 0;
    if (g >= need) return 6;
    if (need === 2) return 3;
    return 1 + Math.round(((g - 1) / (need - 2)) * 4);
  }

  // ---------- 成就 ----------
  const ACH = [
    { id: 'seed', icon: '🌱', name: '第一顆種子', desc: '第一次播種' },
    { id: 'harvest', icon: '🧺', name: '初次收成', desc: '第一次成功收成' },
    { id: 's7', icon: '🔥', name: '一週不間斷', desc: '連續 7 天，每天完成 15 題' },
    { id: 's30', icon: '📅', name: '月月耕耘', desc: '連續 30 天，每天完成 15 題' },
    { id: 's100', icon: '🏆', name: '百日農夫', desc: '連續 100 天，每天完成 15 題' },
    { id: 'rescue', icon: '💧', name: '起死回生', desc: '植物缺水時，一天完成 30 題把它救回來' },
    { id: 'perfect', icon: '🌳', name: '完美栽培', desc: '櫻花樹或金蘋果樹（14 天以上的作物）從播種到收成都沒有缺水' },
    { id: 'dex', icon: '📖', name: '植物圖鑑', desc: '五種作物都至少收成一次' },
    { id: 'big', icon: '🌾', name: '豐收日', desc: '單日完成 50 題' },
    { id: 'quiz', icon: '🎯', name: '百發百中', desc: '主題測驗（測驗模式）全部答對' },
    { id: 'speak', icon: '🎤', name: '字正腔圓', desc: '發音評分 90 分以上，累計 10 次' },
    { id: 'owl', icon: '🦉', name: '夜貓子', desc: '在凌晨 00:00–04:59 練習（台灣時間）' },
    { id: 'bird', icon: '🐦', name: '早起鳥', desc: '在早上 05:00–06:59 練習（台灣時間）' },
    { id: 'k1000', icon: '📚', name: '千題達人', desc: '累計練習 1,000 題' },
  ];
  const ACHMAP = Object.fromEntries(ACH.map(a => [a.id, a]));

  // ---------- 資料 ----------
  const fresh = () => ({
    v: VERSION, created: Date.now(), nextId: 1, plant: null, compost: false,
    unlocked: ['tomato'], harvests: [], deadPlants: [], ach: {}, speak90: 0, pendingPops: [],
  });
  let storageOk = true, mem = null, loadError = '';
  function readRaw() { try { return localStorage.getItem(KEY); } catch { storageOk = false; return mem; } }
  function save() {
    const raw = JSON.stringify(F);
    try { localStorage.setItem(KEY, raw); } catch { storageOk = false; mem = raw; }
  }
  function load() {
    const raw = readRaw();
    if (!raw) return fresh();
    try {
      const d = JSON.parse(raw);
      if (!d || typeof d !== 'object') throw new Error('格式不對');
      if (d.v > VERSION) throw new Error(`資料版本 ${d.v} 比 App 新`);
      // 之後改資料結構時在這裡依 d.v 逐步升級；目前只有第 1 版，缺的欄位用預設值補
      return { ...fresh(), ...d, v: VERSION };
    } catch (e) {
      const bak = 'farm_corrupt_' + Date.now();
      try { localStorage.setItem(bak, raw); } catch {}
      loadError = `農場資料讀取失敗（${e.message}），原始資料已另存為 ${bak}，沒有刪除。`;
      console.error('[farm]', loadError);
      return fresh();
    }
  }
  let F = load();

  const today = () => Game.dayKey();
  const dayN = k => Game.days()[k]?.n || 0;

  // ---------- 成長規則（逐日重算） ----------
  function simulate(pl, todayKey) {
    let growth = 0, misses = 0, thirsty = false, thirstyEver = false, status = 'growing', deadDay = null;
    const rescues = [];
    let wateredToday = false;
    for (let k = pl.sowDay, guard = 0; k <= todayKey && guard < 4000; k = Game.addDays(k, 1), guard++) {
      if (growth >= pl.need) break;                 // 已成熟：等收成，不會再缺水
      const n = dayN(k);
      const isSow = k === pl.sowDay, isToday = k === todayKey;
      const counts = !isSow || pl.sowN < GOAL;       // 播種前已達標的那次澆水屬於前一株
      if (thirsty && counts && n >= RESCUE) {
        thirsty = false; misses = 0; growth++; rescues.push(k);
        if (isToday) wateredToday = true;
        continue;
      }
      if (counts && n >= GOAL) {
        misses = 0;
        if (!thirsty) { growth++; if (isToday) wateredToday = true; }
        continue;
      }
      if (isToday || isSow) continue;               // 今天還沒結束；播種當天不算缺席
      misses++;
      if (misses >= 2) { status = 'dead'; deadDay = k; break; }
      thirsty = true; thirstyEver = true;
    }
    if (status !== 'dead') status = growth >= pl.need ? 'mature' : thirsty ? 'thirsty' : 'growing';
    return { growth: Math.min(growth, pl.need), status, thirstyEver, rescues, deadDay, wateredToday };
  }

  // 把重算結果寫回資料；枯死、救援只會記一次
  function reconcile() {
    const pl = F.plant;
    if (!pl || pl.harvested || pl.deadDay) return null;
    const r = simulate(pl, today());
    pl.growth = r.growth;
    pl.status = r.status;
    pl.wateredToday = r.wateredToday;
    if (r.thirstyEver) pl.thirstyEver = true;
    let rescued = false;
    for (const d of r.rescues) if (!pl.rescues.includes(d)) { pl.rescues.push(d); rescued = true; }
    if (r.status === 'dead') {
      pl.deadDay = r.deadDay;
      F.compost = true;
      if (!F.deadPlants.some(x => x.id === pl.id)) F.deadPlants.unshift({ id: pl.id, crop: pl.crop, day: r.deadDay, growth: r.growth });
    }
    save();
    if (rescued) unlock('rescue');
    return r;
  }

  // ---------- 播種、收成 ----------
  function sow(cropId) {
    const pl = F.plant;
    if (pl && !pl.harvested && !pl.deadDay) return false;      // 只有一塊田
    if (!F.unlocked.includes(cropId) || !CROP[cropId]) return false;
    const c = CROP[cropId];
    const useCompost = !!F.compost;
    F.compost = false;
    const t = today();
    F.plant = {
      id: F.nextId++, crop: cropId, sowDay: t, sowN: dayN(t), sownAt: Date.now(),
      need: useCompost ? Math.max(1, c.days - 1) : c.days, compost: useCompost,
      growth: 0, status: 'growing', deadDay: null, harvested: false, thirstyEver: false, rescues: [], wateredToday: false,
      shown: { sow: false, growth: 0, status: 'growing' },
    };
    save();
    reconcile();
    unlock('seed');
    return true;
  }

  function harvest() {
    reconcile();
    const pl = F.plant;
    if (!pl || pl.harvested || pl.deadDay || pl.status !== 'mature') return null;
    if (F.harvests.some(h => h.id === pl.id)) return null;     // 同一株只能收成一次
    const c = CROP[pl.crop];
    const perfect = c.days >= 14 && !pl.thirstyEver;
    pl.harvested = true;
    F.harvests.unshift({ id: pl.id, crop: pl.crop, day: today(), t: Date.now(), days: pl.growth, perfect });
    const next = CROPS[c.i + 1];
    let newly = null;
    if (next && !F.unlocked.includes(next.id)) { F.unlocked.push(next.id); newly = next; }
    F.plant = null;
    save();
    unlock('harvest');
    if (perfect) unlock('perfect');
    if (CROPS.every(x => F.harvests.some(h => h.crop === x.id))) unlock('dex');
    return { crop: c, newly, plant: pl };
  }

  // ---------- 成就 ----------
  function unlock(id) {
    if (!ACHMAP[id] || F.ach[id]) return false;
    F.ach[id] = Date.now();
    if (currentView === 'farm' && !document.hidden) queuePop({ type: 'ach', id });
    else {
      F.pendingPops.push({ type: 'ach', id });
      toast(`🏅 解鎖成就「${ACHMAP[id].name}」`, 2600);
    }
    save();
    return true;
  }

  // 依實際每日紀錄判斷的成就（連續天數、單日題數、累計題數）
  function longestRun() {
    const days = Game.days();
    const goalDays = Object.keys(days).filter(k => days[k].n >= GOAL).sort();
    let best = 0, run = 0, prev = null;
    for (const k of goalDays) {
      run = prev && Game.addDays(prev, 1) === k ? run + 1 : 1;
      best = Math.max(best, run); prev = k;
    }
    return best;
  }
  function currentRun() {
    let k = dayN(today()) >= GOAL ? today() : Game.addDays(today(), -1), n = 0;
    while (dayN(k) >= GOAL && n < 5000) { n++; k = Game.addDays(k, -1); }
    return n;
  }
  function checkRecords() {
    const days = Object.values(Game.days());
    const run = longestRun();
    if (run >= 7) unlock('s7');
    if (run >= 30) unlock('s30');
    if (run >= 100) unlock('s100');
    if (days.some(d => d.n >= 50)) unlock('big');
    if (days.reduce((s, d) => s + (d.n || 0), 0) >= 1000) unlock('k1000');
  }

  // game.js 每記一題就呼叫這裡
  function onPractice({ kind, arg, day, n, hour }) {
    if (hour < 5) unlock('owl');
    else if (hour < 7) unlock('bird');
    if (kind === 'speak' && arg >= 90) { F.speak90 = (F.speak90 || 0) + 1; save(); if (F.speak90 >= 10) unlock('speak'); }
    const pl = F.plant;
    const before = pl && !pl.harvested && !pl.deadDay ? { g: pl.growth || 0, s: pl.status } : null;
    reconcile();
    let msg = '';
    if (before && F.plant) {
      const p = F.plant, name = CROP[p.crop].name;
      if (before.s === 'thirsty' && p.status !== 'thirsty' && p.rescues.includes(day)) msg = `💧 救回${name}了！它又恢復精神`;
      else if (p.growth > before.g) msg = p.status === 'mature' ? `🌟 ${name}成熟了！到「學習」收成` : `💧 今日澆水完成！${name}長大一天`;
      else if (before.s === 'thirsty' && n === GOAL) msg = `💧 ${name}撐住了，完成 ${RESCUE} 題才能救回`;
    } else if (!before && n === GOAL) msg = '💧 今天練習達標！到「學習」播種吧';
    if (msg) setTimeout(() => toast(msg, 2600), 2300);   // 等原本的 XP 提示顯示完
    checkRecords();
    if (currentView === 'farm') render();
  }
  function onQuizPerfect() { unlock('quiz'); }

  // ---------- SVG 植物 ----------
  const r1 = n => Math.round(n * 10) / 10;
  let leafSeq = 0;
  function leaf(x, y, ang, s) {
    const side = Math.abs(((ang % 360) + 360) % 360 - 180) > 90 ? 'r' : 'l';
    const i = leafSeq++;
    return `<g transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(ang)})"><g class="lf-droop ${side}"><g class="lf" style="animation-delay:${-((i * 0.53) % 3).toFixed(2)}s">
      <path class="leaf" d="M0 0C${r1(s * .25)} ${r1(-s * .42)} ${r1(s * .72)} ${r1(-s * .4)} ${r1(s)} 0C${r1(s * .7)} ${r1(s * .36)} ${r1(s * .25)} ${r1(s * .34)} 0 0Z"/>
      <path class="vein" d="M${r1(s * .1)} 0L${r1(s * .76)} 0"/></g></g></g>`;
  }
  const stem = (h, w = 3.2, b = 4, cls = 'stem') => `<path class="${cls}" stroke-width="${w}" d="M0 0C${-b} ${r1(-h * .35)} ${b} ${r1(-h * .7)} 0 ${r1(-h)}"/>`;
  function leavesAlong(h, count, size, from = 0.25) {
    let out = '';
    for (let i = 0; i < count; i++) {
      const f = from + (1 - from) * (count === 1 ? 1 : i / (count - 1));
      const right = i % 2 === 0;
      const s = size * (1 - 0.3 * (i / count));
      out += leaf(right ? 1.5 : -1.5, -h * f, right ? -28 - (i % 3) * 6 : -152 + (i % 3) * 6, s);
    }
    return out;
  }
  const seedColor = { tomato: '#d8b67a', sunflower: '#4b4b4b', apple: '#7a4a2a', cherry: '#e8d2a6', golden: '#f2c443' };
  function seed(crop) {
    const stripes = crop === 'sunflower' ? '<path d="M-3 -6.5L-2 -1.5M0 -8L0 -1M3 -6.5L2 -1.5" stroke="#eee" stroke-width="1"/>' : '';
    const glow = crop === 'golden' ? '<circle cx="0" cy="-4" r="10" class="seed-glow"/>' : '';
    return `<g class="seed-g">${glow}<ellipse cx="0" cy="-4" rx="6.5" ry="4.8" fill="${seedColor[crop]}" stroke="#6b4a2b" stroke-width="1.2"/>${stripes}
      <path d="M-2.5 -6Q0 -7.5 2.5 -6" stroke="#fff" stroke-opacity=".6" stroke-width="1.2" fill="none"/></g>`;
  }
  const flower5 = (x, y, r, fill = '#ffd84a', center = '#f39c2b') => `<g transform="translate(${r1(x)} ${r1(y)})"><g class="bloom">${[0, 72, 144, 216, 288].map(a =>
    `<ellipse cx="0" cy="${r1(-r)}" rx="${r1(r * .6)}" ry="${r1(r * .9)}" fill="${fill}" transform="rotate(${a})"/>`).join('')}<circle r="${r1(r * .55)}" fill="${center}"/></g></g>`;
  const fruit = (x, y, inner) => `<g class="fruit" transform="translate(${r1(x)} ${r1(y)})"><g class="fruit-in">${inner}</g></g>`;
  const roundFruit = (r, fill, hi = '#fff') => `<circle r="${r}" fill="${fill}" stroke="rgba(0,0,0,.18)" stroke-width="1"/><ellipse cx="${r1(-r * .35)}" cy="${r1(-r * .35)}" rx="${r1(r * .28)}" ry="${r1(r * .2)}" fill="${hi}" opacity=".7"/>`;
  const appleFruit = (r, fill) => `${roundFruit(r, fill)}<path d="M0 ${-r}l1 -3" stroke="#6b4a2b" stroke-width="1.4"/><path class="leaf" d="M1 ${-r - 2}c3 -3 6 -2 7 0c-3 2 -5 2 -7 0z"/>`;

  function earlyStage(crop, st) {
    const tree = ['apple', 'cherry', 'golden'].includes(crop);
    if (st === 1) return stem(15, 2.6, 2) + leaf(0, -15, -35, 10) + leaf(0, -15, -145, 10);
    if (st === 2) return stem(30, 3) + leavesAlong(30, 4, 13, 0.45);
    // 長葉：草本植物茂密，果樹是帶褐色的小樹苗
    if (tree) return stem(52, 4, 3, 'stem woody') + leavesAlong(52, 7, 16, 0.3);
    return stem(48, 3.4) + leavesAlong(48, 8, crop === 'sunflower' ? 20 : 16, 0.2);
  }

  function treeBase(h, twist = 0) {
    return `<path class="trunk" d="M-5 0C-4 ${-h * .4} ${-3 + twist} ${-h * .8} -2 ${-h}L3 ${-h}C${3 + twist} ${-h * .7} 5 ${-h * .4} 6 0Z"/>
      <path class="branch" d="M0 ${r1(-h * .75)}C-8 ${r1(-h * .9)} -14 ${r1(-h)} -18 ${r1(-h * 1.15)}M1 ${r1(-h * .7)}C9 ${r1(-h * .85)} 14 ${r1(-h * .95)} 19 ${r1(-h * 1.1)}"/>`;
  }
  function canopy(cy, clumps, cls = 'clump') {
    return clumps.map(([x, y, r], i) => `<g transform="translate(${x} ${cy + y})"><g class="${cls}" style="animation-delay:${-(i * .7).toFixed(1)}s">
      <circle r="${r}" class="clump-c"/><circle cx="${r1(-r * .3)}" cy="${r1(-r * .3)}" r="${r1(r * .45)}" class="clump-hi"/></g></g>`).join('');
  }
  const TREE_CLUMPS = [[0, 0, 30], [-26, 14, 22], [26, 14, 22], [-15, -20, 21], [16, -20, 21], [0, 18, 20]];

  function plantArt(crop, st) {
    leafSeq = 0;
    if (st === 0) return seed(crop);
    if (st <= 3) return earlyStage(crop, st);
    if (crop === 'tomato') {
      const h = st === 4 ? 58 : 66;
      let out = `<path class="stake" d="M13 4V${-h - 6}"/><path class="tie" d="M10 ${-h * .5}h6M10 ${-h * .8}h6"/>` + stem(h, 3.6) + leavesAlong(h, 10, 18, 0.15);
      const pos = [[-15, -26], [14, -34], [-12, -46], [13, -52], [-3, -60], [3, -40]];
      if (st === 4) out += pos.slice(0, 4).map(([x, y]) => flower5(x, y, 3.6)).join('');
      if (st === 5) out += pos.slice(0, 5).map(([x, y]) => fruit(x, y, roundFruit(4.5, '#8cc84b'))).join('');
      if (st === 6) out += pos.map(([x, y]) => `<path class="vine" d="M${x} ${y - 7}v3"/>` + fruit(x, y, roundFruit(7, '#e8473b') + '<path d="M-3 -6l3 1.5l3 -1.5" stroke="#3f8a2a" stroke-width="1.6" fill="none"/>')).join('');
      return out;
    }
    if (crop === 'sunflower') {
      const h = [0, 0, 0, 0, 80, 94, 104][st];
      let out = stem(h, 4.6, 5) + leavesAlong(h * .82, 7, 23, 0.12);
      if (st === 4) out += `<g transform="translate(0 ${-h})"><g class="bud"><circle r="7" fill="#7cbf45" stroke="#4f8f2c"/><path d="M-6 2l-4 4M6 2l4 4M0 7v4" stroke="#4f8f2c" stroke-width="2"/></g></g>`;
      else {
        const big = st === 6, R = big ? 13 : 7, L = big ? 14 : 8, n = big ? 18 : 12;
        const petals = Array.from({ length: n }, (_, i) => `<ellipse cx="0" cy="${-R - L * .45}" rx="${r1(L * .32)}" ry="${r1(L * .62)}" fill="#ffcf2e" stroke="#e8a817" stroke-width=".8" transform="rotate(${r1(i * 360 / n)})"/>`).join('');
        const dots = big ? Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, rr = 3 + (i % 3) * 3; return `<circle cx="${r1(Math.cos(a) * rr)}" cy="${r1(Math.sin(a) * rr)}" r="1.3" fill="#3b2412"/>`; }).join('') : '';
        const head = `<g class="sf-head"><g transform="rotate(-10)">${petals}<circle r="${R}" fill="#7a4a1e" stroke="#5a3412"/>${dots}</g></g>`;
        out += `<g transform="translate(0 ${-h})">${big ? fruit(0, 0, head) : head}</g>`;
      }
      return out;
    }
    // 果樹
    const h = st === 4 ? 50 : 56, cy = -h - 26;
    const twist = crop === 'cherry' ? 5 : 0;
    let out = treeBase(h, twist) + canopy(cy, TREE_CLUMPS, crop === 'cherry' && st >= 5 ? 'clump pink' : 'clump');
    const spots = [[-22, 4], [20, 6], [-8, -16], [12, -18], [-28, 18], [28, 20], [0, 14], [-12, 26], [14, 28]];
    if (crop === 'apple') {
      if (st === 4) out += spots.map(([x, y]) => flower5(x, cy + y, 2.8, '#fff', '#f7a6b8')).join('');
      if (st === 5) out += spots.slice(0, 7).map(([x, y]) => fruit(x, cy + y, roundFruit(4.2, '#9ccd4f'))).join('');
      if (st === 6) out += spots.slice(0, 8).map(([x, y]) => fruit(x, cy + y, appleFruit(7, '#e2433a'))).join('');
    }
    if (crop === 'cherry') {
      if (st === 4) out += spots.map(([x, y]) => flower5(x, cy + y, 2.8, '#f8b9cf', '#e86f98')).join('');
      if (st >= 5) out += spots.map(([x, y]) => flower5(x, cy + y, 3.6, '#fde3ec', '#f07aa5')).join('') +
        `<g class="petal-fall"><ellipse cx="-30" cy="${cy}" rx="2.4" ry="1.5" fill="#f9c3d6"/><ellipse cx="24" cy="${cy + 8}" rx="2.4" ry="1.5" fill="#f9c3d6"/><ellipse cx="4" cy="${cy - 10}" rx="2.4" ry="1.5" fill="#f9c3d6"/></g>`;
      if (st === 6) out += spots.slice(0, 7).map(([x, y]) => fruit(x + 3, cy + y + 6,
        '<path d="M-3 -9Q0 -14 3 -9M0 -13v-2" stroke="#5a8a2a" stroke-width="1.3" fill="none"/>' +
        '<g transform="translate(-3 -2)">' + roundFruit(3.8, '#b5182f') + '</g><g transform="translate(3 -1)">' + roundFruit(3.8, '#c91f37') + '</g>')).join('');
    }
    if (crop === 'golden') {
      if (st === 4) out += spots.map(([x, y]) => flower5(x, cy + y, 2.8, '#fffbe8', '#f5d36a')).join('');
      if (st === 5) out += spots.slice(0, 7).map(([x, y]) => fruit(x, cy + y, roundFruit(4.4, '#efe08a'))).join('');
      if (st === 6) out += spots.slice(0, 8).map(([x, y]) => fruit(x, cy + y, appleFruit(7.4, '#f5c22e'))).join('') +
        [[-34, cy - 14], [34, cy - 6], [0, cy - 36], [-20, cy + 34]].map(([x, y], i) => `<g transform="translate(${x} ${y})"><path class="twinkle" style="animation-delay:${i * .6}s" d="M0 -6L1.5 -1.5L6 0L1.5 1.5L0 6L-1.5 1.5L-6 0L-1.5 -1.5Z" fill="#fff7c2"/></g>`).join('');
    }
    return out;
  }
  const plantClass = crop => `pl pl-${crop}`;
  // 小圖（倉庫、圖鑑用）
  const miniPlant = (crop, st = 6, extra = '') => `<svg class="mini ${extra}" viewBox="-62 -150 124 164" aria-hidden="true"><ellipse cx="0" cy="4" rx="44" ry="9" class="soil-mini"/><g class="${plantClass(crop)}">${plantArt(crop, st)}</g></svg>`;
  function itemIcon(crop) {
    const inner = {
      tomato: roundFruit(9, '#e8473b') + '<path d="M-4 -8l4 2l4 -2" stroke="#3f8a2a" stroke-width="2" fill="none"/>',
      sunflower: Array.from({ length: 12 }, (_, i) => `<ellipse cy="-10" rx="2.6" ry="5" fill="#ffcf2e" transform="rotate(${i * 30})"/>`).join('') + '<circle r="6.5" fill="#7a4a1e"/>',
      apple: appleFruit(9, '#e2433a'),
      cherry: '<path d="M-4 -10Q0 -16 4 -10" stroke="#5a8a2a" stroke-width="1.6" fill="none"/><g transform="translate(-4 0)">' + roundFruit(5.5, '#b5182f') + '</g><g transform="translate(4 1)">' + roundFruit(5.5, '#c91f37') + '</g>',
      golden: appleFruit(9, '#f5c22e'),
    }[crop];
    return `<svg class="item-ic" viewBox="-16 -18 32 32" aria-hidden="true">${inner}</svg>`;
  }

  // ---------- 場景 ----------
  function skyPeriod(h = Game.twHour()) {
    if (h >= 5 && h < 12) return ['morning', '早上'];
    if (h >= 12 && h < 18) return ['afternoon', '下午'];
    if (h >= 18 && h < 23) return ['evening', '傍晚'];
    return ['night', '晚上'];
  }
  function sceneSvg(pl, st, sky) {
    const c = CROP[pl ? pl.crop : (pickedCrop || pickDefault())];
    const sign = pl ? (pl.deadDay ? '已枯死' : `第 ${pl.growth} / ${pl.need} 天`) : '準備播種';
    const stars = Array.from({ length: 14 }, (_, i) => `<circle class="star" style="animation-delay:${(i * .37 % 2.5).toFixed(2)}s" cx="${(i * 53 + 17) % 350 + 5}" cy="${(i * 29 + 11) % 80 + 6}" r="${i % 3 ? 1 : 1.6}"/>`).join('');
    return `<svg class="farm-svg sky-${sky}" viewBox="0 0 360 240" role="img" aria-label="農場：${esc(c.name)}，${pl ? esc(c.stages[st]) : '還沒播種'}">
      <defs><linearGradient id="f-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sky1"/><stop offset="1" class="sky2"/></linearGradient>
        <linearGradient id="f-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="grass1"/><stop offset="1" class="grass2"/></linearGradient></defs>
      <rect width="360" height="240" fill="url(#f-sky)"/>
      <g class="stars">${stars}</g>
      <g class="sun"><circle r="17" class="sun-c"/><circle r="25" class="sun-halo"/></g>
      <g class="moon"><circle r="14" fill="#fdf3c4"/><circle cx="6" cy="-4" r="12" class="moon-cut"/></g>
      <g class="cloud c1"><ellipse cx="0" cy="0" rx="22" ry="9"/><ellipse cx="14" cy="-6" rx="14" ry="10"/><ellipse cx="-10" cy="-4" rx="11" ry="8"/></g>
      <g class="cloud c2"><ellipse cx="0" cy="0" rx="18" ry="7"/><ellipse cx="10" cy="-5" rx="11" ry="8"/></g>
      <path class="hill h1" d="M0 168C50 140 110 138 170 158S290 138 360 160V240H0Z"/>
      <path class="hill h2" d="M0 176C70 158 120 166 190 172S310 156 360 170V240H0Z"/>
      <g class="bgtree" transform="translate(28 160)"><rect x="-2" y="-6" width="4" height="10" fill="#8a5a32"/><circle cy="-14" r="11"/></g>
      <g class="bgtree" transform="translate(338 158)"><rect x="-2" y="-6" width="4" height="10" fill="#8a5a32"/><circle cy="-13" r="10"/></g>
      <g class="barn" transform="translate(50 150)"><path d="M-22 22V2L0 -14L22 2V22Z" fill="#e8796b" stroke="#a5493f" stroke-width="1.5"/><path d="M-26 4L0 -18L26 4" stroke="#7a3a32" stroke-width="4" fill="none" stroke-linecap="round"/><rect x="-7" y="8" width="14" height="14" fill="#fff4e0" stroke="#a5493f"/><path d="M-7 8L7 22M7 8L-7 22" stroke="#a5493f"/></g>
      <rect y="176" width="360" height="64" fill="url(#f-grass)"/>
      <g class="fence">${Array.from({ length: 9 }, (_, i) => `<rect x="${236 + i * 14}" y="160" width="5" height="22" rx="2"/>`).join('')}<rect x="232" y="166" width="126" height="3.5" rx="1.5"/><rect x="232" y="175" width="126" height="3.5" rx="1.5"/></g>
      <g class="tufts">${[[20, 222], [96, 232], [272, 230], [340, 216], [120, 186], [250, 190]].map(([x, y], i) => `<g transform="translate(${x} ${y})"><path class="tuft" style="animation-delay:${-i * .5}s" d="M-5 0Q-6 -8 -3 -12M0 0Q0 -10 1 -14M5 0Q6 -8 3 -11"/></g>`).join('')}
        <g transform="translate(108 216)">${flower5(0, 0, 3, '#fff', '#ffd84a')}</g><g transform="translate(286 212)">${flower5(0, 0, 3, '#ffd0e0', '#f39c2b')}</g></g>
      <g class="sign" transform="translate(66 196)"><rect x="-1.5" y="-4" width="5" height="30" fill="#9a6a3c"/><rect x="-36" y="-30" width="74" height="30" rx="5" fill="#d9a066" stroke="#9a6a3c" stroke-width="2"/>
        <text x="1" y="-18" text-anchor="middle" class="sign-t1">${esc(c.name)}</text><text x="1" y="-6" text-anchor="middle" class="sign-t2">${sign}</text></g>
      <ellipse cx="180" cy="210" rx="82" ry="20" class="soil"/><ellipse cx="180" cy="205" rx="74" ry="14" class="soil-top"/>
      <path class="furrow" d="M126 206Q180 198 234 206M138 214Q180 208 222 214"/>
      <g class="basket" transform="translate(300 214)"><g class="basket-in"><path d="M-20 -8H20L15 10H-15Z" fill="#d9a066" stroke="#8a5a32" stroke-width="2"/><path d="M-18 -2H18M-16 4H16" stroke="#b07a42" stroke-width="1.5"/><path d="M-14 -8Q0 -26 14 -8" stroke="#8a5a32" stroke-width="2.5" fill="none"/><g class="basket-fill"></g></g></g>
      <g class="plant-root" transform="translate(180 204)"><g class="plant-sway"><g class="${pl ? plantClass(pl.crop) : 'pl'}" id="farm-plant">${pl ? plantArt(pl.crop, st) : ''}</g></g></g>
      <g class="fx" transform="translate(180 204)"></g>
      <g class="can" transform="translate(224 116)"><g class="can-in">
        <path d="M-14 -10H12V12Q12 16 8 16H-10Q-14 16 -14 12Z" fill="#5aa9e6" stroke="#2f6f9f" stroke-width="2"/>
        <path d="M12 -4Q24 -14 22 -24" stroke="#2f6f9f" stroke-width="3" fill="none"/><path d="M-14 -4L-30 -14" stroke="#2f6f9f" stroke-width="4" stroke-linecap="round"/>
        <ellipse cx="-31" cy="-15" rx="4" ry="6" transform="rotate(-50 -31 -15)" fill="#5aa9e6" stroke="#2f6f9f" stroke-width="1.5"/></g>
        <g class="drops">${[0, 1, 2, 3, 4, 5].map(i => `<g transform="translate(${-44 - (i % 3) * 4} ${-2 + (i % 2) * 3})"><path class="drop" style="animation-delay:${(0.7 + i * .18).toFixed(2)}s" d="M0 -4Q3 0 0 3Q-3 0 0 -4Z"/></g>`).join('')}</g></g>
    </svg>`;
  }

  // ---------- 畫面 ----------
  let pickedCrop = null;
  function pickDefault() {
    // 預設選最新解鎖、還沒收成過的作物
    const fresh = F.unlocked.filter(id => !F.harvests.some(h => h.crop === id));
    return fresh.length ? fresh[fresh.length - 1] : F.unlocked[F.unlocked.length - 1];
  }
  const calm = () => { try { return localStorage.getItem('farmCalm') === '1'; } catch { return false; } };

  function statusLine(pl, st) {
    if (!pl) return '田地空著，選一種種子播下去吧';
    const c = CROP[pl.crop];
    if (pl.deadDay) return `${c.name}枯死了（連續兩天沒有澆水）`;
    const s = c.stages[st];
    return { growing: `${c.name}・${s}・健康`, thirsty: `${c.name}・${s}・缺水中`, mature: `${c.name}・可以收成了！` }[pl.status] || s;
  }

  function waterCard(pl, n) {
    const quick = `<div class="row wrap farm-quick">
        <button class="grow primary" data-go-farm="review">翻卡複習</button>
        <button class="grow" data-go-farm="home">主題測驗</button>
        <button class="grow" data-go-farm="practice">發音練習</button></div>`;
    const bar = (v, max, cls = '') => `<div class="water-bar ${cls}" role="progressbar" aria-valuenow="${Math.min(v, max)}" aria-valuemin="0" aria-valuemax="${max}"><i style="width:${Math.min(100, v / max * 100)}%"></i></div>`;
    let head = `${n} / ${GOAL} 題`, body = '', b = bar(n, GOAL);
    if (!pl || pl.deadDay) {
      const opts = CROPS.map(c => {
        const ok = F.unlocked.includes(c.id);
        const need = F.compost ? Math.max(1, c.days - 1) : c.days;
        return `<button class="seed-opt${pickedCrop === c.id ? ' on' : ''}" data-seed="${c.id}" ${ok ? '' : 'disabled'} aria-pressed="${pickedCrop === c.id}">
          ${miniPlant(c.id, ok ? 6 : 6, ok ? '' : 'locked')}<b>${ok ? esc(c.name) : '？？？'}</b><span>${ok ? `${need} 天${F.compost ? '（堆肥）' : ''}` : unlockText(c)}</span></button>`;
      }).join('');
      body = `${pl?.deadDay ? `<p class="farm-msg bad">🥀 植物枯死了…別灰心，重新播種吧！${F.compost ? '枯枝變成了堆肥，下一株少長 1 天。' : ''}</p>` : '<p class="farm-msg">選一種種子播下去。之後每天練習 15 題，就能幫它澆一次水。</p>'}
        <div class="seed-row">${opts}</div>
        <button class="primary full" id="farm-sow">🌱 播下${esc(CROP[pickedCrop].name)}的種子</button>`;
    } else if (pl.status === 'mature') {
      body = `<p class="farm-msg good">🌟 ${esc(CROP[pl.crop].name)}成熟了！點田裡的植物收成，不收成也不會枯萎。</p><button class="primary full" id="farm-harvest">🧺 收成${esc(CROP[pl.crop].item)}</button>`;
    } else if (pl.status === 'thirsty') {
      head = `${n} / ${RESCUE} 題`; b = bar(n, RESCUE, 'thirsty');
      body = n >= GOAL
        ? `<p class="farm-msg warn">💧 今天已達 15 題，植物撐住了，但還是很渴。再 ${RESCUE - n} 題（共 30 題）就能救回它！</p>`
        : `<p class="farm-msg warn">🥵 植物有點渴了！今天完成 ${RESCUE} 題就能救回它（還差 ${RESCUE - n} 題）。今天再沒達到 15 題，它就會枯死。</p>`;
    } else if (pl.wateredToday) {
      body = `<p class="farm-msg good">✅ 今天已經澆過水了，植物長大了一天。明天再來！</p>`;
    } else if (pl.sowDay === today() && pl.sowN >= GOAL) {
      body = `<p class="farm-msg">今天的澆水已經用在上一株植物了，明天練習 15 題開始照顧它。</p>`;
    } else {
      body = `<p class="farm-msg">再 ${Math.max(0, GOAL - n)} 題就能澆水，植物會長大一天。可以分好幾次練習。</p>`;
    }
    return `<div class="card stack" id="farm-water">
      <div class="row"><h3 class="grow">💧 今日澆水進度</h3><span class="chip">${head}</span></div>
      ${b}${body}${quick}</div>`;
  }

  function barnCard() {
    const counts = Object.fromEntries(CROPS.map(c => [c.id, F.harvests.filter(h => h.crop === c.id).length]));
    const total = F.harvests.length;
    const grownDays = F.harvests.reduce((s, h) => s + (h.days || 0), 0) + F.deadPlants.reduce((s, d) => s + (d.growth || 0), 0) + (F.plant && !F.plant.deadDay ? F.plant.growth || 0 : 0);
    return `<div class="card stack" id="farm-barn">
      <div class="row"><h3 class="grow">🧺 收成倉庫</h3><button class="ghost small-btn" id="farm-dex">植物圖鑑 ›</button></div>
      <div class="barn-row">${CROPS.map(c => {
        const ok = F.unlocked.includes(c.id);
        return `<div class="barn-slot${counts[c.id] ? '' : ' empty'}" title="${esc(c.name)}">${ok ? itemIcon(c.id) : '<span class="q">？</span>'}<span>${ok ? `× ${counts[c.id]}` : '未解鎖'}</span></div>`;
      }).join('')}</div>
      <div class="muted">總收成 ${total} 次・累計成長 ${grownDays} 天・成就 ${Object.keys(F.ach).filter(id => ACHMAP[id]).length} / ${ACH.length}</div>
      ${F.harvests.length ? `<div class="recent">${F.harvests.slice(0, 3).map(h => `<div class="ev">${itemIcon(h.crop)} ${esc(h.day.slice(5).replace('-', '/'))} 收成${esc(CROP[h.crop].item)}${h.perfect ? '（完美栽培）' : ''}</div>`).join('')}</div>` : '<div class="muted">還沒有收成紀錄。</div>'}
    </div>`;
  }

  function achCard() {
    const got = ACH.filter(a => F.ach[a.id]).length;
    return `<div class="card stack" id="farm-ach">
      <div class="row"><h3 class="grow">⭐ 成就牆</h3><span class="muted">已解鎖 ${got} / ${ACH.length}</span></div>
      <div class="badges">${ACH.map(a => `<button class="badge${F.ach[a.id] ? ' got' : ''}" data-ach="${a.id}" aria-label="${esc(a.name)}${F.ach[a.id] ? '（已解鎖）' : '（未解鎖）'}">
        <span class="badge-ic">${a.icon}</span><span class="badge-nm">${F.ach[a.id] ? esc(a.name) : '未解鎖'}</span></button>`).join('')}</div>
    </div>`;
  }

  function rulesCard() {
    return `<details class="card rules"><summary>學習農場規則</summary><ul class="muted">
      <li>每天（台灣時間）累計練習 ${GOAL} 題 = 澆一次水，植物長大一天。可以分好幾次完成。</li>
      <li>題數和下方「練習次數」圖表是同一份紀錄：測驗作答、複習按「記住了」、發音評分，各算一題。</li>
      <li>某天沒達到 ${GOAL} 題：植物缺水，不會長大。缺水時一天完成 ${RESCUE} 題可以救回來。</li>
      <li>連續兩天沒達到 ${GOAL} 題，植物會枯死，要重新播種；枯枝會變成堆肥，下一株少長 1 天。</li>
      <li>成熟後不會枯萎，隨時都能收成。收成後解鎖下一種作物。</li>
      <li>枯死不影響經驗值、等級、成就和收成紀錄。</li></ul></details>`;
  }

  function render() {
    const box = document.getElementById('farm-body');
    if (!box) return;
    Game.render();               // 原本的經驗值、等級、圖表（在下方）
    reconcile();
    checkRecords();
    const pl = F.plant;
    if (!pickedCrop || !F.unlocked.includes(pickedCrop)) pickedCrop = pickDefault();
    const st = pl ? stageOf(pl.growth || 0, pl.need) : 0;
    const shownSt = pl ? stageOf(pl.shown?.growth || 0, pl.need) : 0;
    const [sky, skyName] = skyPeriod();
    const n = dayN(today());
    // 先畫「上次看到的樣子」，再播放之後發生的變化
    let plan = null;
    if (pl) {
      const sh = (pl.shown ||= { sow: true, growth: pl.growth, status: pl.status });
      if (!sh.sow) plan = 'sow';
      else if (pl.deadDay && sh.status !== 'dead') plan = 'die';
      else if (!pl.deadDay && (pl.growth || 0) > sh.growth) plan = sh.status === 'thirsty' && pl.status !== 'thirsty' ? 'revive' : 'water';
      else if (!pl.deadDay && sh.status === 'thirsty' && pl.status !== 'thirsty') plan = 'revive';
      else if (pl.status === 'thirsty' && sh.status !== 'thirsty') plan = 'droop';
    }
    const drawSt = plan === 'sow' ? 0 : plan === 'water' || plan === 'revive' ? shownSt : st;
    const plState = pl ? (pl.deadDay ? (plan === 'die' ? '' : 'dead') : (plan === 'revive' || plan === 'droop') ? (plan === 'revive' ? 'thirsty' : '') : pl.status === 'thirsty' ? 'thirsty' : '') : '';
    box.innerHTML = `
      ${loadError ? `<div class="card farm-msg bad">${esc(loadError)}</div>` : ''}
      ${storageOk ? '' : '<div class="card farm-msg bad">這個瀏覽器不能保存資料，農場進度只會保留到關閉 App 為止。</div>'}
      <div class="farm-scene${calm() ? ' calm' : ''} ${plState}${pl?.status === 'mature' && !pl.deadDay ? ' ripe' : ''}">
        ${sceneSvg(pl, drawSt, sky)}
        ${pl?.status === 'mature' && !pl.deadDay ? `<button class="farm-tap" id="farm-tap" aria-label="收成${esc(CROP[pl.crop].name)}"><span class="farm-hint">👆 點我收成</span></button>` : ''}
        <div class="farm-status"><span>${esc(statusLine(pl, st))}</span><span class="sky-tag">${skyName}</span></div>
      </div>
      ${waterCard(pl, n)}
      ${barnCard()}
      ${achCard()}
      ${rulesCard()}`;
    bind(box);
    if (plan) {
      const sh = pl.shown;
      sh.sow = true; sh.growth = pl.growth || 0; sh.status = pl.deadDay ? 'dead' : pl.status;
      save();
      play(plan, pl, st);
    }
    flushPops();
  }

  function bind(box) {
    box.querySelectorAll('[data-go-farm]').forEach(b => b.onclick = () => {
      if (b.dataset.goFarm === 'practice') practiceId = null;
      show(b.dataset.goFarm);
    });
    box.querySelectorAll('[data-seed]').forEach(b => b.onclick = () => { pickedCrop = b.dataset.seed; render(); });
    box.querySelector('#farm-sow')?.addEventListener('click', () => {
      holdPops = true;                       // 「第一顆種子」等播種動畫結束再跳
      if (sow(pickedCrop)) render(); else { holdPops = false; showNextPop(); }
    });
    const doHarvest = () => {
      holdPops = true;
      const r = harvest();
      if (!r) { holdPops = false; showNextPop(); }
      if (r) playHarvest(r);
    };
    box.querySelector('#farm-tap')?.addEventListener('click', doHarvest);
    box.querySelector('#farm-harvest')?.addEventListener('click', doHarvest);
    box.querySelector('#farm-dex').onclick = openDex;
    box.querySelectorAll('[data-ach]').forEach(b => b.onclick = () => openAch(b.dataset.ach));
  }

  // ---------- 動畫 ----------
  const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, reduce() ? Math.min(ms, 60) : ms));
  async function play(plan, pl, st) {
    const scene = document.querySelector('.farm-scene');
    const plant = document.getElementById('farm-plant');
    const fx = scene?.querySelector('.fx');
    if (!scene || !plant) return;
    if (plan === 'sow') {
      holdPops = true;
      setTimeout(() => { holdPops = false; showNextPop(); }, reduce() ? 50 : 1400);
      plant.classList.add('sowing');
      fx.innerHTML = Array.from({ length: 6 }, (_, i) => `<circle class="dust" style="--dx:${(i - 2.5) * 7}px;animation-delay:.55s" r="2.2"/>`).join('');
      await wait(1300);
      plant.classList.remove('sowing'); fx.innerHTML = '';
      if (st > 0) play('water', pl, st);          // 播種當天已經澆過水：接著長出來
      return;
    }
    if (plan === 'droop') {
      await wait(250);
      scene.classList.add('thirsty');
      return;
    }
    if (plan === 'die') {
      scene.classList.add('dying');
      plant.querySelectorAll('.lf-droop, .clump, .fruit-in, .bloom, .sf-head, .bud').forEach((el, i) => {
        el.style.setProperty('--fx', `${((i * 37) % 50) - 25}px`);
        el.style.animationDelay = `${0.9 + i * 0.12}s`;
        el.classList.add('falling');
      });
      await wait(2600 + plant.querySelectorAll('.falling').length * 120);
      scene.classList.remove('dying'); scene.classList.add('dead');
      return;
    }
    // 澆水（或救援）：水壺傾斜、水滴落下，然後植物長到新階段
    scene.classList.add('watering');
    await wait(1700);
    plant.innerHTML = plantArt(pl.crop, st);
    plant.classList.add('grow-in');
    if (plan === 'revive') scene.classList.remove('thirsty');
    if (plan === 'revive' || st === 6) sparkle(fx, 0, -60);
    await wait(1300);
    scene.classList.remove('watering');
    plant.classList.remove('grow-in');
    // 階段畫面已更新，順便更新牌子上的天數
    const t2 = scene.querySelector('.sign-t2');
    if (t2) t2.textContent = `第 ${pl.growth} / ${pl.need} 天`;
  }
  function sparkle(fx, x, y, n = 8) {
    if (!fx) return;
    fx.insertAdjacentHTML('beforeend', Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return `<g transform="translate(${x} ${y})"><path class="spark" style="--sx:${Math.round(Math.cos(a) * 46)}px;--sy:${Math.round(Math.sin(a) * 36)}px;animation-delay:${(i % 3) * .08}s" d="M0 -5L1.3 -1.3L5 0L1.3 1.3L0 5L-1.3 1.3L-5 0L-1.3 -1.3Z"/></g>`;
    }).join(''));
    setTimeout(() => fx.querySelectorAll('.spark').forEach(s => s.parentNode.remove()), 1600);
  }
  async function playHarvest({ crop, newly, plant: pl }) {
    // 資料已經先寫好（收成只會算一次），這裡只播動畫
    const scene = document.querySelector('.farm-scene');
    document.getElementById('farm-tap')?.remove();
    document.getElementById('farm-harvest')?.setAttribute('disabled', '');
    const svg = scene?.querySelector('svg');
    if (svg) {
      scene.classList.remove('ripe');
      const fruits = [...svg.querySelectorAll('#farm-plant .fruit')].slice(0, 8);
      const base = svg.querySelector('.plant-root').getCTM();
      fruits.forEach((f, i) => {
        const m = f.getCTM(), inv = base.inverse().multiply(m);
        // 從果實位置飛到籃子（籃子在植物右邊 120、下方 4）
        f.querySelector('.fruit-in').style.cssText = `--dx:${Math.round(120 - inv.e)}px;--dy:${Math.round(4 - inv.f)}px;animation-delay:${(i * .12).toFixed(2)}s`;
        f.classList.add('picked');
      });
      sparkle(svg.querySelector('.fx'), 0, -70, 10);
      await wait(1500 + fruits.length * 120);
      svg.querySelector('.basket-fill').innerHTML = itemIcon(crop.id).replace('<svg', '<svg x="-12" y="-22" width="24" height="24"');
      svg.querySelector('.basket-in').classList.add('bump');
      sparkle(svg.querySelector('.fx'), 120, -10, 8);
      await wait(900);
    }
    // 收成視窗排在這次解鎖的成就前面
    popQ.unshift({ type: 'harvest', crop: crop.id, newly: newly?.id || null });
    holdPops = false;
    render();
  }

  // ---------- 彈出視窗 ----------
  const popQ = [];
  let holdPops = false;   // 播種、收成動畫播放中先不跳視窗，播完再依序顯示
  function queuePop(p) { popQ.push(p); showNextPop(); }
  function flushPops() {
    if (F.pendingPops?.length) { popQ.push(...F.pendingPops); F.pendingPops = []; save(); }
    showNextPop();
  }
  function sheet() {
    let el = document.getElementById('farm-sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'farm-sheet'; el.className = 'sheet-bg center'; el.hidden = true;
      el.innerHTML = '<div class="sheet stack game-pop" role="dialog" aria-modal="true"></div>';
      el.addEventListener('click', e => {
        if (e.target === el || e.target.closest('[data-close]')) { el.hidden = true; setTimeout(showNextPop, 200); }
      });
      document.body.appendChild(el);
    }
    return el;
  }
  function showNextPop() {
    const el = sheet();
    if (holdPops || !el.hidden || !popQ.length) return;
    if (document.getElementById('game-sheet')?.hidden === false) { setTimeout(showNextPop, 800); return; }
    const p = popQ.shift();
    let html = '';
    if (p.type === 'ach') {
      const a = ACHMAP[p.id]; if (!a) return showNextPop();
      html = `<div class="pop-emoji">${a.icon}</div><h2>解鎖成就！</h2><p class="pop-big">${esc(a.name)}</p><p class="muted">${esc(a.desc)}</p>`;
    } else if (p.type === 'harvest') {
      const c = CROP[p.crop], nw = p.newly && CROP[p.newly];
      html = `<div class="pop-emoji pop-svg">${itemIcon(c.id)}</div><h2>收成了！</h2><p>你收成了 <b>${esc(c.item)}</b>，已放進倉庫。</p>
        ${nw ? `<div class="pop-unlock">${miniPlant(nw.id)}<p>解鎖新作物：<b>${esc(nw.name)}</b>（${nw.days} 天收成）</p></div>` : ''}`;
    } else if (p.type === 'info') html = p.html;
    el.querySelector('.sheet').innerHTML = html + `<button class="primary full" data-close>${p.type === 'info' ? '知道了' : '太好了'}</button>`;
    el.hidden = false;
  }
  function openAch(id) {
    const a = ACHMAP[id], t = F.ach[id];
    let prog = '';
    if (!t) {
      if (id === 'speak') prog = `目前 ${F.speak90 || 0} / 10 次`;
      if (['s7', 's30', 's100'].includes(id)) prog = `目前連續 ${currentRun()} 天，最長紀錄 ${longestRun()} 天`;
      if (id === 'k1000') prog = `目前累計 ${Object.values(Game.days()).reduce((s, d) => s + (d.n || 0), 0)} 題`;
      if (id === 'dex') prog = `已收成 ${CROPS.filter(c => F.harvests.some(h => h.crop === c.id)).length} / 5 種`;
    }
    queuePop({ type: 'info', html: `<div class="pop-emoji${t ? '' : ' locked'}">${a.icon}</div><h2>${esc(a.name)}</h2><p>${esc(a.desc)}</p>
      <p class="muted">${t ? `已在 ${fmtDate(t)} 解鎖` : '尚未解鎖'}${prog ? `・${prog}` : ''}</p>` });
  }
  function openDex() {
    queuePop({ type: 'info', html: `<h2>📖 植物圖鑑</h2><div class="dex">${CROPS.map(c => {
      const ok = F.unlocked.includes(c.id), n = F.harvests.filter(h => h.crop === c.id).length;
      return `<div class="dex-item${ok ? '' : ' locked'}">${miniPlant(c.id, 6, ok ? '' : 'locked')}
        <div class="grow"><b>${ok ? esc(c.name) : '？？？'}</b><div class="muted">${c.days} 天收成・${unlockText(c)}</div>
        ${ok ? `<div class="dex-stages">${c.stages.map(s => `<span>${s}</span>`).join('')}</div><div class="muted">已收成 ${n} 次</div>` : ''}</div></div>`;
    }).join('')}</div>` });
  }

  // ---------- 備份 ----------
  const exportData = () => JSON.parse(JSON.stringify(F));
  function importData(d) {
    if (!d || typeof d !== 'object' || !Array.isArray(d.harvests)) return false;
    for (const [id, t] of Object.entries(d.ach || {})) if (ACHMAP[id] && (!F.ach[id] || t < F.ach[id])) F.ach[id] = t;
    const hk = h => `${h.crop}|${h.t}`;
    const have = new Set(F.harvests.map(hk));
    for (const h of d.harvests) if (CROP[h.crop] && !have.has(hk(h))) F.harvests.push(h);
    F.harvests.sort((a, b) => b.t - a.t);
    const dk = x => `${x.crop}|${x.day}|${x.id}`;
    const dHave = new Set(F.deadPlants.map(dk));
    for (const x of d.deadPlants || []) if (CROP[x.crop] && !dHave.has(dk(x))) F.deadPlants.push(x);
    for (const id of d.unlocked || []) if (CROP[id] && !F.unlocked.includes(id)) F.unlocked.push(id);
    F.unlocked.sort((a, b) => CROP[a].i - CROP[b].i);
    F.speak90 = Math.max(F.speak90 || 0, d.speak90 || 0);
    F.nextId = Math.max(F.nextId, d.nextId || 1) + 1;
    // 田裡的植物：這台裝置沒有正在種的，才用備份裡的
    const mine = F.plant && !F.plant.harvested && !F.plant.deadDay;
    if (!mine && d.plant && CROP[d.plant.crop] && !d.plant.harvested) { F.plant = d.plant; F.compost = !!d.compost; }
    save();
    reconcile();
    return true;
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden && currentView === 'farm') render(); });

  return {
    render, onPractice, onQuizPerfect, exportData, importData,
    // 測試用
    _: { simulate, stageOf, sow, harvest, reconcile, plantArt, miniPlant, state: () => F, CROPS, ACH, GOAL, RESCUE },
  };
})();
window.Farm = Farm;
