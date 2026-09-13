// Função serverless da Vercel: POST /api/alunos/editar-acesso
//
// Corrige o e-mail de LOGIN (e, se quiser, redefine a senha) de um aluno já cadastrado —
// chamada pela aba Gestão, ao editar o cadastro de alguém. O nome, telefone, polo e
// instrumento continuam sendo salvos direto no Firestore, pelo próprio App.jsx; só o
// e-mail/senha de login (que fica no Firebase Auth, não no Firestore) precisa passar por
// aqui, pelos mesmos dois motivos de sempre: mudar o e-mail/senha de OUTRA conta não é
// algo que o SDK do navegador permite fazer estando logado como admin, e criar/alterar
// contas direto no front-end loga automaticamente como essa conta nova — o que derrubaria
// a SUA sessão de admin no meio da correção. Feito aqui, com a service account, sua
// sessão nunca é tocada.
const { getDb, getAuthAdmin } = require('../_firebaseAdmin');

const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  try {
    const { agendamentoId, novoEmail, novaSenha } = req.body || {};
    if (!agendamentoId) {
      res.status(400).json({ erro: 'agendamentoId é obrigatório.' });
      return;
    }
    const emailLimpo = (novoEmail || '').trim();
    const senhaLimpa = novaSenha || '';
    if (!emailLimpo && !senhaLimpa) {
      res.status(400).json({ erro: 'Informe um novo e-mail e/ou uma nova senha.' });
      return;
    }
    if (senhaLimpa && senhaLimpa.length < 6) {
      res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
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
      res.status(403).json({ erro: 'Só a coordenação pode corrigir o acesso de um aluno.' });
      return;
    }

    const db = getDb();
    const agendamentoRef = db.collection('agendamentos').doc(agendamentoId);
    const snap = await agendamentoRef.get();
    if (!snap.exists) {
      res.status(404).json({ erro: 'Aluno não encontrado.' });
      return;
    }
    const agendamento = snap.data();
    if (!agendamento.uid) {
      res.status(400).json({ erro: 'Esse cadastro ainda não tem uma conta de login vinculada.' });
      return;
    }

    if (emailLimpo) {
      if (emailLimpo === ADMIN_EMAIL) {
        res.status(409).json({ erro: 'Esse e-mail é o e-mail da coordenação (admin) — use outro e-mail pra esse aluno.' });
        return;
      }
      // Não deixa colidir com o login de outro aluno ou de uma igreja já cadastrada.
      try {
        const existente = await authAdmin.getUserByEmail(emailLimpo);
        if (existente.uid !== agendamento.uid) {
          res.status(409).json({ erro: 'Esse e-mail já está em uso por outra conta. Use um e-mail diferente.' });
          return;
        }
      } catch (errBusca) {
        if (errBusca.code !== 'auth/user-not-found') throw errBusca;
      }
    }

    const atualizacoes = {};
    if (emailLimpo) atualizacoes.email = emailLimpo;
    if (senhaLimpa) atualizacoes.password = senhaLimpa;

    try {
      await authAdmin.updateUser(agendamento.uid, atualizacoes);
    } catch (errAtualizar) {
      if (errAtualizar.code === 'auth/invalid-email') {
        res.status(400).json({ erro: 'Esse e-mail não parece válido.' });
        return;
      }
      if (errAtualizar.code === 'auth/invalid-password') {
        res.status(400).json({ erro: 'Senha inválida — use pelo menos 6 caracteres.' });
        return;
      }
      throw errAtualizar;
    }

    res.status(200).json({ uid: agendamento.uid, email: emailLimpo || null });
  } catch (err) {
    console.error('Erro ao editar acesso do aluno:', err);
    res.status(500).json({ erro: 'Erro interno ao salvar. Tente novamente em instantes.' });
  }
};
