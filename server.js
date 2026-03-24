// MedMind — Servidor local + proxy Claude API
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = 3737;
const ROOT = __dirname;

// Lê API key — tenta imagex-ris primeiro, depois medmind
function getAnthropicKey() {
  try {
    const env = fs.readFileSync('/Users/macmini-win7/projects/projects/imagex-ris/.env', 'utf8');
    const m = env.match(/ANTHROPIC_API_KEY=(.+)/);
    if (m && m[1].trim().startsWith('sk-ant-')) return m[1].trim();
  } catch {}
  try {
    const env = fs.readFileSync('/etc/claude-hub/api-keys.env', 'utf8');
    const m = env.match(/ANTHROPIC_API_KEY_PRODUCAO=(.+)/);
    if (m) return m[1].trim();
  } catch {}
  return '';
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// Jobs em memória { jobId: { status, module, error, progress, createdAt } }
const jobs = {};

// Limpa jobs com mais de 1 hora
setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const id of Object.keys(jobs)) {
    if (jobs[id].createdAt < cutoff) delete jobs[id];
  }
}, 300000);

// Baixa URL como Buffer (segue redirects)
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Lê body de um request POST (suporta até 20MB para PDFs em base64)
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 60*1024*1024) { reject(new Error('Payload muito grande (máx 60MB)')); return; } chunks.push(c); });
    req.on('end',  () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); }});
    req.on('error', reject);
  });
}

// Chama Anthropic API (timeout de 5 min)
function callAnthropic(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         getAnthropicKey(),
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(300000, () => { req.destroy(); reject(new Error('Anthropic API timeout (5min)')); });
    req.write(body);
    req.end();
  });
}

// Prompt 1: gera apenas conteúdo (resumo + seções)
const PROMPT_CONTENT = `Você é um especialista em criar módulos de estudo para o app MedMind (medicina).
Dado o conteúdo de um PDF, gere o CONTEÚDO do módulo em JSON.
Retorne APENAS o JSON puro, sem markdown, sem blocos de código, sem explicações.
NÃO inclua o campo "quiz" — ele será gerado separadamente.

REGRA CRÍTICA: Todas as aspas dentro de valores string devem ser escapadas como \\". Nunca use aspas duplas não-escapadas dentro de strings JSON.

Schema exato:
{
  "id": "slug-unico-kebab-case",
  "name": "Nome completo do módulo",
  "icon": "emoji relevante ao tema",
  "desc": "Uma linha descrevendo o conteúdo (disciplina + tema)",
  "color": "#hexcolor (use cores vivas: #6c5ce7 #00b894 #e84393 #e17055 #0984e3 #fdcb6e)",
  "locked": false,
  "tabs": [
    {"id":"resumo","label":"📖 Resumo"},
    {"id":"SECID","label":"EMOJI Nome da Seção"}
  ],
  "resumoHTML": "<h2>Titulo</h2><p>Texto com <strong>destaques</strong></p><ul><li>item</li></ul>. Tags: h2,h3,p,strong,em,ul,li,table,tr,td,th. Mínimo 300 palavras. Aspas simples em atributos HTML.",
  "sections": {
    "SECID": {
      "theme": "esp",
      "title": "Título da Seção",
      "flow": ["Etapa 1","Etapa 2","Etapa 3"],
      "cards": [
        {"t":"Título do card","b":"<p>Conteúdo com <strong>destaques</strong>. Use aspas simples em atributos HTML.</p>"}
      ]
    }
  }
}

Themes disponíveis: esp, ovo, fec, s1, s2, temp, perda, termo, febr, gast
Use temas variados. Mínimo 3 sections. Conteúdo completo e detalhado.`;

