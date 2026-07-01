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
# NB : /les-ressources/ redirige (301) vers /les-ressources-2/ qui est l'URL canonique
RESSOURCES_URL = urljoin(BASE_URL, "les-ressources-2/")
FAQ_URL = urljoin(BASE_URL, "faq/")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; SolutionsTransitionsBot/1.0; +https://solutionstransitions.fr/)"
}

# Le site utilise le thème WordPress "Impreza" : pas de <article> ni de
# .entry-content. Le contenu vit dans des <div> imbriquées (uncol/uncell/…),
# et l'en-tête/menu/pied de page pollue le texte si on ne les retire pas.
STRIP_SELECTORS = [
    "#page-header",
    "header",
    "footer",
    "nav",
    "script",
    "style",
    "noscript",
    "form",
    ".w-form",
]

# Conteneurs des grilles de cartes (listings fiches / ressources).
GRID_SELECTORS = [".grid-container", ".isotope-container"]

# Slugs de navigation/catégories à ne jamais considérer comme des documents.
NON_DOC_SLUGS = {
    "",
    "les-fiches",
    "les-ressources",
    "les-ressources-2",
    "le-projet",
    "faq",
    "contact",
    "comprendre-3",
    "organiser-3",
    "agir-3",
    "allo-transition",
    "assistant-ia-solutions-transitions",
}

# Longueur cible du résumé. On coupe au paragraphe près (jamais en plein milieu
# d'un bloc) : assez pour router vers la fiche et répondre de façon fondée, sans
# gonfler chat.js ni le contexte envoyé au LLM.
MAX_RESUME_CHARS = 3000

# Blocs récurrents (CTA, navigation inter-fiches, newsletter…) qui marquent la
# fin du contenu utile d'une page.
STOP_MARKERS = [
    "nous sommes a votre ecoute",
    "ce contenu vous fait reagir",
    "precedent",
    "suivant",
    "besoin d aide",
    "rejoignez la liste des abonnes",
    "recevez nos dernieres actualites",
    "parcourez nos fiches",
    "votre adresse e-mail",
    "en savoir plus sur comment les donnees",
]


def fetch(url: str) -> BeautifulSoup:
    resp = requests.get(url, timeout=20, headers=HEADERS)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def normalize_text(s: str) -> str:
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower().strip()


def _grid_or_document(soup: BeautifulSoup):
    """Retourne les conteneurs de grille du listing, ou tout le document en
    dernier recours (si la structure du thème change)."""
    grids = []
    for sel in GRID_SELECTORS:
        grids.extend(soup.select(sel))
    return grids or [soup]


def extract_fiche_links() -> list[dict]:
    """URLs des fiches depuis la page de listing (liens /portfolio/)."""
    soup = fetch(FICHES_URL)
    links: dict[str, str] = {}
    for container in _grid_or_document(soup):
        for a in container.find_all("a", href=True):
            href = a["href"]
            if "/portfolio/" not in href:
                continue
            full = urljoin(BASE_URL, href)
            links.setdefault(full, a.get_text(strip=True) or full)
    return [
        {"url": url, "slug": url.rstrip("/").split("/")[-1], "title": title}
        for url, title in links.items()
    ]


def extract_ressource_links() -> list[dict]:
    """URLs des ressources depuis la grille du listing (cartes), en excluant
    les liens de navigation / catégories."""
    soup = fetch(RESSOURCES_URL)
    links: dict[str, str] = {}
    for container in _grid_or_document(soup):
        for a in container.find_all("a", href=True):
            full = urljoin(BASE_URL, a["href"])
            if not full.startswith(BASE_URL):
                continue
            path = full.removeprefix(BASE_URL).strip("/")
            # On ne garde que les pages "ressource" (un seul segment d'URL).
            if not path or "/" in path:
                continue
            if path in NON_DOC_SLUGS or path.startswith("tag"):
                continue
            links.setdefault(full, a.get_text(strip=True) or full)
    return [
        {"url": url, "slug": url.rstrip("/").split("/")[-1], "title": title}
        for url, title in links.items()
    ]


