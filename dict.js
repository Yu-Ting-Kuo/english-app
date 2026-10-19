'use strict';
// 詞典資料層：本機 ECDICT 分片（已轉台灣繁體，見 tools/build_dict.py）
// + 線上 Free Dictionary API（Wiktionary 的音標、真人發音、英英解釋）。
// 這個檔案只處理資料，不碰畫面。

const Dict = (() => {
  const shards = new Map();
  const indexes = new Map();
  let resemble = null;
  let zhIndex = null;
  let zhIndexLoading = null;

  const norm = q => String(q ?? '').normalize('NFKC').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const shardOf = k => {
    const s = k.replace(/[^a-z]/g, '').slice(0, 2);
    return s ? (s + '_').slice(0, 2) : '__';
  };
  const letterOf = k => (/[a-z]/.test(k[0]) ? k[0] : '_');

  async function fetchJSON(url) {
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw Object.assign(new Error('網路連線失敗'), { code: 'network' });
    }
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error('伺服器回應錯誤 ' + res.status), { code: 'http' });
    return res.json();
  }

  // 同一個檔案只抓一次；失敗的話下次再重試
  function cached(map, key, url, empty) {
    if (!map.has(key)) {
      map.set(key, fetchJSON(url).then(d => d ?? empty).catch(err => { map.delete(key); throw err; }));
    }
    return map.get(key);
  }
  const loadShard = s => cached(shards, s, `dict/w/${s}.json`, { e: {}, f: {} });
  // 詞義與例句（tools/build_senses.py 產生），跟詞條一樣依前兩個字母分檔，點進條目才載入
  const senseShards = new Map();
  async function senses(key) {
    const data = await cached(senseShards, shardOf(key), `dict/s/${shardOf(key)}.json`, {});
    return data[key] || null;
  }
  const loadIndex = l => cached(indexes, l, `dict/i/${l}.json`, []);

  const zhTwMeanings = {
    razor: [{ p: 'n', l: 'noun', m: '刮鬍刀' }, { p: 'v', l: 'vt.', m: '剃' }],
    shaver: [{ p: 'n', l: 'noun', m: '電動刮鬍刀' }],
    'power bank': [{ p: 'n', l: 'noun', m: '行動電源' }],
  };

  async function getEntry(key) {
    if (!key) return null;
    const entry = (await loadShard(shardOf(key))).e[key] || null;
    const meanings = zhTwMeanings[key];
    if (meanings) return { ...(entry || { w: key }), m: meanings };
    return entry;
  }

  const FORM_LABELS = { p: '過去式', d: '過去分詞', i: '現在分詞', 3: '第三人稱單數', s: '複數', r: '比較級', t: '最高級' };
  const labelsOfType = t => [...new Set([...(t || '')].map(c => FORM_LABELS[c]).filter(Boolean))];

  // 查詢：回傳 { key, entry, formOf: [{key, labels}], suggestions }
  // formOf 是「這個字是哪個原形的變化」，例如 went → go（過去式）
  async function lookup(q) {
    let key = norm(q);
    if (!key) return null;
    let entry = await getEntry(key);
    if (!entry && key.includes('-')) {
      const alt = key.replace(/-/g, ' ');
      const e2 = await getEntry(alt);
      if (e2) { key = alt; entry = e2; }
    }
    const shard = await loadShard(shardOf(key));
    const formOf = [];
    for (const [lemma, labels] of Object.entries(shard.f[key] || {})) {
      if (await getEntry(lemma)) formOf.push({ key: lemma, labels });
    }
    const zero = entry?.x?.['0'] && norm(entry.x['0']);
    if (zero && zero !== key && !formOf.some(f => f.key === zero) && await getEntry(zero)) {
      formOf.push({ key: zero, labels: labelsOfType(entry.x['1']) });
    }
    if (entry) return { key, entry, formOf, query: q };
    if (formOf.length) {
      // 詞典裡沒有這個變化形本身的詞條，直接顯示原形
      return { key: formOf[0].key, entry: await getEntry(formOf[0].key), formOf, redirected: key, query: q };
    }
    return { key, entry: null, formOf: [], suggestions: await fuzzy(key), query: q };
  }

  async function suggest(prefix, n = 8) {
    const p = norm(prefix);
    if (!p) return [];
    const list = await loadIndex(letterOf(p));
    const out = [];
    for (const k of list) {
      if (k.startsWith(p)) { out.push(k); if (out.length >= n) break; }
    }
    return out;
  }

  const isChinese = value => /[\u3400-\u9fff\uf900-\ufaff]/.test(String(value ?? ''));
  function normalizeChinese(value) {
    return String(value ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
      .replace(/(?:的)?(?:英文怎麼說|翻成英文|英文|英語|翻譯|是什麼|怎麼說)$/u, '')
      .replace(/[^\u3400-\u9fff\uf900-\ufaff]/g, '');
  }

  async function loadChineseIndex() {
    if (!zhIndexLoading) {
      zhIndexLoading = fetchJSON('dict/zh-index.json?v=3').then(data => {
        if (!data?.words || !data?.grams) throw Object.assign(new Error('中文反查索引格式錯誤'), { code: 'index' });
        zhIndex = data;
        return data;
      }).catch(err => { zhIndexLoading = null; throw err; });
    }
    return zhIndexLoading;
  }

  async function searchChinese(query, n = 12) {
    const q = normalizeChinese(query);
    if ([...q].length < 2) return [];
    const index = await loadChineseIndex();
    const grams = [...new Set(Array.from({ length: q.length - 1 }, (_, i) => q.slice(i, i + 2)))];
    const lists = grams.map(g => index.grams[g]);
    if (lists.some(list => !list?.length)) return [];
    lists.sort((a, b) => a.length - b.length);
    let ids = lists[0];
    for (const list of lists.slice(1)) {
      const present = new Set(list);
      ids = ids.filter(id => present.has(id));
      if (!ids.length) return [];
    }
    const rows = ids.map(id => {
      const [word, meaning, rank, pos, simplified] = index.words[id];
      const trad = (meaning.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || []).join('');
      const simple = simplified ? (simplified.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || []).join('') : trad;
      const exact = trad.includes(q) || simple.includes(q);
      const precise = [meaning, simplified].some(text =>
        (text.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) || []).includes(q));
      const posKinds = pos ? pos.split(/[／/,、]+/).filter(Boolean).length : 0;
      return { word, meaning, pos, rank, exact, precise, posKinds };
    });
    rows.sort((a, b) => Number(b.precise) - Number(a.precise) || Number(b.exact) - Number(a.exact) || a.posKinds - b.posKinds || (a.rank || Infinity) - (b.rank || Infinity) || a.word.localeCompare(b.word));
    return rows.slice(0, n);
  }

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let best = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        best = Math.min(best, cur[j]);
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // 拼錯時找相近的字：同字首、編輯距離 1～2，常見的字排前面
  async function fuzzy(key, n = 6) {
    const max = key.length <= 4 ? 1 : 2;
    const pools = [letterOf(key)];
    if (key.length > 3 && key[1] && letterOf(key[1]) !== pools[0]) pools.push(letterOf(key[1])); // 第一個字母打錯
    const hits = [];
    for (const l of pools) {
      let list;
      try { list = await loadIndex(l); } catch { continue; }
      list.forEach((k, rank) => {
        const d = lev(key, k, max);
        if (d <= max) hits.push({ k, d, rank });
      });
    }
    hits.sort((a, b) => a.d - b.d || a.rank - b.rank);
    return [...new Set(hits.map(h => h.k))].slice(0, n);
  }

  async function resembleGroups(ids) {
    if (!ids?.length) return [];
    resemble ??= fetchJSON('dict/resemble.json').then(d => d || []).catch(err => { resemble = null; throw err; });
    const all = await resemble;
    return ids.map(i => all[i]).filter(Boolean);
  }

  // Free Dictionary API（資料來自 Wiktionary，CC BY-SA）：音標、真人發音、英英解釋
  async function online(word) {
    const data = await fetchJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word));
    if (!Array.isArray(data)) return { found: false };
    const out = { found: true, us: null, uk: null, ipa: null, defs: [], source: data[0]?.sourceUrls?.[0] || null };
    const syns = [];
    for (const d of data) {
      for (const p of d.phonetics || []) {
        const region = /-us\.mp3$/i.test(p.audio || '') ? 'us' : /-uk\.mp3$/i.test(p.audio || '') ? 'uk' : null;
        if (region && !out[region]) out[region] = { ipa: p.text || null, audio: p.audio };
        else if (region && out[region] && !out[region].ipa && p.text) out[region].ipa = p.text;
        if (!out.ipa && p.text) out.ipa = p.text;
      }
      if (!out.ipa && d.phonetic) out.ipa = d.phonetic;
      for (const m of d.meanings || []) {
        let group = out.defs.find(g => g.pos === m.partOfSpeech);
        if (!group) out.defs.push(group = { pos: m.partOfSpeech, items: [] });
        for (const def of m.definitions || []) {
          if (group.items.length < 4) group.items.push(def.definition);
          syns.push(...(def.synonyms || []));
        }
        syns.push(...(m.synonyms || []));
      }
    }
    const self = norm(word);
    out.synonyms = [...new Set(syns.map(s => s.trim()).filter(s => s && norm(s) !== self))];
    return out;
  }

  // 依 BNC／COCA 詞頻排名換算常見程度
  function frequency(rank) {
    if (!rank) return null;
    const level = rank <= 1000 ? '非常常見' : rank <= 3000 ? '很常見' : rank <= 8000 ? '常見' : rank <= 20000 ? '較少見' : '少見';
    return { level, rank };
  }

  // 詞形變化表：[{label, words: []}]
  function inflections(key, entry) {
    const x = entry?.x || {};
    const split = v => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
    const groups = [];
    if (x.p || x.d || x.i || x['3']) {
      groups.push({ title: 'verb', rows: [
        ['原形', [entry.w]], ['第三人稱單數', split(x['3'])], ['過去式', split(x.p)],
        ['過去分詞', split(x.d)], ['現在分詞', split(x.i)],
      ].filter(r => r[1].length) });
    }
    if (x.s) groups.push({ title: 'noun', rows: [['單數', [entry.w]], ['複數', split(x.s)]] });
    if (x.r || x.t) {
      groups.push({ title: '形容詞／副詞', rows: [['原級', [entry.w]], ['比較級', split(x.r)], ['最高級', split(x.t)]].filter(r => r[1].length) });
    }
    return groups;
  }

  // 收藏清單用的詞性標籤：動詞的 vt./vi./v. 合併成一個（例如兩者都有就是 vi./vt.）
  function posLabels(entry) {
    const labels = [...new Set(entry.m.filter(g => !g.d).map(g => g.l))];
    const verbs = labels.filter(l => ['vt.', 'vi.', 'v.'].includes(l));
    if (!verbs.length) return labels;
    const verb = verbs.includes('v.') || verbs.length > 1 ? 'vi./vt.' : verbs[0];
    return [...new Set(labels.map(l => verbs.includes(l) ? verb : l))];
  }

  return { norm, lookup, suggest, searchChinese, isChinese, fuzzy, getEntry, senses, resembleGroups, online, frequency, inflections, lev, posLabels };
})();