// Prompt 2: gera apenas o quiz
const PROMPT_QUIZ = `Você é um especialista em questões médicas para o app MedMind.
Dado o conteúdo de um PDF, gere APENAS o quiz em JSON.
Retorne APENAS o JSON puro, sem markdown, sem blocos de código, sem explicações.

Schema exato:
{
  "quiz": {
    "obj": [EXATAMENTE 15 objetos: {"q":"Pergunta?","opts":["A. opção","B. opção","C. opção","D. opção"],"a":INDEX_CORRETO,"exp":"Explicação clara"}],
    "esc": [EXATAMENTE 7 objetos: {"q":"Pergunta dissertativa?","ans":"Resposta modelo completa"}],
    "pra": [EXATAMENTE 5 objetos: {"q":"Caso clínico detalhado...","ans":"Conduta e raciocínio clínico"}]
  }
}`;

// Prompt 3: revisão — 3 prompts especializados (rodam em paralelo)
const PROMPT_REV_OBJ = `Gere EXATAMENTE 7 questões objetivas de medicina sobre o tema dado.
Retorne APENAS JSON puro: [{"q":"Pergunta?","opts":["A","B","C","D","E"],"a":INDEX_0a4,"exp":"Explicação"}]
'a' é ÍNDICE numérico (0-4). Opções SEM prefixo "A.". EXATAMENTE 5 opções por questão.`;

const PROMPT_REV_ESC = `Gere EXATAMENTE 5 questões dissertativas de medicina sobre o tema dado.
Retorne APENAS JSON puro: [{"q":"Pergunta?","ans":"Resposta modelo completa"}]`;

const PROMPT_REV_PRA = `Gere EXATAMENTE 3 casos clínicos de medicina sobre o tema dado.
Cada caso: anamnese breve, exames, achados. Pergunta sobre conduta.
Retorne APENAS JSON puro: [{"q":"Caso clínico...","ans":"Conduta e raciocínio clínico"}]`;

// Compat: mantém PROMPT_REVISION para referência
const PROMPT_REVISION = PROMPT_REV_OBJ;

// Prompt 4: gera flashcards para memorização
const PROMPT_FLASHCARDS = `Gere flashcards de recall rápido para estudantes de medicina.

REGRAS OBRIGATÓRIAS:
- FRENTE: pergunta CURTA testando 1 conceito. Máximo 1-2 frases. Ex: "Qual estrutura induz a placa neural?", "Defeito do fechamento cranial do tubo neural?"
- VERSO: resposta CURTA. Máximo 1-2 frases ou palavra-chave. Ex: "Notocorda", "Anencefalia", "3 Na+ pra fora, 2 K+ pra dentro"
- NUNCA parágrafos longos. Flashcard testa recall, não explica conteúdo.
- Perguntas diretas: "O que é X?", "Qual a função de Y?", "Onde ocorre Z?", "Qual o mecanismo de X?"
- Varie: definições, mecanismos, classificações, valores, tratamentos

Retorne APENAS JSON puro: {"cards":[{"front":"pergunta curta","back":"resposta curta"}]}`;

// Prompt 5: feedback individual para resposta do aluno
const PROMPT_FEEDBACK = `Você é um professor de medicina avaliando a resposta de um aluno.
Compare a resposta do aluno com a resposta modelo esperada.
Dê um feedback construtivo em 2-3 frases curtas:
- O que o aluno acertou
- O que faltou ou está incorreto
- Nota de 0 a 10

Retorne APENAS JSON: {"feedback":"texto do feedback","score":N}`;

const FIREBASE_API_KEY = 'AIzaSyCvoPA9OOC3o42ERViKs1IjRIOuwOon0UU';
const FIREBASE_PROJECT  = 'medmind-pro';
const ADMIN_EMAIL       = 'ranna@grupolead.com.br';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

