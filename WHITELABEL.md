# MedMind — Guia de White-Label

Como duplicar o MedMind para qualquer area de estudo (Direito, ENEM, Ensino Medio, Concursos, etc).

---

## Visao Geral

O MedMind e um app educativo gamificado com:
- Modulos de estudo (resumos + quizzes)
- Flashcards com IA
- Revisoes com IA
- Desafio Diario + Duelos 1v1 + Arenas em grupo
- Chat em tempo real nas arenas
- Sistema de XP, niveis e ranking
- Sistema de amigos
- PWA (instala no celular)

Toda a aplicacao esta em **3 arquivos principais**:

| Arquivo | O que contem |
|---------|-------------|
| `index.html` | Todo o frontend (UI, logica, modulos, Firebase config) |
| `server.js` | Backend (proxy Claude API, endpoints de geracao de conteudo) |
| `firestore.rules` | Regras de seguranca do Firestore |

---

## Passo a Passo para Criar uma Nova Versao

### 1. Copiar o Projeto

```bash
cp -r medmindplus/ novo-projeto/
cd novo-projeto/
rm -rf node_modules logs .git
git init
npm install
```

### 2. Criar Projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com)
2. Crie um novo projeto (ex: `direitomind-pro`)
3. Ative: **Authentication** (Google + Email), **Firestore**, **Storage**
4. Copie as credenciais do projeto

### 3. Configurar Firebase

**Em `index.html` (linha ~517):**
```javascript
firebase.initializeApp({
  apiKey: "SUA_API_KEY",
  authDomain: "SEU-PROJETO.firebaseapp.com",
  projectId: "SEU-PROJETO",
  storageBucket: "SEU-PROJETO.firebasestorage.app",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
});
```

**Em `server.js` (linhas 195-197):**
```javascript
const FIREBASE_API_KEY = 'SUA_API_KEY';
const FIREBASE_PROJECT  = 'SEU-PROJETO';
const ADMIN_EMAIL       = 'seu@email.com';
```

**Em `firestore.rules` (linha 7):**
```javascript
function isAdmin() {
  return request.auth != null && request.auth.token.email == 'seu@email.com';
}
```

### 4. Deploy das Regras

```bash
npx firebase-tools deploy --only firestore:rules --project SEU-PROJETO
```

---

## Personalizacao da Marca

### Nome do App

Alterar em `index.html`:

| Linha | O que mudar |
|-------|------------|
| 9 | `apple-mobile-web-app-title` → nome curto |
| 12 | `meta description` → descricao do app |
| 13 | `<title>` → titulo da aba |
| 15 | Manifest PWA: `name`, `short_name` |
| ~462, ~487 | Tela de login/gate |
| ~739 | Dialogo de logout |

**Buscar e substituir:** `MedMind` → `NomeDoSeuApp`

### Icone do App (PWA)

Na linha 15, alterar o emoji do icone SVG:
```
🧠  →  ⚖️ (Direito)
🧠  →  📝 (ENEM)
🧠  →  📚 (Ensino Medio)
```

### Cores

Em `index.html` (linha ~41), alterar as variaveis CSS:

```css
:root {
  /* === CORES PRINCIPAIS === */
  --accent: #6c5ce7;        /* Cor principal (botoes, destaques) */
  --accent2: #a29bfe;       /* Cor principal clara */
  --accent-bg: rgba(108,92,231,.12);
  --accent-border: rgba(108,92,231,.25);
  --pink: #e84393;          /* Cor secundaria */
  --gold: #f9ca24;          /* Streak/conquistas */
  --green: #00b894;         /* Acerto/sucesso */
  --red: #ff6b6b;           /* Erro */

  /* === FUNDOS === */
  --bg: #080e1a;            /* Fundo principal */
  --bg2: #0f1729;           /* Fundo secundario */
  --bg3: #172035;           /* Fundo terciario */

  /* === TEXTO === */
  --text: #eef2f7;          /* Texto principal */
  --dim: #7b8ba5;           /* Texto secundario */
}
```

**Sugestoes de cores por area:**

| Area | --accent | --pink | Vibe |
|------|----------|--------|------|
| Medicina | `#6c5ce7` (roxo) | `#e84393` (rosa) | Profissional |
| Direito | `#c0392b` (vermelho) | `#e67e22` (laranja) | Classico |
| ENEM | `#2980b9` (azul) | `#27ae60` (verde) | Governo |
| Ensino Medio | `#f39c12` (amarelo) | `#8e44ad` (roxo) | Jovem |
| Concursos | `#2c3e50` (escuro) | `#16a085` (teal) | Serio |

