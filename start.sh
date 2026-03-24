#!/bin/bash
# MedMind — Iniciar servidor + tunnel
# Execute: bash start.sh

PROJ="/Users/macmini-win7/projects/projects/medmindplus"
LOGS="$PROJ/logs"
PORT=3737
mkdir -p "$LOGS"

# --- Node.js ---
if curl -s -o /dev/null -w '' "http://127.0.0.1:$PORT/" 2>/dev/null; then
  NODE_PID=$(netstat -anv 2>/dev/null | grep "127.0.0.1.$PORT" | awk '{print $9}' | head -1)
  echo "Node.js já está rodando na porta $PORT (PID: ${NODE_PID:-desconhecido}). Pulando."
else
  pkill -f "node $PROJ/server.js" 2>/dev/null || true
  sleep 1

  echo "Iniciando servidor Node.js..."
  node "$PROJ/server.js" >> "$LOGS/node.log" 2>&1 &
  NODE_PID=$!
  echo "  Node PID: $NODE_PID"
  sleep 2

  if ! curl -s -o /dev/null -w '' "http://127.0.0.1:$PORT/" 2>/dev/null; then
    echo "ERRO: Node não iniciou. Verifique $LOGS/node.log"
    exit 1
  fi
fi

# --- Cloudflare Tunnel ---
if pgrep -f "cloudflared tunnel.*medmind" > /dev/null 2>&1; then
  echo "Cloudflare Tunnel já está rodando. Pulando."
  CF_PID=$(pgrep -f "cloudflared tunnel.*medmind" | head -1)
else
  pkill -f "cloudflared tunnel.*cloudflare-tunnel.yml" 2>/dev/null || true
  sleep 1

  echo "Iniciando Cloudflare Tunnel..."
  cloudflared tunnel --config "$PROJ/cloudflare-tunnel.yml" run >> "$LOGS/cloudflared.log" 2>&1 &
  CF_PID=$!
  echo "  Cloudflared PID: $CF_PID"
fi

echo ""
echo "MedMind online em: https://medmind.win7med.com.br"
echo "Logs em: $LOGS/"
echo "Para parar: bash $PROJ/stop.sh"

# Salvar PIDs
echo "${NODE_PID:-?} ${CF_PID:-?}" > "$PROJ/.pids"
