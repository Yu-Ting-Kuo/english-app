'use strict';
// 我的英文單字本 — 資料都存在這支手機的 IndexedDB，不需要伺服器。

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- 設定 (存在 localStorage) ----------
const settings = { accent: 'en-US', rate: '0.9' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('settings') || '{}')); } catch {}
function saveSettings() { try { localStorage.setItem('settings', JSON.stringify(settings)); } catch {} }

// ---------- IndexedDB ----------
const db = (() => {
  let opening;
  function open() {
    opening ??= new Promise((resolve, reject) => {
      // v2：新增 history（搜尋紀錄）、cache（線上詞典資料快取）
      const r = indexedDB.open('english-app', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('words')) d.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('recordings')) d.createObjectStore('recordings', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('history')) d.createObjectStore('history', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'key' });
      };
      r.onsuccess = () => {
        // 別的分頁要升級資料庫時，主動放開連線，避免對方卡住
        r.result.onversionchange = () => { r.result.close(); location.reload(); };
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => toast('有其他分頁開著舊版的單字本，請把那些分頁關掉', 8000);
    });
    return opening;
  }
  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }
  return {
    all: store => run(store, 'readonly', s => s.getAll()),
    get: (store, key) => run(store, 'readonly', s => s.get(key)),
    put: (store, val) => run(store, 'readwrite', s => s.put(val)),
    del: (store, key) => run(store, 'readwrite', s => s.delete(key)),
  };
})();

let words = [];

async function saveWord(w) {
  w.id = await db.put('words', w);
  const i = words.findIndex(x => x.id === w.id);
  if (i >= 0) words[i] = w; else words.unshift(w);
  return w;
}

async function deleteWord(id) {
  await db.del('words', id);
  await db.del('recordings', id + ':word');
  await db.del('recordings', id + ':example');
  words = words.filter(w => w.id !== id);
}

// ---------- 發音 (iPhone 內建語音) ----------
function pickVoice(lang) {
  const all = speechSynthesis.getVoices();
  const normalized = value => value.replace('_', '-').toLowerCase();
  const exact = all.filter(v => normalized(v.lang) === normalized(lang));
  const regional = exact.length ? exact : all.filter(v => normalized(v.lang).startsWith(normalized(lang).slice(0, 2)));
  const natural = v => /natural|neural|online|enhanced|premium/i.test(v.name);
  const preferred = lang === 'en-GB' ? /Daniel|Kate|Serena|Arthur/i : /Samantha|Ava|Allison|Nicky|Tom|Aria|Jenny|Guy|Ryan/i;
  return regional.find(v => natural(v) && preferred.test(v.name))
      || regional.find(natural)
      || regional.find(v => preferred.test(v.name))
      || regional.find(v => !v.localService)
      || regional[0];
}
speechSynthesis.getVoices();
speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();

function say(text, { slow = false, rate } = {}) {
  return new Promise(resolve => {
    if (!text) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = settings.accent;
    const v = pickVoice(settings.accent);
    if (v) u.voice = v;
    u.rate = rate || (slow ? 0.6 : Number(settings.rate));
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// ---------- 錄音 ----------
const recorder = {
  mr: null, stream: null, timer: null,
  get active() { return !!this.mr; },
  async start(onStop) {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('這個瀏覽器不能錄音，請用 iOS 14.3 以上的 Safari');
    }
    speechSynthesis.cancel();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
    const mr = new MediaRecorder(this.stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      // 一定要關掉麥克風，不然 iPhone 之後的播放聲音會變很小
      this.stream.getTracks().forEach(t => t.stop());
      this.mr = this.stream = null;
      clearTimeout(this.timer);
      onStop(new Blob(chunks, { type: mr.mimeType || type || 'audio/mp4' }));
    };
    mr.start();
    this.mr = mr;
    this.timer = setTimeout(() => this.stop(), 20000);
  },
  stop() { if (this.mr?.state === 'recording') this.mr.stop(); },
};

let player = null;
function playBlob(blob) {
  return new Promise(resolve => {
    player?.pause();
    const url = URL.createObjectURL(blob);
    player = new Audio(url);
    player.onended = player.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    player.play().catch(() => resolve());
  });
}

// ---------- 發音評分 (iPhone 語音辨識) ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeRecognition = null;

function listen() {
  return new Promise((resolve, reject) => {
    const r = new Recognition();
    r.lang = settings.accent;
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 5;
    let finished = false;
    const finish = (fn, v) => { if (!finished) { finished = true; activeRecognition = null; clearTimeout(t); fn(v); } };
    r.onresult = e => finish(resolve, Array.from(e.results[0]).map(a => ({ text: a.transcript, conf: a.confidence })));
    r.onerror = e => finish(reject, e.error);
    r.onend = () => finish(resolve, []);
    const t = setTimeout(() => r.stop(), 12000);
    activeRecognition = r;
    r.start();
  });
}

const tokens = s => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s-]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean);

