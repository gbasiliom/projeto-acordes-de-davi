// Módulo compartilhado do back-end: monta o recibo em PDF e manda por e-mail, sem
// precisar de nenhum clique — chamado de dois lugares:
//   1) api/mercadopago/webhook.js, assim que um Pix é aprovado (zero intervenção humana).
//   2) api/recibos/enviar.js, quando o admin marca um pagamento como pago manualmente
//      (dinheiro, Pix fora do site, etc.) pela aba Pagamentos/Igrejas.
//
// O e-mail do destinatário NUNCA é um campo novo pra preencher — ele é sempre o mesmo
// e-mail que a pessoa já usa pra entrar no Portal do Aluno ou no Portal da Igreja:
//   - Aluno: o agendamento guarda só o "uid" da conta; o e-mail em si mora no Firebase
//     Auth (é de lá que o Portal do Aluno faz login) — por isso buscamos com
//     authAdmin.getUser(uid).email em vez de duplicar o e-mail no Firestore.
//   - Igreja: o e-mail de acesso ao Portal da Igreja já fica salvo direto no documento
//     (campo "email", gravado por api/igrejas/criar-acesso.js) — usamos esse mesmo campo.
//
// Precisa da variável de ambiente RESEND_API_KEY (painel da Vercel > Project Settings >
// Environment Variables) com uma chave de API criada em resend.com. Sem essa variável,
// a função de envio simplesmente avisa no log e não quebra o resto do fluxo — um Pix
// aprovado continua marcando o pagamento como pago mesmo que o e-mail não saia.
const { jsPDF } = require('jspdf');

// Precisa ficar em sincronia com a constante ADMIN_EMAIL usada nos outros arquivos de
// api/ e no App.jsx (frontend).
const CPF_RESPONSAVEL = '12554043701';
const NOME_RESPONSAVEL = 'Gabriel Basilio de Miranda';

// Cópia mínima do POLOS_PADRAO do App.jsx (só os nomes, que é tudo que o recibo
// precisa) — usada como fallback pra quando o polo não tem um nome customizado salvo
// na coleção "polos" do Firestore.
const NOMES_POLOS_PADRAO = {
  saoluiz: 'São Luiz',
  matafria: 'Mata Fria / Penha do Côco',
  chale: 'Chalé',
  penhadococo: 'Igreja Tabernáculo (Penha do Côco)',
  agualimpa: 'Água Limpa'
};

async function nomeDoPolo(db, poloId) {
  if (!poloId) return poloId || '';
  try {
    const snap = await db.collection('polos').doc(poloId).get();
    if (snap.exists && snap.data()?.nome) return snap.data().nome;
  } catch (err) {
    console.error('Erro ao buscar nome do polo pro recibo:', err);
  }
  return NOMES_POLOS_PADRAO[poloId] || poloId;
}

const formatarBRL = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatarDataBR = (isoDate) => {
  if (!isoDate) return new Date().toLocaleDateString('pt-BR');
  try {
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString('pt-BR');
  } catch {
    return isoDate;
  }
};

// Monta o mesmo texto usado no recibo em tela ("O Projeto Acordes de Davi - Gabriel
// Basilio de Miranda, CPF ..., dizemos que: 'Recebemos de ...'"), só que direto em PDF
// server-side (jsPDF funciona em Node sem precisar de navegador, desde que a gente use
// .output('arraybuffer') em vez de .save() — .save() depende do DOM do navegador).
function montarPdfReciboBuffer({ nomePagador, origem, nomePolo, instrumento, tipoPagamento, valor, formaPagamento, dataPagamento }) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margem = 22;
  const largura = pdf.internal.pageSize.getWidth();
  let y = 30;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.setTextColor(6, 78, 59);
  pdf.text('Projeto Acordes de Davi', largura / 2, y, { align: 'center' });
  y += 8;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(100, 100, 100);
  pdf.text('Comprovante de Pagamento', largura / 2, y, { align: 'center' });
  y += 14;

  pdf.setDrawColor(200, 200, 200);
  pdf.line(margem, y, largura - margem, y);
  y += 12;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.setTextColor(20, 20, 20);
  pdf.text(formatarBRL(valor), largura / 2, y, { align: 'center' });
  y += 16;

  const forma = formaPagamento === 'pix' ? 'Pix' : formaPagamento === 'dinheiro' ? 'Dinheiro' : 'Outro';
  const linhas = [
    [origem === 'igreja' ? 'Igreja mantenedora' : 'Aluno(a)', nomePagador],
    ['Polo', nomePolo],
    ...(instrumento ? [['Instrumento', instrumento]] : []),
    ['Referente a', tipoPagamento === 'individual' ? 'Aula(s) individual(is)' : 'Pacote de aulas'],
    ['Forma de pagamento', forma],
    ['Data do pagamento', formatarDataBR(dataPagamento)]
  ];
  pdf.setFontSize(12);
  linhas.forEach(([rotulo, texto]) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(60, 60, 60);
    pdf.text(`${rotulo}:`, margem, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(20, 20, 20);
    pdf.text(String(texto || '-'), margem + 55, y);
    y += 9;
  });

  y += 8;
  pdf.setDrawColor(200, 200, 200);
  pdf.line(margem, y, largura - margem, y);
  y += 12;

  const textoRecibo = `O Projeto Acordes de Davi - ${NOME_RESPONSAVEL}, CPF ${CPF_RESPONSAVEL}, dizemos que: "Recebemos de ${nomePagador} o valor acima referente ao pagamento ${instrumento ? `das aulas de ${instrumento}` : 'do pacote de aulas'} no Projeto Acordes de Davi, polo ${nomePolo}."`;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(40, 40, 40);
  const linhasTexto = pdf.splitTextToSize(textoRecibo, largura - margem * 2);
  pdf.text(linhasTexto, margem, y);

  return Buffer.from(pdf.output('arraybuffer'));
}

