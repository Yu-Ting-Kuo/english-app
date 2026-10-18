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
};

// 依日期輪流推薦一個主題（同一天打開都一樣）
function todayTopicId(data) {
  const ids = data.categories.flatMap(c => c.topics);
  const day = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5);
  return ids[day % ids.length];
}

function topicError(box, retry) {
  box.innerHTML = `<div class="card empty">主題資料載入失敗，請確認網路連線。<br><br><button class="primary" id="${retry}">重試</button></div>`;
  $('#' + retry).onclick = () => show(currentView);
}

// ---------- 首頁 ----------
async function renderHome() {
  const recent = await recentHistory(10).catch(() => []);
  $('#home-recent').innerHTML = recent.length
    ? `<div class="row wrap">${recent.map(h => `<button class="chip-btn" data-word="${esc(h.word)}">${esc(h.word)}</button>`).join('')}</div>`
    : '<p class="muted" style="margin:0">查過的字會出現在這裡。</p>';
  $('#home-saved').textContent = words.length ? `我的收藏 ${words.length} 個字` : '我的收藏';

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
    <div class="topic-list">${c.topics.map(id => {
      const t = data.topics[id];
      return `<button class="topic-card" data-topic="${id}">
        <span class="topic-name">${esc(t.zh)}</span>
        <span class="topic-en">${esc(t.en)}</span>
        <span class="topic-meta">${esc(t.level)} · ${t.count} 個字</span>
      </button>`;
    }).join('')}</div>`;
}

// ---------- 主題：單字列表 ----------
let currentTopic = null;
let topicSort = 'context';
try { topicSort = localStorage.getItem('topicSort') || 'context'; } catch {}

const levelOf = r => (!r ? null : r <= 2000 ? '基礎' : r <= 6000 ? '中級' : '進階');

function wordRow(w) {
  const key = w.k || Dict.norm(w.w);
  const saved = !!findSaved(key);
  const level = levelOf(w.r);
  return `<button class="word-row" data-word="${esc(w.w)}" data-from-topic="1">
    <span class="wr-main">
      <span class="wr-word">${esc(w.w)}</span>
      <span class="wr-gloss">${esc(w.g)}</span>
    </span>
    ${level ? `<span class="lvl lvl-${level}">${level}</span>` : ''}
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
      const groups = ['基礎', '中級', '進階', null].map(l => [l, sorted.filter(w => levelOf(w.r) === l)]).filter(g => g[1].length);
      list = groups.map(([l, ws]) => `
        <section class="card stack">
          <h3>${l ? l + '單字' : '片語與複合詞'}</h3>
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
      <div class="row wrap"><span class="chip">${esc(t.level)}</span><span class="chip">${t.count} 個單字</span></div>
    </div>
    <div class="seg" id="topic-sort">
      <button data-sort="context" class="${topicSort === 'context' ? 'on' : ''}">依情境</button>
      <button data-sort="level" class="${topicSort === 'level' ? 'on' : ''}">依難度</button>
      <button data-sort="freq" class="${topicSort === 'freq' ? 'on' : ''}">依常用程度</button>
    </div>
    ${list}
    <p class="source">主題分類與「在這個情境中的意思」由 App 編輯整理，不是詞典原文；點單字可以看完整辭典條目。程度依 BNC／COCA 詞頻估算。</p>`;
  $('#topic-sort').onclick = e => {
    const s = e.target.closest('[data-sort]')?.dataset.sort;
    if (!s || s === topicSort) return;
    topicSort = s;
    try { localStorage.setItem('topicSort', s); } catch {}
    renderTopic();
  };
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
