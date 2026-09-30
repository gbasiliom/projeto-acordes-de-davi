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

// Busca o "Emitido por" configurado na aba Configurações (nome/CPF/endereço de quem
// emite o recibo, além do texto legal fixo do CPF do responsável acima) — o mesmo
// documento que o front-end lê em tempo real de "configuracoes/proprietario". Se
// nunca foi preenchido, devolve tudo vazio e o bloco simplesmente não entra no PDF
// (igual já acontece na tela).
async function buscarDadosProprietario(db) {
  try {
    const snap = await db.collection('configuracoes').doc('proprietario').get();
    const dados = snap.exists ? snap.data() : {};
    return { nome: dados?.nome || '', cpf: dados?.cpf || '', endereco: dados?.endereco || '' };
  } catch (err) {
    console.error('Erro ao buscar dados do proprietário pro recibo:', err);
    return { nome: '', cpf: '', endereco: '' };
  }
}

// Número sequencial de controle do recibo — o mesmo conceito usado no App.jsx
// (função "garantirNumeroRecibo" lá do front-end), só que aqui em versão Admin SDK,
// pros recibos automáticos (Pix aprovado pelo webhook, ou "reenviar" manual) que
// nunca passam pela tela. É IDEMPOTENTE: se o agendamento/igreja já tem um número
// salvo (porque alguém já gerou o recibo na tela antes, ou porque esse mesmo
// pagamento já disparou um e-mail antes), devolve o mesmo número de novo, em vez de
// "andar" o contador sem necessidade — assim o mesmo pagamento nunca sai com dois
// números diferentes, seja qual for o caminho (tela ou e-mail automático) que gerou
// primeiro. Roda dentro de uma transação do Firestore pra nunca dar número repetido
// se dois pagamentos caírem juntos (ex: dois Pix aprovados quase ao mesmo tempo).
async function garantirNumeroRecibo(db, colecao, id) {
  if (!id) return null;
  const refDocumento = db.collection(colecao).doc(id);
  const refContador = db.collection('contadores').doc('recibos');
  return db.runTransaction(async (transacao) => {
    const snapDocumento = await transacao.get(refDocumento);
    const numeroExistente = snapDocumento.exists ? snapDocumento.data()?.numeroRecibo : null;
    if (numeroExistente) return numeroExistente;
    const snapContador = await transacao.get(refContador);
    const proximoNumero = (snapContador.exists ? Number(snapContador.data()?.ultimoNumero) || 0 : 0) + 1;
    transacao.set(refContador, { ultimoNumero: proximoNumero }, { merge: true });
    transacao.update(refDocumento, { numeroRecibo: proximoNumero });
    return proximoNumero;
  });
}

// Só pra exibição — "7" vira "000007", igual um talão de recibo de papel.
const formatarNumeroRecibo = (numero) => String(numero || '').padStart(6, '0');

const formatarBRL = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatarDataBR = (isoDate) => {
  if (!isoDate) return new Date().toLocaleDateString('pt-BR');
  try {
    return new Date(`${isoDate}T00:00:00`).toLocaleDateString('pt-BR');
  } catch {
    return isoDate;
  }
};