function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const charSim = (a, b) => (a || b) ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1;

// 把聽到的字跟目標逐字對齊，回傳 0–1 的分數和每個目標字有沒有念對
function compare(target, heard) {
  const T = tokens(target), H = tokens(heard);
  if (!T.length) return { acc: 0, marks: [] };
  const credit = (t, h) => { const s = charSim(t, h); return s >= 0.6 ? s : 0; };
  const m = T.length, n = H.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1] + credit(T[i - 1], H[j - 1]));
    }
  }
  const marks = new Array(m).fill(0);
  for (let i = m, j = n; i > 0 && j > 0;) {
    const c = credit(T[i - 1], H[j - 1]);
    if (c > 0 && dp[i][j] === dp[i - 1][j - 1] + c) { marks[i - 1] = c; i--; j--; }
    else if (dp[i][j] === dp[i - 1][j]) i--;
    else j--;
  }
  const extra = Math.max(0, n - m);
  let acc = dp[m][n] / (m + 0.5 * extra);
  // 單字被拆開聽成兩個字時（resilient → "re silent"），用整串字母比較
  const joined = charSim(T.join(''), H.join(''));
  if (joined > acc) { acc = joined; marks.fill(joined >= 0.6 ? joined : 0); }
  return { acc, marks };
}

function scoreAttempt(target, alts) {
  let best = { score: 0, heard: '', marks: tokens(target).map(() => 0) };
  for (const a of alts) {
    const { acc, marks } = compare(target, a.text);
    // iPhone 多半不給信心值 (0)，有的話稍微加權
    const conf = a.conf > 0 ? 0.8 + 0.2 * a.conf : 1;
    const score = Math.round(Math.min(1, acc * conf) * 100);
    if (score > best.score || !best.heard) best = { score, heard: a.text, marks };
  }
  return best;
}

// ---------- 分頁 ----------
let currentView = 'home';
function show(view) {
  if (recorder.active) recorder.stop();
  activeRecognition?.abort?.();
  currentView = view;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  // 新增／編輯頁屬於收藏；主題頁屬於首頁
  const tab = { add: 'list', cat: 'home', topic: 'home', quiz: 'home', az: 'home' }[view] || view;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.view === tab));
  $('#title').textContent = {
    home: '主題探索', dict: '英文辭典', list: '我的收藏', add: $('#f-id').value ? '編輯單字' : '新增單字',
    practice: '發音練習', adventure: '勇者冒險', conversation: '英文對話', review: '複習', cat: '主題', topic: '主題', quiz: '測驗', az: '單字本 A–Z',
  }[view];
  if (view === 'home') renderHome();
  if (view === 'cat') renderCategory();
  if (view === 'topic') renderTopic();
  if (view === 'az') renderAZ();
  if (view === 'quiz') Quiz.render();
  if (view === 'list') renderList();
  if (view === 'practice') renderPractice();
  if (view === 'review') startReview();
  if (view === 'adventure') Game.render();
  if (view === 'dict' && !$('#dict-body').innerHTML.trim()) setTimeout(() => $('#dict-q').focus(), 50);
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.view === 'practice') practiceId = null;
  show(b.dataset.view);
}));
// ---------- AI 語音對話 ----------
const conversationProviders = {
  chatgpt: {
    name: 'ChatGPT', url: 'https://chatgpt.com/',
    note: '語音對話可用於網頁與 iPhone；可在 Edge 和手機間切換。',
  },
  gemini: {
    name: 'Gemini', url: 'https://gemini.google.com/app',
    note: 'Gemini Live 支援 iPhone，但需使用 Gemini App；官方目前未在 Gemini 網頁版提供 Live。',
  },
  claude: {
    name: 'Claude', url: 'https://claude.ai/',
    note: 'Claude 語音可在 iPhone 與 Android App 使用；網頁版目前沒有同樣的語音對話模式。',
  },
};
const conversationTopics = {
  daily: 'everyday life, such as hobbies, food, shopping, and weekend plans',
  work: 'workplace and business situations, such as meetings, emails, and project updates',
  travel: 'travel situations, such as checking in at a hotel, asking for directions, and ordering food',
};
const conversationLevels = {
  beginner: 'beginner level: use simple words, short sentences, and give me extra time to answer',
  intermediate: 'intermediate level: use common natural expressions and a moderate speaking pace',
  advanced: 'advanced level: use natural, varied expressions and gently challenge me with follow-up questions',
};
function updateConversationPrompt() {
  const provider = conversationProviders[$('#chat-provider')?.value] || conversationProviders.chatgpt;
  const topic = conversationTopics[$('#chat-scenario')?.value] || conversationTopics.daily;
  const level = conversationLevels[$('#chat-level')?.value] || conversationLevels.beginner;
  const prompt = `You are my friendly English conversation tutor. Help me practice spoken English through a role-play about ${topic}.\n\nUse ${level}. Ask only one question at a time and wait for my answer before continuing. If I make a mistake, briefly model a more natural version and continue kindly. Explain in Traditional Chinese (Taiwan) only when I ask for help. After about 8 exchanges, summarize up to 3 useful corrections and 5 practical phrases in Traditional Chinese.`;
  const field = $('#chat-prompt');
  if (field) field.value = prompt;
  const note = $('#chat-provider-note');
  if (note) note.textContent = provider.note;
  const open = $('#chat-open');
  if (open) open.textContent = `開啟 ${provider.name} ↗`;
}
$('#chat-provider')?.addEventListener('change', updateConversationPrompt);
$('#chat-scenario')?.addEventListener('change', updateConversationPrompt);
$('#chat-level')?.addEventListener('change', updateConversationPrompt);
$('#chat-copy')?.addEventListener('click', async () => {
  const field = $('#chat-prompt');
  try {
    await navigator.clipboard.writeText(field.value);
    toast('練習指令已複製，到 ChatGPT 貼上即可');
  } catch {
    field.focus(); field.select();
    toast('請複製已選取的指令，再貼到 ChatGPT', 3000);
  }
});
$('#chat-open')?.addEventListener('click', () => {
  const provider = conversationProviders[$('#chat-provider')?.value] || conversationProviders.chatgpt;
  window.open(provider.url, '_blank', 'noopener');
});
updateConversationPrompt();
$('#add-word').addEventListener('click', () => { resetForm(); show('add'); });

