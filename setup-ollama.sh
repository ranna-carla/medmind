#!/bin/bash
# setup-ollama.sh — Instala e configura Ollama para MedMind Free tier
echo "=== MedMind — Setup Ollama ==="

if ! command -v ollama &> /dev/null; then
  echo "Instalando Ollama..."
  brew install ollama
fi

echo "Iniciando Ollama..."
ollama serve &
sleep 3

echo "Baixando modelo qwen2.5:7b (~5GB)..."
ollama pull qwen2.5:7b

echo "Testando..."
RESULT=$(curl -s http://localhost:11434/api/chat -d '{
  "model": "qwen2.5:7b",
  "messages": [{"role": "user", "content": "Responda em JSON: {\"ok\": true}"}],
  "format": "json",
  "stream": false
}')
echo "Resposta: $RESULT"

echo ""
echo "Setup concluido! Modelo qwen2.5:7b pronto."
