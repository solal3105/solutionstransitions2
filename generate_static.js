#!/usr/bin/env node
/**
 * Génère un index.html statique depuis le template Jinja2
 */

const fs = require('fs');
const path = require('path');

const DOC_DIR = path.join(__dirname, 'doc');
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'index.html');
const OUTPUT_PATH = path.join(__dirname, 'public', 'index.html');

// Charger les données JSON
function loadJSON(filename) {
  const filepath = path.join(DOC_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`Warning: ${filename} not found`);
    return null;
  }
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

const fiches = loadJSON('fiches.json') || [];
const ressources = loadJSON('ressources.json') || [];
const faq = loadJSON('faq.json');
const home = loadJSON('home.json');

console.log(`Loaded: ${fiches.length} fiches, ${ressources.length} ressources`);

// Lire le template
let template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

// Remplacer les variables Jinja2 simples
template = template.replace(/\{\{\s*fiches\|length\s*\}\}/g, fiches.length);
template = template.replace(/\{\{\s*ressources\|length\s*\}\}/g, ressources.length);

// Générer les listes de fiches
let fichesHTML = '';
fiches.forEach(fiche => {
  const resume = fiche.resume || '';
  const resumeShort = resume.length > 100 ? resume.substring(0, 100) + '...' : resume;
  fichesHTML += `
        <div class="item-card" data-url="${fiche.url}" data-title="${fiche.title}" data-type="fiche">
          <span class="item-tag fiche">Fiche</span>
          <h3>${fiche.title}</h3>
          <p>${resumeShort}</p>
        </div>`;
});

// Générer les listes de ressources
let ressourcesHTML = '';
ressources.forEach(ressource => {
  const resume = ressource.resume || '';
  const resumeShort = resume.length > 100 ? resume.substring(0, 100) + '...' : resume;
  ressourcesHTML += `
        <div class="item-card" data-url="${ressource.url}" data-title="${ressource.title}" data-type="ressource">
          <span class="item-tag ressource">Ressource</span>
          <h3>${ressource.title}</h3>
          <p>${resumeShort}</p>
        </div>`;
});

// Remplacer les boucles Jinja2
template = template.replace(
  /\{% for fiche in fiches %\}[\s\S]*?\{% endfor %\}/,
  fichesHTML
);

template = template.replace(
  /\{% for ressource in ressources %\}[\s\S]*?\{% endfor %\}/,
  ressourcesHTML
);

// Écrire le fichier final
fs.writeFileSync(OUTPUT_PATH, template, 'utf8');
console.log(`Generated ${OUTPUT_PATH}`);
console.log(`Total: ${fiches.length} fiches, ${ressources.length} ressources`);
