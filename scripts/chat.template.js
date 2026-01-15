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

// Synonymes et termes associés pour améliorer la recherche sémantique
const SYNONYMS = {
  'financement': ['financer', 'financier', 'budget', 'subvention', 'dotation', 'emprunt', 'dette', 'investissement', 'fonds', 'aides'],
  'formation': ['former', 'cnfpt', 'compétences', 'apprentissage', 'sensibilisation'],
  'budget': ['budgétaire', 'finances', 'financier', 'dépenses', 'recettes', 'comptabilité'],
  'énergie': ['énergétique', 'électricité', 'chauffage', 'rénovation', 'thermique'],
  'climat': ['climatique', 'carbone', 'émissions', 'ges', 'décarbonation'],
  'mobilité': ['transport', 'vélo', 'voiture', 'déplacement', 'circulation'],
  'biodiversité': ['nature', 'espèces', 'écosystème', 'faune', 'flore'],
  'eau': ['hydraulique', 'assainissement', 'potable', 'aquatique'],
  'déchet': ['déchets', 'recyclage', 'tri', 'ordures', 'compost'],
  'bâtiment': ['bâti', 'patrimoine', 'immobilier', 'construction', 'rénovation'],
};

// Mots vides à ignorer dans la recherche
const STOP_WORDS = new Set([
  'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles',
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'ce', 'cette', 'ces',
  'mon', 'ton', 'son', 'notre', 'votre', 'leur',
  'qui', 'que', 'quoi', 'dont', 'où',
  'et', 'ou', 'mais', 'donc', 'car', 'ni', 'pour', 'par', 'sur', 'sous', 'avec', 'sans', 'dans', 'entre',
  'être', 'avoir', 'faire', 'pouvoir', 'vouloir', 'devoir', 'savoir', 'aller',
  'est', 'sont', 'était', 'ont', 'fait', 'peut', 'veut', 'doit', 'sait', 'vais',
  'plus', 'moins', 'très', 'bien', 'tout', 'tous', 'toute', 'toutes',
  'comment', 'pourquoi', 'quand', 'combien',
  'sujet', 'sujets', 'thème', 'thèmes', 'proposer', 'aide', 'aider',
]);

// Expansion de la requête avec les synonymes
function expandQuery(tokens) {
  const expanded = new Set(tokens);
  for (const tok of tokens) {
    const stem = simpleStem(tok);
    for (const [key, synonyms] of Object.entries(SYNONYMS)) {
      if (key === tok || simpleStem(key) === stem || synonyms.some(s => s === tok || simpleStem(s) === stem)) {
        expanded.add(key);
        synonyms.forEach(s => expanded.add(s));
      }
    }
  }
  return Array.from(expanded);
}

// Filtrer les mots vides
function filterStopWords(tokens) {
  return tokens.filter(t => !STOP_WORDS.has(t) && t.length > 2);
}

// Compter les occurrences d'un token dans un texte
function countOccurrences(token, textTokens, textStems) {
  const stem = simpleStem(token);
  let count = 0;
  for (let i = 0; i < textTokens.length; i++) {
    if (textTokens[i] === token || textStems[i] === stem) {
      count++;
    }
  }
  return count;
}

// SEUIL DE PERTINENCE MINIMUM - Un document doit avoir au moins ce score pour être considéré pertinent
const MIN_RELEVANCE_SCORE = 8;

