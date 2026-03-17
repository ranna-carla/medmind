exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'CLAUDE_API_KEY nao configurada' }) };
  }

  try {
    const { text, title, discipline } = JSON.parse(event.body);
    if (!text || text.length < 50) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Texto do PDF muito curto' }) };
    }

    const systemPrompt = `Voce e um gerador de modulos educacionais para estudantes de medicina brasileiros. A partir do texto de uma aula/material, gere um modulo de estudo completo. Retorne APENAS um JSON valido (sem markdown, sem backticks, sem texto antes ou depois) com esta estrutura exata: { "emoji": "string", "summary": "Resumo completo em HTML (use h3, p, ul, strong, table). Seja detalhado e didatico. Minimo 500 palavras.", "tabs": [ { "title": "Nome da aba tematica", "emoji": "string", "cards": [ { "title": "Titulo do card", "content": "Conteudo explicativo em HTML com strong para termos importantes" } ] } ], "quiz": { "objective": [ { "question": "Pergunta?", "options": ["A", "B", "C", "D"], "correct": 0, "explanation": "Explicacao" } ], "written": [ { "question": "Pergunta dissertativa?", "answer": "Resposta completa" } ], "clinical": [ { "scenario": "Paciente de X anos apresenta...", "question": "Qual o diagnostico?", "answer": "Resposta com justificativa" } ] } } REGRAS: Gere exatamente 10 questoes objetivas, 3 dissertativas e 2 casos clinicos. Crie 3-5 abas tematicas com 2-4 cards cada. Use terminologia medica precisa em portugues brasileiro. Retorne APENAS o JSON.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Disciplina: ' + (discipline || 'Medicina') + '. Titulo: ' + (title || 'Modulo') + '. Texto da aula: ' + text.substring(0, 12000) }]
      })
    });

    if (!response.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Erro na API: ' + response.status }) };
    }

    const data = await response.json();
    const content = data.content[0]?.text || '';
    const cleaned = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const moduleJSON = JSON.parse(cleaned);

    return { statusCode: 200, headers, body: JSON.stringify({ module: moduleJSON }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Erro: ' + err.message }) };
  }
};