// Monta o recibo em PDF direto no servidor (jsPDF funciona em Node sem precisar de
// navegador, desde que a gente use .output('arraybuffer') em vez de .save() — .save()
// depende do DOM do navegador). O visual foi desenhado pra ficar o mais parecido
// possível com o cartão que aparece na tela (aba Pagamentos/Igrejas > "Gerar Recibo"):
// moldura dupla verde-esmeralda, título em serifada (Times, o mais próximo que o
// jsPDF tem da fonte "serif" usada na tela — ele não embute a fonte real do site),
// caixa do valor com linhas em cima/baixo, mesmo texto legal fixo, bloco "Emitido
// por" (quando configurado na aba Configurações) e rodapé de assinatura com data.
// Duas diferenças conscientes em relação ao cartão da tela: (1) a fonte não é
// IDÊNTICA (jsPDF só tem Helvetica/Times/Courier embutidas); (2) sem o logo/marca
// d'água — colocá-lo aqui exigiria converter o SVG pra imagem antes (uma dependência
// nova só pra isso), então por ora o PDF automático sai só com o texto do cabeçalho.
function montarPdfReciboBuffer({ nomePagador, origem, nomePolo, instrumento, tipoPagamento, valor, formaPagamento, dataPagamento, numeroRecibo, dadosProprietario, alunosDoPacote }) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margem = 18;
  const largura = pdf.internal.pageSize.getWidth();
  const altura = pdf.internal.pageSize.getHeight();

  // Moldura dupla, imitando a borda "border-8 border-double border-emerald-800" do
  // cartão em tela.
  const corBorda = [6, 78, 59]; // emerald-800
  pdf.setDrawColor(...corBorda);
  pdf.setLineWidth(1.4);
  pdf.rect(margem, margem, largura - margem * 2, altura - margem * 2);
  pdf.setLineWidth(0.4);
  pdf.rect(margem + 3, margem + 3, largura - (margem + 3) * 2, altura - (margem + 3) * 2);

  const centro = largura / 2;
  let y = margem + 18;

  if (numeroRecibo) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 116, 139); // slate-500
    pdf.text(`RECIBO Nº ${formatarNumeroRecibo(numeroRecibo)}`, centro, y, { align: 'center' });
    y += 8;
  }

  pdf.setFont('times', 'bold');
  pdf.setFontSize(17);
  pdf.setTextColor(6, 78, 59); // emerald-900
  pdf.text('PROJETO ACORDES DE DAVI', centro, y, { align: 'center' });
  y += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(5, 150, 105); // emerald-600
  pdf.text('A MÚSICA TRANSFORMA VIDAS', centro, y, { align: 'center' });
  y += 12;

  pdf.setFont('times', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(30, 41, 59); // slate-800
  pdf.text('Recibo de Pagamento', centro, y, { align: 'center' });
  y += 12;

  const forma = formaPagamento === 'pix' ? 'Pix' : formaPagamento === 'dinheiro' ? 'Dinheiro' : 'Outro';
  const linhasDetalhe = [
    [origem === 'igreja' ? 'Igreja mantenedora:' : 'Aluno(a):', nomePagador],
    ['Polo:', nomePolo],
    ...(instrumento ? [['Instrumento:', instrumento]] : []),
    ['Tipo de cobrança:', tipoPagamento === 'individual' ? 'Individual' : 'Pacote'],
    ['Forma de pagamento:', forma],
    ['Data do pagamento:', formatarDataBR(dataPagamento)]
  ];
  pdf.setFontSize(11);
  linhasDetalhe.forEach(([rotulo, texto]) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(30, 41, 59); // slate-800
    pdf.text(rotulo, margem + 12, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(51, 65, 85); // slate-700
    pdf.text(String(texto || '-'), margem + 55, y);
    y += 6.5;
  });

  y += 6;
  pdf.setDrawColor(5, 150, 105); // emerald-600
  pdf.setLineWidth(0.6);
  pdf.line(margem + 12, y, largura - margem - 12, y);
  y += 11;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(24);
  pdf.setTextColor(6, 78, 59); // emerald-900
  pdf.text(formatarBRL(valor), centro, y, { align: 'center' });
  y += 5;
  pdf.setLineWidth(0.6);
  pdf.line(margem + 12, y, largura - margem - 12, y);
  y += 12;

  const textoRecibo = `O Projeto Acordes de Davi - ${NOME_RESPONSAVEL}, CPF ${CPF_RESPONSAVEL}, dizemos que: "Recebemos de ${nomePagador} o valor acima referente ao pagamento ${instrumento ? `das aulas de ${instrumento}` : 'do pacote de aulas'} no Projeto Acordes de Davi, polo ${nomePolo}."`;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10.5);
  pdf.setTextColor(51, 65, 85); // slate-700
  const linhasTexto = pdf.splitTextToSize(textoRecibo, largura - (margem + 12) * 2);
  pdf.text(linhasTexto, centro, y, { align: 'center' });
  y += linhasTexto.length * 5.2 + 6;

  if (Array.isArray(alunosDoPacote) && alunosDoPacote.length > 0) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(30, 41, 59);
    pdf.text('ALUNOS ATENDIDOS POR ESSE PACOTE', margem + 12, y);
    y += 5.5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(51, 65, 85);
    alunosDoPacote.forEach((nomeAluno) => {
      pdf.text(`•  ${nomeAluno}`, margem + 12, y);
      y += 5.5;
    });
    y += 4;
  }

  if (dadosProprietario?.nome) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(51, 65, 85);
    pdf.text('EMITIDO POR', margem + 12, y);
    y += 4.2;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(75, 85, 99);
    const linhaEmissor = dadosProprietario.cpf
      ? `${dadosProprietario.nome} — CPF/CNPJ: ${dadosProprietario.cpf}`
      : dadosProprietario.nome;
    pdf.text(linhaEmissor, margem + 12, y);
    y += 4.2;
    if (dadosProprietario.endereco) {
      pdf.text(dadosProprietario.endereco, margem + 12, y);
      y += 4.2;
    }
  }

  // Rodapé de assinatura sempre no mesmo lugar (perto do fim da página), igual ao
  // cartão em tela — em vez de colado no que veio antes, que varia de tamanho.
  const yAssinatura = altura - margem - 22;
  pdf.setDrawColor(148, 163, 184); // slate-400
  pdf.setLineWidth(0.3);
  pdf.line(centro - 28, yAssinatura, centro + 28, yAssinatura);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(30, 41, 59);
  pdf.text('Coordenação do Projeto', centro, yAssinatura + 5, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8.5);
  pdf.setTextColor(100, 116, 139);
  pdf.text(`Recibo emitido em: ${new Date().toLocaleDateString('pt-BR')}`, centro, yAssinatura + 10, { align: 'center' });

  return Buffer.from(pdf.output('arraybuffer'));
}

