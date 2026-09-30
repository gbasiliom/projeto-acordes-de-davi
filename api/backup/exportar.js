// Função serverless da Vercel: GET /api/backup/exportar
//
// Chamada automaticamente 1x por dia pelo Cron Job configurado em vercel.json (não é
// chamada por nenhum botão do App.jsx) — puxa TODAS as coleções do Firestore pelo
// Firebase Admin SDK, monta um único arquivo JSON e manda esse arquivo por e-mail (via
// Resend, o mesmo serviço que já manda os recibos) pra um e-mail de backup separado.
//
// Por que por e-mail, e não pelo backup nativo do Firestore ("Backup and Restore" do
// Google Cloud): o backup nativo precisa de um bucket do Cloud Storage, e isso só é
// permitido em projetos no plano Blaze (pago por uso) do Firebase — esse projeto está
// no plano Spark (gratuito), que não permite nenhum serviço faturável do Google Cloud.
// Esse caminho aqui (Admin SDK + e-mail) funciona 100% dentro do plano gratuito, porque
// já usa peças que esse projeto já tem: Vercel (Cron Jobs), Firebase Admin SDK (já usado
// em api/_recibos.js) e Resend com domínio verificado (já manda os recibos por e-mail).
//
// SEGURANÇA: esse endpoint devolve TODOS os dados de TODOS os alunos/igrejas (nome,
// telefone, pagamento, etc.) — por isso não pode ficar aberto pra qualquer um que
// descubra a URL. Só aceita a chamada se vier com o cabeçalho de autorização que o
// PRÓPRIO Cron Job da Vercel manda sozinho (usando a variável de ambiente CRON_SECRET,
// configurada uma vez no painel — veja BACKUP_SETUP.md pro passo a passo completo).
//
// Precisa de duas variáveis de ambiente novas na Vercel, além das que já existem
// (FIREBASE_SERVICE_ACCOUNT, RESEND_API_KEY):
//   - CRON_SECRET: uma senha longa e aleatória qualquer, só pra validar que a chamada
//     veio mesmo do Cron Job da Vercel (não de alguém tentando acessar a URL direto).
//   - EMAIL_BACKUP: o e-mail que vai RECEBER o backup diário. De propósito, o ideal é
//     um e-mail DIFERENTE do operacional (auladeinstrumentosmusicais2026@gmail.com) —
//     assim, se a caixa operacional for comprometida ou lotar, o backup continua
//     chegando num lugar separado.
const { getDb } = require('../_firebaseAdmin');

const REMETENTE_PADRAO = 'Backup Acordes de Davi <sistema@acordesdedavi.com.br>';

// Todas as coleções do sistema — se um dia criar uma coleção nova (ex: mais uma aba
// tipo "materiais"), lembre de adicionar o nome dela nessa lista também, senão ela
// simplesmente não entra no backup.
const COLECOES = [
  'agendamentos',
  'igrejas',
  'turmas',
  'polos',
  'vagas',
  'materiais',
  'presencas',
  'avaliacoes',
  'configuracoes',
  'contadores'
];

async function exportarColecao(db, nome) {
  const snap = await db.collection(nome).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function enviarBackupPorEmail({ destinatario, jsonBuffer, nomeArquivo, resumo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY não configurada — backup gerado mas não pôde ser enviado por e-mail.');
  }
  if (!destinatario) {
    throw new Error('EMAIL_BACKUP não configurada — defina pra onde o backup diário deve ser enviado.');
  }

  const linhasResumo = Object.entries(resumo)
    .map(([colecao, info]) => `<li><strong>${colecao}</strong>: ${info.ok ? `${info.total} documento(s)` : `<span style="color:#b91c1c">falhou — ${info.erro}</span>`}</li>`)
    .join('');

  const corpoHtml = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;max-width:480px;margin:0 auto">
      <h2 style="color:#065f46;margin-bottom:4px">Projeto Acordes de Davi</h2>
      <p style="color:#4b5563;margin-top:0">Backup diário do banco de dados</p>
      <p>Backup gerado em ${new Date().toLocaleString('pt-BR')}. Resumo por coleção:</p>
      <ul style="font-size:13px">${linhasResumo}</ul>
      <p style="color:#6b7280;font-size:12px;margin-top:24px">
        Guarde esse e-mail (ou o arquivo em anexo) — é ele que o script de restauração
        usa se precisar recolocar os dados no Firestore. Veja BACKUP_SETUP.md.
      </p>
    </div>
  `;

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: REMETENTE_PADRAO,
      to: [destinatario],
      subject: `Backup Acordes de Davi — ${new Date().toLocaleDateString('pt-BR')}`,
      html: corpoHtml,
      attachments: [
        {
          filename: nomeArquivo,
          content: jsonBuffer.toString('base64')
        }
      ]
    })
  });

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    throw new Error(erro?.message || 'Resend recusou o envio do backup.');
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  // Só aceita a chamada do próprio Cron Job da Vercel (que manda esse cabeçalho
  // sozinho, lendo a variável CRON_SECRET) — nunca de uma chamada anônima direto na URL.
  const segredoEsperado = process.env.CRON_SECRET;
  const autorizacaoRecebida = req.headers.authorization || '';
  if (!segredoEsperado || autorizacaoRecebida !== `Bearer ${segredoEsperado}`) {
    res.status(401).json({ erro: 'Não autorizado.' });
    return;
  }

  try {
    const db = getDb();
    const dados = {};
    const resumo = {};

    for (const nomeColecao of COLECOES) {
      try {
        dados[nomeColecao] = await exportarColecao(db, nomeColecao);
        resumo[nomeColecao] = { ok: true, total: dados[nomeColecao].length };
      } catch (err) {
        console.error(`Erro ao exportar a coleção "${nomeColecao}" no backup:`, err);
        dados[nomeColecao] = null;
        resumo[nomeColecao] = { ok: false, erro: err.message || 'erro desconhecido' };
      }
    }

    const pacoteBackup = {
      geradoEm: new Date().toISOString(),
      projeto: 'acordes-de-davi',
      colecoes: dados
    };

    const jsonBuffer = Buffer.from(JSON.stringify(pacoteBackup, null, 2), 'utf-8');
    const nomeArquivo = `backup-acordes-de-davi-${new Date().toISOString().slice(0, 10)}.json`;

    await enviarBackupPorEmail({
      destinatario: process.env.EMAIL_BACKUP,
      jsonBuffer,
      nomeArquivo,
      resumo
    });

    res.status(200).json({ enviado: true, resumo });
  } catch (err) {
    console.error('Erro ao gerar/enviar o backup diário:', err);
    res.status(500).json({ erro: err.message || 'Erro interno ao gerar o backup.' });
  }
};
