// Script de RESTAURAÇÃO do backup — rodado à mão, no seu computador, NUNCA como uma
// função da Vercel. De propósito: um endpoint na internet capaz de sobrescrever o
// banco de dados inteiro é um risco grande demais (qualquer chave roubada, qualquer
// bug de autorização, e alguém apaga/sobrescreve tudo remotamente). Rodando só local,
// isso exige que a pessoa tenha o arquivo de backup E a chave da service account em
// mãos, no próprio computador.
//
// O QUE ESSE SCRIPT FAZ (e o que ele NÃO faz):
//   - Para cada documento de cada coleção do arquivo de backup, grava esse documento
//     no Firestore com os MESMOS dados de quando o backup foi gerado (sobrescreve só
//     esse documento, não a coleção inteira).
//   - NUNCA apaga um documento que exista hoje no Firestore mas não esteja no backup
//     — só avisa quais são esses (`extraNoFirestore`), pra você decidir manualmente se
//     quer apagar ou não. Restaurar é pra recuperar o que se perdeu, não pra "resetar"
//     o banco pro estado exato de um dia atrás.
//   - NÃO restaura contas de login do Firebase Authentication (e-mail/senha de aluno
//     ou igreja) — isso é um sistema separado do Firestore, o Admin SDK usado aqui só
//     lida com Firestore. Se o PROJETO FIREBASE INTEIRO for excluído (não só os dados),
//     as contas de login também se perdem e precisam ser recriadas à parte.
//   - Por segurança, roda em modo SIMULAÇÃO por padrão (não grava nada, só mostra o
//     que faria) — só grava de verdade com a flag --confirmar.
//
// COMO USAR:
//   1. Baixe o anexo do e-mail de backup (ex: backup-acordes-de-davi-2026-09-30.json)
//      pra uma pasta no seu computador.
//   2. Baixe a chave da service account (Firebase Console > Configurações do Projeto >
//      Contas de Serviço > Gerar nova chave privada) e salve como service-account.json
//      NA MESMA PASTA deste script (nunca suba esse arquivo pro GitHub).
//   3. No terminal, dentro da pasta do projeto:
//        node scripts/restaurar-backup.js caminho/para/backup-acordes-de-davi-2026-09-30.json
//      Isso só SIMULA e mostra um resumo (quantos documentos seriam restaurados por
//      coleção, e quais documentos existem hoje mas não estão no backup).
//   4. Se o resumo estiver do jeito esperado, rode de novo com --confirmar pra gravar:
//        node scripts/restaurar-backup.js caminho/para/backup.json --confirmar
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const CAMINHO_SERVICE_ACCOUNT = path.join(__dirname, 'service-account.json');
const LIMITE_LOTE_FIRESTORE = 450; // margem de segurança (o limite real do Firestore é 500 operações por lote)

function inicializarAdmin() {
  if (!fs.existsSync(CAMINHO_SERVICE_ACCOUNT)) {
    console.error(`\nNão encontrei "scripts/service-account.json".\nBaixe a chave da service account no Firebase Console (Configurações do Projeto > Contas de Serviço > Gerar nova chave privada) e salve com esse nome exato, nessa pasta.\n`);
    process.exit(1);
  }
  const serviceAccount = JSON.parse(fs.readFileSync(CAMINHO_SERVICE_ACCOUNT, 'utf-8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.firestore();
}

async function restaurarColecao(db, nomeColecao, documentos, confirmar) {
  if (!Array.isArray(documentos)) {
    console.log(`  [${nomeColecao}] pulada — essa coleção falhou na hora de gerar o backup (veja o e-mail original).`);
    return { restaurados: 0, extraNoFirestore: [] };
  }

  const idsNoBackup = new Set(documentos.map((d) => d.id));
  const snapAtual = await db.collection(nomeColecao).get();
  const extraNoFirestore = snapAtual.docs.map((d) => d.id).filter((id) => !idsNoBackup.has(id));

  if (!confirmar) {
    console.log(`  [${nomeColecao}] SIMULAÇÃO — restauraria ${documentos.length} documento(s). ${extraNoFirestore.length} documento(s) existem hoje e não estão no backup (não seriam apagados).`);
    return { restaurados: documentos.length, extraNoFirestore };
  }

  for (let inicio = 0; inicio < documentos.length; inicio += LIMITE_LOTE_FIRESTORE) {
    const pedaco = documentos.slice(inicio, inicio + LIMITE_LOTE_FIRESTORE);
    const lote = db.batch();
    pedaco.forEach((documento) => {
      const { id, ...dadosSemId } = documento;
      lote.set(db.collection(nomeColecao).doc(id), dadosSemId);
    });
    await lote.commit();
  }
  console.log(`  [${nomeColecao}] restaurado — ${documentos.length} documento(s) gravado(s). ${extraNoFirestore.length} documento(s) existiam e não foram tocados (não estavam no backup).`);
  return { restaurados: documentos.length, extraNoFirestore };
}

async function main() {
  const argumentos = process.argv.slice(2);
  const confirmar = argumentos.includes('--confirmar');
  const caminhoBackup = argumentos.find((a) => !a.startsWith('--'));

  if (!caminhoBackup) {
    console.error('\nUso: node scripts/restaurar-backup.js caminho/para/backup.json [--confirmar]\n');
    process.exit(1);
  }

  const pacote = JSON.parse(fs.readFileSync(caminhoBackup, 'utf-8'));
  console.log(`\nBackup gerado em: ${pacote.geradoEm}`);
  console.log(confirmar ? 'MODO: gravando de verdade no Firestore.\n' : 'MODO: SIMULAÇÃO — nada será gravado. Rode de novo com --confirmar pra gravar de verdade.\n');

  const db = inicializarAdmin();
  const relatorioExtras = {};

  for (const [nomeColecao, documentos] of Object.entries(pacote.colecoes || {})) {
    const resultado = await restaurarColecao(db, nomeColecao, documentos, confirmar);
    if (resultado.extraNoFirestore.length > 0) {
      relatorioExtras[nomeColecao] = resultado.extraNoFirestore;
    }
  }

  if (Object.keys(relatorioExtras).length > 0) {
    console.log('\nDocumentos que existem HOJE no Firestore e não estavam nesse backup (não foram apagados — decida manualmente):');
    console.log(JSON.stringify(relatorioExtras, null, 2));
  }

  console.log(confirmar ? '\nRestauração concluída.\n' : '\nSimulação concluída — rode com --confirmar pra gravar de verdade.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nErro ao restaurar o backup:', err);
  process.exit(1);
});
