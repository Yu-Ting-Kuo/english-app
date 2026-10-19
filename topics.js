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
  office: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/></svg>',
  commerce: '<svg class="i" viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M6 16v-5M11 16V8M16 16v-7M21 4l-6 5-4-3-7 5"/></svg>',
  tech: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  services: '<svg class="i" viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
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

// 多益程度由 tools/build_topics.py 依 BNC／COCA 詞頻計算：前 4,000 名 TOEIC 600、4,001～10,000 名 750、10,000 名以後 900
const LEVELS = ['600', '750', '900'];
const CORE_LEVELS = ['B', 'I', 'A'];
const LEVEL = { 600: 'TOEIC 600', 750: 'TOEIC 750', 900: 'TOEIC 900', B: '初階', I: '中階', A: '進階' };
const LEVEL_EN = { 600: '常見', 750: '中高階', 900: '進階', B: 'Beginner', I: 'Intermediate', A: 'Advanced' };

// 主題單字的統一資料格式（列表、收藏、測驗共用）：
// { id, word, partOfSpeech, meaning, category, level, frequencyRank, page, audioUrl, key, lv, section }
// level 是多益程度（TOEIC 600／750／900），frequencyRank 是 BNC／COCA 詞頻排名（數字越小越常見）
// 沒有預錄音檔（audioUrl 為空），發音用手機內建英文語音
const PAGE_SIZE = 40;
let topicPage = 1;
let topicFilter = 'all';
try { topicFilter = localStorage.getItem('topicFilter') || 'all'; } catch {}

function topicItems(tid, t, sort = topicSort) {
  // id 依主題原本的順序編號，換排序或篩選時不會變
  let list = t.sections.flatMap(s => s.words.map(w => ({ w, section: s.zh, sectionEn: s.en })))
    .map((x, i) => ({ ...x, n: i + 1 }));
  if (sort !== 'context') {
    list = [...list].sort((a, b) => (a.w.r || 1e9) - (b.w.r || 1e9));
    if (sort === 'level') {
      const order = t.auto ? CORE_LEVELS : LEVELS;
      list.sort((a, b) => order.indexOf(a.w.lv) - order.indexOf(b.w.lv));
    }
  }
  return list.map(({ w, section, sectionEn, n }) => ({
    id: `${tid}-${String(n).padStart(3, '0')}`,
    word: w.w,
    partOfSpeech: w.ps || '',
    meaning: w.g,
    category: `${t.en} ${t.zh}`,
    level: LEVEL[w.lv] || '',
    frequencyRank: w.r || null,
    page: 1,
    audioUrl: '',
    key: w.k || Dict.norm(w.w),
    lv: w.lv,
    section, sectionEn,
  }));
}

// 依多益程度或「最不熟」（測驗答錯過）篩選，再依每頁字數編頁碼
function filterItems(items, f) {
  const out = f === 'all' ? items : f === 'weak' ? items.filter(it => QuizStats.weak(it.key)) : items.filter(it => it.lv === f);
  return out.map((it, i) => ({ ...it, page: Math.floor(i / PAGE_SIZE) + 1 }));
}

const BOOKMARK = {
  off: '<svg class="i" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  on: '<svg class="i" viewBox="0 0 24 24" style="fill:currentColor"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
};

function wordRow(it) {
  const saved = !!findSaved(it.key);
  return `<div class="word-row">
    <button class="wr-main" data-word="${esc(it.word)}" data-from-topic="1">
      <span class="wr-top"><span class="wr-word">${esc(it.word)}</span>${it.partOfSpeech ? `<span class="wr-pos">${esc(it.partOfSpeech)}</span>` : ''}</span>
      <span class="wr-gloss">${esc(it.meaning)}</span>
    </button>
    ${it.lv ? `<span class="lvl lvl-${it.lv}">${it.level}</span>` : ''}
    <button class="icon-btn wr-save ${saved ? 'on' : ''}" data-save="${esc(it.id)}" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏'} ${esc(it.word)}">${saved ? BOOKMARK.on : BOOKMARK.off}</button>
    <button class="icon-btn" data-say-word="${esc(it.word)}" aria-label="播放 ${esc(it.word)} 的發音">${ICON.speaker}</button>
  </div>`;
}

