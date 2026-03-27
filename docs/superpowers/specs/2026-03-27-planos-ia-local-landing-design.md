# MedMind Plus — Planos de Assinatura + IA Local + Landing Page

**Data:** 2026-03-27
**Status:** Aprovado pelo usuario
**Escopo:** Sistema de 3 planos (Free/Plus/Pro), migracao para IA local no Free, landing page de vendas integrada ao app

---

## 1. Contexto

O MedMind Plus usa Claude Sonnet 4.6 via API paga para gerar modulos de estudo, quizzes, revisoes, flashcards e feedback. Atualmente tudo e gratis e ilimitado, sem monetizacao.

**Objetivo:** Criar 3 tiers de uso que:
- Eliminem custo de tokens no plano Free (Ollama local)
- Gerem receita com planos pagos (margem minima 90%)
- Criem upsell natural via diferenca de velocidade
- Incluam landing page de venda dentro do app

**Publico-alvo:** Estudantes de medicina (renda limitada, sensivel a preco).

---

## 2. Planos e Limites

### 2.1 Tabela de Planos

| | **Free** | **Plus (R$29/mes)** | **Pro (R$59/mes)** |
|---|---|---|---|
| Motor IA | Ollama (Qwen 2.5 7B) | Haiku 4.5 (Messages API + Cache) | Haiku 4.5 (full-speed) |
| Delay artificial | Nenhum (naturalmente lento) | Sim (20% do tempo Free) | Nenhum |
| Modulos/mes | 3 | 10 | 30 |
| Revisoes/mes | 5 | 15 | Ilimitado (fair-use) |
| Flashcard decks/mes | 10 | 30 | Ilimitado |
| Feedbacks/dia | 10 | 30 | Ilimitado |
| Acumulo diario | Sim | Sim | N/A |
| Badge no perfil | — | "Plus" | "Pro" |
| Prioridade na fila | Baixa | Media | Maxima |
| Suporte | Comunidade | Email | Prioritario |

### 2.2 Velocidade por Operacao

| Operacao | Free (Ollama) | Plus (Haiku+delay) | Pro (Haiku full) |
|----------|--------------|-------------------|------------------|
| Gerar modulo | ~20 min | ~4 min | ~15-30 seg |
| Gerar revisao (5 topics) | ~15 min | ~3 min | ~10-20 seg |
| Flashcards (15 cards) | ~8 min | ~1.5 min | ~10-15 seg |
| Feedback (1 questao) | ~20 seg | ~4 seg | ~1-2 seg |

### 2.3 Logica de Delay Artificial (Plus)

O Plus usa Haiku que responde em ~10-30s, mas adiciona delay artificial para diferenciar do Pro:

```javascript
const DELAY_FACTOR = 0.20; // 20% do tempo estimado do Free
const FREE_ESTIMATES = {
  module: 20 * 60 * 1000,    // 20 min
  revision: 15 * 60 * 1000,  // 15 min
  flashcards: 8 * 60 * 1000, // 8 min
  feedback: 20 * 1000,        // 20 seg
};

async function applyPlusDelay(feature) {
  const delay = FREE_ESTIMATES[feature] * DELAY_FACTOR;
  await new Promise(r => setTimeout(r, delay));
}
```

- Modulo: Haiku responde em ~20s, delay total = ~4 min (delay de ~3.5 min apos resposta)
- O delay e aplicado ANTES de retornar o resultado (processamento real ja concluido em background)
- Progress bar mostra "Processando com IA..." durante o delay

### 2.4 Logica de Acumulo

**Feedbacks diarios (Free e Plus):**
- Cada dia, feedbacks nao usados acumulam: `accumulated += (maxPerDay - usedToday)`
- Cap de acumulo: `accumulated <= maxPerDay * 30` (maximo 1 mes)
- Ao usar feedback: consome primeiro do `usedToday`, depois do `accumulated`
- Reset do acumulo: primeiro dia de cada mes, zera tudo

**Limites mensais (modulos, revisoes, flashdecks):**
- NAO acumulam entre dias (sao mensais, nao diarios)
- Reset no primeiro dia de cada mes
- Sem transbordo entre meses

