#!/usr/bin/env python3
"""편의점 음료 행사 스크래퍼 -> data.json (공식 행사 페이지만 사용, 임의 데이터 없음)"""
import re, json, time, datetime, requests
from bs4 import BeautifulSoup
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"}
GENRES=[("주류",r"^(레드|화이트|스위트|로제|스파클링|AE|칵테일|위스키|와인|샴페인|사케|청주|전통주|맥주)\)|500ML\*|\*4입|\*6입|페로니|크로넨|버니니|맥주|소주|와인|막걸리|하이볼|위스키|사케|칵테일|레드\)|화이트\)|스파클링\)|ABV|라거|에일|IPA|카스|테라|켈리|참이슬|처음처럼|진로|클라우드|버드와이저|하이네켄|아사히|기네스|호가든|블랑|칭따오|산토리|좋은데이|청하|복분자|잔술"),
 ("에너지/이온",r"핫식스|몬스터|레드불|에너지|이온|포카리|게토레이|파워에이드|토레타|링티|비타500|박카스|컨디션|여명|헛개|숙취|프로틴|단백질|비타민|음료\)?.*비타"),
 ("커피",r"커피|라떼|아메리카노|콜드브루|카페|에스프레소|모카|바리스타|조지아|TOP|칸타타|맥심|티오피|스타벅스|카누|돌체"),
 ("우유/두유",r"우유|두유|요구르트|요거트|야쿠르트|바나나맛|딸기맛우유|초코우유|밀크|베지밀|매일|서울|남양|빙그레|덴마크|아몬드브리즈|오트|소화가잘"),
 ("차",r"녹차|홍차|보리차|옥수수|헛개|우롱|자스민|아이스티|티\b|차\b|차\d|녹차|둥굴레|결명자|마테|콤부차|허브|밀크티|유자차|티\)|티\d|\d+ml.*차|차\("),
 ("생수",r"생수|삼다수|아이시스|백산수|에비앙|평창수|워터|탐사수|볼빅|피지|산수|샘물|미네랄"),
 ("탄산",r"콜라|사이다|탄산|스프라이트|환타|펩시|칠성|밀키스|웰치|토닉|진저|소다|제로|스파클링|닥터페퍼|맥콜|트레비|씨그램|탐스|코카|레몬에이드|에이드|하이볼"),
 ("주스",r"주스|쥬스|과즙|오렌지|사과|포도|망고|자몽|토마토|당근|레몬|복숭아|감귤|매실|알로에|코코넛|쿨피스|갈아만든|자연은|썬키스트|미닛메이드|델몬트|홍삼|석류|청포도|배\b|식혜|수정과|아침햇살|ml|L\b|드링크|음료")]
def genre(n):
    for g,p in GENRES:
        if re.search(p,n,re.I): return g
    return None
# 비음료 제외 키워드
NOTDRINK=r"과자|스낵|껌|캔디|젤리|초콜릿|아이스크림|빵|김밥|도시락|샌드|라면|면\b|컵밥|삼각|치약|샴푸|물티슈|마스크|세제|건전지|칩|쿠키|바\)|콘\b|아이스|팝|떡|만두|소시지|핫바|볶음|파우치|휴지|우산|양말|밀가루|봉지|시리얼"
def price(s):
    m=re.sub(r"[^\d]","",s or ""); return int(m) if m else None
def norm_promo(t):
    t=(t or "").replace(" ","")
    if "1+1" in t: return "1+1"
    if "2+1" in t: return "2+1"
    if "3+1" in t: return "3+1"
    if "덤" in t or "증정" in t: return "덤증정"
    if "할인" in t or "세일" in t or "가격" in t: return "할인"
    return t or "행사"
def add(out,chain,name,pr,promo,img,gift=None,drink_hint=False):
    name=name.strip()
    if not name: return
    if re.search(NOTDRINK,name) and not drink_hint: return
    g=genre(name)
    if not g: return
    if g=="주스" and not drink_hint and not re.search(r"ml|L\b|\d+[mM][lL]|주스|쥬스|음료|드링크|과즙|에이드",name): return
    out.append({"chain":chain,"name":name,"price":pr,"promo":norm_promo(promo),"image":img,"genre":g,"gift":gift})

def cu():
    out=[]
    for page in range(1,200):
        r=requests.post("https://cu.bgfretail.com/event/plusAjax.do",data={"pageIndex":page,"listType":0,"searchCondition":"","user_id":""},headers=UA,timeout=20)
        s=BeautifulSoup(r.text,"html.parser"); items=s.select("li.prod_list")
        if not items: break
        for li in items:
            n=li.select_one(".name p"); p=li.select_one(".price strong"); b=li.select_one(".badge span"); im=li.select_one("img")
            img=im["src"] if im else None
            if img and img.startswith("//"): img="https:"+img
            add(out,"CU",n.get_text() if n else "",price(p.get_text() if p else ""),b.get_text() if b else "",img)
        time.sleep(0.2)
    return out

def post(url,data,**kw):
    for i in range(6):
        try:
            r=requests.post(url,data=data,headers=UA,timeout=40)
            if r.status_code==200 and r.text.strip(): return r
        except Exception: pass
        time.sleep(3+i*3)
    return None
