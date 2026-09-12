// Função serverless da Vercel: POST /api/igrejas/criar-acesso
//
// Cria (ou redefine a senha de) o login do "Portal da Igreja" — chamada pela aba
// Igrejas quando você define um e-mail e uma senha pra uma igreja mantenedora.
//
// Isso precisa passar pelo Firebase Admin SDK (nunca pode ser feito direto no
// front-end) porque criar uma conta no Firebase Auth pelo navegador loga
// AUTOMATICAMENTE como essa conta nova — se fosse feito ali no App.jsx, você seria
// deslogado da sua conta de admin no meio do cadastro da igreja. Fazendo aqui no
// back-end, com a service account, sua sessão de admin no navegador nunca é tocada.
//
// Também grava um "custom claim" (igrejaPoloId) na conta da igreja — é o que a regra
// de segurança do Firestore usa pra deixar essa conta enxergar só os alunos do polo
// dela em "agendamentos", sem precisar reestruturar mais nada no banco. Sempre que
// você mudar o polo de uma igreja que já tem acesso criado, clique em "Redefinir
// senha / polo" de novo (mesmo sem trocar a senha) pra essa claim ser atualizada —
// veja o comentário sobre isso nas regras do Firestore (arquivo FIRESTORE_RULES.md).
const { getDb, getAuthAdmin } = require('../_firebaseAdmin');

const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'Método não permitido.' });
    return;
  }

  try {
    const { igrejaId, email, senha } = req.body || {};
    if (!igrejaId || !email || !senha) {
      res.status(400).json({ erro: 'igrejaId, email e senha são obrigatórios.' });
      return;
    }
    if (String(senha).length < 6) {
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
      res.status(403).json({ erro: 'Só a coordenação pode criar o acesso de uma igreja.' });
      return;
    }

    const db = getDb();
    const igrejaRef = db.collection('igrejas').doc(igrejaId);
    const snap = await igrejaRef.get();
    if (!snap.exists) {
      res.status(404).json({ erro: 'Igreja não encontrada.' });
      return;
    }
    const igreja = snap.data();

    let uid;
    try {
      const novoUsuario = await authAdmin.createUser({ email, password: senha });
      uid = novoUsuario.uid;
    } catch (errCriar) {
      if (errCriar.code === 'auth/email-already-exists') {
        const existente = await authAdmin.getUserByEmail(email);

        // Se esse e-mail já é o desta MESMA igreja, é só redefinição de senha —
        // segue direto. Se pertence a outra conta (admin, aluno ou outra igreja),
        // recusa: não queremos mexer numa conta que não é dessa igreja.
        if (existente.uid !== igreja.uid) {
          if (email === ADMIN_EMAIL) {
            res.status(409).json({ erro: 'Esse e-mail é o e-mail da coordenação (admin) — use outro e-mail pra essa igreja.' });
            return;
          }
          const [outraIgrejaSnap, alunoSnap] = await Promise.all([
            db.collection('igrejas').where('uid', '==', existente.uid).limit(1).get(),
            db.collection('agendamentos').where('uid', '==', existente.uid).limit(1).get()
          ]);
          const pertenceOutraIgreja = !outraIgrejaSnap.empty && outraIgrejaSnap.docs[0].id !== igrejaId;
          if (pertenceOutraIgreja || !alunoSnap.empty) {
            res.status(409).json({ erro: 'Esse e-mail já está em uso por outra conta (aluno ou outra igreja). Use um e-mail diferente pra essa igreja.' });
            return;
          }
        }

        uid = existente.uid;
        await authAdmin.updateUser(uid, { password: senha });
      } else if (errCriar.code === 'auth/invalid-password') {
        res.status(400).json({ erro: 'Senha inválida — use pelo menos 6 caracteres.' });
        return;
      } else if (errCriar.code === 'auth/invalid-email') {
        res.status(400).json({ erro: 'Esse e-mail não parece válido.' });
        return;
      } else {
        throw errCriar;
      }
    }

    // Guarda no token da conta qual polo ela representa — é isso que a regra do
    // Firestore vai usar pra liberar a leitura só dos alunos daquele polo.
    await authAdmin.setCustomUserClaims(uid, {
      igrejaId,
      igrejaPoloId: igreja.poloId || null
    });

    await igrejaRef.set({ uid, email }, { merge: true });

    res.status(200).json({ uid, email });
  } catch (err) {
    console.error('Erro ao criar acesso da igreja:', err);
    res.status(500).json({ erro: 'Erro interno ao criar o acesso. Tente novamente em instantes.' });
  }
};