### Fontes

Linha 17 — trocar se quiser outra fonte:
```html
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap">
```

---

## Sistema de Niveis

Em `index.html` (linha ~800), alterar os niveis para a area:

### Medicina (atual)
```javascript
const LEVELS=[
  {name:'Calouro',emoji:'🔬',xp:0},
  {name:'Academico',emoji:'🧪',xp:200},
  {name:'Monitor',emoji:'📚',xp:500},
  {name:'Interno',emoji:'🏥',xp:1000},
  {name:'Residente',emoji:'🩺',xp:2000},
  {name:'Especialista',emoji:'⚕️',xp:4000},
  {name:'Preceptor',emoji:'🎓',xp:7000},
  {name:'Mestre',emoji:'🧠',xp:12000},
  {name:'Doutor',emoji:'🏆',xp:20000},
  {name:'Catedratico',emoji:'👑',xp:35000}
];
```

### Direito (exemplo)
```javascript
const LEVELS=[
  {name:'Calouro',emoji:'📖',xp:0},
  {name:'Estagiario',emoji:'📋',xp:200},
  {name:'Bacharel',emoji:'🎓',xp:500},
  {name:'Advogado',emoji:'⚖️',xp:1000},
  {name:'Especialista',emoji:'📜',xp:2000},
  {name:'Mestre',emoji:'🏛️',xp:4000},
  {name:'Doutor',emoji:'📕',xp:7000},
  {name:'Professor',emoji:'👨‍🏫',xp:12000},
  {name:'Desembargador',emoji:'🔨',xp:20000},
  {name:'Ministro',emoji:'👑',xp:35000}
];
```

### ENEM (exemplo)
```javascript
const LEVELS=[
  {name:'Iniciante',emoji:'📝',xp:0},
  {name:'Estudante',emoji:'📚',xp:200},
  {name:'Dedicado',emoji:'💪',xp:500},
  {name:'Focado',emoji:'🎯',xp:1000},
  {name:'Avancado',emoji:'⚡',xp:2000},
  {name:'Fera',emoji:'🔥',xp:4000},
  {name:'Nota 800',emoji:'⭐',xp:7000},
  {name:'Nota 900',emoji:'🏆',xp:12000},
  {name:'Nota 1000',emoji:'👑',xp:20000},
  {name:'Lenda',emoji:'💎',xp:35000}
];
```

---

## Constantes de XP

Em `index.html` (linha ~801):

```javascript
const XP_CORRECT = 15;   // Pontos por acerto
const XP_WRONG = 2;      // Pontos por erro (participacao)
const XP_STREAK = 5;     // Bonus por sequencia
const XP_PERFECT = 50;   // Bonus por 100% no quiz
```

---

## Estrutura dos Modulos

Cada modulo segue esta estrutura. Substituir o conteudo pela materia desejada:

```javascript
{
  id: 'direito-constitucional',     // Slug unico (kebab-case)
  name: 'Direito Constitucional',   // Nome exibido
  desc: 'Principios, Direitos Fundamentais', // Subtitulo
  icon: '⚖️',                       // Emoji do modulo
  color: '#c0392b',                 // Cor do modulo
  locked: false,                    // true = bloqueado (em breve)

  tabs: [
    {id:'resumo', label:'📄 Resumo'},
    {id:'principios', label:'🏛️ Principios'},
    {id:'direitos', label:'✊ Direitos'},
    {id:'quiz', label:'📝 Quiz'}
  ],

  sections: {
    resumo: {
      title: 'Visao Geral',
      cards: [
        {
          t: 'O que e Direito Constitucional?',
          b: '<p>Ramo do direito publico que...</p>'
        },
        {
          t: 'Constituicao Federal de 1988',
          b: '<p>Conhecida como "Constituicao Cidada"...</p>'
        }
      ]
    },
    principios: {
      theme: 'esp',  // Reutilizar temas de cor existentes
      title: 'Principios Fundamentais',
      flow: ['Soberania', 'Cidadania', 'Dignidade', 'Valores Sociais'],
      cards: [
        {t: 'Soberania', b: '<p>Art. 1, I — ...</p>'},
        {t: 'Cidadania', b: '<p>Art. 1, II — ...</p>'}
      ]
    }
  },

  quiz: {
    obj: [  // 15 questoes objetivas (minimo)
      {
        q: 'Qual principio esta no Art. 1, I da CF/88?',
        opts: ['Soberania','Cidadania','Dignidade','Pluralismo'],
        ans: 0,  // Indice da resposta correta (0-based)
        exp: 'Art. 1, I — A soberania e...',
        tag: 'Principios'
      }
      // ... mais 14 questoes
    ],
    esc: [  // 7 questoes dissertativas
      {
        q: 'Explique o principio da dignidade da pessoa humana.',
        ans: 'A dignidade da pessoa humana e...',
        tag: 'Principios'
      }
    ],
    pra: [  // 5 casos praticos
      {
        q: 'Uma lei estadual proibe manifestacoes em praca publica...',
        ans: 'A lei e inconstitucional por violar...',
        tag: 'Caso Pratico'
      }
    ]
  }
}
```