// ---------- 單字本 ----------
function highlight(sentence, word) {
  const s = esc(sentence);
  const w = (word || '').trim();
  if (!w) return s;
  return s.replace(new RegExp(`\\b(${escRe(esc(w))}\\w*)`, 'gi'), '<mark>$1</mark>');
}

function bestScore(w) {
  const p = w.practice || {};
  return Math.max(p.word?.best ?? -1, p.example?.best ?? -1);
}

const fmtDate = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const f = $('#filter').value;
  const pos = $('#pos-filter').value;
  const sort = $('#sort').value;
  // 詞性篩選的選項跟著單字本裡實際有的詞性變
  const allPos = [...new Set(words.flatMap(w => w.pos || []))];
  $('#pos-filter').innerHTML = '<option value="">所有詞性</option>' +
    allPos.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('') + '<option value="-">未分類</option>';
  $('#pos-filter').value = [...allPos, '', '-'].includes(pos) ? pos : '';
  const shown = words.filter(w =>
    (f === 'all' || (f === 'known') === !!w.known) &&
    (!pos || (pos === '-' ? !w.pos?.length : w.pos?.includes(pos))) &&
    (!q || [w.word, w.meaning, w.example, w.note].some(x => (x || '').toLowerCase().includes(q))));
  const sorters = {
    new: (a, b) => (b.starredAt || b.createdAt) - (a.starredAt || a.createdAt),
    old: (a, b) => (a.starredAt || a.createdAt) - (b.starredAt || b.createdAt),
    az: (a, b) => a.word.localeCompare(b.word, 'en', { sensitivity: 'base' }),
    weak: (a, b) => (a.known - b.known) || (bestScore(a) - bestScore(b)),
  };
  shown.sort(sorters[sort] || sorters.new);
  const known = words.filter(w => w.known).length;
  $('#count').textContent = words.length ? `${words.length} 個單字 · 已熟記 ${known} · 學習中 ${words.length - known}` : '';
  $('#list').innerHTML = shown.length ? shown.map(w => {
    const best = bestScore(w);
    return `
    <article class="card word-card" data-id="${w.id}">
      <div class="row">
        <div class="grow">
          <div class="headword">${esc(w.word)}</div>
          ${w.phonetic ? `<div class="phon">${esc(w.phonetic)}</div>` : ''}
        </div>
        <button class="round" data-say="${esc(w.word)}" aria-label="念 ${esc(w.word)}"><svg class="i" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg></button>
      </div>
      ${w.pos?.length ? `<div class="row wrap" style="gap:4px;margin-top:4px">${w.pos.map(p => `<span class="pos">${esc(p)}</span>`).join('')}</div>` : ''}
      ${w.meaning ? `<div class="meaning">${esc(w.meaning)}</div>` : ''}
      ${w.example ? `<div class="example">${highlight(w.example, w.word)}</div>` : ''}
      ${w.note ? `<div class="note">${esc(w.note)}</div>` : ''}
      <div class="row wrap" style="margin-top:10px">
        ${w.known ? '<span class="chip good">已熟記</span>' : '<span class="chip">學習中</span>'}
        ${best >= 0 ? `<span class="chip">發音最高 ${best} 分</span>` : ''}
        <span class="muted" style="font-size:12px">${w.starredAt ? '收藏' : '加入'}於 ${fmtDate(w.starredAt || w.createdAt)}</span>
        <span class="grow"></span>
        <button class="ghost" data-act="practice">練習</button>
        <button class="ghost" data-act="edit">編輯</button>
        <button class="danger" data-act="delete">移除</button>
      </div>
    </article>`;
  }).join('') : `<div class="empty">${words.length ? '沒有符合的單字' : '還沒有收藏的字。<br>在辭典條目按 ☆ 收藏，不熟的字就會出現在這裡。'}</div>`;
}
$('#search').addEventListener('input', renderList);
$('#filter').addEventListener('change', renderList);
$('#pos-filter').addEventListener('change', renderList);
$('#sort').addEventListener('change', renderList);

