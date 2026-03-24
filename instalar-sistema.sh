#!/bin/bash
# MedMind — Instalação definitiva no Mac Mini
# Cole no Terminal e execute: bash /Users/Shared/projects/medmindplus/instalar-sistema.sh

set -e
SENHA="Win7?admin"
PROJ="/Users/Shared/projects/medmindplus"
NODE="/opt/homebrew/bin/node"

echo "======================================"
echo " MedMind — Instalação no Mac Mini"
echo "======================================"

# ── 1. Parar tunnel duplicado rodando como ranna ──────────────────────────────
echo "[1/4] Parando processos anteriores..."
pkill -f "$PROJ/server.js" 2>/dev/null || true
pkill -f "cloudflared.*medmind" 2>/dev/null || true
sleep 1

# ── 2. Adicionar medmind ao tunnel do sistema ─────────────────────────────────
echo "[2/4] Atualizando config do tunnel do sistema..."

# Backup
echo "$SENHA" | sudo -S cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak.medmind

# Ler config atual e adicionar medmind antes do fallback
echo "$SENHA" | sudo -S python3 - << 'PYEOF'
import re

with open('/etc/cloudflared/config.yml', 'r') as f:
    content = f.read()

# Verificar se medmind já está configurado
if 'medmind.win7med.com.br' in content:
    print("  medmind já está no config — nenhuma alteração necessária")
else:
    # Inserir antes da linha do fallback (http_status:404)
    new_rule = "  - hostname: medmind.win7med.com.br\n    service: http://127.0.0.1:3737\n\n"
    content = content.replace(
        "  - service: http_status:404",
        new_rule + "  - service: http_status:404"
    )
    with open('/etc/cloudflared/config.yml', 'w') as f:
        f.write(content)
    print("  medmind.win7med.com.br adicionado ao tunnel do sistema!")

PYEOF

# ── 3. Criar LaunchDaemon para o Node server ──────────────────────────────────
echo "[3/4] Instalando Node server como serviço do sistema..."

mkdir -p "$PROJ/logs"

echo "$SENHA" | sudo -S tee /Library/LaunchDaemons/com.medmind.node.plist > /dev/null << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.medmind.node</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE</string>
        <string>$PROJ/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$PROJ</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>$PROJ/logs/node.log</string>
    <key>StandardErrorPath</key>
    <string>$PROJ/logs/node-error.log</string>
</dict>
</plist>
EOF

# Carregar o serviço
echo "$SENHA" | sudo -S launchctl load /Library/LaunchDaemons/com.medmind.node.plist 2>/dev/null || \
echo "$SENHA" | sudo -S launchctl bootstrap system /Library/LaunchDaemons/com.medmind.node.plist 2>/dev/null || true

sleep 1

# ── 4. Reiniciar o tunnel do sistema ─────────────────────────────────────────
echo "[4/4] Reiniciando tunnel do sistema..."
echo "$SENHA" | sudo -S launchctl stop com.cloudflare.cloudflared 2>/dev/null || true
sleep 2
echo "$SENHA" | sudo -S launchctl start com.cloudflare.cloudflared 2>/dev/null || true
sleep 3

# ── Verificar ─────────────────────────────────────────────────────────────────
echo ""
echo "======================================"
echo " Verificando..."
echo "======================================"

# Node rodando?
if curl -s http://127.0.0.1:3737 | grep -q "MedMind"; then
    echo " ✅ Node server: OK (porta 3737)"
else
    echo " ❌ Node server: falhou — verifique $PROJ/logs/node-error.log"
fi

# Tunnel rodando?
if launchctl list | grep -q "com.cloudflare.cloudflared"; then
    echo " ✅ Cloudflare Tunnel: rodando como serviço do sistema"
else
    echo " ❌ Tunnel: verifique /Library/Logs/com.cloudflare.cloudflared.err.log"
fi

echo ""
echo "======================================"
echo " MedMind instalado!"
echo "======================================"
echo ""
echo " Local:    http://localhost:3737"
echo " Internet: https://medmind.win7med.com.br  (após CNAME DNS)"
echo ""
echo " Falta apenas: adicionar CNAME no Cloudflare"
echo " medmind → 5a37cc8a-63b8-4213-bdce-5e5f1f93f8c1.cfargotunnel.com"
echo " (ou → 418e67c8-9574-47ab-918f-8ff0c13fb4fc.cfargotunnel.com)"
echo ""
