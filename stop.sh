#!/bin/bash
# MedMind — Parar todos os processos

PROJ="/Users/Shared/projects/medmindplus"

pkill -f "node $PROJ/server.js" 2>/dev/null && echo "Servidor Node parado." || echo "Node não estava rodando."
pkill -f "cloudflared tunnel" 2>/dev/null && echo "Cloudflare Tunnel parado." || echo "Tunnel não estava rodando."
rm -f "$PROJ/.pids"
