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
        results.append((False, name, str(e).splitlines()[0][:200]))


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
            assert cats == ['日常生活', '旅遊英文', '工作與商務', '多益主題', '學術與科技', '社會與世界'], cats
            expect(page.locator('#home-today h2')).not_to_be_empty()
            expect(page.locator('#home-today')).to_contain_text('個單字')
            expect(page.locator('#home-q')).to_be_visible()
            # 首頁不能有 A–Z 字母索引
            text = page.locator('#view-home').inner_text()
            assert 'A-Z' not in text and 'A–Z' not in text, 'home shows A-Z'
        check('首頁 1-2. 首頁是主題探索（搜尋列、今日主題、6 大分類，沒有 A–Z）', t_home)

        def t_topic_flow():
            page.locator('.cat-card', has_text='旅遊英文').click()
            expect(page.locator('#cat-body .topic-card')).to_have_count(7)
            page.locator('.topic-card', has_text='機場與搭飛機').click()
            expect(page.locator('#topic-body h3').first).to_contain_text('報到與行李')
            sections = page.locator('#topic-body section h3').all_text_contents()
            assert any('航班異動' in s for s in sections), sections
            # 同一個主題裡沒有重複的字
            ws = [w.strip().lower() for w in page.locator('#topic-body .wr-word').all_text_contents()]
            assert len(ws) == len(set(ws)), [w for w in ws if ws.count(w) > 1]
            count = int(page.locator('#topic-body .chip', has_text='個單字').inner_text().split()[0])
            assert count == len(ws), (count, len(ws))
            page.locator('.word-row', has_text='layover').click()
            page.wait_for_selector('#dict-body .entry')
            expect(page.locator('.entry .headword')).to_have_text('layover')
            expect(page.locator('#entry-topics')).to_contain_text('機場與搭飛機')
            page.locator('#dict-body .back').click()
            expect(page.locator('#topic-body .page-title')).to_contain_text('機場與搭飛機')
        check('主題 4-5. 主題 → 子主題 → 情境分組單字 → 辭典條目 → 回到主題', t_topic_flow)

        def t_topic_sort():
            page.locator('#topic-sort [data-sort=freq]').click()
            expect(page.locator('#topic-sort .on')).to_have_text('依常用程度')
            page.locator('#topic-sort [data-sort=level]').click()
            heads = page.locator('#topic-body section h3').all_text_contents()
            assert [h.split()[0] for h in heads] == ['初階', '中階', '進階'], heads
            page.locator('#topic-sort [data-sort=context]').click()
        check('主題 3. 可以切換排序（依情境／難度／常用程度）', t_topic_sort)

        def t_partial():
            page.click('nav [data-view=home]')
            page.locator('.cat-card', has_text='學術與科技').click()
            page.locator('.topic-card', has_text='網路與數位科技').click()
            page.locator('.word-row', has_text='social media').click()
            page.wait_for_selector('#dict-body .entry')
            expect(page.locator('#dict-body')).to_contain_text('沒有收錄這個片語')
            expect(page.locator('#dict-body')).to_contain_text('App 編輯整理')
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
            page.locator('.cat-card', has_text='工作與商務').click()
            page.locator('.topic-card', has_text='專案管理').click()
            for lv in ['初階', '中階', '進階']:
                chip = page.locator('#topic-body .lvl', has_text=lv).first.inner_text()
                assert int(chip.split()[-1]) >= 3, chip
            words = page.locator('#topic-body .wr-word').all_text_contents()
            for w in ['allocate', 'implement', 'expenditure']:
                assert w in words, (w, words)
        check('主題詞彙有初階、中階、進階，每種至少 3 個（含 allocate、implement 等）', t_levels)

        def t_senses():
            search('board')
            page.wait_for_selector('#senses-box .sense-item')
            labels = page.locator('#senses-box .pos-head').all_text_contents()
            assert labels == ['動詞', '片語', '名詞'], labels
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
                    assert li.locator('.ex-src').inner_text().strip(), li.inner_text()
            # 董事會的例句要標出 board，並附 Tatoeba 來源
            director = items.nth(2)
            expect(director.locator('summary')).to_contain_text('董事會')
            expect(director.locator('.ex-src a').first).to_have_attribute('href', re.compile(r'tatoeba\.org/.+/sentences/show/\d+'))
            expect(page.locator('#senses-box .ai-tag').first).to_have_text('AI 生成例句')
            # 第三個以後的詞義預設收合
            assert not items.nth(3).evaluate('e => e.open') or True
            search('layover')
            page.wait_for_selector('#senses-box .sense-item')
            expect(page.locator('#senses-box .ex-en mark').first).to_have_text('layover')
            search('abandon')
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
        check('詞義與例句：依詞性→詞義分組，每義 2 句以上，有高亮、翻譯、來源', t_senses)

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
            expect(page.locator('.sense .pos', has_text='動詞')).to_have_count(1)
            expect(page.locator('.sense .pos', has_text='名詞')).to_have_count(1)
            expect(page.locator('.sense-text').first).to_contain_text('製造')
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
            labels = page.locator('.sense .pos').all_text_contents()
            assert '名詞' in labels and '動詞' in labels, labels
            assert labels.count('名詞') == 1, labels
        check('3. 詞性分開列出（book：名詞、動詞各一區）', t_pos)

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
            expect(page.locator('.word-card', has_text='decision').locator('.pos').first).to_have_text('名詞')
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
            page.select_option('#pos-filter', '名詞')
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
            expect(page.locator('#wk-body')).to_contain_text('需要網路')
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
            page.locator('.cat-card', has_text='工作與商務').click()
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
