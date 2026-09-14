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
//
// Um pagamento de Pix gerado pra uma igreja (aba "Igrejas", cobrança consolidada por
// polo) chega aqui com external_reference no formato "igreja:<id>" — nesse caso, marca
// como pago o documento da igreja em vez de um agendamento. Os dois casos convivem sem
// se misturar.
//
// IMPORTANTE — o Mercado Pago manda essa notificação em DOIS formatos diferentes,
// dependendo da conta/integração, e o código aqui precisa aceitar os dois:
//   • Formato novo:  ?type=payment&data.id=123
//   • Formato antigo ("Feed", IPN clássico):  ?topic=payment&id=123
// Os dois chegam como POST, mas o formato antigo vem SEM corpo nenhum (tudo na URL).
// Por isso a gente desliga o processamento automático de corpo da Vercel aqui embaixo
// (`config.api.bodyParser = false`) e lê tudo direto da URL (req.query) — sem isso, uma
// notificação sem corpo com Content-Type de JSON faz a própria Vercel devolver erro 400
// ANTES do código abaixo rodar (foi exatamente isso que aconteceu: a Vercel recusava a
// notificação sozinha, sem nem chegar a chamar essa função).
const { getDb } = require('../_firebaseAdmin');
const crypto = require('crypto');

// Confere a assinatura enviada pelo Mercado Pago, quando a variável de ambiente
// MERCADOPAGO_WEBHOOK_SECRET estiver configurada (painel do Mercado Pago > Webhooks >
// "Assinatura secreta"). Sem essa variável configurada, a função aceita a notificação
// sem validar a assinatura — funciona igual, só sem essa camada extra de segurança.
// Só existe no formato NOVO de notificação — o formato antigo (Feed/IPN) não manda
// assinatura nenhuma, então aqui sempre passa direto pro formato antigo.
function assinaturaValida(req, dataId) {
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

  const manifest = `id:${dataId || ''};request-id:${requestId};ts:${ts};`;
  const hash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return hash === v1;
}

async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  try {
    // Formato novo: ?type=payment&data.id=123 — formato antigo (Feed/IPN clássico):
    // ?topic=payment&id=123. Os dois vêm sempre na URL (req.query), nunca dependemos
    // do corpo da requisição — por isso o bodyParser está desligado (config abaixo).
    const tipo = req.query.type || req.query.topic;
    const paymentId = req.query['data.id'] || req.query.id;

    if (!assinaturaValida(req, paymentId)) {
      console.warn('Webhook do Mercado Pago com assinatura inválida — ignorado.');
      // Responde 200 mesmo assim: se responder erro, o Mercado Pago fica reenviando a
      // mesma notificação sem parar.
      res.status(200).end();
      return;
    }

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

    // "igreja:<id>" -> cobrança consolidada da aba Igrejas; qualquer outro valor de
    // external_reference é o id de um agendamento normal (comportamento de sempre).
    const referencia = String(pagamento.external_reference);
    const ehIgreja = referencia.startsWith('igreja:');
    const docRef = ehIgreja
      ? db.collection('igrejas').doc(referencia.slice('igreja:'.length))
      : db.collection('agendamentos').doc(referencia);

    if (pagamento.status === 'approved') {
      await docRef.set(
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
      await docRef.set({ statusPagamentoMP: pagamento.status }, { merge: true });
    }

    res.status(200).end();
  } catch (err) {
    console.error('Erro no webhook do Mercado Pago:', err);
    // Sempre responde 200 — um erro nosso não deve fazer o Mercado Pago martelar
    // retentativas em loop. O problema fica logado nos Logs da Vercel pra investigar.
    res.status(200).end();
  }
}

// Desliga o processamento automático de corpo da Vercel pra essa função — sem isso,
// uma notificação sem corpo (como o formato antigo do Mercado Pago manda) faz a própria
// Vercel recusar a requisição com erro 400 ANTES do código acima rodar (foi exatamente
// esse o problema visto no teste). Precisa declarar o handler como função nomeada e
// colar o ".config" nela ANTES do "module.exports = handler" — se fosse colado direto
// em "module.exports", seria perdido assim que "module.exports" fosse reatribuído.
handler.config = {
  api: {
    bodyParser: false
  }
};

module.exports = handler;