// Remetente do Resend usando o domínio próprio (acordesdedavi.com.br), verificado no
// painel do Resend via registros DNS (DKIM + SPF) cadastrados no Registro.br. Antes de
// verificar o domínio, isso aqui usava 'onboarding@resend.dev' (remetente compartilhado
// do Resend, chega com "via resend.dev" pra quem recebe).
const REMETENTE_PADRAO = 'Projeto Acordes de Davi <recibos@acordesdedavi.com.br>';

async function enviarEmailRecibo({ destinatarioEmail, nomePagador, valor, pdfBuffer, nomeArquivo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY não configurada — recibo não foi enviado por e-mail (só ficou marcado como pago).');
    return { enviado: false, motivo: 'RESEND_API_KEY não configurada' };
  }
  if (!destinatarioEmail) {
    console.error('Recibo não enviado: não foi encontrado e-mail de acesso pra essa pessoa.');
    return { enviado: false, motivo: 'sem e-mail cadastrado' };
  }

  const corpoHtml = `
    <div style="font-family:Arial,sans-serif;color:#1f2937;max-width:480px;margin:0 auto">
      <h2 style="color:#065f46;margin-bottom:4px">Projeto Acordes de Davi</h2>
      <p style="color:#4b5563;margin-top:0">Recibo de pagamento</p>
      <p>Olá, ${nomePagador}!</p>
      <p>Recebemos o pagamento de <strong>${formatarBRL(valor)}</strong> referente às aulas do Projeto Acordes de Davi. O recibo em PDF está em anexo.</p>
      <p style="color:#6b7280;font-size:13px;margin-top:24px">Qualquer dúvida, fale com a coordenação do seu polo.</p>
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
      to: [destinatarioEmail],
      subject: 'Recibo de pagamento — Projeto Acordes de Davi',
      html: corpoHtml,
      attachments: [
        {
          filename: nomeArquivo,
          content: pdfBuffer.toString('base64')
        }
      ]
    })
  });

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    console.error('Resend recusou o envio do recibo:', erro);
    return { enviado: false, motivo: erro?.message || 'Resend recusou o envio' };
  }
  return { enviado: true };
}

// Ponto de entrada único, chamado tanto pelo webhook do Mercado Pago (Pix aprovado)
// quanto pelo endpoint /api/recibos/enviar (admin marcou como pago manualmente).
// Nunca lança erro pra quem chamou — um problema aqui não pode derrubar o webhook nem
// a marcação de "pago" no Firestore, só fica registrado no log da Vercel.
async function processarRecibo({ db, authAdmin, tipo, id, dados }) {
  try {
    const nomePolo = await nomeDoPolo(db, tipo === 'igreja' ? dados.poloId : dados.local);
    const valor = Number(dados.valorPago ?? dados.valorCombinado ?? 0);

    let destinatarioEmail = null;
    let nomePagador = dados.nome;
    if (tipo === 'igreja') {
      destinatarioEmail = dados.email || null;
    } else if (dados.uid) {
      try {
        const usuarioAuth = await authAdmin.getUser(dados.uid);
        destinatarioEmail = usuarioAuth.email || null;
      } catch (err) {
        console.error(`Não foi possível buscar o e-mail do aluno (uid ${dados.uid}):`, err.message);
      }
    }

    const pdfBuffer = montarPdfReciboBuffer({
      nomePagador,
      origem: tipo === 'igreja' ? 'igreja' : 'aluno',
      nomePolo,
      instrumento: dados.instrumento || '',
      tipoPagamento: dados.tipoPagamento,
      valor,
      formaPagamento: dados.formaPagamento,
      dataPagamento: dados.dataPagamento
    });

    const nomeArquivo = `recibo-${(nomePagador || 'acordes-de-davi')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;

    const resultado = await enviarEmailRecibo({ destinatarioEmail, nomePagador, valor, pdfBuffer, nomeArquivo });
    return resultado;
  } catch (err) {
    console.error(`Erro ao processar recibo automático (${tipo} ${id}):`, err);
    return { enviado: false, motivo: 'erro interno ao montar o recibo' };
  }
}

module.exports = { processarRecibo, montarPdfReciboBuffer, enviarEmailRecibo };
