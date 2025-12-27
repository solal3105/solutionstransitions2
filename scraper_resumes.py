from __future__ import annotations

import json
import os
import unicodedata
from typing import Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://solutionstransitions.fr/"
FICHES_URL = urljoin(BASE_URL, "les-fiches/")
RESSOURCES_URL = urljoin(BASE_URL, "les-ressources/")
FAQ_URL = urljoin(BASE_URL, "faq/")


def fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def normalize_text(s: str) -> str:
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()


def extract_fiche_links() -> list[dict]:
    soup = fetch(FICHES_URL)
    links: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/portfolio/" in href:
            full = urljoin(BASE_URL, href)
            links[full] = a.get_text(strip=True) or full
    fiches = []
    for url, title in links.items():
        slug = url.rstrip("/").split("/")[-1]
        fiches.append({"url": url, "slug": slug, "title": title})
    return fiches


def extract_ressource_links() -> list[dict]:
    soup = fetch(RESSOURCES_URL)
    links: dict[str, str] = {}
    for a in soup.find_all("a", href=True):
        href = a["href"]
        full = urljoin(BASE_URL, href)
        if not full.startswith(BASE_URL):
            continue
        path = full.removeprefix(BASE_URL)
        if path in {"", "/", "les-fiches/", "les-ressources/", "les-ressources-2/", "le-projet/", "faq/", "contact/"}:
            continue
        if path.startswith("tag/"):
            continue
        text = a.get_text(strip=True) or full
        links[full] = text
    ressources = []
    for url, title in links.items():
        slug = url.rstrip("/").split("/")[-1]
        ressources.append({"url": url, "slug": slug, "title": title})
    return ressources


def extract_pdf_url(soup: BeautifulSoup) -> Optional[str]:
    for a in soup.find_all("a", href=True):
        text = (a.get_text() or "").strip()
        href = a["href"]
        if "?pdf=" in href or "Télécharger la fiche" in text or "Télécharger" in text:
            return urljoin(BASE_URL, href)
    return None


def extract_summary_content(soup: BeautifulSoup) -> dict:
    # Titre
    h1 = soup.find("h1")
    title = h1.get_text(strip=True) if h1 else ""

    article = soup.find("article") or soup

    # Récupérer tous les blocs de texte de base
    blocks: list[str] = []
    for tag in article.find_all(["p", "li"]):
        text = tag.get_text(" ", strip=True)
        if text:
            blocks.append(text)

    # Chercher un bloc qui contient "en résumé"
    summary_blocks: list[str] = []
    summary_index = None
    for idx, block in enumerate(blocks):
        norm = normalize_text(block)
        if "en resume" in norm:
            summary_index = idx
            break

    if summary_index is not None:
        # On prend quelques blocs qui suivent le titre de résumé
        for b in blocks[summary_index + 1 : summary_index + 1 + 8]:
            summary_blocks.append(b)
    else:
        # Fallback : premiers paragraphes
        summary_blocks = blocks[:5]

    resume = " ".join(summary_blocks) if summary_blocks else ""

    return {
        "title": title,
        "resume": resume,
        "paragraphs": summary_blocks,
    }


def scrape_fiches(output_path: str = "doc/fiches.json") -> None:
    fiches_meta = extract_fiche_links()
    results = []
    for meta in fiches_meta:
        url = meta["url"]
        print(f"Scraping fiche {url}...")
        soup = fetch(url)
        data = extract_summary_content(soup)
        pdf_url = extract_pdf_url(soup)
        fiche = {
            "slug": meta["slug"],
            "url": url,
            "title": data["title"] or meta["title"],
            "resume": data["resume"],
            "paragraphs": data["paragraphs"],
            "pdf_url": pdf_url,
        }
        results.append(fiche)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(results)} fiches to {output_path}")


def scrape_ressources(output_path: str = "doc/ressources.json") -> None:
    ressources_meta = extract_ressource_links()
    results = []
    for meta in ressources_meta:
        url = meta["url"]
        print(f"Scraping ressource {url}...")
        try:
            soup = fetch(url)
        except requests.HTTPError as exc:
            print(f"  HTTP error, skip: {exc}")
            continue
        data = extract_summary_content(soup)
        pdf_url = extract_pdf_url(soup)
        res = {
            "slug": meta["slug"],
            "url": url,
            "title": data["title"] or meta["title"],
            "resume": data["resume"],
            "paragraphs": data["paragraphs"],
            "pdf_url": pdf_url,
        }
        results.append(res)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(results)} ressources to {output_path}")


def scrape_single_page(url: str, slug: str, output_path: str) -> None:
    print(f"Scraping page {url}...")
    soup = fetch(url)
    data = extract_summary_content(soup)
    page = {
        "slug": slug,
        "url": url,
        "title": data["title"] or slug,
        "resume": data["resume"],
        "paragraphs": data["paragraphs"],
        "pdf_url": None,
    }
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(page, f, ensure_ascii=False, indent=2)
    print(f"Saved page {slug} to {output_path}")


if __name__ == "__main__":
    scrape_fiches()
    scrape_ressources()
    scrape_single_page(FAQ_URL, "faq", "doc/faq.json")
    scrape_single_page(BASE_URL, "home", "doc/home.json")
