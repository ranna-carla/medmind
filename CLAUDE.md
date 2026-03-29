# MedMind Plus — CLAUDE.md

## Visão Geral

App educacional gamificado para estudos com flashcards, quizzes, desafios diários e sistema de ranking. PWA mobile-first com planos de assinatura (Free/Plus/Pro) e suporte a IA local ou via API.

## Stack Tecnológico

- **Frontend:** Vanilla JavaScript, HTML5, PWA
- **Backend:** Node.js
- **Database:** Firebase Firestore
- **Hosting:** Firebase Hosting
- **Tunnel:** Cloudflare
- **IA (Free):** Ollama local (qwen2.5:7b)
- **IA (Plus/Pro):** Anthropic Haiku 4.5 API
- **Pagamentos:** Stripe (checkout, webhooks, portal)
- **Dependências:** firebase-admin, firebase-tools, pdf-parse, stripe

## Portas

- Backend local: 3737 (`server.js`)
- Flashcard server: 3739 (`flashcard-server.js`)
- Ollama: 11434

## Arquivos Principais

- `index.html` — Frontend completo (UI, módulos, landing page planos)
- `server.js` — Backend: router IA, geração conteúdo, Stripe, limites
- `flashcard-server.js` — Serviço auxiliar de flashcards
- `ai-router.js` — Roteamento IA por plano (Ollama/Haiku)
- `ollama-client.js` — Cliente Ollama com fila de concorrência
- `plan-limits.js` — Definições de planos e controle de limites
- `firebase.json` — Configuração Firebase
- `firestore.rules` — Regras de segurança
- `curated-seed.json` — Dados seed dos módulos

## Comandos Essenciais

```bash
./setup-ollama.sh    # Instalar Ollama + modelo
./start.sh           # Iniciar Ollama, Node.js e Tunnel
npm run deploy       # Firebase deploy (hosting + rules)
```

## Regras

- Nunca commitar `.env`, chaves Firebase ou API keys
- Código em inglês
- Documentação em português BR
