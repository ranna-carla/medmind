// MedMind — Micro-server auxiliar para flashcards + revisão (porta 3739)
// Usado enquanto o server principal (3737) não pode ser reiniciado
const http = require('http');
const https = require('https');
const fs = require('fs');

const PORT = 3739;

function getKey() {
  try {
    const e = fs.readFileSync('/etc/claude-hub/api-keys.env', 'utf8');
    const m = e.match(/ANTHROPIC_API_KEY_PRODUCAO=(.+)/);
    if (m) return m[1].trim();
  } catch {}
  try {
    const e = fs.readFileSync('/Users/macmini-win7/projects/projects/imagex-ris/.env', 'utf8');
    const m = e.match(/ANTHROPIC_API_KEY=(.+)/);
    if (m && m[1].trim().startsWith('sk-ant-')) return m[1].trim();
  } catch {}
  return '';
}

function callAnthropic(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getKey(),
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(300000, () => { req.destroy(); reject(new Error('Anthropic API timeout')); });
    req.write(body);
    req.end();
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const jobs = {};

setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const id of Object.keys(jobs)) {
    if (jobs[id].createdAt < cutoff) delete jobs[id];
  }
}, 300000);

const PROMPT_FLASHCARDS = `Você é um especialista em criar flashcards de alta qualidade para estudantes de medicina.
Dado um ou mais temas, gere flashcards no formato frente/verso otimizados para memorização ativa.

Regras:
- Frente: pergunta objetiva, definição a completar, ou conceito-chave (1-2 frases)
- Verso: resposta concisa e direta (1-3 frases), com o essencial para memorizar
- Varie os tipos: definições, mecanismos, classificações, diagnósticos diferenciais, tratamentos, valores de referência
- Cada card deve ser independente e auto-contido
- Use linguagem técnica precisa mas acessível
- Inclua mnemônicos quando útil

Retorne APENAS o JSON puro, sem markdown, sem blocos de código:
{"cards":[{"front":"Pergunta ou conceito","back":"Resposta concisa"}]}`;

const PROMPT_REVISION = `Você é um especialista em criar questões de revisão para estudantes de medicina.
Dado um tema/tópico, gere um quiz de revisão em JSON.
Retorne APENAS o JSON puro, sem markdown, sem blocos de código.

Schema exato:
{
  "obj": [10 objetos: {"q":"Pergunta?","opts":["opção A","opção B","opção C","opção D"],"a":INDEX_CORRETO_0a3,"exp":"Explicação breve","topic":"NOME_DO_TEMA"}],
  "esc": [3 objetos: {"q":"Pergunta dissertativa?","ans":"Resposta modelo completa","topic":"NOME_DO_TEMA"}],
  "pra": [2 objetos: {"q":"Caso clínico detalhado com anamnese, exames e achados...","ans":"Conduta completa e raciocínio clínico","topic":"NOME_DO_TEMA"}]
}

IMPORTANTE: 'a' deve ser o ÍNDICE numérico (0,1,2 ou 3) da opção correta. NÃO use letras.
As opções NÃO devem ter prefixo "A.", "B." etc. Apenas o texto.`;

const PROMPT_FEEDBACK = `Você é um professor de medicina avaliando a resposta de um aluno.
Compare a resposta do aluno com a resposta modelo esperada.
Dê um feedback construtivo em 2-3 frases curtas:
- O que o aluno acertou
- O que faltou ou está incorreto
- Nota de 0 a 10

Retorne APENAS JSON: {"feedback":"texto do feedback","score":N}`;

function parseAnthropicJSON(result, label) {
  if (result?.type === 'error') throw new Error('API (' + (label||'') + '): ' + (result?.error?.message || JSON.stringify(result.error)));
  const raw = result?.content?.[0]?.text || '';
  if (!raw) throw new Error('Resposta vazia (' + (label||'') + ')');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON ausente (' + (label||'') + '): ' + raw.slice(0, 200));
  return JSON.parse(match[0].replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' '));
}