**Pro (ilimitado):**
- Sem tracking de limites, apenas metricas de uso para analytics
- Fair-use: rate limit suave se >50 revisoes/mes ou >100 modulos/mes (notifica antes de limitar)

---

## 3. Viabilidade Financeira

### 3.1 Custo por Operacao (Haiku 4.5 + Prompt Cache)

| Operacao | Custo unitario | Calculo |
|----------|---------------|---------|
| Modulo completo (content+quiz) | R$0.17 | ~2K input cached + ~12K output @ Haiku rates |
| Revisao (5 topics, 15 calls) | R$0.42 | ~1K input × 15 + ~3K output × 15 |
| Flashcard deck (15 cards) | R$0.05 | ~1K input + ~4K output |
| Feedback (1 questao) | R$0.005 | ~500 input + ~300 output |

*(Cotacao: 1 USD = R$5.50, Haiku Messages API: $0.80/MTok input, $4.00/MTok output, cache read: 90% off input)*

### 3.2 Custo por Usuario (cenarios)

**Plus (R$29/mes):**
| Perfil | Uso mensal | Custo | Margem |
|--------|-----------|-------|--------|
| Leve (30%) | 3 mod, 5 rev, 10 flash, 50 fb | R$0.84 | 97.1% |
| Medio (60%) | 6 mod, 9 rev, 18 flash, 200 fb | R$1.92 | 93.4% |
| Pesado (100%) | 10 mod, 15 rev, 30 flash, 500 fb | R$3.37 | 88.4% |
| **Media ponderada** | | **~R$1.80** | **93.8%** |

**Pro (R$59/mes):**
| Perfil | Uso mensal | Custo | Margem |
|--------|-----------|-------|--------|
| Leve (30%) | 9 mod, 5 rev, 15 flash, 100 fb | R$1.89 | 96.8% |
| Medio (60%) | 18 mod, 12 rev, 40 flash, 300 fb | R$4.47 | 92.4% |
| Pesado (100%) | 30 mod, 30 rev, 80 flash, 800 fb | R$8.53 | 85.5% |
| **Media ponderada** | | **~R$4.20** | **92.9%** |

**Free:** R$0.00 (Ollama local, custo apenas energia do Mac Mini ~R$15/mes total)

### 3.3 Projecao de Receita (100 usuarios pagantes)

| Metrica | Plus (70%) | Pro (30%) | Total |
|---------|-----------|----------|-------|
| Usuarios | 70 | 30 | 100 |
| Receita mensal | R$2.030 | R$1.770 | **R$3.800** |
| Custo tokens | R$126 | R$126 | R$252 |
| Stripe (3.99% + R$0.39) | R$120 | R$94 | R$214 |
| Infra (Mac Mini) | — | — | R$50 |
| **Lucro liquido** | | | **R$3.284 (86.4%)** |

---

## 4. Arquitetura Tecnica

### 4.1 Novos Arquivos

| Arquivo | Descricao |
|---------|-----------|
| `ollama-client.js` | Camada de abstracao para Ollama (callLLM) |
| `ai-router.js` | Router que direciona chamadas por plano (Ollama/Haiku) |
| `plan-middleware.js` | Middleware de verificacao de limites |
| `stripe-webhook.js` | Handler de webhooks do Stripe |
| `setup-ollama.sh` | Script de setup do Ollama + modelo |

### 4.2 Arquivos Modificados

| Arquivo | Mudancas |
|---------|----------|
| `server.js` | Substituir callAnthropic por ai-router, adicionar endpoints Stripe, middleware de limites |
| `flashcard-server.js` | Substituir callAnthropic por ai-router |
| `index.html` | Adicionar landing page de planos, modal de upgrade, badges, barra de uso |
| `start.sh` | Adicionar checagem do Ollama |
| `stop.sh` | Opcional: flag para Ollama |
| `package.json` | Adicionar pdf-parse, stripe |
| `firestore.rules` | Adicionar collection subscriptions |
| `CLAUDE.md` | Atualizar stack |

### 4.3 Firestore — Collection `subscriptions/{userId}`

