# MedMind Plus — CLAUDE.md

## Visão Geral

App educacional gamificado para estudos com flashcards, quizzes, desafios diários, duelos 1v1, arenas em grupo, sistema de XP/ranking e chat em tempo real. PWA mobile-first.

## Stack Tecnológico

- **Frontend:** Vanilla JavaScript, HTML5, PWA
- **Backend:** Node.js
- **Database:** Firebase Firestore
- **Hosting:** Firebase Hosting
- **Tunnel:** Cloudflare
- **IA (Free):** Ollama local (qwen2.5:7b) — zero custo
- **IA (Plus/Pro):** Anthropic Haiku 4.5 API — com prompt caching
- **Pagamentos:** Stripe (checkout, webhooks, portal)
- **Ferramentas:** firebase-tools, firebase-admin, pdf-parse, stripe

## Planos de Assinatura

| Plano | Motor IA | Velocidade | Preço |
|-------|----------|-----------|-------|
| Free | Ollama local | ~20 min | Grátis |
| Plus | Haiku + delay | ~4 min | R$29/mês |
| Pro | Haiku full | ~30 seg | R$59/mês |

## Portas

- Backend local: 3737 (`server.js`)
- Flashcard server: 3739 (`flashcard-server.js`)
- Ollama: 11434 (local)

## Arquivos Principais

- `index.html` — Frontend completo (UI, lógica, módulos, landing page planos)
- `server.js` — Backend: AI router, geração de conteúdo, Stripe, limites
- `flashcard-server.js` — Serviço auxiliar de flashcards via AI
- `ai-router.js` — Roteamento de IA por plano (Ollama/Haiku)
- `ollama-client.js` — Cliente Ollama com fila de concorrência
- `plan-limits.js` — Definições de planos e controle de limites
- `stripe-handler.js` — Checkout, webhooks, portal Stripe
- `firebase.json` — Configuração Firebase
- `firestore.rules` — Regras de segurança (inclui subscriptions)
- `curated-seed.json` — Dados seed dos módulos de estudo
- `package.json` — Dependências do projeto

## Comandos Essenciais

```bash
./setup-ollama.sh           # Instalar Ollama + modelo (primeira vez)
./start.sh                  # Iniciar Ollama + Node.js + Tunnel
./stop.sh                   # Parar sistema
node server.js              # Iniciar backend local (sem Ollama/Tunnel)
firebase deploy             # Deploy hosting + rules
```

## Regras

- Nunca commitar `.env`, chaves Firebase ou API keys
- Código: inglês
- Documentação: português BR
- Use `setup-*.sh` para configurações de ambiente