function findRelevantDocs(question, topK = 5) {
  let qTokens = simpleTokenize(question || "");
  qTokens = filterStopWords(qTokens);
  if (!qTokens.length) return { docs: [], hasRelevantResults: false };
  
  // Expansion avec synonymes
  const expandedTokens = expandQuery(qTokens);
  const qStems = expandedTokens.map(simpleStem);
  
  // Tokens originaux (sans expansion) pour scoring prioritaire
  const originalStems = qTokens.map(simpleStem);

  const scored = [];
  for (const doc of ALL_DOCS) {
    const docTokens = simpleTokenize(doc.text);
    const docStems = docTokens.map(simpleStem);
    const titleTokens = simpleTokenize(doc.title || "");
    const titleStems = titleTokens.map(simpleStem);
    const resumeTokens = simpleTokenize(doc.resume || "");
    const resumeStems = resumeTokens.map(simpleStem);
    
    if (!docTokens.length) continue;
    
    let score = 0;
    let titleMatches = 0;
    let resumeMatches = 0;
    let contentMatches = 0;
    
    // Bonus de base pour les fiches
    if (doc.type === "fiche") {
      score += 2;
    }
    
    // Scoring pour chaque token de la requête ORIGINALE (priorité haute)
    for (const tok of qTokens) {
      const stem = simpleStem(tok);
      
      // Match exact dans le titre : TRÈS IMPORTANT (+15)
      if (titleTokens.includes(tok)) {
        score += 15;
        titleMatches++;
      }
      // Match stem dans le titre : +10
      else if (titleStems.some(ts => ts === stem)) {
        score += 10;
        titleMatches++;
      }
      
      // Match exact dans le résumé : +8
      if (resumeTokens.includes(tok)) {
        score += 8;
        resumeMatches++;
      }
      // Match stem dans le résumé : +5
      else if (resumeStems.some(rs => rs === stem)) {
        score += 5;
        resumeMatches++;
      }
      
      // Match dans le contenu avec comptage de densité
      const occurrences = countOccurrences(tok, docTokens, docStems);
      if (occurrences > 0) {
        // Score basé sur la densité (occurrences / taille doc * 1000)
        const density = (occurrences / docTokens.length) * 1000;
        score += Math.min(density * 2, 6); // Plafonné à 6 points
        contentMatches++;
      }
    }
    
    // Scoring pour tokens EXPANDUS (synonymes) - bonus moindre
    for (const tok of expandedTokens) {
      if (qTokens.includes(tok)) continue; // Déjà compté
      const stem = simpleStem(tok);
      
      if (titleTokens.includes(tok) || titleStems.some(ts => ts === stem)) {
        score += 3;
      }
      if (resumeTokens.includes(tok) || resumeStems.some(rs => rs === stem)) {
        score += 2;
      }
    }
    
    // Bonus si TOUS les mots-clés importants sont présents dans le titre ou résumé
    if (qTokens.length > 0 && titleMatches >= qTokens.length) {
      score += 10; // Bonus de cohérence thématique
    }
    if (qTokens.length > 0 && (titleMatches + resumeMatches) >= qTokens.length) {
      score += 5;
    }
    
    if (score > 0) {
      scored.push({ 
        score, 
        doc,
        titleMatches,
        resumeMatches,
        contentMatches,
        relevanceRatio: titleMatches / Math.max(qTokens.length, 1)
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  
  // Filtrer par seuil de pertinence minimum
  const relevantDocs = scored.filter(s => s.score >= MIN_RELEVANCE_SCORE);
  
  // Log pour debug
  console.log(`[chat.js] Query tokens: [${qTokens.join(', ')}]`);
  console.log(`[chat.js] Top scores: ${scored.slice(0, 5).map(s => `${s.doc.title.substring(0, 40)}... (${s.score})`).join(' | ')}`);
  console.log(`[chat.js] Docs above threshold (${MIN_RELEVANCE_SCORE}): ${relevantDocs.length}`);
  
  return {
    docs: relevantDocs.slice(0, topK).map(x => x.doc),
    scores: relevantDocs.slice(0, topK).map(x => ({ title: x.doc.title, score: x.score, titleMatches: x.titleMatches })),
    hasRelevantResults: relevantDocs.length > 0,
    topScore: scored.length > 0 ? scored[0].score : 0
  };
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
  
  const searchResult = findRelevantDocs(searchQuery, 5);
  const { docs: relevantDocs, hasRelevantResults, topScore, scores } = searchResult;
  console.log(`[chat.js] Search: "${message.substring(0, 50)}..." -> ${relevantDocs.length} pertinent docs (hasRelevant: ${hasRelevantResults}, topScore: ${topScore})`);

  const contextParts = [];
  const sources = [];
  for (const doc of relevantDocs) {
    contextParts.push(
      `[${doc.type.toUpperCase()}] "${doc.title}"\nURL: ${doc.url}\nContenu:\n${doc.text}`
    );
    sources.push({ type: doc.type, title: doc.title, url: doc.url, resume: doc.resume || "" });
  }

  // Construire le contexte en fonction de la pertinence
  let context;
  let relevanceNote = '';
  
  if (!hasRelevantResults) {
    context = "(AUCUN DOCUMENT PERTINENT TROUVÉ - voir instructions ci-dessous)";
    relevanceNote = `\n\n⚠️ IMPORTANT : Aucune fiche ou ressource ne correspond précisément à cette demande.
Tu DOIS :
1. Indiquer clairement à l'utilisateur que tu n'as pas trouvé de contenu directement lié à sa demande
2. Lui proposer de préciser sa recherche avec des exemples concrets de ce qu'il cherche
3. Suggérer des thèmes connexes disponibles sur le site (budget, énergie, mobilité, biodiversité, climat, etc.)
4. NE PAS proposer de fiches non pertinentes juste pour "donner quelque chose"`;
  } else {
    context = contextParts.join("\n\n");
  }

  const systemPrompt = `Tu es un assistant pour le site Solutions Transitions, destiné aux élus, agents territoriaux et acteurs locaux.

RÈGLES STRICTES :
1. Tu ne dois JAMAIS inventer de fiches ou ressources. Tu ne peux mentionner QUE les documents fournis dans le contexte ci-dessous.
2. Quand tu mentionnes une fiche ou ressource, tu DOIS inclure son URL exacte entre parenthèses, comme ceci : "**Titre de la fiche** (URL)"
3. Privilégie les FICHES (type=fiche) car elles sont plus complètes et pratiques que les ressources.
4. Ta priorité est de BIEN COMPRENDRE le besoin. Si la question est large/ambiguë, pose 1 à 2 questions de clarification AVANT de proposer des fiches/ressources.
5. Sois concis : vise 60 à 120 mots maximum, utilise des puces courtes. Évite les longs paragraphes.
6. Ne fais PAS de suggestions génériques hors du contenu du site. Reste strictement dans le périmètre des documents fournis.
7. Si aucun document pertinent n'est fourni dans le contexte, tu DOIS le dire clairement et guider l'utilisateur pour reformuler sa demande. NE PROPOSE PAS de fiches non pertinentes.
8. QUALITÉ > QUANTITÉ : mieux vaut ne proposer qu'une seule fiche très pertinente que plusieurs fiches moyennement liées.

Format de réponse idéal :
- Si pas de résultat pertinent : explique que tu n'as pas trouvé et guide l'utilisateur
- Sinon : cite 1 à 3 fiches/ressources VRAIMENT pertinentes avec leur URL et 1 phrase de justification chacune${relevanceNote}`;

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