```javascript
{
  plan: "free" | "plus" | "pro",
  status: "active" | "canceled" | "past_due",
  stripeCustomerId: string | null,
  stripeSubscriptionId: string | null,
  currentPeriodStart: timestamp,
  currentPeriodEnd: timestamp,
  usage: {
    modulesUsed: number,
    revisionsUsed: number,
    flashdecksUsed: number,
    feedbacksUsedToday: number,
    feedbacksAccumulated: number,
    lastDailyReset: string, // YYYY-MM-DD
    lastMonthlyReset: string, // YYYY-MM
  },
  fairUse: {
    revisionsThisMonth: number, // Pro only
    modulesThisMonth: number,   // Pro only
  },
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### 4.4 Fluxo de AI Router

```
Request → plan-middleware (check limits) → ai-router → engine
                                              |
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                               callOllama  callHaiku  callHaiku
                               (Free)     +delay     (Pro)
                                          (Plus)
```

**ai-router.js** exporta `callAI({ plan, feature, payload })`:
1. Determina engine baseado no plano
2. Formata payload para o engine correto
3. Aplica delay artificial se Plus
4. Retorna resposta no formato padrao (compativel com parseAnthropicJSON existente)
5. Loga custo (R$0 para Ollama, calculado para Haiku)

### 4.5 Ollama Client (ollama-client.js)

Converte formato Anthropic para Ollama:
- `system` → `{role: "system"}` no messages array
- `max_tokens` → `options.num_predict`
- `temperature` → `options.temperature`
- `messages[].content` array → string concatenada (filtra {type: "document"})
- Adiciona `format: "json"` e `stream: false`
- Retorna `{ content: [{text}], usage: {input_tokens, output_tokens}, stop_reason }`
- Timeout: 15min para modulos, 5min para demais

### 4.6 Haiku Client (extensao do callAnthropic existente)

Reutiliza callAnthropic com:
- Modelo: `claude-haiku-4-5-20251001`
- Prompt caching: adiciona `cache_control: {type: "ephemeral"}` nos system prompts
- **Messages API padrao** para todas as operacoes (Batch API descartada — latencia imprevisivel de minutos a horas seria pior que Free em edge cases)
- Custo Haiku sem batch ainda e muito baixo (~R$0.17/modulo) e margem se mantem >90%

### 4.7 Extracao de PDF (para Ollama)

Ollama nao suporta PDF base64. Adicionar no server.js:

```javascript
const pdfParse = require('pdf-parse');

async function extractPdfText(base64Data) {
  const buffer = Buffer.from(base64Data, 'base64');
  const data = await pdfParse(buffer);
  return data.text.slice(0, 40000); // mesmo truncamento existente
}
```

Usar antes de enviar ao Ollama. Para Haiku, continuar usando formato base64 nativo.

### 4.8 Autenticacao de Usuarios nos Endpoints

**Problema:** Atualmente, endpoints de IA nao verificam identidade do usuario. Todos os endpoints que consomem limites ou acessam dados de assinatura precisam de auth.

**Solucao:** Criar `verifyUserToken(idToken)` (analogo ao existente `verifyAdminToken`):

```javascript
async function verifyUserToken(idToken) {
  // Verifica Firebase ID token via REST API
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    body: JSON.stringify({ idToken })
  });
  const data = await resp.json();
  if (!data.users?.[0]) throw new Error('Token invalido');
  return { uid: data.users[0].localId, email: data.users[0].email };
}
```

**Endpoints protegidos (requerem idToken no body ou header):**
- Todos os `/generate-*` (modulo, revisao, flashcards)
- `/revision-feedback`
- `/create-checkout-session`
- `/subscription-status`
- `/create-portal-session`
- `/save-*` (ja enviam userId, mas sem verificacao)

**Frontend:** Enviar `idToken` do Firebase Auth em todas as requests:
```javascript
const idToken = await firebase.auth().currentUser.getIdToken();
fetch('/generate-module', { body: JSON.stringify({ ...data, idToken }) });
```

### 4.9 Stripe Integration

**Endpoints novos no server.js:**
- `POST /create-checkout-session` — cria sessao Stripe para upgrade (requer auth)
- `POST /stripe-webhook` — recebe eventos do Stripe (sem auth, verificado por assinatura)
- `POST /create-portal-session` — redireciona para portal do Stripe (requer auth)
- `GET /subscription-status` — retorna plano e uso atual do usuario (requer auth)

**Seguranca do Webhook:**

```javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// CRITICO: webhook precisa do body RAW (nao parseado) para verificacao
// Adicionar handler ANTES do readBody() geral
if (req.url === '/stripe-webhook' && req.method === 'POST') {
  const rawBody = await getRawBody(req); // Buffer, nao JSON
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    res.writeHead(400); res.end('Webhook signature verification failed');
    return;
  }
  // Processar evento com idempotency check
  await processStripeEvent(event);
  res.writeHead(200); res.end('ok');
  return;
}
```

**Idempotency:** Salvar `event.id` processados no Firestore (`stripe_events/{eventId}`) para evitar duplicatas.

**HTTPS:** Cloudflare Tunnel ja termina TLS — Stripe envia para `https://medmind.win7med.com.br/stripe-webhook`, tunnel roteia para `http://localhost:3737`.

