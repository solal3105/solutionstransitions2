#!/usr/bin/env node
/**
 * Script de build pour Netlify
 * Inline les données JSON directement dans la fonction chat.js
 */

const fs = require('fs');
const path = require('path');

const DOC_DIR = path.join(__dirname, 'doc');
const FUNCTIONS_DIR = path.join(__dirname, 'netlify', 'functions');
const CHAT_TEMPLATE = path.join(__dirname, 'scripts', 'chat.template.js');
const CHAT_OUTPUT = path.join(FUNCTIONS_DIR, 'chat.js');

// Charger les données JSON
function loadJSON(filename) {
  const filepath = path.join(DOC_DIR, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`Warning: ${filename} not found`);
    return null;
  }
  const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  console.log(`Loaded ${filename}: ${Array.isArray(data) ? data.length + ' items' : 'object'}`);
  return data;
}

const fiches = loadJSON('fiches.json') || [];
const ressources = loadJSON('ressources.json') || [];
const faq = loadJSON('faq.json');
const home = loadJSON('home.json');

// Lire le template
if (!fs.existsSync(CHAT_TEMPLATE)) {
  console.error('Error: chat.template.js not found');
  process.exit(1);
}

let template = fs.readFileSync(CHAT_TEMPLATE, 'utf8');

// Remplacer les placeholders par les données inlinées
template = template.replace('__FICHES_DATA__', JSON.stringify(fiches));
template = template.replace('__RESSOURCES_DATA__', JSON.stringify(ressources));
template = template.replace('__FAQ_DATA__', JSON.stringify(faq));
template = template.replace('__HOME_DATA__', JSON.stringify(home));

// Écrire le fichier final
fs.writeFileSync(CHAT_OUTPUT, template, 'utf8');
console.log(`\nGenerated ${CHAT_OUTPUT}`);
console.log(`Total: ${fiches.length} fiches, ${ressources.length} ressources`);

// Générer aussi l'index.html statique
console.log('\nGenerating static index.html...');
require('./generate_static.js');
