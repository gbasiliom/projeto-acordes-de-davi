// Função serverless da Vercel: POST /api/alunos/unificar-acesso
//
// Corrige o caso "o aluno tem 2 (ou mais) aulas, mas o Portal do Aluno só mostra uma".
// O portal busca as aulas pelo campo "uid" (a conta de login do aluno). Quando uma das
// aulas ficou sem uid (ex.: recriada pela migração do São Luiz / importação de planilha)
// ou ficou com o uid de OUTRA conta (aluno que se cadastrou 2 vezes com e-mails
// diferentes), essa aula some do portal dele.
//
// Duas ações, só para a coordenação (admin):
//   { acao: 'consultar', uids: [...] }
//       → devolve o e-mail e o último login de cada conta, pra você escolher qual manter.
//   { acao: 'unificar', agendamentoIds: [...], uid }            → usa uma conta que já existe
//   { acao: 'unificar', agendamentoIds: [...], email, senha }   → cria (ou reaproveita) uma conta
//       → grava esse uid em TODAS as aulas escolhidas e também nas presenças e avaliações
//         dessas aulas (o portal busca presenças/avaliações pelo uid também).
//       Se isso fizer o mesmo login ficar com alunos de NOMES diferentes (e-mail
//       compartilhado: irmãos, pai com filhos, banda), responde 409 com
//       codigo 'COMPARTILHADO' e só segue quando vier confirmarCompartilhado: true — aí
//       já marca o compartilhamento como aprovado pelo admin.
//   { acao: 'desvincular', agendamentoIds: [...] }
//       → tira o login dessas aulas (desfaz um e-mail compartilhado que o admin não
//         aprovou). Nada é apagado: o aluno vai pra lista "sem login" e você define outro
//         e-mail pra ele.
//
// Feito aqui (firebase-admin) e não no App.jsx porque o SDK do navegador não consegue
// criar conta pra outra pessoa sem derrubar a sessão do admin, e porque assim a correção
// não depende das regras do Firestore permitirem trocar o campo uid.
const { getDb, getAuthAdmin } = require('../_firebaseAdmin');

const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

