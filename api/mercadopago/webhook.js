// Função serverless da Vercel: POST /api/mercadopago/webhook
//
// É pra essa URL que você aponta a notificação (webhook) no painel do Mercado Pago
// (Sua integração > Webhooks > URL de produção): https://SEU-DOMINIO/api/mercadopago/webhook
//
// Toda vez que o status de um pagamento muda (ex: aprovado), o Mercado Pago chama essa
// função. Ela busca os detalhes do pagamento na API do Mercado Pago (nunca confia só no
// que veio na notificação) e, se estiver aprovado, marca o agendamento correspondente
// como pago no Firestore — o mesmo agendamento fica visível em tempo real tanto no
// Portal do Aluno quanto na aba Pagamentos do admin, sem ninguém precisar clicar em nada.
const { getDb } = require('../_firebaseAdmin');
const crypto = require('crypto');

// Confere a assinatura enviada pelo Mercado Pago, quando a variável de ambiente
// MERCADOPAGO_WEBHOOK_SECRET estiver configurada (painel do Mercado Pago > Webhooks >
// "Assinatura secreta"). Sem essa variável configurada, a função aceita a notificação
// sem validar a assinatura — funciona igual, só sem essa camada extra de segurança.
function assinaturaValida(req) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return true;

  const assinatura = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!assinatura) return false;

  const partes = Object.fromEntries(
    assinatura.split(',').map((p) => p.trim().split('=').map((s) => s.trim()))
  );
  const { ts, v1 } = partes;
  if (!ts || !v1) return false;

  const dataId = req.query['data.id'] || req.body?.data?.id || '';
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hash === v1;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  try {
    if (!assinaturaValida(req)) {
      console.warn('Webhook do Mercado Pago com assinatura inválida — ignorado.');
      // Responde 200 mesmo assim: se responder erro, o Mercado Pago fica reenviando a
      // mesma notificação sem parar.
      res.status(200).end();
      return;
    }

    const tipo = req.query.type || req.body?.type;
    const paymentId = req.query['data.id'] || req.body?.data?.id;

    if (tipo !== 'payment' || !paymentId) {
      res.status(200).end();
      return;
    }

    const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (!accessToken) {
      console.error('Webhook recebido, mas MERCADOPAGO_ACCESS_TOKEN não está configurada.');
      res.status(200).end();
      return;
    }

    const respostaMP = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const pagamento = await respostaMP.json();

    if (!respostaMP.ok || !pagamento?.external_reference) {
      res.status(200).end();
      return;
    }

    const db = getDb();
    const agendamentoRef = db.collection('agendamentos').doc(pagamento.external_reference);

    if (pagamento.status === 'approved') {
      await agendamentoRef.set(
        {
          pago: true,
          formaPagamento: 'pix',
          dataPagamento: new Date().toISOString().slice(0, 10),
          statusPagamentoMP: 'approved',
          valorPago: pagamento.transaction_amount
        },
        { merge: true }
      );
    } else {
      await agendamentoRef.set({ statusPagamentoMP: pagamento.status }, { merge: true });
    }

    res.status(200).end();
  } catch (err) {
    console.error('Erro no webhook do Mercado Pago:', err);
    // Sempre responde 200 — um erro nosso não deve fazer o Mercado Pago martelar
    // retentativas em loop. O problema fica logado nos Logs da Vercel pra investigar.
    res.status(200).end();
  }
};
