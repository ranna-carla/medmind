#!/bin/bash
# MedMind — Setup no Mac Mini
# Execute com: bash setup-mac.sh

set -e
DOMAIN="medmind.win7med.com.br"
WEBROOT="/Users/macmini-win7/projects/projects/medmindplus"

echo "======================================"
echo " MedMind — Setup Mac Mini"
echo " Domínio: $DOMAIN"
echo "======================================"
echo ""

# 1. Corrigir permissões do Homebrew
echo "[1/5] Corrigindo permissões do Homebrew..."
sudo chown -R $(whoami) /opt/homebrew/etc /opt/homebrew/lib /opt/homebrew/share /opt/homebrew/var /opt/homebrew/Cellar 2>/dev/null || true

# 2. Instalar Nginx
echo "[2/5] Instalando Nginx..."
brew install nginx

# 3. Instalar Certbot
echo "[3/5] Instalando Certbot..."
brew install certbot

# 4. Configurar Nginx
echo "[4/5] Configurando Nginx..."
NGINX_CONF="/opt/homebrew/etc/nginx/servers/medmind.conf"

sudo mkdir -p /opt/homebrew/etc/nginx/servers

cat > "$NGINX_CONF" << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN;
    root $WEBROOT;
    index index.html;

    # Necessário para o Certbot validar o domínio
    location /.well-known/acme-challenge/ {
        root $WEBROOT;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINXEOF

# Verificar configuração
nginx -t

# Iniciar/recarregar Nginx
echo "Iniciando Nginx..."
brew services start nginx 2>/dev/null || brew services restart nginx

echo ""
echo "======================================"
echo " [5/5] Próximos passos MANUAIS:"
echo "======================================"
echo ""
echo " 1. DNS — Aponte o subdomínio no painel do seu registrador:"
echo "    Tipo: A"
echo "    Nome: medmind"
echo "    Valor: <SEU IP EXTERNO>"
echo "    (para descobrir seu IP: curl https://ipv4.icanhazip.com)"
echo ""
echo " 2. Roteador — Configure port forward:"
echo "    Porta externa 80  → 192.168.1.8:80"
echo "    Porta externa 443 → 192.168.1.8:443"
echo ""
echo " 3. Após DNS propagar (~5 min), rode:"
echo "    sudo certbot certonly --webroot -w $WEBROOT -d $DOMAIN"
echo "    E depois:"
echo "    bash /Users/macmini-win7/projects/projects/medmindplus/setup-ssl.sh"
echo ""
echo " 4. Firebase — Adicionar domínio autorizado:"
echo "    console.firebase.google.com → Authentication → Settings → Authorized domains"
echo "    Adicionar: $DOMAIN"
echo ""
echo " 5. Google Cloud Console — Atualizar OAuth:"
echo "    console.cloud.google.com → APIs & Services → Credentials → OAuth 2.0"
echo "    Authorized JavaScript origins: https://$DOMAIN"
echo "    Authorized redirect URIs: https://$DOMAIN/__/auth/handler"
echo ""
echo " 6. Atualizar URL no index.html (friend code sharing):"
echo "    bash /Users/macmini-win7/projects/projects/medmindplus/update-domain.sh"
echo ""
echo " CORS Firebase Storage (rodar após instalar gsutil):"
echo "    gsutil cors set /Users/macmini-win7/projects/projects/medmindplus/cors.json gs://medmind-pro.firebasestorage.app"
echo ""
