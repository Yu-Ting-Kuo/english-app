'use strict';
// 主題探索：首頁、大分類、主題單字列表。
// 主題資料（dict/topics.json，由 tools/build_topics.py 產生）只記錄「哪個字屬於哪個主題」，
// 詞義一律從辭典讀取，同一個字在多個主題裡共用同一筆辭典資料。

let topicsData = null;
function loadTopics() {
  topicsData ??= fetch('dict/topics.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .catch(err => { topicsData = null; throw err; });
  return topicsData;
}

const CAT_ICON = {
  daily: '<svg class="i" viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
  travel: '<svg class="i" viewBox="0 0 24 24"><path d="M2 16.5 21 9a1.5 1.5 0 0 0-1-2.8L14 8 7 3 5 4l4 6-4.5 1.6L2 10l-1 1 3 3z"/><path d="M3 21h18"/></svg>',
  work: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/></svg>',
  toeic: '<svg class="i" viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  academic: '<svg class="i" viewBox="0 0 24 24"><path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></svg>',
  society: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  core: '<svg class="i" viewBox="0 0 24 24"><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 9h8M8 13h6"/></svg>',
};

// 依日期輪流推薦一個主題（同一天打開都一樣）
function todayTopicId(data) {
  const ids = data.categories.filter(c => c.id !== 'core').flatMap(c => c.topics);
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5);
  return ids[day % ids.length];
}

function topicError(box, retry) {
  box.innerHTML = `<div class="card empty">主題資料載入失敗，請確認網路連線。<br><br><button class="primary" id="${retry}">重試</button></div>`;
  $('#' + retry).onclick = () => show(currentView);
}

// ---------- 首頁 ----------
async function renderHome() {
  // 主題和最近查詢分開載入：手機資料庫暫時打不開時，主題照樣能顯示
  renderHomeRecent();
  let data;
  try {
    data = await loadTopics();
  } catch {
    topicError($('#home-topics'), 'home-retry');
    $('#home-today').innerHTML = '';
    return;
  }
  const tid = todayTopicId(data);
  const t = data.topics[tid];
  const cat = data.categories.find(c => c.id === t.cat);
  $('#home-today').innerHTML = `
    <div class="today">
      <div class="eyebrow">今日主題 · ${esc(cat.zh)}</div>
      <h2>${esc(t.zh)}</h2>
      <div class="en">${esc(t.en)}</div>
      <p>${esc(t.intro)}</p>
      <div class="row wrap"><span class="chip">${esc(t.level)}</span><span class="chip">${t.count} 個單字</span></div>
      <div class="row wrap">${levelChips(t)}</div>
      <button class="primary" data-topic="${tid}">開始探索</button>
    </div>`;
  $('#home-topics').innerHTML = data.categories.map(c => `
    <button class="cat-card" data-cat="${c.id}">
      <span class="cat-icon">${CAT_ICON[c.id] || ''}</span>
      <span class="cat-name">${esc(c.zh)}</span>
      <span class="cat-en">${esc(c.en)}</span>
      <span class="cat-meta">${c.topics.length} 個主題 · ${c.count} 個字</span>
    </button>`).join('');
}

async function renderHomeRecent() {
  const recent = await recentHistory(10).catch(() => []);
  $('#home-recent').innerHTML = recent.length
    ? `<div class="row wrap">${recent.map(h => `<button class="chip-btn" data-word="${esc(h.word)}">${esc(h.word)}</button>`).join('')}</div>`
    : '<p class="muted" style="margin:0">查過的字會出現在這裡。</p>';
  $('#home-saved').textContent = words.length ? `我的收藏 ${words.length} 個字` : '我的收藏';
}

// ---------- 大分類：子主題列表 ----------
let currentCat = null;
async function renderCategory() {
  const box = $('#cat-body');
  let data;
  try { data = await loadTopics(); } catch { topicError(box, 'cat-retry'); return; }
  const c = data.categories.find(x => x.id === currentCat) || data.categories[0];
  $('#title').textContent = c.zh;
  box.innerHTML = `
    <button class="ghost back" data-go="home">← 所有主題</button>
    <div>
      <h2 class="page-title">${esc(c.zh)} <span class="en">${esc(c.en)}</span></h2>
      <p class="muted" style="margin:4px 0 0">${esc(c.desc)}</p>
    </div>
    ${groupTopics(c.topics.map(id => [id, data.topics[id]])).map(([group, items]) => `
      ${group ? `<h3 style="margin:8px 2px 0">${esc(group)}</h3>` : ''}
      <div class="topic-list">${items.map(([id, t]) => `<button class="topic-card" data-topic="${id}">
        <span class="topic-name">${esc(t.zh)}</span>
        <span class="topic-en">${esc(t.en)}</span>
        <span class="topic-meta">${t.count} 個字</span>
      </button>`).join('')}</div>`).join('')}`;
}

// 依 group 欄位分組（多益核心字彙依詞彙表分組），保持原本順序
function groupTopics(pairs) {
  const groups = [];
  for (const p of pairs) {
    const g = p[1].group || '';
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(p); else groups.push([g, [p]]);
  }
  return groups;
}

// ---------- 主題：單字列表 ----------
let currentTopic = null;
let topicSort = 'context';
try { topicSort = localStorage.getItem('topicSort') || 'context'; } catch {}

