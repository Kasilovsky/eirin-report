import json, feedparser, requests, os, re
from datetime import datetime

OUTPUT_FILE = 'data/news.json'
HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

def fetch_nejm():
    url = 'https://www.nejm.org/action/showFeed?type=etoc&feed=rss&jc=nejm'
    feed = feedparser.parse(url)
    articles = []
    for entry in feed.entries[:5]:
        raw = entry.summary if hasattr(entry,'summary') else ''
        clean = re.sub(r'<[^>]+>', '', raw)[:200]
        articles.append({
            'category': '最新研究',
            'title': entry.title,
            'summary': clean + '...',
            'source': 'NEJM',
            'link': entry.link   # NEJM 文章原始链接
        })
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
            articles.append({
                'category': '權威期刊',
                'title': p.get('title','未知'),
                'summary': f"{p.get('source','')} ({p.get('pubdate','')})",
                'source': 'PubMed',
                'link': f'https://pubmed.ncbi.nlm.nih.gov/{pid}/'
            })
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
            'title': '今日無自動抓取之新聞',
            'summary': '請稍後再試。',
            'source': '永遠亭',
            'link': ''
        })
    os.makedirs('data', exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({'date': datetime.now().strftime('%Y-%m-%d'), 'articles': all_articles}, f, ensure_ascii=False, indent=2)
    print(f'OK, {len(all_articles)} articles')

if __name__ == '__main__':
    main()
