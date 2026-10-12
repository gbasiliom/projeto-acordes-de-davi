// Função serverless da Vercel: POST /api/avaliacoes/gerar
//
// Usa IA (API da Anthropic/Claude) pra ajudar a escrever a avaliação de desempenho de
// um aluno — duas formas, que podem ser combinadas:
//   1. Você escreve anotações soltas e informais sobre a aula ("anotacoes") e a IA
//      transforma isso num parágrafo de avaliação bem escrito.
//   2. Você manda o histórico de avaliações anteriores desse aluno ("historico") e a IA
//      usa isso pra sugerir uma continuação coerente com o progresso dele.
// Com os dois, a IA combina as anotações novas com o histórico pra sugerir o texto.
//
// Só o admin pode chamar isso (confere o token do Firebase, igual nos outros endpoints
// da pasta api/) — protege a chave de API de ser usada por qualquer um.
//
// PRECISA da variável de ambiente ANTHROPIC_API_KEY configurada no painel da Vercel.
// Veja o passo a passo completo em CONFIGURAR-IA-AVALIACOES.md, na raiz do projeto.
const { getAuthAdmin } = require('../_firebaseAdmin');

const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

// Pode trocar o modelo pela variável de ambiente ANTHROPIC_MODEL, sem precisar mexer no
// código — útil se esse modelo aqui for descontinuado no futuro. Veja os modelos
// disponíveis (e os nomes atuais) em: https://docs.anthropic.com/en/docs/about-claude/models
const MODELO_PADRAO = 'claude-3-5-haiku-latest';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      res.status(401).json({ erro: 'Faça login novamente antes de continuar.' });
      return;
    }
    const authAdmin = getAuthAdmin();
    let decoded;
    try {
      decoded = await authAdmin.verifyIdToken(idToken);
    } catch (err) {
      res.status(401).json({ erro: 'Sessão expirada — faça login novamente.' });
      return;
    }
    if (decoded.email !== ADMIN_EMAIL) {
      res.status(403).json({ erro: 'Só a coordenação pode gerar avaliações com IA.' });
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(500).json({ erro: 'ANTHROPIC_API_KEY não configurada no projeto da Vercel. Veja o passo a passo em CONFIGURAR-IA-AVALIACOES.md antes de usar essa função.' });
      return;
    }

    const { nomeAluno, instrumento, anotacoes, historico } = req.body || {};
    const anotacoesLimpa = (anotacoes || '').trim();
    const historicoLimpo = Array.isArray(historico) ? historico.filter(h => h && h.texto) : [];

    if (!anotacoesLimpa && historicoLimpo.length === 0) {
      res.status(400).json({ erro: 'Escreva ao menos uma anotação rápida sobre a aula, ou espere esse aluno ter alguma avaliação anterior salva.' });
      return;
    }

    let contexto = `Aluno: ${nomeAluno || 'sem nome informado'}\nInstrumento: ${instrumento || 'não informado'}\n`;
    if (historicoLimpo.length > 0) {
      contexto += `\nAvaliações anteriores desse aluno (da mais antiga pra mais recente):\n`;
      historicoLimpo.forEach(h => {
        contexto += `- (${h.data || 'sem data'}) ${h.texto}\n`;
      });
    }
    if (anotacoesLimpa) {
      contexto += `\nAnotações rápidas do professor sobre a aula de hoje:\n${anotacoesLimpa}\n`;
    } else {
      contexto += `\nO professor não escreveu nada sobre a aula de hoje — sugira uma continuação natural do progresso, baseada só no histórico acima.\n`;
    }

    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || MODELO_PADRAO,
        max_tokens: 400,
        system: 'Você ajuda um professor de música voluntário (violão ou bateria) a escrever avaliações de desempenho curtas pra alunos de um projeto social chamado "Acordes de Davi". Escreva sempre em português do Brasil, em 2 a 4 frases, tom acolhedor mas objetivo e específico (cite acordes, ritmos, técnicas ou músicas sempre que fizer sentido). Nunca invente informação que não foi dada. Devolva SÓ o texto da avaliação — sem saudação, sem título, sem aspas em volta.',
        messages: [{ role: 'user', content: contexto }]
      })
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      console.error('Erro da API da Anthropic:', dados);
      throw new Error(dados?.error?.message || 'Erro ao gerar o texto com IA.');
    }

    const texto = (dados?.content || []).map(bloco => bloco.text || '').join('').trim();
    if (!texto) {
      throw new Error('A IA não devolveu nenhum texto. Tente de novo.');
    }

    res.status(200).json({ texto });
  } catch (err) {
    console.error('Erro ao gerar avaliação com IA:', err);
    res.status(500).json({ erro: err.message || 'Erro interno ao gerar a avaliação. Tente novamente.' });
  }
};
