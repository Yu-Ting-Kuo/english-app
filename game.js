'use strict';
// 勇者冒險：把每天的練習變成 RPG。
// 答題、複習、發音都會得到經驗值（XP）；某一天完全沒練習，隔天打開 App 會被扣 XP，扣到低於目前等級的門檻就會降級。
// 進度存在這台裝置的 localStorage（key: game），設定裡的備份也會一起匯出。
const Game = (() => {
  const KEY = 'game';
  const GOAL = 15;             // 每日目標：15 題
  const TIME_GOAL = 10;        // 每日學習時間目標：10 分鐘
  const GOAL_BONUS = 50;       // 達成每日目標的額外獎勵
  const PENALTY = 40;          // 每缺席一天扣的 XP
  const MAX_PENALTY_DAYS = 7;  // 一次回來最多結算 7 天，避免久未打開就被歸零
  const MAX_LEVEL = 99;
  const XP = { quizRight: 10, review: 15, speakGood: 20, speakTry: 5 };

  const TIERS = [
    [1, '🧑‍🌾', '見習村民'], [3, '📘', '單字學徒'], [6, '🧭', '詞彙旅人'], [10, '⚔️', '文法劍士'],
    [15, '🛡️', '詞彙騎士'], [20, '🔮', '語言法師'], [30, '📜', '辭典賢者'], [40, '👑', '傳說勇者'],
  ];
  const tierOf = lv => [...TIERS].reverse().find(t => lv >= t[0]);

  // 升到第 L 級所需的累計 XP：1→2 要 100，之後每級多 40
  const need = L => (L - 1) * (20 * L + 60);
  const levelOf = xp => { let L = 1; while (L < MAX_LEVEL && need(L + 1) <= xp) L++; return L; };

  // 每日進度一律用台灣時間（UTC+8，台灣沒有日光節約時間），不受手機時區設定影響
  const TW = 8 * 3600000;
  const p2 = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  const dayKey = (t = Date.now()) => ymd(new Date((t instanceof Date ? t.getTime() : t) + TW));
  const twHour = (t = Date.now()) => new Date(t + TW).getUTCHours();
  const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return ymd(new Date(Date.UTC(y, m - 1, d + n))); };

  const fresh = () => ({ xp: 0, start: dayKey(), checked: addDays(dayKey(), -1), days: {}, events: [], lastTs: 0 });
  let st = fresh();
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const today = () => (st.days[dayKey()] ||= { n: 0, xp: 0, sec: 0, goal: false });
  const log = text => { st.events.unshift({ t: Date.now(), text }); st.events.length = Math.min(st.events.length, 30); };

  // 連續學習天數：今天有練就算今天，今天還沒練就從昨天往回算
  function streak() {
    let k = st.days[dayKey()]?.n > 0 ? dayKey() : addDays(dayKey(), -1), n = 0;
    while (st.days[k]?.n > 0) { n++; k = addDays(k, -1); }
    return n;
  }
  const streakBefore = () => { let k = addDays(dayKey(), -1), n = 0; while (st.days[k]?.n > 0) { n++; k = addDays(k, -1); } return n; };
  const multiplier = () => 1 + Math.min(0.5, 0.1 * streakBefore());

  // ---------- 結算缺席 ----------
  function settle() {
    const yesterday = addDays(dayKey(), -1);
    if (st.checked >= yesterday) return;
    let missed = 0;
    for (let k = addDays(st.checked, 1); k <= yesterday; k = addDays(k, 1)) {
      if (k >= st.start && !(st.days[k]?.n > 0)) missed++;
    }
    st.checked = yesterday;
    if (missed) {
      const days = Math.min(missed, MAX_PENALTY_DAYS);
      const before = levelOf(st.xp);
      const loss = Math.min(st.xp, days * PENALTY);
      st.xp -= loss;
      const after = levelOf(st.xp);
      if (loss) log(`缺席 ${missed} 天，失去 ${loss} XP` + (after < before ? `，從 Lv.${before} 降到 Lv.${after}` : ''));
      save();
      if (loss) setTimeout(() => celebrate(after < before ? 'down' : 'loss', { missed, loss, before, after }), 400);
    } else save();
  }

  // ---------- 得到經驗值 ----------
  function award(kind, arg) {
    settle();
    let base = 0;
    if (kind === 'quiz') base = arg ? XP.quizRight : 0;
    else if (kind === 'review') base = arg === false ? 0 : XP.review;
    else if (kind === 'speak') base = arg >= 70 ? XP.speakGood : XP.speakTry;
    const d = today();
    const now = Date.now();
    d.sec += (st.lastTs && now - st.lastTs < 90000) ? Math.min(90, Math.round((now - st.lastTs) / 1000)) : 15;
    st.lastTs = now;
    const lvBefore = levelOf(st.xp);
    d.n++;
    let gain = Math.round(base * multiplier());
    let bonus = 0;
    if (!d.goal && d.n >= GOAL) { d.goal = true; bonus = GOAL_BONUS; log(`達成今日目標 ${GOAL} 題，獲得 ${GOAL_BONUS} XP`); }
    st.xp += gain + bonus;
    d.xp += gain + bonus;
    const lvAfter = levelOf(st.xp);
    if (lvAfter > lvBefore) log(`升級！Lv.${lvBefore} → Lv.${lvAfter}　${tierOf(lvAfter)[2]}`);
    save();
    if (lvAfter > lvBefore) setTimeout(() => celebrate('up', { before: lvBefore, after: lvAfter }), 700);
    else if (bonus) toast(`🎯 今日目標達成！+${gain + bonus} XP`, 2200);
    else if (gain) toast(`+${gain} XP`, 900);
    // 通知學習農場（澆水、成就）；農場出錯不能影響原本的計分
    try { window.Farm?.onPractice({ kind, arg, day: dayKey(now), n: d.n, hour: twHour(now) }); } catch (e) { console.error('[farm]', e); }
    if (currentView === 'farm') render();
  }

  // ---------- 畫面 ----------
  function celebrate(type, o) {
    let el = document.getElementById('game-sheet');
    if (!el) {
      el = document.createElement('div');
      el.id = 'game-sheet'; el.className = 'sheet-bg center';
      el.innerHTML = '<div class="sheet stack game-pop" role="dialog"></div>';
      el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) el.hidden = true; });
      document.body.appendChild(el);
    }
    const t = o.after ? tierOf(o.after) : null;
    const html = {
      up: `<div class="pop-emoji">🎉</div><h2>升級了！</h2><p class="pop-big">Lv.${o.before} → Lv.${o.after}</p><p>${t[1]} 你現在是「${t[2]}」</p>`,
      loss: `<div class="pop-emoji">💤</div><h2>勇者休息太久了</h2><p>你有 ${o.missed} 天沒有練習，失去了 <b>${o.loss} XP</b>。</p><p class="muted">今天練習 ${GOAL} 題就能慢慢補回來。</p>`,
      down: `<div class="pop-emoji">💥</div><h2>等級下降了…</h2><p class="pop-big">Lv.${o.before} → Lv.${o.after}</p><p>缺席 ${o.missed} 天，失去了 <b>${o.loss} XP</b>。</p><p class="muted">每天練習就不會再掉了，加油！</p>`,
    }[type];
    el.querySelector('.sheet').innerHTML = html + '<button class="primary full" data-close>' + (type === 'up' ? '繼續冒險' : '我要重振旗鼓') + '</button>';
    el.hidden = false;
  }

  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const last7 = () => Array.from({ length: 7 }, (_, i) => {
    const k = addDays(dayKey(), i - 6), [y, m, d] = k.split('-').map(Number);
    return { k, wd: WD[new Date(y, m - 1, d).getDay()], ...(st.days[k] || { n: 0, xp: 0, sec: 0 }), isToday: i === 6 };
  });

  function bars(list, val, goal, max, unit, goalLabel) {
    const pct = v => Math.min(100, (v / max) * 100);
    return `<div class="gchart"><div class="gline top"><span>${max}</span></div>
      <div class="gline goal" style="bottom:${pct(goal)}%"><span>${goalLabel}</span></div><div class="gline bot"><span>0</span></div>
      <div class="gbars">${list.map(d => {
        const v = val(d);
        return `<div class="gcol"><div class="gbar-wrap">${v > 0 ? `<div class="gbar" style="height:${Math.max(6, pct(v))}%" title="${v}${unit}"></div>` : '<div class="gbar none"></div>'}</div>
        <div class="gday${d.isToday ? ' today' : ''}">${d.wd}</div></div>`;
      }).join('')}</div></div>`;
  }

  function render() {
    const box = document.getElementById('adv-stats');
    if (!box) return;
    settle();
    const days = last7(), d = st.days[dayKey()] || { n: 0, xp: 0, sec: 0 };
    const lv = levelOf(st.xp), lo = need(lv), hi = need(lv + 1);
    const pct = lv >= MAX_LEVEL ? 100 : Math.round(((st.xp - lo) / (hi - lo)) * 100);
    const t = tierOf(lv), sk = streak(), mult = Math.round((multiplier() - 1) * 100);
    const total7 = days.reduce((s, x) => s + x.n, 0);
    const min7 = Math.round(days.reduce((s, x) => s + x.sec, 0) / 60);
    const todayMin = Math.round(d.sec / 60);
    const danger = d.n === 0
      ? (st.xp - PENALTY < lo && lv > 1
        ? `⚠️ 今天還沒練習。明天打開 App 會扣 ${PENALTY} XP，<b>你會從 Lv.${lv} 降到 Lv.${levelOf(st.xp - PENALTY)}</b>！`
        : `⚠️ 今天還沒練習。今天沒練，明天打開 App 會扣 ${PENALTY} XP。`)
      : d.n < GOAL ? `再練 ${GOAL - d.n} 題就達成今日目標，額外獲得 ${GOAL_BONUS} XP！` : `🎯 今日目標達成！今天已經安全了。`;
    box.innerHTML = `
      <h3 class="adv-h">學習統計</h3>
      <div class="card hero">
        <div class="hero-av">${t[1]}</div>
        <div class="grow">
          <div class="hero-lv">Lv.${lv} <span>${t[2]}</span></div>
          <div class="xpbar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
          <div class="muted">${lv >= MAX_LEVEL ? '已達最高等級' : `經驗值 ${st.xp - lo} / ${hi - lo}（距離升級還差 ${hi - st.xp}）`}</div>
        </div>
      </div>
      <div class="card hero-sub">
        <div><b>🔥 ${sk}</b> 天<div class="muted">連續學習${mult ? `・XP +${mult}%` : ''}</div></div>
        <div><b>⭐ ${st.xp}</b><div class="muted">累計經驗值</div></div>
      </div>
      <div class="card xp-hint${d.n === 0 ? ' danger' : ''}"><div class="muted">${danger}</div></div>

      <h3 class="adv-h">練習次數</h3>
      <div class="card">
        ${bars(days, x => x.n, GOAL, 30, '題', '目標')}
        <div class="adv-foot"><div><b class="big">${total7}</b> 題<div class="muted">過去 7 天共練習</div></div>
          <div class="r"><b class="big">${d.n}</b> / ${GOAL}<div class="muted">今日練習</div></div></div>
      </div>

      <h3 class="adv-h">連續學習</h3>
      <div class="card">
        <div class="streak-row">${days.map(x => `<div><div class="bolt${x.n > 0 ? ' on' : ''}${x.isToday ? ' today' : ''}">⚡</div><div class="gday${x.isToday ? ' today' : ''}">${x.wd}</div></div>`).join('')}</div>
        <div class="muted" style="margin-top:8px">連續學習 <b class="big">${sk}</b> 天　最近 7 天有 ${days.filter(x => x.n > 0).length} 天學習</div>
      </div>

      <h3 class="adv-h">學習時間</h3>
      <div class="card">
        ${bars(days, x => Math.round(x.sec / 60), TIME_GOAL, 20, '分', '目標')}
        <div class="adv-foot"><div><b class="big">${min7}</b> 分<div class="muted">過去 7 天共學習</div></div>
          <div class="r"><b class="big">${todayMin}</b> / ${TIME_GOAL}<div class="muted">今日學習（分）</div></div></div>
      </div>

      <h3 class="adv-h">冒險紀錄</h3>
      <div class="card">${st.events.length
        ? st.events.slice(0, 8).map(e => `<div class="ev"><span class="muted">${fmtDate(e.t)}</span> ${esc(e.text)}</div>`).join('')
        : '<div class="muted">還沒有紀錄。答對一題就會得到第一筆經驗值！</div>'}</div>

      <details class="card rules">
        <summary>經驗值與扣分規則</summary>
        <ul class="muted">
          <li>測驗答對一題 <b>+${XP.quizRight}</b> XP；翻卡複習「記住了」<b>+${XP.review}</b> XP（同一個字只在第一次記住時給）。</li>
          <li>發音練習 70 分以上 <b>+${XP.speakGood}</b> XP，其他 <b>+${XP.speakTry}</b> XP。</li>
          <li>每天練習 ${GOAL} 題，額外 <b>+${GOAL_BONUS}</b> XP。</li>
          <li>連續學習每多一天，XP 多 10%，最高 +50%。</li>
          <li>某一天完全沒練習，隔天打開 App 會扣 <b>${PENALTY}</b> XP，扣到低於目前等級門檻就會<b>降級</b>。一次最多結算 ${MAX_PENALTY_DAYS} 天，等級最低是 Lv.1。</li>
          <li>練習次數包含答錯的題目，只是答錯不給 XP。</li>
        </ul>
      </details>`;
    box.querySelectorAll('[data-adv]').forEach(b => b.onclick = () => {
      if (b.dataset.adv === 'practice') practiceId = null;
      show(b.dataset.adv);
    });
  }

  // 備份用
  const exportData = () => JSON.parse(JSON.stringify(st));
  function importData(data) {
    if (!data || typeof data.xp !== 'number' || typeof data.days !== 'object') return false;
    // 合併：每天取練習次數較多的那份；XP 取較高者
    for (const [k, v] of Object.entries(data.days)) {
      const mine = st.days[k];
      if (!mine || v.n > mine.n) st.days[k] = { n: v.n | 0, xp: v.xp | 0, sec: v.sec | 0, goal: !!v.goal };
    }
    st.xp = Math.max(st.xp, data.xp | 0);
    if (data.start && data.start < st.start) st.start = data.start;
    save();
    return true;
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) { settle(); if (currentView === 'farm') render(); } });
  settle();
  return { award, render, exportData, importData, levelOf, need, GOAL, dayKey, addDays, twHour, days: () => st.days };
})();
