# -*- coding: utf-8 -*-
import sys
import json
import urllib.parse
import requests
from bs4 import BeautifulSoup

# Ensure stdout uses UTF-8 to prevent encoding crashes on Windows console output
sys.stdout.reconfigure(encoding='utf-8')

def scrape_duckduckgo(query):
    results = []
    url = "https://html.duckduckgo.com/html/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.3"
    }
    try:
        # Pass kp=-2 to ensure SafeSearch is completely disabled (unrestricted search results)
        response = requests.post(url, data={"q": query, "kp": "-2"}, headers=headers, timeout=8)
        sys.stderr.write(f"DDG Status: {response.status_code}, Length: {len(response.text)}\n")
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            for item in soup.find_all("div", class_="result"):
                title_a = item.find("a", class_="result__a")
                snippet_a = item.find("a", class_="result__snippet")
                if title_a and snippet_a:
                    title = title_a.text.strip()
                    link = title_a["href"]
                    # Clean DuckDuckGo redirect link
                    if "uddg=" in link:
                        link = urllib.parse.unquote(link.split("uddg=")[1].split("&")[0])
                    snippet = snippet_a.text.strip()
                    results.append({
                        "title": title,
                        "url": link,
                        "content": snippet
                    })
    except Exception as e:
        sys.stderr.write(f"DDG Error: {str(e)}\n")
    return results

def scrape_google(query):
    results = []
    # Add safe=off to disable SafeSearch on Google fallback
    url = "https://www.google.com/search?q=" + urllib.parse.quote(query) + "&gbv=1&safe=off"
    headers = {
        "User-Agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)"
    }
    try:
        response = requests.get(url, headers=headers, timeout=8)
        sys.stderr.write(f"Google Status: {response.status_code}, Length: {len(response.text)}\n")
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, "html.parser")
            for h3 in soup.find_all("h3"):
                parent_a = h3.find_parent("a")
                if parent_a:
                    href = parent_a.get("href", "")
                    if href.startswith("/url?q="):
                        link = urllib.parse.unquote(href.split("/url?q=")[1].split("&")[0])
                    else:
                        link = href
                    title = h3.text.strip()
                    
                    # Look for adjacent snippet container
                    snippet = ""
                    container = h3.find_parent("div")
                    if container:
                        for span in container.find_all(["span", "div"]):
                            txt = span.text.strip()
                            if len(txt) > 30 and txt != title and not txt.startswith("http"):
                                snippet = txt
                                break
                    
                    results.append({
                        "title": title,
                        "url": link,
                        "content": snippet or title
                    })
    except Exception as e:
        sys.stderr.write(f"Google Error: {str(e)}\n")
    return results

def main():
    if len(sys.argv) < 2:
        print(json.dumps([]))
        return

    query = " ".join(sys.argv[1:])
    
    # Try DuckDuckGo first (faster, reliable HTML API)
    results = scrape_duckduckgo(query)
    
    # Fallback to Google basic HTML if DuckDuckGo failed to return results
    if not results:
        results = scrape_google(query)
        
    # Guarantee at least something is returned if both fail completely
    if not results:
        results = [{
            "title": "Search Engine Notice",
            "url": "https://duckduckgo.com/?q=" + urllib.parse.quote(query),
            "content": f"No direct search results returned for query: '{query}'. Please check your network connection."
        }]
        
    print(json.dumps(results[:10], ensure_ascii=False))

if __name__ == "__main__":
    main()
