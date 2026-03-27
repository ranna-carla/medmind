# MedMind Plus — CLAUDE.md

## Visão Geral

App educacional gamificado para estudos com flashcards, quizzes, desafios diários, duelos 1v1, arenas em grupo, sistema de XP/ranking e chat em tempo real. PWA mobile-first.

## Stack Tecnológico

- **Frontend:** Vanilla JavaScript, HTML5, PWA
- **Backend:** Node.js
- **Database:** Firebase Firestore
- **Hosting:** Firebase Hosting
- **Tunnel:** Cloudflare
- **API:** Claude AI
- **Ferramentas:** firebase-tools ^15.11.0

## Portas

- Backend local: configurável em `server.js`

## Arquivos Principais

- `index.html` — Frontend completo (UI, lógica, módulos, config Firebase)
- `server.js` — Backend: proxy Claude API, geração de conteúdo
- `flashcard-server.js` — Serviço de geração de flashcards via AI
- `firebase.json` — Configuração Firebase
- `firestore.rules` — Regras de segurança Firestore
- `curated-seed.json` — Dados seed dos módulos de estudo
- `cloudflare-tunnel.yml` — Configuração Cloudflare Tunnel
- `package.json` — Dependências do projeto

## Comandos Essenciais

```bash
node server.js              # Iniciar backend local
firebase deploy             # Deploy hosting + rules
./start.sh                  # Iniciar sistema
./stop.sh                   # Parar sistema
```

## Regras

- Nunca commitar `.env`, chaves Firebase ou API keys
- Código: inglês
- Documentação: português BR
- Use `setup-*.sh` para configurações de ambiente
