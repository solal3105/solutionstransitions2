from __future__ import annotations

import json
import os
import re
from typing import Optional

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from openai import OpenAI

load_dotenv()

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
FICHES_PATH = os.path.join(APP_ROOT, "doc", "fiches.json")
RESSOURCES_PATH = os.path.join(APP_ROOT, "doc", "ressources.json")
FAQ_PATH = os.path.join(APP_ROOT, "doc", "faq.json")
HOME_PATH = os.path.join(APP_ROOT, "doc", "home.json")


def load_json(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_fiches() -> list[dict]:
    return load_json(FICHES_PATH)


def load_ressources() -> list[dict]:
    return load_json(RESSOURCES_PATH)


def load_page(path: str) -> Optional[dict]:
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


app = Flask(__name__)


def _build_doc_entries() -> list[dict]:
    """Construit une liste à plat de documents (fiches, ressources, FAQ, home) pour la recherche."""
    docs: list[dict] = []
    for fiche in load_fiches():
        text_parts = []
        if fiche.get("title"):
            text_parts.append(str(fiche["title"]))
        if fiche.get("resume"):
            text_parts.append(str(fiche["resume"]))
        for p in fiche.get("paragraphs", []):
            text_parts.append(str(p))
        docs.append(
            {
                "type": "fiche",
                "title": fiche.get("title", ""),
                "url": fiche.get("url", ""),
                "text": "\n".join(text_parts),
            }
        )

    for res in load_ressources():
        text_parts = []
        if res.get("title"):
            text_parts.append(str(res["title"]))
        if res.get("resume"):
            text_parts.append(str(res["resume"]))
        for p in res.get("paragraphs", []):
            text_parts.append(str(p))
        docs.append(
            {
                "type": "ressource",
                "title": res.get("title", ""),
                "url": res.get("url", ""),
                "text": "\n".join(text_parts),
            }
        )

    faq_page = load_page(FAQ_PATH)
    if faq_page:
        text_parts = []
        if faq_page.get("title"):
            text_parts.append(str(faq_page["title"]))
        if faq_page.get("resume"):
            text_parts.append(str(faq_page["resume"]))
        for p in faq_page.get("paragraphs", []):
            text_parts.append(str(p))
        docs.append(
            {
                "type": "faq",
                "title": faq_page.get("title", "FAQ"),
                "url": faq_page.get("url", ""),
                "text": "\n".join(text_parts),
            }
        )

    home_page = load_page(HOME_PATH)
    if home_page:
        text_parts = []
        if home_page.get("title"):
            text_parts.append(str(home_page["title"]))
        if home_page.get("resume"):
            text_parts.append(str(home_page["resume"]))
        for p in home_page.get("paragraphs", []):
            text_parts.append(str(p))
        docs.append(
            {
                "type": "home",
                "title": home_page.get("title", "Accueil"),
                "url": home_page.get("url", ""),
                "text": "\n".join(text_parts),
            }
        )

    return docs


ALL_DOCS = _build_doc_entries()

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client: OpenAI | None = None
if OPENAI_API_KEY:
    client = OpenAI(api_key=OPENAI_API_KEY)


def simple_tokenize(text: str) -> list[str]:
    text = text.lower()
    # enlever la ponctuation de base
    text = re.sub(r"[^a-zàâçéèêëîïôûùüÿñæœ0-9\s]", " ", text)
    return [t for t in text.split() if len(t) > 2]


def simple_stem(word: str) -> str:
    """Stemming français simplifié pour améliorer la recherche."""
    if not word or len(word) < 4:
        return word
    # Retirer les suffixes français courants
    for suffix in ['ement', 'ation', 'tion', 'ique', 'eur', 'euse', 'ment', 'er', 'ir', 'ant', 'ent']:
        if word.endswith(suffix):
            return word[:-len(suffix)]
    if word.endswith('aux'):
        return word[:-3] + 'al'
    if word.endswith('s'):
        return word[:-1]
    return word


def find_relevant_docs(question: str, top_k: int = 5) -> list[dict]:
    """Renvoie les documents les plus pertinents par simple score de mots-clés."""
    q_tokens = simple_tokenize(question)
    q_stems = [simple_stem(t) for t in q_tokens]
    if not q_tokens:
        return []

    scored: list[tuple[float, dict]] = []
    for doc in ALL_DOCS:
        doc_tokens = simple_tokenize(doc["text"])
        doc_stems = [simple_stem(t) for t in doc_tokens]
        title_tokens = simple_tokenize(doc.get("title", ""))
        title_stems = [simple_stem(t) for t in title_tokens]
        if not doc_tokens:
            continue
        
        score = 0.0
        
        # Bonus pour les fiches (priorité sur les ressources)
        if doc.get("type") == "fiche":
            score += 3.0
        
        for i, tok in enumerate(q_tokens):
            stem = q_stems[i]
            
            # Match exact dans le titre : +5
            if tok in title_tokens:
                score += 5.0
            # Match stem dans le titre : +3
            elif any(ts == stem or stem in ts or ts in stem for ts in title_stems):
                score += 3.0
            
            # Match exact dans le texte : +2
            if tok in doc_tokens:
                score += 2.0
            # Match stem dans le texte : +1
            elif any(ds == stem or stem in ds or ds in stem for ds in doc_stems):
                score += 1.0
        
        if score > 0:
            scored.append((score, doc))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [doc for _score, doc in scored[:top_k]]


@app.route("/")
def index():
    fiches = sorted(load_fiches(), key=lambda f: f.get("title", "").lower())
    ressources = sorted(load_ressources(), key=lambda r: r.get("title", "").lower())
    faq_page = load_page(FAQ_PATH)
    home_page = load_page(HOME_PATH)
    return render_template("index.html", fiches=fiches, ressources=ressources, faq=faq_page, home=home_page)


@app.post("/chat")
def chat():
    if client is None:
        return jsonify({"error": "OPENAI_API_KEY non configurée côté serveur."}), 500

    payload = request.get_json(silent=True) or {}
    message = (payload.get("message") or "").strip()
    history = payload.get("history", [])
    if not isinstance(history, list):
        history = []
    
    if not message:
        return jsonify({"error": "Message vide"}), 400

    # Combiner l'historique et le message actuel pour une meilleure recherche
    search_query = " ".join(
        [h.get("content", "") for h in history if h.get("role") == "user"] + [message]
    )
    relevant_docs = find_relevant_docs(search_query, top_k=5)

    context_parts: list[str] = []
    sources: list[dict] = []
    for doc in relevant_docs:
        context_parts.append(
            f"[{doc['type'].upper()}] \"{doc['title']}\"\nURL: {doc['url']}\nContenu:\n{doc['text']}"
        )
        sources.append({"type": doc["type"], "title": doc["title"], "url": doc["url"]})

    context = "\n\n".join(context_parts) if context_parts else "(aucun contexte trouvé dans les documents)"

    system_prompt = """Tu es un assistant pour le site Solutions Transitions, destiné aux élus, agents territoriaux et acteurs locaux.

RÈGLES STRICTES :
1. Tu ne dois JAMAIS inventer de fiches ou ressources. Tu ne peux mentionner QUE les documents fournis dans le contexte ci-dessous.
2. Quand tu mentionnes une fiche ou ressource, tu DOIS inclure son URL exacte entre parenthèses, comme ceci : "**Titre de la fiche** (URL)"
3. Privilégie les FICHES (type=fiche) car elles sont plus complètes et pratiques que les ressources.
4. Sois concis et orienté action : propose directement les fiches pertinentes avec une brève explication de pourquoi elles répondent à la question.
5. Ne fais PAS de suggestions génériques hors du contenu du site. Reste strictement dans le périmètre des documents fournis.
6. Si aucun document ne correspond à la question, dis-le clairement plutôt que d'inventer.

Format de réponse idéal :
- Cite 1 à 3 fiches pertinentes avec leur URL
- Explique brièvement pourquoi chaque fiche est utile
- Synthétise les points clés si le contexte le permet"""

    try:
        # Construire les messages avec l'historique
        messages = [{"role": "system", "content": system_prompt}]
        
        # Ajouter l'historique de conversation (limité aux 6 derniers messages)
        recent_history = history[-6:] if len(history) > 6 else history
        for h in recent_history:
            if h.get("role") in ("user", "assistant"):
                messages.append({"role": h["role"], "content": h.get("content", "")})
        
        # Ajouter le message actuel avec le contexte
        messages.append({
            "role": "user",
            "content": f"Contexte documentaire :\n{context}\n\nQuestion de l'utilisateur : {message}",
        })
        
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Erreur lors de l'appel OpenAI: {exc}"}), 500

    answer = completion.choices[0].message.content if completion.choices else ""  # type: ignore[attr-defined]

    return jsonify({"answer": answer, "sources": sources})


if __name__ == "__main__":
    app.run(debug=True)
