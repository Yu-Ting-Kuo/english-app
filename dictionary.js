'use strict';
// 首頁與英文辭典頁。共用 app.js 的 $, esc, toast, db, words, saveWord, deleteWord, say, show。

const STAR = {
  off: '<svg class="i" viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  on: '<svg class="i" viewBox="0 0 24 24" style="fill:currentColor"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
};

const findSaved = key => words.find(w => Dict.norm(w.word) === key);

// ---------- 搜尋紀錄 ----------
async function addHistory(key, word) {
  await db.put('history', { key, word, at: Date.now() });
  const all = await db.all('history');
  if (all.length > 50) {
    all.sort((a, b) => b.at - a.at);
    for (const h of all.slice(50)) await db.del('history', h.key);
  }
}
async function recentHistory(n = 12) {
  return (await db.all('history')).sort((a, b) => b.at - a.at).slice(0, n);
}

// ---------- 線上資料快取（避免同一個字重複呼叫 API） ----------
const ONLINE_TTL = 30 * 864e5;
async function onlineInfo(key) {
  const hit = await db.get('cache', 'wk:' + key);
  if (hit && Date.now() - hit.at < ONLINE_TTL) return hit.data;
  const data = await Dict.online(key);
  await db.put('cache', { key: 'wk:' + key, at: Date.now(), data });
  return data;
}

// ---------- 首頁搜尋（首頁畫面在 topics.js） ----------
$('#home-search').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#home-q').value.trim();
  if (q) { $('#home-q').value = ''; openWord(q); }
});
document.addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { show(go.dataset.go); return; }
  const w = e.target.closest('[data-word]');
  if (w) openWord(w.dataset.word, w.dataset.fromTopic ? { topic: currentTopic } : {});
});

// ---------- 辭典：搜尋建議 ----------
let suggestTimer = null;
let suggestToken = 0;
function closeSuggest() {
  clearTimeout(suggestTimer);
  suggestToken++; // 讓還在路上的建議結果作廢，避免查詢後選單又跳出來
  $('#dict-suggest').hidden = true;
}
$('#dict-q').addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const token = ++suggestToken;
  suggestTimer = setTimeout(async () => {
    const q = $('#dict-q').value;
    const box = $('#dict-suggest');
    if (!q.trim()) { box.hidden = true; return; }
    try {
      const list = await Dict.suggest(q);
      if (token !== suggestToken) return;
      box.innerHTML = list.map(k => `<button type="button" data-word="${esc(k)}">${esc(k)}</button>`).join('');
      box.hidden = !list.length;
    } catch { box.hidden = true; }
  }, 120);
});
// 延遲收起，讓點選建議的動作先完成；如果使用者又回到輸入框就不收
$('#dict-q').addEventListener('blur', () => setTimeout(() => {
  if (document.activeElement !== $('#dict-q')) $('#dict-suggest').hidden = true;
}, 200));
$('#dict-form').addEventListener('submit', e => {
  e.preventDefault();
  closeSuggest();
  const q = $('#dict-q').value.trim();
  if (q) openWord(q);
});

// ---------- 辭典：查詢與顯示 ----------
let currentEntry = null;
let lookupSeq = 0;
let entryCtx = {};

function backToTopic() {
  if (!entryCtx.topic) return '';
  return `<button class="ghost back" data-topic="${esc(entryCtx.topic)}">← 回到主題</button>`;
}