**Webhooks processados:**
- `checkout.session.completed` → cria/atualiza subscription no Firestore
- `invoice.paid` → renova periodo, reseta limites
- `customer.subscription.deleted` → downgrade para Free
- `customer.subscription.updated` → atualiza plano
- `invoice.payment_failed` → marca como past_due

**Chaves necessarias no .env:**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...  # usado no frontend para Stripe.js
STRIPE_PRICE_PLUS=price_...         # ID do preco Plus no Stripe
STRIPE_PRICE_PRO=price_...          # ID do preco Pro no Stripe
```

### 4.10 Firestore Security Rules (subscriptions)

```javascript
match /subscriptions/{userId} {
  // Leitura: apenas o proprio usuario ou admin
  allow read: if request.auth != null && (request.auth.uid == userId || request.auth.token.email == 'ranna@grupolead.com.br');
  // Escrita: APENAS server (Admin SDK) — NUNCA o cliente
  allow write: if false;
  // O servidor usa Firebase Admin SDK com service account para escrever
}

match /stripe_events/{eventId} {
  allow read, write: if false; // server-only
}
```

**CRITICO:** Subscriptions sao write-protected do lado do cliente. Toda escrita ocorre via server.js usando Firebase Admin SDK (service account). Isso impede que um usuario modifique seu proprio plano para Pro via DevTools.

### 4.11 Cron de Reset Diario

Adicionar ao server.js (ou cron externo):
- A cada hora: verificar se `lastDailyReset < hoje` para cada usuario ativo
- Se sim: acumular feedbacks nao usados, resetar `feedbacksUsedToday`
- No dia 1 de cada mes: resetar todos os contadores mensais
- **Retroactive accumulation:** se o servidor ficou fora por N dias, calcular `accumulated += maxPerDay * diasPerdidos` (cap no limite mensal)

### 4.12 Ollama — Gestao de Memoria e Modelo

**Modelo:** `qwen2.5:7b` (variante general, NAO coder) — ~5GB RAM, adequado para conteudo medico em portugues. O modelo de 14B foi descartado porque o Mac Mini roda PostgreSQL, Redis, Node.js (CRM 3300, n7n, evolution-api, etc.) simultaneamente — 14B (~10GB) causaria swap.

**Limites de concorrencia:**
- Maximo 1 request Ollama simultaneo (serializado internamente)
- Fila no ai-router: se Ollama esta ocupado, requests Free entram em fila com posicao informada ao usuario
- Requests Plus/Pro usam Haiku (API), nao competem pela fila do Ollama

**Health check:** antes de aceitar request Free, verificar:
```javascript
async function isOllamaHealthy() {
  try {
    const resp = await fetch('http://localhost:11434/api/tags', { timeout: 3000 });
    return resp.ok;
  } catch { return false; }
}
```

**Graceful degradation:** se Ollama esta fora:
- Retornar `{ error: "ai_unavailable", message: "IA local temporariamente indisponivel. Tente novamente em alguns minutos ou faca upgrade para Plus." }`
- Frontend mostra mensagem amigavel + CTA de upgrade
- Log alerta para monitoramento

### 4.13 Migracao de Usuarios Existentes

Usuarios atuais tem acesso ilimitado. Mudanca abrupta causaria frustracoes.

**Plano de migracao:**
1. **Semana 1-2:** Deploy silencioso do sistema de planos. Todos os usuarios existentes recebem `plan: "free"` mas com limites **dobrados** (6 mod, 10 rev, 20 flash, 20 fb/dia) por 30 dias
2. **Banner in-app:** "Novidade: MedMind agora tem planos! Seu acesso gratuito continua. Veja as opcoes."
3. **Apos 30 dias:** limites normais do Free entram em vigor
4. **Email (via n7n):** notificar usuarios ativos sobre a mudanca com 7 dias de antecedencia

### 4.14 Delay Artificial — Implementacao Robusta

O delay do Plus nao pode segurar resposta em memoria por minutos (risco de perda em restart).

**Implementacao:**
1. Haiku processa e resultado e salvo imediatamente no job (status: `delayed`)
2. `deliverAt` timestamp e calculado: `now + (FREE_ESTIMATE * 0.20)`
3. Polling `/job-status` retorna `status: "processing"` ate `deliverAt` ser atingido
4. Apos `deliverAt`, retorna `status: "ready"` com o resultado
5. Se servidor reiniciar, o resultado ja esta salvo — delay e recalculado

```javascript
if (job.status === 'delayed' && Date.now() >= job.deliverAt) {
  job.status = 'ready'; // libera resultado
}
```

---

## 5. Landing Page de Planos

### 5.1 Localizacao

Pagina integrada ao `index.html`, acessivel:
- Como tela inicial para usuarios nao logados (antes do login gate)
- Via menu/botao "Planos" para usuarios logados
- Via modal de upgrade quando limite e atingido

### 5.2 Estrutura

```
┌──────────────────────────────────────────────┐
│ HERO SECTION                                  │
│ "Estude medicina com IA personalizada"        │
│ "Modulos, quizzes, flashcards e feedback      │
│  gerados por inteligencia artificial"         │
│ [Comece gratis]  [Ver planos]                 │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ COMPARATIVO DE VELOCIDADE (animacao)          │
│                                               │
│ Free:  ████████████████████████████  20 min   │
│ Plus:  █████ 4 min                            │
│ Pro:   █ 30s                                  │
│                                               │
│ "A mesma qualidade. Velocidade diferente."    │
└──────────────────────────────────────────────┘

