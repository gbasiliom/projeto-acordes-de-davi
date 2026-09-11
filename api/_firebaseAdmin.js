// Inicializa o Firebase Admin SDK uma única vez por instância de função serverless da
// Vercel. Esse SDK "admin" ignora as regras de segurança do Firestore (allow/deny do
// front-end) — por isso ele só pode viver aqui, no back-end, nunca no App.jsx.
//
// Precisa da variável de ambiente FIREBASE_SERVICE_ACCOUNT configurada no painel da
// Vercel (Project Settings > Environment Variables), colando o CONTEÚDO INTEIRO do
// arquivo JSON da service account (gerado no Firebase Console > Configurações do
// Projeto > Contas de Serviço > Gerar nova chave privada), como uma única variável de
// texto. Veja o passo a passo completo em PAGAMENTO_PIX_SETUP.md.
const admin = require('firebase-admin');

function getAdminApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const bruto = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!bruto) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT não está configurada nas variáveis de ambiente da Vercel.'
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(bruto);
  } catch (err) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT não é um JSON válido — cole o conteúdo do arquivo da service account inteiro, sem alterar nada.'
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

function getDb() {
  getAdminApp();
  return admin.firestore();
}

function getAuthAdmin() {
  getAdminApp();
  return admin.auth();
}

module.exports = { getDb, getAuthAdmin };
