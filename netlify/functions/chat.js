import fs from "fs";
import path from "path";
import OpenAI from "openai";

const APP_ROOT = path.resolve(path.join(__dirname, "..", ".."));
const FICHES_PATH = path.join(APP_ROOT, "doc", "fiches.json");
const RESSOURCES_PATH = path.join(APP_ROOT, "doc", "ressources.json");
const FAQ_PATH = path.join(APP_ROOT, "doc", "faq.json");
const HOME_PATH = path.join(APP_ROOT, "doc", "home.json");

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

function findRelevantDocs(question, topK = 5) {
  const qTokens = simpleTokenize(question || "");
  if (!qTokens.length) return [];

  const scored = [];
  for (const doc of ALL_DOCS) {
    const docTokens = simpleTokenize(doc.text);
    if (!docTokens.length) continue;
    let score = 0;
    for (const tok of qTokens) {
      const titleTokens = simpleTokenize(doc.title || "");
      if (titleTokens.includes(tok)) {
        score += 2;
      }
      if (docTokens.includes(tok)) {
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

export const handler = async (event) => {
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
  if (!message) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Message vide" }),
    };
  }

  const relevantDocs = findRelevantDocs(message, 5);

  const contextParts = [];
  const sources = [];
  for (const doc of relevantDocs) {
    contextParts.push(
      `[Source] type=${doc.type}, titre=${doc.title}, url=${doc.url}\nContenu :\n${doc.text}`
    );
    sources.push({ type: doc.type, title: doc.title, url: doc.url });
  }

  const context = contextParts.length
    ? contextParts.join("\n\n")
    : "(aucun contexte trouvé dans les documents)";

  const systemPrompt =
    "Tu es un assistant pour des élus, agents territoriaux et acteurs locaux. " +
    "Tu réponds en français et tu aides surtout à orienter vers les bonnes fiches et ressources de Solutions Transitions. " +
    "Quand c'est possible, tu expliques quelles ressources sont pertinentes et pourquoi, et tu synthétises aussi les principaux conseils issus du contexte.";

  try {
    const completion = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Contexte documentaire :\n${context}\n\nQuestion de l'utilisateur : ${message}`,
        },
      ],
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