// 同一頁裡連續屬於同一組（情境分組或難度）的字放在同一張卡片
function groupRows(items, by) {
  const groups = [];
  for (const it of items) {
    const g = by(it);
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(it); else groups.push([g, [it]]);
  }
  return groups;
}

let currentItems = [];
async function renderTopic() {
  const box = $('#topic-body');
  let data;
  try { data = await loadTopics(); } catch { topicError(box, 'topic-retry'); return; }
  const t = data.topics[currentTopic];
  if (!t) { show('home'); return; }
  const c = data.categories.find(x => x.id === t.cat);
  const topicHeading = t.auto
    ? `${esc(t.zh)} <span class="en">${esc(t.en)}</span>`
    : `${esc(currentTopic)} <span class="en">${esc(t.zh)}</span>`;
  const topicLevels = t.auto ? CORE_LEVELS : LEVELS;
  $('#title').textContent = t.zh;
  const all = topicItems(currentTopic, t);
  if (!['all', 'weak', ...topicLevels].includes(topicFilter)) topicFilter = 'all';
  currentItems = filterItems(all, topicFilter);
  const counts = { all: all.length, weak: all.filter(it => QuizStats.weak(it.key)).length };
  for (const l of topicLevels) counts[l] = all.filter(it => it.lv === l).length;
  const pages = Math.max(1, Math.ceil(currentItems.length / PAGE_SIZE));
  topicPage = Math.min(Math.max(1, topicPage), pages);
  const pageItems = currentItems.filter(it => it.page === topicPage);
  const groups = topicSort === 'context' ? groupRows(pageItems, it => it.section)
    : topicSort === 'level' ? groupRows(pageItems, it => it.lv) : [['', pageItems]];
  const list = groups.map(([g, its]) => `
      <section class="card stack">
        ${g ? `<h3>${topicSort === 'level' ? `${LEVEL[g]} <span class="en">${LEVEL_EN[g]}</span>` : `${esc(g)} <span class="en">${esc(its[0].sectionEn)}</span>`}</h3>` : ''}
        <div class="word-rows">${its.map(wordRow).join('')}</div>
      </section>`).join('');
  const pager = pages > 1 ? `<div class="pager" role="navigation" aria-label="分頁">${Array.from({ length: pages }, (_, i) =>
    `<button data-page="${i + 1}" class="${i + 1 === topicPage ? 'on' : ''}" aria-label="第 ${i + 1} 頁"${i + 1 === topicPage ? ' aria-current="page"' : ''}>${i + 1}</button>`).join('')}</div>` : '';
  box.innerHTML = `
    <button class="ghost back" data-cat="${c.id}">← ${esc(c.zh)}</button>
    <div>
      <h2 class="page-title">${topicHeading} <span class="count">(${t.count})</span></h2>
      <p class="muted" style="margin:4px 0 8px">${esc(t.intro)}</p>
      <div class="row wrap">${levelChips(t)}</div>
    </div>
    <div class="seg" id="topic-sort">
      <button data-sort="context" class="${topicSort === 'context' ? 'on' : ''}">${t.auto ? '依詞性' : '依情境'}</button>
      <button data-sort="level" class="${topicSort === 'level' ? 'on' : ''}">依難度</button>
      <button data-sort="freq" class="${topicSort === 'freq' ? 'on' : ''}">依常用程度</button>
    </div>
    <div class="filter-chips" id="topic-filter" role="group" aria-label="依難度篩選">
      ${[['all', '全部'], ...topicLevels.map(l => [l, LEVEL[l]]), ['weak', '最不熟']].map(([k, label]) =>
        `<button data-filter="${k}" class="${topicFilter === k ? 'on' : ''}" aria-pressed="${topicFilter === k}">${label} <span class="n">${counts[k]}</span></button>`).join('')}
    </div>
    ${pager}
    ${currentItems.length ? list : `<div class="card empty">${topicFilter === 'weak'
      ? '還沒有答錯過的字。做一次「練習」或「開始測驗」，答錯的字會出現在這裡。'
      : '這個主題沒有這個程度的單字。'}</div>`}
    ${pager}
    <p class="source">${t.auto
      ? '單元依 TSL／BSL／NGSL／NAWL 詞彙表（CC BY-SA 4.0，newgeneralservicelist.com）與詞頻排序整理；中文為整理過的主要詞義。'
      : '主題分類與「在這個情境中的意思」由 App 編輯整理，不是詞典原文。'}點單字可以看完整辭典條目。
    多益程度依 BNC／COCA 詞頻排名估計：前 4,000 名為 TOEIC 600、4,001～10,000 名為 750、10,000 名以後為 900；片語依組成單字中最少見的那個字計算。「最不熟」是在練習或測驗中答錯次數比答對多的字。</p>
    <div class="topic-actions">
      <button id="t-practice" ${currentItems.length ? '' : 'disabled'}>練習</button>
      <button id="t-quiz" class="primary" ${currentItems.length ? '' : 'disabled'}>開始測驗</button>
    </div>`;
  $('#topic-sort').onclick = e => {
    const s = e.target.closest('[data-sort]')?.dataset.sort;
    if (!s || s === topicSort) return;
    topicSort = s;
    topicPage = 1;
    try { localStorage.setItem('topicSort', s); } catch {}
    renderTopic();
  };
  $('#topic-filter').onclick = e => {
    const f = e.target.closest('[data-filter]')?.dataset.filter;
    if (!f || f === topicFilter) return;
    topicFilter = f;
    topicPage = 1;
    try { localStorage.setItem('topicFilter', f); } catch {}
    renderTopic();
  };
  box.querySelectorAll('.pager').forEach(pg => pg.onclick = e => {
    const n = Number(e.target.closest('[data-page]')?.dataset.page);
    if (!n || n === topicPage) return;
    topicPage = n;
    renderTopic();
    $('#topic-body .pager')?.scrollIntoView({ block: 'start' });
  });
  // 練習：這一頁的字；開始測驗：整個主題隨機出題
  // 篩選後的字太少時，選項的干擾字從整個主題挑
  const quizItems = currentItems.length ? currentItems : all;
  $('#t-practice').onclick = () => Quiz.choose({ mode: 'practice', items: pageItems.length ? pageItems : quizItems, all, title: `${t.zh}・第 ${topicPage} 頁` });
  $('#t-quiz').onclick = () => Quiz.choose({ mode: 'test', items: quizItems, all, title: t.zh });
}

