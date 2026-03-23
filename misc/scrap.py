import asyncio
import aiohttp
from bs4 import BeautifulSoup
from readability import Document

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Accept-Language": "en-US,en;q=0.9"
}

# ---------------------------
# 🔎 SEARCH (DuckDuckGo)
# ---------------------------
async def search(session, query, max_results=5):
    url = "https://html.duckduckgo.com/html/"

    try:
        async with session.post(url, headers=HEADERS, data={"q": query}, timeout=10) as res:
            html = await res.text()

        soup = BeautifulSoup(html, "html.parser")

        links = []
        for a in soup.select("a.result__a"):
            href = a.get("href")
            if href:
                links.append(href)
            if len(links) >= max_results:
                break

        return links

    except Exception as e:
        print("Search error:", e)
        return []


# ---------------------------
# 🌐 FETCH PAGE
# ---------------------------
async def fetch(session, url):
    try:
        async with session.get(url, headers=HEADERS, timeout=10) as res:
            return await res.text()
    except Exception:
        return None


# ---------------------------
# 📄 CLEAN CONTENT
# ---------------------------
def extract_content(html):
    try:
        doc = Document(html)
        cleaned_html = doc.summary()

        soup = BeautifulSoup(cleaned_html, "html.parser")

        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()

        text = soup.get_text(separator=" ", strip=True)

        return text[:2000]  # limit
    except Exception:
        return ""


# ---------------------------
# 🔗 MAIN PIPELINE
# ---------------------------
async def scrape(query):
    async with aiohttp.ClientSession() as session:

        links = await search(session, query)

        tasks = [fetch(session, link) for link in links]
        pages = await asyncio.gather(*tasks)

        results = []

        for link, html in zip(links, pages):
            if not html:
                continue

            content = extract_content(html)

            results.append({
                "url": link,
                "content": content
            })

        return results


# ---------------------------
# ▶️ ENTRY POINT
# ---------------------------
if __name__ == "__main__":
    import sys
    query = " ".join(sys.argv[1:]) or "latest anime 2026"

    data = asyncio.run(scrape(query))

    import json
    print(json.dumps(data, indent=2))