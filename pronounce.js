'use strict';
// 發音診斷：把「語音辨識結果」和「錄音音量變化」拆成三個面向的建議。
// iPhone 的語音辨識只回傳文字，不提供音素或重音分析，所以這裡的診斷是估計：
// - 音素：目標字和辨識結果逐字母對齊，找出沒被聽懂的音節，再依該音節的音標給練習提示
// - 重音：錄音時同步量音量，估計最響、最長的是哪個音節，和音標的重音符號比較
// - 語速與完整度：說話長度、停頓，以及字尾字母有沒有被聽到
const Pron = (() => {
  // ---------- 音標切音節 ----------
  // 同時支援 ECDICT（ri'ziliәnt、.infә'meiʃәn）和 IPA（/ɹɪˈzɪli.ənt/）兩種寫法
  const VOWELS = new Set([...'aeiouæɑɒɔəɚɛɜɝɪʊʌәɐεʏyɵ']);
  const LENGTH = new Set(['ː', ':']);
  const DIPH = new Set(['ai', 'au', 'ei', 'oi', 'ou', 'ɔi', 'әu', 'əu', 'aɪ', 'aʊ', 'eɪ', 'oʊ', 'ɔɪ', 'əʊ', 'ɪə', 'eə', 'ʊə', 'εә', 'uә', 'uə', 'eә', 'iә', 'iə']);
  const ONSETS = /^(p|b|t|d|k|g|f|θ|ʃ)(l|r|ɹ|w|j)$|^s(p|t|k|m|n|l|w)$/;

  function ipaSyllables(raw) {
    const s = (raw || '').trim().replace(/^[\/\[]|[\/\]]$/g, '');
    if (!s) return null;
    const ipaStyle = s.includes('ˈ') || s.includes('ˌ');
    const isMark = c => c === 'ˈ' || c === 'ˌ' || c === "'" || (ipaStyle ? c === '.' : c === '.' || c === ',');
    const chars = [...s];
    // 切成單位：[{text, type: 'v'|'c'|'m', start}]
    const units = [];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (isMark(c)) { units.push({ text: c, type: 'm', start: i }); continue; }
      if (LENGTH.has(c) || /[̀-ͯ]/.test(c)) {
        if (units.length) units[units.length - 1].text += c;
        if (c === '̩' && units.length) units[units.length - 1].type = 'v'; // 成音節子音 n̩ l̩
        continue;
      }
      if ((c === 't' || c === 'd') && (chars[i + 1] === 'ʃ' || chars[i + 1] === 'ʒ')) {
        units.push({ text: c + chars[i + 1], type: 'c', start: i }); i++; continue;
      }
      if (VOWELS.has(c)) {
        const prev = units[units.length - 1];
        const pair = prev?.type === 'v' && !LENGTH.has([...prev.text].pop()) ? prev.text + c : '';
        // iә：後面是字尾或 r 才算雙母音（here、period 的 pɪə），否則分開（resilient 的 li-ənt）
        const rest = chars.slice(i + 1).join('');
        const iaOk = !/^[iɪ][әə]$/.test(pair) || rest === '' || /^[rɹ]/.test(rest);
        if (pair && DIPH.has(pair) && iaOk && [...prev.text].length === 1) { prev.text += c; continue; }
        units.push({ text: c, type: 'v', start: i });
        continue;
      }
      units.push({ text: c, type: 'c', start: i });
    }
    // 字尾的成音節 l、n（bottle 'bɒtl、button）
    const last = units[units.length - 1], prev = units[units.length - 2];
    if (last && prev && last.type === 'c' && /^[ln]$/.test(last.text) && prev.type === 'c' && !/^[rɹl]$/.test(prev.text) &&
        units.some(u => u.type === 'v')) last.type = 'v';
    const nuclei = units.map((u, i) => u.type === 'v' ? i : -1).filter(i => i >= 0);
    if (!nuclei.length) return null;
    // 每個音節的開頭（單位索引）
    const starts = [0];
    for (let k = 1; k < nuclei.length; k++) {
      const a = nuclei[k - 1], b = nuclei[k];
      const between = units.slice(a + 1, b);
      const mark = between.findIndex(u => u.type === 'm');
      if (mark >= 0) { starts.push(a + 1 + mark); continue; }
      const cons = between.length;
      let cut = b;
      if (cons === 1) cut = b - 1;
      else if (cons >= 2) {
        const two = units[b - 2].text + units[b - 1].text;
        cut = ONSETS.test(two.replace(/[ː:]/g, '')) ? b - 2 : b - 1;
      }
      starts.push(cut);
    }
    const syl = starts.map((st, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : units.length;
      const us = units.slice(st, end);
      return {
        text: us.map(u => u.text).join(''),
        primary: us[0]?.type === 'm' && (us[0].text === 'ˈ' || us[0].text === "'"),
        phones: us.filter(u => u.type !== 'm').map(u => u.text.replace(/[ː:]/g, '')),
      };
    });
    // 開頭的符號（例如 ' 在第一個音節前）已經包含在第一個音節裡
    const stress = syl.length === 1 ? 0 : syl.findIndex(x => x.primary);
    return { syl, stress };
  }

  // ---------- 拼字切音節（給「re - SI - lient」這種拆解用） ----------
  const DIGRAPH = ['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'ng', 'qu'];
  const BLEND = /^(bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|sc|sk|sl|sm|sn|sp|st|sw|tr|tw|wr)$/;

  function spellSyllables(word) {
    const w = word.toLowerCase();
    if (!/^[a-z]+$/.test(w)) return [word];
    const isV = (ch, i) => 'aeiou'.includes(ch) || (ch === 'y' && i > 0);
    const groups = [];
    for (let i = 0; i < w.length;) {
      if (isV(w[i], i)) { let j = i; while (j < w.length && isV(w[j], j)) j++; groups.push([i, j]); i = j; } else i++;
    }
    // 字尾不發音的 e（make、decide），但 -le 要算一個音節（table）
    const lastG = groups[groups.length - 1];
    if (groups.length > 1 && lastG[0] === w.length - 1 && w.endsWith('e') && !/[^aeiou]le$/.test(w)) groups.pop();
    if (groups.length < 2) return [word];
    const cuts = [];
    for (let k = 1; k < groups.length; k++) {
      const a = groups[k - 1][1], b = groups[k][0];
      const cons = w.slice(a, b);
      const unitsC = [];
      for (let i = 0; i < cons.length;) {
        const d = cons.slice(i, i + 2);
        if (DIGRAPH.includes(d)) { unitsC.push(d); i += 2; } else { unitsC.push(cons[i]); i++; }
      }
      // 放到下一個音節的子音數（以單位計）：re-si、com-for、ta-ble、pock-et
      const lastTwo = unitsC.slice(-2).join('');
      let take;
      if (k === groups.length - 1 && /[^aeiou]le$/.test(w) && unitsC.length >= 2 && unitsC[unitsC.length - 1] === 'l') take = 2; // bot-tle、ta-ble
      else if (unitsC.length === 1) take = ['ck', 'ng', 'x'].includes(unitsC[0]) ? 0 : 1;
      else if (unitsC.length === 0) take = 0;
      else if (BLEND.test(lastTwo) && (unitsC.length >= 3 || /[lr]$/.test(lastTwo))) take = 2;
      else take = 1;
      cuts.push(b - unitsC.slice(unitsC.length - take).join('').length);
    }
    const out = [];
    let st = 0;
    for (const c of cuts) { out.push(word.slice(st, c)); st = c; }
    out.push(word.slice(st));
    return out;
  }

  // 兩邊音節數不同時，依位置比例對應
  const mapIndex = (i, from, to) => from <= 1 || to <= 1 ? 0 : Math.round(i * (to - 1) / (from - 1));

  // ---------- 字母對齊：哪些目標字母有被聽到 ----------
  function letterHits(target, heard) {
    const a = [...target.toLowerCase()].filter(c => /[a-z]/.test(c));
    const b = [...heard.toLowerCase()].filter(c => /[a-z]/.test(c));
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    const hit = new Array(m).fill(false);
    for (let i = m, j = n; i > 0;) {
      if (j > 0 && a[i - 1] === b[j - 1] && dp[i][j] === dp[i - 1][j - 1]) { hit[i - 1] = true; i--; j--; }
      else if (j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { i--; j--; }
      else if (dp[i][j] === dp[i - 1][j] + 1) i--;
      else j--;
    }
    return hit;
  }

  // ---------- 錄音音量（和語音辨識同時進行） ----------
  // 有些裝置同時開麥克風會讓語音辨識失敗，失敗過一次就記住，之後不再量音量
  let meterBlocked = false;
  try { meterBlocked = localStorage.getItem('pronMeterOff') === '1'; } catch {}

  async function startMeter() {
    if (meterBlocked || !navigator.mediaDevices?.getUserMedia) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const ctx = new AC();
      await ctx.resume?.();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const frames = [];
      // 同一條麥克風也拿來錄音，評分完可以和慢速示範對照（不另外開麥克風，避免和語音辨識搶）
      let mr = null; const chunks = [];
      let recorded = Promise.resolve(null);
      if (window.MediaRecorder) {
        try {
          const type = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
          mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
          mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
          recorded = new Promise(res => {
            mr.onstop = () => res(chunks.length ? new Blob(chunks, { type: mr.mimeType || type || 'audio/mp4' }) : null);
            mr.onerror = () => res(null);
          });
          mr.start();
        } catch { mr = null; recorded = Promise.resolve(null); }
      }
      const t0 = performance.now();
      const timer = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        frames.push({ t: (performance.now() - t0) / 1000, v: Math.sqrt(sum / buf.length) });
      }, 15);
      return {
        recorded,
        stop() {
          clearInterval(timer);
          // 先停錄音再關麥克風，錄音檔才會完整
          if (mr?.state === 'recording') { mr.stop(); recorded.finally(() => stream.getTracks().forEach(t => t.stop())); }
          else stream.getTracks().forEach(t => t.stop());
          ctx.close?.();
          return frames;
        },
      };
    } catch {
      return null;
    }
  }

  function blockMeter() {
    meterBlocked = true;
    try { localStorage.setItem('pronMeterOff', '1'); } catch {}
  }

  // 從音量曲線找出說話區段、各音節（音量峰）的強度和停頓
  function analyzeEnvelope(frames, nSyl) {
    if (!frames || frames.length < 10) return null;
    const sm = frames.map((f, i) => {
      const w = frames.slice(Math.max(0, i - 3), i + 4);
      return { t: f.t, v: w.reduce((s, x) => s + x.v, 0) / w.length };
    });
    const sorted = sm.map(f => f.v).sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.2)];
    const peak = sorted[sorted.length - 1];
    if (peak < floor * 3 || peak < 0.01) return null; // 幾乎沒聲音
    const th = Math.max(floor * 2.5, peak * 0.12);
    const on = sm.map(f => f.v > th);
    const first = on.indexOf(true), last = on.lastIndexOf(true);
    if (first < 0 || last <= first) return null;
    const region = sm.slice(first, last + 1);
    const duration = region[region.length - 1].t - region[0].t;
    // 句中停頓：連續 0.45 秒以上低於門檻
    let pauses = 0, quietSince = null;
    for (const f of region) {
      if (f.v <= th) { quietSince ??= f.t; }
      else { if (quietSince !== null && f.t - quietSince >= 0.45) pauses++; quietSince = null; }
    }
    // 音節強度：有 n 個明顯音量峰就用峰值；不然把說話區段平均切成 n 段
    let energies = null;
    if (nSyl >= 2) {
      const peaks = [];
      for (let i = 1; i < region.length - 1; i++) {
        const f = region[i];
        if (f.v > th && f.v >= region[i - 1].v && f.v > region[i + 1].v) {
          const lastP = peaks[peaks.length - 1];
          if (lastP && f.t - lastP.t < 0.09) { if (f.v > lastP.v) peaks[peaks.length - 1] = f; }
          else peaks.push(f);
        }
      }
      if (peaks.length >= nSyl) {
        energies = [...peaks].sort((a, b) => b.v - a.v).slice(0, nSyl).sort((a, b) => a.t - b.t).map(p => p.v);
      } else {
        const seg = region.length / nSyl;
        energies = Array.from({ length: nSyl }, (_, k) => {
          const part = region.slice(Math.floor(k * seg), Math.max(Math.floor((k + 1) * seg), Math.floor(k * seg) + 1));
          return part.reduce((s, f) => s + f.v, 0) / part.length;
        });
      }
    }
    return { duration, pauses, energies };
  }

  // ---------- 音素提示（針對台灣學習者常見問題） ----------
  const PHONE_TIPS = [
    [/^θ$/, '/θ/', '舌尖輕放在上下牙齒之間吹氣，不要念成 /s/'],
    [/^ð$/, '/ð/', '舌尖放在齒間並震動聲帶，不要念成 /d/ 或 /z/'],
    [/^v$/, '/v/', '上排牙齒輕碰下唇、震動聲帶，不要念成 /b/ 或 /w/'],
    [/^z$/, '/z/', '和 /s/ 同樣位置，但要震動聲帶（摸喉嚨會震），不要念成 /s/'],
    [/^ʒ$/, '/ʒ/', '像 /ʃ/ 但要震動聲帶，例如 decision 的 si'],
    [/^(r|ɹ)$/, '/r/', '舌尖往後捲、不要碰到上顎，嘴唇稍微圓起來'],
    [/^(l|ɫ)$/, '/l/', '舌尖要頂住上排牙齒後方；在字尾時舌尖也要頂到，不要念成「歐」'],
    [/^ŋ$/, '/ŋ/', '舌根抵住軟顎、從鼻子出聲，不要念成 /n/'],
    [/^æ$/, '/æ/', '嘴巴張大、嘴角往兩側拉，介於「ㄝ」和「ㄚ」之間'],
    [/^(ɪ|i)$/, '/ɪ/', '短而放鬆，不要拉長成 /iː/'],
    [/^ʃ$/, '/ʃ/', '嘴唇稍微噘起、舌面抬高，不要念成「西」'],
    [/^(tʃ|dʒ)$/, '/tʃ/、/dʒ/', '嘴唇噘起、舌尖先頂上齒齦再放開'],
    [/^(ɜ|ɝ|ɚ|ә|ə)$/, '/ə/', '弱讀的音要輕而短，不要每個母音都念得一樣重'],
  ];
  const STOP_TIP = c => `字尾的 /${c}/ 要輕輕收乾淨，不要吞掉，也不要多加「ㄜ」`;

  function tipsFor(phones) {
    for (const p of phones) {
      const norm = p.replace(/[ː:̩]/g, '');
      const hit = PHONE_TIPS.find(([re]) => re.test(norm));
      if (hit) return { sym: hit[1], tip: hit[2] };
    }
    return null;
  }

  // ---------- 主診斷 ----------
  // target：念的文字；best：{score, heard}；frames：音量紀錄（可能是 null）；phonetic：音標
  function diagnose({ target, isWord, best, frames, phonetic, marks }) {
    const tags = [];
    const highlight = {}; // 音標音節索引 → 'bad' | 'warn'
    const dims = {};
    const accScore = best.score;
    const heard = best.heard || '';

    // 音節資料
    const ipa = isWord ? ipaSyllables(phonetic) : null;
    const spell = isWord ? spellSyllables(target) : null;
    const nSyl = ipa ? ipa.syl.length : spell ? spell.length : 0;
    const stressIpa = ipa && ipa.stress >= 0 ? ipa.stress : -1;
    const stressSpell = stressIpa >= 0 ? mapIndex(stressIpa, ipa.syl.length, spell.length) : -1;

    // 1. 音素精準度
    let phoneAdvice = '';
    let endingMissed = false;
    if (!heard) {
      phoneAdvice = '沒有聽清楚，請靠近麥克風、用正常音量再念一次。';
      tags.push('沒聽清楚');
    } else if (isWord) {
      const hits = letterHits(target, heard);
      const letters = [...target].filter(c => /[a-z]/i.test(c)).length;
      // 每個拼字音節的漏聽比例
      let pos = 0;
      const bad = spell.map(part => {
        const n = [...part].filter(c => /[a-z]/i.test(c)).length;
        const miss = hits.slice(pos, pos + n).filter(h => !h).length;
        pos += n;
        return n ? miss / n : 0;
      });
      const flagged = [];
      bad.forEach((r, k) => {
        if (r < 0.34 || accScore >= 95) return;
        const ii = ipa ? mapIndex(k, spell.length, ipa.syl.length) : k;
        highlight[ii] = r >= 0.6 ? 'bad' : 'warn';
        flagged.push({ k, ii, r });
      });
      // 字尾子音沒被聽到
      const tail = hits.slice(-2);
      if (letters > 2 && /[^aeiouy]$/i.test(target) && tail.some(h => !h) && hits.slice(0, -2).filter(Boolean).length >= (letters - 2) * 0.6) {
        endingMissed = true;
      }
      if (accScore >= 95 || !flagged.length) {
        phoneAdvice = accScore >= 95 ? '每個音都清楚，辨識完全正確。' : '大致清楚，個別音再念飽滿一點。';
      } else {
        const worst = flagged.sort((a, b) => b.r - a.r)[0];
        const sylIpa = ipa?.syl[worst.ii];
        const t = sylIpa ? tipsFor(sylIpa.phones) : null;
        const where = `第 ${worst.k + 1} 個音節「${spell[worst.k]}」${sylIpa ? `/${sylIpa.text.replace(/^[ˈˌ'.,]/, '')}/ ` : ''}`;
        phoneAdvice = t ? `${where}聽起來不清楚：${t.sym} ${t.tip}。` : `${where}聽起來不清楚，放慢速度把這個音節念完整。`;
        tags.push(t ? `音素不準 ${t.sym}` : '音節不清楚');
      }
    } else {
      const missed = tokens(target).filter((_, i) => !(marks[i] >= 0.6));
      if (!missed.length) phoneAdvice = '每個字都聽得懂。';
      else {
        phoneAdvice = `這幾個字不夠清楚：${missed.slice(0, 4).join('、')}${missed.length > 4 ? ' 等' : ''}（上面紅色的字），可以先單獨練習這些字。`;
        tags.push(missed.length >= Math.max(2, tokens(target).length * 0.3) ? '漏字' : '字詞不清楚');
      }
    }
    dims.phoneme = { score: accScore, advice: phoneAdvice };

    // 2. 重音與節奏（需要音量資料）
    const env = analyzeEnvelope(frames, isWord ? nSyl : 0);
    if (isWord) {
      if (nSyl < 2 || stressIpa < 0) {
        dims.stress = { score: null, advice: nSyl < 2 ? '單音節字，沒有重音位置的問題。' : '這個字的音標沒有標重音，無法判斷。' };
      } else if (!env?.energies || !heard) {
        dims.stress = { score: null, advice: `重音在第 ${stressSpell + 1} 個音節「${spell[stressSpell].toUpperCase()}」。這次沒有取得足夠的音量資料，無法判斷。` };
      } else {
        const e = env.energies;
        const est = e.indexOf(Math.max(...e));
        const ok = est === stressIpa;
        const word = spell.map((p, k) => k === stressSpell ? p.toUpperCase() : p).join('-');
        if (ok) {
          dims.stress = { score: 100, advice: `重音位置正確（${word}）。` };
        } else {
          const heardSpell = mapIndex(est, ipa.syl.length, spell.length);
          highlight[stressIpa] ??= 'warn';
          const st = ipa.syl[stressIpa].text.replace(/^[ˈˌ'.,]/, '');
          dims.stress = { score: 60, advice: `重音應該在第 ${stressSpell + 1} 個音節「${spell[stressSpell]}」/ˈ${st}/，你的重音聽起來落在「${spell[heardSpell]}」。把 ${word} 的大寫部分念得比較重、比較長。` };
          tags.push('重音偏離');
        }
      }
    } else if (env) {
      const words = tokens(target).length;
      if (env.pauses >= 2 && env.pauses >= words / 4) {
        dims.stress = { score: 65, advice: `中間停頓了 ${env.pauses} 次，試著把意群連起來念：${chunks(target).join(' / ')}。` };
        tags.push('停頓太多');
      } else {
        dims.stress = { score: 100, advice: '節奏自然。名詞、動詞念重一點，the、a、of 這類小字輕輕帶過會更像母語者。' };
      }
    } else {
      dims.stress = { score: null, advice: '這次沒有取得音量資料，無法判斷節奏。' };
    }

    // 3. 語速與完整度
    let flu = 100;
    const fluNotes = [];
    if (env && heard) {
      const syl = isWord ? Math.max(nSyl, 1) : countSyllables(target);
      const expected = isWord ? 0.25 * syl + 0.2 : syl / 4.2;
      const ratio = env.duration / expected;
      if (ratio < 0.55) { flu -= 25; fluNotes.push('念得太快，母音沒有拉開'); tags.push('語速太快'); }
      else if (ratio > (isWord ? 2.8 : 2.2)) { flu -= 20; fluNotes.push('念得偏慢，試著一口氣念完'); tags.push('語速太慢'); }
    }
    if (endingMissed) {
      flu -= 20;
      const lastSyl = ipa?.syl[ipa.syl.length - 1];
      const c = lastSyl?.phones.filter(p => !VOWELS.has([...p][0])).pop();
      fluNotes.push(c ? STOP_TIP(c) : '字尾的子音要念出來，不要吞掉');
      tags.push('尾音不清晰');
    }
    if (!isWord) {
      const missed = tokens(target).filter((_, i) => !(marks[i] >= 0.6)).length;
      if (missed) { flu -= Math.min(40, missed * 10); fluNotes.push(`有 ${missed} 個字沒有被聽到，注意每個字都要念出來`); }
    }
    if (!heard) flu = 0;
    dims.fluency = {
      score: env || !isWord || endingMissed ? Math.max(0, flu) : (heard ? null : 0),
      advice: !heard ? '沒有聽到完整的句子。' : fluNotes.length ? fluNotes.join('；') + '。' : env ? '速度適中、念得完整。' : '念得完整。（這次沒有取得音量資料，無法判斷語速）',
    };

    // 總分：音素 60%、重音 20%、語速 20%（沒有資料的面向不計）
    const parts = [[dims.phoneme.score, 0.6], [dims.stress.score, 0.2], [dims.fluency.score, 0.2]].filter(([s]) => s !== null && s !== undefined);
    const wsum = parts.reduce((s, [, w]) => s + w, 0);
    let total = heard ? Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wsum) : 0;
    if (accScore < 40) total = Math.min(total, accScore + 10); // 字都沒被聽懂時，其他面向不能把分數拉太高

    return { target, total, tags: [...new Set(tags)], dims, highlight, ipa, spell, stressSpell };
  }

  // 依分數給分層引導
  function guidance(d, isWord, target) {
    if (d.total >= 80) {
      const tip = d.tags.length ? ` 小提醒：${d.tags.includes('重音偏離') ? d.dims.stress.advice : d.dims.fluency.score < 100 ? d.dims.fluency.advice : d.dims.phoneme.advice}` : '';
      return { level: 'high', text: '發音非常標準！繼續保持。' + tip };
    }
    if (d.total >= 60) {
      const first = d.tags.includes('重音偏離') ? d.dims.stress.advice
        : d.dims.phoneme.score < 90 ? d.dims.phoneme.advice
        : d.dims.fluency.advice;
      return { level: 'mid', text: `${first} 試著跟讀一次慢速示範。` };
    }
    const parts = isWord
      ? d.spell.map((p, k) => k === d.stressSpell ? p.toUpperCase() : p).join(' - ')
      : chunks(target).join(' / ');
    return { level: 'low', text: `別擔心，我們拆開來練習：${parts}，點下面的按鈕聽慢速示範，跟著一段一段念。`, parts };
  }

  // 句子切成 3～4 個字一段的意群
  function chunks(text) {
    const out = [];
    for (const piece of text.split(/(?<=[,;:.!?])\s+/)) {
      const ws = piece.trim().split(/\s+/).filter(Boolean);
      const n = Math.ceil(ws.length / 4);
      const size = Math.ceil(ws.length / Math.max(n, 1));
      for (let i = 0; i < ws.length; i += size) out.push(ws.slice(i, i + size).join(' '));
    }
    return out.filter(Boolean);
  }

  function countSyllables(text) {
    return tokens(text).reduce((s, w) => s + spellSyllables(w).length, 0);
  }

  // 把音標依音節包成 span，診斷出問題的音節加上紅／黃色
  function phoneticHtml(phonetic, d) {
    const ipa = d?.ipa;
    if (!ipa) return esc(phonetic);
    const open = /^\s*\//.test(phonetic) ? '/' : '', close = /\/\s*$/.test(phonetic) ? '/' : '';
    return open + ipa.syl.map((s, i) => {
      const h = d.highlight[i];
      return `<span class="ps${h ? ' ps-' + h : ''}">${esc(s.text)}</span>`;
    }).join('') + close;
  }

  return { ipaSyllables, spellSyllables, startMeter, blockMeter, diagnose, guidance, phoneticHtml, chunks };
})();
