import json
import os
import re

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


def load_page(path: str) -> dict | None:
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


def find_relevant_docs(question: str, top_k: int = 5) -> list[dict]:
    """Renvoie les documents les plus pertinents par simple score de mots-clés."""
    q_tokens = simple_tokenize(question)
    if not q_tokens:
        return []

    scored: list[tuple[float, dict]] = []
    for doc in ALL_DOCS:
        doc_tokens = simple_tokenize(doc["text"])
        if not doc_tokens:
            continue
        score = 0.0
        for tok in q_tokens:
            # +2 si token dans le titre, +1 s'il est dans le texte
            if tok in simple_tokenize(doc.get("title", "")):
                score += 2.0
            if tok in doc_tokens:
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
    if not message:
        return jsonify({"error": "Message vide"}), 400

    relevant_docs = find_relevant_docs(message, top_k=5)

    context_parts: list[str] = []
    sources: list[dict] = []
    for doc in relevant_docs:
        context_parts.append(
            f"[Source] type={doc['type']}, titre={doc['title']}, url={doc['url']}\nContenu :\n{doc['text']}"
        )
        sources.append({"type": doc["type"], "title": doc["title"], "url": doc["url"]})

    context = "\n\n".join(context_parts) if context_parts else "(aucun contexte trouvé dans les documents)"

    system_prompt = (
        "Tu es un assistant pour des élus, agents territoriaux et acteurs locaux. "
        "Tu réponds en français et tu aides surtout à orienter vers les bonnes fiches et ressources de Solutions Transitions. "
        "Quand c'est possible, tu expliques quelles ressources sont pertinentes et pourquoi, et tu synthétises aussi les principaux conseils issus du contexte."
    )

    try:
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": f"Contexte documentaire :\n{context}\n\nQuestion de l'utilisateur : {message}",
                },
            ],
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Erreur lors de l'appel OpenAI: {exc}"}), 500

    answer = completion.choices[0].message.content if completion.choices else ""  # type: ignore[attr-defined]

    return jsonify({"answer": answer, "sources": sources})


if __name__ == "__main__":
    app.run(debug=True)
