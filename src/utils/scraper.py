#!/usr/bin/env python3
"""
src/utils/scraper.py — Async web search and content scraper

Based on the working async pipeline (misc/scrap.py) using:
  - aiohttp     → async HTTP (no system proxy by default, unlike requests)
  - BeautifulSoup4 → HTML parsing (per bs4 docs: get_text, decompose, find_all)
  - readability → smart main-content extraction (like browser reader-mode)

MODES:
  python3 scraper.py search "spring 2026 anime"
    → searches DDG (POST), fetches top pages concurrently, extracts content
    → prints JSON: [{url, content}, ...]

  python3 scraper.py scrape "https://example.com"
    → fetches a single URL, extracts main content
    → prints plain text

  python3 scraper.py test
    → connectivity check for all search engines

SEARCH STRATEGY:
  Primary:  DuckDuckGo HTML via POST (html.duckduckgo.com/html/)
            POST bypasses the bot-challenge that GET requests receive.
            Selector: a.result__a
  Fallback: Bing HTML via GET (proven working, HTTP 200)
            Selector: li.b_algo h2 a

DEPENDENCIES (install once):
  pip install aiohttp beautifulsoup4 readability-lxml lxml
"""

import asyncio
import sys
import json
import re
import os

try:
    import aiohttp
    from bs4 import BeautifulSoup
    from readability import Document
except ImportError as e:
    pkg = str(e).replace("No module named '", "").rstrip("'")
    print(
        f"SCRAPER_ERROR: Missing package '{pkg}'.\n"
        f"Run: pip install aiohttp beautifulsoup4 readability-lxml lxml",
        file=sys.stderr
    )
    sys.exit(1)

# Force stdout to UTF-8 so Windows CP1252 doesn't crash on non-ASCII chars
# (Japanese titles, en-dashes, curly quotes etc. are common in anime content)
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# ── Config ────────────────────────────────────────────────────────────────────

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "DNT":             "1",
}

TIMEOUT      = aiohttp.ClientTimeout(total=15, connect=8)
MAX_RESULTS  = 2   # pages to fetch and scrape (top 2 most relevant)
CONTENT_LIMIT = 2000  # chars per page (keeps AI prompt budget reasonable)


# ════════════════════════════════════════════════════════════════════
#  CONTENT EXTRACTOR
# ════════════════════════════════════════════════════════════════════