// 列表上的書籤與發音按鈕
$('#topic-body').addEventListener('click', async e => {
  const sayBtn = e.target.closest('[data-say-word]');
  if (sayBtn) { say(sayBtn.dataset.sayWord); return; }
  const btn = e.target.closest('[data-save]');
  if (!btn) return;
  const it = currentItems.find(x => x.id === btn.dataset.save);
  if (!it) return;
  btn.disabled = true;
  try {
    const on = await toggleItemSaved(it);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    btn.setAttribute('aria-label', `${on ? '取消收藏' : '收藏'} ${it.word}`);
    btn.innerHTML = on ? BOOKMARK.on : BOOKMARK.off;
  } finally {
    btn.disabled = false;
  }
});

// 收藏或取消收藏一個主題單字；回傳收藏後的狀態
async function toggleItemSaved(it) {
  const saved = findSaved(it.key);
  if (saved) {
    await deleteWord(saved.id);
    toast(`已取消收藏「${it.word}」`);
    renderList();
    return false;
  }
  const entry = await Dict.getEntry(it.key).catch(() => null);
  await saveWord({
    word: it.word,
    phonetic: entry?.ph ? `/${entry.ph}/` : '',
    meaning: it.meaning,
    pos: it.partOfSpeech ? [it.partOfSpeech] : (entry ? Dict.posLabels(entry) : []),
    example: '', note: '',
    known: false, createdAt: Date.now(), starredAt: Date.now(), practice: {}, source: 'topic',
  });
  toast(`已收藏「${it.word}」`);
  renderList();
  return true;
}

function levelChips(t) {
  const levels = t.auto ? CORE_LEVELS : LEVELS;
  return levels.map(l => `<span class="lvl lvl-${l}">${LEVEL[l]}・${t.levels?.[l] ?? 0}</span>`).join('');
}

function openTopic(id) {
  if (id !== currentTopic) topicPage = 1;
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
