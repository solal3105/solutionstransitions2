#!/bin/bash

# Script de lancement local pour Solutions Transitions

echo "🚀 Démarrage de Solutions Transitions..."

# Vérifier que Python est installé
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 n'est pas installé. Veuillez l'installer."
    exit 1
fi

# Se placer dans le bon répertoire
cd "$(dirname "$0")"

# Installer les dépendances si nécessaire
if ! python3 -c "import flask" 2>/dev/null; then
    echo "📦 Installation des dépendances..."
    pip3 install -r requirements.txt
fi

# Vérifier le fichier .env
if [ ! -f .env ]; then
    echo "⚠️  Fichier .env manquant. Création à partir du template..."
    echo "OPENAI_API_KEY=votre-cle-api-ici" > .env
    echo "OPENAI_MODEL=gpt-4.1-mini" >> .env
    echo "❌ Veuillez éditer .env et ajouter votre clé API OpenAI"
    exit 1
fi

echo "✅ Serveur accessible sur http://localhost:5000"
echo "   Appuyez sur Ctrl+C pour arrêter"
echo ""

# Lancer le serveur Flask
python3 app.py
