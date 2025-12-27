const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

// Les fichiers JSON sont dans le dossier data/ à côté de cette fonction
const DATA_DIR = path.join(__dirname, "data");
const FICHES_PATH = path.join(DATA_DIR, "fiches.json");
const RESSOURCES_PATH = path.join(DATA_DIR, "ressources.json");
const FAQ_PATH = path.join(DATA_DIR, "faq.json");
const HOME_PATH = path.join(DATA_DIR, "home.json");

function loadJson(p) {
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw || "[]");
}

function loadPage(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw || "null");
}

function buildDocEntries() {
  const docs = [];

  const fiches = loadJson(FICHES_PATH);
  fiches.forEach((fiche) => {
    const textParts = [];
    if (fiche.title) textParts.push(String(fiche.title));
    if (fiche.resume) textParts.push(String(fiche.resume));
    (fiche.paragraphs || []).forEach((p) => textParts.push(String(p)));
    docs.push({
      type: "fiche",
      title: fiche.title || "",
      url: fiche.url || "",
      text: textParts.join("\n"),
    });
  });

  const ressources = loadJson(RESSOURCES_PATH);
  ressources.forEach((res) => {
    const textParts = [];
    if (res.title) textParts.push(String(res.title));
    if (res.resume) textParts.push(String(res.resume));
    (res.paragraphs || []).forEach((p) => textParts.push(String(p)));
    docs.push({
      type: "ressource",
      title: res.title || "",
      url: res.url || "",
      text: textParts.join("\n"),
    });
  });

  const faqPage = loadPage(FAQ_PATH);
  if (faqPage) {
    const textParts = [];
    if (faqPage.title) textParts.push(String(faqPage.title));
    if (faqPage.resume) textParts.push(String(faqPage.resume));
    (faqPage.paragraphs || []).forEach((p) => textParts.push(String(p)));
    docs.push({
      type: "faq",
      title: faqPage.title || "FAQ",
      url: faqPage.url || "",
      text: textParts.join("\n"),
    });
  }

  const homePage = loadPage(HOME_PATH);
  if (homePage) {
    const textParts = [];
    if (homePage.title) textParts.push(String(homePage.title));
    if (homePage.resume) textParts.push(String(homePage.resume));
    (homePage.paragraphs || []).forEach((p) => textParts.push(String(p)));
    docs.push({
      type: "home",
      title: homePage.title || "Accueil",
      url: homePage.url || "",
      text: textParts.join("\n"),
    });
  }

  return docs;
}

const ALL_DOCS = buildDocEntries();

function simpleTokenize(text) {
  if (!text) return [];
  text = text.toLowerCase();
  text = text.replace(/[^a-zàâçéèêëîïôûùüÿñæœ0-9\s]/g, " ");
  return text
    .split(/\s+/)
    .filter((t) => t && t.length > 2);
}

// Stemming français simplifié pour améliorer la recherche
function simpleStem(word) {
  if (!word || word.length < 4) return word;
  // Retirer les suffixes français courants
  return word
    .replace(/ement$/i, '')
    .replace(/ation$/i, '')
    .replace(/ement$/i, '')
    .replace(/tion$/i, '')
    .replace(/ique$/i, '')
    .replace(/eur$/i, '')
    .replace(/euse$/i, '')
    .replace(/ment$/i, '')
    .replace(/er$/i, '')
    .replace(/ir$/i, '')
    .replace(/ant$/i, '')
    .replace(/ent$/i, '')
    .replace(/aux$/i, 'al')
    .replace(/s$/i, '');
}

function findRelevantDocs(question, topK = 5) {
  const qTokens = simpleTokenize(question || "");
  const qStems = qTokens.map(simpleStem);
  if (!qTokens.length) return [];

  const scored = [];
  for (const doc of ALL_DOCS) {
    const docTokens = simpleTokenize(doc.text);
    const docStems = docTokens.map(simpleStem);
    const titleTokens = simpleTokenize(doc.title || "");
    const titleStems = titleTokens.map(simpleStem);
    if (!docTokens.length) continue;
    
    let score = 0;
    
    // Bonus pour les fiches (priorité sur les ressources)
    if (doc.type === "fiche") {
      score += 3;
    }
    
    for (let i = 0; i < qTokens.length; i++) {
      const tok = qTokens[i];
      const stem = qStems[i];
      
      // Match exact dans le titre : +5
      if (titleTokens.includes(tok)) {
        score += 5;
      }
      // Match stem dans le titre : +3
      else if (titleStems.some(ts => ts === stem || ts.includes(stem) || stem.includes(ts))) {
        score += 3;
      }
      
      // Match exact dans le texte : +2
      if (docTokens.includes(tok)) {
        score += 2;
      }
      // Match stem dans le texte : +1
      else if (docStems.some(ds => ds === stem || ds.includes(stem) || stem.includes(ds))) {
        score += 1;
      }
    }
    
    if (score > 0) {
      scored.push({ score, doc });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((x) => x.doc);
}

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

exports.handler = async (event, _context) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Méthode non autorisée" }),
    };
  }

  if (!client) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "OPENAI_API_KEY non configurée côté serveur." }),
    };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    payload = {};
  }

  const message = (payload.message || "").trim();
  const history = Array.isArray(payload.history) ? payload.history : [];
  
  if (!message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Message vide" }),
    };
  }

  // Combiner l'historique et le message actuel pour une meilleure recherche
  const searchQuery = history
    .filter(h => h.role === 'user')
    .map(h => h.content)
    .concat([message])
    .join(' ');
  
  const relevantDocs = findRelevantDocs(searchQuery, 5);

  const contextParts = [];
  const sources = [];
  for (const doc of relevantDocs) {
    contextParts.push(
      `[${doc.type.toUpperCase()}] "${doc.title}"\nURL: ${doc.url}\nContenu:\n${doc.text}`
    );
    sources.push({ type: doc.type, title: doc.title, url: doc.url });
  }

  const context = contextParts.length
    ? contextParts.join("\n\n")
    : "(aucun contexte trouvé dans les documents)";

  const systemPrompt = `Tu es un assistant pour le site Solutions Transitions, destiné aux élus, agents territoriaux et acteurs locaux.

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
- Synthétise les points clés si le contexte le permet`;

  // Construire les messages avec l'historique
  const messages = [
    { role: "system", content: systemPrompt },
  ];
  
  // Ajouter l'historique de conversation (limité aux 6 derniers messages)
  const recentHistory = history.slice(-6);
  for (const h of recentHistory) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: h.content });
    }
  }
  
  // Ajouter le message actuel avec le contexte
  messages.push({
    role: "user",
    content: `Contexte documentaire :\n${context}\n\nQuestion de l'utilisateur : ${message}`,
  });

  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: messages,
    });

    const answer =
      (completion.choices && completion.choices[0] && completion.choices[0].message.content) || "";

    return {
      statusCode: 200,
      body: JSON.stringify({ answer, sources }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Erreur lors de l'appel OpenAI: ${err}` }),
    };
  }
};
