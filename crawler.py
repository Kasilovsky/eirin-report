import json, feedparser, requests, os, re, time
from datetime import datetime

OUTPUT_FILE = 'data/news.json'
HEADERS = {'User-Agent': 'Mozilla/5.0'}

def translate_to_chinese(text):
    """返回中文翻译，失败则返回原文"""
    if not text or len(text.strip()) == 0:
        return text
    segment = text[:500]
    try:
        url = "https://api.mymemory.translated.net/get"
        params = {"q": segment, "langpair": "en|zh-CN"}
        resp = requests.get(url, params=params, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        translated = data.get("responseData", {}).get("translatedText", segment)
        if len(translated) < len(segment) * 0.3 and len(segment) > 20:
            return text
        return translated + text[500:]
    except Exception as e:
        print(f"翻译失败: {e}")
        return text

def fetch_nejm():
    url = 'https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm'
    feed = feedparser.parse(url)
    articles = []
    for entry in feed.entries[:5]:
        raw = entry.summary if hasattr(entry,'summary') else ''
        citation_match = re.search(r'(N Engl J Med \d{4};?\s*\d+:\d+[-–]\d+)', raw)
        citation = citation_match.group(1) if citation_match else ''
        clean = re.sub(r'<[^>]+>', '', raw)
        summary_en = clean.replace(citation, '').strip()

        title_en = entry.title
        title_zh = translate_to_chinese(title_en)
        summary_zh = translate_to_chinese(summary_en[:300]) if summary_en else ''

        articles.append({
            'category': '最新研究',
            'title_en': title_en,
            'title_zh': title_zh,
            'summary_en': summary_en[:300] + ('...' if len(summary_en)>300 else ''),
            'summary_zh': summary_zh + ('...' if summary_zh else ''),
            'source': 'NEJM',
            'citation': citation,
            'link': entry.link
        })
        time.sleep(0.5)
    return articles

def fetch_pubmed():
    base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
    params = {
        'db': 'pubmed',
        'term': '("2026"[Date - Publication] : "3000"[Date - Publication]) AND ("N Engl J Med"[Jour] OR "Lancet"[Jour] OR "JAMA"[Jour])',
        'retmax': 5,
        'sort': 'pub_date',
        'retmode': 'json'
    }
    try:
        resp = requests.get(base+'esearch.fcgi', params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        ids = resp.json()['esearchresult']['idlist']
        if not ids:
            return []
        sum_params = {'db':'pubmed','id':','.join(ids),'retmode':'json'}
        sum_resp = requests.get(base+'esummary.fcgi', params=sum_params, headers=HEADERS, timeout=15)
        sum_resp.raise_for_status()
        results = sum_resp.json()['result']
        articles = []
        for pid in ids:
            p = results.get(pid, {})
            title_en = p.get('title','未知')
            title_zh = translate_to_chinese(title_en)
            source = p.get('source', '')
            volume = p.get('volume', '')
            issue = p.get('issue', '')
            pages = p.get('pages', '')
            pubdate = p.get('pubdate', '')
            citation = f"{source}. {pubdate}; {volume}({issue}):{pages}" if source and volume else ''
            articles.append({
                'category': '權威期刊',
                'title_en': title_en,
                'title_zh': title_zh,
                'summary_en': '',
                'summary_zh': '',
                'source': 'PubMed',
                'citation': citation,
                'link': f'https://pubmed.ncbi.nlm.nih.gov/{pid}/'
            })
            time.sleep(0.5)
        return articles
    except Exception as e:
        print(f'PubMed error: {e}')
        return []

def main():
    all_articles = []
    all_articles.extend(fetch_nejm())
    all_articles.extend(fetch_pubmed())
    if not all_articles:
        all_articles.append({
            'category': '系統訊息',
            'title_en': 'No news available',
            'title_zh': '今日無自動抓取之新聞',
            'summary_en': 'Please try later.',
            'summary_zh': '請稍後再試。',
            'source': '永遠亭',
            'citation': '',
            'link': ''
        })
    os.makedirs('data', exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({'date': datetime.now().strftime('%Y-%m-%d'), 'articles': all_articles}, f, ensure_ascii=False, indent=2)
    print(f'✅ 翻譯並保存 {len(all_articles)} 條新聞')

if __name__ == '__main__':
    main()