┌────────────┐ ┌────────────┐ ┌────────────┐
│   FREE     │ │   PLUS     │ │    PRO     │
│            │ │  R$29/mes  │ │  R$59/mes  │
│  Gratis    │ │            │ │ MAIS       │
│  pra       │ │ "5x mais   │ │ POPULAR    │
│  sempre    │ │  rapido"   │ │            │
│            │ │            │ │ "Instant-  │
│ 3 mod/mes  │ │ 10 mod/mes │ │  aneo"     │
│ 5 rev/mes  │ │ 15 rev/mes │ │            │
│ 10 flash   │ │ 30 flash   │ │ 30 mod/mes │
│ 10 fb/dia  │ │ 30 fb/dia  │ │ Ilimitado  │
│            │ │            │ │            │
│ ~20 min    │ │ ~4 min     │ │ ~30 seg    │
│ por gera-  │ │ por gera-  │ │ por gera-  │
│ cao        │ │ cao        │ │ cao        │
│            │ │            │ │            │
│ [Comecar]  │ │ [Assinar]  │ │ [Assinar]  │
└────────────┘ └────────────┘ └────────────┘

┌──────────────────────────────────────────────┐
│ TABELA COMPARATIVA DETALHADA                  │
│ Feature-by-feature comparison                 │
│ Checkmarks, limits, badges                    │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ COMO FUNCIONA O ACUMULO                       │
│ Ilustracao visual mostrando:                  │
│ - Dias sem usar = creditos acumulam           │
│ - Fim do mes = zera                           │
│ - Nao transborda entre meses                  │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ FAQ                                           │
│ - Posso trocar de plano a qualquer momento?   │
│ - Como funciona o acumulo de creditos?        │
│ - O que acontece quando atinjo o limite?      │
│ - Posso cancelar quando quiser?               │
│ - O plano Free tem limite de tempo?           │
│ - Qual a diferenca de qualidade entre planos? │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ CTA FINAL                                     │
│ "Comece gratis. Faca upgrade quando quiser."  │
│ [Criar conta gratis]                          │
└──────────────────────────────────────────────┘
```

### 5.3 Estilo Visual

- **Dark mode** consistente com o app (fundo #0a0a1a)
- **Gradiente principal**: roxo (#6c5ce7) para azul (#0984e3)
- **Cards**: glassmorphism (background blur, borda semi-transparente)
- **Badge "MAIS POPULAR"**: gradiente dourado no card Pro
- **Animacao de velocidade**: barras que crescem com timing real
- **Mobile-first**: cards empilhados em coluna no mobile, 3 colunas no desktop
- **Font**: system-ui (consistente com PWA)

### 5.4 Upsell Contextual (dentro do app)

Quando usuario Free/Plus gera conteudo:

```
┌──────────────────────────────────────┐
│ Gerando modulo com IA...             │
│ ████████░░░░░░░░░░ 42%              │
│ Tempo estimado: ~12 min restantes    │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ ⚡ No Plus: ~2.5 min             │ │
│ │ ⚡ No Pro:  ~15 seg              │ │
│ │ [Ver planos]                     │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