$('#list').addEventListener('click', async e => {
  const card = e.target.closest('.word-card');
  if (!card || e.target.closest('[data-say]')) return;
  const w = words.find(x => x.id === Number(card.dataset.id));
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'practice') { practiceId = w.id; practiceTarget = 'word'; lastResult = null; show('practice'); }
  else if (act === 'edit') editWord(w);
  else if (act === 'delete') {
    if (!confirm(`從單字本移除「${w.word}」？練習紀錄和錄音也會一起刪除。`)) return;
    await deleteWord(w.id); renderList(); toast('已移除');
  } else openWord(w.word);
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-say], [data-say-field]');
  if (!b) return;
  e.stopPropagation();
  say(b.dataset.say ?? $('#' + b.dataset.sayField).value);
}, true);

// ---------- 新增 / 編輯 ----------
const FIELDS = ['word', 'phonetic', 'meaning', 'example', 'note'];
function resetForm() {
  $('#form').reset();
  $('#f-id').value = '';
  $('#save-btn').textContent = '儲存單字';
  $('#cancel-edit').hidden = true;
  $('#dict').innerHTML = '';
}
function editWord(w) {
  resetForm();
  $('#f-id').value = w.id;
  FIELDS.forEach(f => { $('#f-' + f).value = w[f] || ''; });
  $('#save-btn').textContent = '更新';
  $('#cancel-edit').hidden = false;
  show('add');
}
$('#cancel-edit').addEventListener('click', () => { resetForm(); show('list'); });

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(FIELDS.map(f => [f, $('#f-' + f).value.trim()]));
  if (!data.word) return toast('請輸入單字');
  const id = Number($('#f-id').value);
  if (id) {
    await saveWord({ ...words.find(w => w.id === id), ...data });
    toast('已更新'); resetForm(); show('list');
  } else {
    const dup = words.find(w => Dict.norm(w.word) === Dict.norm(data.word));
    if (dup) { toast(`「${dup.word}」已經收藏過了`); editWord(dup); return; }
    const entry = await Dict.getEntry(Dict.norm(data.word)).catch(() => null);
    const pos = entry ? Dict.posLabels(entry) : [];
    await saveWord({ ...data, pos, known: false, createdAt: Date.now(), practice: {} });
    toast(`已加入「${data.word}」`); resetForm(); $('#f-word').focus();
  }
  renderList();
});

// 英英字典 dictionaryapi.dev + 中文翻譯 MyMemory，都免費、不用帳號
$('#lookup').addEventListener('click', async () => {
  const word = $('#f-word').value.trim();
  if (!word) return toast('先輸入單字');
  const btn = $('#lookup');
  btn.disabled = true; btn.textContent = '查詢中';
  // 先查 App 內建的繁體詞典，查不到才用機器翻譯
  const local = await Dict.lookup(word).catch(() => null);
  if (local?.entry) {
    if (!$('#f-meaning').value) $('#f-meaning').value = shortMeaning(local.entry);
    if (!$('#f-phonetic').value && local.entry.ph) $('#f-phonetic').value = `/${local.entry.ph}/`;
  }
  const [dictRes, zhRes] = await Promise.allSettled([
    fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word)).then(r => r.ok ? r.json() : Promise.reject()),
    local?.entry ? Promise.reject() : fetch('https://api.mymemory.translated.net/get?langpair=en|zh-TW&q=' + encodeURIComponent(word)).then(r => r.json()),
  ]);
  btn.disabled = false; btn.textContent = '查字典';

  if (zhRes.status === 'fulfilled' && !$('#f-meaning').value) {
    const zh = zhRes.value?.responseData?.translatedText;
    if (zh && zh.toLowerCase() !== word.toLowerCase()) $('#f-meaning').value = zh;
  }
  if (dictRes.status !== 'fulfilled') {
    $('#dict').innerHTML = '';
    return toast(local?.entry || zhRes.status === 'fulfilled' ? '已帶入中文意思' : '查不到，請檢查拼字或網路');
  }
  const data = dictRes.value;
  const phon = data.flatMap(d => [d.phonetic, ...(d.phonetics || []).map(p => p.text)]).find(Boolean);
  if (phon && (!$('#f-phonetic').value || $('#f-phonetic').value === `/${local?.entry?.ph}/`)) $('#f-phonetic').value = phon;
  const defs = data.flatMap(d => d.meanings.flatMap(m => m.definitions.map(x => ({ pos: m.partOfSpeech, def: x.definition, ex: x.example }))));
  const firstEx = defs.find(d => d.ex);
  if (firstEx && !$('#f-example').value) $('#f-example').value = firstEx.ex;
  $('#dict').innerHTML = `<div class="card"><div class="muted">英英解釋 · 點例句可以換成表單裡的例句</div>${
    defs.slice(0, 8).map(d => `
      <div style="margin-top:12px"><span class="chip">${esc(d.pos)}</span> ${esc(d.def)}
      ${d.ex ? `<div class="example" data-ex="${esc(d.ex)}" style="cursor:pointer">“${highlight(d.ex, word)}”</div>` : ''}</div>`).join('')
  }</div>`;
  toast('已帶入字典資料');
});
$('#dict').addEventListener('click', e => {
  const ex = e.target.closest('[data-ex]');
  if (ex) { $('#f-example').value = ex.dataset.ex; toast('已換成這個例句'); }
});