def extract_content(html: str) -> str:
    """
    Extract main article content from raw HTML using readability.
    readability.Document mimics browser reader-mode: strips nav, ads, sidebars,
    footers and returns just the main body text.

    Falls back to raw BS4 get_text() if readability fails.
    Per BS4 docs: get_text(separator, strip=True) is the canonical extraction method.
    """
    if not html or len(html) < 100:
        return ""

    # Primary: readability smart extraction
    try:
        doc     = Document(html)
        cleaned = doc.summary()           # returns simplified HTML of main content
        soup    = BeautifulSoup(cleaned, "lxml")

        # Strip any remaining script/style tags readability may have kept
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()

        # Per BS4 docs: canonical way to extract all visible text
        text = soup.get_text(separator=" ", strip=True)
        text = re.sub(r"\s{2,}", " ", text).strip()

        if len(text) > 150:  # readability succeeded and got real content
            return text[:CONTENT_LIMIT]
    except Exception:
        pass

    # Fallback: manual BS4 stripping
    try:
        soup = BeautifulSoup(html, "lxml")
        for tag in soup(["script", "style", "nav", "header", "footer",
                         "aside", "noscript", "iframe", "form"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        text = re.sub(r"\s{2,}", " ", text).strip()
        return text[:CONTENT_LIMIT]
    except Exception:
        return ""


# ════════════════════════════════════════════════════════════════════
#  ASYNC FETCH
# ════════════════════════════════════════════════════════════════════

async def fetch_page(session: aiohttp.ClientSession, url: str) -> str | None:
    """
    Fetch a single page. Returns raw HTML string or None on failure.
    """
    try:
        async with session.get(url, headers=HEADERS, timeout=TIMEOUT,
                               allow_redirects=True, ssl=False) as resp:
            if resp.status >= 400:
                return None
            return await resp.text(errors="replace")
    except asyncio.TimeoutError:
        print(f"[scraper] Timeout: {url}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[scraper] Fetch error {url}: {type(e).__name__}", file=sys.stderr)
        return None


# ════════════════════════════════════════════════════════════════════
#  SEARCH ENGINES
# ════════════════════════════════════════════════════════════════════

async def search_ddg(session: aiohttp.ClientSession, query: str) -> list[str]:
    """
    DuckDuckGo HTML search via POST.

    CRITICAL: DDG must be accessed via POST to html.duckduckgo.com/html/
    GET requests receive a JavaScript bot-challenge page (HTTP 202).
    POST with form data {"q": query} returns the real HTML results page.

    Selector: a.result__a  (stable across DDG HTML versions)
    """
    try:
        async with session.post(
            "https://html.duckduckgo.com/html/",
            headers=HEADERS,
            data={"q": query},
            timeout=TIMEOUT,
        ) as resp:
            if resp.status >= 400:
                raise Exception(f"HTTP {resp.status}")
            html = await resp.text(errors="replace")

        soup  = BeautifulSoup(html, "lxml")
        links = []

        for a in soup.select("a.result__a"):
            href = a.get("href", "")
            # DDG redirects via /l/?uddg= — extract the real URL
            if "duckduckgo.com/l/" in href:
                match = re.search(r"uddg=([^&]+)", href)
                href  = match.group(1) if match else href
                import urllib.parse
                href  = urllib.parse.unquote(href)
            if href.startswith("http"):
                links.append(href)
            if len(links) >= MAX_RESULTS:
                break

        return links

    except Exception as e:
        print(f"[scraper] DDG POST error: {e}", file=sys.stderr)
        return []


async def search_bing(session: aiohttp.ClientSession, query: str) -> list[str]:
    """
    Bing HTML search fallback (confirmed working: HTTP 200).
    Selector: li.b_algo h2 a
    """
    import urllib.parse
    try:
        url = f"https://www.bing.com/search?q={urllib.parse.quote_plus(query)}&setlang=en&cc=US"
        async with session.get(url, headers=HEADERS, timeout=TIMEOUT, ssl=False) as resp:
            html = await resp.text(errors="replace")

        soup  = BeautifulSoup(html, "lxml")
        links = []

        for block in soup.find_all("li", class_="b_algo"):
            h2 = block.find("h2")
            a  = h2.find("a", href=True) if h2 else None
            if a and a["href"].startswith("http"):
                links.append(a["href"])
            if len(links) >= MAX_RESULTS:
                break

        return links

    except Exception as e:
        print(f"[scraper] Bing error: {e}", file=sys.stderr)
        return []


# ════════════════════════════════════════════════════════════════════
#  MAIN SEARCH PIPELINE
# ════════════════════════════════════════════════════════════════════

async def run_search(query: str) -> list[dict]:
    """
    Full pipeline:
      1. Search DDG via POST → get URLs
      2. Fallback to Bing if DDG returns nothing
      3. Fetch all pages concurrently with asyncio.gather
      4. Extract content from each page with readability
      5. Return [{url, content}, ...]
    """
    # aiohttp TCPConnector — does NOT use system proxy by default
    connector = aiohttp.TCPConnector(ssl=False, limit=10)
    async with aiohttp.ClientSession(connector=connector) as session:

        # Step 1: Get URLs from search engines
        links = await search_ddg(session, query)

        if not links:
            print(f"[scraper] DDG empty, trying Bing", file=sys.stderr)
            links = await search_bing(session, query)

        if not links:
            print(f"[scraper] All engines failed for: {query}", file=sys.stderr)
            return []

        print(f"[scraper] Found {len(links)} URLs, fetching concurrently...", file=sys.stderr)

        # Step 2: Fetch all pages concurrently
        pages = await asyncio.gather(*[fetch_page(session, link) for link in links])

        # Step 3: Extract content from each page
        results = []
        for link, html in zip(links, pages):
            if not html:
                continue
            content = extract_content(html)
            if content and len(content) > 100:
                results.append({"url": link, "content": content})
                print(f"[scraper] ✓ {link[:70]}", file=sys.stderr)

        return results


async def run_scrape(url: str) -> str:
    """Fetch and extract content from a single URL."""
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        html = await fetch_page(session, url)
        if not html:
            return ""
        return extract_content(html)


# ════════════════════════════════════════════════════════════════════
#  CONNECTIVITY TEST
# ════════════════════════════════════════════════════════════════════

async def run_test():
    """Test connectivity to search engines."""
    import urllib.parse
    print(f"aiohttp: {aiohttp.__version__}")
    print(f"readability: available ✅")
    print()

    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:

        # Test DDG POST
        print("Testing DDG POST (the method that actually works)...")
        try:
            async with session.post(
                "https://html.duckduckgo.com/html/",
                headers=HEADERS, data={"q": "test"}, timeout=TIMEOUT
            ) as resp:
                ct   = resp.headers.get("content-type","")
                html = await resp.text()
                soup = BeautifulSoup(html, "lxml")
                results = soup.select("a.result__a")
                print(f"  DDG POST: HTTP {resp.status}, {len(html):,} chars, {len(results)} result links found")
        except Exception as e:
            print(f"  DDG POST: ✗ {e}")

        # Test GET engines
        for name, url in [
            ("Bing",      "https://www.bing.com/search?q=test"),
            ("Mojeek",    "https://www.mojeek.com/search?q=test"),
            ("Brave",     "https://search.brave.com/search?q=test&source=web"),
            ("Startpage", "https://www.startpage.com/search?q=test"),
        ]:
            try:
                async with session.get(url, headers=HEADERS, timeout=TIMEOUT, ssl=False) as resp:
                    ct = resp.headers.get("content-type","")[:40]
                    print(f"  {name} GET: HTTP {resp.status}, {resp.content_length or '?'} bytes, {ct}")
            except Exception as e:
                print(f"  {name} GET: ✗ {type(e).__name__}")


# ════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 scraper.py [search|scrape|test] [query|url]", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1].lower()

    if mode == "test":
        asyncio.run(run_test())

    elif mode == "search":
        if len(sys.argv) < 3:
            print("Usage: python3 scraper.py search <query>", file=sys.stderr)
            sys.exit(1)
        results = asyncio.run(run_search(sys.argv[2]))
        print(json.dumps(results, ensure_ascii=False, indent=2))

    elif mode == "scrape":
        if len(sys.argv) < 3:
            print("Usage: python3 scraper.py scrape <url>", file=sys.stderr)
            sys.exit(1)
        content = asyncio.run(run_scrape(sys.argv[2]))
        print(content)

    else:
        print(f"Unknown mode '{mode}'. Use: search, scrape, test", file=sys.stderr)
        sys.exit(1)