---

## Prompts da IA

Em `server.js`, os prompts do Claude geram conteudo automaticamente. Alterar para a area desejada:

### Prompt de Geracao de Modulo (linha ~104)
Trocar: `"especialista em criar módulos de estudo para o app MedMind (medicina)"`
Por: `"especialista em criar módulos de estudo para o app [NomeApp] ([area])"`

### Prompt de Quiz (linha ~140)
Trocar contexto de medicina para a area desejada.

### Prompt de Revisao (linhas ~155-165)
Trocar referencias a medicina.

### Prompt de Flashcards (linha ~170)
Trocar contexto.

**Dica:** Buscar `medicina` e `MedMind` em server.js e substituir.

---

## Textos de Compartilhamento

Em `index.html`, buscar e alterar:

| Onde | Texto atual | Exemplo Direito |
|------|-------------|-----------------|
| Convite amigo | "Estude comigo no MedMind!" | "Estude comigo no DireitoMind!" |
| Duelo | "Te desafio no MedMind! ⚔️" | "Te desafio no DireitoMind! ⚔️" |
| Arena | "Entre na minha arena no MedMind!" | "Entre na minha arena no DireitoMind!" |

---

## Porta do Servidor

Em `server.js` (linha 6):
```javascript
const PORT = 3737;  // Mudar para porta livre
```

Atualizar tambem no Cloudflare Tunnel (`/etc/cloudflared/config.yml`).

---

## Checklist de White-Label

```
[ ] 1. Copiar projeto e limpar git
[ ] 2. Criar projeto Firebase (Auth + Firestore + Storage)
[ ] 3. Atualizar Firebase config (index.html + server.js)
[ ] 4. Atualizar email admin (server.js + firestore.rules)
[ ] 5. Deploy firestore.rules
[ ] 6. Buscar/substituir "MedMind" pelo novo nome
[ ] 7. Buscar/substituir "medicina" pela nova area
[ ] 8. Atualizar cores CSS (--accent, --pink, etc)
[ ] 9. Atualizar LEVELS (nomes e emojis)
[ ] 10. Atualizar/substituir MODULES com conteudo da area
[ ] 11. Atualizar prompts do Claude em server.js
[ ] 12. Atualizar porta do servidor
[ ] 13. Configurar Cloudflare Tunnel (subdominio)
[ ] 14. Testar: login, modulos, quiz, flashcards, desafios
[ ] 15. Commit e deploy
```

---

## Colecoes do Firestore (referencia)

| Colecao | Uso |
|---------|-----|
| `users` | Perfis dos usuarios |
| `generatedModules` | Modulos gerados por IA |
| `curatedModules` | Modulos curados pelo admin |
| `revisions` | Revisoes de estudo |
| `flashdecks` | Decks de flashcards |
| `duels` | Duelos 1v1 |
| `challenges` | Arenas de grupo |
| `challenges/{id}/messages` | Chat das arenas |
| `dailyChallenge` | Desafio diario |
| `ranking` | Ranking de XP |
| `friendRequests` | Solicitacoes de amizade |
| `suggestions` | Sugestoes dos usuarios |

---

## Estrutura de Arquivos

```
projeto/
├── index.html          # Frontend completo (SPA)
├── server.js           # Backend Node.js
├── admin.html          # Painel admin (curadoria)
├── firestore.rules     # Regras Firestore
├── storage.rules       # Regras Storage
├── firebase.json       # Config Firebase CLI
├── package.json        # Dependencias
├── curated-seed.json   # Seed de modulos (opcional)
└── logs/               # Logs do servidor
```

---

## Suporte

Duvidas sobre a implementacao: consultar o `CLAUDE.md` do projeto principal ou abrir uma conversa com o Claude Code no diretorio do novo projeto.