// ---------- 發音練習 ----------
let practiceId = null;
let practiceTarget = 'word';
let lastResult = null;

const ICON = {
  speaker: '<svg class="i" viewBox="0 0 24 24"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  mic: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
  stop: '<svg class="i" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  play: '<svg class="i" viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
  target: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
};

function practiceQueue() {
  // 還沒練過或分數低的排前面
  return [...words].sort((a, b) => bestScore(a) - bestScore(b));
}

async function renderPractice() {
  const box = $('#practice');
  if (!words.length) { box.innerHTML = '<div class="empty">先新增單字，再來練習發音。</div>'; return; }
  const w = words.find(x => x.id === practiceId) || practiceQueue()[0];
  practiceId = w.id;
  if (practiceTarget === 'example' && !w.example) practiceTarget = 'word';
  const text = practiceTarget === 'word' ? w.word : w.example;
  const stats = w.practice?.[practiceTarget];
  const rec = await db.get('recordings', `${w.id}:${practiceTarget}`);
  const res = lastResult?.id === w.id && lastResult.target === practiceTarget ? lastResult : null;
  const order = res ? [...res.tokenIndex] : [];
  const targetHtml = res
    ? text.split(/(\s+)/).map(part => {
        if (!part.trim()) return part;
        const idx = order.shift();
        if (idx === undefined) return esc(part);
        return `<span class="${res.marks[idx] >= 0.8 ? 'ok' : res.marks[idx] > 0 ? '' : 'miss'}">${esc(part)}</span>`;
      }).join('')
    : esc(text);
  const color = s => s >= 85 ? 'var(--good)' : s >= 60 ? 'var(--mid)' : 'var(--bad)';

  box.innerHTML = `
    <div class="stack">
      <div class="row">
        <select id="p-word" class="grow" aria-label="選擇單字">
          ${practiceQueue().map(x => `<option value="${x.id}" ${x.id === w.id ? 'selected' : ''}>${esc(x.word)}${bestScore(x) >= 0 ? ` · ${bestScore(x)} 分` : ''}</option>`).join('')}
        </select>
        <button id="p-next">下一個</button>
      </div>
      ${w.example ? `<div class="seg" id="p-target">
        <button data-t="word" class="${practiceTarget === 'word' ? 'on' : ''}">念單字</button>
        <button data-t="example" class="${practiceTarget === 'example' ? 'on' : ''}">念例句</button></div>` : ''}
      <div class="card stack">
        <div class="target ${practiceTarget === 'example' ? 'sentence' : ''}">${targetHtml}</div>
        ${practiceTarget === 'word' && w.phonetic ? `<div class="phon" style="text-align:center">${Pron.phoneticHtml(w.phonetic, res?.diag)}</div>` : ''}
        ${w.meaning && practiceTarget === 'word' ? `<div class="muted" style="text-align:center">${esc(w.meaning)}</div>` : ''}
        <div class="controls">
          <button id="p-listen">${ICON.speaker}標準發音</button>
          <button id="p-slow">${ICON.speaker}慢速</button>
          <button id="p-rec" class="${recorder.active ? 'rec' : ''}">${recorder.active ? ICON.stop + '停止錄音' : ICON.mic + '錄我的聲音'}</button>
          <button id="p-play" ${rec ? '' : 'disabled'}>${ICON.play}聽我的錄音</button>
          <button id="p-compare" class="full" ${rec ? '' : 'disabled'}>${ICON.play}對照：標準發音 → 我的錄音</button>
          <button id="p-score" class="primary full">${ICON.target}念一次，幫我評分</button>
        </div>
      </div>
      ${res ? diagHtml(res.diag, color) : ''}
      <div class="muted" style="text-align:center">${stats ? `已練習 ${stats.count} 次 · 最高 ${stats.best} 分 · 上次 ${stats.last} 分` : '還沒評分過這一題'}</div>
    </div>`;

  $('#p-word').onchange = e => { practiceId = Number(e.target.value); lastResult = null; renderPractice(); };
  $('#p-next').onclick = () => {
    const q = practiceQueue();
    const i = q.findIndex(x => x.id === w.id);
    practiceId = q[(i + 1) % q.length].id; lastResult = null; practiceTarget = 'word';
    renderPractice();
  };
  $('#p-target')?.addEventListener('click', e => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t && t !== practiceTarget) { practiceTarget = t; lastResult = null; renderPractice(); }
  });
  $('#p-listen').onclick = () => say(text);
  $('#p-slow').onclick = () => say(text, { slow: true });
  $('#p-demo')?.addEventListener('click', () => slowDemo(text, practiceTarget === 'word'));
  $('#p-play').onclick = () => rec && playBlob(rec.blob);
  $('#p-compare').onclick = async () => { await say(text); await new Promise(r => setTimeout(r, 400)); await playBlob(rec.blob); };
  $('#p-rec').onclick = async () => {
    if (recorder.active) { recorder.stop(); return; }
    try {
      await recorder.start(async blob => {
        await db.put('recordings', { key: `${w.id}:${practiceTarget}`, blob, at: Date.now() });
        toast('錄好了，按「聽我的錄音」播放');
        renderPractice();
      });
      renderPractice();
    } catch (err) {
      toast(err.name === 'NotAllowedError' ? '請允許使用麥克風：設定 → Safari → 麥克風' : (err.message || '無法錄音'), 3500);
    }
  };
  $('#p-score').onclick = async () => {
    if (!Recognition) {
      toast('這裡不能用語音辨識。請更新 iOS，或改用 Safari 開啟網址再試一次', 4000);
      return;
    }
    if (activeRecognition) { activeRecognition.stop(); return; }
    recorder.stop();
    speechSynthesis.cancel();
    const btn = $('#p-score');
    btn.innerHTML = ICON.stop + '正在聽…念完會自動停止';
    btn.classList.add('rec');
    const meter = await Pron.startMeter();
    try {
      let alts, frames;
      try { alts = await listen(); } finally { frames = meter?.stop(); }
      const r = scoreAttempt(text, alts);
      r.diag = Pron.diagnose({ target: text, isWord: practiceTarget === 'word', best: r, frames, phonetic: w.phonetic, marks: r.marks });
      r.score = r.diag.total;
      // 記下每個目標字在文字中的順序，給上面的紅綠標示用
      let k = 0;
      r.tokenIndex = text.split(/\s+/).filter(Boolean).map(part => {
        const n = tokens(part).length;
        if (!n) return undefined;
        k += n;
        return k - n;
      });
      lastResult = { ...r, id: w.id, target: practiceTarget };
      Game.award('speak', r.score);
      if (alts.length) {
        const p = (w.practice ||= {});
        const s = (p[practiceTarget] ||= { best: 0, count: 0, last: 0 });
        s.count++; s.last = r.score; s.best = Math.max(s.best, r.score);
        await saveWord(w);
        renderList();
      }
    } catch (err) {
      // 同時量音量讓語音辨識拿不到麥克風：之後不再量音量，請使用者再按一次
      if (err === 'audio-capture' && meter) {
        Pron.blockMeter();
        toast('請再按一次「念一次，幫我評分」', 3500);
        renderPractice();
        return;
      }
      const msg = {
        'not-allowed': '請允許麥克風和語音辨識：設定 → Safari → 麥克風 / 語音辨識',
        'service-not-allowed': '請到 設定 → 一般 → 鍵盤，打開「聽寫」後再試',
        'no-speech': '沒聽到聲音，按下按鈕後馬上念',
        'audio-capture': '麥克風被其他 App 占用了',
        'network': '語音辨識需要網路',
      }[err] || '語音辨識失敗：' + err;
      toast(msg, 4000);
    }
    renderPractice();
  };
}

