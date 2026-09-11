// Função serverless da Vercel: POST /api/mercadopago/criar-pix
//
// Chamada pelo botão "Pagar com Pix" no Portal do Aluno (App.jsx). Recebe o id de um
// agendamento, confere (via token do Firebase) que quem está pedindo é o próprio aluno
// dono do agendamento, olha o "Valor combinado" que o admin definiu na aba Pagamentos,
// e cria uma cobrança Pix de verdade no Mercado Pago — devolvendo o QR Code (imagem) e
// o código "copia e cola" pro aluno pagar no app do banco dele.
//
// Precisa de duas variáveis de ambiente na Vercel: MERCADOPAGO_ACCESS_TOKEN (Access
// Token do Mercado Pago) e FIREBASE_SERVICE_ACCOUNT (ver api/_firebaseAdmin.js). Sem
// elas, essa função responde com um erro explicando o que falta configurar — não quebra
// o resto do site.
const { getDb, getAuthAdmin } = require('../_firebaseAdmin');
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    res.status(500).json({
      erro: 'O pagamento online ainda não foi configurado neste site (falta a chave do Mercado Pago). Fale com a coordenação.'
    });
    return;
  }

  try {
    const { agendamentoId, email } = req.body || {};
    if (!agendamentoId) {
      res.status(400).json({ erro: 'agendamentoId é obrigatório.' });
      return;
    }

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) {
      res.status(401).json({ erro: 'Faça login novamente antes de pagar.' });
      return;
    }

    let decoded;
    try {
      decoded = await getAuthAdmin().verifyIdToken(idToken);
    } catch (err) {
      res.status(401).json({ erro: 'Sessão expirada — faça login novamente.' });
      return;
    }

    const db = getDb();
    const agendamentoRef = db.collection('agendamentos').doc(agendamentoId);
    const snap = await agendamentoRef.get();
    if (!snap.exists) {
      res.status(404).json({ erro: 'Agendamento não encontrado.' });
      return;
    }
    const agendamento = snap.data();

    if (agendamento.uid !== decoded.uid) {
      res.status(403).json({ erro: 'Esse agendamento não é seu.' });
      return;
    }
    if (agendamento.pago) {
      res.status(400).json({ erro: 'Esse pagamento já está marcado como pago.' });
      return;
    }

    const valor = Number(agendamento.valorCombinado);
    if (!valor || valor <= 0) {
      res.status(400).json({ erro: 'A coordenação ainda não combinou um valor pra esse pagamento.' });
      return;
    }

    const partesNome = (agendamento.nome || 'Aluno').trim().split(/\s+/);
    const primeiroNome = partesNome[0] || 'Aluno';
    const sobrenome = partesNome.slice(1).join(' ') || 'Acordes de Davi';

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocolo = req.headers['x-forwarded-proto'] || 'https';
    const notificationUrl = `${protocolo}://${host}/api/mercadopago/webhook`;

    const respostaMP = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        transaction_amount: Math.round(valor * 100) / 100,
        description: `Projeto Acordes de Davi — ${agendamento.instrumento || 'aula'} (${agendamento.local || ''})`,
        payment_method_id: 'pix',
        external_reference: agendamentoId,
        notification_url: notificationUrl,
        payer: {
          email: email || `${decoded.uid}@alunos.acordesdedavi.app`,
          first_name: primeiroNome,
          last_name: sobrenome
        }
      })
    });

    const pagamento = await respostaMP.json();

    if (!respostaMP.ok) {
      console.error('Erro do Mercado Pago ao criar pagamento:', pagamento);
      res.status(502).json({ erro: pagamento?.message || 'O Mercado Pago recusou a criação do Pix.' });
      return;
    }

    const dadosPix = pagamento?.point_of_interaction?.transaction_data || {};

    // Guarda o id do pagamento no agendamento — útil pra conferir manualmente no painel
    // do Mercado Pago se algum dia precisar investigar um caso específico.
    await agendamentoRef.set(
      { pagamentoMPId: pagamento.id, statusPagamentoMP: pagamento.status },
      { merge: true }
    );

    res.status(200).json({
      paymentId: pagamento.id,
      qrCode: dadosPix.qr_code || '',
      qrCodeBase64: dadosPix.qr_code_base64 || '',
      valor
    });
  } catch (err) {
    console.error('Erro ao criar pagamento Pix:', err);
    res.status(500).json({ erro: 'Erro interno ao gerar o Pix. Tente novamente em instantes.' });
  }
};