const normalizar = (texto) => (texto || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const emPedacos = (lista, tamanho) => {
  const pedacos = [];
  for (let i = 0; i < lista.length; i += tamanho) pedacos.push(lista.slice(i, i + tamanho));
  return pedacos;
};

async function contaDeAluno(db, authAdmin, uid) {
  // Nunca vincula aula de aluno à conta da coordenação ou de uma igreja.
  const usuario = await authAdmin.getUser(uid);
  if (usuario.email === ADMIN_EMAIL) {
    return { erro: 'Essa é a conta da coordenação (admin) — escolha a conta do aluno.' };
  }
  const igrejaSnap = await db.collection('igrejas').where('uid', '==', uid).limit(1).get();
  if (!igrejaSnap.empty) {
    return { erro: 'Essa conta é o login de uma igreja — escolha (ou crie) a conta do aluno.' };
  }
  return { usuario };
}

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
      res.status(403).json({ erro: 'Só a coordenação pode corrigir o acesso de um aluno.' });
      return;
    }

    const db = getDb();
    const { acao } = req.body || {};

    // ---------- consultar: e-mail de cada conta ----------
    if (acao === 'consultar') {
      const uids = [...new Set((req.body.uids || []).filter(Boolean))].slice(0, 300);
      const contas = {};
      for (const pedaco of emPedacos(uids, 100)) {
        const resultado = await authAdmin.getUsers(pedaco.map(uid => ({ uid })));
        resultado.users.forEach(u => {
          contas[u.uid] = {
            email: u.email || null,
            ultimoLogin: u.metadata?.lastSignInTime || null,
            criadoEm: u.metadata?.creationTime || null
          };
        });
        resultado.notFound.forEach(n => { contas[n.uid] = { inexistente: true }; });
      }
      res.status(200).json({ contas });
      return;
    }

    // ---------- desvincular: tira o login dessas aulas ----------
    if (acao === 'desvincular') {
      const ids = [...new Set((req.body.agendamentoIds || []).filter(Boolean))].slice(0, 50);
      if (ids.length === 0) {
        res.status(400).json({ erro: 'Escolha pelo menos uma aula.' });
        return;
      }
      const operacoes = ids.map(id => ({ ref: db.collection('agendamentos').doc(id), dados: { uid: null, compartilhamentoAprovado: false } }));
      for (const colecao of ['presencas', 'avaliacoes']) {
        for (const pedaco of emPedacos(ids, 30)) {
          const snap = await db.collection(colecao).where('agendamentoId', 'in', pedaco).get();
          snap.docs.forEach(d => operacoes.push({ ref: d.ref, dados: { uid: null } }));
        }
      }
      for (const pedaco of emPedacos(operacoes, 450)) {
        const lote = db.batch();
        pedaco.forEach(op => lote.update(op.ref, op.dados));
        await lote.commit();
      }
      res.status(200).json({ aulasDesvinculadas: ids.length });
      return;
    }

    if (acao !== 'unificar') {
      res.status(400).json({ erro: 'Ação inválida.' });
      return;
    }

    // ---------- unificar ----------
    const agendamentoIds = [...new Set((req.body.agendamentoIds || []).filter(Boolean))];
    if (agendamentoIds.length === 0) {
      res.status(400).json({ erro: 'Escolha pelo menos uma aula.' });
      return;
    }
    if (agendamentoIds.length > 50) {
      res.status(400).json({ erro: 'Muitas aulas de uma vez — faça um aluno por vez.' });
      return;
    }

    const confirmarCompartilhado = req.body.confirmarCompartilhado === true;

    // Confere se todas as aulas existem antes de mexer em qualquer coisa (inclusive antes
    // de criar conta nova).
    const refs = agendamentoIds.map(id => db.collection('agendamentos').doc(id));
    const snaps = await db.getAll(...refs);
    const faltando = snaps.filter(s => !s.exists).map(s => s.id);
    if (faltando.length) {
      res.status(404).json({ erro: `Aula(s) não encontrada(s): ${faltando.join(', ')}. Atualize a página e tente de novo.` });
      return;
    }

    // Nomes de aluno que vão ficar no mesmo login. Mais de um nome = e-mail compartilhado,
    // que só segue com a confirmação do admin.
    const nomesPorChave = new Map();
    const juntarNomes = (lista) => lista.forEach(d => {
      const chave = normalizar(d.nome);
      if (chave && !nomesPorChave.has(chave)) nomesPorChave.set(chave, (d.nome || '').trim());
    });
    juntarNomes(snaps.map(s => s.data()));
    const pedirConfirmacao = () => {
      res.status(409).json({
        codigo: 'COMPARTILHADO',
        nomes: [...nomesPorChave.values()],
        erro: `Esse login vai ficar com mais de um aluno (${[...nomesPorChave.values()].join(', ')}). Confirme pra liberar o e-mail compartilhado.`
      });
    };
    if (nomesPorChave.size > 1 && !confirmarCompartilhado) { pedirConfirmacao(); return; }

    let uidDestino = (req.body.uid || '').trim();
    const emailLimpo = (req.body.email || '').trim().toLowerCase();
    const senha = req.body.senha || '';
    let contaCriada = false;
    let senhaNovaDaConta = null;

    if (uidDestino) {
      try {
        const { erro } = await contaDeAluno(db, authAdmin, uidDestino);
        if (erro) { res.status(409).json({ erro }); return; }
      } catch (errBusca) {
        if (errBusca.code === 'auth/user-not-found') {
          res.status(404).json({ erro: 'Essa conta de login não existe mais. Escolha outra ou crie uma nova com e-mail e senha.' });
          return;
        }
        throw errBusca;
      }
    } else if (emailLimpo) {
      if (emailLimpo === ADMIN_EMAIL) {
        res.status(409).json({ erro: 'Esse é o e-mail da coordenação — use o e-mail do aluno.' });
        return;
      }
      try {
        const existente = await authAdmin.getUserByEmail(emailLimpo);
        const { erro } = await contaDeAluno(db, authAdmin, existente.uid);
        if (erro) { res.status(409).json({ erro }); return; }
        uidDestino = existente.uid;
        if (senha) {
          if (senha.length < 6) {
            res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
            return;
          }
          senhaNovaDaConta = senha; // só troca depois de passar pela checagem de compartilhado
        }
      } catch (errBusca) {
        if (errBusca.code === 'auth/invalid-email') {
          res.status(400).json({ erro: 'Esse e-mail não parece válido.' });
          return;
        }
        if (errBusca.code !== 'auth/user-not-found') throw errBusca;
        if (senha.length < 6) {
          res.status(400).json({ erro: 'Conta nova: informe uma senha com pelo menos 6 caracteres.' });
          return;
        }
        try {
          const novo = await authAdmin.createUser({ email: emailLimpo, password: senha });
          uidDestino = novo.uid;
          contaCriada = true;
        } catch (errCriar) {
          if (errCriar.code === 'auth/invalid-email') {
            res.status(400).json({ erro: 'Esse e-mail não parece válido.' });
            return;
          }
          if (errCriar.code === 'auth/invalid-password') {
            res.status(400).json({ erro: 'Senha inválida — use pelo menos 6 caracteres.' });
            return;
          }
          throw errCriar;
        }
      }
    } else {
      res.status(400).json({ erro: 'Escolha uma conta existente ou informe e-mail e senha.' });
      return;
    }

    // Aulas que esse login JÁ tem (de outros alunos, talvez).
    const jaNoLogin = contaCriada
      ? []
      : (await db.collection('agendamentos').where('uid', '==', uidDestino).get()).docs
        .filter(d => !agendamentoIds.includes(d.id));
    juntarNomes(jaNoLogin.map(d => d.data()));
    const compartilhado = nomesPorChave.size > 1;
    if (compartilhado && !confirmarCompartilhado) { pedirConfirmacao(); return; }
    if (senhaNovaDaConta) await authAdmin.updateUser(uidDestino, { password: senhaNovaDaConta });

    // Presenças e avaliações dessas aulas (o portal também filtra essas pelo uid).
    const extras = [];
    for (const colecao of ['presencas', 'avaliacoes']) {
      for (const pedaco of emPedacos(agendamentoIds, 30)) {
        const snap = await db.collection(colecao).where('agendamentoId', 'in', pedaco).get();
        snap.docs.forEach(d => {
          if (d.data().uid !== uidDestino) extras.push({ ref: d.ref, colecao });
        });
      }
    }

    const operacoes = [
      ...snaps.filter(s => s.data().uid !== uidDestino || compartilhado).map(s => ({ ref: s.ref, colecao: 'agendamentos' })),
      ...extras
    ];
    const dadosDe = (op) => (op.colecao === 'agendamentos' && compartilhado
      ? { uid: uidDestino, compartilhamentoAprovado: true }
      : { uid: uidDestino });
    // Compartilhamento confirmado pelo admin: marca como aprovado também as aulas que o
    // login já tinha, pra o aviso não voltar.
    const aprovarExistentes = compartilhado
      ? jaNoLogin.filter(d => d.data().compartilhamentoAprovado !== true).map(d => ({ ref: d.ref, colecao: 'ja-no-login' }))
      : [];
    const todas = [...operacoes, ...aprovarExistentes];
    for (const pedaco of emPedacos(todas, 450)) {
      const lote = db.batch();
      pedaco.forEach(op => lote.update(op.ref, op.colecao === 'ja-no-login' ? { compartilhamentoAprovado: true } : dadosDe(op)));
      await lote.commit();
    }

    const contagem = (colecao) => operacoes.filter(op => op.colecao === colecao).length;
    res.status(200).json({
      uid: uidDestino,
      contaCriada,
      compartilhado,
      aulasCorrigidas: contagem('agendamentos'),
      presencasCorrigidas: contagem('presencas'),
      avaliacoesCorrigidas: contagem('avaliacoes')
    });
  } catch (err) {
    console.error('Erro ao unificar acesso do aluno:', err);
    res.status(500).json({ erro: 'Erro interno ao corrigir. Tente novamente em instantes.' });
  }
};
