// Função serverless da Vercel: POST /api/mercadopago/criar-pix
//
// Tem dois jeitos de chamar essa função, sem misturar um com o outro:
//
// 1) { agendamentoId, email } — chamada pelo botão "Pagar com Pix" no Portal do Aluno
//    (App.jsx). Confere que quem está pedindo é o próprio aluno dono do agendamento,
//    olha o "Valor combinado" que o admin definiu na aba Pagamentos, e cobra só a aula
//    dele.
// 2) { igrejaId, email } — chamada pelo admin na aba "Igrejas", pra gerar UMA cobrança
//    única pro mantenedor/igreja de um polo inteiro (em vez de cobrar aluno por aluno).
//    Só o admin (mesmo e-mail configurado em ADMIN_EMAIL) pode gerar esse tipo de Pix.
//
// Nos dois casos, cria uma cobrança Pix de verdade no Mercado Pago — devolvendo o QR
// Code (imagem) e o código "copia e cola" pra pagar no app do banco.
//
// Precisa de duas variáveis de ambiente na Vercel: MERCADOPAGO_ACCESS_TOKEN (Access
// Token do Mercado Pago) e FIREBASE_SERVICE_ACCOUNT (ver api/_firebaseAdmin.js). Sem
// elas, essa função responde com um erro explicando o que falta configurar — não quebra
// o resto do site.
const { getDb, getAuthAdmin } = require('../_firebaseAdmin');
const crypto = require('crypto');

// Mesmo e-mail de admin usado no App.jsx (frontend) — precisa ficar em sincronia com a
// constante ADMIN_EMAIL de lá. Só esse e-mail pode gerar o Pix consolidado de uma igreja.
const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

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
    const { agendamentoId, igrejaId, email } = req.body || {};
    if (!agendamentoId && !igrejaId) {
      res.status(400).json({ erro: 'agendamentoId ou igrejaId é obrigatório.' });
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
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocolo = req.headers['x-forwarded-proto'] || 'https';
    const notificationUrl = `${protocolo}://${host}/api/mercadopago/webhook`;

    let valor, descricao, externalReference, payerEmail, primeiroNome, sobrenome, refParaSalvar;

    if (igrejaId) {
      // Cobrança consolidada de uma igreja/polo — só o admin pode gerar.
      if (decoded.email !== ADMIN_EMAIL) {
        res.status(403).json({ erro: 'Só a coordenação pode gerar o Pix de uma igreja.' });
        return;
      }

      const igrejaRef = db.collection('igrejas').doc(igrejaId);
      const snap = await igrejaRef.get();
      if (!snap.exists) {
        res.status(404).json({ erro: 'Igreja não encontrada.' });
        return;
      }
      const igreja = snap.data();

      if (igreja.pago) {
        res.status(400).json({ erro: 'Esse pagamento já está marcado como pago.' });
        return;
      }

      valor = Number(igreja.valorCombinado);
      if (!valor || valor <= 0) {
        res.status(400).json({ erro: 'Defina o valor combinado dessa igreja antes de gerar o Pix.' });
        return;
      }

      const partesNome = (igreja.nome || 'Igreja').trim().split(/\s+/);
      primeiroNome = partesNome[0] || 'Igreja';
      sobrenome = partesNome.slice(1).join(' ') || 'Acordes de Davi';
      descricao = `Projeto Acordes de Davi — pacote do polo (${igreja.nome || igrejaId})`;
      externalReference = `igreja:${igrejaId}`;
      payerEmail = email || `${decoded.uid}@admin.acordesdedavi.app`;
      refParaSalvar = igrejaRef;
    } else {
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

      valor = Number(agendamento.valorCombinado);
      if (!valor || valor <= 0) {
        res.status(400).json({ erro: 'A coordenação ainda não combinou um valor pra esse pagamento.' });
        return;
      }

      const partesNome = (agendamento.nome || 'Aluno').trim().split(/\s+/);
      primeiroNome = partesNome[0] || 'Aluno';
      sobrenome = partesNome.slice(1).join(' ') || 'Acordes de Davi';
      descricao = `Projeto Acordes de Davi — ${agendamento.instrumento || 'aula'} (${agendamento.local || ''})`;
      externalReference = agendamentoId;
      payerEmail = email || `${decoded.uid}@alunos.acordesdedavi.app`;
      refParaSalvar = agendamentoRef;
    }

    const respostaMP = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        transaction_amount: Math.round(valor * 100) / 100,
        description: descricao,
        payment_method_id: 'pix',
        external_reference: externalReference,
        notification_url: notificationUrl,
        payer: {
          email: payerEmail,
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

    // Guarda o id do pagamento no documento (agendamento ou igreja) — útil pra conferir
    // manualmente no painel do Mercado Pago se algum dia precisar investigar um caso.
    await refParaSalvar.set(
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
