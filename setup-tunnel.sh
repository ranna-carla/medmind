#!/bin/bash
# MedMind — Configurar Cloudflare Tunnel
# Execute com: bash setup-tunnel.sh

DOMAIN="medmind.win7med.com.br"
TUNNEL_NAME="medmind"
PORT=3737

echo "======================================"
echo " MedMind — Cloudflare Tunnel Setup"
echo " Domínio: $DOMAIN"
echo "======================================"
echo ""

# 1. Login no Cloudflare (abre browser)
echo "[1/4] Fazendo login no Cloudflare..."
echo "     (vai abrir o browser para autorizar)"
echo ""
cloudflared tunnel login

# 2. Criar o tunnel
echo ""
echo "[2/4] Criando tunnel '$TUNNEL_NAME'..."
cloudflared tunnel create $TUNNEL_NAME

# 3. Pegar o ID do tunnel
TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
echo "     Tunnel ID: $TUNNEL_ID"

# 4. Criar config
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: /Users/ranna/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: $DOMAIN
    service: http://127.0.0.1:$PORT
  - service: http_status:404
EOF

echo ""
echo "[3/4] Configuração criada em ~/.cloudflared/config.yml"

# 5. Criar rota DNS no Cloudflare
echo ""
echo "[4/4] Criando registro DNS no Cloudflare..."
cloudflared tunnel route dns $TUNNEL_NAME $DOMAIN

echo ""
echo "======================================"
echo " Tunnel configurado!"
echo "======================================"
echo ""
echo "Para instalar como serviço (auto-start):"
echo "  cloudflared service install"
echo ""
echo "Para iniciar manualmente agora:"
echo "  cloudflared tunnel run $TUNNEL_NAME"
echo ""