async function openWord(q, ctx = {}) {
  entryCtx = ctx;
  $('#dict-q').value = q;
  closeSuggest();
  $('#dict-q').blur(); // 收起手機鍵盤
  if (currentView !== 'dict') show('dict');
  const seq = ++lookupSeq;
  const body = $('#dict-body');
  body.innerHTML = '<div class="card empty">查詢中…</div>';
  let res;
  try {
    res = await Dict.lookup(q);
  } catch (err) {
    if (seq !== lookupSeq) return;
    body.innerHTML = `<div class="card empty">${err.code === 'network'
      ? '沒有網路，而且這個字還沒查過，所以手機裡沒有資料。連上網路後再查一次。'
      : '查詢失敗：' + esc(err.message)}<br><br><button class="primary" data-word="${esc(q)}">重試</button></div>`;
    return;
  }
  if (seq !== lookupSeq || !res) return;
  if (!res.entry) {
    currentEntry = null;
    // 主題裡收錄、但詞典沒有獨立條目的片語（例如 social media）
    const tg = await topicGloss(res.key);
    if (seq !== lookupSeq) return;
    if (tg) {
      currentEntry = { key: res.key, entry: { w: tg.word, m: [{ p: 'phr', l: '片語', m: tg.gloss }] }, formOf: [], partial: true };
      addHistory(res.key, tg.word).catch(() => {});
      renderPartial(currentEntry, tg);
      return;
    }
    const own = findSaved(res.key);
    body.innerHTML = `
      ${backToTopic()}
      <div class="card stack">
        <div>詞典裡找不到「<b>${esc(q)}</b>」。</div>
        ${res.suggestions.length ? `<div><div class="muted">你是不是要找：</div>
          <div class="row wrap" style="margin-top:6px">${res.suggestions.map(s => `<button class="chip-btn" data-word="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>` : ''}
        ${own ? `<div class="muted">這個字在你的單字本裡：${esc(own.meaning || '（沒有中文意思）')}</div>
          <button data-edit="${own.id}">編輯我記的內容</button>` : ''}
        ${/\s/.test(q.trim()) && q.trim().split(/\s+/).length > 3 ? '<div class="muted">看起來是一整句話。辭典只查單字和片語。</div>' : ''}
      </div>`;
    return;
  }
  currentEntry = res;
  addHistory(res.key, res.entry.w).catch(() => {});
  renderEntry(res);
  window.scrollTo(0, 0);
}

function starButton(key) {
  const saved = !!findSaved(key);
  return `<button class="star ${saved ? 'on' : ''}" id="star" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏這個字'}">
    ${saved ? STAR.on : STAR.off}<span>${saved ? '已收藏' : '收藏'}</span></button>`;
}

function renderEntry(res) {
  const { key, entry } = res;
  const freq = Dict.frequency(entry.f);
  const chips = [
    freq && `<span class="chip" title="BNC／COCA 詞頻排名第 ${freq.rank}">${freq.level}</span>`,
    entry.o && '<span class="chip">牛津 3000 核心字</span>',
    entry.c && `<span class="chip" title="Collins 詞頻星等">Collins ${'★'.repeat(entry.c)}</span>`,
    ...(entry.t || []).map(t => `<span class="chip">${esc(t)}</span>`),
  ].filter(Boolean).join('');

  const notes = [];
  if (res.redirected) {
    const f = res.formOf[0];
    notes.push(`你查的「<b>${esc(res.redirected)}</b>」是 <b>${esc(entry.w)}</b> 的${esc(f.labels.join('、') || '變化形')}。`);
  }
  for (const f of res.formOf.slice(res.redirected ? 1 : 0)) {
    notes.push(`<b>${esc(entry.w)}</b> 也是 <button class="link" data-word="${esc(f.key)}">${esc(f.key)}</button> 的${esc(f.labels.join('、') || '變化形')}。`);
  }

  const meanings = entry.m.map(g => `
    <div class="sense">
      <span class="pos pos-${esc(g.p)}">${esc(g.l)}</span>${g.d ? `<span class="domain">${esc(g.d)}</span>` : ''}
      <div class="sense-text">${esc(g.m)}</div>
    </div>`).join('');

  const infl = Dict.inflections(key, entry).map(g => `
    <div class="infl">
      <div class="muted">${g.title}</div>
      <table>${g.rows.map(([label, ws]) => `<tr><th>${label}</th><td>${ws.map(w =>
        Dict.norm(w) === key ? `<b>${esc(w)}</b>` : `<button class="link" data-word="${esc(w)}">${esc(w)}</button>`).join('、')}</td></tr>`).join('')}</table>
    </div>`).join('');

  const saved = findSaved(key);
  $('#dict-body').innerHTML = `
    ${backToTopic()}
    <article class="card stack entry">
      <div class="row">
        <h2 class="headword grow" style="margin:0">${esc(entry.w)}</h2>
        ${starButton(key)}
      </div>
      <div id="pron" class="pron">
        ${entry.ph ? `<span class="muted">詞典音標 /${esc(entry.ph)}/</span>` : ''}
        <button class="pill" data-tts="en-US">${ICON.speaker}美式</button>
        <button class="pill" data-tts="en-GB">${ICON.speaker}英式</button>
      </div>
      ${chips ? `<div class="row wrap">${chips}</div>` : ''}
      ${notes.length ? `<div class="notice">${notes.join('<br>')}</div>` : ''}
    </article>

    <section class="card stack">
      <h3>詞性與中文意思</h3>
      ${meanings}
    </section>

    ${infl ? `<section class="card stack"><h3>詞形變化 <span class="en">Inflections</span></h3>${infl}</section>` : ''}

    <section class="card stack" id="synonyms" hidden></section>

    ${entry.rs ? `<section class="card stack" id="confusables"><h3>易混淆單字 <span class="en">Commonly Confused</span></h3><div class="muted">載入中…</div></section>` : ''}

    <section class="card stack" id="entry-topics" hidden></section>

    <section class="card">
      <details id="wk">
        <summary>英英解釋</summary>
        <div class="stack" id="wk-body" style="margin-top:10px"><div class="muted">載入中…</div></div>
      </details>
    </section>

    ${saved ? `<button class="primary" data-practice="${saved.id}">${ICON.mic}練習這個字的發音</button>` : ''}

    <p class="source">中文詞義、詞形、詞頻、易混淆辨析：ECDICT（MIT 授權），由簡體自動轉為台灣繁體，可能有少數用詞不夠自然。
    真人發音、IPA 音標、英英解釋：Wiktionary（CC BY-SA），經 Free Dictionary API 取得，需要網路。
    目前沒有可靠的免費 KK 音標資料，所以不顯示 KK 音標。</p>`;

  $('#star').onclick = () => toggleStar(key, entry);
  loadOnline(key, entry);
  if (entry.rs) loadConfusables(entry.rs);
  loadEntryTopics(key);
}

// 詞典沒有獨立條目、但主題裡有收錄的片語
function renderPartial(res, tg) {
  const { key, entry } = res;
  const parts = tg.word.split(/[\s-]+/).filter(Boolean);
  $('#dict-body').innerHTML = `
    ${backToTopic()}
    <article class="card stack entry">
      <div class="row">
        <h2 class="headword grow" style="margin:0">${esc(entry.w)}</h2>
        ${starButton(key)}
      </div>
      <div class="pron">
        <button class="pill" data-tts="en-US">${ICON.speaker}美式（合成）</button>
        <button class="pill" data-tts="en-GB">${ICON.speaker}英式（合成）</button>
      </div>
      <div class="notice">ECDICT 沒有收錄這個片語的獨立條目，所以這裡沒有詞典音標、詞性和詞形變化。</div>
    </article>
    <section class="card stack">
      <h3>在「${esc(tg.topic)}」主題中的意思</h3>
      <div class="sense-text">${esc(tg.gloss)}</div>
      <div class="source" style="margin:0">此說明由 App 編輯整理，不是詞典原文。</div>
    </section>
    <section class="card stack">
      <h3>組成單字</h3>
      <div class="row wrap">${parts.map(p => `<button class="chip-btn" data-word="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    </section>
    <section class="card stack" id="entry-topics" hidden></section>`;
  $('#star').onclick = () => toggleStar(key, entry);
  loadEntryTopics(key);
}

async function loadEntryTopics(key) {
  const ts = await topicsOfWord(key);
  const box = $('#entry-topics');
  if (!box || !ts.length || currentEntry?.key !== key) return;
  box.hidden = false;
  box.innerHTML = `<h3>所屬主題</h3>
    <div class="row wrap">${ts.map(t => `<button class="chip-btn topic-chip" data-topic="${esc(t.id)}">${esc(t.zh)}</button>`).join('')}</div>`;
}

async function loadSynonyms(key, syns) {
  const box = $('#synonyms');
  if (!box || !syns.length) return;
  const rows = await Promise.all(syns.slice(0, 10).map(async s => {
    const e = await Dict.getEntry(Dict.norm(s)).catch(() => null);
    return { s, zh: e ? shortMeaning(e) : '' };
  }));
  if (currentEntry?.key !== key) return;
  box.hidden = false;
  box.innerHTML = `<h3>同義詞與近義詞 <span class="en">Synonyms</span></h3>
    <div class="syn-list">${rows.map(r => `<button class="syn" data-word="${esc(r.s)}"><b>${esc(r.s)}</b>${r.zh ? `<span>${esc(r.zh)}</span>` : ''}</button>`).join('')}</div>
    <div class="source" style="margin:0">同義詞來自 Wiktionary；中文為各字在 ECDICT 的主要意思，用法不一定完全相同，請點進去比較。</div>`;
}

function shortMeaning(entry) {
  const g = entry.m.find(x => !x.d) || entry.m[0];
  return g ? g.m.split(/[；;]/)[0].split(/[,，]/).slice(0, 3).join('、') : '';
}

async function toggleStar(key, entry) {
  const btn = $('#star');
  btn.disabled = true;
  try {
    const saved = findSaved(key);
    if (saved) {
      await deleteWord(saved.id);
      toast(`已取消收藏「${entry.w}」`);
    } else {
      const info = await db.get('cache', 'wk:' + key).catch(() => null);
      const ipa = info?.data?.us?.ipa || info?.data?.ipa;
      await saveWord({
        word: entry.w,
        phonetic: ipa || (entry.ph ? `/${entry.ph}/` : ''),
        meaning: shortMeaning(entry),
        pos: [...new Set(entry.m.filter(g => !g.d).map(g => g.l))],
        example: '', note: '',
        known: false, createdAt: Date.now(), starredAt: Date.now(), practice: {}, source: 'dict',
      });
      toast(`已收藏「${entry.w}」`);
    }
  } catch (err) {
    toast('儲存失敗：' + (err?.message || err));
  }
  if (currentEntry?.key === key) {
    if (currentEntry.partial) renderPartial(currentEntry, await topicGloss(key));
    else renderEntry(currentEntry);
  }
  renderList();
}

async function loadOnline(key, entry) {
  const pron = $('#pron');
  const body = $('#wk-body');
  let info;
  try {
    info = await onlineInfo(key);
  } catch {
    if (currentEntry?.key !== key) return;
    body.innerHTML = '<div class="muted">需要網路才能載入英英解釋和真人發音。下方的美式、英式按鈕會用手機內建語音朗讀。</div>';
    return;
  }
  if (currentEntry?.key !== key) return;
  if (!info.found) {
    body.innerHTML = '<div class="muted">Wiktionary 沒有這個字的資料。</div>';
    return;
  }
  const part = (label, r, lang) => r ? `<button class="pill" ${r.audio ? `data-audio="${esc(r.audio)}"` : `data-tts="${lang}"`}>${ICON.speaker}${label}${r.ipa ? ` ${esc(r.ipa)}` : ''}</button>` : '';
  const real = part('美式', info.us, 'en-US') + part('英式', info.uk, 'en-GB');
  pron.innerHTML = `
    ${!info.us && !info.uk && info.ipa ? `<span class="muted">IPA ${esc(info.ipa)}</span>` : ''}
    ${real || ''}
    ${!info.us ? `<button class="pill" data-tts="en-US">${ICON.speaker}美式（合成）</button>` : ''}
    ${!info.uk ? `<button class="pill" data-tts="en-GB">${ICON.speaker}英式（合成）</button>` : ''}
    ${entry.ph && !info.ipa && !info.us?.ipa ? `<span class="muted">詞典音標 /${esc(entry.ph)}/</span>` : ''}`;
  loadSynonyms(key, info.synonyms || []);
  body.innerHTML = info.defs.length ? info.defs.map(g => `
    <div><span class="pos">${esc(g.pos)}</span>
    <ol class="defs">${g.items.map(d => `<li>${esc(d)}</li>`).join('')}</ol></div>`).join('')
    + (info.source ? `<a class="source" href="${esc(info.source)}" target="_blank" rel="noopener">在 Wiktionary 查看原文</a>` : '')
    : '<div class="muted">沒有英英解釋。</div>';
}

async function loadConfusables(ids) {
  const box = $('#confusables');
  try {
    const groups = await Dict.resembleGroups(ids);
    if (!box.isConnected) return;
    box.innerHTML = '<h3>易混淆單字</h3>' + groups.map(g => `
      <div class="confuse">
        ${g.intro ? `<div class="muted">${esc(g.intro)}</div>` : ''}
        ${g.items.map(([w, text]) => `<div class="confuse-item"><button class="link" data-word="${esc(w)}">${esc(w)}</button>：${esc(text)}</div>`).join('')}
      </div>`).join('');
  } catch {
    if (box.isConnected) box.innerHTML = '<h3>易混淆單字</h3><div class="muted">需要網路才能載入。</div>';
  }
}

// 發音按鈕：有真人錄音就播錄音，沒有就用手機語音
document.addEventListener('click', e => {
  const a = e.target.closest('[data-audio]');
  if (a) {
    const audio = new Audio(a.dataset.audio);
    audio.play().catch(() => say(currentEntry?.entry.w || ''));
    return;
  }
  const t = e.target.closest('[data-tts]');
  if (t && currentEntry) {
    const keep = settings.accent;
    settings.accent = t.dataset.tts;
    say(currentEntry.entry.w).finally(() => { settings.accent = keep; });
    return;
  }
  const p = e.target.closest('[data-practice]');
  if (p) { practiceId = Number(p.dataset.practice); practiceTarget = 'word'; lastResult = null; show('practice'); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) { const w = words.find(x => x.id === Number(ed.dataset.edit)); if (w) editWord(w); }
});

renderHome(); // 不等資料庫，先把主題顯示出來
init().catch(err => toast('讀取單字失敗：' + err.message, 4000));
