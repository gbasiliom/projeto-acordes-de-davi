// Função serverless da Vercel: POST /api/recibos/enviar
//
// Chamada pelo App.jsx assim que o admin marca um pagamento como PAGO manualmente (aba
// Pagamentos, pra um aluno, ou aba Igrejas, pra uma igreja) — dinheiro, Pix combinado
// fora do site, etc. Monta o recibo em PDF e manda por e-mail pro mesmo e-mail que a
// pessoa usa pra entrar no Portal do Aluno/Portal da Igreja, sem precisar de nenhum
// campo novo de cadastro.
//
// Pagamentos feitos por Pix DENTRO do site já disparam esse mesmo envio sozinhos, direto
// do webhook do Mercado Pago (api/mercadopago/webhook.js) — esse endpoint aqui é só pro
// caminho manual, por isso exige que quem chama seja o admin.
const { getDb, getAuthAdmin } = require('../_firebaseAdmin');
const { processarRecibo } = require('../_recibos');

const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  try {
    const { agendamentoId, igrejaId } = req.body || {};
    if (!agendamentoId && !igrejaId) {
      res.status(400).json({ erro: 'agendamentoId ou igrejaId é obrigatório.' });
      return;
    }

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
      res.status(403).json({ erro: 'Só a coordenação pode disparar o envio do recibo.' });
      return;
    }

    const db = getDb();
    const tipo = igrejaId ? 'igreja' : 'agendamento';
    const ref = igrejaId ? db.collection('igrejas').doc(igrejaId) : db.collection('agendamentos').doc(agendamentoId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ erro: tipo === 'igreja' ? 'Igreja não encontrada.' : 'Agendamento não encontrado.' });
      return;
    }

    const resultado = await processarRecibo({
      db,
      authAdmin,
      tipo,
      id: igrejaId || agendamentoId,
      dados: snap.data()
    });

    if (!resultado.enviado) {
      // Não é um erro 500 — o pagamento já está marcado como pago, só o e-mail que não
      // saiu (ex: pessoa ainda não tem e-mail de acesso configurado). Responde 200 com
      // um aviso pro front-end mostrar de forma discreta.
      res.status(200).json({ enviado: false, aviso: resultado.motivo });
      return;
    }

    res.status(200).json({ enviado: true });
  } catch (err) {
    console.error('Erro ao enviar recibo automático:', err);
    res.status(500).json({ erro: 'Erro interno ao enviar o recibo. O pagamento já está marcado como pago normalmente.' });
  }
};
