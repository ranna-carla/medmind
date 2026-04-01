# MedMind Plus — CLAUDE.md

## Visão Geral

App educacional gamificado para estudos com flashcards, quizzes e desafios diários. PWA mobile-first com planos de assinatura (Free/Plus/Pro), sistema de ranking, IA local e pagamentos integrados.

## Stack Tecnológico

- **Frontend:** Vanilla JavaScript, HTML5, PWA
- **Backend:** Node.js
- **Database:** Firebase Firestore
- **Hosting:** Firebase Hosting + Cloudflare Tunnel
- **IA (Free):** Ollama local (qwen2.5:7b)
- **IA (Plus/Pro):** Anthropic Haiku API
- **Pagamentos:** Stripe (checkout, webhooks, portal)
- **Extras:** PDF parsing (pdf-parse), admin dashboard, whitelabel

## Portas

- Backend: 3737 (`server.js`)
- Flashcard server: 3739 (`flashcard-server.js`)
- Ollama: 11434

## Arquivos Principais

- `index.html` — Frontend completo (UI, landing planos, modais upsell)
- `server.js` — Router IA, geração conteúdo, Stripe, limites
- `flashcard-server.js` — Serviço dedicado flashcards
- `ai-router.js` — Roteamento IA por plano
- `ollama-client.js` — Cliente Ollama com controle concorrência
- `plan-limits.js` — Limites por plano
- `firestore.rules` — Regras segurança
- `curated-seed.json` — Seed inicial módulos
- `firebase.json` — Configuração Firebase
- `WHITELABEL.md` — Documentação whitelabel

## Comandos Essenciais

```bash
./setup-ollama.sh    # Instalar Ollama
./start.sh           # Iniciar serviços
npm run deploy       # Firebase deploy
```

## Regras

- Nunca commitar `.env`, chaves Firebase ou API keys
- Código em inglês, documentação em português BR
- Manter compatibilidade PWA e mobile-first
