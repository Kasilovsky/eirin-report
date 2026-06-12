import json, requests, os, time, re
from datetime import datetime, timedelta

OUTPUT_FILE = 'data/news.json'
HEADERS = {'User-Agent': 'Mozilla/5.0'}

JOURNALS = [
    'N Engl J Med', 'Lancet', 'JAMA',
    'BMJ', 'Nature Medicine', 'Cell',
    'Science Translational Medicine'
]

MESH_CATEGORY_MAP = {
    'Cardiovascular Diseases': '心血管',
    'Heart Diseases': '心血管',
    'Hypertension': '心血管',
    'Neoplasms': '腫瘤',
    'Medical Oncology': '腫瘤',
    'Nervous System Diseases': '神經',
    'Mental Disorders': '神經',
    'Infections': '感染',
    'Communicable Diseases': '感染',
    'Respiratory Tract Diseases': '呼吸',
    'Digestive System Diseases': '消化',
    'Endocrine System Diseases': '內分泌',
    'Nutritional and Metabolic Diseases': '內分泌',
    'Immune System Diseases': '免疫',
    'Rheumatic Diseases': '風濕',
    'Musculoskeletal Diseases': '骨科',
    'Hematologic Diseases': '血液',
    'Urologic Diseases': '泌尿',
    'Renal Insufficiency': '腎臟',
    'Ophthalmology': '眼科',
    'Otolaryngology': '耳鼻喉',
    'Dermatology': '皮膚',
    'Pediatrics': '兒科',
    'Geriatrics': '老年醫學',
    'Obstetrics': '婦產',
    'Public Health': '公共衛生',
    'Epidemiology': '流行病學',
    'Pharmacology': '藥理',
    'Genetics': '遺傳',
}

def translate_to_chinese(text):
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
        print(f"翻譯失敗: {e}")
        return text

def get_departments(mesh_terms):
    departments = set()
    for term in mesh_terms:
        for key, dept in MESH_CATEGORY_MAP.items():
            if key.lower() in term.lower():
                departments.add(dept)
    return list(departments) if departments else ['綜合']

def fetch_recent_articles(days=180, max_results=100):
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days)
    mindate = start_date.strftime('%Y/%m/%d')
    maxdate = end_date.strftime('%Y/%m/%d')
    base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/'
    articles = []

    for journal in JOURNALS:
        search_term = f'"{journal}"[Journal] AND ("{mindate}"[Date - Publication] : "{maxdate}"[Date - Publication])'
        search_params = {
            'db': 'pubmed',
            'term': search_term,
            'retmax': max_results,
            'sort': 'pub_date',
            'retmode': 'json'
        }
        try:
            resp = requests.get(base + 'esearch.fcgi', params=search_params, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            id_list = resp.json().get('esearchresult', {}).get('idlist', [])
            if not id_list:
                continue
            for i in range(0, len(id_list), 20):
                batch_ids = id_list[i:i+20]
                sum_params = {
                    'db': 'pubmed',
                    'id': ','.join(batch_ids),
                    'retmode': 'json'
                }
                sum_resp = requests.get(base + 'esummary.fcgi', params=sum_params, headers=HEADERS, timeout=15)
                sum_resp.raise_for_status()
                results = sum_resp.json().get('result', {})
                for pmid in batch_ids:
                    paper = results.get(pmid, {})
                    if not paper:
                        continue
                    title_en = paper.get('title', '未知標題')
                    title_zh = translate_to_chinese(title_en)
                    pubdate = paper.get('pubdate', '')
                    try:
                        date_obj = datetime.strptime(pubdate[:10], '%Y %b %d') if pubdate else None
                    except:
                        date_obj = None

                    authors_list = paper.get('authors', [])
                    author_names = [a.get('name', '') for a in authors_list[:5]]
                    authors_str = ', '.join(author_names)

                    doi_raw = paper.get('elocationid', '')
                    doi = doi_raw.replace('doi: ', '') if doi_raw.lower().startswith('doi:') else ''
                    citation = f"{paper.get('source','')}. {pubdate}; {paper.get('volume','')}({paper.get('issue','')}):{paper.get('pages','')}"

                    mesh_terms = paper.get('meshheadings', [])
                    departments = get_departments(mesh_terms)

                    articles.append({
                        'category': '權威期刊',
                        'title_en': title_en,
                        'title_zh': title_zh,
                        'summary_en': '',
                        'summary_zh': '',
                        'source': journal,
                        'citation': citation,
                        'link': f'https://pubmed.ncbi.nlm.nih.gov/{pmid}/',
                        'date': date_obj.strftime('%Y-%m-%d') if date_obj else '',
                        'authors': authors_str,
                        'doi': doi,
                        'departments': departments
                    })
                time.sleep(0.3)
        except Exception as e:
            print(f'抓取 {journal} 時出錯: {e}')
            continue

    seen_links = set()
    unique_articles = []
    for art in articles:
        if art['link'] not in seen_links:
            seen_links.add(art['link'])
            unique_articles.append(art)
    unique_articles.sort(key=lambda x: x.get('date', ''), reverse=True)
    return unique_articles

def main():
    articles = fetch_recent_articles(days=180, max_results=100)
    if not articles:
        articles.append({
            'category': '系統訊息',
            'title_en': 'No news available',
            'title_zh': '暫無新聞',
            'summary_en': '',
            'summary_zh': '請稍後再試。',
            'source': '永遠亭',
            'citation': '',
            'link': '',
            'date': datetime.now().strftime('%Y-%m-%d'),
            'authors': '',
            'doi': '',
            'departments': ['系統']
        })
    os.makedirs('data', exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump({'date': datetime.now().strftime('%Y-%m-%d'), 'articles': articles}, f, ensure_ascii=False, indent=2)
    print(f'✅ 已保存 {len(articles)} 篇文章')

if __name__ == '__main__':
    main()
