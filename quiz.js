'use strict';
// 主題練習與測驗：英翻中、中翻英、聽力、拼字。
// 題目用 topics.js 的主題單字格式（word、partOfSpeech、meaning…）。
// 練習：這一頁的字全部出一次，答錯的字最後再出一次，答完馬上看解答。
// 測驗：整個主題隨機 10 題，最後看分數和答錯的字。
// 每個字在練習／測驗中的答對、答錯次數（存在這台裝置的瀏覽器裡）
const QuizStats = (() => {
  let data = {};
  try { data = JSON.parse(localStorage.getItem('quizStats') || '{}'); } catch {}
  return {
    record(key, ok) {
      const s = (data[key] ||= { r: 0, w: 0 });
      ok ? s.r++ : s.w++;
      s.last = ok ? 1 : 0;
      try { localStorage.setItem('quizStats', JSON.stringify(data)); } catch {}
    },
    // 最不熟：答錯比答對多，或最近一次答錯
    weak(key) { const s = data[key]; return !!s && (s.w > s.r || s.last === 0); },
  };
})();

const Quiz = (() => {
  const TYPES = [
    { id: 'en-zh', name: '英翻中選擇題', desc: '看英文單字，選出正確的中文意思' },
    { id: 'zh-en', name: '中翻英選擇題', desc: '看中文意思，選出正確的英文單字' },
    { id: 'listen', name: '聽力測驗', desc: '聽發音，選出聽到的單字或它的意思' },
    { id: 'spell', name: '拼字測驗', desc: '看中文和首字母，用字母按鈕拼出單字' },
  ];
  const TEST_LEN = 10;
  const PRACTICE_MAX = 20;
  let st = null; // 目前的練習／測驗狀態
  let pending = null; // 選題型時的設定

  const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // 拼字題只出純字母、長度適中的單字
  const spellable = it => /^[a-z]{3,14}$/i.test(it.word);

  // ---------- 選題型 ----------
  function choose(opts) {
    pending = opts;
    const sheet = $('#quiz-sheet');
    const canSpell = opts.items.filter(spellable).length >= 1;
    const types = opts.mode === 'test'
      ? [{ id: 'mix', name: '隨機混合題型', desc: '四種題型隨機出題' }, ...TYPES]
      : TYPES;
    sheet.querySelector('.sheet').innerHTML = `
      <div class="row"><h2 class="grow">${opts.mode === 'test' ? '開始測驗' : '練習'}</h2>
        <button class="ghost" id="quiz-close" aria-label="關閉">✕</button></div>
      <p class="muted" style="margin:0">${esc(opts.title)}・${opts.mode === 'test' ? `隨機 ${Math.min(TEST_LEN, opts.items.length)} 題，最後看分數` : `${Math.min(PRACTICE_MAX, opts.items.length)} 個字，答完馬上看解答`}</p>
      <div class="quiz-types">${types.map(t => {
        const off = t.id === 'spell' && !canSpell;
        return `<button class="quiz-type" data-type="${t.id}" ${off ? 'disabled' : ''}>
          <span class="qt-name">${t.name}</span><span class="qt-desc">${off ? '這一頁沒有適合拼字的單字' : t.desc}</span></button>`;
      }).join('')}</div>`;
    sheet.hidden = false;
    sheet.querySelector('#quiz-close').onclick = () => { sheet.hidden = true; };
  }

  $('#quiz-sheet').addEventListener('click', e => {
    if (e.target.id === 'quiz-sheet') { e.currentTarget.hidden = true; return; }
    const t = e.target.closest('[data-type]')?.dataset.type;
    if (t && pending) { $('#quiz-sheet').hidden = true; start(pending, t); }
  });

  // ---------- 出題 ----------
  function start(opts, type) {
    const pool = opts.mode === 'test' ? shuffle(opts.items).slice(0, TEST_LEN) : shuffle(opts.items).slice(0, PRACTICE_MAX);
    const questions = pool.map(it => makeQuestion(it, type, opts.all)).filter(Boolean);
    if (!questions.length) { toast('這裡的單字不夠出題'); return; }
    st = { opts, type, questions, i: 0, correct: 0, wrong: [], retried: new Set(), answered: false, picked: null, spell: [] };
    show('quiz');
  }

  function makeQuestion(it, type, all) {
    let t = type;
    if (t === 'mix') t = shuffle(spellable(it) ? ['en-zh', 'zh-en', 'listen', 'spell'] : ['en-zh', 'zh-en', 'listen'])[0];
    if (t === 'spell' && !spellable(it)) t = 'en-zh';
    const q = { it, type: t };
    if (t === 'spell') {
      const rest = [...it.word.toLowerCase().slice(1)];
      q.tiles = shuffle(rest.map((ch, i) => ({ ch, id: i })));
      return q;
    }
    // 聽力題隨機選英文或中文選項
    q.optLang = t === 'en-zh' ? 'zh' : t === 'zh-en' ? 'en' : (Math.random() < 0.5 ? 'en' : 'zh');
    const field = q.optLang === 'zh' ? 'meaning' : 'word';
    const seen = new Set([it[field].toLowerCase(), it.word.toLowerCase(), it.meaning]);
    const distract = [];
    for (const x of shuffle(all)) {
      if (distract.length >= 3) break;
      const v = x[field].toLowerCase();
      if (seen.has(v) || seen.has(x.meaning) || seen.has(x.word.toLowerCase())) continue;
      seen.add(v); seen.add(x.meaning); seen.add(x.word.toLowerCase());
      distract.push(x);
    }
    if (distract.length < 3) return null;
    q.options = shuffle([it, ...distract]);
    return q;
  }

  // ---------- 畫面 ----------
  function render() {
    const box = $('#quiz-body');
    if (!st) { show('home'); return; }
    $('#title').textContent = st.opts.mode === 'test' ? '測驗' : '練習';
    if (st.i >= st.questions.length) { renderEnd(box); return; }
    const q = st.questions[st.i];
    const total = st.questions.length;
    const typeName = TYPES.find(t => t.id === q.type).name;
    box.innerHTML = `
      <div class="row">
        <button class="ghost back" id="quiz-quit">← ${esc(st.opts.title)}</button>
        <span class="grow"></span>
        <span class="muted">${st.i + 1} / ${total}</span>
      </div>
      <div class="quiz-progress" aria-hidden="true"><i style="width:${(st.i / total) * 100}%"></i></div>
      <div class="card stack quiz-card">
        <div class="eyebrow">${typeName}</div>
        ${promptHtml(q)}
        ${q.type === 'spell' ? spellHtml(q) : optionsHtml(q)}
        ${st.answered ? feedbackHtml(q) : ''}
      </div>`;
    $('#quiz-quit').onclick = quit;
    box.querySelector('[data-replay]')?.addEventListener('click', () => say(q.it.word));
    box.querySelector('[data-say-answer]')?.addEventListener('click', () => say(q.it.word));
    box.querySelector('#quiz-next')?.addEventListener('click', next);
    if (q.type === 'spell') bindSpell(q); else bindOptions(q);
    if (q.type === 'listen' && !st.answered && !st.autoplayed) { st.autoplayed = true; setTimeout(() => say(q.it.word), 250); }
  }

  function promptHtml(q) {
    const it = q.it;
    if (q.type === 'en-zh') return `<div class="quiz-prompt"><span class="quiz-word">${esc(it.word)}</span>${it.partOfSpeech ? `<span class="wr-pos">${esc(it.partOfSpeech)}</span>` : ''}</div>`;
    if (q.type === 'zh-en') return `<div class="quiz-prompt"><span class="quiz-zh">${esc(it.meaning)}</span>${it.partOfSpeech ? `<span class="wr-pos">${esc(it.partOfSpeech)}</span>` : ''}</div>`;
    if (q.type === 'listen') return `<div class="quiz-prompt"><button class="quiz-play" data-replay aria-label="再聽一次">${ICON.speaker}</button>
      <span class="muted">${q.optLang === 'en' ? '選出你聽到的單字' : '選出你聽到的單字的意思'}</span></div>`;
    // 拼字：中文提示 + 首字母與底線
    const word = it.word.toLowerCase();
    const typed = st.spell.map(t => t.ch);
    const slots = [...word].map((ch, i) => i === 0 ? `<span class="slot fixed">${ch}</span>`
      : `<span class="slot ${typed[i - 1] ? 'filled' : ''}">${typed[i - 1] || '_'}</span>`).join('');
    return `<div class="quiz-prompt"><span class="quiz-zh">${esc(it.meaning)}</span>${it.partOfSpeech ? `<span class="wr-pos">${esc(it.partOfSpeech)}</span>` : ''}</div>
      <div class="slots" aria-label="已拼：${esc(word[0] + typed.join(''))}">${slots}</div>`;
  }

  function optionsHtml(q) {
    return `<div class="quiz-options">${q.options.map((o, k) => {
      let cls = '';
      if (st.answered) cls = o === q.it ? 'right' : k === st.picked ? 'wrong' : 'dim';
      const label = q.optLang === 'zh' ? o.meaning : o.word;
      return `<button class="quiz-opt ${cls} ${q.optLang === 'en' ? 'en' : ''}" data-opt="${k}" ${st.answered ? 'disabled' : ''}>${esc(label)}</button>`;
    }).join('')}</div>`;
  }

  function spellHtml(q) {
    const used = new Set(st.spell.map(t => t.id));
    return `<div class="tiles">${q.tiles.map(t => `<button class="tile" data-tile="${t.id}" ${used.has(t.id) || st.answered ? 'disabled' : ''}>${t.ch}</button>`).join('')}</div>
      ${st.answered ? '' : `<div class="row"><button class="grow" id="spell-del" ${st.spell.length ? '' : 'disabled'}>⌫ 刪除</button>
        <button class="grow primary" id="spell-ok" ${st.spell.length === q.tiles.length ? '' : 'disabled'}>確定</button></div>`}`;
  }

  function feedbackHtml(q) {
    const ok = st.lastOk;
    return `<div class="quiz-feedback ${ok ? 'ok' : 'bad'}">
        <div class="qf-title">${ok ? '答對了！' : '答錯了'}</div>
        <div class="qf-answer"><b>${esc(q.it.word)}</b>${q.it.partOfSpeech ? ` <span class="wr-pos">${esc(q.it.partOfSpeech)}</span>` : ''} ${esc(q.it.meaning)}
          <button class="icon-btn" data-say-answer aria-label="播放發音">${ICON.speaker}</button></div>
      </div>
      <button class="primary full" id="quiz-next">${st.i + 1 >= st.questions.length ? '看結果' : '下一題'}</button>`;
  }

  function bindOptions(q) {
    $('#quiz-body').querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
      if (st.answered) return;
      st.picked = Number(b.dataset.opt);
      answer(q, q.options[st.picked] === q.it);
    });
  }

  function bindSpell(q) {
    const box = $('#quiz-body');
    box.querySelectorAll('[data-tile]').forEach(b => b.onclick = () => {
      const t = q.tiles.find(x => x.id === Number(b.dataset.tile));
      if (st.answered || st.spell.includes(t)) return;
      st.spell.push(t);
      render();
    });
    box.querySelector('#spell-del')?.addEventListener('click', () => { st.spell.pop(); render(); });
    box.querySelector('#spell-ok')?.addEventListener('click', () => {
      answer(q, q.it.word.toLowerCase().slice(1) === st.spell.map(t => t.ch).join(''));
    });
  }

  function answer(q, ok) {
    st.answered = true;
    QuizStats.record(q.it.key, ok);
    Game.award('quiz', ok);
    st.lastOk = ok;
    if (ok) st.correct++;
    else {
      if (!st.wrong.includes(q.it)) st.wrong.push(q.it);
      // 練習模式：答錯的字最後再出一次
      if (st.opts.mode === 'practice' && !st.retried.has(q.it.id)) {
        st.retried.add(q.it.id);
        const again = makeQuestion(q.it, q.type, st.opts.all);
        if (again) st.questions.push(again);
      }
    }
    if (st.opts.mode === 'practice' || q.type !== 'listen') say(q.it.word);
    render();
  }

  function next() {
    st.i++;
    st.answered = false; st.picked = null; st.spell = []; st.autoplayed = false;
    render();
    window.scrollTo(0, 0);
  }

  function renderEnd(box) {
    const total = st.questions.length;
    const pct = Math.round((st.correct / total) * 100);
    const msg = pct >= 90 ? '太厲害了！這些字你都掌握了。' : pct >= 70 ? '不錯！再複習一下答錯的字。' : '多練習幾次，答錯的字可以加入收藏慢慢複習。';
    box.innerHTML = `
      <button class="ghost back" id="quiz-quit">← ${esc(st.opts.title)}</button>
      <div class="card stack" style="text-align:center">
        <div class="eyebrow">${st.opts.mode === 'test' ? '測驗結果' : '練習結束'}</div>
        <div class="quiz-score">${st.correct} / ${total}</div>
        <div class="muted">答對率 ${pct}%</div>
        <p style="margin:4px 0 0">${msg}</p>
      </div>
      ${st.wrong.length ? `<section class="card stack">
        <h3>答錯的字</h3>
        <div class="word-rows">${st.wrong.map(it => `<div class="word-row"><button class="wr-main" data-word="${esc(it.word)}">
          <span class="wr-top"><span class="wr-word">${esc(it.word)}</span>${it.partOfSpeech ? `<span class="wr-pos">${esc(it.partOfSpeech)}</span>` : ''}</span>
          <span class="wr-gloss">${esc(it.meaning)}</span></button>
          <button class="icon-btn" data-say-word="${esc(it.word)}" aria-label="播放 ${esc(it.word)} 的發音">${ICON.speaker}</button></div>`).join('')}</div>
        <button id="quiz-save-wrong">把答錯的字加入收藏</button>
      </section>` : ''}
      <div class="row">
        <button class="grow" id="quiz-again">再一次</button>
        <button class="grow primary" id="quiz-done">回到主題</button>
      </div>`;
    $('#quiz-quit').onclick = quit;
    $('#quiz-done').onclick = quit;
    $('#quiz-again').onclick = () => start(st.opts, st.type);
    box.querySelectorAll('[data-say-word]').forEach(b => b.onclick = () => say(b.dataset.sayWord));
    $('#quiz-save-wrong')?.addEventListener('click', async e => {
      e.target.disabled = true;
      let n = 0;
      for (const it of st.wrong) if (!findSaved(it.key)) { await toggleItemSaved(it); n++; }
      toast(n ? `已把 ${n} 個字加入收藏` : '這些字都已經在收藏裡了');
    });
  }

  function quit() {
    st = null;
    show('topic');
  }

  return { choose, render };
})();
