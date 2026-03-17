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

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: "Gere um modulo educacional em JSON para estudantes de medicina. Responda APENAS com JSON valido, sem markdown.\n\nEstrutura exata:\n{\"emoji\":\"string\",\"summary\":\"resumo HTML curto 200 palavras\",\"tabs\":[{\"title\":\"string\",\"emoji\":\"string\",\"cards\":[{\"title\":\"string\",\"content\":\"HTML\"}]}],\"quiz\":{\"objective\":[{\"question\":\"string\",\"options\":[\"A\",\"B\",\"C\",\"D\"],\"correct\":0,\"explanation\":\"string\"}],\"written\":[{\"question\":\"string\",\"answer\":\"string\"}],\"clinical\":[{\"scenario\":\"string\",\"question\":\"string\",\"answer\":\"string\"}]}}\n\nGere: 5 objetivas, 1 dissertativa, 1 caso clinico, 2 abas com 2 cards cada. Portugues brasileiro.\n\nDisciplina: " + (discipline || "Medicina") + "\nTitulo: " + (title || "Modulo") + "\nTexto:\n" + text.substring(0, 5000)
        }]
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Claude API " + response.status + ": " + responseText }) };
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
