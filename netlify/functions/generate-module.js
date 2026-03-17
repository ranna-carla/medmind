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

    const systemPrompt = "Voce e um gerador de modulos educacionais para estudantes de medicina brasileiros. A partir do texto de uma aula, gere um modulo completo. Retorne APENAS JSON valido com: emoji (string), summary (HTML do resumo, minimo 500 palavras), tabs (array de abas com title, emoji, cards com title e content), quiz com objective (10 questoes com question, options array de 4, correct index, explanation), written (3 questoes com question e answer), clinical (2 casos com scenario, question, answer). Use portugues brasileiro e terminologia medica precisa.";

    const requestBody = {
      model: "claude-3-haiku-20240307",
      max_tokens: 8000,
      messages: [
        {
          role: "user",
          content: systemPrompt + "\n\nDisciplina: " + (discipline || "Medicina") + "\nTitulo: " + (title || "Modulo") + "\nTexto da aula:\n" + text.substring(0, 12000)
        }
      ]
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();

    if (!response.ok) {
      return {
        statusCode: 502, headers,
        body: JSON.stringify({ error: "Claude API " + response.status + ": " + responseText })
      };
    }

    const data = JSON.parse(responseText);
    const content = data.content[0]?.text || "";
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const moduleJSON = JSON.parse(cleaned);

    return { statusCode: 200, headers, body: JSON.stringify({ module: moduleJSON }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Erro: " + err.message }) };
  }
};