// 難度由 tools/build_topics.py 依 BNC／COCA 詞頻計算：初階前 2,500 名、中階 2,501～8,000、進階 8,000 名以後
const LEVEL = { B: '初階', I: '中階', A: '進階' };
const LEVEL_EN = { B: 'Beginner', I: 'Intermediate', A: 'Advanced' };

function wordRow(w) {
  const key = w.k || Dict.norm(w.w);
  const saved = !!findSaved(key);
  return `<button class="word-row" data-word="${esc(w.w)}" data-from-topic="1">
    <span class="wr-main">
      <span class="wr-word">${esc(w.w)}</span>
      <span class="wr-gloss">${esc(w.g)}</span>
    </span>
    ${w.lv ? `<span class="lvl lvl-${w.lv}">${LEVEL[w.lv]}</span>` : ''}
    ${saved ? `<span class="wr-star" aria-label="已收藏">${STAR.on}</span>` : ''}
  </button>`;
}

async function renderTopic() {
  const box = $('#topic-body');
  let data;
  try { data = await loadTopics(); } catch { topicError(box, 'topic-retry'); return; }
  const t = data.topics[currentTopic];
  if (!t) { show('home'); return; }
  const c = data.categories.find(x => x.id === t.cat);
  $('#title').textContent = t.zh;
  const all = t.sections.flatMap(s => s.words);
  let list;
  if (topicSort === 'context') {
    list = t.sections.map(s => `
      <section class="card stack">
        <h3>${esc(s.zh)} <span class="en">${esc(s.en)}</span></h3>
        <div class="word-rows">${s.words.map(wordRow).join('')}</div>
      </section>`).join('');
  } else {
    // 依常用程度：詞頻排名小的在前；依難度：同樣依詞頻由易到難，並標出程度分組
    const sorted = [...all].sort((a, b) => (a.r || 1e9) - (b.r || 1e9));
    if (topicSort === 'level') {
      const groups = ['B', 'I', 'A'].map(l => [l, sorted.filter(w => w.lv === l)]).filter(g => g[1].length);
      list = groups.map(([l, ws]) => `
        <section class="card stack">
          <h3>${LEVEL[l]} <span class="en">${LEVEL_EN[l]}</span></h3>
          <div class="word-rows">${ws.map(wordRow).join('')}</div>
        </section>`).join('');
    } else {
      list = `<section class="card stack"><div class="word-rows">${sorted.map(wordRow).join('')}</div></section>`;
    }
  }
  box.innerHTML = `
    <button class="ghost back" data-cat="${c.id}">← ${esc(c.zh)}</button>
    <div>
      <h2 class="page-title">${esc(t.zh)} <span class="en">${esc(t.en)}</span></h2>
      <p class="muted" style="margin:4px 0 8px">${esc(t.intro)}</p>
      <div class="row wrap"><span class="chip">${t.count} 個單字</span>${levelChips(t)}</div>
    </div>
    <div class="seg" id="topic-sort">
      <button data-sort="context" class="${topicSort === 'context' ? 'on' : ''}">${t.auto ? '依詞性' : '依情境'}</button>
      <button data-sort="level" class="${topicSort === 'level' ? 'on' : ''}">依難度</button>
      <button data-sort="freq" class="${topicSort === 'freq' ? 'on' : ''}">依常用程度</button>
    </div>
    ${list}
    <p class="source">${t.auto
      ? '單元依 TSL／BSL／NGSL／NAWL 詞彙表（CC BY-SA 4.0，newgeneralservicelist.com）與詞頻排序整理；中文為 ECDICT 的主要釋義。'
      : '主題分類與「在這個情境中的意思」由 App 編輯整理，不是詞典原文。'}點單字可以看完整辭典條目。
    難度依 BNC／COCA 詞頻排名計算：初階為前 2,500 名、中階 2,501～8,000 名、進階為 8,000 名以後；片語依組成單字中最少見的那個字計算。</p>`;
  $('#topic-sort').onclick = e => {
    const s = e.target.closest('[data-sort]')?.dataset.sort;
    if (!s || s === topicSort) return;
    topicSort = s;
    try { localStorage.setItem('topicSort', s); } catch {}
    renderTopic();
  };
}

function levelChips(t) {
  return ['B', 'I', 'A'].map(l => `<span class="lvl lvl-${l}">${LEVEL[l]} ${t.levels?.[l] ?? 0}</span>`).join('');
}

function openTopic(id) {
  currentTopic = id;
  show('topic');
}

document.addEventListener('click', e => {
  const cat = e.target.closest('[data-cat]');
  if (cat) { currentCat = cat.dataset.cat; show('cat'); return; }
  const tp = e.target.closest('[data-topic]');
  if (tp) openTopic(tp.dataset.topic);
});

// 辭典條目用：這個字屬於哪些主題
async function topicsOfWord(key) {
  try {
    const data = await loadTopics();
    return (data.byWord[key] || []).map(id => ({ id, ...data.topics[id] }));
  } catch {
    return [];
  }
}
// 在主題裡的意思（App 編輯整理），給沒有詞典條目的片語用
async function topicGloss(key) {
  try {
    const data = await loadTopics();
    for (const id of data.byWord[key] || []) {
      for (const s of data.topics[id].sections) {
        const w = s.words.find(x => (x.k || Dict.norm(x.w)) === key);
        if (w) return { gloss: w.g, word: w.w, topic: data.topics[id].zh };
      }
    }
  } catch {}
  return null;
}