def extract_pdf_url(soup: BeautifulSoup) -> Optional[str]:
    """URL du PDF téléchargeable. On privilégie un lien direct vers un .pdf,
    sinon le lien d'impression ?pdf= / le bouton "Télécharger"."""
    fallback: Optional[str] = None
    for a in soup.find_all("a", href=True):
        href = a["href"]
        full = urljoin(BASE_URL, href)
        # On ignore les PDF externes (sources citées dans le contenu).
        if not full.startswith(BASE_URL):
            continue
        text = (a.get_text() or "").strip()
        # Lien direct vers le fichier PDF interne : on le privilégie.
        if ".pdf" in href.lower():
            return full
        if "?pdf=" in href or "Télécharger" in text:
            fallback = fallback or full
    return fallback


def extract_summary_content(soup: BeautifulSoup) -> dict:
    """Titre + contenu utile d'une page, en retirant menu/en-tête/pied de page
    et en coupant les blocs récurrents (CTA, newsletter…)."""
    # Le titre (h1) est dans #page-header : on le récupère AVANT le nettoyage.
    h1 = soup.find("h1")
    title = h1.get_text(" ", strip=True) if h1 else ""

    for sel in STRIP_SELECTORS:
        for el in soup.select(sel):
            el.decompose()

    blocks: list[str] = []
    for tag in soup.find_all(["p", "li"]):
        text = tag.get_text(" ", strip=True)
        if text:
            blocks.append(text)

    # On s'arrête au premier bloc "boilerplate".
    content: list[str] = []
    for b in blocks:
        nb = normalize_text(b)
        if any(nb == m or nb.startswith(m) for m in STOP_MARKERS):
            break
        content.append(b)

    # Déduplication en conservant l'ordre.
    seen: set[str] = set()
    deduped: list[str] = []
    for b in content:
        if b not in seen:
            seen.add(b)
            deduped.append(b)

    # Plafonnement au paragraphe près (on garde toujours au moins le 1er bloc).
    paragraphs: list[str] = []
    total = 0
    for b in deduped:
        if paragraphs and total + len(b) > MAX_RESUME_CHARS:
            break
        paragraphs.append(b)
        total += len(b)

    return {
        "title": title,
        "resume": " ".join(paragraphs),
        "paragraphs": paragraphs,
    }


def scrape_fiches(output_path: str = "doc/fiches.json") -> None:
    results = []
    for meta in extract_fiche_links():
        url = meta["url"]
        print(f"Scraping fiche {url}...")
        try:
            soup = fetch(url)
        except requests.HTTPError as exc:
            print(f"  HTTP error, skip: {exc}")
            continue
        pdf_url = extract_pdf_url(soup)
        data = extract_summary_content(soup)
        results.append(
            {
                "slug": meta["slug"],
                "url": url,
                "title": data["title"] or meta["title"],
                "resume": data["resume"],
                "paragraphs": data["paragraphs"],
                "pdf_url": pdf_url,
            }
        )

    _dump(results, output_path)
    print(f"Saved {len(results)} fiches to {output_path}")


def scrape_ressources(output_path: str = "doc/ressources.json") -> None:
    results = []
    for meta in extract_ressource_links():
        url = meta["url"]
        print(f"Scraping ressource {url}...")
        try:
            soup = fetch(url)
        except requests.HTTPError as exc:
            print(f"  HTTP error, skip: {exc}")
            continue
        pdf_url = extract_pdf_url(soup)
        data = extract_summary_content(soup)
        results.append(
            {
                "slug": meta["slug"],
                "url": url,
                "title": data["title"] or meta["title"],
                "resume": data["resume"],
                "paragraphs": data["paragraphs"],
                "pdf_url": pdf_url,
            }
        )

    _dump(results, output_path)
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
    _dump(page, output_path)
    print(f"Saved page {slug} to {output_path}")


def _dump(data, output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    scrape_fiches()
    scrape_ressources()
    scrape_single_page(FAQ_URL, "faq", "doc/faq.json")
    scrape_single_page(BASE_URL, "home", "doc/home.json")