Quando limite e atingido:

```
┌──────────────────────────────────────┐
│ Voce usou 3/3 modulos este mes      │
│                                      │
│ Faca upgrade para continuar gerando: │
│ Plus: 10 modulos/mes — R$29         │
│ Pro:  30 modulos/mes — R$59         │
│                                      │
│ [Upgrade para Plus]  [Upgrade Pro]   │
│ Renova em: 5 dias                    │
└──────────────────────────────────────┘
```

---

## 6. Otimizacao de Prompts para Ollama

Modelos locais 14B precisam de prompts mais explicitos. Ajustes nos system prompts existentes:

1. Adicionar exemplo JSON completo (2-3 itens) em cada prompt
2. Reforcar: "Responda APENAS com JSON valido. Sem markdown. Sem explicacoes."
3. Reduzir expectativas de output: max 5 secoes por modulo, resumoHTML max 200 palavras
4. Manter todos os prompts em portugues BR

---

## 7. Setup de Infraestrutura

### 7.1 Ollama

```bash
brew install ollama
ollama pull qwen2.5:7b    # General model (NAO coder), ~5GB RAM
# Verificar: curl http://localhost:11434/api/tags
```

Adicionar ao `start.sh`: verificacao de Ollama rodando + modelo disponivel.

### 7.2 Stripe

- Criar conta Stripe (stripe.com)
- Criar 2 Products: "MedMind Plus" (R$29/mes) e "MedMind Pro" (R$59/mes)
- Configurar webhook URL: `https://medmind.win7med.com.br/stripe-webhook`
- Salvar `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` no .env

### 7.3 Dependencias

```bash
npm install pdf-parse stripe
```

---

## 8. Verificacao / Testes

1. **Ollama**: `curl http://localhost:11434/api/tags` — modelo carregado
2. **Free flow**: gerar flashcards via Ollama — JSON valido, ~8 min
3. **Plus flow**: gerar flashcards via Haiku — delay artificial ~1.5 min
4. **Pro flow**: gerar flashcards via Haiku — full speed ~15 seg
5. **Limites**: exceder limite no Free — modal de upgrade aparece
6. **Acumulo**: nao usar feedbacks por 3 dias — acumulo correto
7. **Reset mensal**: simular virada de mes — contadores zerados
8. **Stripe checkout**: criar assinatura Plus — webhook atualiza Firestore
9. **Stripe cancelamento**: cancelar — downgrade para Free
10. **Landing page**: acessar sem login — landing renderiza corretamente
11. **Upsell**: gerar modulo no Free — comparativo de velocidade aparece
12. **PDF no Ollama**: enviar PDF base64 — extracao de texto funciona
13. **Concurrent requests**: 2 usuarios simultaneos — Ollama enfileira corretamente
14. **Cost logging**: gerar com Haiku — custo logado corretamente em api-costs.jsonl
15. **Admin dashboard**: ver custos por plano — breakdown correto
