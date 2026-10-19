"""Ensure the requested 119 terms are included in the Trade topic."""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
REQUIRED = """acquisition bidder clause contract contractor contender competitor corporate cost-effective commercial consolidate credible cover coverage debit dealer due elasticity expire extinct earnings endorse guarantee headquarters inventory long-range merger obligate payment proposal quote quota renew trademark tariff term undertaking voucher elaborate extend attainment endeavor president original council track once entertainment attack damage produce native baseball partnership principal certification previously beat continuing soil investor exit trail symbol lock supreme submission encourage novel revolution dependent mechanical charter recruitment commit tiny operational excess familiar capable admission victory guardian lecture cabinet evaluate nationwide attribute apparently popularity summit fundamental somewhat obvious globe regularly customize deputy precision talent personality subscriber curve steady proceeds utilization efficiently nowhere confront undermine accomplishment customary silica goods trade distribution embargo bargaining smuggle""".split()

# word | Taiwan Traditional Chinese gloss | section index in the trade source
ADDITIONS = """
acquisition|收購；取得|0
bidder|投標者；出價者|0
clause|條款；子句|0
contract|合約；契約；簽約|0
contractor|承包商；承攬人|0
contender|競爭者；角逐者|0
competitor|競爭者；對手|0
corporate|公司的；企業的|0
cost-effective|符合成本效益的；划算的|0
commercial|商業的；商用的；廣告的|0
consolidate|合併；整合；鞏固|0
credible|可信的；可靠的|0
cover|涵蓋；包括；保險保障|0
coverage|保障範圍；承保項目；涵蓋範圍|0
debit|借方；扣款；記入借方|2
due|到期的；應付的；預定的|0
elasticity|彈性；伸縮性|2
expire|到期；失效|0
extinct|滅絕的；絕種的|4
earnings|收入；收益；薪資|2
endorse|背書；支持；贊同|0
guarantee|保證；保固；保證書|0
headquarters|總公司；總部|0
inventory|存貨；庫存；詳細清單|1
long-range|長期的；遠程的|0
merger|合併；合併案|0
obligate|使負有義務；使必須|0
payment|付款；支付款項|2
proposal|提案；建議；求婚|0
quote|報價；引用；引述|0
quota|配額；定額|1
renew|更新；續約；延長期限|0
trademark|商標|0
term|條款；術語；期限|0
undertaking|重大任務；事業；承諾|0
voucher|憑單；折價券；代用券|2
elaborate|詳細說明；精心策劃|0
extend|延長；擴展|0
attainment|達成；取得；成就|0
endeavor|努力；盡力|4
president|總裁；董事長；校長；總統|0
original|原本的；最初的；原創作品|0
council|委員會；議會|0
track|追蹤；軌跡；軌道|1
once|一次；曾經；一旦|4
entertainment|娛樂；招待|4
attack|攻擊；抨擊|4
damage|損害；損壞|3
produce|生產；製造；農產品|1
native|本地的；本國的；原生的|4
baseball|棒球|4
partnership|合夥關係；合作關係|0
principal|主要的；本金；校長|2
certification|證明；認證；檢定|2
previously|先前；以前|4
beat|節拍；心跳；打敗|4
continuing|持續的；連續的|4
soil|土壤；泥土|4
investor|投資者；出資者|2
exit|出口；離開|1
trail|蹤跡；小徑|1
symbol|符號；象徵|4
lock|鎖；鎖上|1
supreme|最高的；至高無上的|4
submission|提交；呈交；屈服|0
encourage|鼓勵；促進|4
novel|小說；新穎的|4
revolution|革命；重大變革；循環|4
dependent|依賴的；取決於的|4
mechanical|機械的；機械式的|1
recruitment|招募；徵募|0
commit|承諾；投入；犯（罪）|0
tiny|極小的；微小的|4
operational|營運上的；操作上的|1
excess|過量的；額外的；超額|2
familiar|熟悉的；常見的|4
capable|有能力的；能勝任的|4
admission|准入；入場費；承認|4
victory|勝利|4
guardian|監護人；守護者|4
lecture|演講；講課；訓斥|4
cabinet|櫥櫃；內閣|1
evaluate|評估；評價|0
nationwide|全國性的；遍及全國的|1
attribute|特質；歸因於|4
apparently|顯然；看起來似乎|4
popularity|普及；受歡迎；聲望|4
summit|高峰；高峰會議|0
fundamental|基本的；根本的|4
somewhat|稍微；有點|4
obvious|明顯的；顯而易見的|4
globe|地球；地球儀|4
regularly|定期地；有規律地|1
customize|客製化；訂製|0
deputy|代理人；副手；副職|0
precision|精確；準確|1
talent|才能；天賦；人才|4
personality|個性；人格|4
subscriber|訂閱者；認購者|2
curve|曲線；使彎曲|1
steady|穩定的；平穩的|1
proceeds|收益；實收款項|2
utilization|利用；使用|1
efficiently|有效率地；有效地|1
nowhere|無處；哪裡都不|4
confront|面對；遭遇|4
undermine|暗中破壞；削弱|0
accomplishment|成就；完成；造詣|4
customary|慣常的；依照慣例的|0
silica|二氧化矽；矽土|3
distribution|配送；分配；經銷|1
bargaining|議價；協商|0
"""


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def words_in(topic):
    return {word.lower() for section in topic["sections"] for word, _gloss in section[2]}


