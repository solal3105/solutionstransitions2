const OpenAI = require("openai");

// Données inlinées par le script de build
const FICHES_DATA = __FICHES_DATA__;
const RESSOURCES_DATA = __RESSOURCES_DATA__;
const FAQ_DATA = __FAQ_DATA__;
const HOME_DATA = __HOME_DATA__;

function buildDocEntries() {
  const docs = [];

  const fiches = FICHES_DATA || [];
  fiches.forEach((fiche) => {
    const textParts = [];
    if (fiche.title) textParts.push(String(fiche.title));
    if (fiche.resume) textParts.push(String(fiche.resume));
    (fiche.paragraphs || []).forEach((p) => textParts.push(String(p)));
    docs.push({
      type: "fiche",
      title: fiche.title || "",
      url: fiche.url || "",
      resume: fiche.resume || "",
      text: textParts.join("\n"),
    });
  });

  const ressources = RESSOURCES_DATA || [];
  ressources.forEach((res) => {
    const textParts = [];
    if (res.title) textParts.push(String(res.title));
    if (res.resume) textParts.push(String(res.resume));
    (res.paragraphs || []).forEach((p) => textParts.push(String(p)));
    docs.push({
      type: "ressource",
      title: res.title || "",
      url: res.url || "",
      resume: res.resume || "",
      text: textParts.join("\n"),
    });
  });

  const faqPage = FAQ_DATA;
  if (faqPage) {
    const textParts = [];
    if (faqPage.title) textParts.push(String(faqPage.title));
    if (faqPage.resume) textParts.push(String(faqPage.resume));
    (faqPage.paragraphs || []).forEach((p) => textParts.push(String(p)));
    docs.push({
      type: "faq",
      title: faqPage.title || "FAQ",
      url: faqPage.url || "",
      resume: faqPage.resume || "",
      text: textParts.join("\n"),
    });
  }

  const homePage = HOME_DATA;
  if (homePage) {
    const textParts = [];
    if (homePage.title) textParts.push(String(homePage.title));
    if (homePage.resume) textParts.push(String(homePage.resume));
    (homePage.paragraphs || []).forEach((p) => textParts.push(String(p)));
    docs.push({
      type: "home",
      title: homePage.title || "Accueil",
      url: homePage.url || "",
      resume: homePage.resume || "",
      text: textParts.join("\n"),
    });
  }

  return docs;
}

const ALL_DOCS = buildDocEntries();
console.log(`[chat.js] Total documents loaded: ${ALL_DOCS.length}`);

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
  return word
    .replace(/ement$/i, '')
    .replace(/ation$/i, '')
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
  console.log(`[chat.js] Search: "${message.substring(0, 50)}..." -> ${relevantDocs.length} docs found`);

  const contextParts = [];
  const sources = [];
  for (const doc of relevantDocs) {
    contextParts.push(
      `[${doc.type.toUpperCase()}] "${doc.title}"\nURL: ${doc.url}\nContenu:\n${doc.text}`
    );
    sources.push({ type: doc.type, title: doc.title, url: doc.url, resume: doc.resume || "" });
  }

  const context = contextParts.length
    ? contextParts.join("\n\n")
    : "(aucun contexte trouvé dans les documents)";

  const systemPrompt = `Tu es un assistant pour le site Solutions Transitions, destiné aux élus, agents territoriaux et acteurs locaux.

RÈGLES STRICTES :
1. Tu ne dois JAMAIS inventer de fiches ou ressources. Tu ne peux mentionner QUE les documents fournis dans le contexte ci-dessous.
2. Quand tu mentionnes une fiche ou ressource, tu DOIS inclure son URL exacte entre parenthèses, comme ceci : "**Titre de la fiche** (URL)"
3. Privilégie les FICHES (type=fiche) car elles sont plus complètes et pratiques que les ressources.
4. Ta priorité est de BIEN COMPRENDRE le besoin. Si la question est large/ambiguë, pose 1 à 2 questions de clarification AVANT de proposer des fiches/ressources. Dans ce cas, ne propose au maximum qu'1 document “le plus probable”.
5. Sois concis : vise 60 à 120 mots maximum, utilise des puces courtes. Évite les longs paragraphes.
6. Ne fais PAS de suggestions génériques hors du contenu du site. Reste strictement dans le périmètre des documents fournis.
7. Si aucun document ne correspond à la question, dis-le clairement plutôt que d'inventer.

Format de réponse idéal :
- Si besoin : commence par 1 à 2 questions de clarification
- Sinon : cite 1 à 3 fiches/ressources pertinentes avec leur URL et 1 phrase de justification chacune`;

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