def seven():
    import concurrent.futures as cf
    tabs={1:"1+1",2:"2+1",3:"덤증정",4:"할인"}; t0=time.time(); LIMIT=1500
    def tabrun(tab):
        out=[]; last=None; fails=0; label=tabs[tab]; partial=False
        for page in range(1,150):
            if time.time()-t0>LIMIT: partial=True; break
            r=post("https://www.7-eleven.co.kr/product/listMoreAjax.asp",{"intPageSize":10,"intCurrPage":page,"pTab":tab})
            if r is None:
                fails+=1
                if fails>8: partial=True; break
                continue
            s=BeautifulSoup(r.text,"html.parser"); items=[li for li in s.select("li") if li.select_one(".infowrap .name")]
            if not items: break
            sig=tuple(li.select_one(".infowrap .name").get_text() for li in items)
            if sig==last: break
            last=sig
            for li in items:
                n=li.select_one(".infowrap .name"); p=li.select_one(".price span"); im=li.select_one("img"); tg=li.select_one(".tag_list_01 li")
                img=im["src"] if im else None
                if img and img.startswith("/"): img="https://www.7-eleven.co.kr"+img
                gift=None
                if tab==3:
                    gn=[x.get("alt") for x in li.select("img") if x is not im and x.get("alt")]
                    gift=("증정품: "+", ".join(gn)) if gn else "덤 증정 상품 (증정품은 매장 확인)"
                add(out,"7-Eleven",n.get_text(),price(p.get_text() if p else ""),tg.get_text() if tg else label,img,gift)
            print("7-Eleven tab",tab,"page",page,len(out),flush=True)
        return out,partial
    res=list(cf.ThreadPoolExecutor(4).map(tabrun,tabs))
    global SEVEN_PARTIAL; SEVEN_PARTIAL=any(p for _,p in res)
    return [x for o,_ in res for x in o]

def emart():
    out=[]
    for page in range(1,100):
        r=requests.get("https://emart24.co.kr/goods/event",params={"page":page,"base_category_seq":5},headers=UA,timeout=20)
        s=BeautifulSoup(r.text,"html.parser"); items=s.select("div.itemWrap")
        if not items: break
        sig=tuple(w.get_text()[:80] for w in items)
        if sig==globals().get("_last"): break
        globals()["_last"]=sig
        for w in items:
            n=w.select_one(".itemtitle a"); p=w.select_one("a.price"); im=w.select_one(".itemSpImg img")
            tags=" ".join(x.get_text() for x in w.select(".itemTit span") if x.get("style","").find("opacity: 0")<0)
            add(out,"emart24",n.get_text() if n else "",price(p.get_text() if p else ""),tags,im["src"] if im else None,drink_hint=True)
        time.sleep(0.2)
    return out

def gs25():
    from playwright.sync_api import sync_playwright
    out=[]
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(user_agent=UA["User-Agent"])
        pg.goto("https://gs25.gsretail.com/gscvs/ko/products/event-goods",timeout=45000)
        tok=pg.evaluate("()=>{const e=document.querySelector('input[name=CSRFToken]');return e?e.value:(window.ACC&&ACC.config&&ACC.config.CSRFToken)||null}")
        if not tok: raise RuntimeError("GS25 공식 홈페이지 행사상품 페이지가 오류(500/api-error)로 응답. 2026년 9월부터 행사 목록이 우리동네GS 앱 전용으로 전환된 것으로 보임")
        for kind in ["ONE_TO_ONE","TWO_TO_ONE","GIFT"]:
            for page in range(1,200):
                t=pg.evaluate("""async([tok,kind,page])=>{const r=await fetch('/gscvs/ko/products/event-goods-search?CSRFToken='+tok,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'pageNum='+page+'&pageSize=50&searchType=&searchWord=&parameterList='+kind});return await r.text()}""",[tok,kind,page])
                d=json.loads(t)
                if isinstance(d,str): d=json.loads(d)
                res=d.get("results",[])
                if not res: break
                for x in res:
                    gift=None
                    if kind=="GIFT": gift=("증정: "+x.get("giftGoodsNm","")) if x.get("giftGoodsNm") else "덤 증정"
                    add(out,"GS25",x.get("goodsNm",""),int(x.get("price") or 0) or None,{"ONE_TO_ONE":"1+1","TWO_TO_ONE":"2+1","GIFT":"덤증정"}[kind],x.get("attFileNm"),gift)
                if page>=d.get("pagination",{}).get("numberOfPages",1): break
        b.close()
    return out

if __name__=="__main__":
    import sys
    only=sys.argv[1:]
    data={"updated":datetime.datetime.now().strftime("%Y-%m-%d %H:%M KST"),"items":[],"status":{}}
    if only:
        old=json.load(open("data.json",encoding="utf-8"))
        data["items"]=[x for x in old["items"] if x["chain"] not in only]; data["status"]={k:v for k,v in old["status"].items() if k not in only}
    for chain,f in [("CU",cu),("GS25",gs25),("7-Eleven",seven),("emart24",emart)]:
        if only and chain not in only: continue
        try:
            r=f(); seen=set(); r=[x for x in r if not ((k:=(x["name"],x["promo"])) in seen or seen.add(k))]
            data["items"]+=r; data["status"][chain]={"ok":True,"count":len(r)}
            if chain=="7-Eleven" and globals().get("SEVEN_PARTIAL"): data["status"][chain]["note"]="서버 응답 지연/끊김으로 일부 페이지만 수집됨"
        except Exception as e:
            data["status"][chain]={"ok":False,"count":0,"error":str(e)[:200]}
        print(chain,data["status"][chain])
    # 깨진 이미지 URL 제거 (가짜 이미지로 대체하지 않음)
    import concurrent.futures as cf
    def chk(x):
        try:
            if x["image"] and requests.head(x["image"],headers=UA,timeout=10,allow_redirects=True).status_code>=400: x["image"]=None
        except Exception: pass
    with cf.ThreadPoolExecutor(16) as ex: list(ex.map(chk,data["items"]))
    json.dump(data,open("data.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
    # file:// 로 열어도 동작하도록 data.js 동시 생성
    open("data.js","w",encoding="utf-8").write("window.DRINK_DATA="+json.dumps(data,ensure_ascii=False)+";")