def main():
    source_path = ROOT / "tools/topics.json"
    v2_path = ROOT / "tools/topics_v2/trade.json"
    source = load(source_path)
    topic = source["topics"]["trade"]
    existing = words_in(topic)
    missing = [word for word in REQUIRED if word.lower() not in existing]
    additions = [line.split("|") for line in ADDITIONS.strip().splitlines() if line.strip()]
    pending = [row for row in additions if row[0].lower() not in existing]
    add_words = {row[0].lower() for row in pending}
    if set(missing) != add_words:
        raise SystemExit(f"Mismatch: missing={sorted(set(missing)-add_words)} extra={sorted(add_words-set(missing))}")
    v2 = load(v2_path)
    for word, gloss, index in pending:
        section_index = int(index)
        for target in (topic, v2):
            section = target["sections"][section_index]
            if word.lower() not in {w.lower() for w, _ in section[2]}:
                section[2].append([word, gloss])
    save(source_path, source)
    save(v2_path, v2)
    final = words_in(topic)
    absent = [word for word in REQUIRED if word.lower() not in final]
    if absent:
        raise SystemExit("Still missing: " + ", ".join(absent))
    built_path = ROOT / "dict/topics.json"
    if built_path.exists():
        built = load(built_path)["topics"]["trade"]
        built_words = {entry["w"].lower() for section in built["sections"] for entry in section["words"]}
        still_absent = [word for word in REQUIRED if word.lower() not in built_words]
        if still_absent:
            raise SystemExit("Rebuild dict/topics.json first; missing: " + ", ".join(still_absent))
        level_names = {"B": "初階", "I": "中階", "A": "進階"}
        result = {
            "id": "trade",
            "zh": "貿易",
            "en": "Trade",
            "category": "商業與財經",
            "count": built["count"],
            "levels": {level_names[k]: v for k, v in built["levels"].items()},
            "sections": [],
        }
        n = 0
        for section in built["sections"]:
            out_section = {"zh": section["zh"], "en": section["en"], "words": []}
            for entry in section["words"]:
                n += 1
                out_section["words"].append({
                    "id": f"trade_{n:03d}",
                    "word": entry["w"],
                    "partOfSpeech": entry["ps"],
                    "meaning": entry["g"],
                    "category": "trade 貿易",
                    "level": level_names.get(entry["lv"], entry["lv"]),
                    "frequencyRank": entry.get("r"),
                })
            result["sections"].append(out_section)
        save(ROOT / "tools/trade_vocabulary_verified.json", result)
    print(f"Required terms: {len(REQUIRED)}; present after update: {len(REQUIRED)-len(absent)}; newly added: {len(pending)}")
    if pending:
        print("Added: " + ", ".join(row[0] for row in pending))


if __name__ == "__main__":
    main()
