#!/bin/bash
# ═══════════════════════════════════════════════════════
# MedMind White-Label — Script de Clonagem Segura
#
# Cria uma cópia TOTALMENTE ISOLADA do projeto.
# NÃO altera nenhum arquivo do MedMind original.
# ═══════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECTS_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo "🏗️  MedMind White-Label — Clonagem Segura"
echo "═══════════════════════════════════════════"
echo ""

# Perguntar nome do projeto
read -p "📛 Nome do novo projeto (ex: direitomind): " PROJECT_NAME
if [ -z "$PROJECT_NAME" ]; then
  echo "❌ Nome obrigatório"; exit 1
fi

# Slug seguro
SLUG=$(echo "$PROJECT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-')
DEST="$PROJECTS_DIR/$SLUG"

if [ -d "$DEST" ]; then
  echo "❌ Pasta '$DEST' já existe!"; exit 1
fi

read -p "📝 Nome exibido no app (ex: DireitoMind): " APP_NAME
if [ -z "$APP_NAME" ]; then APP_NAME="$PROJECT_NAME"; fi

read -p "📧 Email do admin: " ADMIN_EMAIL
if [ -z "$ADMIN_EMAIL" ]; then
  echo "❌ Email obrigatório"; exit 1
fi

read -p "🔢 Porta do servidor (ex: 3738): " PORT
if [ -z "$PORT" ]; then PORT="3738"; fi

echo ""
echo "Resumo:"
echo "  Projeto: $SLUG"
echo "  Nome:    $APP_NAME"
echo "  Admin:   $ADMIN_EMAIL"
echo "  Porta:   $PORT"
echo "  Pasta:   $DEST"
echo ""
read -p "Confirmar? (s/n): " CONFIRM
if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ]; then
  echo "Cancelado."; exit 0
fi

echo ""
echo "📂 Copiando arquivos..."
mkdir -p "$DEST"
cp "$SCRIPT_DIR/index.html" "$DEST/"
cp "$SCRIPT_DIR/server.js" "$DEST/"
cp "$SCRIPT_DIR/admin.html" "$DEST/"
cp "$SCRIPT_DIR/firestore.rules" "$DEST/"
cp "$SCRIPT_DIR/firebase.json" "$DEST/" 2>/dev/null || true
cp "$SCRIPT_DIR/package.json" "$DEST/" 2>/dev/null || true
cp "$SCRIPT_DIR/WHITELABEL.md" "$DEST/"
mkdir -p "$DEST/logs"

echo "🔄 Substituindo 'MedMind' por '$APP_NAME'..."
if [[ "$OSTYPE" == "darwin"* ]]; then
  SED_CMD="sed -i ''"
else
  SED_CMD="sed -i"
fi

# Substituir nome do app
$SED_CMD "s/MedMind/$APP_NAME/g" "$DEST/index.html"
$SED_CMD "s/MedMind/$APP_NAME/g" "$DEST/server.js"
$SED_CMD "s/medmind/$SLUG/g" "$DEST/server.js"

# Substituir porta
$SED_CMD "s/const PORT = 3737/const PORT = $PORT/" "$DEST/server.js"

# Substituir admin email
$SED_CMD "s/ranna@grupolead.com.br/$ADMIN_EMAIL/g" "$DEST/firestore.rules"
$SED_CMD "s/ranna@grupolead.com.br/$ADMIN_EMAIL/g" "$DEST/server.js"

echo "🔥 Limpando Firebase config (PRECISA CONFIGURAR)..."
# Marcar Firebase config como pendente
$SED_CMD 's/apiKey: "AIzaSyCvoPA9OOC3o42ERViKs1IjRIOuwOon0UU"/apiKey: "CONFIGURAR_API_KEY"/' "$DEST/index.html"
$SED_CMD "s/medmind-pro.firebaseapp.com/CONFIGURAR.firebaseapp.com/" "$DEST/index.html"
$SED_CMD "s/projectId: \"medmind-pro\"/projectId: \"CONFIGURAR_PROJECT_ID\"/" "$DEST/index.html"
$SED_CMD "s/medmind-pro.firebasestorage.app/CONFIGURAR.firebasestorage.app/" "$DEST/index.html"
$SED_CMD "s/860950221382/CONFIGURAR_SENDER_ID/g" "$DEST/index.html"
$SED_CMD "s/1:860950221382:web:4d31ac4cc0fb7d1a883047/CONFIGURAR_APP_ID/" "$DEST/index.html"

# Limpar Firebase config do server.js também
$SED_CMD "s/const FIREBASE_API_KEY = '.*'/const FIREBASE_API_KEY = 'CONFIGURAR_API_KEY'/" "$DEST/server.js"
$SED_CMD "s/const FIREBASE_PROJECT  = '.*'/const FIREBASE_PROJECT  = 'CONFIGURAR_PROJECT_ID'/" "$DEST/server.js"

echo "📦 Inicializando git..."
cd "$DEST"
git init
echo "node_modules/" > .gitignore
echo "logs/" >> .gitignore
echo ".env" >> .gitignore
echo "*.log" >> .gitignore
git add -A
git commit -m "feat: $APP_NAME — clone white-label do MedMind"

echo ""
echo "═══════════════════════════════════════════"
echo "✅ Projeto '$APP_NAME' criado em:"
echo "   $DEST"
echo ""
echo "⚠️  PRÓXIMOS PASSOS:"
echo "   1. Criar projeto Firebase e configurar credenciais"
echo "      (buscar 'CONFIGURAR' nos arquivos)"
echo "   2. Substituir módulos pelo conteúdo da área"
echo "   3. Ajustar cores e níveis (ver WHITELABEL.md)"
echo "   4. npm install && node server.js"
echo ""
echo "🔒 O MedMind original NÃO foi alterado."
echo "═══════════════════════════════════════════"