// Flashcard job
async function processFlashcardJob(jobId, topics, qty) {
  try {
    jobs[jobId].progress = 'Gerando flashcards...';
    const result = await callAnthropic({
      model: 'claude-sonnet-4-6', max_tokens: 8000, system: PROMPT_FLASHCARDS,
      messages: [{ role: 'user', content: `Gere ${qty} flashcards sobre: ${topics.join(', ')}` }]
    });
    const data = parseAnthropicJSON(result, 'flashcards');
    jobs[jobId].status = 'ready';
    jobs[jobId].cards = (data.cards || []).slice(0, qty);
    jobs[jobId].progress = 'Pronto!';
  } catch (err) {
    console.error('[flashcard ' + jobId + ']', err.message);
    jobs[jobId].status = 'error';
    jobs[jobId].error = err.message;
  }
}

// Revision job — one topic at a time for progress tracking
async function processRevisionJob(jobId, topics) {
  try {
    const allObj = [], allEsc = [], allPra = [];
    for (let i = 0; i < topics.length; i++) {
      const topic = topics[i];
      jobs[jobId].progress = `Gerando tópico ${i + 1} de ${topics.length}: ${topic}...`;
      jobs[jobId].topicsDone = i;
      jobs[jobId].topicsTotal = topics.length;
      const result = await callAnthropic({
        model: 'claude-sonnet-4-6', max_tokens: 6000, system: PROMPT_REVISION,
        messages: [{ role: 'user', content: `Gere o quiz de revisão para o tema: ${topic}` }]
      });
      const data = parseAnthropicJSON(result, 'revisão ' + topic);
      (data.obj || []).forEach(q => {
        const ans = q.ans !== undefined ? q.ans : q.a;
        allObj.push({ q: q.q, opts: (q.opts || []).map(o => String(o).replace(/^[A-Da-d][\.\)]\s*/, '')), ans: typeof ans === 'number' ? ans : parseInt(ans, 10) || 0, exp: q.exp || '', topic: q.topic || topic });
      });
      (data.esc || []).forEach(q => allEsc.push({ ...q, topic: q.topic || topic }));
      (data.pra || []).forEach(q => allPra.push({ ...q, topic: q.topic || topic }));
    }
    jobs[jobId].status = 'ready';
    jobs[jobId].progress = 'Pronto!';
    jobs[jobId].topicsDone = topics.length;
    jobs[jobId].quiz = { obj: allObj, esc: allEsc, pra: allPra };
  } catch (err) {
    console.error('[revision ' + jobId + ']', err.message);
    jobs[jobId].status = 'error';
    jobs[jobId].error = err.message;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  // Generate flashcards
  if (req.method === 'POST' && req.url === '/generate-flashcards') {
    try {
      const body = await readBody(req);
      const topics = (body.topics || []).slice(0, 3).map(t => String(t).trim()).filter(Boolean);
      const qty = Math.min(30, Math.max(5, parseInt(body.qty) || 15));
      if (!topics.length) { res.writeHead(400, CORS); res.end(JSON.stringify({ error: 'topics obrigatório' })); return; }
      const jobId = 'fc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      jobs[jobId] = { status: 'processing', progress: 'Iniciando...', cards: null, error: null, createdAt: Date.now() };
      processFlashcardJob(jobId, topics, qty);
      res.writeHead(202, CORS);
      res.end(JSON.stringify({ jobId, status: 'processing' }));
    } catch (err) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Generate revision
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

  // Revision feedback
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
      console.error('[feedback]', err.message);
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Job status polling
  const jobMatch = req.url.match(/^\/job-status\/([a-z0-9_]+)$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs[jobMatch[1]];
    if (!job) { res.writeHead(404, CORS); res.end(JSON.stringify({ error: 'Job não encontrado' })); return; }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      status: job.status, progress: job.progress,
      cards: job.cards, quiz: job.quiz, error: job.error,
      topicsDone: job.topicsDone, topicsTotal: job.topicsTotal
    }));
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: 'not found' }));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`MedMind API auxiliar rodando em http://127.0.0.1:${PORT}`);
});
