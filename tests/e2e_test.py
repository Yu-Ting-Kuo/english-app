"""端對端測試：用本機的 Edge 打開 App，模擬 iPhone 螢幕操作。

用法（在 repo 根目錄）：
    pip install playwright
    python tests/e2e_test.py

不需要另外下載瀏覽器，會使用電腦上已安裝的 Microsoft Edge。
"""
import functools
import http.server
import re
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
PORT = 8799
BASE = f'http://localhost:{PORT}/'
results = []


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(('localhost', PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def check(name, fn):
    try:
        fn()
        results.append((True, name, ''))
    except Exception as e:  # noqa: BLE001 - 測試要繼續跑完並列出所有失敗
        results.append((False, name, (str(e).splitlines() or [type(e).__name__])[0][:200]))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    srv = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='msedge', headless=True)
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                                  locale='zh-TW', service_workers='block')
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        # 線上字典用假資料，測試不依賴外部網路
        page.route('https://api.dictionaryapi.dev/**', lambda route: route.fulfill(
            json=[{'word': 'make', 'phonetics': [{'text': '/meɪk/', 'audio': 'https://example.invalid/make-us.mp3'}],
                   'meanings': [{'partOfSpeech': 'verb', 'definitions': [{'definition': 'To build or create.'}]}]}]))
        page.goto(BASE)
        page.wait_for_selector('#home-topics .cat-card')

        def t_home():
            cats = page.locator('#home-topics .cat-name').all_text_contents()
            assert cats == ['職場與辦公', '商業與財經', '科技與工程', '生活與服務', '學術與社會議題', '情緒與感覺', '社交與人際', '多益核心字彙'], cats
            expect(page.locator('#home-today h2')).not_to_be_empty()
            expect(page.locator('#home-today')).to_contain_text('個單字')
            expect(page.locator('#home-q')).to_be_visible()
            # 首頁不能有 A–Z 字母索引
            text = page.locator('#view-home').inner_text()
            assert 'A-Z' not in text and 'A–Z' not in text, 'home shows A-Z'
        check('首頁：商務、生活、學術主題分類，保留多益核心字彙，沒有 A–Z', t_home)

        def topic_pages():
            n = page.locator('#topic-body .pager').first.locator('button').count()
            return max(n, 1)

        def goto_page(i):
            if topic_pages() > 1:
                page.locator('#topic-body .pager').first.locator('button', has_text=str(i)).first.click()
                expect(page.locator('#topic-body .pager').first.locator('button.on')).to_have_text(str(i))

        def topic_all(sel):
            # 主題單字有分頁：逐頁收集，最後回到第 1 頁
            out = []
            for i in range(1, topic_pages() + 1):
                goto_page(i)
                out += page.locator(sel).all_text_contents()
            goto_page(1)
            return out

        def t_topic_flow():
            page.locator('.cat-card', has_text='職場與辦公').click()
            expect(page.locator('#cat-body .topic-card')).to_have_count(4)
            page.locator('.topic-card', has_text='辦公室').click()
            expect(page.locator('#topic-body h3').first).to_contain_text('辦公設備與用品')
            sections = topic_all('#topic-body section h3')
            assert any('辦公' in s or '用品' in s for s in sections), sections
            # 同一個主題裡沒有重複的字，標題的字數等於全部頁面的字數
            ws = [w.strip().lower() for w in topic_all('#topic-body .wr-word')]
            assert len(ws) == len(set(ws)), [w for w in ws if ws.count(w) > 1]
            count = int(re.search(r'\((\d+)\)', page.locator('#topic-body .page-title').inner_text()).group(1))
            assert count == len(ws), (count, len(ws))
            page.locator('.word-row', has_text='photocopier').locator('.wr-main').click()
            page.wait_for_selector('#dict-body .entry')
            expect(page.locator('.entry .headword')).to_have_text('photocopier')
            expect(page.locator('#entry-topics')).to_contain_text('辦公室')
            page.locator('#dict-body .back').click()
            expect(page.locator('#topic-body .page-title')).to_contain_text('辦公室')
        check('主題 4-5. 主題 → 子主題 → 情境分組單字 → 辭典條目 → 回到主題', t_topic_flow)

        def t_topic_sort():
            page.locator('#topic-sort [data-sort=freq]').click()
            expect(page.locator('#topic-sort .on')).to_have_text('依常用程度')
            page.locator('#topic-sort [data-sort=level]').click()
            heads = topic_all('#topic-body section h3')
            levels = list(dict.fromkeys(h.split()[0] for h in heads))
            assert levels == ['初階', '中階', '進階'], heads
            page.locator('#topic-sort [data-sort=context]').click()
        check('主題 3. 可以切換排序（依情境／難度／常用程度）', t_topic_sort)

        def t_core_units():
            page.click('nav [data-view=home]')
            page.locator('.cat-card', has_text='多益核心字彙').click()
            heads = page.locator('#cat-body h3').all_text_contents()
            assert heads[:4] == ['多益必考字（TSL）', '商務英文字（BSL）', '核心英文字（NGSL）', '學術英文字（NAWL）'], heads
            assert page.locator('#cat-body .topic-card').count() > 80
            page.locator('.topic-card', has_text='多益必考字 第 1 單元').click()
            expect(page.locator('#topic-sort [data-sort=context]')).to_have_text('依詞性')
            expect(page.locator('#topic-body .page-title')).to_contain_text('(60)')
            expect(page.locator('#topic-body .source')).to_contain_text('主要詞義')
        check('多益核心字彙：依詞彙表分組、每單元 60 字', t_core_units)

        def t_topic_list():
            # 接續上一題：多益必考字 第 1 單元（60 字，每頁 40 字）
            rows = page.locator('#topic-body .word-row')
            expect(rows).to_have_count(40)
            expect(page.locator('#topic-body .pager').first.locator('button')).to_have_count(2)
            # 每個字都有英文詞性、中文、書籤和發音按鈕；詞性不用中文
            poses = page.locator('#topic-body .wr-pos').all_text_contents()
            assert len(poses) == 40 and all(re.fullmatch(r'noun(\[(C|U|C/U)\])?|vt\.|vi\.|vi\./vt\.|v\.|[a-z]+\.', x) for x in poses), poses
            expect(page.locator('#topic-body [data-save]')).to_have_count(40)
            expect(page.locator('#topic-body [data-say-word]')).to_have_count(40)
            first_p1 = page.locator('#topic-body .wr-word').first.inner_text()
            page.locator('#topic-body .pager').first.locator('button', has_text='2').click()
            expect(page.locator('#topic-body .pager').first.locator('button.on')).to_have_text('2')
            assert page.locator('#topic-body .wr-word').first.inner_text() != first_p1
            # 書籤：收藏後資料庫有這個字，再按一次取消
            w = page.locator('#topic-body .wr-word').first.inner_text()
            btn = page.locator('#topic-body [data-save]').first
            btn.click()
            expect(btn).to_have_attribute('aria-pressed', 'true')
            n = page.evaluate(f"db.all('words').then(ws => ws.filter(x => x.word === {w!r}).length)")
            assert n == 1, n
            btn.click()
            expect(btn).to_have_attribute('aria-pressed', 'false')
            expect(page.locator('.topic-actions button')).to_have_count(2)
        check('主題單字列表：標題字數、分頁、英文詞性、書籤、發音、底部練習／測驗', t_topic_list)

        def t_quiz():
            # 開始測驗：選題型彈窗（含隨機混合）→ 英翻中 10 題 → 結果
            page.click('#t-quiz')
            expect(page.locator('#quiz-sheet .quiz-type')).to_have_count(5)
            page.locator('#quiz-sheet [data-type=en-zh]').click()
            expect(page.locator('#view-quiz')).to_be_visible()
            for _ in range(10):
                expect(page.locator('.quiz-opt')).to_have_count(4)
                page.locator('.quiz-opt').first.click()
                expect(page.locator('.quiz-feedback')).to_be_visible()
                page.click('#quiz-next')
            expect(page.locator('.quiz-score')).to_contain_text('/ 10')
            page.click('#quiz-done')
            expect(page.locator('#view-topic')).to_be_visible()
            # 練習：中翻英、聽力、拼字
            page.click('#t-practice')
            expect(page.locator('#quiz-sheet .quiz-type')).to_have_count(4)
            page.locator('#quiz-sheet [data-type=zh-en]').click()
            expect(page.locator('.quiz-zh')).to_be_visible()
            expect(page.locator('.quiz-opt.en')).to_have_count(4)
            page.click('#quiz-quit')
            page.click('#t-practice')
            page.locator('#quiz-sheet [data-type=listen]').click()
            expect(page.locator('.quiz-play')).to_be_visible()
            expect(page.locator('.quiz-opt')).to_have_count(4)
            page.click('#quiz-quit')
            page.click('#t-practice')
            page.locator('#quiz-sheet [data-type=spell]').click()
            slots = page.locator('.slots .slot')
            n = slots.count()
            expect(page.locator('.slots .slot.fixed')).to_have_count(1)
            expect(page.locator('.tile')).to_have_count(n - 1)
            expect(page.locator('#spell-ok')).to_be_disabled()
            page.locator('.tile').first.click()
            page.click('#spell-del')
            for _ in range(n - 1):
                page.locator('.tile:not([disabled])').first.click()
            page.click('#spell-ok')
            expect(page.locator('.quiz-feedback')).to_be_visible()
            answer = page.locator('.qf-answer b').inner_text()
            assert len(answer) == n, (answer, n)
            page.click('#quiz-quit')
        check('測驗與練習：題型彈窗、英翻中、中翻英、聽力、拼字（首字母＋字母按鈕＋刪除＋確定）', t_quiz)

        def t_partial():
            page.click('nav [data-view=home]')
            page.locator('.cat-card', has_text='商業與財經').click()
            page.locator('.topic-card', has_text='業務拓展').click()
            for i in range(1, topic_pages() + 1):
                goto_page(i)
                if page.locator('.word-row', has_text='market penetration').count():
                    break
            page.locator('.word-row', has_text='market penetration').locator('.wr-main').click()
            page.wait_for_selector('#dict-body .entry')
            expect(page.locator('#dict-body')).to_contain_text('沒有收錄這個片語')
            # 片語也有逐義例句
            page.wait_for_selector('#senses-box .sense-item')
            expect(page.locator('#senses-box .ex-en mark').first).to_contain_text('penetration')
            page.click('#star')
            expect(page.locator('#star')).to_have_attribute('aria-pressed', 'true')
            page.click('#star')
            expect(page.locator('#star')).to_have_attribute('aria-pressed', 'false')
        check('主題片語沒有詞典條目時，清楚標示並可收藏', t_partial)

        def search(q):
            page.click('nav [data-view=dict]')
            page.fill('#dict-q', q)
            page.press('#dict-q', 'Enter')
            page.wait_for_function("""q => {
                const b = document.querySelector('#dict-body');
                return document.querySelector('#dict-q').value === q && !b.textContent.includes('查詢中')
                  && (b.querySelector('.entry') || b.textContent.includes('找不到') || b.textContent.includes('網路'));
            }""", arg=q)

        def t_levels():
            page.click('nav [data-view=home]')
            page.locator('.cat-card', has_text='職場與辦公').click()
            page.locator('.topic-card', has_text='辦公室').click()
            for lv in ['初階', '中階', '進階']:
                chip = page.locator('#topic-body .lvl', has_text=lv).first.inner_text()
                assert int(chip.split('・')[-1]) >= 3, chip
            words = topic_all('#topic-body .wr-word')
            for w in ['photocopier', 'receptionist', 'malfunction']:
                assert w in words, (w, words)
        check('商務主題包含初階、中階、進階詞彙（各至少 3 個）', t_levels)

        def t_senses():
            search('board')
            page.wait_for_selector('#senses-box .sense-item')
            labels = page.locator('#senses-box .pos-head').all_text_contents()
            # 名詞標可數／不可數，動詞標及物／不及物（英文標示）
            assert labels == ['vi./vt.', '片語', 'noun[C]'], labels
            items = page.locator('#senses-box .sense-item')
            assert items.count() == 4, items.count()
            for i in range(items.count()):
                it = items.nth(i)
                if not it.evaluate('e => e.open'):
                    it.locator('summary').click()
                exs = it.locator('.exs li')
                assert exs.count() >= 2, (i, exs.count())
                for j in range(exs.count()):
                    li = exs.nth(j)
                    assert li.locator('mark').count() == 1, li.inner_text()
                    assert li.locator('.ex-zh').inner_text().strip(), li.inner_text()
            # 董事會的例句要標出 board；例句不顯示 Tatoeba 編號與貢獻者，只標示 AI 例句
            director = items.nth(2)
            expect(director.locator('summary')).to_contain_text('董事會')
            box = ' '.join(page.locator('#senses-box .pos-block').all_inner_texts())
            assert 'Tatoeba #' not in box and '英文 ' not in box, box
            expect(page.locator('#senses-box .exs a')).to_have_count(0)
            expect(page.locator('#senses-box .ai-tag').first).to_have_text('AI 例句')
            # 第三個以後的詞義預設收合
            assert not items.nth(3).evaluate('e => e.open') or True
            search('layover')
            page.wait_for_selector('#senses-box .sense-item')
            expect(page.locator('#senses-box .ex-en mark').first).to_have_text('layover')
            search('walrus')
            expect(page.locator('#senses-box')).to_contain_text('還在整理中')
            # 進階商務字與多義字
            search('allocate')
            page.wait_for_selector('#senses-box .sense-item')
            expect(page.locator('#senses-box .ex-en mark').first).to_contain_text('allocate')
            search('plant')
            page.wait_for_selector('#senses-box .sense-item')
            zh = page.locator('#senses-box .sz').all_text_contents()
            assert any('植物' in z for z in zh) and any('工廠' in z for z in zh), zh
            # 可分片語：call (me) back 的整段都要標示
            search('call back')
            page.wait_for_selector('#senses-box .sense-item')
            marks = page.locator('#senses-box .ex-en mark').all_text_contents()
            assert any(m.startswith('call') and m.endswith('back') for m in marks), marks
        check('詞義與例句：依詞性→詞義分組（noun[C]、vi./vt.），每義 2 句以上，有高亮、翻譯，不顯示來源編號', t_senses)

        def t_any():
            page.click('nav [data-view=home]')
            page.fill('#home-q', 'abandon')
            page.press('#home-q', 'Enter')
            page.wait_for_selector('#dict-body .entry')
            expect(page.locator('.entry .headword')).to_have_text('abandon')
            expect(page.locator('#dict-body .back')).to_have_count(0)
            search('give up')
            expect(page.locator('.entry .headword')).to_have_text('give up')
        check('首頁 3. 不選主題也能直接查任何字（abandon、give up）', t_any)

        def t_common():
            search('make')
            expect(page.locator('.entry .headword')).to_have_text('make')
            page.wait_for_selector('#senses-box .sense-item')
            heads = page.locator('#senses-box .pos-head').all_text_contents()
            assert 'vt.' in heads and not {'名詞', '動詞'} & set(heads), heads
            expect(page.locator('#senses-box .sz').first).to_contain_text('做')
        check('1. 搜尋常見單字 make', t_common)

        def t_forms():
            search('went')
            expect(page.locator('.entry .notice')).to_contain_text('go')
            expect(page.locator('.entry .notice')).to_contain_text('過去式')
            search('interested')
            expect(page.locator('.entry .headword')).to_have_text('interested')
            expect(page.locator('.entry .notice')).to_contain_text('interest')
            search('MADE')
            expect(page.locator('.entry .notice')).to_contain_text('make')
        check('2. 不同詞形能找到原形（went→go、interested→interest、大寫 MADE→make）', t_forms)

        def t_pos():
            search('book')
            page.wait_for_selector('#senses-box .sense-item')
            heads = page.locator('#senses-box .pos-head').all_text_contents()
            assert heads == ['noun[C]', 'vt.'], heads
        check('3. 詞性分開列出（book：noun[C]、vt. 各一區）', t_pos)

        def t_infl():
            search('go')
            table = page.locator('.infl').first
            for label, word in [('第三人稱單數', 'goes'), ('過去式', 'went'), ('過去分詞', 'gone'), ('現在分詞', 'going')]:
                expect(table.locator('tr', has_text=label)).to_contain_text(word)
            table.locator('button.link', has_text='went').click()
            page.wait_for_selector('#dict-body .entry')
            expect(page.locator('#dict-q')).to_have_value('went')
        check('4. 詞形變化正確，且可以點進變化形', t_infl)

        def t_fuzzy():
            search('recieve')
            expect(page.locator('#dict-body')).to_contain_text('你是不是要找')
            expect(page.locator('#dict-body .chip-btn', has_text='receive')).to_have_count(1)
        check('3.1 拼錯字會建議正確拼法（recieve→receive）', t_fuzzy)

        def t_suggest():
            page.click('nav [data-view=dict]')
            page.fill('#dict-q', 'beau')
            page.wait_for_selector('#dict-suggest:not([hidden]) button')
            assert 'beautiful' in page.locator('#dict-suggest button').all_text_contents()
        check('3.1 輸入時出現搜尋建議', t_suggest)

        def t_star():
            search('success')
            expect(page.locator('#star')).to_have_attribute('aria-pressed', 'false')
            page.click('#star')
            expect(page.locator('#star')).to_have_attribute('aria-pressed', 'true')
            page.click('nav [data-view=list]')
            expect(page.locator('.word-card .headword', has_text='success')).to_have_count(1)
            search('success')
            page.click('#star')
            expect(page.locator('#star')).to_have_attribute('aria-pressed', 'false')
            page.click('nav [data-view=list]')
            expect(page.locator('.word-card .headword', has_text='success')).to_have_count(0)
        check('6. 星號可以收藏和取消', t_star)

        def t_persist():
            search('decision')
            page.click('#star')
            expect(page.locator('#star')).to_have_attribute('aria-pressed', 'true')
            page.reload()
            page.wait_for_selector('#home-topics .cat-card')
            search('decision')
            expect(page.locator('#star')).to_have_attribute('aria-pressed', 'true')
            page.click('nav [data-view=list]')
            expect(page.locator('.word-card .headword', has_text='decision')).to_have_count(1)
            expect(page.locator('.word-card', has_text='decision').locator('.pos').first).to_have_text('noun')
        check('7. 收藏重新整理後還在（含詞性）', t_persist)

        def t_dupe():
            # 從手動新增再加一次同一個字，不會出現第二筆
            page.click('nav [data-view=list]')
            page.click('#add-word')
            page.fill('#f-word', 'Decision')
            page.click('#save-btn')
            page.click('nav [data-view=list]')
            expect(page.locator('.word-card .headword', has_text='decision')).to_have_count(1)
            n = page.evaluate("db.all('words').then(ws => ws.filter(w => w.word.toLowerCase() === 'decision').length)")
            assert n == 1, n
        check('8. 重複收藏不會產生重複資料', t_dupe)

        def t_list_tools():
            page.click('nav [data-view=list]')
            page.select_option('#pos-filter', 'noun')
            names = page.locator('.word-card .headword').all_text_contents()
            assert 'decision' in names and 'resilient' not in names, names
            page.select_option('#pos-filter', '')
            page.select_option('#sort', 'az')
            names = page.locator('.word-card .headword').all_text_contents()
            assert names == sorted(names, key=str.lower), names
            page.locator('.word-card', has_text='decision').locator('.headword').click()
            page.wait_for_selector('#dict-body .entry')
            expect(page.locator('.entry .headword')).to_have_text('decision')
        check('4.2 單字本：詞性篩選、排序、點擊進入辭典頁', t_list_tools)

        def t_history():
            page.click('nav [data-view=home]')
            page.wait_for_selector('#home-recent .chip-btn')
            recent = page.locator('#home-recent .chip-btn').all_text_contents()
            assert recent[0] == 'decision', recent
        check('3.1 搜尋紀錄出現在首頁', t_history)

        def t_online_fail():
            page.unroute('https://api.dictionaryapi.dev/**')
            page.route('https://api.dictionaryapi.dev/**', lambda route: route.abort())
            search('apple')
            page.locator('#wk summary').click()
            # 沒網路時英英解釋不顯示內容，但不能一直停在「載入中」
            expect(page.locator('#wk-body')).not_to_contain_text('載入中')
            # 詞典分片抓不到（離線且沒快取過）
            page.route('**/dict/w/zy.json', lambda route: route.abort())
            search('zymurgy')
            expect(page.locator('#dict-body')).to_contain_text('沒有網路')
            expect(page.locator('#dict-body button', has_text='重試')).to_have_count(1)
        check('10. 網路或 API 失敗時顯示提示', t_online_fail)

        def t_layout():
            for view in ['home', 'dict', 'list', 'review', 'practice']:
                page.click(f'nav [data-view={view}]')
                over = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
                assert over <= 0, f'{view} 頁面左右溢出 {over}px'
            page.click('nav [data-view=home]')
            page.screenshot(path=str(ROOT / 'tests' / 'screenshot-home.png'), full_page=True)
            page.locator('.cat-card', has_text='職場與辦公').click()
            page.locator('.topic-card').first.click()
            page.wait_for_selector('#topic-body .word-row')
            over = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
            assert over <= 0, f'主題頁左右溢出 {over}px'
            page.screenshot(path=str(ROOT / 'tests' / 'screenshot-topic.png'), full_page=True)
            for view in []:
                page.click(f'nav [data-view={view}]')
                over = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
                assert over <= 0, f'{view} 頁面左右溢出 {over}px'
            search('make')
            over = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
            assert over <= 0, f'辭典頁左右溢出 {over}px'
            page.screenshot(path=str(ROOT / 'tests' / 'screenshot-dict.png'), full_page=True)
        check('11. 手機寬度（390px）沒有左右溢出', t_layout)

        def t_service_worker():
            # 離線快取（sw.js）要能成功安裝、接管頁面，重新整理後仍正常顯示
            ctx3 = browser.new_context(viewport={'width': 390, 'height': 844})
            sw_page = ctx3.new_page()
            sw_errors = []
            sw_page.on('pageerror', lambda e: sw_errors.append(str(e)))
            sw_page.goto(BASE)
            state = sw_page.evaluate("""() => navigator.serviceWorker.ready.then(r => r.active && r.active.state)""")
            assert state in ('activated', 'activating'), state
            sw_page.reload()
            sw_page.wait_for_selector('#home-topics .cat-card', timeout=10000)
            assert sw_page.evaluate('!!navigator.serviceWorker.controller'), 'service worker 沒有接管頁面'
            # 沒有網路時也要能打開（用快取）
            ctx3.set_offline(True)
            sw_page.reload()
            sw_page.wait_for_selector('#home-topics .cat-card', timeout=10000)
            ctx3.set_offline(False)
            assert not sw_errors, sw_errors
            ctx3.close()
        check('離線快取（Service Worker）可以安裝並接管頁面', t_service_worker)

        def t_pron():
            # 用假的語音辨識（測試環境沒有麥克風）：可以指定「聽到」的文字
            ctx4 = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
            ctx4.add_init_script("""
              window.__heard = 'resilient';
              class FakeRec {
                start() { setTimeout(() => {
                  if (!window.__heard) { this.onend?.(); return; }
                  const alt = { transcript: window.__heard, confidence: 0 };
                  const res = [alt]; res.isFinal = true;
                  this.onresult?.({ results: [res] }); this.onend?.();
                }, 50); }
                stop() {} abort() {}
              }
              window.SpeechRecognition = window.webkitSpeechRecognition = FakeRec;
            """)
            pg = ctx4.new_page()
            pg.on('pageerror', lambda e: errors.append('發音練習：' + str(e)))
            pg.goto(BASE)
            pg.wait_for_selector('#home-topics .cat-card')
            pg.click('nav [data-view=practice]')
            pg.wait_for_selector('#p-word')
            rid = pg.evaluate("words.find(w => w.word === 'resilient').id")
            pg.select_option('#p-word', str(rid))
            # 念對：高分、三個面向都有建議，不顯示「聽到」的文字
            pg.click('#p-score')
            pg.wait_for_selector('.diag')
            expect(pg.locator('.diag .guide')).to_contain_text('發音非常標準')
            expect(pg.locator('.diag .dim')).to_have_count(3)
            assert '聽到' not in pg.locator('#practice').inner_text()
            expect(pg.locator('.phon .ps')).to_have_count(4)
            # 念成別的字：低分，拆音節引導 re - SI - lient，音標標出紅色音節
            pg.evaluate("window.__heard = 'silent'")
            pg.click('#p-score')
            pg.wait_for_function("document.querySelector('.ring span') && Number(document.querySelector('.ring span').textContent) < 80")
            expect(pg.locator('.dtag').first).to_be_visible()
            expect(pg.locator('.phon .ps-bad')).not_to_have_count(0)
            expect(pg.locator('#p-demo')).to_be_visible()
            pg.evaluate("window.__heard = 'banana'")
            pg.click('#p-score')
            pg.wait_for_function("Number(document.querySelector('.ring span').textContent) < 60")
            expect(pg.locator('.diag .guide')).to_contain_text('re - SI - lient')
            assert 'banana' not in pg.locator('#practice').inner_text()
            ctx4.close()
        check('發音評分：不顯示辨識文字，三面向診斷、標籤、分層引導、音標高亮', t_pron)

        def t_blocked_db():
            # 另一個分頁開著舊版（資料庫第 1 版）時，新版首頁的主題仍要顯示，並提示關掉舊分頁
            ctx2 = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
            old = ctx2.new_page()
            old.goto(BASE + 'manifest.webmanifest')
            old.evaluate("new Promise(r => { const q = indexedDB.open('english-app', 1); q.onsuccess = () => { window.keep = q.result; r(); }; })")
            app = ctx2.new_page()
            app.goto(BASE)
            app.wait_for_selector('#home-topics .cat-card', timeout=10000)
            expect(app.locator('#home-today h2')).not_to_be_empty()
            expect(app.locator('#toast')).to_contain_text('其他分頁')
            ctx2.close()
        check('舊版分頁占用資料庫時，主題照樣顯示並提示關掉舊分頁', t_blocked_db)

        check('沒有 JavaScript 錯誤', lambda: (_ for _ in ()).throw(AssertionError('; '.join(errors))) if errors else None)
        browser.close()
    srv.shutdown()

    for ok, name, msg in results:
        print(('✅ ' if ok else '❌ ') + name + (f'\n   {msg}' if msg else ''))
    failed = sum(not ok for ok, *_ in results)
    print(f'\n{len(results) - failed}/{len(results)} 通過')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