// 評分結果：分數、診斷標籤、三個面向的建議、依分數分層的引導（不顯示語音辨識聽到的文字）
const DIMS = [['phoneme', '音素精準度', 'Phonemes'], ['stress', '重音與節奏', 'Stress & Rhythm'], ['fluency', '語速與完整度', 'Fluency']];
function diagHtml(d, color) {
  const g = Pron.guidance(d, practiceTarget === 'word', d.target);
  return `
      <div class="card stack diag">
        <div class="score-box">
          <div class="ring" style="--p:${d.total};--c:${color(d.total)}"><span>${d.total}</span></div>
          <div class="grow stack" style="gap:6px">
            <div class="guide guide-${g.level}">${esc(g.text)}</div>
            ${d.tags.length ? `<div class="row wrap" style="gap:6px">${d.tags.map(t => `<span class="dtag">${esc(t)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
        ${g.level !== 'high' ? `<button id="p-demo" class="full">${ICON.speaker}${g.level === 'low' ? '聽慢速分段示範' : '聽慢速示範'}</button>` : ''}
        <div class="dims">${DIMS.map(([k, zh, en]) => {
          const x = d.dims[k];
          return `<div class="dim">
            <div class="dim-head"><span>${zh} <span class="en">${en}</span></span>
              <span class="dim-score" style="color:${x.score === null ? 'var(--muted)' : color(x.score)}">${x.score === null ? '—' : x.score}</span></div>
            <div class="dim-bar"><i style="width:${x.score ?? 0}%;background:${x.score === null ? 'transparent' : color(x.score)}"></i></div>
            <div class="dim-advice">${esc(x.advice)}</div>
          </div>`;
        }).join('')}</div>
        <p class="source" style="margin:0">分數依 iPhone 語音辨識與錄音音量估計；音標上紅色是沒被聽清楚的音節、黃色是要注意重音的音節，僅供練習參考。</p>
      </div>`;
}

// 慢速示範：單字念兩次（更慢一次）；句子一段一段念，中間停一下讓你跟讀
async function slowDemo(text, isWord) {
  if (isWord) { await say(text, { rate: 0.6 }); await new Promise(r => setTimeout(r, 600)); await say(text, { rate: 0.45 }); return; }
  for (const part of Pron.chunks(text)) {
    await say(part, { rate: 0.6 });
    await new Promise(r => setTimeout(r, 1200));
  }
}

// ---------- 複習翻卡 ----------
let reviewMode = 'en', queue = [], current = null, flipped = false;
$('#review-mode').addEventListener('click', e => {
  const m = e.target.closest('[data-mode]')?.dataset.mode;
  if (!m) return;
  reviewMode = m;
  document.querySelectorAll('#review-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  flipped = false; renderCard();
});
function startReview() {
  const pool = words.filter(w => !w.known);
  queue = (pool.length ? pool : [...words]).sort(() => Math.random() - 0.5);
  current = queue.shift(); flipped = false; renderCard();
}
function renderCard() {
  const box = $('#review');
  if (!words.length) { box.innerHTML = '<div class="empty">先新增單字，再來複習。</div>'; return; }
  if (!current) {
    box.innerHTML = `<div class="card empty">這一輪複習完了。<br><br><button class="primary" id="again">再來一輪</button></div>`;
    $('#again').onclick = startReview;
    return;
  }
  const w = current;
  const zhFirst = reviewMode === 'zh' && w.meaning;
  const front = zhFirst
    ? `<div class="headword" style="font-family:var(--sans);font-size:26px">${esc(w.meaning)}</div>`
    : `<div class="headword">${esc(w.word)}</div>${w.phonetic ? `<div class="phon">${esc(w.phonetic)}</div>` : ''}`;
  const back = `<div class="headword">${esc(w.word)}</div>
    ${w.phonetic ? `<div class="phon">${esc(w.phonetic)}</div>` : ''}
    <div style="font-size:18px">${esc(w.meaning) || '（沒有填中文）'}</div>
    ${w.example ? `<div class="example">${highlight(w.example, w.word)}</div>` : ''}`;
  box.innerHTML = `
    <div class="muted" style="margin-bottom:8px">還剩 ${queue.length + 1} 張</div>
    <div class="card flash" id="flash">
      ${flipped ? back : front}
      ${flipped ? '' : '<div class="muted" style="margin-top:14px">點卡片看答案</div>'}
      <button class="round" data-say="${esc(w.word)}" aria-label="發音" style="margin-top:8px">${ICON.speaker}</button>
    </div>
    ${flipped ? `<div class="row" style="margin-top:12px">
      <button class="grow" id="r-no">還不熟</button>
      <button class="grow primary" id="r-yes">記住了</button></div>` : ''}`;
  $('#flash').onclick = () => { if (!flipped) { flipped = true; renderCard(); say(w.word); } };
  $('#r-no')?.addEventListener('click', () => { queue.splice(Math.min(3, queue.length), 0, w); current = queue.shift(); flipped = false; renderCard(); });
  $('#r-yes')?.addEventListener('click', async () => {
    Game.award('review', !w.known);
    if (!w.known) { w.known = true; await saveWord(w); renderList(); }
    current = queue.shift(); flipped = false; renderCard();
  });
}

// ---------- 設定與備份 ----------
$('#s-accent').value = settings.accent;
$('#s-rate').value = settings.rate;
$('#s-accent').onchange = e => { settings.accent = e.target.value; saveSettings(); };
$('#s-rate').onchange = e => { settings.rate = e.target.value; saveSettings(); };
$('#download-relations').onclick = async e => {
  const button = e.currentTarget;
  const status = $('#relations-download-status');
  button.disabled = true;
  status.textContent = '正在準備離線詞庫…';
  try {
    const manifestResponse = await fetch('dict/r/manifest.json');
    if (!manifestResponse.ok) throw new Error('無法讀取詞庫清單');
    const files = await manifestResponse.json();
    let done = 0;
    for (let i = 0; i < files.length; i += 4) {
      await Promise.all(files.slice(i, i + 4).map(async file => {
        const response = await fetch('dict/r/' + encodeURIComponent(file));
        if (!response.ok) throw new Error('下載失敗：' + file);
        await response.arrayBuffer();
        done++;
        status.textContent = `正在下載離線詞庫… ${done}/${files.length}`;
      }));
    }
    status.textContent = `完成。${files.length} 個資料檔已存入此裝置，可離線查詢。`;
    toast('同義詞與反義詞離線詞庫已下載');
  } catch (err) {
    status.textContent = '下載未完成，請確認網路後再試。';
    toast(err?.message || '離線詞庫下載失敗');
  } finally {
    button.disabled = false;
  }
};
$('#open-settings').onclick = async () => {
  $('#settings').hidden = false;
  try {
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    $('#storage-info').textContent = `目前 ${words.length} 個單字` + (est ? `，用了約 ${(est.usage / 1048576).toFixed(1)} MB` : '') + (persisted ? '，已設為不會自動清除' : '');
  } catch {}
};
$('#close-settings').onclick = () => { $('#settings').hidden = true; };
$('#settings').addEventListener('click', e => { if (e.target.id === 'settings') $('#settings').hidden = true; });

$('#export').onclick = async () => {
  const data = JSON.stringify({ app: 'english-app', version: 1, exportedAt: new Date().toISOString(), words: words.map(({ id, ...w }) => w), game: Game.exportData() }, null, 2);
  const name = `單字本備份-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([data], name, { type: 'application/json' });
  // iPhone 用分享選單存到「檔案」或傳給自己
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const have = new Set(words.map(w => w.word.toLowerCase()));
    let added = 0;
    for (const w of data.words || []) {
      if (!w.word || have.has(w.word.toLowerCase())) continue;
      await saveWord({ word: w.word, phonetic: w.phonetic || '', meaning: w.meaning || '', example: w.example || '', note: w.note || '',
        known: !!w.known, createdAt: w.createdAt || Date.now(), practice: w.practice || {} });
      have.add(w.word.toLowerCase()); added++;
    }
    words.sort((a, b) => b.createdAt - a.createdAt);
    renderList();
    const gameOk = data.game && Game.importData(data.game);
    toast(`匯入了 ${added} 個新單字` + (gameOk ? '，冒險進度也已合併' : ''));
  } catch { toast('這不是單字本的備份檔'); }
};

// ---------- 啟動 ----------
const SAMPLES = [
  { word: 'resilient', phonetic: '/rɪˈzɪliənt/', meaning: '有韌性的；能很快恢復的', pos: ['形容詞'], example: 'Children are often more resilient than adults.' },
  { word: 'commute', phonetic: '/kəˈmjuːt/', meaning: '通勤', pos: ['vi./vt.', 'noun'], example: 'My commute to work takes about forty minutes.' },
  { word: 'figure out', phonetic: '', meaning: '弄清楚；想出來', pos: ['片語'], example: "I can't figure out how this machine works." },
];

async function init() {
  words = (await db.all('words')).sort((a, b) => b.createdAt - a.createdAt);
  let seeded = false;
  try { seeded = localStorage.getItem('seeded') === '1'; } catch {}
  if (!words.length && !seeded) {
    for (const s of SAMPLES) await saveWord({ ...s, note: '範例單字，可以刪除', known: false, createdAt: Date.now(), practice: {} });
    try { localStorage.setItem('seeded', '1'); } catch {}
  }
  renderList();
  renderHome();
  navigator.storage?.persist?.().catch(() => {});
  migratePos().catch(() => {});
}

// 舊版收藏存的是中文詞性（名詞、動詞），改成 noun、vt./vi. 標示
async function migratePos() {
  const old = words.filter(w => w.pos?.some(p => p === '名詞' || p === '動詞'));
  for (const w of old) {
    const entry = await Dict.getEntry(Dict.norm(w.word)).catch(() => null);
    w.pos = entry ? Dict.posLabels(entry) : w.pos.map(p => p === '名詞' ? 'noun' : p === '動詞' ? 'vi./vt.' : p);
    await db.put('words', w);
  }
  if (old.length) renderList();
}
// init() 在 dictionary.js 最後呼叫，確保所有畫面函式都已載入

if ('serviceWorker' in navigator) {
  // 背景裝好新版後自動重新載入一次，不用關掉 App 再開
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) { reloading = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