// Verifica se o ID token pertence ao admin e retorna { uid, email }
function verifyAdminToken(idToken) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ idToken });
    const req = https.request({
      hostname: 'identitytoolkit.googleapis.com',
      path: `/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          const user = json.users && json.users[0];
          if (!user) return reject(new Error('Token inválido'));
          if (user.email !== ADMIN_EMAIL) return reject(new Error('Acesso negado'));
          resolve({ uid: user.localId, email: user.email });
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout ao verificar token')); });
    req.write(body);
    req.end();
  });
}

// Envia email de reset de senha via Firebase Auth REST
function sendPasswordReset(email) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ requestType: 'PASSWORD_RESET', email });
    const req = https.request({
      hostname: 'identitytoolkit.googleapis.com',
      path: `/v1/accounts:sendOobCode?key=${FIREBASE_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.error) return reject(new Error(json.error.message || 'Erro Firebase'));
          resolve(json);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// Apaga documento do Firestore via REST usando o token do admin
function deleteFirestoreDoc(collection, docId, idToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}/${docId}`,
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + idToken }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 204) return resolve(true);
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          reject(new Error(json.error?.message || 'Erro ao deletar'));
        } catch { reject(new Error('Erro ao deletar doc')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// Atualiza campos do Firestore via PATCH REST
function patchFirestoreDoc(collection, docId, fields, idToken) {
  return new Promise((resolve, reject) => {
    const firestoreFields = {};
    for (const k of Object.keys(fields)) firestoreFields[k] = toFirestoreValue(fields[k]);
    const body = JSON.stringify({ fields: firestoreFields });
    const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/${collection}/${docId}?${updateMask}`,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (json.error) return reject(new Error(json.error.message || 'Erro ao atualizar'));
          resolve(json);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// Extrai e valida JSON de uma resposta Anthropic
function parseAnthropicJSON(result, label) {
  if (result?.type === 'error') throw new Error('Anthropic API (' + label + '): ' + (result?.error?.message || JSON.stringify(result.error)));
  const raw = result?.content?.[0]?.text || '';
  if (!raw) throw new Error('Resposta vazia (' + label + '). stop_reason: ' + (result?.stop_reason || '?'));
  // Remove markdown code fences e caracteres de controle
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  cleaned = cleaned.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
  // Tenta parse direto primeiro
  try { return JSON.parse(cleaned); } catch {}
  // Fallback: extrai objeto JSON
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON ausente (' + label + '). Início da resposta: ' + raw.slice(0, 300));
  try { return JSON.parse(match[0]); } catch {}
  // Corrige trailing commas
  let fixed = match[0].replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(fixed); } catch {}
  // Corrige aspas não-escapadas dentro de valores HTML (problema comum com resumoHTML)
  fixed = fixed.replace(/"([^"]*)":\s*"([\s\S]*?)(?:"\s*[,}\]])/g, (m, key, val) => {
    // Se o valor contém aspas internas não-escapadas, escapa-as
    const escapedVal = val.replace(/(?<!\\)"/g, '\\"');
    return '"' + key + '":"' + escapedVal + '"' + m.slice(-1);
  });
  try { return JSON.parse(fixed); } catch {}
  // Último recurso: tenta reparar JSON truncado adicionando fechamentos
  let repaired = fixed;
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  // Fecha strings abertas
  if ((repaired.match(/"/g) || []).length % 2 !== 0) repaired += '"';
  for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
  for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
  try { return JSON.parse(repaired); } catch (e) {
    throw new Error('JSON inválido (' + label + '): ' + e.message + '. Início: ' + match[0].slice(0, 200));
  }
}

// Processa a geração em background — conteúdo e quiz em PARALELO
async function processJob(jobId, { pdfBase64, pdfText, discipline, title, professor, observations }) {
  try {
    jobs[jobId].progress = 'Gerando conteúdo e questões em paralelo...';

    const ctx = `Disciplina: ${discipline}\nTítulo: ${title}\n${professor ? 'Professor(a): ' + professor + '\n' : ''}${observations ? 'Observações: ' + observations + '\n' : ''}`;

    // Trunca texto se muito grande (evita respostas truncadas)
    const truncatedText = pdfText && pdfText.length > 40000 ? pdfText.slice(0, 40000) + '\n\n[...texto truncado]' : pdfText;
    // Monta a parte do PDF (igual para as duas chamadas)
    const pdfPart = pdfBase64
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }
      : { type: 'text', text: 'Conteúdo do PDF:\n\n' + truncatedText };

    // Dispara as duas chamadas ao mesmo tempo
    const contentPromise = callAnthropic({
      model: 'claude-sonnet-4-6', max_tokens: 16000, temperature: 0, system: PROMPT_CONTENT,
      messages: [{ role: 'user', content: [pdfPart, { type: 'text', text: 'Gere o módulo para:\n' + ctx }] }]
    }).then(r => {
      if (r?.stop_reason === 'max_tokens') throw new Error('PDF muito extenso — envie apenas as páginas mais importantes da aula.');
      jobs[jobId].progress = 'Conteúdo pronto, aguardando questões...'; return r;
    });

    const quizPromise = callAnthropic({
      model: 'claude-sonnet-4-6', max_tokens: 10000, temperature: 0, system: PROMPT_QUIZ,
      messages: [{ role: 'user', content: [pdfPart, { type: 'text', text: 'Gere as questões para:\n' + ctx }] }]
    }).then(r => {
      if (r?.stop_reason === 'max_tokens') throw new Error('PDF muito extenso para gerar todas as questões — envie um PDF menor.');
      jobs[jobId].progress = 'Questões prontas, aguardando conteúdo...'; return r;
    });

    const [contentResult, quizResult] = await Promise.all([contentPromise, quizPromise]);

    jobs[jobId].progress = 'Estruturando módulo...';

    const moduleData = parseAnthropicJSON(contentResult, 'conteúdo');
    const quizData   = parseAnthropicJSON(quizResult,   'quiz');

    // Mescla quiz no módulo e garante aba de quiz no final
    const rawQuiz = quizData.quiz || { obj: [], esc: [], pra: [] };
    // Normaliza campo 'a' → 'ans' e garante que ans é número nas objetivas
    if (rawQuiz.obj) {
      rawQuiz.obj = rawQuiz.obj.map(q => {
        const ans = q.ans !== undefined ? q.ans : q.a;
        return { q: q.q, opts: (q.opts || []).map(o => String(o).replace(/^[A-D]\.\s*/, '')), ans: typeof ans === 'number' ? ans : parseInt(ans, 10) || 0, tag: q.tag || q.exp || '', exp: q.exp || '' };
      });
    }
    moduleData.quiz = rawQuiz;
    const tabs = (moduleData.tabs || []).filter(t => t.id !== 'quiz');
    tabs.push({ id: 'quiz', label: '🧠 Quiz' });
    moduleData.tabs     = tabs;
    moduleData.id       = moduleData.id || 'gen_' + Date.now();
    moduleData.locked   = false;
    moduleData.sections = moduleData.sections || {};

    jobs[jobId].status   = 'ready';
    jobs[jobId].module   = moduleData;
    jobs[jobId].progress = 'Pronto!';
  } catch (err) {
    console.error('[job ' + jobId + ']', err.message);
    jobs[jobId].status = 'error';
    jobs[jobId].error  = err.message;
  }
}

// Processa geração de revisão — um tópico por vez para mostrar progresso
function _truncStr(s, max) { return s && s.length > max ? s.slice(0, max) + '...' : s || ''; }

async function processRevisionJob(jobId, topics) {
  try {
    const totalSteps = topics.length * 3; // 3 chamadas por tópico (obj, esc, pra)
    let stepsDone = 0;
    jobs[jobId].progress = `Gerando ${topics.length} tópico(s)...`;
    jobs[jobId].stepsDone = 0;
    jobs[jobId].stepsTotal = totalSteps;
    jobs[jobId].topicsDone = 0;
    jobs[jobId].topicsTotal = topics.length;

    // 9 chamadas em paralelo: 3 tipos × N tópicos
    const allPromises = [];
    for (const topic of topics) {
      // Objetivas
      allPromises.push(
        callAnthropic({ model: 'claude-sonnet-4-6', max_tokens: 2500, temperature: 0, system: PROMPT_REV_OBJ, messages: [{ role: 'user', content: topic }] })
        .then(r => { stepsDone++; jobs[jobId].stepsDone = stepsDone; jobs[jobId].progress = `📝 Objetivas de ${topic} ✓ (${stepsDone}/${totalSteps})`; return { topic, type: 'obj', result: r }; })
        .catch(e => { stepsDone++; jobs[jobId].stepsDone = stepsDone; return { topic, type: 'obj', error: e.message }; })
      );
      // Dissertativas
      allPromises.push(
        callAnthropic({ model: 'claude-sonnet-4-6', max_tokens: 2000, temperature: 0, system: PROMPT_REV_ESC, messages: [{ role: 'user', content: topic }] })
        .then(r => { stepsDone++; jobs[jobId].stepsDone = stepsDone; jobs[jobId].progress = `✍️ Dissertativas de ${topic} ✓ (${stepsDone}/${totalSteps})`; return { topic, type: 'esc', result: r }; })
        .catch(e => { stepsDone++; jobs[jobId].stepsDone = stepsDone; return { topic, type: 'esc', error: e.message }; })
      );
      // Casos clínicos
      allPromises.push(
        callAnthropic({ model: 'claude-sonnet-4-6', max_tokens: 2000, temperature: 0, system: PROMPT_REV_PRA, messages: [{ role: 'user', content: topic }] })
        .then(r => { stepsDone++; jobs[jobId].stepsDone = stepsDone; jobs[jobId].progress = `🩺 Casos de ${topic} ✓ (${stepsDone}/${totalSteps})`; return { topic, type: 'pra', result: r }; })
        .catch(e => { stepsDone++; jobs[jobId].stepsDone = stepsDone; return { topic, type: 'pra', error: e.message }; })
      );
    }

    const results = await Promise.all(allPromises);

    const allObj = [], allEsc = [], allPra = [];
    let successCount = 0;
    for (const { topic, type, result, error } of results) {
      if (error || !result) continue;
      try {
        const raw = parseAnthropicJSON(result, type + ' ' + topic);
        const items = Array.isArray(raw) ? raw : (raw[type] || raw.obj || raw.esc || raw.pra || []);
        if (type === 'obj') {
          items.forEach(q => {
            const ans = q.ans !== undefined ? q.ans : q.a;
            allObj.push({ q: _truncStr(q.q, 300), opts: (q.opts || []).map(o => String(o).replace(/^[A-Ea-e][\.\)]\s*/, '')), ans: typeof ans === 'number' ? ans : parseInt(ans, 10) || 0, exp: _truncStr(q.exp, 200), topic: q.topic || topic });
          });
        } else if (type === 'esc') {
          items.forEach(q => allEsc.push({ q: _truncStr(q.q, 300), ans: _truncStr(q.ans, 500), topic: q.topic || topic }));
        } else {
          items.forEach(q => allPra.push({ q: _truncStr(q.q, 500), ans: _truncStr(q.ans, 500), topic: q.topic || topic }));
        }
        successCount++;
      } catch (e) { console.error('[revision parse ' + type + ' ' + topic + ']', e.message); }
    }

    if (successCount === 0) throw new Error('Nenhum tópico gerado. Tente novamente.');

    jobs[jobId].status = 'ready';
    jobs[jobId].progress = 'Pronto!';
    jobs[jobId].stepsDone = totalSteps;
    jobs[jobId].topicsDone = topics.length;
    jobs[jobId].quiz = { obj: allObj, esc: allEsc, pra: allPra };
  } catch (err) {
    console.error('[revision ' + jobId + ']', err.message);
    jobs[jobId].status = 'error';
    jobs[jobId].error = err.message;
  }
}

// Processa geração de flashcards
async function processFlashcardJob(jobId, topics, qty) {
  try {
    jobs[jobId].progress = 'Gerando flashcards...';
    const topicStr = topics.join(', ');
    const result = await callAnthropic({
      model: 'claude-sonnet-4-6', max_tokens: 8000, system: PROMPT_FLASHCARDS,
      messages: [{ role: 'user', content: `Gere ${qty} flashcards sobre: ${topicStr}` }]
    });
    const data = parseAnthropicJSON(result, 'flashcards');
    const cards = (data.cards || []).slice(0, qty);
    jobs[jobId].status = 'ready';
    jobs[jobId].cards = cards;
    jobs[jobId].progress = 'Pronto!';
  } catch (err) {
    console.error('[flashcard ' + jobId + ']', err.message);
    jobs[jobId].status = 'error';
    jobs[jobId].error = err.message;
  }
}

// Converte valor JS para formato Firestore REST API
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean')  return { booleanValue: v };
  if (typeof v === 'number')   return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string')   return { stringValue: v };
  if (Array.isArray(v))        return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (v && typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toFirestoreValue(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

// Salva documento no Firestore via REST API usando ID token do usuário
function saveFirestore(projectId, collection, doc, idToken) {
  return new Promise((resolve, reject) => {
    const fields = {};
    for (const k of Object.keys(doc)) fields[k] = toFirestoreValue(doc[k]);
    const body = JSON.stringify({ fields });
    const req = https.request({
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${projectId}/databases/(default)/documents/${collection}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + idToken,
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try {
          const json = JSON.parse(text);
          if (json.error) reject(new Error(json.error.message || JSON.stringify(json.error)));
          else resolve(json);
        } catch(e) { reject(new Error('Resposta inválida do Firestore: ' + text.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Firestore timeout')); });
    req.write(body);
    req.end();
  });
}

// Servidor principal
http.createServer(async (req, res) => {

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS); res.end(); return;
  }

  // POST /generate-module — inicia job, retorna jobId imediatamente
  if (req.method === 'POST' && req.url === '/generate-module') {
    try {
      const body = await readBody(req);
      if ((!body.pdfBase64 && !body.pdfText) || !body.discipline || !body.title) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ error: 'pdfBase64 ou pdfText, discipline e title são obrigatórios' }));
        return;
      }
      const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      jobs[jobId] = { status: 'processing', progress: 'Iniciando...', module: null, error: null, createdAt: Date.now() };
      processJob(jobId, body); // dispara em background, sem await
      res.writeHead(202, CORS);
      res.end(JSON.stringify({ jobId, status: 'processing' }));
    } catch (err) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /job-status/:jobId — polling de status
  const jobMatch = req.url.match(/^\/job-status\/([a-z0-9_]+)$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs[jobMatch[1]];
    if (!job) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'Job não encontrado' })); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ status: job.status, progress: job.progress, module: job.module, quiz: job.quiz, cards: job.cards, error: job.error, topicsDone: job.topicsDone, topicsTotal: job.topicsTotal, stepsDone: job.stepsDone, stepsTotal: job.stepsTotal }));
    return;
  }

  // POST /save-module — salva módulo no Firestore via REST com ID token do usuário
  if (req.method === 'POST' && req.url === '/save-module') {
    try {
      const body = await readBody(req);
      if (!body.idToken || !body.module || !body.userId) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ error: 'idToken, userId e module são obrigatórios' }));
        return;
      }
      const doc = {
        userId:     body.userId,
        userName:   body.userName   || 'Estudante',
        userEmail:  body.userEmail  || '',
        discipline: body.discipline || '',
        title:      body.title      || '',
        professor:  body.professor  || '',
        visibility: body.visibility || 'private',
        module:     body.module,
        status:     'ready',
        createdAt:  new Date().toISOString(),
      };
      const result = await saveFirestore('medmind-pro', 'generatedModules', doc, body.idToken);
      const docId = result.name ? result.name.split('/').pop() : null;
      console.log('[save-module] OK docId=' + docId + ' userId=' + body.userId);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ success: true, docId }));
    } catch (err) {
      console.error('[save-module]', err.message);
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /save-revision — salva revisão no Firestore
  if (req.method === 'POST' && req.url === '/save-revision') {
    try {
      const body = await readBody(req);
      if (!body.idToken || !body.userId || !body.questions) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ error: 'idToken, userId e questions são obrigatórios' }));
        return;
      }
      const doc = {
        userId:    body.userId,
        title:     body.title || 'Revisão',
        modules:   body.modules || [],
        questions: body.questions,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const result = await saveFirestore('medmind-pro', 'revisions', doc, body.idToken);
      const docId = result.name ? result.name.split('/').pop() : null;
      console.log('[save-revision] OK docId=' + docId + ' userId=' + body.userId);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ success: true, docId }));
    } catch (err) {
      console.error('[save-revision]', err.message);
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /save-flashdeck — salva deck de flashcards no Firestore
  if (req.method === 'POST' && req.url === '/save-flashdeck') {
    try {
      const body = await readBody(req);
      if (!body.idToken || !body.userId || !body.cards) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ error: 'idToken, userId e cards são obrigatórios' }));
        return;
      }
      const doc = {
        userId:     body.userId,
        title:      body.title || 'Flashcards',
        cards:      body.cards,
        modules:    body.modules || [],
        results:    body.results || { right: 0, mid: 0, wrong: 0 },
        totalCards: (body.cards || []).length,
        createdAt:  new Date().toISOString(),
        expiresAt:  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      const result = await saveFirestore('medmind-pro', 'flashdecks', doc, body.idToken);
      const docId = result.name ? result.name.split('/').pop() : null;
      console.log('[save-flashdeck] OK docId=' + docId);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ success: true, docId }));
    } catch (err) {
      console.error('[save-flashdeck]', err.message);
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /generate-revision — inicia job de revisão
  if (req.method === 'POST' && req.url === '/generate-revision') {
    try {
      const body = await readBody(req);
      if (!body.topics || !Array.isArray(body.topics) || body.topics.length === 0) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ error: 'topics (array) é obrigatório' }));
        return;
      }
      const topics = body.topics.slice(0, 5).map(t => String(t).trim()).filter(Boolean);
      if (topics.length === 0) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'Informe pelo menos 1 tópico' })); return; }
      const jobId = 'rev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      jobs[jobId] = { status: 'processing', progress: 'Iniciando revisão...', quiz: null, error: null, topicsDone: 0, topicsTotal: topics.length, createdAt: Date.now() };
      processRevisionJob(jobId, topics);
      res.writeHead(202, CORS);
      res.end(JSON.stringify({ jobId, status: 'processing' }));
    } catch (err) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /generate-flashcards — inicia job de geração de flashcards
  if (req.method === 'POST' && req.url === '/generate-flashcards') {
    try {
      const body = await readBody(req);
      if (!body.topics || !Array.isArray(body.topics) || body.topics.length === 0) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ error: 'topics (array) é obrigatório' }));
        return;
      }
      const topics = body.topics.slice(0, 3).map(t => String(t).trim()).filter(Boolean);
      const qty = Math.min(30, Math.max(5, parseInt(body.qty) || 15));
      if (topics.length === 0) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'Informe pelo menos 1 tópico' })); return; }
      const jobId = 'fc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      jobs[jobId] = { status: 'processing', progress: 'Iniciando flashcards...', cards: null, error: null, createdAt: Date.now() };
      processFlashcardJob(jobId, topics, qty);
      res.writeHead(202, CORS);
      res.end(JSON.stringify({ jobId, status: 'processing' }));
    } catch (err) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /revision-feedback — feedback individual por questão
  if (req.method === 'POST' && req.url === '/revision-feedback') {
    try {
      const body = await readBody(req);
      if (!body.question || !body.expectedAnswer || !body.userAnswer) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ error: 'question, expectedAnswer e userAnswer são obrigatórios' }));
        return;
      }
      const result = await callAnthropic({
        model: 'claude-sonnet-4-6', max_tokens: 500, system: PROMPT_FEEDBACK,
        messages: [{ role: 'user', content: `Pergunta: ${body.question}\n\nResposta esperada: ${body.expectedAnswer}\n\nResposta do aluno: ${body.userAnswer}` }]
      });
      const feedback = parseAnthropicJSON(result, 'feedback');
      res.writeHead(200, CORS);
      res.end(JSON.stringify(feedback));
    } catch (err) {
      console.error('[revision-feedback]', err.message);
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /admin/reset-password — envia email de redefinição de senha
  if (req.method === 'POST' && req.url === '/admin/reset-password') {
    try {
      const body = await readBody(req);
      if (!body.idToken || !body.email) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'idToken e email obrigatórios' })); return; }
      await verifyAdminToken(body.idToken);
      await sendPasswordReset(body.email);
      console.log('[admin/reset-password] enviado para ' + body.email);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ success: true }));
    } catch(err) {
      console.error('[admin/reset-password]', err.message);
      res.writeHead(err.message.includes('negado') ? 403 : 500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /admin/update-user — edita dados do usuário no Firestore
  if (req.method === 'POST' && req.url === '/admin/update-user') {
    try {
      const body = await readBody(req);
      if (!body.idToken || !body.uid || !body.updates) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'idToken, uid e updates obrigatórios' })); return; }
      await verifyAdminToken(body.idToken);
      await patchFirestoreDoc('users', body.uid, body.updates, body.idToken);
      // Atualiza ranking se xp foi alterado
      if (body.updates.xp !== undefined || body.updates.name !== undefined) {
        const rankUpdates = {};
        if (body.updates.name !== undefined) rankUpdates.name = body.updates.name;
        if (body.updates.xp  !== undefined) rankUpdates.xp   = body.updates.xp;
        await patchFirestoreDoc('ranking', body.uid, rankUpdates, body.idToken).catch(() => {});
      }
      console.log('[admin/update-user] uid=' + body.uid);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ success: true }));
    } catch(err) {
      console.error('[admin/update-user]', err.message);
      res.writeHead(err.message.includes('negado') ? 403 : 500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /admin/delete-user — remove usuário do Firestore (users + ranking)
  if (req.method === 'POST' && req.url === '/admin/delete-user') {
    try {
      const body = await readBody(req);
      if (!body.idToken || !body.uid) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'idToken e uid obrigatórios' })); return; }
      await verifyAdminToken(body.idToken);
      // Apaga das coleções principais
      await deleteFirestoreDoc('users', body.uid, body.idToken).catch(() => {});
      await deleteFirestoreDoc('ranking', body.uid, body.idToken).catch(() => {});
      console.log('[admin/delete-user] uid=' + body.uid);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ success: true }));
    } catch(err) {
      console.error('[admin/delete-user]', err.message);
      res.writeHead(err.message.includes('negado') ? 403 : 500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /admin/toggle-block — bloqueia/desbloqueia usuário
  if (req.method === 'POST' && req.url === '/admin/toggle-block') {
    try {
      const body = await readBody(req);
      if (!body.idToken || !body.uid || body.blocked === undefined) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'idToken, uid e blocked obrigatórios' })); return; }
      await verifyAdminToken(body.idToken);
      await patchFirestoreDoc('users', body.uid, { blocked: body.blocked }, body.idToken);
      console.log('[admin/toggle-block] uid=' + body.uid + ' blocked=' + body.blocked);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ success: true }));
    } catch(err) {
      console.error('[admin/toggle-block]', err.message);
      res.writeHead(err.message.includes('negado') ? 403 : 500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Arquivos estáticos
  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(ROOT, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  if (req.url.includes('sw.js')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });

}).listen(PORT, '127.0.0.1', () => {
  console.log(`MedMind rodando em http://127.0.0.1:${PORT}`);
});
