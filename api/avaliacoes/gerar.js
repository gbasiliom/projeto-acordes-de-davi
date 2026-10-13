// Função serverless da Vercel: POST /api/avaliacoes/gerar
//
// Usa IA (API do Google Gemini) pra ajudar a escrever a avaliação de desempenho de
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
// PRECISA da variável de ambiente GEMINI_API_KEY configurada no painel da Vercel.
// Veja o passo a passo completo em CONFIGURAR-IA-AVALIACOES.md, na raiz do projeto.
// (Usamos o Gemini (Google) aqui em vez do Claude (Anthropic) porque o Gemini tem camada
// gratuita de verdade pra esse volume de uso, sem precisar cadastrar cartão de crédito.)
const { getAuthAdmin } = require('../_firebaseAdmin');

const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

// Pode trocar o modelo pela variável de ambiente GEMINI_MODEL, sem precisar mexer no
// código — útil se esse modelo aqui for descontinuado no futuro. Veja os modelos
// disponíveis (e quais têm camada gratuita) em: https://ai.google.dev/gemini-api/docs/pricing
const MODELO_PADRAO = 'gemini-3.8-flash';

const INSTRUCAO_SISTEMA = 'Você ajuda um professor de música voluntário (violão ou bateria) a escrever avaliações de desempenho curtas pra alunos de um projeto social chamado "Acordes de Davi". Escreva sempre em português do Brasil, em 2 a 4 frases, tom acolhedor mas objetivo e específico (cite acordes, ritmos, técnicas ou músicas sempre que fizer sentido). Nunca invente informação que não foi dada. Devolva SÓ o texto da avaliação — sem saudação, sem título, sem aspas em volta.';

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ erro: 'GEMINI_API_KEY não configurada no projeto da Vercel. Veja o passo a passo em CONFIGURAR-IA-AVALIACOES.md antes de usar essa função.' });
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

    const modelo = process.env.GEMINI_MODEL || MODELO_PADRAO;
    const resposta = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSTRUCAO_SISTEMA }] },
        contents: [{ role: 'user', parts: [{ text: contexto }] }],
        generationConfig: { maxOutputTokens: 400 }
      })
    });

    const dados = await resposta.json();
    if (!resposta.ok) {
      console.error('Erro da API do Gemini:', dados);
      throw new Error(dados?.error?.message || 'Erro ao gerar o texto com IA.');
    }

    const texto = (dados?.candidates?.[0]?.content?.parts || []).map(bloco => bloco.text || '').join('').trim();
    if (!texto) {
      throw new Error('A IA não devolveu nenhum texto (pode ter sido bloqueado por segurança do Gemini). Tente reescrever a anotação e gerar de novo.');
    }

    res.status(200).json({ texto });
  } catch (err) {
    console.error('Erro ao gerar avaliação com IA:', err);
    res.status(500).json({ erro: err.message || 'Erro interno ao gerar a avaliação. Tente novamente.' });
  }
};