// Remetente do Resend usando o domínio próprio (acordesdedavi.com.br), verificado no
// painel do Resend via registros DNS (DKIM + SPF) cadastrados no Registro.br. Antes de
// verificar o domínio, isso aqui usava 'onboarding@resend.dev' (remetente compartilhado
// do Resend, chega com "via resend.dev" pra quem recebe).
const REMETENTE_PADRAO = 'Projeto Acordes de Davi <recibos@acordesdedavi.com.br>';

async function enviarEmailRecibo({ destinatarioEmail, nomePagador, valor, pdfBuffer, nomeArquivo, numeroRecibo }) {
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
      <p style="color:#4b5563;margin-top:0">Recibo de pagamento${numeroRecibo ? ` — Nº ${formatarNumeroRecibo(numeroRecibo)}` : ''}</p>
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

    // Mesmo número que aparece no cartão em tela e na aba Financeiro — se essa conta já
    // tinha sido aberta manualmente antes ("Gerar Recibo"), reaproveita o número que já
    // foi salvo em vez de gerar outro; se é a 1ª vez (ex: Pix aprovado sozinho pelo
    // webhook, sem ninguém ter clicado em nada), gera agora.
    const [numeroRecibo, dadosProprietario] = await Promise.all([
      garantirNumeroRecibo(db, tipo === 'igreja' ? 'igrejas' : 'agendamentos', id),
      buscarDadosProprietario(db)
    ]);

    // Recibo de pacote sai em nome da igreja, mas lista os alunos atendidos por ela
    // (mesma lista que já aparece no cartão em tela) — busca todos os agendamentos
    // daquele polo.
    let alunosDoPacote = null;
    if (tipo === 'igreja' && dados.poloId) {
      try {
        const snapAlunos = await db.collection('agendamentos').where('local', '==', dados.poloId).get();
        alunosDoPacote = snapAlunos.docs.map((d) => {
          const a = d.data();
          return a.instrumento ? `${a.nome} — ${a.instrumento}` : a.nome;
        });
      } catch (err) {
        console.error('Erro ao buscar alunos do pacote pro recibo:', err);
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
      dataPagamento: dados.dataPagamento,
      numeroRecibo,
      dadosProprietario,
      alunosDoPacote
    });

    const nomeArquivo = `recibo-${numeroRecibo ? `${formatarNumeroRecibo(numeroRecibo)}-` : ''}${(nomePagador || 'acordes-de-davi')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;

    const resultado = await enviarEmailRecibo({ destinatarioEmail, nomePagador, valor, pdfBuffer, nomeArquivo, numeroRecibo });
    return resultado;
  } catch (err) {
    console.error(`Erro ao processar recibo automático (${tipo} ${id}):`, err);
    return { enviado: false, motivo: 'erro interno ao montar o recibo' };
  }
}

module.exports = { processarRecibo, montarPdfReciboBuffer, enviarEmailRecibo };
