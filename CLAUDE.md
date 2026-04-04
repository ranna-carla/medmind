# MedMind Plus — CLAUDE.md

## Visão Geral

App educacional gamificado para estudos com flashcards, quizzes e desafios diários. PWA mobile-first com planos de assinatura (Free/Plus/Pro), ranking de usuários, IA local e pagamentos via Stripe.

## Stack Tecnológico

- **Frontend:** Vanilla JavaScript, HTML5, PWA
- **Backend:** Node.js
- **Database:** Firebase Firestore
- **Hosting:** Firebase Hosting + Cloudflare Tunnel
- **IA (Free):** Ollama local (qwen2.5:7b)
- **IA (Plus/Pro):** Anthropic Haiku API
- **Pagamentos:** Stripe (checkout, webhooks, portal)
- **Dependências:** firebase-admin, firebase-tools, pdf-parse, stripe

## Portas

- Backend: 3737 (`server.js`)
- Flashcard server: 3739 (`flashcard-server.js`)
- Ollama: 11434

## Arquivos Principais

- `index.html` — Frontend completo
- `server.js` — Router principal, IA e Stripe
- `flashcard-server.js` — Serviço dedicado flashcards
- `ai-router.js` — Roteamento IA por plano
- `ollama-client.js` — Cliente Ollama com controle de concorrência
- `plan-limits.js` — Limites por plano de assinatura
- `firestore.rules` — Regras de segurança
- `firebase.json` — Configuração Firebase
- `WHITELABEL.md` — Documentação whitelabel

## Comandos Essenciais

```bash
./setup-ollama.sh      # Instalar Ollama
./start.sh             # Iniciar todos os serviços
npm run deploy         # Deploy Firebase
```

## Regras

- Nunca commitar `.env`, chaves Firebase ou credenciais
- Código em inglês, documentação em português BR
- Manter compatibilidade PWA e mobile-first
