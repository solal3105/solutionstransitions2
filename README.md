# Solutions Transitions - Assistant IA

Assistant IA pour orienter les élus, agents territoriaux et acteurs locaux vers les fiches et ressources du site [solutionstransitions.fr](https://solutionstransitions.fr/).

## 🚀 Lancement en Local

### Prérequis
- Python 3.9+
- Une clé API OpenAI

### Installation (une seule fois)

```bash
# Cloner le projet
git clone <url-du-repo>
cd solutionstransitions2

# Installer les dépendances Python
pip3 install -r requirements.txt

# Configurer la clé API OpenAI
# IMPORTANT : ne committez jamais .env (il est ignoré par Git)
cp .env.example .env
# Puis éditez .env et remplacez OPENAI_API_KEY
```

### Lancer le serveur

```bash
# Option 1 : Script simplifié
./start.sh

# Option 2 : Commande directe
python3 app.py
```

Le site sera accessible sur **http://localhost:5000**

### Mettre à jour les données (scraping)

```bash
python3 scraper_resumes.py
```

Cela récupère les dernières fiches et ressources depuis solutionstransitions.fr.

---

## 🌐 Déploiement en Production (Netlify)

### Prérequis
- Compte Netlify
- Node.js 18+ (pour Netlify CLI, optionnel)

### Déploiement via Git (recommandé)

1. **Connecter le repo à Netlify** :
   - Aller sur [app.netlify.com](https://app.netlify.com)
   - "Add new site" → "Import an existing project"
   - Connecter votre repo GitHub/GitLab

2. **Configurer les variables d'environnement** :
   - Dans Netlify : Site settings → Environment variables
   - Ajouter :
     - `OPENAI_API_KEY` = votre clé API OpenAI
     - `OPENAI_MODEL` = `gpt-4.1-mini` (ou autre modèle)

3. **Déployer** :
   ```bash
   git add .
   git commit -m "Mise à jour"
   git push
   ```
   Netlify déploie automatiquement à chaque push.

### Configuration Netlify (déjà faite)

Le fichier `netlify.toml` configure :
- `publish = "templates"` : dossier des fichiers statiques
- `functions = "netlify/functions"` : dossier des fonctions serverless

---

## 📁 Structure du Projet

```
solutionstransitions2/
├── app.py                    # Backend Flask (dev local)
├── scraper_resumes.py        # Scraper du site
├── requirements.txt          # Dépendances Python
├── .env.example              # Template (à copier en .env)
├── start.sh                  # Script de lancement local
├── netlify.toml              # Configuration Netlify
├── templates/
│   └── index.html            # Frontend (interface chat)
├── netlify/functions/
│   └── chat.js               # API chat pour Netlify
└── doc/
    ├── fiches.json           # Données scrapées (fiches)
    ├── ressources.json       # Données scrapées (ressources)
    ├── faq.json              # Données scrapées (FAQ)
    └── home.json             # Données scrapées (accueil)
```

---

## 🔧 Fonctionnalités

- **Recherche intelligente** : Stemming français, priorité aux fiches
- **Mémoire conversationnelle** : Garde le contexte des 3 derniers échanges
- **Liens cliquables** : Les fiches mentionnées incluent leur URL
- **Anti-hallucination** : L'IA ne peut citer que les documents existants
