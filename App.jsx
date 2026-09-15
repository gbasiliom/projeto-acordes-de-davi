import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BookOpen, Calendar, Clock, Music, Guitar, User, LogIn, LogOut, CheckCircle, AlertTriangle, Users, MapPin, Trash2, Settings, PlusCircle, Upload, FileText, CheckSquare, Square, DollarSign, Award, Printer, Download, KeyRound, Pencil, ClipboardList, TrendingUp } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserSessionPersistence } from 'firebase/auth';
import { getFirestore, collection, query, where, onSnapshot, addDoc, deleteDoc, doc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';

// E-mail que tem acesso de administrador. Todo outro login vira "aluno".
const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

// Polos padrão — usados só como "semente" pra popular a coleção "polos" do Firestore
// na primeira vez (botão "Restaurar polos padrão" na aba Horários). A partir daí, quem
// manda na lista de polos é o admin, pela tela — não mais o código (igual já funciona
// pra grade de turmas/horários).
const POLOS_PADRAO = [
  { id: 'saoluiz', nome: 'São Luiz', descricao: 'Aulas quinzenais — Violão às sextas, Bateria aos sábados.' },
  { id: 'matafria', nome: 'Mata Fria / Penha do Côco', descricao: 'Bateria pela manhã e Violão à tarde, conforme a agenda de São Luiz.' },
  { id: 'chale', nome: 'Chalé', descricao: 'Aulas de Violão aos domingos (quinzenal).' },
  // Igreja Tabernáculo, na localidade de Penha do Côco — um polo totalmente separado
  // de "Mata Fria / Penha do Côco" (não tem nada a ver com ele, mesmo os nomes
  // parecendo iguais; "Pé do Coco" era escrita errada, o nome certo é "Penha do Côco").
  { id: 'penhadococo', nome: 'Igreja Tabernáculo (Penha do Côco)', descricao: 'Igreja Tabernáculo — pacote fechado mensal.' },
  // Vem do "Planejamento Financeiro das Aulas de Música por Polo" (Google Docs).
  { id: 'agualimpa', nome: 'Água Limpa', descricao: 'Igreja Assembleia de Deus — pacote fechado mensal.' }
];

// Reduz um texto a só letras/números minúsculos, sem espaço/acento/pontuação
// (ex: "Wemersom Daniel Braun " -> "wemersomdanielbraun") — usada tanto pra gerar o id
// de um polo novo (mesmo estilo dos ids já usados: saoluiz, matafria, chale) quanto pra
// comparar nome/telefone na hora de detectar cadastros duplicados.
const normalizarTexto = (texto) => (texto || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const slugificarPolo = normalizarTexto;

// --- Geração do calendário de aulas por turma (aba Pauta) ---
// O campo "dia" de uma turma é texto livre (ex: "Sábado (Quinzenal - Semana B)"),
// então em vez de guardar um campo estruturado novo, a gente interpreta esse texto
// (já normalizado, sem acento/espaço) pra descobrir o dia da semana e a cadência.
const DIAS_SEMANA_CHAVES = [
  { chave: 'domingo', indice: 0 },
  { chave: 'segunda', indice: 1 },
  { chave: 'terca', indice: 2 },
  { chave: 'quarta', indice: 3 },
  { chave: 'quinta', indice: 4 },
  { chave: 'sexta', indice: 5 },
  { chave: 'sabado', indice: 6 }
];

// Lê o texto livre de "dia" de uma turma e descobre: o dia da semana (0=domingo
// ... 6=sábado), se é quinzenal, e se é a "Semana A" ou "Semana B" de um par
// quinzenal alternado (usado em Mata Fria). Retorna null se não reconhecer o dia.
const interpretarDiaTurma = (diaTexto) => {
  const normalizado = normalizarTexto(diaTexto);
  const encontrado = DIAS_SEMANA_CHAVES.find(d => normalizado.includes(d.chave));
  if (!encontrado) return null;
  return {
    diaSemana: encontrado.indice,
    quinzenal: normalizado.includes('quinzenal'),
    semanaB: normalizado.includes('semanab')
  };
};

// Converte um "yyyy-mm-dd" em Date à meia-noite NO HORÁRIO LOCAL (evita o problema
// clássico de "new Date('2026-09-17')" cair um dia antes por causa de UTC).
const paraDataLocal = (isoTexto) => {
  if (!isoTexto) return null;
  const partes = isoTexto.split('-').map(Number);
  const [ano, mes, dia] = partes;
  if (!ano || !mes || !dia) return null;
  return new Date(ano, mes - 1, dia);
};

const paraISO = (data) => {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
};

// Soma "meses" a uma data (usado só pra calcular o limite de 5 meses do calendário).
const somarMeses = (data, meses) => new Date(data.getFullYear(), data.getMonth() + meses, data.getDate());

// Gera a lista de datas (yyyy-mm-dd) em que uma turma tem aula, a partir da data de
// início das aulas do polo (campo "dataInicioAulas", definido na aba Horários),
// respeitando dia da semana / quinzenal / Semana A-B, e limitada a no máximo 5
// meses de calendário — pedido explícito do admin, pra não gerar datas pra sempre.
const gerarDatasDaTurma = (turma, dataInicioIso) => {
  const inicio = paraDataLocal(dataInicioIso);
  if (!inicio) return [];
  const interpretado = interpretarDiaTurma(turma?.dia);
  if (!interpretado) return [];

  const limite = somarMeses(inicio, 5);

  // Primeiro dia (a partir do início) que cai no dia da semana certo.
  const primeiraOcorrencia = new Date(inicio);
  while (primeiraOcorrencia.getDay() !== interpretado.diaSemana) {
    primeiraOcorrencia.setDate(primeiraOcorrencia.getDate() + 1);
  }

  let passoDias = 7;
  let primeira = primeiraOcorrencia;
  if (interpretado.quinzenal) {
    passoDias = 14;
    if (interpretado.semanaB) {
      primeira = new Date(primeiraOcorrencia);
      primeira.setDate(primeira.getDate() + 7);
    }
  }

  const datas = [];
  const atual = new Date(primeira);
  while (atual <= limite) {
    datas.push(paraISO(atual));
    atual.setDate(atual.getDate() + passoDias);
  }
  return datas;
};

// --- Cálculo automático de vencimento pro relatório Financeiro (aba "Financeiro") ---
// Não existe campo de "data de vencimento" pra digitar — o vencimento é sempre
// CALCULADO a partir da grade, com duas cadências diferentes combinadas com você:
//   • Pacote (igreja/polo): vence a cada 14 dias (quinzena) contados da "Data de início
//     das aulas" do polo, sem depender do dia da semana de nenhuma turma específica.
//   • Individual: vence a cada 5 aulas que realmente estão na grade daquele aluno
//     (reaproveita o gerarDatasDaTurma acima, que já sabe ler "Terça-feira",
//     "Sexta (Quinzenal)" etc.).
// Nos dois casos, a regra de status é a mesma: ainda não chegou a data -> "Pendente"
// (pagamento previsto); a data já chegou/passou e ainda não foi marcado como pago ->
// "Atrasado". Uma conta com "pago" marcado sempre aparece como "Em dia" — marcar como
// pago não fecha e reabre um novo ciclo sozinho a cada quinzena/5 aulas (isso exigiria
// guardar um histórico de pagamentos, que não existe hoje).

// Vencimento periódico simples (usado pro pacote/igreja): a cada "passoDias" dias,
// contados de dataInicioIso. Devolve null se o polo ainda não tem data de início
// definida (não dá pra calcular nada sem isso).
// offsetDias desloca a data-âncora antes de calcular os ciclos — usado pelas parcelas
// (ver PARCELAS_POR_POLO): cada parcela recorre a cada 28 dias (mensal), mas a parcela 2
// começa 14 dias depois da parcela 1, então na prática cai uma cobrança a cada quinzena.
const calcularVencimentoPeriodico = (dataInicioIso, passoDias, offsetDias = 0) => {
  const inicioBase = paraDataLocal(dataInicioIso);
  if (!inicioBase) return null;
  const inicio = new Date(inicioBase);
  if (offsetDias) inicio.setDate(inicio.getDate() + offsetDias);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diasDesdeInicio = Math.floor((hoje - inicio) / 86400000);

  if (diasDesdeInicio < passoDias) {
    // Ainda não fechou nem o primeiro ciclo — o vencimento mostrado é o primeiro,
    // ainda no futuro (por isso sempre cai em "Pendente").
    const primeiroVencimento = new Date(inicio);
    primeiroVencimento.setDate(primeiroVencimento.getDate() + passoDias);
    return { vencimento: paraISO(primeiroVencimento), passadoAlgum: false };
  }

  const ciclosFechados = Math.floor(diasDesdeInicio / passoDias);
  const vencimentoAtual = new Date(inicio);
  vencimentoAtual.setDate(vencimentoAtual.getDate() + ciclosFechados * passoDias);
  return { vencimento: paraISO(vencimentoAtual), passadoAlgum: true };
};

// Vencimento por quantidade de aulas (usado pro individual): a cada "cadaQuantasAulas"
// datas reais da turma daquele aluno (gerarDatasDaTurma já limita a 5 meses de
// calendário). Devolve null se não for possível calcular ainda — turma com "dia" não
// reconhecido, polo sem data de início, ou grade curta demais pra alcançar nem o
// primeiro ciclo dentro desses 5 meses.
const calcularVencimentoPorAulas = (turmaFake, dataInicioIso, cadaQuantasAulas) => {
  const datas = gerarDatasDaTurma(turmaFake, dataInicioIso);
  if (datas.length < cadaQuantasAulas) return null;

  const hojeIso = paraISO(new Date());
  const aulasAteHoje = datas.filter(d => d <= hojeIso).length;

  if (aulasAteHoje < cadaQuantasAulas) {
    return { vencimento: datas[cadaQuantasAulas - 1], passadoAlgum: false };
  }

  const ciclosFechados = Math.floor(aulasAteHoje / cadaQuantasAulas);
  const indiceVencimento = ciclosFechados * cadaQuantasAulas - 1;
  return { vencimento: datas[indiceVencimento], passadoAlgum: true };
};

// yyyy-mm-dd -> dd/mm/yyyy (mais os dois pontos do dia da semana), pra exibir no
// seletor de data da Pauta.
const formatarDataCalendario = (isoTexto) => {
  const data = paraDataLocal(isoTexto);
  if (!data) return isoTexto;
  const diasSemanaNomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  return `${diasSemanaNomes[data.getDay()]}, ${data.toLocaleDateString('pt-BR')}`;
};

const INSTRUMENTOS = [
  { id: 'violao', nome: 'Turma de Violão', Icone: Guitar },
  { id: 'bateria', nome: 'Turma de Bateria', Icone: Music },
  { id: 'banda', nome: 'Turma de Banda', Icone: Users }
];

// Funções possíveis de um integrante da Turma de Banda (aba "Banda", admin) — lista
// fixa, editável aqui no código se precisar mudar. Guardada direto no documento do
// POLO (não no cadastro do aluno) porque "polos" é de leitura pública no Firestore —
// assim a lista aparece tanto no Portal do Aluno quanto no Portal da Igreja sem
// precisar de nenhuma regra de segurança nova.
const FUNCOES_BANDA = ['Vocal', 'Guitarra', 'Baixo', 'Bateria', 'Teclado', 'Backing Vocal', 'Outro'];

// Nome "curto" de um instrumento (sem o "Turma de" na frente) a partir do id salvo no
// cadastro/turma — usado em telas que só precisam mostrar "Violão"/"Bateria"/"Banda",
// e sempre olhando a lista INSTRUMENTOS (nunca um if/else fixo), pra funcionar sozinho
// se um instrumento novo for adicionado no futuro.
const nomeInstrumento = (id) => INSTRUMENTOS.find(i => i.id === id)?.nome.replace('Turma de ', '') || id || '';

// Valores fixos usados como SUGESTÃO automática ao gerar um recibo (ou no botão "usar
// sugestão" da aba Pagamentos) — o campo de valor sempre fica editável, então isso nunca
// trava um caso fora da regra. Cada polo tem os DOIS valores disponíveis (pacote fechado
// E valor por aula individual), porque alunos de um polo que hoje paga em pacote podem
// passar a pagar individualmente (e vice-versa) — o "Tipo" de cada aluno, na aba
// Pagamentos, decide qual dos dois valores é sugerido.
// Fonte: "Planejamento Financeiro das Aulas de Música por Polo" (Google Docs).

// Pacote fechado mensal por polo (chave = id do polo) — hoje só Água Limpa e Penha do
// Côco (Igreja Tabernáculo) têm esse modelo confirmado no planejamento; os outros (São
// Luís, Chalé) ficam com uma estimativa antiga só pra caso algum aluno deles vire pacote.
const VALOR_PACOTE_POR_POLO = {
  agualimpa: 400,     // Água Limpa (Igreja Assembleia de Deus) — pago em 2x, ver PARCELAS_POR_POLO
  penhadococo: 350,   // Penha do Côco (Igreja Tabernáculo) — integral
  saoluiz: 600,
  chale: 500
};
// Polo pacote que não está no mapa acima (ex: um polo novo criado pela tela) cai aqui.
const VALOR_PACOTE_PADRAO_OUTROS = 300;

// Em quantas parcelas o pacote de cada polo é pago — hoje só Água Limpa (2x, uma a cada
// quinzena; ver calcularVencimentoPeriodico e o relatório Financeiro). Todo polo que não
// está aqui é "integral" (1 parcela só), do jeito que já funcionava antes.
const PARCELAS_POR_POLO = {
  agualimpa: 2
};
const numParcelasDoPolo = (poloId) => PARCELAS_POR_POLO[poloId] || 1;

// Valor por aula, pra quando o aluno paga individualmente (fora do pacote da igreja).
// São Luís, Chalé e Mata Fria vêm direto do planejamento (tabela confirmada em 15/09).
const VALOR_AULA_POR_POLO = {
  saoluiz: 50,  // R$30 aula-base + R$20 deslocamento/alimentação (36km cada trecho)
  chale: 40,
  matafria: 30  // sem custo de deslocamento — professor mora na comunidade
};
// Polo individual que não está no mapa acima (ex: Água Limpa/Penha do Côco, que hoje só
// têm valor de pacote definido — ou um polo novo criado pela tela) cai aqui.
const VALOR_AULA_INDIVIDUAL_PADRAO = 25;

// Sugere o valor do recibo: individual = valor da aula (por polo) x quantidade de aulas;
// pacote = valor fechado do polo (com fallback pro valor padrão de outros polos).
const valorSugeridoRecibo = (item, polo, quantidadeAulas = 1) => {
  if (item?.tipoPagamento === 'individual') {
    const valorAula = (polo && VALOR_AULA_POR_POLO[polo.id] != null) ? VALOR_AULA_POR_POLO[polo.id] : VALOR_AULA_INDIVIDUAL_PADRAO;
    return valorAula * quantidadeAulas;
  }
  if (polo && VALOR_PACOTE_POR_POLO[polo.id] != null) {
    return VALOR_PACOTE_POR_POLO[polo.id];
  }
  return VALOR_PACOTE_PADRAO_OUTROS;
};

const formatarBRL = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// --- Horários por polo ---
const HORARIOS_SAO_LUIZ = [
  { label: '08:00 - 08:40', value: '08:00' }, { label: '08:40 - 09:20', value: '08:40' },
  { label: '09:20 - 10:00', value: '09:20' }, { label: '10:00 - 10:40', value: '10:00' },
  { label: '10:40 - 11:20', value: '10:40' }, { label: '11:20 - 12:00', value: '11:20' },
  { label: '12:00 - 12:40', value: '12:00' }, { label: '12:40 - 13:20', value: '12:40' }
];
const HORARIOS_MATAFRIA_QUARTA = [
  { label: '07:00 - 07:40', value: '07:00' }, { label: '07:40 - 08:20', value: '07:40' },
  { label: '08:20 - 09:00', value: '08:20' }, { label: '09:00 - 09:40', value: '09:00' },
  { label: '09:40 - 10:20', value: '09:40' }, { label: '10:20 - 11:00', value: '10:20' },
  { label: '11:00 - 11:40', value: '11:00' }
];
const HORARIOS_MATAFRIA_SABADO_MANHA = [
  { label: '08:00 - 08:40', value: '08:00' }, { label: '08:40 - 09:20', value: '08:40' },
  { label: '09:20 - 10:00', value: '09:20' }, { label: '10:00 - 10:40', value: '10:00' },
  { label: '10:40 - 11:20', value: '10:40' }, { label: '11:20 - 12:00', value: '11:20' }
];
const HORARIOS_MATAFRIA_SABADO_TARDE_A = [
  { label: '14:00 - 14:40', value: '14:00' }, { label: '14:40 - 15:20', value: '14:40' },
  { label: '15:20 - 16:00', value: '15:20' }, { label: '16:00 - 16:40', value: '16:00' }
];
const HORARIOS_MATAFRIA_SABADO_TARDE_B = [
  { label: '13:00 - 13:40', value: '13:00' }, { label: '13:40 - 14:20', value: '13:40' },
  { label: '14:20 - 15:00', value: '14:20' }, { label: '15:00 - 15:40', value: '15:00' },
  { label: '15:40 - 16:20', value: '15:40' }, { label: '16:20 - 17:00', value: '16:20' }
];
const HORARIOS_CHALE = [
  { label: '11:00 - 11:40', value: '11:00' }, { label: '11:40 - 12:20', value: '11:40' },
  { label: '12:55 - 13:35', value: '12:55' }, { label: '13:35 - 14:15', value: '13:35' },
  { label: '14:15 - 14:55', value: '14:15' }
];

// Grade padrão inicial — usada só como "semente" pra popular a coleção "turmas" do
// Firestore na primeira vez (botão "Restaurar grade padrão" na aba Horários). A partir
// daí, quem manda na grade de horários é o admin, pela tela — não mais o código.
const GRADE_PADRAO = [
  { local: 'saoluiz', instrumento: 'violao', dia: 'Sexta (Quinzenal)', horarios: HORARIOS_SAO_LUIZ },
  { local: 'saoluiz', instrumento: 'bateria', dia: 'Sábado (Quinzenal - Semana A)', horarios: HORARIOS_SAO_LUIZ },
  { local: 'matafria', instrumento: 'bateria', dia: 'Quarta-feira', horarios: HORARIOS_MATAFRIA_QUARTA },
  { local: 'matafria', instrumento: 'bateria', dia: 'Sábado (Quinzenal - Semana B)', horarios: HORARIOS_MATAFRIA_SABADO_MANHA },
  { local: 'matafria', instrumento: 'violao', dia: 'Sábado (Tarde - Semana A)', horarios: HORARIOS_MATAFRIA_SABADO_TARDE_A },
  { local: 'matafria', instrumento: 'violao', dia: 'Sábado (Tarde - Semana B)', horarios: HORARIOS_MATAFRIA_SABADO_TARDE_B },
  { local: 'chale', instrumento: 'violao', dia: 'Domingo (Quinzenal)', horarios: HORARIOS_CHALE }
];

const firebaseConfig = {
  apiKey: "AIzaSyDmT6qtTaCYAmYpCiZWQMPavmGE9wSmqlo",
  authDomain: "acordes-de-davi.firebaseapp.com",
  projectId: "acordes-de-davi",
  storageBucket: "acordes-de-davi.firebasestorage.app",
  messagingSenderId: "226243463669",
  appId: "1:226243463669:web:6a9ac7d10dd5f25f48f8bc",
  measurementId: "G-2XMXYQGRT7"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Login "por sessão", em vez de guardado pra sempre no dispositivo — fecha sozinho
// quando o aplicativo é encerrado. Assim, seja o login do admin, do Portal do Aluno ou
// do Portal da Igreja, fechando o app a próxima abertura pede login de novo, em vez de
// continuar entrando direto na conta de quem usou por último (importante porque várias
// pessoas diferentes podem abrir esse mesmo app/computador).
setPersistence(auth, browserSessionPersistence).catch((err) => {
  console.error('Erro ao configurar a persistência do login:', err);
});

export default function App() {
  const [agendamentos, setAgendamentos] = useState([]);
  const [vagasOcupadas, setVagasOcupadas] = useState([]);
  const [turmasCadastradas, setTurmasCadastradas] = useState([]);
  const [polosCadastrados, setPolosCadastrados] = useState([]);

  // Formulário de "novo integrante" da aba Banda — um rascunho por polo (nome +
  // função), só some/reseta depois de clicar em "Adicionar".
  const [formNovoIntegranteBanda, setFormNovoIntegranteBanda] = useState({});

  // Vinheta de abertura (logo animado) — aparece por cima de tudo, toda vez que o
  // site é aberto (recarregar a página conta como "abrir de novo"), antes de
  // qualquer tela (login, cadastro, portal).
  const [mostrarVinheta, setMostrarVinheta] = useState(true);
  const [somVinhetaAtivado, setSomVinhetaAtivado] = useState(false);
  const videoVinhetaRef = useRef(null);

  // Tenta tocar COM som direto, sem esperar clique — funciona sozinho em boa parte
  // dos navegadores/situações (o Chrome, por exemplo, libera autoplay com som pra
  // quem já assistiu vídeo com som nesse site antes). Isso NÃO é algo que o código
  // decide: é uma política de segurança do próprio navegador contra vídeo/anúncio
  // abrindo com som sem a pessoa pedir — o que der pra fazer daqui é tentar primeiro
  // com som e, só se o navegador recusar (a Promise de video.play() é rejeitada),
  // cair pro mudo automaticamente com o botão "Ativar som" à mostra (e um toque em
  // qualquer parte do vídeo também ativa o som, já que um clique da pessoa sempre é
  // permitido).
  useEffect(() => {
    if (!mostrarVinheta) return;
    const video = videoVinhetaRef.current;
    if (!video) return;
    video.muted = false;
    const tentativa = video.play();
    if (tentativa && typeof tentativa.then === 'function') {
      tentativa
        .then(() => setSomVinhetaAtivado(true))
        .catch(() => {
          video.muted = true;
          setSomVinhetaAtivado(false);
          video.play().catch(() => {});
        });
    }
  }, [mostrarVinheta]);

  // --- Gestão de horários (admin) ---
  const [novaTurma, setNovaTurma] = useState({ local: 'saoluiz', instrumento: 'violao', dia: '', inicio: '', fim: '', duracao: 40 });
  const [erroTurma, setErroTurma] = useState('');
  const [salvandoTurma, setSalvandoTurma] = useState(false);

  // --- Gestão de polos (admin) ---
  const [novoPolo, setNovoPolo] = useState({ nome: '', descricao: '', dataInicioAulas: '' });
  const [erroPolo, setErroPolo] = useState('');
  const [salvandoPolo, setSalvandoPolo] = useState(false);
  const [editandoPolo, setEditandoPolo] = useState(null);
  const [editandoAluno, setEditandoAluno] = useState(null);
  const [erroEdicaoAluno, setErroEdicaoAluno] = useState('');
  const [salvandoEdicaoAluno, setSalvandoEdicaoAluno] = useState(false);

  // --- Cadastro de Igrejas (mantenedoras que pagam o pacote de um polo) ---
  // Área nova, adicionada por cima do que já existia — não muda em nada o
  // funcionamento por aluno (aba Pagamentos / Portal do Aluno continuam iguais).
  const [igrejasCadastradas, setIgrejasCadastradas] = useState([]);

  // Presença por data (aba Pauta), avaliações de desempenho (nota livre por data,
  // dentro do cadastro do aluno) e materiais/vídeos de estudo (aba Materiais) —
  // as três coleções novas do Firestore pedidas junto com o Portal do Aluno.
  const [presencasCadastradas, setPresencasCadastradas] = useState([]);
  const [avaliacoesCadastradas, setAvaliacoesCadastradas] = useState([]);
  const [materiaisCadastrados, setMateriaisCadastrados] = useState([]);
  const [datasSelecionadasPauta, setDatasSelecionadasPauta] = useState({});
  const [novoMaterial, setNovoMaterial] = useState({ titulo: '', tipo: 'PDF', instrumento: 'todos', link: '' });
  const [erroMaterial, setErroMaterial] = useState('');
  const [salvandoMaterial, setSalvandoMaterial] = useState(false);
  const [novaAvaliacao, setNovaAvaliacao] = useState({ data: '', texto: '' });
  const [salvandoAvaliacao, setSalvandoAvaliacao] = useState(false);

  // --- Cadastro do proprietário/emissor (aba Configurações) — nome, CPF e endereço
  // que passam a aparecer no recibo de pagamento, pra você poder usar o recibo pra
  // controle fiscal. Fica salvo num único documento no Firestore
  // (configuracoes/proprietario) e é editável só por você, na aba Configurações.
  const [dadosProprietario, setDadosProprietario] = useState({ nome: '', cpf: '', endereco: '' });
  const [formProprietario, setFormProprietario] = useState({ nome: '', cpf: '', endereco: '' });
  const [salvandoProprietario, setSalvandoProprietario] = useState(false);
  const [mensagemProprietario, setMensagemProprietario] = useState('');
  const [novaIgreja, setNovaIgreja] = useState({ nome: '', poloId: '', responsavel: '', telefone: '' });
  const [erroIgreja, setErroIgreja] = useState('');
  const [salvandoIgreja, setSalvandoIgreja] = useState(false);
  const [editandoIgreja, setEditandoIgreja] = useState(null);

  // --- Acesso da igreja ao Portal da Igreja (criado pelo admin, aba Igrejas) ---
  const [acessoIgrejaAberto, setAcessoIgrejaAberto] = useState(null);
  const [formAcessoIgreja, setFormAcessoIgreja] = useState({ email: '', senha: '' });
  const [erroAcessoIgreja, setErroAcessoIgreja] = useState('');
  const [salvandoAcessoIgreja, setSalvandoAcessoIgreja] = useState(false);

  const [loading, setLoading] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState('painel');
  const [usuario, setUsuario] = useState(null);

  const [emailAdmin, setEmailAdmin] = useState('');
  const [senhaAdmin, setSenhaAdmin] = useState('');
  const [erroLogin, setErroLogin] = useState('');

  const [filtroLocal, setFiltroLocal] = useState('todos');
  const [filtroInstrumento, setFiltroInstrumento] = useState('todos');
  const [filtroLocalPagamentos, setFiltroLocalPagamentos] = useState('todos');

  const [alunoCertificado, setAlunoCertificado] = useState('');
  const [instrumentoCertificado, setInstrumentoCertificado] = useState('Violão');
  const [emitirCertificado, setEmitirCertificado] = useState(false);

  const [itemRecibo, setItemRecibo] = useState(null);
  const [quantidadeAulasRecibo, setQuantidadeAulasRecibo] = useState(1);
  const [valorRecibo, setValorRecibo] = useState('');

  // --- Pagamento via Pix, direto no site (Mercado Pago) ---
  const [pixEmAndamento, setPixEmAndamento] = useState(null); // id do agendamento com Pix aberto
  const [dadosPix, setDadosPix] = useState(null); // { qrCode, qrCodeBase64, paymentId, valor }
  const [erroPix, setErroPix] = useState('');
  const [gerandoPix, setGerandoPix] = useState(false);

  // --- Pagamento via Pix da Igreja (uma cobrança única por igreja/polo, gerada
  // pelo admin — separado do Pix por aluno acima, que continua existindo igual) ---
  const [igrejaComPixAberto, setIgrejaComPixAberto] = useState(null); // id da igreja com Pix aberto
  const [igrejaAlunoExpandido, setIgrejaAlunoExpandido] = useState(null); // id do agendamento com histórico/avaliações abertos no Portal da Igreja
  const [dadosPixIgreja, setDadosPixIgreja] = useState(null);
  const [erroPixIgreja, setErroPixIgreja] = useState('');
  const [gerandoPixIgreja, setGerandoPixIgreja] = useState(false);

  // --- Assistente de cadastro e agendamento (aluno) ---
  const [poloSelecionado, setPoloSelecionado] = useState('');
  const [instrumentoSelecionado, setInstrumentoSelecionado] = useState('');
  const [vagaSelecionada, setVagaSelecionada] = useState('');
  const [dadosAluno, setDadosAluno] = useState({ nome: '', telefone: '', email: '', senha: '' });
  const [erroAgendamento, setErroAgendamento] = useState('');
  const [salvandoAgendamento, setSalvandoAgendamento] = useState(false);

  // --- Portal do Aluno (login individual) ---
  const [emailAluno, setEmailAluno] = useState('');
  const [senhaAluno, setSenhaAluno] = useState('');
  const [erroLoginAluno, setErroLoginAluno] = useState('');

  // --- Portal da Igreja (login da igreja mantenedora) ---
  const [emailIgreja, setEmailIgreja] = useState('');
  const [senhaIgreja, setSenhaIgreja] = useState('');
  const [erroLoginIgreja, setErroLoginIgreja] = useState('');

  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [mensagemImportacao, setMensagemImportacao] = useState('');

  const souAdmin = !!(usuario && !usuario.isAnonymous && usuario.email === ADMIN_EMAIL);
  // Uma conta é "igreja" quando o uid dela está gravado em algum documento de "igrejas"
  // (feito pela função serverless que cria o acesso) — precisa ser checado antes de
  // "aluno", porque senão a conta da igreja cairia no Portal do Aluno por engano.
  const souIgreja = !!(usuario && !usuario.isAnonymous && !souAdmin && igrejasCadastradas.some(i => i.uid === usuario.uid));
  const souAluno = !!(usuario && !usuario.isAnonymous && usuario.email !== ADMIN_EMAIL && !souIgreja);
  // Igreja logada (Portal da Igreja) e o polo que ela mantém — precisa estar calculado
  // aqui em cima (e não só mais abaixo, perto de onde era usado antes) porque o efeito
  // que busca agendamentos/presenças/avaliações, logo a seguir, precisa do poloId dela
  // pra montar o filtro certo da busca.
  const minhaIgreja = usuario ? igrejasCadastradas.find(i => i.uid === usuario.uid) : null;

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (user && !user.isAnonymous) {
        setUsuario(user);
      } else {
        setUsuario(null);
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Erro na autenticação anônima:", err);
        }
      }
    });

    // Coleção pública só com "esse horário está ocupado" — sem nenhum dado do aluno.
    const unsubVagas = onSnapshot(collection(db, 'vagas'), (snapshot) => {
      setVagasOcupadas(snapshot.docs.map(d => d.id));
    }, (error) => {
      console.error("Erro ao buscar vagas ocupadas:", error);
    });

    // Grade de turmas (polo + instrumento + dia + horários) — pública pra leitura,
    // só o admin pode criar/editar/remover. É o que decide quais horários aparecem
    // pro aluno escolher no cadastro.
    const unsubTurmas = onSnapshot(collection(db, 'turmas'), (snapshot) => {
      setTurmasCadastradas(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Erro ao buscar turmas:", error);
    });

    // Lista de polos (locais de ensino) — pública pra leitura, só o admin pode
    // criar/editar/remover. É o que decide quais polos aparecem pro aluno escolher.
    const unsubPolos = onSnapshot(collection(db, 'polos'), (snapshot) => {
      setPolosCadastrados(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Erro ao buscar polos:", error);
    });

    // Lista de igrejas cadastradas (mantenedoras de pacote) — pública pra leitura,
    // só o admin pode criar/editar/remover (mesma regra de polos/turmas).
    const unsubIgrejas = onSnapshot(collection(db, 'igrejas'), (snapshot) => {
      setIgrejasCadastradas(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Erro ao buscar igrejas:", error);
    });

    // Materiais/vídeos de estudo — pública pra leitura (qualquer aluno logado vê a lista).
    const unsubMateriais = onSnapshot(collection(db, 'materiais'), (snapshot) => {
      setMateriaisCadastrados(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Erro ao buscar materiais:", error);
    });

    // Dados do proprietário/emissor (nome, CPF, endereço) que aparecem no recibo —
    // documento único, precisa de login (qualquer papel) pra ler, só o admin edita.
    const unsubProprietario = onSnapshot(doc(db, 'configuracoes', 'proprietario'), (snap) => {
      if (snap.exists()) {
        const dados = snap.data();
        setDadosProprietario({ nome: dados.nome || '', cpf: dados.cpf || '', endereco: dados.endereco || '' });
      }
    }, (error) => {
      console.error("Erro ao buscar dados do proprietário:", error);
    });

    return () => {
      unsubAuth();
      unsubVagas();
      unsubTurmas();
      unsubPolos();
      unsubIgrejas();
      unsubMateriais();
      unsubProprietario();
    };
  }, []);

  // Agendamentos, presenças e avaliações dependem de QUEM está pedindo (a regra do
  // Firestore só libera pra dono do registro, pra igreja do polo, ou pro admin) — por
  // isso, diferente das coleções públicas acima, essas três só são buscadas DEPOIS que
  // o login termina de resolver, e são buscadas DE NOVO sempre que o login mudar (login,
  // logout, virar outra conta). Sem isso tinha uma corrida: a busca começava assim que a
  // página abria, muitas vezes antes do Firebase terminar de restaurar a sessão salva —
  // se a busca acontecesse nesse instante ainda sem login válido, ela era recusada e
  // NUNCA tentava de novo, mesmo depois do login terminar de carregar. Era exatamente
  // isso que fazia o Portal do Aluno aparecer vazio só depois de atualizar a página (e
  // funcionar normalmente navegando dentro do app sem recarregar, porque aí o login já
  // estava resolvido de antes).
  useEffect(() => {
    if (!usuario) {
      setLoading(false);
      setAgendamentos([]);
      setPresencasCadastradas([]);
      setAvaliacoesCadastradas([]);
      return;
    }

    // A causa de verdade do Portal ficar vazio NÃO era só a corrida de tempo (já
    // corrigida acima, buscando só depois do login resolver) — era a FORMA da busca.
    // A regra do Firestore só libera cada agendamento/presença/avaliação pro dono
    // (uid), pra igreja daquele polo (local == poloId), ou pro admin — e o Firestore
    // recusa uma busca "sem filtro nenhum" (pega a coleção inteira) sempre que ela não
    // conseguir garantir essa regra pra QUALQUER documento que pudesse existir ali, não
    // importa quão certo esteja o login. Então, mesmo com o login perfeito, a busca sem
    // filtro nunca ia funcionar pra aluno/igreja — só funcionava (por acidente) pro
    // admin, porque a parte da regra dele não depende do conteúdo do documento. A busca
    // agora usa o MESMO filtro que a regra exige: sem filtro pro admin (a regra libera
    // geral), filtrando por "uid" pro aluno, e filtrando por "local" (o polo) pra igreja.
    let filtroAgendamentos = collection(db, 'agendamentos');
    let filtroPresencas = collection(db, 'presencas');
    let filtroAvaliacoes = collection(db, 'avaliacoes');

    if (!souAdmin) {
      if (souIgreja) {
        if (!minhaIgreja?.poloId) {
          // Ainda não sabemos o polo dessa igreja (lista de igrejas ainda carregando)
          // — espera a próxima passada deste efeito, em vez de arriscar uma busca sem
          // filtro que a regra recusaria.
          setLoading(false);
          return;
        }
        filtroAgendamentos = query(collection(db, 'agendamentos'), where('local', '==', minhaIgreja.poloId));
        filtroPresencas = query(collection(db, 'presencas'), where('local', '==', minhaIgreja.poloId));
        filtroAvaliacoes = query(collection(db, 'avaliacoes'), where('local', '==', minhaIgreja.poloId));
      } else {
        filtroAgendamentos = query(collection(db, 'agendamentos'), where('uid', '==', usuario.uid));
        filtroPresencas = query(collection(db, 'presencas'), where('uid', '==', usuario.uid));
        filtroAvaliacoes = query(collection(db, 'avaliacoes'), where('uid', '==', usuario.uid));
      }
    }

    const unsubAgendamentos = onSnapshot(filtroAgendamentos, (snapshot) => {
      setAgendamentos(snapshot.docs.map(docItem => ({ id: docItem.id, ...docItem.data() })));
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar agendamentos do Firestore:", error);
      setLoading(false);
    });

    const unsubPresencas = onSnapshot(filtroPresencas, (snapshot) => {
      setPresencasCadastradas(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Erro ao buscar presenças:", error);
    });

    const unsubAvaliacoes = onSnapshot(filtroAvaliacoes, (snapshot) => {
      setAvaliacoesCadastradas(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (error) => {
      console.error("Erro ao buscar avaliações:", error);
    });

    return () => {
      unsubAgendamentos();
      unsubPresencas();
      unsubAvaliacoes();
    };
  }, [usuario?.uid, souAdmin, souIgreja, minhaIgreja?.poloId]);

  const fazerLogin = async (e) => {
    e.preventDefault();
    setErroLogin('');
    try {
      await signInWithEmailAndPassword(auth, emailAdmin, senhaAdmin);
      setAbaAtiva('gerenciar');
      setEmailAdmin('');
      setSenhaAdmin('');
    } catch (err) {
      console.error("Erro ao fazer login:", err);
      setErroLogin('E-mail ou senha inválidos. Verifique os dados no Firebase.');
    }
  };

  const fazerLogout = async () => {
    try {
      await signOut(auth);
      setAbaAtiva('painel');
    } catch (err) {
      console.error("Erro ao sair:", err);
    }
  };

  const fazerLoginAluno = async (e) => {
    e.preventDefault();
    setErroLoginAluno('');
    try {
      await signInWithEmailAndPassword(auth, emailAluno, senhaAluno);
      setAbaAtiva('portal');
      setEmailAluno('');
      setSenhaAluno('');
    } catch (err) {
      console.error("Erro ao fazer login do aluno:", err);
      setErroLoginAluno('E-mail ou senha inválidos. Se ainda não tem cadastro, use "Novo Cadastro".');
    }
  };

  const fazerLoginIgreja = async (e) => {
    e.preventDefault();
    setErroLoginIgreja('');
    try {
      await signInWithEmailAndPassword(auth, emailIgreja, senhaIgreja);
      setAbaAtiva('portalIgreja');
      setEmailIgreja('');
      setSenhaIgreja('');
    } catch (err) {
      console.error("Erro ao fazer login da igreja:", err);
      setErroLoginIgreja('E-mail ou senha inválidos. O acesso da igreja é criado pela coordenação, na aba Igrejas.');
    }
  };

  // Agenda uma vaga: cria (ou reaproveita) a conta do aluno no Firebase Auth,
  // marca a vaga como ocupada e grava o agendamento — tudo numa transação,
  // pra dois alunos nunca conseguirem reservar o mesmo horário ao mesmo tempo.
  const handleAgendar = async (e) => {
    e.preventDefault();
    setErroAgendamento('');

    if (!poloSelecionado || !instrumentoSelecionado || !vagaSelecionada) {
      setErroAgendamento('Escolha o polo, o instrumento e o horário antes de continuar.');
      return;
    }
    if (!dadosAluno.nome || !dadosAluno.email || !dadosAluno.senha) {
      setErroAgendamento('Preencha nome, e-mail e senha para concluir o cadastro.');
      return;
    }
    if (dadosAluno.senha.length < 6) {
      setErroAgendamento('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (vagasOcupadas.includes(vagaSelecionada)) {
      setErroAgendamento('Esse horário acabou de ser reservado por outra pessoa. Escolha outro.');
      return;
    }

    const vaga = vagasDisponiveis.find(v => v.id === vagaSelecionada);
    if (!vaga) {
      setErroAgendamento('Não encontrei esse horário. Escolha novamente.');
      return;
    }

    setSalvandoAgendamento(true);
    try {
      // Garante que existe uma conta de aluno autenticada antes de gravar o agendamento.
      let credencial;
      try {
        credencial = await createUserWithEmailAndPassword(auth, dadosAluno.email, dadosAluno.senha);
      } catch (errCriar) {
        if (errCriar.code === 'auth/email-already-in-use') {
          // Repetir o mesmo e-mail em mais de um cadastro só é permitido pra Banda
          // (vários integrantes registrados sob o mesmo login/contato) — pra Violão e
          // Bateria, cada aluno precisa do próprio e-mail, senão a agenda/portal de um
          // se mistura com a do outro.
          if (instrumentoSelecionado !== 'banda') {
            setErroAgendamento('Esse e-mail já está em uso por outro cadastro. Use um e-mail diferente — repetir o mesmo e-mail só é permitido no cadastro de Banda.');
            setSalvandoAgendamento(false);
            return;
          }
          try {
            credencial = await signInWithEmailAndPassword(auth, dadosAluno.email, dadosAluno.senha);
          } catch (errLogin) {
            setErroAgendamento('Esse e-mail já tem cadastro, mas a senha não confere. Use a mesma senha do primeiro integrante da banda cadastrado com esse e-mail.');
            setSalvandoAgendamento(false);
            return;
          }
        } else if (errCriar.code === 'auth/invalid-email') {
          setErroAgendamento('Esse e-mail não parece válido.');
          setSalvandoAgendamento(false);
          return;
        } else {
          throw errCriar;
        }
      }

      const uid = credencial.user.uid;

      // Atualiza o "usuario" logo aqui, sem esperar o listener onAuthStateChanged
      // avisar (ele é assíncrono e pode demorar um instante) — é o que faz o Portal
      // do Aluno já reconhecer esse login na hora de ir pra aba "portal" duas linhas
      // abaixo. Sem isso, a troca de aba acontecia rápido demais: a página ainda via
      // a sessão anônima antiga por uma fração de segundo e mostrava de novo a tela
      // de agendamento (ou "nenhuma aula agendada") em vez do portal com a aula nova.
      setUsuario(credencial.user);

      await runTransaction(db, async (transaction) => {
        const vagaRef = doc(db, 'vagas', vagaSelecionada);
        const vagaSnap = await transaction.get(vagaRef);
        if (vagaSnap.exists()) {
          throw new Error('VAGA_OCUPADA');
        }
        transaction.set(vagaRef, { ocupado: true });

        const agendamentoRef = doc(collection(db, 'agendamentos'));
        transaction.set(agendamentoRef, {
          nome: dadosAluno.nome,
          telefone: dadosAluno.telefone || '',
          local: poloSelecionado,
          instrumento: instrumentoSelecionado,
          dia: vaga.dia,
          horario: vaga.horario,
          horarioLabel: vaga.horarioLabel,
          slotId: vagaSelecionada,
          uid,
          presenca: false,
          // Mata Fria/Penha do Côco é cobrado por aula individual; os demais polos
          // (São Luiz, Chalé, Água Limpa, Igreja Tabernáculo, e qualquer polo novo)
          // começam como pacote — o admin ajusta exceção por exceção na aba Pagamentos.
          tipoPagamento: poloSelecionado === 'matafria' ? 'individual' : 'pacote',
          formaPagamento: 'pix',
          dataPagamento: '',
          pago: false,
          criadoEm: new Date().toISOString()
        });
      });

      setMensagemSucesso('Aula agendada com sucesso! Você já está logado — confira no seu Portal do Aluno.');
      setPoloSelecionado('');
      setInstrumentoSelecionado('');
      setVagaSelecionada('');
      setDadosAluno({ nome: '', telefone: '', email: '', senha: '' });
      setTimeout(() => setMensagemSucesso(''), 5000);
      setAbaAtiva('portal');
    } catch (err) {
      console.error("Erro ao agendar:", err);
      if (err.message === 'VAGA_OCUPADA') {
        setErroAgendamento('Esse horário acabou de ser reservado por outra pessoa. Escolha outro.');
      } else {
        setErroAgendamento('Erro ao agendar. Tente novamente em instantes.');
      }
    } finally {
      setSalvandoAgendamento(false);
    }
  };

  // Exclui o cadastro e, na sequência, libera o horário dele (apaga o documento
  // correspondente em "vagas") pra outro aluno poder pegar essa vaga depois. A exclusão
  // do aluno sempre acontece primeiro e sozinha; se a vaga não conseguir ser liberada
  // (ex: a regra do Firestore ainda não foi atualizada pra permitir isso), o aluno já
  // saiu da lista mesmo assim — só o horário continua bloqueado até você resolver isso.
  const excluirAgendamento = async (id) => {
    if (!window.confirm('Tem certeza que deseja excluir este registro? Isso também libera o horário dele pra outro aluno.')) return;

    const item = agendamentos.find(a => a.id === id);
    try {
      await deleteDoc(doc(db, 'agendamentos', id));
    } catch (err) {
      console.error("Erro ao excluir:", err);
      alert('Erro ao excluir registro.');
      return;
    }

    if (item?.slotId) {
      try {
        await deleteDoc(doc(db, 'vagas', item.slotId));
      } catch (errVaga) {
        console.error('Erro ao liberar a vaga:', errVaga);
        setMensagemImportacao('Aluno excluído, mas não consegui liberar o horário dele automaticamente — confira se a regra do Firestore pra "vagas" já permite exclusão pelo admin.');
        setTimeout(() => setMensagemImportacao(''), 10000);
      }
    }
  };

  // Correção de cadastro — nome, telefone, polo e instrumento. Importante: isso só
  // corrige o CADASTRO (o texto que aparece nas telas); não mexe na "vaga" reservada
  // (coleção vagas/slotId) que trava aquele dia/horário. Se mudar o polo ou o instrumento
  // de alguém aqui, o horário antigo continua marcado como ocupado (ninguém mais consegue
  // pegar aquele lugar) e o horário exibido pro aluno pode não bater mais com o novo polo/
  // instrumento. Pra manter a grade 100% certa depois de mudar polo/instrumento, o ideal
  // ainda é excluir e recadastrar (libera a vaga antiga e deixa escolher um horário novo)
  // — mas ficou liberado editar aqui direto pra correções rápidas de cadastro.
  const iniciarEdicaoAluno = (item) => {
    setErroEdicaoAluno('');
    setNovaAvaliacao({ data: '', texto: '' });
    setEditandoAluno({
      id: item.id,
      uid: item.uid || null,
      nome: item.nome || '',
      telefone: item.telefone || '',
      local: item.local || '',
      instrumento: item.instrumento || '',
      novoEmail: '',
      novaSenha: ''
    });
  };
  const cancelarEdicaoAluno = () => {
    setEditandoAluno(null);
    setErroEdicaoAluno('');
  };

  // Salva nome/telefone/polo/instrumento direto no Firestore (como já era). Se o campo
  // "novo e-mail" ou "nova senha" for preenchido, chama a API que corrige o LOGIN do
  // aluno (Firebase Auth) — isso não dá pra fazer aqui do navegador, porque mudar o
  // e-mail/senha de outra conta não é permitido pelo SDK do cliente logado como admin.
  // Não mostra o e-mail atual porque ele não fica salvo no Firestore, só no Auth — o
  // campo sempre começa em branco e, se deixar em branco, o e-mail/senha atuais continuam
  // os mesmos.
  const salvarEdicaoAluno = async (e) => {
    e.preventDefault();
    const nome = editandoAluno.nome.trim();
    if (!nome) {
      setErroEdicaoAluno('O nome não pode ficar em branco.');
      return;
    }
    const novoEmail = editandoAluno.novoEmail.trim();
    const novaSenha = editandoAluno.novaSenha;
    if (novaSenha && novaSenha.length < 6) {
      setErroEdicaoAluno('A nova senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    setErroEdicaoAluno('');
    setSalvandoEdicaoAluno(true);
    try {
      await updateDoc(doc(db, 'agendamentos', editandoAluno.id), {
        nome,
        telefone: editandoAluno.telefone.trim(),
        local: editandoAluno.local,
        instrumento: editandoAluno.instrumento
      });

      if (novoEmail || novaSenha) {
        const idToken = await usuario.getIdToken();
        const resposta = await fetch('/api/alunos/editar-acesso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ agendamentoId: editandoAluno.id, novoEmail, novaSenha })
        });
        const dados = await resposta.json();
        if (!resposta.ok) {
          throw new Error(dados?.erro || 'Cadastro salvo, mas não consegui atualizar o e-mail/senha agora.');
        }
      }

      setEditandoAluno(null);
    } catch (err) {
      console.error('Erro ao editar cadastro do aluno:', err);
      setErroEdicaoAluno(err.message || 'Erro ao salvar as alterações do aluno.');
    } finally {
      setSalvandoEdicaoAluno(false);
    }
  };

  const alternarPresenca = async (id, statusAtual) => {
    try {
      await updateDoc(doc(db, 'agendamentos', id), {
        presenca: !statusAtual
      });
    } catch (err) {
      console.error("Erro ao atualizar presença:", err);
    }
  };

  // Marca/desmarca presença de UM aluno em UMA data específica de aula (pauta por
  // data). Guarda o "uid" do aluno no próprio documento de presença — não dá pra usar
  // uma regra do Firestore baseada em "resource.data.uid == auth.uid" sem isso, já que
  // o id do documento (agendamentoId_data) não carrega o uid sozinho.
  const alternarPresencaData = async (agendamento, dataIso, presenteAtual) => {
    const idPresenca = `${agendamento.id}_${dataIso}`;
    try {
      await setDoc(doc(db, 'presencas', idPresenca), {
        agendamentoId: agendamento.id,
        uid: agendamento.uid || null,
        local: agendamento.local || null,
        data: dataIso,
        presente: !presenteAtual,
        marcadoEm: new Date().toISOString()
      });
    } catch (err) {
      console.error('Erro ao marcar presença da data:', err);
      alert('Erro ao marcar a presença dessa data. Tente novamente.');
    }
  };

  // Acha o registro de presença (se algum) de um aluno numa data específica.
  const presencaNaData = (agendamentoId, dataIso) =>
    presencasCadastradas.find(p => p.agendamentoId === agendamentoId && p.data === dataIso);

  // --- Avaliações de desempenho (nota livre por data, dentro do cadastro do aluno) ---
  const adicionarAvaliacao = async (agendamento, dataIso, texto) => {
    const textoLimpo = (texto || '').trim();
    if (!textoLimpo) return;
    setSalvandoAvaliacao(true);
    try {
      await addDoc(collection(db, 'avaliacoes'), {
        agendamentoId: agendamento.id,
        uid: agendamento.uid || null,
        local: agendamento.local || null,
        data: dataIso || new Date().toISOString().slice(0, 10),
        texto: textoLimpo,
        criadoEm: new Date().toISOString()
      });
      setNovaAvaliacao({ data: '', texto: '' });
    } catch (err) {
      console.error('Erro ao salvar avaliação:', err);
      alert('Erro ao salvar a avaliação. Tente novamente.');
    } finally {
      setSalvandoAvaliacao(false);
    }
  };

  const removerAvaliacao = async (id) => {
    if (!window.confirm('Remover essa avaliação?')) return;
    try {
      await deleteDoc(doc(db, 'avaliacoes', id));
    } catch (err) {
      console.error('Erro ao remover avaliação:', err);
      alert('Erro ao remover a avaliação.');
    }
  };

  // --- Materiais/vídeos de estudo (aba Materiais) ---
  const adicionarMaterial = async (e) => {
    e.preventDefault();
    setErroMaterial('');
    const titulo = novoMaterial.titulo.trim();
    const link = novoMaterial.link.trim();
    if (!titulo || !link) {
      setErroMaterial('Preencha o título e o link do material.');
      return;
    }
    setSalvandoMaterial(true);
    try {
      await addDoc(collection(db, 'materiais'), {
        titulo,
        tipo: novoMaterial.tipo,
        instrumento: novoMaterial.instrumento,
        link,
        criadoEm: new Date().toISOString()
      });
      setNovoMaterial({ titulo: '', tipo: 'PDF', instrumento: 'todos', link: '' });
    } catch (err) {
      console.error('Erro ao salvar material:', err);
      setErroMaterial('Erro ao salvar o material. Tente novamente.');
    } finally {
      setSalvandoMaterial(false);
    }
  };

  const removerMaterial = async (id) => {
    if (!window.confirm('Remover esse material da lista de todos os alunos?')) return;
    try {
      await deleteDoc(doc(db, 'materiais', id));
    } catch (err) {
      console.error('Erro ao remover material:', err);
      alert('Erro ao remover o material.');
    }
  };

  const alternarPagamento = async (id, statusAtual) => {
    try {
      await updateDoc(doc(db, 'agendamentos', id), {
        pago: !statusAtual
      });
    } catch (err) {
      console.error("Erro ao atualizar pagamento:", err);
    }
  };

  const alterarTipoPagamento = async (id, novoTipo) => {
    try {
      await updateDoc(doc(db, 'agendamentos', id), { tipoPagamento: novoTipo });
    } catch (err) {
      console.error('Erro ao alterar tipo de pagamento:', err);
      alert('Erro ao alterar o tipo de pagamento.');
    }
  };

  const alterarFormaPagamento = async (id, novaForma) => {
    try {
      await updateDoc(doc(db, 'agendamentos', id), { formaPagamento: novaForma });
    } catch (err) {
      console.error('Erro ao alterar forma de pagamento:', err);
      alert('Erro ao alterar a forma de pagamento.');
    }
  };

  // Data de pagamento é sempre escolhida por você (nunca preenchida sozinha) — serve
  // tanto pra marcar quando um pagamento já caiu quanto pra guardar uma data combinada
  // que ainda vai acontecer.
  const alterarDataPagamento = async (id, novaData) => {
    try {
      await updateDoc(doc(db, 'agendamentos', id), { dataPagamento: novaData });
    } catch (err) {
      console.error('Erro ao alterar data de pagamento:', err);
      alert('Erro ao alterar a data de pagamento.');
    }
  };

  // Define de uma vez o tipo de pagamento (pacote/individual) de TODOS os alunos de um
  // polo — pra depois você só ajustar exceção por exceção (ex: 1 aluno individual no
  // meio de um polo que é pacote) direto no seletor de cada card.
  const definirTipoPagamentoPorPolo = async (poloId, tipo) => {
    const alvos = agendamentos.filter(a => a.local === poloId);
    if (alvos.length === 0) {
      alert('Não tem nenhum aluno cadastrado nesse polo ainda.');
      return;
    }
    const nomePolo = LOCALIZACOES.find(l => l.id === poloId)?.nome || poloId;
    if (!window.confirm(`Marcar os ${alvos.length} aluno(s) do polo "${nomePolo}" como "${tipo === 'individual' ? 'Individual' : 'Pacote'}"? Isso não mexe em quem já está marcado como pago ou pendente, só no tipo de cobrança.`)) return;
    try {
      for (const item of alvos) {
        await updateDoc(doc(db, 'agendamentos', item.id), { tipoPagamento: tipo });
      }
    } catch (err) {
      console.error('Erro ao definir tipo de pagamento em lote:', err);
      alert('Erro ao aplicar em lote — alguns alunos podem ter ficado sem atualizar.');
    }
  };

  // Abre o recibo já com um valor sugerido (editável) — chamado assim que o pagamento
  // combinado tem uma data definida, direto do card do aluno na aba Pagamentos. Se você já
  // combinou um valor específico (campo "Valor combinado" mais abaixo), usa ele em vez do
  // valor padrão do tipo, pra bater com o que realmente foi cobrado.
  const abrirRecibo = (item) => {
    const polo = LOCALIZACOES.find(l => l.id === item.local);
    setQuantidadeAulasRecibo(1);
    const valorPadrao = item.valorCombinado != null && item.valorCombinado !== ''
      ? item.valorCombinado
      : valorSugeridoRecibo(item, polo, 1);
    setValorRecibo(String(valorPadrao));
    setItemRecibo({ ...item, origem: 'aluno' });
  };

  // Recibo de pagamento em pacote sai em nome da IGREJA mantenedora do polo, não do
  // aluno individual — já que a cobrança do pacote agora é consolidada por igreja
  // (aba Igrejas), em vez de cobrada aluno por aluno. Chamado direto do card da igreja.
  const abrirReciboIgreja = (igreja) => {
    setQuantidadeAulasRecibo(1);
    const valorPadrao = igreja.valorCombinado != null && igreja.valorCombinado !== ''
      ? igreja.valorCombinado
      : (VALOR_PACOTE_POR_POLO[igreja.poloId] ?? VALOR_PACOTE_PADRAO_OUTROS);
    setValorRecibo(String(valorPadrao));
    setItemRecibo({
      origem: 'igreja',
      nome: igreja.nome,
      local: igreja.poloId,
      tipoPagamento: 'pacote',
      formaPagamento: igreja.formaPagamento,
      dataPagamento: igreja.dataPagamento,
      valorCombinado: igreja.valorCombinado
    });
  };

  // Salva o cadastro do proprietário/emissor (aba Configurações) — nome, CPF e
  // endereço que passam a aparecer no recibo, pra você poder usar ele pra
  // controle fiscal. Um único documento, sobrescrito toda vez que você salva.
  const salvarProprietario = async (e) => {
    e.preventDefault();
    setSalvandoProprietario(true);
    setMensagemProprietario('');
    try {
      await setDoc(doc(db, 'configuracoes', 'proprietario'), {
        nome: formProprietario.nome.trim(),
        cpf: formProprietario.cpf.trim(),
        endereco: formProprietario.endereco.trim()
      });
      setMensagemProprietario('Dados salvos! Já aparecem nos próximos recibos gerados.');
      setTimeout(() => setMensagemProprietario(''), 4000);
    } catch (err) {
      console.error('Erro ao salvar dados do proprietário:', err);
      setMensagemProprietario('Erro ao salvar. Tente novamente em instantes.');
    } finally {
      setSalvandoProprietario(false);
    }
  };

  // Valor combinado é o que vira a cobrança via Pix online (botão "Pagar com Pix" no
  // Portal do Aluno) — fica separado do valor do recibo pra você poder ajustar/confirmar
  // antes de liberar a cobrança pro aluno pagar sozinho.
  const alterarValorCombinado = async (id, novoValor) => {
    try {
      const valor = novoValor === '' ? null : Number(novoValor);
      await updateDoc(doc(db, 'agendamentos', id), { valorCombinado: valor });
    } catch (err) {
      console.error('Erro ao alterar valor combinado:', err);
      alert('Erro ao salvar o valor combinado.');
    }
  };

  // Chama a função serverless /api/mercadopago/criar-pix (Vercel) que gera a cobrança
  // Pix de verdade no Mercado Pago. Só funciona depois que o admin definir o "Valor
  // combinado" desse agendamento e depois que as variáveis de ambiente do Mercado Pago
  // e do Firebase Admin estiverem configuradas na Vercel (ver PAGAMENTO_PIX_SETUP.md).
  const pagarComPix = async (item) => {
    setErroPix('');
    setDadosPix(null);
    setGerandoPix(true);
    try {
      const idToken = await usuario.getIdToken();
      const resposta = await fetch('/api/mercadopago/criar-pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ agendamentoId: item.id, email: usuario.email })
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        throw new Error(dados?.erro || 'Não foi possível gerar o Pix agora.');
      }
      setDadosPix(dados);
      setPixEmAndamento(item.id);
    } catch (err) {
      console.error('Erro ao gerar Pix:', err);
      setErroPix(err.message || 'Não foi possível gerar o Pix agora. Tente novamente em instantes.');
    } finally {
      setGerandoPix(false);
    }
  };

  // Restaura um backup .json (baixado pelo botão "Baixar Backup") — substitui TODOS os
  // alunos, turmas e polos atuais pelos dados salvos naquele arquivo. Recria cada
  // documento com o MESMO id que ele tinha no backup, pra manter intactas as referências
  // (o slotId de um agendamento aponta pra um id em "vagas", por exemplo).
  // Isso substitui o antigo "Importar CSV" genérico, que criava um registro novo pra
  // cada linha sem checar se o aluno já existia — a causa mais provável dos duplicados.
  const handleImportarBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => {
      setMensagemImportacao('Não foi possível ler esse arquivo. Tente selecionar o arquivo de novo.');
    };
    reader.onload = async (event) => {
      let backup;
      try {
        backup = JSON.parse(event.target.result);
      } catch (err) {
        setMensagemImportacao('Esse arquivo não é um backup válido (não é um .json legível).');
        return;
      }

      if (!Array.isArray(backup.agendamentos) || !Array.isArray(backup.turmas) || !Array.isArray(backup.polos)) {
        setMensagemImportacao('Esse arquivo não parece ser um backup gerado pelo botão "Baixar Backup".');
        return;
      }

      const dataBackup = backup.geradoEm ? new Date(backup.geradoEm).toLocaleString('pt-BR') : 'data desconhecida';
      const confirmar = window.confirm(
        `Isso vai APAGAR os cadastros atuais (${agendamentos.length} alunos, ${turmasCadastradas.length} turmas, ${polosCadastrados.length} polos salvos no Firestore) e substituir pelos dados do backup de ${dataBackup} (${backup.agendamentos.length} alunos, ${backup.turmas.length} turmas, ${backup.polos.length} polos). Essa ação não pode ser desfeita. Se não tiver certeza, cancela aqui e clica em "Baixar Backup" primeiro pra guardar o estado atual antes de restaurar. Continuar?`
      );
      if (!confirmar) return;

      // A coleção "vagas" tem uma regra no Firestore que impede QUALQUER exclusão ou
      // alteração dela por qualquer usuário, admin incluído (allow update, delete: if
      // false — é assim de propósito, pra nunca liberar de novo um horário já ocupado
      // sem querer). Por isso a restauração nunca apaga nem sobrescreve uma vaga que já
      // existe — só cria as que estão no backup e ainda não existem agora. Efeito
      // colateral: se o backup for de um momento com MENOS vagas ocupadas do que agora,
      // as vagas ocupadas depois do backup continuam bloqueadas mesmo sem o agendamento
      // correspondente — só dá pra liberar isso manualmente no Console do Firebase.
      const vagasAtuais = new Set(vagasOcupadas);

      try {
        for (const item of agendamentos) await deleteDoc(doc(db, 'agendamentos', item.id));
        for (const item of turmasCadastradas) await deleteDoc(doc(db, 'turmas', item.id));
        for (const item of polosCadastrados) await deleteDoc(doc(db, 'polos', item.id));

        for (const item of backup.agendamentos) {
          const { id, ...dadosItem } = item;
          await setDoc(doc(db, 'agendamentos', id), dadosItem);
        }
        for (const item of backup.turmas) {
          const { id, ...dadosItem } = item;
          await setDoc(doc(db, 'turmas', id), dadosItem);
        }
        for (const item of backup.polos) {
          const { id, ...dadosItem } = item;
          await setDoc(doc(db, 'polos', id), dadosItem);
        }
        for (const idVaga of (backup.vagasOcupadas || [])) {
          if (vagasAtuais.has(idVaga)) continue;
          await setDoc(doc(db, 'vagas', idVaga), { ocupado: true });
        }

        setMensagemImportacao(`Backup de ${dataBackup} restaurado: ${backup.agendamentos.length} alunos, ${backup.turmas.length} turmas e ${backup.polos.length} polos.`);
        setTimeout(() => setMensagemImportacao(''), 15000);
      } catch (err) {
        console.error('Erro ao restaurar backup:', err);
        setMensagemImportacao('Erro ao restaurar o backup — pode ter ficado parcialmente aplicado. Veja o console do navegador para detalhes.');
      }
    };
    reader.readAsText(file);
  };

  // Parser de CSV que respeita campos entre aspas (necessário porque o cabeçalho
  // do formulário tem vírgula dentro de um campo, ex: "Possuí violão, bateria...?")
  const parseLinhaCSV = (linha) => {
    const resultado = [];
    let atual = '';
    let dentroAspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') {
        if (dentroAspas && linha[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          dentroAspas = !dentroAspas;
        }
      } else if (c === ',' && !dentroAspas) {
        resultado.push(atual);
        atual = '';
      } else {
        atual += c;
      }
    }
    resultado.push(atual);
    return resultado;
  };

  // Migração pontual: lê a planilha de respostas do formulário do São Luiz e
  // recria os alunos com horário FIXO na grade nova — Violão na sexta, Bateria
  // no sábado, em ordem de inscrição, ignorando o horário que cada um escolheu
  // no formulário original. Substitui os registros antigos do polo São Luiz
  // (que estavam com telefone/e-mail trocados por causa da importação anterior).
  const handleMigrarSaoLuiz = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => {
      setMensagemImportacao('Não foi possível ler esse arquivo. Tente selecionar o arquivo de novo.');
    };
    reader.onload = async (event) => {
      try {
        const linhas = event.target.result.split(/\r?\n/).filter(l => l.trim());
        if (linhas.length < 2) {
          setMensagemImportacao('Planilha vazia ou em formato inesperado.');
          return;
        }

        const cabecalho = parseLinhaCSV(linhas[0]).map(c => c.toLowerCase().trim());
        const idx = {
          nome: cabecalho.findIndex(c => c.includes('nome')),
          telefone: cabecalho.findIndex(c => c.includes('telefone')),
          instrumento: cabecalho.findIndex(c => c.includes('instrumento') && c.includes('quer')),
          possui: cabecalho.findIndex(c => c.includes('possu'))
        };

        if (idx.nome === -1 || idx.instrumento === -1) {
          setMensagemImportacao('Não consegui identificar as colunas de nome/instrumento nessa planilha.');
          return;
        }

        const alunosViolao = [];
        const alunosBateria = [];

        for (let i = 1; i < linhas.length; i++) {
          const cols = parseLinhaCSV(linhas[i]);
          const nome = (cols[idx.nome] || '').trim();
          if (!nome) continue;

          const telefone = idx.telefone > -1 ? (cols[idx.telefone] || '').trim() : '';
          const instrumentoRaw = (cols[idx.instrumento] || '').toLowerCase();
          const temInstrumentoProprio = idx.possui > -1 ? /sim/i.test(cols[idx.possui] || '') : undefined;
          const registro = { nome, telefone, temInstrumentoProprio };

          if (instrumentoRaw.includes('bat')) {
            alunosBateria.push(registro);
          } else {
            alunosViolao.push(registro);
          }
        }

        const horariosViolao = turmasCadastradas
          .filter(t => t.local === 'saoluiz' && t.instrumento === 'violao')
          .flatMap(t => (t.horarios || []).map(h => ({ dia: t.dia, horario: h })));
        const horariosBateria = turmasCadastradas
          .filter(t => t.local === 'saoluiz' && t.instrumento === 'bateria')
          .flatMap(t => (t.horarios || []).map(h => ({ dia: t.dia, horario: h })));

        if (horariosViolao.length === 0 || horariosBateria.length === 0) {
          setMensagemImportacao('Antes de migrar, cria as turmas de São Luiz (Violão e Bateria) na aba Horários — ou clica em "Restaurar grade padrão" lá.');
          return;
        }

        const montarAgendamentos = (lista, horariosDisponiveis, instrumento) => {
          const prontos = [];
          const semVaga = [];
          lista.forEach((aluno, i) => {
            const slot = horariosDisponiveis[i];
            if (!slot) {
              semVaga.push(aluno.nome);
              return;
            }
            const slotId = `vaga-saoluiz-${instrumento}-${slot.dia}-${slot.horario.value}`;
            const dadosAgendamento = {
              nome: aluno.nome,
              telefone: aluno.telefone,
              local: 'saoluiz',
              instrumento,
              dia: slot.dia,
              horario: slot.horario.value,
              horarioLabel: slot.horario.label,
              slotId,
              presenca: false,
              tipoPagamento: 'pacote',
              formaPagamento: 'pix',
              dataPagamento: '',
              pago: false,
              criadoEm: new Date().toISOString()
            };
            if (aluno.temInstrumentoProprio !== undefined) {
              dadosAgendamento.temInstrumentoProprio = aluno.temInstrumentoProprio;
            }
            prontos.push(dadosAgendamento);
          });
          return { prontos, semVaga };
        };

        const { prontos: prontosViolao, semVaga: semVagaViolao } = montarAgendamentos(alunosViolao, horariosViolao, 'violao');
        const { prontos: prontosBateria, semVaga: semVagaBateria } = montarAgendamentos(alunosBateria, horariosBateria, 'bateria');

        const antigosSaoLuiz = agendamentos.filter(a => a.local === 'saoluiz');
        const confirmar = window.confirm(
          `Isso vai apagar os ${antigosSaoLuiz.length} cadastros atuais do polo São Luiz e recriar ${prontosViolao.length + prontosBateria.length} alunos com horário fixo (${prontosViolao.length} violão na sexta, ${prontosBateria.length} bateria no sábado). Continuar?`
        );
        if (!confirmar) return;

        for (const antigo of antigosSaoLuiz) {
          await deleteDoc(doc(db, 'agendamentos', antigo.id));
          if (antigo.slotId) {
            try {
              await deleteDoc(doc(db, 'vagas', antigo.slotId));
            } catch (errVaga) {
              console.error('Erro ao liberar vaga antiga do São Luiz:', errVaga);
            }
          }
        }

        for (const registro of [...prontosViolao, ...prontosBateria]) {
          await addDoc(collection(db, 'agendamentos'), registro);
          await setDoc(doc(db, 'vagas', registro.slotId), { ocupado: true });
        }

        let resumo = `Migração concluída: ${prontosViolao.length} de violão (sexta) e ${prontosBateria.length} de bateria (sábado) cadastrados com horário fixo.`;
        if (semVagaViolao.length) resumo += ` Sem vaga de violão (excedeu as 8 vagas da manhã): ${semVagaViolao.join(', ')}.`;
        if (semVagaBateria.length) resumo += ` Sem vaga de bateria (excedeu as 8 vagas da manhã): ${semVagaBateria.join(', ')}.`;
        setMensagemImportacao(resumo);
        setTimeout(() => setMensagemImportacao(''), 15000);
      } catch (err) {
        console.error('Erro na migração da planilha:', err);
        setMensagemImportacao('Erro ao processar a planilha. Veja o console do navegador para detalhes.');
      }
    };
    reader.readAsText(file);
  };

  // Alunos com horário fixo na grade nova (campos dia/horarioLabel) mostram o dia + horário;
  // alunos do cadastro livre antigo (campos data/horario) mostram no formato antigo;
  // só cai em "A combinar" quando não existe nenhum dos dois.
  const formatarHorario = (item) => {
    if (item.dia && item.horarioLabel) return `${item.dia} · ${item.horarioLabel}`;
    if (item.data) return `${item.data} às ${item.horario}`;
    return 'A combinar';
  };

  const formatarMinutos = (totalMin) => {
    const h = Math.floor(totalMin / 60).toString().padStart(2, '0');
    const m = (totalMin % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  // Gera os blocos de horário de um dia a partir de início/fim/duração — ex:
  // 08:00 até 13:20 de 40 em 40 min vira ["08:00-08:40", "08:40-09:20", ...]
  const gerarHorarios = (inicio, fim, duracaoMin) => {
    const [hIni, mIni] = inicio.split(':').map(Number);
    const [hFim, mFim] = fim.split(':').map(Number);
    let atual = hIni * 60 + mIni;
    const fimTotal = hFim * 60 + mFim;
    const horarios = [];
    while (atual + duracaoMin <= fimTotal) {
      const valorInicio = formatarMinutos(atual);
      const fimBloco = atual + duracaoMin;
      horarios.push({ value: valorInicio, label: `${valorInicio} - ${formatarMinutos(fimBloco)}` });
      atual = fimBloco;
    }
    return horarios;
  };

  // Cria uma nova turma (dia + faixa de horário) pra um polo/instrumento — só o admin
  // consegue fazer isso (regra do Firestore); os alunos só escolhem entre o que já existe.
  const adicionarTurma = async (e) => {
    e.preventDefault();
    setErroTurma('');

    if (!novaTurma.dia.trim() || !novaTurma.inicio || !novaTurma.fim) {
      setErroTurma('Preencha o nome do dia/grupo e os horários de início e fim.');
      return;
    }
    const duracao = Number(novaTurma.duracao) || 40;
    const horarios = gerarHorarios(novaTurma.inicio, novaTurma.fim, duracao);
    if (horarios.length === 0) {
      setErroTurma('Não deu pra gerar nenhum horário com esses valores — confira início, fim e duração.');
      return;
    }

    setSalvandoTurma(true);
    try {
      await addDoc(collection(db, 'turmas'), {
        local: novaTurma.local,
        instrumento: novaTurma.instrumento,
        dia: novaTurma.dia.trim(),
        horarios,
        criadoEm: new Date().toISOString()
      });
      setNovaTurma({ local: novaTurma.local, instrumento: novaTurma.instrumento, dia: '', inicio: '', fim: '', duracao: 40 });
    } catch (err) {
      console.error('Erro ao criar turma:', err);
      setErroTurma('Erro ao salvar a turma. Tente novamente.');
    } finally {
      setSalvandoTurma(false);
    }
  };

  const removerTurma = async (turmaId) => {
    if (!window.confirm('Remover essa turma da grade? Os alunos já agendados nela continuam com o agendamento deles, só deixa de aparecer como opção pra novos cadastros.')) return;
    try {
      await deleteDoc(doc(db, 'turmas', turmaId));
    } catch (err) {
      console.error('Erro ao remover turma:', err);
      alert('Erro ao remover a turma.');
    }
  };

  // Remove só UM horário específico de dentro de uma turma que tem vários horários
  // gerados (ex: excluir só o bloco das 08:40 de uma turma que vai das 08:00 às 13:20).
  // Se era o último horário da turma, apaga a turma inteira em vez de deixar ela vazia.
  const removerHorarioDaTurma = async (turma, valorHorario) => {
    const alvo = (turma.horarios || []).find(h => h.value === valorHorario);
    const idVaga = `vaga-${turma.local}-${turma.instrumento}-${turma.dia}-${valorHorario}`;
    const ocupado = vagasOcupadas.includes(idVaga);
    const aviso = ocupado
      ? `O horário ${alvo?.label || valorHorario} já tem um aluno agendado. O agendamento dele continua valendo, mas esse horário deixa de aparecer pra novos cadastros. Remover mesmo assim?`
      : `Remover o horário ${alvo?.label || valorHorario} de "${turma.dia}"?`;
    if (!window.confirm(aviso)) return;

    const novosHorarios = (turma.horarios || []).filter(h => h.value !== valorHorario);
    try {
      if (novosHorarios.length === 0) {
        await deleteDoc(doc(db, 'turmas', turma.id));
      } else {
        await updateDoc(doc(db, 'turmas', turma.id), { horarios: novosHorarios });
      }
    } catch (err) {
      console.error('Erro ao remover horário da turma:', err);
      alert('Erro ao remover o horário.');
    }
  };

  // Popula a coleção "turmas" com a grade original (só útil na primeira vez, ou
  // pra recriar algo que foi apagado por engano) — nunca duplica o que já existe.
  const restaurarGradePadrao = async () => {
    const faltando = GRADE_PADRAO.filter(def =>
      !turmasCadastradas.some(t => t.local === def.local && t.instrumento === def.instrumento && t.dia === def.dia)
    );
    if (faltando.length === 0) {
      alert('A grade padrão já está toda cadastrada.');
      return;
    }
    if (!window.confirm(`Isso vai criar ${faltando.length} turma(s) da grade padrão que ainda não existem. Continuar?`)) return;
    try {
      for (const def of faltando) {
        await addDoc(collection(db, 'turmas'), {
          local: def.local,
          instrumento: def.instrumento,
          dia: def.dia,
          horarios: def.horarios,
          criadoEm: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error('Erro ao restaurar grade padrão:', err);
      alert('Erro ao restaurar a grade padrão.');
    }
  };

  // Lista final de polos: começa dos polos padrão (fixos no código, sempre existem,
  // nunca somem por falta de dado no Firestore) e aplica por cima o que estiver salvo
  // na coleção "polos" — uma edição de nome/descrição de um polo padrão, uma marca de
  // "removido" nele, ou um polo novo criado pelo admin (id que não é dos padrão).
  // Assim, se a coleção "polos" estiver vazia (app recém-publicado, ninguém clicou em
  // nada ainda), os três polos de sempre continuam aparecendo — nada desaparece.
  const idsPadrao = new Set(POLOS_PADRAO.map(def => def.id));
  const LOCALIZACOES = [
    ...POLOS_PADRAO
      .map(def => {
        const salvo = polosCadastrados.find(p => p.id === def.id);
        if (salvo?.removido) return null;
        return salvo
          ? { id: def.id, nome: salvo.nome ?? def.nome, descricao: salvo.descricao ?? def.descricao, dataInicioAulas: salvo.dataInicioAulas ?? def.dataInicioAulas ?? '', integrantesBanda: salvo.integrantesBanda ?? def.integrantesBanda ?? [] }
          : { ...def, dataInicioAulas: def.dataInicioAulas ?? '', integrantesBanda: def.integrantesBanda ?? [] };
      })
      .filter(Boolean),
    ...polosCadastrados
      .filter(p => !idsPadrao.has(p.id) && !p.removido)
      .map(p => ({ id: p.id, nome: p.nome, descricao: p.descricao, dataInicioAulas: p.dataInicioAulas ?? '', integrantesBanda: p.integrantesBanda ?? [] }))
  ];

  // Cria um novo polo (local de ensino) — só o admin consegue (regra do Firestore).
  // O id do documento é um "slug" gerado do nome (ex: "Praia Bonita" -> "praiabonita"),
  // no mesmo padrão dos polos que já existem, pra ficar compatível com o campo "local"
  // usado em turmas e agendamentos.
  const adicionarPolo = async (e) => {
    e.preventDefault();
    setErroPolo('');

    const nome = novoPolo.nome.trim();
    if (!nome) {
      setErroPolo('Preencha o nome do polo.');
      return;
    }
    let id = slugificarPolo(nome);
    if (!id) {
      setErroPolo('Esse nome não gera um identificador válido — use letras ou números.');
      return;
    }
    const idsExistentes = new Set([...idsPadrao, ...polosCadastrados.map(p => p.id)]);
    if (idsExistentes.has(id)) {
      let sufixo = 2;
      while (idsExistentes.has(`${id}${sufixo}`)) sufixo++;
      id = `${id}${sufixo}`;
    }

    setSalvandoPolo(true);
    try {
      await setDoc(doc(db, 'polos', id), {
        nome,
        descricao: novoPolo.descricao.trim(),
        dataInicioAulas: novoPolo.dataInicioAulas || '',
        criadoEm: new Date().toISOString()
      });
      setNovoPolo({ nome: '', descricao: '', dataInicioAulas: '' });
    } catch (err) {
      console.error('Erro ao criar polo:', err);
      setErroPolo('Erro ao salvar o polo. Tente novamente.');
    } finally {
      setSalvandoPolo(false);
    }
  };

  const iniciarEdicaoPolo = (polo) => setEditandoPolo({ id: polo.id, nome: polo.nome, descricao: polo.descricao || '', dataInicioAulas: polo.dataInicioAulas || '' });
  const cancelarEdicaoPolo = () => setEditandoPolo(null);

  // Usa setDoc com merge (em vez de updateDoc) porque um polo padrão pode ainda não
  // ter documento nenhum no Firestore — updateDoc daria erro "no document to update"
  // na primeira edição dele. Com merge, cria se não existir e atualiza se já existir.
  const salvarEdicaoPolo = async (e) => {
    e.preventDefault();
    if (!editandoPolo.nome.trim()) return;
    try {
      await setDoc(doc(db, 'polos', editandoPolo.id), {
        nome: editandoPolo.nome.trim(),
        descricao: editandoPolo.descricao.trim(),
        dataInicioAulas: editandoPolo.dataInicioAulas || ''
      }, { merge: true });
      setEditandoPolo(null);
    } catch (err) {
      console.error('Erro ao editar polo:', err);
      alert('Erro ao salvar as alterações do polo.');
    }
  };

  // Um polo criado pelo admin (não é dos padrão) pode ser apagado de verdade — não
  // existe em outro lugar. Já um polo padrão precisa de uma "marca" (removido: true)
  // em vez de apagar, porque ele reapareceria de novo pelo POLOS_PADRAO no próximo
  // carregamento se só apagássemos o documento (ou se nunca existiu documento).
  const removerPolo = async (polo) => {
    const turmasDoPolo = turmasCadastradas.filter(t => t.local === polo.id);
    const aviso = turmasDoPolo.length > 0
      ? `Esse polo tem ${turmasDoPolo.length} turma(s) na grade de horários e pode ter alunos já agendados nele. Remover o polo NÃO apaga as turmas nem os agendamentos — eles só ficam "órfãos" (sem o nome do polo aparecendo certo). O recomendado é remover as turmas desse polo primeiro, na seção "Grade de Horários" abaixo. Remover o polo "${polo.nome}" mesmo assim?`
      : `Remover o polo "${polo.nome}"?`;
    if (!window.confirm(aviso)) return;
    try {
      if (idsPadrao.has(polo.id)) {
        await setDoc(doc(db, 'polos', polo.id), { removido: true }, { merge: true });
      } else {
        await deleteDoc(doc(db, 'polos', polo.id));
      }
    } catch (err) {
      console.error('Erro ao remover polo:', err);
      alert('Erro ao remover o polo.');
    }
  };

  // Desfaz qualquer edição/remoção feita nos polos padrão, voltando ao nome/descrição
  // original do código — apaga o documento de "override" deles no Firestore, se existir.
  const restaurarPolosPadrao = async () => {
    const alterados = POLOS_PADRAO.filter(def => polosCadastrados.some(p => p.id === def.id));
    if (alterados.length === 0) {
      alert('Os polos padrão já estão todos no estado original.');
      return;
    }
    if (!window.confirm(`Isso vai desfazer edições/remoções feitas nos polos padrão (${alterados.map(a => a.nome).join(', ')}), voltando ao nome e descrição originais. Continuar?`)) return;
    try {
      for (const def of alterados) {
        await deleteDoc(doc(db, 'polos', def.id));
      }
    } catch (err) {
      console.error('Erro ao restaurar polos padrão:', err);
      alert('Erro ao restaurar os polos padrão.');
    }
  };

  // --- Integrantes da Turma de Banda (aba "Banda") ---
  // Guardados como um array direto no documento do POLO ("integrantesBanda"), não no
  // cadastro do aluno — é uma lista de gestão própria (nome + função), separada do
  // cadastro normal, e assim aparece de graça no Portal do Aluno e no Portal da Igreja
  // sem precisar de nenhuma regra nova do Firestore (polos já é público pra leitura).
  // O Firestore não permite atualizar só 1 item de dentro de um array — por isso toda
  // alteração reescreve o array inteiro (usando o que já está carregado no estado).
  const adicionarIntegranteBanda = async (poloId, nome, funcao) => {
    const nomeLimpo = (nome || '').trim();
    if (!nomeLimpo) {
      alert('Digite o nome do integrante antes de adicionar.');
      return;
    }
    const atual = LOCALIZACOES.find(l => l.id === poloId)?.integrantesBanda || [];
    const novoIntegrante = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, nome: nomeLimpo, funcao: funcao || FUNCOES_BANDA[0] };
    try {
      await setDoc(doc(db, 'polos', poloId), { integrantesBanda: [...atual, novoIntegrante] }, { merge: true });
    } catch (err) {
      console.error('Erro ao adicionar integrante da banda:', err);
      alert('Erro ao adicionar esse integrante.');
    }
  };

  const alterarIntegranteBanda = async (poloId, integranteId, campo, valor) => {
    const atual = LOCALIZACOES.find(l => l.id === poloId)?.integrantesBanda || [];
    const atualizado = atual.map(integrante => integrante.id === integranteId ? { ...integrante, [campo]: valor } : integrante);
    try {
      await setDoc(doc(db, 'polos', poloId), { integrantesBanda: atualizado }, { merge: true });
    } catch (err) {
      console.error('Erro ao alterar integrante da banda:', err);
      alert('Erro ao salvar essa alteração.');
    }
  };

  const removerIntegranteBanda = async (poloId, integranteId) => {
    const atual = LOCALIZACOES.find(l => l.id === poloId)?.integrantesBanda || [];
    try {
      await setDoc(doc(db, 'polos', poloId), { integrantesBanda: atual.filter(integrante => integrante.id !== integranteId) }, { merge: true });
    } catch (err) {
      console.error('Erro ao remover integrante da banda:', err);
      alert('Erro ao remover esse integrante.');
    }
  };

  // --- Igrejas (mantenedoras de pacote) ---
  // Não existe "igreja padrão" nem tombstone aqui (diferente de Polos) — toda igreja
  // cadastrada foi criada pela tela, então criar/editar/remover são operações diretas.
  const adicionarIgreja = async (e) => {
    e.preventDefault();
    setErroIgreja('');

    const nome = novaIgreja.nome.trim();
    if (!nome) {
      setErroIgreja('Preencha o nome da igreja.');
      return;
    }
    if (!novaIgreja.poloId) {
      setErroIgreja('Escolha a qual polo essa igreja está vinculada.');
      return;
    }
    let id = slugificarPolo(nome);
    if (!id) {
      setErroIgreja('Esse nome não gera um identificador válido — use letras ou números.');
      return;
    }
    const idsExistentes = new Set(igrejasCadastradas.map(i => i.id));
    if (idsExistentes.has(id)) {
      let sufixo = 2;
      while (idsExistentes.has(`${id}${sufixo}`)) sufixo++;
      id = `${id}${sufixo}`;
    }

    setSalvandoIgreja(true);
    try {
      await setDoc(doc(db, 'igrejas', id), {
        nome,
        poloId: novaIgreja.poloId,
        responsavel: novaIgreja.responsavel.trim(),
        telefone: novaIgreja.telefone.trim(),
        criadoEm: new Date().toISOString()
      });
      setNovaIgreja({ nome: '', poloId: '', responsavel: '', telefone: '' });
    } catch (err) {
      console.error('Erro ao criar igreja:', err);
      setErroIgreja('Erro ao salvar a igreja. Tente novamente.');
    } finally {
      setSalvandoIgreja(false);
    }
  };

  const iniciarEdicaoIgreja = (igreja) => setEditandoIgreja({
    id: igreja.id,
    nome: igreja.nome,
    poloId: igreja.poloId || '',
    responsavel: igreja.responsavel || '',
    telefone: igreja.telefone || ''
  });
  const cancelarEdicaoIgreja = () => setEditandoIgreja(null);

  const salvarEdicaoIgreja = async (e) => {
    e.preventDefault();
    if (!editandoIgreja.nome.trim() || !editandoIgreja.poloId) return;
    try {
      await updateDoc(doc(db, 'igrejas', editandoIgreja.id), {
        nome: editandoIgreja.nome.trim(),
        poloId: editandoIgreja.poloId,
        responsavel: editandoIgreja.responsavel.trim(),
        telefone: editandoIgreja.telefone.trim()
      });
      setEditandoIgreja(null);
    } catch (err) {
      console.error('Erro ao editar igreja:', err);
      alert('Erro ao salvar as alterações da igreja.');
    }
  };

  const removerIgreja = async (igreja) => {
    if (!window.confirm(`Remover o cadastro da igreja "${igreja.nome}"? Isso não apaga alunos, turmas nem o polo — só remove esse cadastro de cobrança.`)) return;
    try {
      await deleteDoc(doc(db, 'igrejas', igreja.id));
    } catch (err) {
      console.error('Erro ao remover igreja:', err);
      alert('Erro ao remover a igreja.');
    }
  };

  // Ativa a cobrança em pacote de um polo direto pela aba Pagamentos, sem precisar ir na
  // aba Igrejas primeiro — cria um cadastro de igreja "mínimo" (só nome e polo) que já
  // libera forma/data/valor/status/recibo nesse card. Responsável e telefone ficam em
  // branco e podem ser preenchidos depois, editando essa igreja normalmente na aba Igrejas.
  const criarRegistroPacotePolo = async (polo) => {
    let id = slugificarPolo(polo.nome) || polo.id;
    const idsExistentes = new Set(igrejasCadastradas.map(i => i.id));
    if (idsExistentes.has(id)) {
      let sufixo = 2;
      while (idsExistentes.has(`${id}${sufixo}`)) sufixo++;
      id = `${id}${sufixo}`;
    }
    try {
      await setDoc(doc(db, 'igrejas', id), {
        nome: polo.nome,
        poloId: polo.id,
        responsavel: '',
        telefone: '',
        criadoEm: new Date().toISOString()
      });
    } catch (err) {
      console.error('Erro ao ativar pagamento do polo:', err);
      alert('Erro ao ativar o pagamento desse polo. Tente novamente.');
    }
  };

  // Valor combinado da igreja: é a cobrança ÚNICA que vira o Pix do polo inteiro —
  // completamente separado do "Valor combinado" de cada aluno na aba Pagamentos, que
  // continua existindo e funcionando do jeito que já funcionava.
  const alterarValorCombinadoIgreja = async (id, novoValor) => {
    try {
      const valor = novoValor === '' ? null : Number(novoValor);
      await updateDoc(doc(db, 'igrejas', id), { valorCombinado: valor });
    } catch (err) {
      console.error('Erro ao alterar valor combinado da igreja:', err);
      alert('Erro ao salvar o valor combinado.');
    }
  };

  const alterarFormaPagamentoIgreja = async (id, novaForma) => {
    try {
      await updateDoc(doc(db, 'igrejas', id), { formaPagamento: novaForma });
    } catch (err) {
      console.error('Erro ao alterar forma de pagamento da igreja:', err);
      alert('Erro ao alterar a forma de pagamento.');
    }
  };

  const alterarDataPagamentoIgreja = async (id, novaData) => {
    try {
      await updateDoc(doc(db, 'igrejas', id), { dataPagamento: novaData });
    } catch (err) {
      console.error('Erro ao alterar data de pagamento da igreja:', err);
      alert('Erro ao alterar a data de pagamento.');
    }
  };

  const alternarPagamentoIgreja = async (id, statusAtual) => {
    try {
      await updateDoc(doc(db, 'igrejas', id), { pago: !statusAtual });
    } catch (err) {
      console.error('Erro ao atualizar pagamento da igreja:', err);
    }
  };

  // Parcelas de pacotes divididos (hoje só Água Limpa, em 2x — ver PARCELAS_POR_POLO):
  // cada parcela tem seu próprio valor/data/status, guardados em campos separados
  // (parcela1Valor, parcela1Pago, parcela1DataPagamento, parcela2Valor, ...) em vez de uma
  // lista, porque o Firestore não permite atualizar só 1 item de dentro de um array — e
  // esses campos ficam parados (sem uso) em qualquer polo com 1 parcela só (integral).
  const alterarValorParcelaIgreja = async (id, numeroParcela, novoValor) => {
    try {
      const valor = novoValor === '' ? null : Number(novoValor);
      await updateDoc(doc(db, 'igrejas', id), { [`parcela${numeroParcela}Valor`]: valor });
    } catch (err) {
      console.error('Erro ao alterar valor da parcela:', err);
      alert('Erro ao salvar o valor dessa parcela.');
    }
  };

  const alterarDataPagamentoParcelaIgreja = async (id, numeroParcela, novaData) => {
    try {
      await updateDoc(doc(db, 'igrejas', id), { [`parcela${numeroParcela}DataPagamento`]: novaData });
    } catch (err) {
      console.error('Erro ao alterar data de pagamento da parcela:', err);
      alert('Erro ao alterar a data de pagamento.');
    }
  };

  const alternarPagamentoParcelaIgreja = async (id, numeroParcela, statusAtual) => {
    try {
      await updateDoc(doc(db, 'igrejas', id), { [`parcela${numeroParcela}Pago`]: !statusAtual });
    } catch (err) {
      console.error('Erro ao atualizar pagamento da parcela:', err);
    }
  };

  // Cria (ou redefine a senha de) o login do Portal da Igreja — feito por você, aqui na
  // aba Igrejas. Passa por uma função serverless (não mexe direto no Firebase Auth
  // daqui do navegador) porque criar uma conta pelo front-end loga automaticamente COMO
  // essa conta nova — isso derrubaria a SUA sessão de admin no meio do cadastro. Feito
  // no back-end, sua sessão continua intacta e a igreja recebe um e-mail/senha próprios.
  //
  // Sempre que você mudar o polo de uma igreja que já tem acesso criado, clique em
  // "Redefinir senha" de novo (mesmo sem trocar a senha) — é isso que atualiza, por
  // baixo dos panos, qual polo essa conta pode enxergar.
  const criarOuRedefinirAcessoIgreja = async (igreja, e) => {
    e.preventDefault();
    setErroAcessoIgreja('');
    const email = formAcessoIgreja.email.trim();
    const senha = formAcessoIgreja.senha;
    if (!email || !senha) {
      setErroAcessoIgreja('Preencha e-mail e senha pra criar o acesso.');
      return;
    }
    if (senha.length < 6) {
      setErroAcessoIgreja('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    setSalvandoAcessoIgreja(true);
    try {
      const idToken = await usuario.getIdToken();
      const resposta = await fetch('/api/igrejas/criar-acesso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ igrejaId: igreja.id, email, senha })
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        throw new Error(dados?.erro || 'Não foi possível criar o acesso agora.');
      }
      setAcessoIgrejaAberto(null);
      setFormAcessoIgreja({ email: '', senha: '' });
      setMensagemSucesso(`Acesso da igreja "${igreja.nome}" salvo! Repasse o e-mail e a senha pra ela entrar no "Portal da Igreja".`);
      setTimeout(() => setMensagemSucesso(''), 8000);
    } catch (err) {
      console.error('Erro ao criar acesso da igreja:', err);
      setErroAcessoIgreja(err.message || 'Erro ao criar o acesso. Tente novamente.');
    } finally {
      setSalvandoAcessoIgreja(false);
    }
  };

  // Gera o Pix da igreja — chamado pelo admin OU pela própria igreja logada no Portal da
  // Igreja. Usa a mesma função serverless /api/mercadopago/criar-pix, mandando igrejaId
  // em vez de agendamentoId, pra distinguir os dois casos no back-end.
  const gerarPixIgreja = async (igreja) => {
    setErroPixIgreja('');
    setDadosPixIgreja(null);
    setGerandoPixIgreja(true);
    try {
      const idToken = await usuario.getIdToken();
      const resposta = await fetch('/api/mercadopago/criar-pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ igrejaId: igreja.id, email: usuario.email })
      });
      const dados = await resposta.json();
      if (!resposta.ok) {
        throw new Error(dados?.erro || 'Não foi possível gerar o Pix agora.');
      }
      setDadosPixIgreja(dados);
      setIgrejaComPixAberto(igreja.id);
    } catch (err) {
      console.error('Erro ao gerar Pix da igreja:', err);
      setErroPixIgreja(err.message || 'Não foi possível gerar o Pix agora. Tente novamente em instantes.');
    } finally {
      setGerandoPixIgreja(false);
    }
  };

  // Baixa um arquivo .json com uma foto de tudo que está carregado agora (alunos,
  // turmas, polos e vagas ocupadas) — não faz nenhuma leitura extra no Firestore, só
  // empacota o que os listeners já trouxeram. Serve de segurança antes de qualquer
  // mudança grande (trocar grade, importar planilha, editar/remover um polo etc.).
  const fazerBackup = () => {
    const backup = {
      geradoEm: new Date().toISOString(),
      agendamentos,
      turmas: turmasCadastradas,
      polos: polosCadastrados,
      vagasOcupadas
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dataFormatada = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `backup-acordes-de-davi-${dataFormatada}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const agendamentosFiltrados = agendamentos.filter(item => {
    const matchLocal = filtroLocal === 'todos' || item.local === filtroLocal;
    const matchInst = filtroInstrumento === 'todos' || item.instrumento === filtroInstrumento;
    return matchLocal && matchInst;
  });

  // Agrupa os alunos por nome + telefone normalizados (sem acento/espaço/maiúscula) e
  // devolve só os grupos com mais de um registro — candidatos a cadastro duplicado.
  // Só compara quando os dois campos existem, pra não arriscar juntar duas pessoas
  // diferentes que só têm o nome parecido e nenhum telefone cadastrado.
  //
  // Um grupo some do aviso quando TODOS os registros dele já foram aprovados (campo
  // duplicadoAprovado) — é o "aval" de que não é duplicado de verdade, e sim o mesmo
  // aluno com 2 aulas por semana em dias diferentes. Se aparecer um 3º registro novo
  // desse mesmo aluno depois, o grupo volta a aparecer (porque nem todos estão
  // aprovados ainda) — é só clicar em aprovar de novo que ele inclui o novo também.
  const gruposDuplicados = useMemo(() => {
    const mapa = new Map();
    agendamentos.forEach(item => {
      const chaveNome = normalizarTexto(item.nome);
      const chaveTelefone = normalizarTexto(item.telefone);
      if (!chaveNome || !chaveTelefone) return;
      const chave = `${chaveNome}|${chaveTelefone}`;
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave).push(item);
    });
    return Array.from(mapa.values()).filter(grupo => grupo.length > 1 && !grupo.every(item => item.duplicadoAprovado));
  }, [agendamentos]);

  // "Aval" do admin: marca esse grupo como aulas diferentes de propósito (não duplicado),
  // sem excluir nenhum registro — só some o aviso da lista.
  const aprovarGrupoDuplicado = async (grupo) => {
    try {
      await Promise.all(
        grupo.map(item => updateDoc(doc(db, 'agendamentos', item.id), { duplicadoAprovado: true }))
      );
    } catch (err) {
      console.error('Erro ao aprovar grupo como não-duplicado:', err);
      alert('Erro ao salvar essa aprovação. Tente novamente.');
    }
  };

  // Instrumentos que realmente têm turma cadastrada no polo escolhido (grade vem do Firestore agora)
  const instrumentosDoPolo = INSTRUMENTOS.filter(inst =>
    turmasCadastradas.some(t => t.local === poloSelecionado && t.instrumento === inst.id)
  );

  // Todas as vagas (horário a horário) do polo + instrumento escolhidos, já marcando as ocupadas
  const vagasDisponiveis = useMemo(() => {
    const lista = [];
    turmasCadastradas
      .filter(t => t.local === poloSelecionado && t.instrumento === instrumentoSelecionado)
      .forEach(t => {
        (t.horarios || []).forEach(h => {
          const id = `vaga-${t.local}-${t.instrumento}-${t.dia}-${h.value}`;
          lista.push({
            id,
            dia: t.dia,
            horario: h.value,
            horarioLabel: h.label,
            ocupada: vagasOcupadas.includes(id)
          });
        });
      });
    return lista;
  }, [poloSelecionado, instrumentoSelecionado, vagasOcupadas, turmasCadastradas]);

  // Agrupa as vagas por dia, pra exibir em blocos na tela de agendamento
  const vagasPorDia = vagasDisponiveis.reduce((acc, vaga) => {
    if (!acc[vaga.dia]) acc[vaga.dia] = [];
    acc[vaga.dia].push(vaga);
    return acc;
  }, {});

  // Verifica, pra um polo específico, se todas as vagas de todas as turmas dele estão ocupadas.
  const poloEstaLotado = (localId) => {
    const turmasDoLocal = turmasCadastradas.filter(t => t.local === localId);
    if (turmasDoLocal.length === 0) return false;
    return turmasDoLocal.every(t =>
      (t.horarios || []).every(h => {
        const id = `vaga-${t.local}-${t.instrumento}-${t.dia}-${h.value}`;
        return vagasOcupadas.includes(id);
      })
    );
  };

  // Relatório de vagas livres em TODA a grade (todos os polos e instrumentos, não só o
  // que o aluno estiver escolhendo no momento) — é o que alimenta a aba "Vagas" do admin,
  // pra você saber rapidinho onde ainda tem espaço aberto e poder divulgar/oferecer.
  const relatorioVagas = useMemo(() => {
    const porPolo = {};
    let totalVagas = 0;
    let totalLivres = 0;

    turmasCadastradas.forEach((t) => {
      if (!porPolo[t.local]) {
        porPolo[t.local] = { total: 0, livres: 0, porInstrumento: {} };
      }
      if (!porPolo[t.local].porInstrumento[t.instrumento]) {
        porPolo[t.local].porInstrumento[t.instrumento] = { total: 0, livres: 0, vagasLivres: [] };
      }
      const bucketInstrumento = porPolo[t.local].porInstrumento[t.instrumento];

      (t.horarios || []).forEach((h) => {
        const id = `vaga-${t.local}-${t.instrumento}-${t.dia}-${h.value}`;
        const livre = !vagasOcupadas.includes(id);

        totalVagas++;
        porPolo[t.local].total++;
        bucketInstrumento.total++;
        if (livre) {
          totalLivres++;
          porPolo[t.local].livres++;
          bucketInstrumento.livres++;
          bucketInstrumento.vagasLivres.push({ dia: t.dia, horarioLabel: h.label });
        }
      });
    });

    return { porPolo, totalVagas, totalLivres };
  }, [turmasCadastradas, vagasOcupadas]);

  // Relatório financeiro (aba "Financeiro") — cruza cada conta (aluno individual ou
  // igreja/pacote) com o vencimento calculado automaticamente (ver comentário grande
  // acima de calcularVencimentoPeriodico) e separa em Pago / Pendente / Atrasado / Sem
  // dados suficientes pra calcular (polo sem "Data de início das aulas" definida, turma
  // com "dia" que o sistema não conseguiu interpretar, ou pacote sem conta de igreja
  // vinculada ainda na aba Igrejas).
  const relatorioFinanceiro = useMemo(() => {
    const linhas = [];

    // Alunos individuais
    agendamentos
      .filter(item => (item.tipoPagamento || 'pacote') === 'individual')
      .forEach(item => {
        const polo = LOCALIZACOES.find(l => l.id === item.local);
        const valor = Number(item.valorCombinado) || 0;
        let status = 'semDados';
        let vencimento = null;
        let motivo = !polo?.dataInicioAulas
          ? 'Falta definir a "Data de início das aulas" desse polo na aba Horários.'
          : 'A turma desse aluno tem um "dia" que o sistema não conseguiu reconhecer (ou a grade é curta demais pra alcançar a 1ª cobrança dentro de 5 meses).';

        if (item.pago) {
          status = 'pago';
        } else if (polo?.dataInicioAulas) {
          const calculo = calcularVencimentoPorAulas({ dia: item.dia }, polo.dataInicioAulas, 5);
          if (calculo) {
            vencimento = calculo.vencimento;
            status = calculo.passadoAlgum ? 'atrasado' : 'pendente';
          }
        }

        linhas.push({ tipo: 'individual', nome: item.nome, local: polo?.nome || item.local, valor, vencimento, status, motivo });
      });

    // Pacote/igreja — um item por polo que tenha pelo menos um aluno em pacote,
    // igual à aba Pagamentos já faz (o valor/pago fica no documento da igreja, não no
    // aluno individualmente).
    const polosComPacote = new Set(
      agendamentos
        .filter(item => (item.tipoPagamento || 'pacote') !== 'individual')
        .map(item => item.local)
    );

    polosComPacote.forEach((localId) => {
      const polo = LOCALIZACOES.find(l => l.id === localId);
      const igrejaDoPolo = igrejasCadastradas.find(i => i.poloId === localId);

      if (!igrejaDoPolo) {
        linhas.push({
          tipo: 'pacote',
          nome: polo?.nome || localId,
          local: polo?.nome || localId,
          valor: 0,
          vencimento: null,
          status: 'semDados',
          motivo: 'Falta criar o acesso dessa igreja na aba Igrejas (é lá que fica o valor combinado e o status de pago).'
        });
        return;
      }

      const numParcelas = numParcelasDoPolo(localId);

      if (numParcelas <= 1) {
        // Comportamento de sempre — 1 conta só por polo, sem regressão.
        const valor = Number(igrejaDoPolo?.valorCombinado) || 0;
        let status = 'semDados';
        let vencimento = null;
        const motivo = 'Falta definir a "Data de início das aulas" desse polo na aba Horários.';

        if (igrejaDoPolo.pago) {
          status = 'pago';
        } else if (polo?.dataInicioAulas) {
          const calculo = calcularVencimentoPeriodico(polo.dataInicioAulas, 14);
          if (calculo) {
            vencimento = calculo.vencimento;
            status = calculo.passadoAlgum ? 'atrasado' : 'pendente';
          }
        }

        linhas.push({ tipo: 'pacote', nome: igrejaDoPolo.nome || polo?.nome || localId, local: polo?.nome || localId, valor, vencimento, status, motivo });
        return;
      }

      // Pacote dividido em parcelas (ex: Água Limpa, 2x): cada parcela é uma conta
      // independente, com seu próprio valor/status/vencimento. Cada parcela recorre a
      // cada 28 dias (mensal), deslocada (numeroParcela - 1) x 14 dias da 1ª — assim, no
      // total, cai uma cobrança a cada quinzena, como foi combinado.
      for (let n = 1; n <= numParcelas; n++) {
        const valorBrutoParcela = igrejaDoPolo[`parcela${n}Valor`];
        const valor = (valorBrutoParcela != null && valorBrutoParcela !== '')
          ? Number(valorBrutoParcela)
          : (Number(igrejaDoPolo?.valorCombinado) || 0) / numParcelas;
        let status = 'semDados';
        let vencimento = null;
        const motivo = 'Falta definir a "Data de início das aulas" desse polo na aba Horários.';

        if (igrejaDoPolo[`parcela${n}Pago`]) {
          status = 'pago';
        } else if (polo?.dataInicioAulas) {
          const calculo = calcularVencimentoPeriodico(polo.dataInicioAulas, 28, (n - 1) * 14);
          if (calculo) {
            vencimento = calculo.vencimento;
            status = calculo.passadoAlgum ? 'atrasado' : 'pendente';
          }
        }

        linhas.push({
          tipo: 'pacote',
          nome: `${igrejaDoPolo.nome || polo?.nome || localId} — Parcela ${n}/${numParcelas}`,
          local: polo?.nome || localId,
          valor,
          vencimento,
          status,
          motivo
        });
      }
    });

    const porStatus = { pago: [], pendente: [], atrasado: [], semDados: [] };
    linhas.forEach((linha) => porStatus[linha.status].push(linha));
    Object.values(porStatus).forEach((lista) => lista.sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || '')));

    const somaValor = (lista) => lista.reduce((soma, l) => soma + l.valor, 0);

    return {
      pago: { itens: porStatus.pago, total: somaValor(porStatus.pago) },
      pendente: { itens: porStatus.pendente, total: somaValor(porStatus.pendente) },
      atrasado: { itens: porStatus.atrasado, total: somaValor(porStatus.atrasado) },
      semDados: { itens: porStatus.semDados, total: somaValor(porStatus.semDados) }
    };
  }, [agendamentos, igrejasCadastradas]);

  // Agendamentos do próprio aluno logado (as regras do Firestore já garantem
  // que "agendamentos" só traz os dele quando não é admin, mas filtramos de novo por clareza)
  const meusAgendamentos = usuario ? agendamentos.filter(item => item.uid === usuario.uid) : [];

  // Igreja logada no Portal da Igreja e os alunos do polo que ela mantém — as regras do
  // Firestore já garantem que "agendamentos" só traz os alunos daquele polo pra essa
  // conta (nunca os alunos de outro polo), igual já acontece pro aluno individual.
  // ("minhaIgreja" agora é calculado bem mais acima, junto com "souAdmin"/"souIgreja",
  // porque o efeito que busca agendamentos/presenças/avaliações precisa dele.)
  const meusAlunosIgreja = minhaIgreja ? agendamentos.filter(item => item.local === minhaIgreja.poloId) : [];

  // Assim que o webhook do Mercado Pago confirmar o pagamento (marcando "pago" no
  // Firestore), o onSnapshot dos agendamentos já traz isso em tempo real — então só
  // fecha sozinho a tela do QR Code do Pix quando detectar que aquele agendamento virou
  // pago, sem precisar o aluno recarregar a página.
  useEffect(() => {
    if (!pixEmAndamento) return;
    const item = agendamentos.find(a => a.id === pixEmAndamento);
    if (item && item.pago) {
      setPixEmAndamento(null);
      setDadosPix(null);
    }
  }, [agendamentos, pixEmAndamento]);

  // Mesma lógica de fechar sozinho, só que pro Pix da igreja (fecha quando o webhook
  // marcar aquela igreja como paga).
  useEffect(() => {
    if (!igrejaComPixAberto) return;
    const igreja = igrejasCadastradas.find(i => i.id === igrejaComPixAberto);
    if (igreja && igreja.pago) {
      setIgrejaComPixAberto(null);
      setDadosPixIgreja(null);
    }
  }, [igrejasCadastradas, igrejaComPixAberto]);

  // Assim que os dados do proprietário chegarem do Firestore, preenche o formulário
  // da aba Configurações com eles (pra você ver o que já está salvo ao abrir a aba).
  useEffect(() => {
    setFormProprietario({
      nome: dadosProprietario.nome,
      cpf: dadosProprietario.cpf,
      endereco: dadosProprietario.endereco
    });
  }, [dadosProprietario.nome, dadosProprietario.cpf, dadosProprietario.endereco]);

  // Card de pagamento de UM aluno — usado tanto pros alunos individuais quanto pros
  // alunos em pacote na aba Pagamentos, pra mostrar sempre os mesmos campos (tipo,
  // forma, data, valor combinado e status) nos dois casos, com o mesmo visual.
  // É uma função comum (não um componente à parte) de propósito: assim o React não
  // recria/perde o foco dos campos a cada letra digitada.
  const renderCardPagamento = (item) => (
    <div key={item.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
      <div>
        <h3 className="font-bold text-slate-800 text-base">{item.nome}</h3>
        <p className="text-xs text-slate-500 mt-0.5 uppercase">{LOCALIZACOES.find(l => l.id === item.local)?.nome} - {item.instrumento}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Tipo</label>
          <select
            value={item.tipoPagamento || 'pacote'}
            onChange={(e) => alterarTipoPagamento(item.id, e.target.value)}
            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
          >
            <option value="pacote">Pacote</option>
            <option value="individual">Individual</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Forma</label>
          <select
            value={item.formaPagamento || 'pix'}
            onChange={(e) => alterarFormaPagamento(item.id, e.target.value)}
            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
          >
            <option value="pix">Pix</option>
            <option value="dinheiro">Dinheiro</option>
            <option value="outro">Outro</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Data do pagamento</label>
        <input
          type="date"
          value={item.dataPagamento || ''}
          onChange={(e) => alterarDataPagamento(item.id, e.target.value)}
          className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
        />
      </div>

      <div>
        <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Valor combinado (R$) — pro Pix online</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={item.valorCombinado ?? ''}
            onChange={(e) => alterarValorCombinado(item.id, e.target.value)}
            placeholder="0,00"
            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="button"
            onClick={() => alterarValorCombinado(item.id, String(valorSugeridoRecibo(item, LOCALIZACOES.find(l => l.id === item.local))))}
            className="shrink-0 text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 underline whitespace-nowrap"
          >
            usar sugestão
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-0.5">
          {item.valorCombinado ? 'O aluno já pode pagar esse valor pelo Portal do Aluno.' : 'Sem valor definido, o aluno não vê o botão de pagar online ainda.'}
        </p>
      </div>

      <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${item.pago ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {item.pago ? 'PAGO ✓' : 'PENDENTE ✕'}
        </span>
        <button
          onClick={() => alternarPagamento(item.id, item.pago)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${item.pago ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
        >
          {item.pago ? 'Marcar Pendente' : 'Marcar como Pago'}
        </button>
      </div>

      {item.dataPagamento && (
        (item.tipoPagamento || 'pacote') === 'individual' ? (
          <button
            onClick={() => abrirRecibo(item)}
            className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5" /> Gerar Recibo
          </button>
        ) : (
          <p className="text-[11px] text-slate-400 italic text-center">
            Pagamento em pacote — o recibo sai em nome da igreja mantenedora, na aba Igrejas.
          </p>
        )
      )}
    </div>
  );

  return (
    <>
      {mostrarVinheta && (
        <div className="fixed inset-0 z-[9999] bg-black flex items-center justify-center">
          <video
            ref={videoVinhetaRef}
            src="/vinheta-logo.mp4"
            playsInline
            onEnded={() => setMostrarVinheta(false)}
            onClick={() => {
              // Tocar em qualquer parte do vídeo também ativa o som — um clique
              // direto da pessoa sempre é permitido pelo navegador, mesmo quando
              // o autoplay com som (tentado sozinho no useEffect) foi bloqueado.
              if (videoVinhetaRef.current && videoVinhetaRef.current.muted) {
                videoVinhetaRef.current.muted = false;
                setSomVinhetaAtivado(true);
              }
            }}
            className="w-full h-full object-contain"
          />
          <button
            type="button"
            onClick={() => setMostrarVinheta(false)}
            className="absolute top-4 right-4 sm:top-6 sm:right-6 bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-full border border-white/30 transition backdrop-blur-sm"
          >
            Pular ›
          </button>
          {!somVinhetaAtivado && (
            <button
              type="button"
              onClick={() => {
                if (videoVinhetaRef.current) {
                  videoVinhetaRef.current.muted = false;
                }
                setSomVinhetaAtivado(true);
              }}
              className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold px-3 py-1.5 rounded-full border border-white/30 transition backdrop-blur-sm animate-pulse"
            >
              🔇 Ativar som
            </button>
          )}
        </div>
      )}
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <header className="bg-emerald-800 text-white shadow-md print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-3">
            <img src="/logo-acordes-de-davi.svg" alt="Logo Acordes de Davi" className="w-12 h-12 shrink-0 print:hidden" />
            <div>
              <h1 className="text-xl font-bold">Projeto Acordes de Davi</h1>
              <p className="text-xs text-emerald-200">Gestão, Frequência, Pagamentos e Certificados</p>
            </div>
          </div>
          <nav className="flex items-center gap-2 flex-wrap">
            <button 
              onClick={() => setAbaAtiva('painel')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'painel' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
            >
              Visão Geral
            </button>

            {souAdmin && (
              <>
                <button
                  onClick={() => setAbaAtiva('gerenciar')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'gerenciar' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <Settings className="w-4 h-4" /> Gestão
                </button>
                <button
                  onClick={() => setAbaAtiva('pauta')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'pauta' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <CheckSquare className="w-4 h-4" /> Chamada
                </button>
                <button
                  onClick={() => setAbaAtiva('pagamentos')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'pagamentos' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <DollarSign className="w-4 h-4" /> Pagamentos
                </button>
                <button
                  onClick={() => setAbaAtiva('certificados')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'certificados' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <Award className="w-4 h-4" /> Certificados
                </button>
                <button
                  onClick={() => setAbaAtiva('horarios')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'horarios' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <Clock className="w-4 h-4" /> Horários
                </button>
                <button
                  onClick={() => setAbaAtiva('vagas')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'vagas' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <ClipboardList className="w-4 h-4" /> Vagas
                </button>
                <button
                  onClick={() => setAbaAtiva('banda')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'banda' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <Users className="w-4 h-4" /> Banda
                </button>
                <button
                  onClick={() => setAbaAtiva('financeiro')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'financeiro' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <TrendingUp className="w-4 h-4" /> Financeiro
                </button>
                <button
                  onClick={() => setAbaAtiva('igrejas')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'igrejas' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <BookOpen className="w-4 h-4" /> Igrejas
                </button>
                <button
                  onClick={() => setAbaAtiva('materiais')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'materiais' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <Upload className="w-4 h-4" /> Materiais
                </button>
                <button
                  onClick={() => setAbaAtiva('configuracoes')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'configuracoes' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <Settings className="w-4 h-4" /> Configurações
                </button>
              </>
            )}

            <button
              onClick={() => setAbaAtiva('novo')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'novo' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
            >
              <PlusCircle className="w-4 h-4" /> Novo Cadastro
            </button>

            {souAluno && (
              <button
                onClick={() => setAbaAtiva('portal')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'portal' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
              >
                <User className="w-4 h-4" /> Meu Portal
              </button>
            )}

            {souIgreja && (
              <button
                onClick={() => setAbaAtiva('portalIgreja')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'portalIgreja' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
              >
                <BookOpen className="w-4 h-4" /> Portal da Igreja
              </button>
            )}

            {!souAluno && !souAdmin && !souIgreja && (
              <>
                <button
                  onClick={() => setAbaAtiva('loginAluno')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'loginAluno' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <LogIn className="w-4 h-4" /> Portal do Aluno
                </button>
                <button
                  onClick={() => setAbaAtiva('loginIgreja')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'loginIgreja' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <LogIn className="w-4 h-4" /> Portal da Igreja
                </button>
              </>
            )}

            {usuario && !usuario.isAnonymous ? (
              <button
                onClick={fazerLogout}
                className="flex items-center gap-1 bg-red-700 hover:bg-red-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition ml-2"
              >
                <LogOut className="w-4 h-4" /> Sair
              </button>
            ) : (
              <button
                onClick={() => setAbaAtiva('login')}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition ml-2 opacity-70 hover:opacity-100 ${abaAtiva === 'login' ? 'bg-emerald-900 text-white' : 'bg-emerald-700 hover:bg-emerald-600'}`}
                title="Acesso restrito à coordenação"
              >
                <LogIn className="w-3.5 h-3.5" /> Admin
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 print:p-0 print:max-w-none">
        {abaAtiva === 'painel' && (
          souAdmin ? (
            <div className="space-y-6">
              <div className="bg-white border-l-4 border-emerald-600 p-4 rounded-r-xl shadow-sm text-center">
                <p className="italic text-slate-700 font-medium">
                  "E sucedia que, quando o espírito maligno da parte de Deus vinha sobre Saul, Davi tomava a harpa, e a touxia com a sua mão; então Saul andava aliviado, e se sentia melhor, e o espírito maligno se retirava dele."
                </p>
                <span className="block mt-2 text-xs font-bold text-emerald-800 uppercase tracking-wide">1 Samuel 16:23</span>
              </div>

              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold text-slate-700">Alunos e Aulas Cadastradas</h2>
                <span className="text-xs bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-medium">
                  {agendamentos.length} {agendamentos.length === 1 ? 'aluno' : 'alunos'}
                </span>
              </div>

              {loading ? (
                <div className="text-center py-12 text-slate-400">Carregando dados em tempo real...</div>
              ) : agendamentos.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-6">
                  <Music className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 font-medium">Nenhum aluno cadastrado no sistema.</p>
                  <button
                    onClick={() => setAbaAtiva('novo')}
                    className="mt-4 inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition"
                  >
                    Cadastrar Primeiro Aluno
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {agendamentos.map((item) => (
                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded uppercase">
                            {LOCALIZACOES.find(l => l.id === item.local)?.nome || item.local}
                          </span>
                          <span className="text-xs text-slate-400 font-medium">{formatarHorario(item)}</span>
                        </div>
                        <h3 className="font-bold text-slate-800 text-base">{item.nome}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">Telefone: {item.telefone || 'Não informado'}</p>
                      </div>
                      <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Music className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="capitalize font-medium">{item.instrumento}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded font-medium ${item.pago ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {item.pago ? 'Pago' : 'Pendente'} ({item.tipoPagamento || 'pacote'})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-8">
              <div className="bg-white border-l-4 border-emerald-600 p-4 rounded-r-xl shadow-sm text-center">
                <p className="italic text-slate-700 font-medium">
                  "E sucedia que, quando o espírito maligno da parte de Deus vinha sobre Saul, Davi tomava a harpa, e a touxia com a sua mão; então Saul andava aliviado, e se sentia melhor, e o espírito maligno se retirava dele."
                </p>
                <span className="block mt-2 text-xs font-bold text-emerald-800 uppercase tracking-wide">1 Samuel 16:23</span>
              </div>

              <div className="text-center max-w-2xl mx-auto space-y-3">
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-800">
                  Projeto <span className="text-emerald-600">Acordes de Davi</span>
                </h2>
                <p className="text-slate-600 text-sm sm:text-base">
                  A Música Transforma Vidas. Escolha o polo mais próximo de você, agende seu horário e venha fazer parte.
                </p>
                <button
                  onClick={() => setAbaAtiva('novo')}
                  className="inline-flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 transition shadow-sm"
                >
                  Ver Polos e Agendar
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {LOCALIZACOES.map((local) => {
                  const lotado = poloEstaLotado(local.id);
                  return (
                    <div key={local.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 text-center hover:shadow-md transition flex flex-col items-center">
                      <MapPin className="w-8 h-8 text-emerald-600 mb-2" />
                      <h3 className="font-bold text-slate-800">{local.nome}</h3>
                      <p className="text-xs text-slate-500 mt-2 flex-1">{local.descricao}</p>
                      {lotado ? (
                        <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          Sem horário disponível
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setPoloSelecionado(local.id);
                            setInstrumentoSelecionado('');
                            setVagaSelecionada('');
                            setAbaAtiva('novo');
                          }}
                          className="mt-4 text-xs font-semibold text-emerald-700 hover:text-emerald-800 underline"
                        >
                          Agendar aqui
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        {abaAtiva === 'gerenciar' && (
          <div className="space-y-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <Settings className="w-6 h-6 text-emerald-600" /> Painel de Gestão Geral
                </h2>
                <p className="text-xs text-slate-500">Gerencie todos os cadastros ou importe sua planilha (CSV).</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={fazerBackup}
                  title="Baixa um arquivo com tudo que está cadastrado agora — alunos, turmas e polos"
                  className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
                >
                  <Download className="w-4 h-4" /> Baixar Backup
                </button>
                <button
                  onClick={() => setAbaAtiva('novo')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
                >
                  <PlusCircle className="w-4 h-4" /> Adicionar Novo Aluno
                </button>
              </div>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-emerald-700 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-900">Restaurar Backup (.json)</h3>
                  <p className="text-xs text-emerald-700">Usa o arquivo baixado no botão "Baixar Backup" acima — substitui TODOS os alunos, turmas e polos atuais pelos dados daquele arquivo.</p>
                </div>
              </div>
              <label className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition shadow-sm inline-flex items-center gap-2 shrink-0">
                <Upload className="w-4 h-4" /> Selecionar Backup
                <input type="file" accept=".json" onChange={handleImportarBackup} className="hidden" />
              </label>
            </div>

            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Calendar className="w-8 h-8 text-amber-700 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-amber-900">Migrar planilha do formulário — São Luiz (horário fixo)</h3>
                  <p className="text-xs text-amber-700">Substitui os cadastros atuais do polo São Luiz por horário fixo na grade nova: Violão na sexta, Bateria no sábado, em ordem de inscrição.</p>
                </div>
              </div>
              <label className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition shadow-sm inline-flex items-center gap-2 shrink-0">
                <Upload className="w-4 h-4" /> Selecionar Planilha
                <input type="file" accept=".csv" onChange={handleMigrarSaoLuiz} className="hidden" />
              </label>
            </div>

            {mensagemImportacao && (
              <div className="bg-emerald-100 border border-emerald-300 text-emerald-900 p-3 rounded-lg text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{mensagemImportacao}</span>
              </div>
            )}

            {gruposDuplicados.length > 0 && (
              <div className="bg-red-50 border border-red-200 p-4 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                  <h3 className="text-sm font-bold text-red-900">
                    {gruposDuplicados.length} possível{gruposDuplicados.length > 1 ? 'is' : ''} cadastro{gruposDuplicados.length > 1 ? 's' : ''} duplicado{gruposDuplicados.length > 1 ? 's' : ''} (mesmo nome + telefone)
                  </h3>
                </div>
                <p className="text-xs text-red-700 -mt-2">
                  Revise cada grupo: se for engano, exclua o registro que não devia ficar. Se for de propósito — o mesmo aluno com 2 aulas por semana em dias diferentes — clique em "Não é duplicado" pra tirar o aviso sem excluir nada.
                </p>
                <div className="space-y-3">
                  {gruposDuplicados.map((grupo, i) => (
                    <div key={i} className="bg-white border border-red-200 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-xs font-bold text-slate-700">{grupo[0].nome} · {grupo[0].telefone}</p>
                        <button
                          onClick={() => aprovarGrupoDuplicado(grupo)}
                          className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded text-xs font-medium transition inline-flex items-center gap-1 shrink-0"
                        >
                          <CheckCircle className="w-3 h-3" /> Não é duplicado (aulas diferentes)
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {grupo.map(item => (
                          <div key={item.id} className="flex items-center justify-between gap-3 text-xs bg-slate-50 border border-slate-200 rounded p-2">
                            <span className="text-slate-600">
                              {LOCALIZACOES.find(l => l.id === item.local)?.nome || item.local} · {item.instrumento} · {formatarHorario(item)} · {item.pago ? 'Pago' : 'Pendente'}
                            </span>
                            <button
                              onClick={() => excluirAgendamento(item.id)}
                              className="bg-red-50 hover:bg-red-100 text-red-600 px-2.5 py-1 rounded text-xs font-medium transition inline-flex items-center gap-1 shrink-0"
                            >
                              <Trash2 className="w-3 h-3" /> Excluir este
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Filtrar por Polo</label>
                <select 
                  value={filtroLocal}
                  onChange={(e) => setFiltroLocal(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="todos">Todos os Polos</option>
                  {LOCALIZACOES.map(l => (
                    <option key={l.id} value={l.id}>{l.nome}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Filtrar por Instrumento</label>
                <select 
                  value={filtroInstrumento}
                  onChange={(e) => setFiltroInstrumento(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="todos">Todos os Instrumentos</option>
                  {INSTRUMENTOS.map((inst) => (
                    <option key={inst.id} value={inst.id}>{nomeInstrumento(inst.id)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                    <th className="p-3">Aluno</th>
                    <th className="p-3">Polo / Instrumento</th>
                    <th className="p-3">Horário</th>
                    <th className="p-3">Pagamento</th>
                    <th className="p-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {agendamentosFiltrados.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition">
                      <td className="p-3">
                        <div className="font-bold text-slate-800">{item.nome}</div>
                        <div className="text-xs text-slate-500">{item.telefone || 'Sem telefone'}</div>
                      </td>
                      <td className="p-3">
                        <div className="text-xs font-semibold uppercase text-emerald-700">
                          {LOCALIZACOES.find(l => l.id === item.local)?.nome}
                        </div>
                        <div className="text-xs capitalize text-slate-500">{item.instrumento}</div>
                      </td>
                      <td className="p-3 text-xs text-slate-600">
                        {formatarHorario(item)}
                      </td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-1 rounded font-medium uppercase ${item.pago ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                          {item.tipoPagamento || 'pacote'} - {item.pago ? 'Pago' : 'Pendente'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => iniciarEdicaoAluno(item)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3.5 h-3.5" /> Editar
                          </button>
                          <button
                            onClick={() => excluirAgendamento(item.id)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Janela de alterações de cadastro do aluno — fica fora da tabela de propósito
            (renderizada uma vez só, no nível geral da tela), pra não depender de inputs
            espalhados em várias células da tabela junto com uma lista que atualiza em
            tempo real. Abre por cima de qualquer aba, sempre que "editandoAluno" existir. */}
        {editandoAluno && (
          <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
              <form onSubmit={salvarEdicaoAluno} className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <Pencil className="w-5 h-5 text-emerald-600" /> Alterar cadastro
                  </h3>
                  <button
                    type="button"
                    onClick={cancelarEdicaoAluno}
                    className="text-slate-400 hover:text-slate-600 text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Nome</label>
                  <input
                    type="text"
                    value={editandoAluno.nome}
                    onChange={(e) => setEditandoAluno({ ...editandoAluno, nome: e.target.value })}
                    autoFocus
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Telefone</label>
                  <input
                    type="text"
                    value={editandoAluno.telefone}
                    onChange={(e) => setEditandoAluno({ ...editandoAluno, telefone: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Polo</label>
                    <select
                      value={editandoAluno.local}
                      onChange={(e) => setEditandoAluno({ ...editandoAluno, local: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                    >
                      {LOCALIZACOES.map((polo) => (
                        <option key={polo.id} value={polo.id}>{polo.nome}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Instrumento</label>
                    <select
                      value={editandoAluno.instrumento}
                      onChange={(e) => setEditandoAluno({ ...editandoAluno, instrumento: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                    >
                      {INSTRUMENTOS.map((inst) => (
                        <option key={inst.id} value={inst.id}>{nomeInstrumento(inst.id)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-amber-600 -mt-2">Trocar polo/instrumento aqui não muda o horário já reservado.</p>

                <div className="pt-3 border-t border-slate-200">
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Corrigir login (opcional)</label>
                  <input
                    type="email"
                    value={editandoAluno.novoEmail}
                    onChange={(e) => setEditandoAluno({ ...editandoAluno, novoEmail: e.target.value })}
                    placeholder="Novo e-mail de login"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-emerald-500"
                  />
                  <input
                    type="text"
                    value={editandoAluno.novaSenha}
                    onChange={(e) => setEditandoAluno({ ...editandoAluno, novaSenha: e.target.value })}
                    placeholder="Nova senha (6+ caracteres)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Deixe os dois em branco pra manter o e-mail/senha atuais.</p>
                </div>

                <div className="pt-3 border-t border-slate-200">
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Avaliação de desempenho (opcional)</label>
                  <input
                    type="date"
                    value={novaAvaliacao.data}
                    onChange={(e) => setNovaAvaliacao({ ...novaAvaliacao, data: e.target.value })}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-emerald-500"
                  />
                  <textarea
                    value={novaAvaliacao.texto}
                    onChange={(e) => setNovaAvaliacao({ ...novaAvaliacao, texto: e.target.value })}
                    placeholder="Ex: Já toca os acordes G, C e D com troca rápida entre eles..."
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    disabled={salvandoAvaliacao || !novaAvaliacao.texto.trim()}
                    onClick={() => adicionarAvaliacao(editandoAluno, novaAvaliacao.data, novaAvaliacao.texto)}
                    className="mt-2 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                  >
                    {salvandoAvaliacao ? 'Salvando...' : 'Adicionar avaliação'}
                  </button>

                  {(() => {
                    const avaliacoesDoAluno = avaliacoesCadastradas
                      .filter((a) => a.agendamentoId === editandoAluno.id)
                      .sort((a, b) => (a.data < b.data ? 1 : -1));
                    if (avaliacoesDoAluno.length === 0) return null;
                    return (
                      <div className="mt-3 space-y-2 max-h-40 overflow-y-auto">
                        {avaliacoesDoAluno.map((a) => (
                          <div key={a.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs">
                            <div>
                              <p className="font-semibold text-emerald-700">{formatarDataCalendario(a.data)}</p>
                              <p className="text-slate-600 whitespace-pre-wrap">{a.texto}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removerAvaliacao(a.id)}
                              className="text-slate-400 hover:text-red-500 shrink-0 font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {erroEdicaoAluno && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
                    {erroEdicaoAluno}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={salvandoEdicaoAluno}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2 rounded-lg text-sm font-bold transition"
                  >
                    {salvandoEdicaoAluno ? 'Salvando...' : 'Salvar alterações'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelarEdicaoAluno}
                    disabled={salvandoEdicaoAluno}
                    className="bg-slate-200 hover:bg-slate-300 disabled:opacity-60 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {abaAtiva === 'pauta' && (
          <div className="space-y-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <CheckSquare className="w-6 h-6 text-emerald-600" /> Pauta de Chamada de Alunos
              </h2>
              <p className="text-xs text-slate-500">
                Escolha a data da aula — o calendário é gerado sozinho a partir da data de início das aulas de cada
                polo (aba Horários) — e marque quem esteve presente, separado por polo e por turma.
              </p>
            </div>

            {agendamentos.length === 0 ? (
              <div className="text-center py-12 text-slate-400">Nenhum aluno cadastrado ainda.</div>
            ) : (
              <div className="space-y-8">
                {[
                  ...LOCALIZACOES,
                  // Cobre um agendamento cujo polo foi removido/renomeado e não bate com
                  // nenhum id de LOCALIZACOES — assim ele não desaparece da pauta, só cai
                  // num grupo "Outros" no final.
                  { id: '__outros__', nome: 'Outros' }
                ].map((polo) => {
                  const alunosDoPolo = agendamentos.filter((item) => (
                    polo.id === '__outros__'
                      ? !LOCALIZACOES.some((l) => l.id === item.local)
                      : item.local === polo.id
                  ));
                  if (alunosDoPolo.length === 0) return null;

                  // Agrupa os alunos do polo por turma (instrumento + dia) — o mesmo
                  // agrupamento que já existe na grade de horários, só que a partir do
                  // que ficou salvo no cadastro de cada aluno.
                  const turmasDoGrupo = new Map();
                  alunosDoPolo.forEach((item) => {
                    const chaveTurma = `${item.instrumento}|${item.dia || 'sem-dia'}`;
                    if (!turmasDoGrupo.has(chaveTurma)) turmasDoGrupo.set(chaveTurma, []);
                    turmasDoGrupo.get(chaveTurma).push(item);
                  });

                  return (
                    <div key={polo.id}>
                      <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-2 mb-2 pb-2 border-b border-emerald-100">
                        <MapPin className="w-4 h-4" /> {polo.nome}
                        <span className="text-xs font-medium text-slate-400 normal-case">
                          ({alunosDoPolo.length} {alunosDoPolo.length === 1 ? 'aluno' : 'alunos'})
                        </span>
                      </h3>

                      {!polo.dataInicioAulas ? (
                        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg p-3">
                          {polo.id === '__outros__'
                            ? 'Esses alunos não estão com um polo válido no cadastro — corrija o polo deles na aba Gestão pra aparecer o calendário de datas aqui.'
                            : <>Defina a <strong>data de início das aulas</strong> desse polo na aba Horários pra gerar o calendário de datas aqui.</>}
                        </div>
                      ) : (
                        <div className="space-y-5">
                          {Array.from(turmasDoGrupo.entries()).map(([chaveTurma, alunosDaTurma]) => {
                            const [instrumentoTurma, diaTurma] = chaveTurma.split('|');
                            const datas = gerarDatasDaTurma({ dia: diaTurma }, polo.dataInicioAulas);
                            const chaveEstado = `${polo.id}|${chaveTurma}`;
                            const hojeIso = paraISO(new Date());
                            const dataEscolhida = datasSelecionadasPauta[chaveEstado]
                              || datas.find((d) => d >= hojeIso)
                              || datas[datas.length - 1]
                              || '';

                            return (
                              <div key={chaveTurma} className="border border-slate-200 rounded-lg p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                  <div>
                                    <p className="text-sm font-bold text-slate-700 capitalize">
                                      {instrumentoTurma} — {diaTurma !== 'sem-dia' ? diaTurma : 'Horário não definido'}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                      {alunosDaTurma.length} {alunosDaTurma.length === 1 ? 'aluno' : 'alunos'}
                                    </p>
                                  </div>
                                  {datas.length > 0 ? (
                                    <div>
                                      <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Data da aula</label>
                                      <select
                                        value={dataEscolhida}
                                        onChange={(e) => setDatasSelecionadasPauta({ ...datasSelecionadasPauta, [chaveEstado]: e.target.value })}
                                        className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                                      >
                                        {datas.map((d) => (
                                          <option key={d} value={d}>{formatarDataCalendario(d)}</option>
                                        ))}
                                      </select>
                                    </div>
                                  ) : (
                                    <p className="text-xs text-slate-400 italic max-w-xs text-right">
                                      Não consegui reconhecer o dia da semana dessa turma ("{diaTurma}") — confira o texto do horário na aba Horários.
                                    </p>
                                  )}
                                </div>

                                {dataEscolhida && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                      <thead>
                                        <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                                          <th className="p-2">Aluno</th>
                                          <th className="p-2 text-center">Presença em {formatarDataCalendario(dataEscolhida)}</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 text-sm">
                                        {alunosDaTurma.map((item) => {
                                          const registro = presencaNaData(item.id, dataEscolhida);
                                          const presente = !!registro?.presente;
                                          return (
                                            <tr key={item.id} className="hover:bg-slate-50 transition">
                                              <td className="p-2 font-bold text-slate-800">{item.nome}</td>
                                              <td className="p-2 text-center">
                                                <button
                                                  onClick={() => alternarPresencaData(item, dataEscolhida, presente)}
                                                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition inline-flex items-center gap-1.5 ${presente ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                                >
                                                  {presente ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                                  {presente ? 'PRESENTE' : 'FALTOU / A MARCAR'}
                                                </button>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {abaAtiva === 'pagamentos' && (
          <div className="space-y-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <DollarSign className="w-6 h-6 text-emerald-600" /> Gerenciador de Pagamentos
              </h2>
              <p className="text-xs text-slate-500">Controle o tipo de cobrança (pacote/individual), forma de pagamento e status de cada aluno.</p>
            </div>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Filtrar por Polo</label>
                <select
                  value={filtroLocalPagamentos}
                  onChange={(e) => setFiltroLocalPagamentos(e.target.value)}
                  className="w-full sm:w-72 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="todos">Todos os Polos</option>
                  {LOCALIZACOES.map(l => (
                    <option key={l.id} value={l.id}>{l.nome}</option>
                  ))}
                </select>
              </div>

              {filtroLocalPagamentos !== 'todos' && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
                  <span className="text-xs font-semibold text-slate-600">Marcar todo mundo desse polo como:</span>
                  <button
                    onClick={() => definirTipoPagamentoPorPolo(filtroLocalPagamentos, 'pacote')}
                    className="bg-emerald-100 hover:bg-emerald-200 text-emerald-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                  >
                    Pacote
                  </button>
                  <button
                    onClick={() => definirTipoPagamentoPorPolo(filtroLocalPagamentos, 'individual')}
                    className="bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                  >
                    Individual
                  </button>
                  <span className="text-xs text-slate-400">(depois é só ajustar exceção por exceção em cada card abaixo)</span>
                </div>
              )}
            </div>

            {(() => {
              // Card único por polo/igreja: lista os nomes dos alunos daquele pacote
              // (só nome + instrumento, sem os campos de cada um — pagamento em pacote é
              // combinado uma vez só pra igreja inteira) e, logo abaixo, os mesmos campos
              // de forma/data/valor/status que já existem na aba Igrejas — editar aqui
              // reflete lá e vice-versa, é o mesmo registro.
              const pacoteFiltrados = agendamentos.filter(item => (
                (filtroLocalPagamentos === 'todos' || item.local === filtroLocalPagamentos)
                && (item.tipoPagamento || 'pacote') !== 'individual'
              ));
              if (pacoteFiltrados.length === 0) return null;

              return (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wide">Alunos em Pacote</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[...LOCALIZACOES, { id: '__outros__', nome: 'Outros' }].map((polo) => {
                      const doPolo = pacoteFiltrados.filter((item) => (
                        polo.id === '__outros__'
                          ? !LOCALIZACOES.some((l) => l.id === item.local)
                          : item.local === polo.id
                      ));
                      if (doPolo.length === 0) return null;

                      const igrejaDoPolo = igrejasCadastradas.find((i) => i.poloId === polo.id);
                      const valorPacote = igrejaDoPolo?.valorCombinado != null && igrejaDoPolo.valorCombinado !== ''
                        ? igrejaDoPolo.valorCombinado
                        : (VALOR_PACOTE_POR_POLO[polo.id] ?? VALOR_PACOTE_PADRAO_OUTROS);

                      return (
                        <div key={polo.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col gap-3">
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="font-bold text-slate-800 text-sm flex items-center gap-1.5 truncate">
                                <MapPin className="w-4 h-4 text-emerald-600 shrink-0" /> <span className="truncate">{polo.nome}</span>
                              </h4>
                              <span className="text-xs font-medium text-slate-400 whitespace-nowrap shrink-0">
                                {doPolo.length} {doPolo.length === 1 ? 'aluno' : 'alunos'}
                              </span>
                            </div>
                            {igrejaDoPolo?.nome && (
                              <p className="text-xs text-slate-500 mt-0.5 uppercase">{igrejaDoPolo.nome}</p>
                            )}
                          </div>

                          <ul className="space-y-1">
                            {doPolo.map((item) => (
                              <li
                                key={item.id}
                                className="flex items-center justify-between gap-2 text-xs text-slate-700 bg-white border border-slate-200 rounded-lg px-2.5 py-1"
                              >
                                <div className="min-w-0 truncate">
                                  <span className="truncate">{item.nome}</span>
                                  <span className="text-[10px] text-slate-400 capitalize ml-1">({item.instrumento})</span>
                                </div>
                                {/* Volta a aparecer também do lado "Individual" (era só nesse
                                    outro grupo antes) — sem isso não tinha como tirar um
                                    aluno específico do pacote sem editar direto no Firestore. */}
                                <select
                                  value={item.tipoPagamento || 'pacote'}
                                  onChange={(e) => alterarTipoPagamento(item.id, e.target.value)}
                                  title="Tipo de pagamento desse aluno"
                                  className="shrink-0 px-1.5 py-1 border border-slate-300 rounded text-[10px] bg-white focus:ring-2 focus:ring-emerald-500"
                                >
                                  <option value="pacote">Pacote</option>
                                  <option value="individual">Individual</option>
                                </select>
                              </li>
                            ))}
                          </ul>

                          {igrejaDoPolo ? (
                            <>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Forma</label>
                                  <select
                                    value={igrejaDoPolo.formaPagamento || 'pix'}
                                    onChange={(e) => alterarFormaPagamentoIgreja(igrejaDoPolo.id, e.target.value)}
                                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                                  >
                                    <option value="pix">Pix</option>
                                    <option value="dinheiro">Dinheiro</option>
                                    <option value="outro">Outro</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Data do pagamento</label>
                                  <input
                                    type="date"
                                    value={igrejaDoPolo.dataPagamento || ''}
                                    onChange={(e) => alterarDataPagamentoIgreja(igrejaDoPolo.id, e.target.value)}
                                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                                  />
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Valor combinado (R$)</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={igrejaDoPolo.valorCombinado ?? ''}
                                    onChange={(e) => alterarValorCombinadoIgreja(igrejaDoPolo.id, e.target.value)}
                                    placeholder="0,00"
                                    className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => alterarValorCombinadoIgreja(igrejaDoPolo.id, String(VALOR_PACOTE_POR_POLO[polo.id] ?? VALOR_PACOTE_PADRAO_OUTROS))}
                                    className="shrink-0 text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 underline whitespace-nowrap"
                                  >
                                    usar sugestão
                                  </button>
                                </div>
                              </div>

                              {numParcelasDoPolo(polo.id) > 1 ? (
                                // Pacote dividido em parcelas (ex: Água Limpa, 2x) — cada
                                // parcela tem seu próprio valor/data/status, independente das
                                // outras (ver PARCELAS_POR_POLO e o relatório Financeiro).
                                <div className="pt-3 border-t border-slate-200 space-y-2">
                                  {Array.from({ length: numParcelasDoPolo(polo.id) }, (_, i) => i + 1).map((n) => {
                                    // O campo de valor começa VAZIO de propósito (não pré-preenchido com a
                                    // sugestão) — você só registra o valor de verdade no dia que a parcela
                                    // cair, em vez de correr o risco de deixar passar um valor "cheio" que
                                    // nem foi confirmado ainda.
                                    const valorSugeridoParcela = (Number(igrejaDoPolo.valorCombinado) || 0) / numParcelasDoPolo(polo.id);
                                    const pagoParcela = !!igrejaDoPolo[`parcela${n}Pago`];
                                    return (
                                      <div key={n} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-[11px] font-bold text-slate-600">Parcela {n}/{numParcelasDoPolo(polo.id)}</span>
                                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pagoParcela ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            {pagoParcela ? 'PAGO ✓' : 'PENDENTE ✕'}
                                          </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <div>
                                            <input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              value={igrejaDoPolo[`parcela${n}Valor`] ?? ''}
                                              onChange={(e) => alterarValorParcelaIgreja(igrejaDoPolo.id, n, e.target.value)}
                                              placeholder={`Sugestão: ${formatarBRL(valorSugeridoParcela)}`}
                                              className="w-full px-2 py-1 border border-slate-300 rounded-lg text-[11px] bg-white focus:ring-2 focus:ring-emerald-500"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => alterarValorParcelaIgreja(igrejaDoPolo.id, n, String(valorSugeridoParcela))}
                                              className="mt-0.5 text-[9px] font-semibold text-emerald-700 hover:text-emerald-900 underline"
                                            >
                                              usar sugestão
                                            </button>
                                          </div>
                                          <input
                                            type="date"
                                            value={igrejaDoPolo[`parcela${n}DataPagamento`] || ''}
                                            onChange={(e) => alterarDataPagamentoParcelaIgreja(igrejaDoPolo.id, n, e.target.value)}
                                            className="w-full px-2 py-1 border border-slate-300 rounded-lg text-[11px] bg-white focus:ring-2 focus:ring-emerald-500"
                                          />
                                        </div>
                                        <button
                                          onClick={() => alternarPagamentoParcelaIgreja(igrejaDoPolo.id, n, pagoParcela)}
                                          className={`w-full px-2 py-1 rounded-lg text-[11px] font-bold transition ${pagoParcela ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                                        >
                                          {pagoParcela ? 'Marcar Pendente' : 'Marcar como Pago'}
                                        </button>
                                      </div>
                                    );
                                  })}
                                  <p className="text-[10px] text-slate-400 italic">
                                    O Pix/recibo abaixo (se usado) é sempre pelo valor combinado total — o controle de cada parcela é só pra acompanhamento aqui no sistema.
                                  </p>
                                </div>
                              ) : (
                                <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${igrejaDoPolo.pago ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {igrejaDoPolo.pago ? 'PAGO ✓' : 'PENDENTE ✕'}
                                  </span>
                                  <button
                                    onClick={() => alternarPagamentoIgreja(igrejaDoPolo.id, igrejaDoPolo.pago)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${igrejaDoPolo.pago ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                                  >
                                    {igrejaDoPolo.pago ? 'Marcar Pendente' : 'Marcar como Pago'}
                                  </button>
                                </div>
                              )}

                              {igrejaDoPolo.dataPagamento && (
                                <button
                                  onClick={() => abrirReciboIgreja(igrejaDoPolo)}
                                  className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                                >
                                  <Printer className="w-3.5 h-3.5" /> Gerar Recibo
                                </button>
                              )}
                            </>
                          ) : (
                            <div className="pt-3 border-t border-slate-200">
                              <p className="text-[11px] text-slate-400 italic mb-2">
                                Ainda sem cobrança ativada nesse polo (valor sugerido: {formatarBRL(valorPacote)}).
                              </p>
                              <button
                                type="button"
                                onClick={() => criarRegistroPacotePolo(polo)}
                                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition"
                              >
                                Ativar pagamento desse polo
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {(() => {
              const individuaisFiltrados = agendamentos.filter(item => (
                (filtroLocalPagamentos === 'todos' || item.local === filtroLocalPagamentos)
                && (item.tipoPagamento || 'pacote') === 'individual'
              ));
              if (individuaisFiltrados.length === 0) return null;
              return (
                <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wide">Alunos Individuais</h3>
              );
            })()}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {agendamentos
                .filter(item => (filtroLocalPagamentos === 'todos' || item.local === filtroLocalPagamentos) && (item.tipoPagamento || 'pacote') === 'individual')
                .map((item) => renderCardPagamento(item))}
            </div>

            {itemRecibo && (
              <div className="bg-white border-8 border-double border-emerald-800 p-8 sm:p-12 rounded-2xl shadow-xl max-w-2xl mx-auto text-center relative overflow-hidden print:shadow-none print:border-8">
                {/* Marca d'água — logo bem clarinha atrás do conteúdo, some das telas de edição, mas fica na impressão/PDF */}
                <img
                  src="/logo-acordes-de-davi.svg"
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 m-auto w-2/3 max-w-xs opacity-[0.16] pointer-events-none select-none"
                />

                <div className="relative z-10">
                  <div className="absolute top-4 right-4 print:hidden flex gap-2">
                    <button
                      onClick={() => window.print()}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 shadow transition"
                    >
                      <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
                    </button>
                    <button
                      onClick={() => setItemRecibo(null)}
                      className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-2 rounded-lg text-xs font-bold transition"
                    >
                      Fechar
                    </button>
                  </div>

                  <div className="mb-6">
                    <img src="/logo-acordes-de-davi.svg" alt="Logo Acordes de Davi" className="w-14 h-14 mx-auto mb-2" />
                    <h1 className="text-xl sm:text-2xl font-serif font-bold text-emerald-900 uppercase tracking-widest">Projeto Acordes de Davi</h1>
                    <p className="text-xs uppercase tracking-widest text-emerald-600 font-semibold mt-1">A Música Transforma Vidas</p>
                  </div>

                  <h2 className="text-3xl font-serif font-bold text-slate-800 tracking-wide mb-6">Recibo de Pagamento</h2>

                  <div className="text-left space-y-1.5 text-sm text-slate-700 mb-6">
                    <p>
                      <span className="font-semibold text-slate-800">{itemRecibo.origem === 'igreja' ? 'Igreja mantenedora:' : 'Aluno(a):'}</span>{' '}
                      {itemRecibo.nome}
                    </p>
                    <p><span className="font-semibold text-slate-800">Polo:</span> {LOCALIZACOES.find(l => l.id === itemRecibo.local)?.nome}</p>
                    {itemRecibo.instrumento && (
                      <p><span className="font-semibold text-slate-800">Instrumento:</span> {itemRecibo.instrumento}</p>
                    )}
                    <p>
                      <span className="font-semibold text-slate-800">Tipo de cobrança:</span>{' '}
                      {itemRecibo.tipoPagamento === 'individual'
                        ? `Individual (${quantidadeAulasRecibo} aula${quantidadeAulasRecibo > 1 ? 's' : ''})`
                        : 'Pacote'}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">Forma de pagamento:</span>{' '}
                      {itemRecibo.formaPagamento === 'pix' ? 'Pix' : itemRecibo.formaPagamento === 'dinheiro' ? 'Dinheiro' : 'Outro'}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-800">Data do pagamento:</span>{' '}
                      {itemRecibo.dataPagamento ? new Date(itemRecibo.dataPagamento + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}
                    </p>
                  </div>

                  {itemRecibo.tipoPagamento === 'individual' && (
                    <div className="mb-4 print:hidden flex items-center justify-center gap-2">
                      <label className="text-xs font-semibold text-slate-600 uppercase">Quantidade de aulas</label>
                      <input
                        type="number"
                        min="1"
                        value={quantidadeAulasRecibo}
                        onChange={(e) => {
                          const qtd = Math.max(1, Number(e.target.value) || 1);
                          setQuantidadeAulasRecibo(qtd);
                          setValorRecibo(String(valorSugeridoRecibo(itemRecibo, LOCALIZACOES.find(l => l.id === itemRecibo.local), qtd)));
                        }}
                        className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center"
                      />
                    </div>
                  )}

                  <div className="mb-6 print:hidden flex items-center justify-center gap-2">
                    <label className="text-xs font-semibold text-slate-600 uppercase">Valor (editável)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={valorRecibo}
                      onChange={(e) => setValorRecibo(e.target.value)}
                      className="w-32 px-2 py-1.5 border border-slate-300 rounded-lg text-sm text-center"
                    />
                  </div>

                  <p className="text-4xl font-bold text-emerald-900 border-t-2 border-b-2 border-emerald-600 py-4 mb-6">
                    {formatarBRL(valorRecibo)}
                  </p>

                  <p className="text-sm text-slate-700 max-w-xl mx-auto leading-relaxed mb-8">
                    Recebemos de <strong className="text-emerald-900">{itemRecibo.nome}</strong> o valor acima referente ao pagamento{' '}
                    {itemRecibo.instrumento ? `das aulas de ${itemRecibo.instrumento}` : 'do pacote de aulas'} no Projeto Acordes de Davi, polo{' '}
                    {LOCALIZACOES.find(l => l.id === itemRecibo.local)?.nome}.
                  </p>

                  {itemRecibo.origem === 'igreja' && (
                    <div className="text-left max-w-xl mx-auto mb-8">
                      <p className="text-xs font-semibold text-slate-800 uppercase tracking-wide mb-2 border-b border-slate-200 pb-1">
                        Alunos atendidos por esse pacote
                      </p>
                      <ul className="text-sm text-slate-700 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 list-disc list-inside">
                        {agendamentos.filter(a => a.local === itemRecibo.local).map((a) => (
                          <li key={a.id}>
                            {a.nome} <span className="text-xs text-slate-500 capitalize">— {a.instrumento}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {dadosProprietario.nome && (
                    <div className="text-left max-w-xl mx-auto mb-2 text-[11px] text-slate-600 leading-relaxed">
                      <p className="font-semibold text-slate-700 uppercase tracking-wide text-[10px] mb-0.5">Emitido por</p>
                      <p>{dadosProprietario.nome}{dadosProprietario.cpf ? ` — CPF/CNPJ: ${dadosProprietario.cpf}` : ''}</p>
                      {dadosProprietario.endereco && <p>{dadosProprietario.endereco}</p>}
                    </div>
                  )}

                  <div className="mt-10 pt-6 border-t border-slate-300 text-xs text-slate-600">
                    <div className="border-b border-slate-400 w-56 mb-1 mx-auto"></div>
                    <p className="font-bold text-slate-800">Coordenação do Projeto</p>
                    <p className="text-slate-500">Recibo emitido em: {new Date().toLocaleDateString('pt-BR')}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {abaAtiva === 'certificados' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 print:hidden">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-2">
                <Award className="w-6 h-6 text-emerald-600" /> Emissão de Certificados de Conclusão
              </h2>
              <p className="text-xs text-slate-500 mb-6">Selecione o aluno e o instrumento para gerar o certificado oficial do projeto.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Selecionar Aluno</label>
                  <select 
                    value={alunoCertificado}
                    onChange={(e) => setAlunoCertificado(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">-- Escolha um Aluno --</option>
                    {agendamentos.map((item) => (
                      <option key={item.id} value={item.nome}>{item.nome} ({item.instrumento})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Instrumento / Curso</label>
                  <select 
                    value={instrumentoCertificado}
                    onChange={(e) => setInstrumentoCertificado(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Violão">Violão</option>
                    <option value="Bateria">Bateria</option>
                    <option value="Banda">Banda</option>
                    <option value="Musicalização">Musicalização Geral</option>
                  </select>
                </div>

                <div>
                  <button 
                    onClick={() => {
                      if (!alunoCertificado) {
                        alert('Por favor, selecione um aluno primeiro.');
                        return;
                      }
                      setEmitirCertificado(true);
                    }}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 rounded-lg text-sm transition shadow-sm flex items-center justify-center gap-2"
                  >
                    <Award className="w-4 h-4" /> Gerar Certificado
                  </button>
                </div>
              </div>
            </div>

            {emitirCertificado && alunoCertificado && (
              <div className="bg-white border-8 border-double border-emerald-800 p-8 sm:p-12 rounded-2xl shadow-xl max-w-4xl mx-auto text-center relative overflow-hidden print:shadow-none print:border-8">
                {/* Marca d'água — logo bem clarinha atrás do conteúdo, some das telas de edição, mas fica na impressão/PDF */}
                <img
                  src="/logo-acordes-de-davi.svg"
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 m-auto w-1/2 max-w-sm opacity-[0.16] pointer-events-none select-none"
                />

                <div className="relative z-10">
                  <div className="absolute top-4 right-4 print:hidden">
                    <button
                      onClick={() => window.print()}
                      className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 shadow transition"
                    >
                      <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
                    </button>
                  </div>

                  <div className="mb-6">
                    <img src="/logo-acordes-de-davi.svg" alt="Logo Acordes de Davi" className="w-16 h-16 mx-auto mb-2" />
                    <h1 className="text-2xl sm:text-3xl font-serif font-bold text-emerald-900 uppercase tracking-widest">Projeto Acordes de Davi</h1>
                    <p className="text-xs uppercase tracking-widest text-emerald-600 font-semibold mt-1">A Música Transforma Vidas</p>
                  </div>

                  <div className="my-8">
                    <h2 className="text-4xl sm:text-5xl font-serif font-bold text-slate-800 tracking-wide mb-4">Certificado de Conclusão</h2>
                    <p className="text-sm text-slate-600 uppercase tracking-wider mb-6">Certificamos para os devidos fins que</p>

                    <p className="text-3xl sm:text-4xl font-bold text-emerald-900 border-b-2 border-emerald-600 pb-2 inline-block px-8 font-serif">
                      {alunoCertificado}
                    </p>

                    <p className="text-sm text-slate-700 mt-6 max-w-2xl mx-auto leading-relaxed">
                      concluiu com êxito o treinamento prático e teórico no curso de <strong className="text-emerald-900">{instrumentoCertificado}</strong>, ministrado pelo Projeto Acordes de Davi, demonstrando dedicação e aproveitamento exemplar.
                    </p>
                  </div>

                  <div className="mt-12 pt-8 border-t border-slate-300 flex flex-col sm:flex-row justify-between items-center text-xs text-slate-600 gap-6">
                    <div>
                      <p className="font-bold text-slate-800">1 Samuel 16:23</p>
                      <p className="italic">"A música alivia a alma e traz paz ao coração."</p>
                    </div>
                    <div className="text-center sm:text-right">
                      <div className="border-b border-slate-400 w-48 mb-1 mx-auto sm:mx-0"></div>
                      <p className="font-bold text-slate-800">Coordenação do Projeto</p>
                      <p className="text-slate-500">Data de Emissão: {new Date().toLocaleDateString('pt-BR')}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {abaAtiva === 'horarios' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <MapPin className="w-6 h-6 text-emerald-600" /> Polos de Ensino
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Crie, renomeie ou remova os polos que aparecem pros alunos escolherem.</p>
                </div>
                <button
                  onClick={restaurarPolosPadrao}
                  className="text-xs font-semibold text-emerald-700 border border-emerald-200 px-3 py-2 rounded-lg hover:bg-emerald-50 transition shrink-0"
                >
                  Restaurar polos padrão
                </button>
              </div>

              {erroPolo && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{erroPolo}</span>
                </div>
              )}

              <form onSubmit={adicionarPolo} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Nome do Polo</label>
                  <input
                    type="text"
                    value={novoPolo.nome}
                    onChange={(e) => setNovoPolo({ ...novoPolo, nome: e.target.value })}
                    placeholder="Ex: Praia Bonita"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Descrição (opcional)</label>
                  <input
                    type="text"
                    value={novoPolo.descricao}
                    onChange={(e) => setNovoPolo({ ...novoPolo, descricao: e.target.value })}
                    placeholder="Ex: Aulas de violão às quartas, à tarde"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Início das aulas</label>
                  <input
                    type="date"
                    value={novoPolo.dataInicioAulas}
                    onChange={(e) => setNovoPolo({ ...novoPolo, dataInicioAulas: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={salvandoPolo}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm disabled:opacity-60"
                  >
                    {salvandoPolo ? 'Salvando...' : 'Adicionar Polo'}
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                {LOCALIZACOES.map((polo) => (
                  <div key={polo.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                    {editandoPolo?.id === polo.id ? (
                      <form onSubmit={salvarEdicaoPolo} className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                        <input
                          type="text"
                          value={editandoPolo.nome}
                          onChange={(e) => setEditandoPolo({ ...editandoPolo, nome: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                        />
                        <input
                          type="text"
                          value={editandoPolo.descricao}
                          onChange={(e) => setEditandoPolo({ ...editandoPolo, descricao: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                        />
                        <div>
                          <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Início das aulas</label>
                          <input
                            type="date"
                            value={editandoPolo.dataInicioAulas}
                            onChange={(e) => setEditandoPolo({ ...editandoPolo, dataInicioAulas: e.target.value })}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-semibold transition">Salvar</button>
                          <button type="button" onClick={cancelarEdicaoPolo} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-2 rounded-lg text-xs font-semibold transition">Cancelar</button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-800">{polo.nome}</p>
                          <p className="text-xs text-slate-500">{polo.descricao || 'Sem descrição'}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {turmasCadastradas.filter(t => t.local === polo.id).length} turma(s) cadastrada(s)
                            {' · '}
                            {polo.dataInicioAulas
                              ? `Aulas a partir de ${new Date(`${polo.dataInicioAulas}T00:00:00`).toLocaleDateString('pt-BR')}`
                              : 'Data de início das aulas não definida (necessária pra Pauta por data)'}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => iniciarEdicaoPolo(polo)}
                            className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => removerPolo(polo)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remover
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {LOCALIZACOES.length === 0 && (
                  <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                    <MapPin className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-500 font-medium text-sm">Nenhum polo cadastrado ainda.</p>
                    <p className="text-xs text-slate-400 mt-1">Clique em "Restaurar polos padrão" ou crie o primeiro polo no formulário acima.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Clock className="w-6 h-6 text-emerald-600" /> Grade de Horários
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">Só você cria, edita ou remove turmas aqui. Os alunos só escolhem entre o que já está cadastrado.</p>
                </div>
                <button
                  onClick={restaurarGradePadrao}
                  className="text-xs font-semibold text-emerald-700 border border-emerald-200 px-3 py-2 rounded-lg hover:bg-emerald-50 transition shrink-0"
                >
                  Restaurar grade padrão
                </button>
              </div>

              {erroTurma && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{erroTurma}</span>
                </div>
              )}

              <form onSubmit={adicionarTurma} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end bg-slate-50 p-4 rounded-lg border border-slate-200">
                <div className="lg:col-span-1">
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Polo</label>
                  <select
                    value={novaTurma.local}
                    onChange={(e) => setNovaTurma({ ...novaTurma, local: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    {LOCALIZACOES.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                  </select>
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Instrumento</label>
                  <select
                    value={novaTurma.instrumento}
                    onChange={(e) => setNovaTurma({ ...novaTurma, instrumento: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    {INSTRUMENTOS.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Dia / Grupo</label>
                  <input
                    type="text"
                    value={novaTurma.dia}
                    onChange={(e) => setNovaTurma({ ...novaTurma, dia: e.target.value })}
                    placeholder="Ex: Terça-feira, Sexta (Quinzenal)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Início</label>
                  <input
                    type="time"
                    value={novaTurma.inicio}
                    onChange={(e) => setNovaTurma({ ...novaTurma, inicio: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Fim</label>
                  <input
                    type="time"
                    value={novaTurma.fim}
                    onChange={(e) => setNovaTurma({ ...novaTurma, fim: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Bloco (min)</label>
                  <input
                    type="number"
                    min={10}
                    step={5}
                    value={novaTurma.duracao}
                    onChange={(e) => setNovaTurma({ ...novaTurma, duracao: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="lg:col-span-6">
                  <button
                    type="submit"
                    disabled={salvandoTurma}
                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm disabled:opacity-60"
                  >
                    {salvandoTurma ? 'Salvando...' : 'Adicionar Turma'}
                  </button>
                </div>
              </form>
              <p className="text-xs text-slate-400 mt-2">
                Pra um dia com intervalo (ex: almoço), cria duas turmas com o mesmo nome de dia e horários diferentes — elas aparecem juntas pro aluno.
              </p>
            </div>

            {LOCALIZACOES.map((local) => {
              const turmasDoLocal = turmasCadastradas.filter(t => t.local === local.id);
              if (turmasDoLocal.length === 0) return null;
              return (
                <div key={local.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                  <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-600" /> {local.nome}
                  </h3>
                  <div className="space-y-2">
                    {turmasDoLocal.map((t) => (
                      <div key={t.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div>
                            <span className="text-xs font-semibold uppercase text-emerald-700">{nomeInstrumento(t.instrumento)}</span>
                            <p className="text-sm font-bold text-slate-800">{t.dia}</p>
                            <p className="text-xs text-slate-500">
                              {t.horarios?.[0]?.label?.split(' - ')[0]} até {t.horarios?.[t.horarios.length - 1]?.label?.split(' - ')[1]} · {t.horarios?.length || 0} vaga(s)
                            </p>
                          </div>
                          <button
                            onClick={() => removerTurma(t.id)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remover turma inteira
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-200">
                          {(t.horarios || []).map((h) => {
                            const idVaga = `vaga-${t.local}-${t.instrumento}-${t.dia}-${h.value}`;
                            const ocupado = vagasOcupadas.includes(idVaga);
                            return (
                              <button
                                key={h.value}
                                onClick={() => removerHorarioDaTurma(t, h.value)}
                                title={ocupado ? 'Já tem aluno agendado neste horário' : 'Remover só este horário'}
                                className={`group inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition ${
                                  ocupado
                                    ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                                    : 'bg-white border-slate-200 text-slate-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600'
                                }`}
                              >
                                {h.label}
                                <Trash2 className="w-3 h-3 opacity-50 group-hover:opacity-100" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {turmasCadastradas.length === 0 && (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-6">
                <Clock className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 font-medium">Nenhuma turma cadastrada ainda.</p>
                <p className="text-xs text-slate-400 mt-1">Clique em "Restaurar grade padrão" acima ou crie a primeira turma no formulário.</p>
              </div>
            )}
          </div>
        )}

        {abaAtiva === 'vagas' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <ClipboardList className="w-6 h-6 text-emerald-600" /> Vagas Disponíveis
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Quantas vagas ainda estão livres em cada polo/instrumento, pra você saber onde ainda dá pra oferecer.
                  </p>
                </div>
                <span className="text-sm bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-full font-bold shrink-0">
                  {relatorioVagas.totalLivres} livre{relatorioVagas.totalLivres === 1 ? '' : 's'} de {relatorioVagas.totalVagas}
                </span>
              </div>

              {relatorioVagas.totalVagas === 0 && (
                <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed border-slate-300 mt-4">
                  <ClipboardList className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 font-medium text-sm">Nenhuma turma cadastrada ainda.</p>
                  <p className="text-xs text-slate-400 mt-1">Cadastre a grade na aba "Horários" pra esse relatório aparecer aqui.</p>
                </div>
              )}
            </div>

            {LOCALIZACOES.map((polo) => {
              const dadosPolo = relatorioVagas.porPolo[polo.id];
              if (!dadosPolo || dadosPolo.total === 0) return null;
              return (
                <div key={polo.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                  <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-emerald-600" /> {polo.nome}
                    </h3>
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${dadosPolo.livres > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {dadosPolo.livres} livre{dadosPolo.livres === 1 ? '' : 's'} de {dadosPolo.total}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {Object.entries(dadosPolo.porInstrumento).map(([instrumentoId, dadosInstrumento]) => (
                      <div key={instrumentoId} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <span className="text-xs font-semibold uppercase text-emerald-700">{nomeInstrumento(instrumentoId)}</span>
                          <span className="text-xs text-slate-500 font-medium">
                            {dadosInstrumento.livres} livre{dadosInstrumento.livres === 1 ? '' : 's'} de {dadosInstrumento.total}
                          </span>
                        </div>
                        {dadosInstrumento.vagasLivres.length === 0 ? (
                          <p className="text-xs text-slate-400">Sem vagas livres nesse instrumento agora — está tudo ocupado.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {dadosInstrumento.vagasLivres.map((v, i) => (
                              <span
                                key={`${v.dia}-${v.horarioLabel}-${i}`}
                                className="inline-flex items-center px-2 py-1 rounded text-xs font-medium border border-emerald-200 bg-white text-emerald-700"
                              >
                                {v.dia} · {v.horarioLabel}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {abaAtiva === 'banda' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Users className="w-6 h-6 text-emerald-600" /> Integrantes da Banda
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Lista de gestão própria (nome + função) por polo — aparece também no Portal do Aluno e no Portal da Igreja daquele polo. Não precisa ter cadastro de aluno pra entrar aqui.
              </p>
            </div>

            {LOCALIZACOES.map((polo) => {
              const integrantes = polo.integrantesBanda || [];
              const rascunho = formNovoIntegranteBanda[polo.id] || { nome: '', funcao: FUNCOES_BANDA[0] };
              return (
                <div key={polo.id} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                  <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-emerald-600" /> {polo.nome}
                    </h3>
                    <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-slate-100 text-slate-500">
                      {integrantes.length} integrante{integrantes.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {integrantes.length === 0 ? (
                    <p className="text-xs text-slate-400 italic mb-4">Nenhum integrante cadastrado nesse polo ainda.</p>
                  ) : (
                    <div className="space-y-2 mb-4">
                      {integrantes.map((integrante) => (
                        <div key={integrante.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                          <input
                            type="text"
                            value={integrante.nome}
                            onChange={(e) => alterarIntegranteBanda(polo.id, integrante.id, 'nome', e.target.value)}
                            className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                          />
                          <select
                            value={integrante.funcao}
                            onChange={(e) => alterarIntegranteBanda(polo.id, integrante.id, 'funcao', e.target.value)}
                            className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                          >
                            {FUNCOES_BANDA.map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                          <button
                            type="button"
                            onClick={() => removerIntegranteBanda(polo.id, integrante.id)}
                            className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center justify-center gap-1 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Remover
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-3 border-t border-slate-100">
                    <input
                      type="text"
                      value={rascunho.nome}
                      onChange={(e) => setFormNovoIntegranteBanda({ ...formNovoIntegranteBanda, [polo.id]: { ...rascunho, nome: e.target.value } })}
                      placeholder="Nome do novo integrante"
                      className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                    />
                    <select
                      value={rascunho.funcao}
                      onChange={(e) => setFormNovoIntegranteBanda({ ...formNovoIntegranteBanda, [polo.id]: { ...rascunho, funcao: e.target.value } })}
                      className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                    >
                      {FUNCOES_BANDA.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        adicionarIntegranteBanda(polo.id, rascunho.nome, rascunho.funcao);
                        setFormNovoIntegranteBanda({ ...formNovoIntegranteBanda, [polo.id]: { nome: '', funcao: FUNCOES_BANDA[0] } });
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-lg text-sm font-bold transition inline-flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <PlusCircle className="w-4 h-4" /> Adicionar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {abaAtiva === 'financeiro' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-1">
                <TrendingUp className="w-6 h-6 text-emerald-600" /> Relatório Financeiro
              </h2>
              <p className="text-xs text-slate-500">
                Vencimento calculado sozinho: a cada 14 dias (quinzena) pro pacote/igreja, a cada 5 aulas pro individual —
                sem precisar digitar nenhuma data. Antes do vencimento chegar é "Pendente" (pagamento previsto); depois que
                chega/passa sem ter sido marcado como pago, vira "Atrasado".
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-green-700 uppercase">Em dia</p>
                  <p className="text-lg font-bold text-green-800">{relatorioFinanceiro.pago.itens.length}</p>
                  <p className="text-[10px] text-green-700">R$ {relatorioFinanceiro.pago.total.toFixed(2)}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-amber-700 uppercase">Pendente</p>
                  <p className="text-lg font-bold text-amber-800">{relatorioFinanceiro.pendente.itens.length}</p>
                  <p className="text-[10px] text-amber-700">R$ {relatorioFinanceiro.pendente.total.toFixed(2)}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-red-700 uppercase">Atrasado</p>
                  <p className="text-lg font-bold text-red-800">{relatorioFinanceiro.atrasado.itens.length}</p>
                  <p className="text-[10px] text-red-700">R$ {relatorioFinanceiro.atrasado.total.toFixed(2)}</p>
                </div>
                <div className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">Sem dados</p>
                  <p className="text-lg font-bold text-slate-600">{relatorioFinanceiro.semDados.itens.length}</p>
                  <p className="text-[10px] text-slate-500">falta config.</p>
                </div>
              </div>
            </div>

            {[
              { chave: 'atrasado', titulo: 'Atrasados', cor: 'text-red-700', vazio: 'Nenhuma conta atrasada. 🎉' },
              { chave: 'pendente', titulo: 'Pendentes (pagamento previsto)', cor: 'text-amber-700', vazio: 'Nenhuma conta pendente no momento.' },
              { chave: 'pago', titulo: 'Em dia', cor: 'text-green-700', vazio: 'Nenhuma conta paga ainda.' },
              { chave: 'semDados', titulo: 'Sem dados suficientes pra calcular', cor: 'text-slate-500', vazio: 'Tudo certo — nenhuma conta travada por falta de configuração.' }
            ].map((secao) => (
              <div key={secao.chave} className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                <h3 className={`text-sm font-bold uppercase tracking-wide mb-3 ${secao.cor}`}>{secao.titulo}</h3>
                {relatorioFinanceiro[secao.chave].itens.length === 0 ? (
                  <p className="text-xs text-slate-400">{secao.vazio}</p>
                ) : (
                  <div className="space-y-2">
                    {relatorioFinanceiro[secao.chave].itens.map((linha, i) => (
                      <div key={`${linha.tipo}-${linha.nome}-${i}`} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{linha.nome}</p>
                          <p className="text-xs text-slate-500">
                            {linha.tipo === 'individual' ? 'Individual' : 'Pacote/Igreja'} · {linha.local}
                          </p>
                          {secao.chave === 'semDados' && linha.motivo && (
                            <p className="text-[10px] text-slate-400 mt-0.5">{linha.motivo}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-slate-800">R$ {linha.valor.toFixed(2)}</p>
                          {linha.vencimento && (
                            <p className="text-[10px] text-slate-400">
                              Vencimento: {new Date(`${linha.vencimento}T00:00:00`).toLocaleDateString('pt-BR')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {abaAtiva === 'igrejas' && (
          <div className="space-y-6 max-w-4xl mx-auto">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <div className="mb-4 pb-4 border-b border-slate-100">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <BookOpen className="w-6 h-6 text-emerald-600" /> Igrejas Mantenedoras
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Cadastre a igreja que mantém/paga o pacote de um polo, e gere UMA cobrança Pix única
                  pro polo inteiro — em vez de cobrar aluno por aluno. Isso não muda nada no que já
                  existia: os campos de pagamento de cada aluno na aba Pagamentos e o botão de Pix no
                  Portal do Aluno continuam funcionando do mesmo jeito.
                </p>
              </div>

              {erroIgreja && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{erroIgreja}</span>
                </div>
              )}

              <form onSubmit={adicionarIgreja} className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Nome da Igreja</label>
                  <input
                    type="text"
                    value={novaIgreja.nome}
                    onChange={(e) => setNovaIgreja({ ...novaIgreja, nome: e.target.value })}
                    placeholder="Ex: Igreja Tabernáculo (Penha do Côco)"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Polo que ela mantém</label>
                  <select
                    value={novaIgreja.poloId}
                    onChange={(e) => setNovaIgreja({ ...novaIgreja, poloId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione o polo...</option>
                    {LOCALIZACOES.map((polo) => (
                      <option key={polo.id} value={polo.id}>{polo.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Responsável (opcional)</label>
                  <input
                    type="text"
                    value={novaIgreja.responsavel}
                    onChange={(e) => setNovaIgreja({ ...novaIgreja, responsavel: e.target.value })}
                    placeholder="Ex: Pastor João"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Telefone (opcional)</label>
                  <input
                    type="text"
                    value={novaIgreja.telefone}
                    onChange={(e) => setNovaIgreja({ ...novaIgreja, telefone: e.target.value })}
                    placeholder="Ex: (98) 90000-0000"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={salvandoIgreja}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm disabled:opacity-60"
                  >
                    {salvandoIgreja ? 'Salvando...' : 'Adicionar Igreja'}
                  </button>
                </div>
              </form>

              {erroPixIgreja && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{erroPixIgreja}</span>
                </div>
              )}

              {dadosPixIgreja && (
                <div className="mb-4 bg-white border-4 border-double border-emerald-700 rounded-2xl p-6 text-center shadow-xl max-w-sm mx-auto">
                  <h3 className="text-base font-bold text-emerald-900 mb-1">Pagamento via Pix da Igreja</h3>
                  <p className="text-xs text-slate-500 mb-4">Escaneie o QR Code ou copie o código no app do banco do responsável pelo pagamento.</p>
                  {dadosPixIgreja.qrCodeBase64 && (
                    <img
                      src={`data:image/png;base64,${dadosPixIgreja.qrCodeBase64}`}
                      alt="QR Code Pix"
                      className="mx-auto mb-4 w-48 h-48 rounded-lg border border-slate-200"
                    />
                  )}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(dadosPixIgreja.qrCode || '').then(() => {
                        setMensagemSucesso('Código Pix copiado!');
                        setTimeout(() => setMensagemSucesso(''), 3000);
                      }).catch(() => {
                        setMensagemSucesso('Não foi possível copiar automaticamente — copie o código manualmente.');
                        setTimeout(() => setMensagemSucesso(''), 4000);
                      });
                    }}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition mb-2"
                  >
                    Copiar código Pix
                  </button>
                  <button
                    onClick={() => { setDadosPixIgreja(null); setIgrejaComPixAberto(null); }}
                    className="w-full text-xs text-slate-500 hover:text-slate-700 transition"
                  >
                    Cancelar
                  </button>
                  <p className="text-[11px] text-slate-400 mt-4">
                    A confirmação é automática — assim que o pagamento cair, essa tela fecha sozinha e o
                    status da igreja muda pra "Pago".
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {igrejasCadastradas.map((igreja) => (
                  <div key={igreja.id} className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                    {editandoIgreja?.id === igreja.id ? (
                      <form onSubmit={salvarEdicaoIgreja} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                        <input
                          type="text"
                          value={editandoIgreja.nome}
                          onChange={(e) => setEditandoIgreja({ ...editandoIgreja, nome: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                        />
                        <select
                          value={editandoIgreja.poloId}
                          onChange={(e) => setEditandoIgreja({ ...editandoIgreja, poloId: e.target.value })}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="">Selecione o polo...</option>
                          {LOCALIZACOES.map((polo) => (
                            <option key={polo.id} value={polo.id}>{polo.nome}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={editandoIgreja.responsavel}
                          onChange={(e) => setEditandoIgreja({ ...editandoIgreja, responsavel: e.target.value })}
                          placeholder="Responsável"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                        />
                        <input
                          type="text"
                          value={editandoIgreja.telefone}
                          onChange={(e) => setEditandoIgreja({ ...editandoIgreja, telefone: e.target.value })}
                          placeholder="Telefone"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                        />
                        <div className="flex gap-2 sm:col-span-2">
                          <button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-semibold transition">Salvar</button>
                          <button type="button" onClick={cancelarEdicaoIgreja} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-2 rounded-lg text-xs font-semibold transition">Cancelar</button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div>
                            <p className="text-sm font-bold text-slate-800">{igreja.nome}</p>
                            <p className="text-xs text-slate-500">
                              Polo: {LOCALIZACOES.find(l => l.id === igreja.poloId)?.nome || 'Polo não encontrado'}
                              {igreja.responsavel ? ` · ${igreja.responsavel}` : ''}
                              {igreja.telefone ? ` · ${igreja.telefone}` : ''}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {agendamentos.filter(a => a.local === igreja.poloId).length} aluno(s) nesse polo
                            </p>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => iniciarEdicaoIgreja(igreja)}
                              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => removerIgreja(igreja)}
                              className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Remover
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-slate-200">
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Forma</label>
                            <select
                              value={igreja.formaPagamento || 'pix'}
                              onChange={(e) => alterarFormaPagamentoIgreja(igreja.id, e.target.value)}
                              className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                            >
                              <option value="pix">Pix</option>
                              <option value="dinheiro">Dinheiro</option>
                              <option value="outro">Outro</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Data do pagamento</label>
                            <input
                              type="date"
                              value={igreja.dataPagamento || ''}
                              onChange={(e) => alterarDataPagamentoIgreja(igreja.id, e.target.value)}
                              className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                            />
                          </div>
                          <div className="col-span-2 sm:col-span-1">
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Valor combinado (R$)</label>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={igreja.valorCombinado ?? ''}
                                onChange={(e) => alterarValorCombinadoIgreja(igreja.id, e.target.value)}
                                placeholder="0,00"
                                className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:ring-2 focus:ring-emerald-500"
                              />
                              <button
                                type="button"
                                onClick={() => alterarValorCombinadoIgreja(igreja.id, String(VALOR_PACOTE_POR_POLO[igreja.poloId] ?? VALOR_PACOTE_PADRAO_OUTROS))}
                                className="shrink-0 text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 underline whitespace-nowrap"
                              >
                                sugestão
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-col items-start gap-1">
                            <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-0.5">Status</label>
                            {numParcelasDoPolo(igreja.poloId) > 1 ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600">
                                Ver parcelas ↓
                              </span>
                            ) : (
                              <button
                                onClick={() => alternarPagamentoIgreja(igreja.id, igreja.pago)}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition ${igreja.pago ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                              >
                                {igreja.pago ? 'PAGO ✓' : 'PENDENTE ✕'}
                              </button>
                            )}
                          </div>
                        </div>

                        {numParcelasDoPolo(igreja.poloId) > 1 && (
                          // Pacote dividido em parcelas (ex: Água Limpa, 2x) — cada parcela
                          // tem seu próprio valor/data/status (ver PARCELAS_POR_POLO).
                          <div className="mt-3 pt-3 border-t border-slate-200 grid gap-2 sm:grid-cols-2">
                            {Array.from({ length: numParcelasDoPolo(igreja.poloId) }, (_, i) => i + 1).map((n) => {
                              // Campo de valor começa vazio de propósito — só é preenchido no dia
                              // real do pagamento (com o valor combinado, ou clicando "usar sugestão").
                              const valorSugeridoParcela = (Number(igreja.valorCombinado) || 0) / numParcelasDoPolo(igreja.poloId);
                              const pagoParcela = !!igreja[`parcela${n}Pago`];
                              return (
                                <div key={n} className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-bold text-slate-600">Parcela {n}/{numParcelasDoPolo(igreja.poloId)}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pagoParcela ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                      {pagoParcela ? 'PAGO ✓' : 'PENDENTE ✕'}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <div>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={igreja[`parcela${n}Valor`] ?? ''}
                                        onChange={(e) => alterarValorParcelaIgreja(igreja.id, n, e.target.value)}
                                        placeholder={`Sugestão: ${formatarBRL(valorSugeridoParcela)}`}
                                        className="w-full px-2 py-1 border border-slate-300 rounded-lg text-[11px] bg-white focus:ring-2 focus:ring-emerald-500"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => alterarValorParcelaIgreja(igreja.id, n, String(valorSugeridoParcela))}
                                        className="mt-0.5 text-[9px] font-semibold text-emerald-700 hover:text-emerald-900 underline"
                                      >
                                        usar sugestão
                                      </button>
                                    </div>
                                    <input
                                      type="date"
                                      value={igreja[`parcela${n}DataPagamento`] || ''}
                                      onChange={(e) => alterarDataPagamentoParcelaIgreja(igreja.id, n, e.target.value)}
                                      className="w-full px-2 py-1 border border-slate-300 rounded-lg text-[11px] bg-white focus:ring-2 focus:ring-emerald-500"
                                    />
                                  </div>
                                  <button
                                    onClick={() => alternarPagamentoParcelaIgreja(igreja.id, n, pagoParcela)}
                                    className={`w-full px-2 py-1 rounded-lg text-[11px] font-bold transition ${pagoParcela ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                                  >
                                    {pagoParcela ? 'Marcar Pendente' : 'Marcar como Pago'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {!igreja.pago && (
                          igreja.valorCombinado ? (
                            <button
                              onClick={() => gerarPixIgreja(igreja)}
                              disabled={gerandoPixIgreja}
                              className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-3 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                              {gerandoPixIgreja && igrejaComPixAberto !== igreja.id ? 'Gerando Pix...' : `Gerar Pix de ${formatarBRL(igreja.valorCombinado)} pra essa igreja`}
                            </button>
                          ) : (
                            <p className="text-[11px] text-slate-400 mt-3 italic">Defina o valor combinado acima pra poder gerar o Pix.</p>
                          )
                        )}
                        {numParcelasDoPolo(igreja.poloId) > 1 && (
                          <p className="text-[10px] text-slate-400 italic mt-1.5">
                            O Pix acima (se usado) é sempre pelo valor combinado total — o controle de cada parcela é só pra acompanhamento aqui no sistema.
                          </p>
                        )}

                        {igreja.dataPagamento && (
                          <button
                            onClick={() => abrirReciboIgreja(igreja)}
                            className="mt-2 w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                          >
                            <Printer className="w-3.5 h-3.5" /> Gerar Recibo (em nome da igreja)
                          </button>
                        )}

                        <div className="mt-3 pt-3 border-t border-slate-200">
                          {igreja.email ? (
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <p className="text-[11px] text-slate-500">
                                <KeyRound className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-emerald-600" />
                                Acesso liberado: <span className="font-semibold text-slate-700">{igreja.email}</span>
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setAcessoIgrejaAberto(igreja.id);
                                  setFormAcessoIgreja({ email: igreja.email, senha: '' });
                                  setErroAcessoIgreja('');
                                }}
                                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 underline whitespace-nowrap"
                              >
                                Redefinir senha / polo
                              </button>
                            </div>
                          ) : (
                            acessoIgrejaAberto !== igreja.id && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAcessoIgrejaAberto(igreja.id);
                                  setFormAcessoIgreja({ email: '', senha: '' });
                                  setErroAcessoIgreja('');
                                }}
                                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5"
                              >
                                <KeyRound className="w-3.5 h-3.5" /> Criar acesso da igreja (Portal da Igreja)
                              </button>
                            )
                          )}

                          {acessoIgrejaAberto === igreja.id && (
                            <form
                              onSubmit={(e) => criarOuRedefinirAcessoIgreja(igreja, e)}
                              className="mt-2 space-y-2 bg-slate-50 p-3 rounded-lg border border-slate-200"
                            >
                              {erroAcessoIgreja && (
                                <div className="bg-red-50 border border-red-200 text-red-700 p-2 rounded-lg text-[11px] flex items-center gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                  <span>{erroAcessoIgreja}</span>
                                </div>
                              )}
                              <input
                                type="email"
                                required
                                placeholder="E-mail de acesso da igreja"
                                value={formAcessoIgreja.email}
                                onChange={(e) => setFormAcessoIgreja({ ...formAcessoIgreja, email: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500"
                              />
                              <input
                                type="text"
                                required
                                placeholder="Senha (mínimo 6 caracteres)"
                                value={formAcessoIgreja.senha}
                                onChange={(e) => setFormAcessoIgreja({ ...formAcessoIgreja, senha: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-emerald-500"
                              />
                              <p className="text-[10px] text-slate-400">
                                Anote essa senha antes de salvar — depois de salva, só dá pra ver de novo redefinindo.
                              </p>
                              <div className="flex gap-2">
                                <button
                                  type="submit"
                                  disabled={salvandoAcessoIgreja}
                                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                                >
                                  {salvandoAcessoIgreja ? 'Salvando...' : 'Salvar acesso'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setAcessoIgrejaAberto(null); setErroAcessoIgreja(''); }}
                                  className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </form>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {igrejasCadastradas.length === 0 && (
                  <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                    <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-500 font-medium text-sm">Nenhuma igreja cadastrada ainda.</p>
                    <p className="text-xs text-slate-400 mt-1">Cadastre a igreja mantenedora de um polo no formulário acima pra gerar a cobrança consolidada.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {abaAtiva === 'materiais' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-3xl mx-auto">
            <h2 className="text-xl font-bold text-slate-800 mb-1 flex items-center gap-2">
              <Upload className="w-6 h-6 text-emerald-600" /> Materiais e Vídeos de Estudo
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Cole aqui o link de um material (TeraBox, Google Drive, YouTube, ou qualquer link que abra direto) —
              ele aparece pro aluno no Portal, filtrado pelo instrumento dele.
            </p>

            {erroMaterial && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{erroMaterial}</span>
              </div>
            )}

            <form onSubmit={adicionarMaterial} className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200 mb-6">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Título</label>
                <input
                  type="text"
                  value={novoMaterial.titulo}
                  onChange={(e) => setNovoMaterial({ ...novoMaterial, titulo: e.target.value })}
                  placeholder="Ex: Acordes Básicos C, D, G"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Tipo</label>
                <select
                  value={novoMaterial.tipo}
                  onChange={(e) => setNovoMaterial({ ...novoMaterial, tipo: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="PDF">PDF</option>
                  <option value="Vídeo">Vídeo</option>
                  <option value="Link">Link</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Instrumento</label>
                <select
                  value={novoMaterial.instrumento}
                  onChange={(e) => setNovoMaterial({ ...novoMaterial, instrumento: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="todos">Todos os instrumentos</option>
                  {INSTRUMENTOS.map((inst) => (
                    <option key={inst.id} value={inst.id}>Só {nomeInstrumento(inst.id)}</option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Link</label>
                <input
                  type="text"
                  value={novoMaterial.link}
                  onChange={(e) => setNovoMaterial({ ...novoMaterial, link: e.target.value })}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={salvandoMaterial}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm disabled:opacity-60"
                >
                  {salvandoMaterial ? 'Salvando...' : 'Adicionar Material'}
                </button>
              </div>
            </form>

            <div className="space-y-2">
              {materiaisCadastrados.map((mat) => (
                <div key={mat.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{mat.titulo}</p>
                    <p className="text-xs text-slate-500">
                      {mat.tipo} · {mat.instrumento === 'todos' ? 'Todos os instrumentos' : nomeInstrumento(mat.instrumento)}
                    </p>
                    <a href={mat.link} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 hover:underline break-all">{mat.link}</a>
                  </div>
                  <button
                    onClick={() => removerMaterial(mat.id)}
                    className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </button>
                </div>
              ))}
              {materiaisCadastrados.length === 0 && (
                <div className="text-center py-8 bg-slate-50 rounded-lg border border-dashed border-slate-300">
                  <Upload className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 font-medium text-sm">Nenhum material cadastrado ainda.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {abaAtiva === 'configuracoes' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-2xl mx-auto">
            <h2 className="text-xl font-bold text-slate-800 mb-1 flex items-center gap-2">
              <Settings className="w-6 h-6 text-emerald-600" /> Configurações — Cadastro do Proprietário
            </h2>
            <p className="text-xs text-slate-500 mb-6">
              Esses dados passam a aparecer no rodapé de todo recibo de pagamento gerado (aba Pagamentos e
              Portal da Igreja), identificando quem está emitindo o recibo — útil pra controle fiscal.
            </p>

            {mensagemProprietario && (
              <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-lg text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>{mensagemProprietario}</span>
              </div>
            )}

            <form onSubmit={salvarProprietario} className="space-y-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Nome completo (ou razão social)</label>
                <input
                  type="text"
                  value={formProprietario.nome}
                  onChange={(e) => setFormProprietario({ ...formProprietario, nome: e.target.value })}
                  placeholder="Ex: Daniel Basílio"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">CPF (ou CNPJ)</label>
                <input
                  type="text"
                  value={formProprietario.cpf}
                  onChange={(e) => setFormProprietario({ ...formProprietario, cpf: e.target.value })}
                  placeholder="000.000.000-00"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Endereço completo</label>
                <textarea
                  value={formProprietario.endereco}
                  onChange={(e) => setFormProprietario({ ...formProprietario, endereco: e.target.value })}
                  placeholder="Rua, número, bairro, cidade - UF, CEP"
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={salvandoProprietario}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-sm disabled:opacity-60"
              >
                {salvandoProprietario ? 'Salvando...' : 'Salvar Dados'}
              </button>
            </form>
          </div>
        )}

        {abaAtiva === 'novo' && (
          <div className="bg-white p-6 sm:p-8 rounded-xl shadow-sm border border-slate-200 max-w-3xl mx-auto">
            <h2 className="text-xl font-bold text-slate-800 mb-6 pb-4 border-b border-slate-100 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-emerald-600" /> Cadastro e Agendamento
            </h2>

            {mensagemSucesso && (
              <div className="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-lg text-sm flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>{mensagemSucesso}</span>
              </div>
            )}

            {erroAgendamento && (
              <div className="mb-6 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>{erroAgendamento}</span>
              </div>
            )}

            <form onSubmit={handleAgendar} className="space-y-8">

              {/* Passo 1: Polo */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                  <span className="bg-emerald-600 text-white w-5 h-5 rounded-full inline-flex items-center justify-center text-xs">1</span>
                  Selecione o Polo de Ensino
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {LOCALIZACOES.map((local) => (
                    <div
                      key={local.id}
                      onClick={() => { setPoloSelecionado(local.id); setInstrumentoSelecionado(''); setVagaSelecionada(''); }}
                      className={`cursor-pointer rounded-lg border-2 p-4 flex flex-col items-center text-center transition-all ${poloSelecionado === local.id ? 'border-emerald-600 bg-emerald-50 text-emerald-800 shadow-sm' : 'border-slate-200 hover:border-emerald-300 text-slate-600'}`}
                    >
                      <MapPin className={`w-6 h-6 mb-1 ${poloSelecionado === local.id ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className="font-bold text-sm">{local.nome}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Passo 2: Instrumento */}
              {poloSelecionado && (
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <span className="bg-emerald-600 text-white w-5 h-5 rounded-full inline-flex items-center justify-center text-xs">2</span>
                    Turma / Instrumento
                  </label>
                  <div className={`grid grid-cols-1 gap-3 ${instrumentosDoPolo.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                    {instrumentosDoPolo.map((inst) => (
                      <div
                        key={inst.id}
                        onClick={() => { setInstrumentoSelecionado(inst.id); setVagaSelecionada(''); }}
                        className={`cursor-pointer rounded-lg border-2 p-4 flex flex-col items-center transition-all ${instrumentoSelecionado === inst.id ? 'border-emerald-600 bg-emerald-50 text-emerald-800 shadow-sm' : 'border-slate-200 hover:border-emerald-300 text-slate-600'}`}
                      >
                        <inst.Icone className="w-6 h-6" />
                        <span className="mt-1 font-bold text-sm">{inst.nome}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Passo 3: Dia e horário */}
              {poloSelecionado && instrumentoSelecionado && (
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <span className="bg-emerald-600 text-white w-5 h-5 rounded-full inline-flex items-center justify-center text-xs">3</span>
                    Escolha o Dia e Horário Disponível
                  </label>
                  <div className="space-y-4">
                    {Object.keys(vagasPorDia).map((dia) => (
                      <div key={dia} className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 border-b border-slate-200 flex justify-between items-center">
                          {dia}
                          {dia.includes('Quinzenal') && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full uppercase tracking-wide">A cada 15 dias</span>
                          )}
                        </div>
                        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                          {vagasPorDia[dia].map((vaga) => (
                            <button
                              key={vaga.id}
                              type="button"
                              disabled={vaga.ocupada}
                              onClick={() => setVagaSelecionada(vaga.id)}
                              className={`py-2 px-2 rounded-md text-xs font-medium flex flex-col items-center border transition-all
                                ${vaga.ocupada ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed' :
                                  vagaSelecionada === vaga.id ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' :
                                  'bg-white text-slate-700 border-slate-300 hover:border-emerald-500 hover:text-emerald-700'}`}
                            >
                              <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {vaga.horarioLabel}</span>
                              {vaga.ocupada && <span className="mt-0.5 text-[10px] font-bold text-red-400">Reservado</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Passo 4: Dados do aluno */}
              {vagaSelecionada && (
                <div className="bg-slate-50 p-5 rounded-lg border border-slate-200">
                  <label className="block text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <span className="bg-emerald-600 text-white w-5 h-5 rounded-full inline-flex items-center justify-center text-xs">4</span>
                    Dados do Aluno
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Nome Completo</label>
                      <input
                        type="text"
                        required
                        value={dadosAluno.nome}
                        onChange={(e) => setDadosAluno({ ...dadosAluno, nome: e.target.value })}
                        placeholder="Ex: João da Silva"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Telefone / WhatsApp</label>
                      <input
                        type="text"
                        value={dadosAluno.telefone}
                        onChange={(e) => setDadosAluno({ ...dadosAluno, telefone: e.target.value })}
                        placeholder="(35) 99999-9999"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">E-mail</label>
                      <input
                        type="email"
                        required
                        value={dadosAluno.email}
                        onChange={(e) => setDadosAluno({ ...dadosAluno, email: e.target.value })}
                        placeholder="joao@email.com"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Senha de Acesso (Portal do Aluno)</label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={dadosAluno.senha}
                        onChange={(e) => setDadosAluno({ ...dadosAluno, senha: e.target.value })}
                        placeholder="Mínimo 6 caracteres"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-3">
                    Já tem cadastro? Usa o mesmo e-mail e senha aqui pra agendar outra aula na mesma conta.
                  </p>
                </div>
              )}

              <div className="pt-2 flex gap-3">
                {vagaSelecionada && (
                  <button
                    type="submit"
                    disabled={salvandoAgendamento}
                    className="flex-1 bg-emerald-600 text-white font-bold py-2.5 rounded-lg text-sm hover:bg-emerald-700 transition shadow-sm disabled:opacity-60"
                  >
                    {salvandoAgendamento ? 'Agendando...' : 'Confirmar Vaga e Agendar'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAbaAtiva(souAdmin ? 'gerenciar' : 'painel')}
                  className="px-4 py-2.5 border border-slate-300 text-slate-600 font-medium rounded-lg text-sm hover:bg-slate-50 transition"
                >
                  Voltar
                </button>
              </div>
            </form>
          </div>
        )}

        {abaAtiva === 'loginAluno' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-sm mx-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
              <LogIn className="w-5 h-5 text-emerald-600" /> Portal do Aluno
            </h2>
            <p className="text-xs text-slate-500 mb-4">Entre com o e-mail e senha que você criou no cadastro.</p>

            {erroLoginAluno && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{erroLoginAluno}</span>
              </div>
            )}

            <form onSubmit={fazerLoginAluno} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={emailAluno}
                  onChange={(e) => setEmailAluno(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Senha</label>
                <input
                  type="password"
                  required
                  value={senhaAluno}
                  onChange={(e) => setSenhaAluno(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="submit"
                  className="w-full bg-emerald-600 text-white font-medium py-2 rounded-lg text-sm hover:bg-emerald-700 transition shadow-sm"
                >
                  Acessar Meu Portal
                </button>
                <button
                  type="button"
                  onClick={() => setAbaAtiva('novo')}
                  className="w-full px-3 py-2 border border-slate-300 text-slate-600 font-medium rounded-lg text-sm hover:bg-slate-50 transition text-center"
                >
                  Ainda não tenho cadastro
                </button>
              </div>
            </form>
          </div>
        )}

        {abaAtiva === 'loginIgreja' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-sm mx-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
              <LogIn className="w-5 h-5 text-emerald-600" /> Portal da Igreja
            </h2>
            <p className="text-xs text-slate-500 mb-4">Entre com o e-mail e a senha que a coordenação criou pra sua igreja.</p>

            {erroLoginIgreja && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{erroLoginIgreja}</span>
              </div>
            )}

            <form onSubmit={fazerLoginIgreja} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">E-mail</label>
                <input
                  type="email"
                  required
                  value={emailIgreja}
                  onChange={(e) => setEmailIgreja(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Senha</label>
                <input
                  type="password"
                  required
                  value={senhaIgreja}
                  onChange={(e) => setSenhaIgreja(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full bg-emerald-600 text-white font-medium py-2 rounded-lg text-sm hover:bg-emerald-700 transition shadow-sm"
                >
                  Acessar Portal da Igreja
                </button>
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                Ainda não tem acesso? Fale com a coordenação do Acordes de Davi.
              </p>
            </form>
          </div>
        )}

        {abaAtiva === 'portal' && (
          souAluno ? (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-emerald-500 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    Olá, {meusAgendamentos[0]?.nome || 'aluno(a)'}!
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">{usuario.email}</p>
                </div>
                <button
                  onClick={fazerLogout}
                  className="px-4 py-2 text-sm font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition w-full sm:w-auto"
                >
                  Sair da Conta
                </button>
              </div>

              {meusAgendamentos.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-6">
                  <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <p className="text-slate-500 font-medium">Você ainda não tem nenhuma aula agendada.</p>
                  <button
                    onClick={() => setAbaAtiva('novo')}
                    className="mt-4 inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition"
                  >
                    Agendar Aula
                  </button>
                </div>
              ) : (
                <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1 space-y-4">
                    {meusAgendamentos.map((item) => (
                      <div key={item.id} className="bg-emerald-800 text-white rounded-xl shadow-sm p-5">
                        <div className="flex items-center text-emerald-200 mb-1 gap-2 text-xs font-semibold uppercase tracking-wide">
                          <MapPin className="w-4 h-4" /> {LOCALIZACOES.find(l => l.id === item.local)?.nome}
                        </div>
                        <h3 className="text-lg font-bold leading-tight capitalize">{item.instrumento} — {item.dia || 'Horário a combinar'}</h3>
                        <div className="mt-3 bg-emerald-900/40 rounded-lg p-3 flex items-center gap-2">
                          <Clock className="w-5 h-5 text-emerald-300" />
                          <span className="font-bold">{item.horarioLabel || item.horario || 'A combinar'}</span>
                        </div>
                        <p className="text-xs text-emerald-200 mt-3">
                          {item.pago ? 'Pagamento em dia.' : 'Pagamento pendente — fale com a coordenação.'}
                        </p>

                        {!item.pago && (
                          item.valorCombinado ? (
                            <button
                              onClick={() => pagarComPix(item)}
                              disabled={gerandoPix}
                              className="mt-3 w-full bg-white hover:bg-emerald-50 disabled:opacity-60 text-emerald-800 px-3 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                              {gerandoPix && pixEmAndamento !== item.id ? 'Gerando Pix...' : `Pagar ${formatarBRL(item.valorCombinado)} com Pix`}
                            </button>
                          ) : (
                            <p className="text-[11px] text-emerald-300 mt-3 italic">Aguardando a coordenação combinar o valor do pagamento.</p>
                          )
                        )}
                      </div>
                    ))}

                    {erroPix && (
                      <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{erroPix}</span>
                      </div>
                    )}

                    {dadosPix && (
                      <div className="bg-white border-4 border-double border-emerald-700 rounded-2xl p-6 text-center shadow-xl">
                        <h3 className="text-base font-bold text-emerald-900 mb-1">Pagamento via Pix</h3>
                        <p className="text-xs text-slate-500 mb-4">Escaneie o QR Code ou copie o código no app do seu banco.</p>
                        {dadosPix.qrCodeBase64 && (
                          <img
                            src={`data:image/png;base64,${dadosPix.qrCodeBase64}`}
                            alt="QR Code Pix"
                            className="mx-auto mb-4 w-48 h-48 rounded-lg border border-slate-200"
                          />
                        )}
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(dadosPix.qrCode || '').then(() => {
                              setMensagemSucesso('Código Pix copiado!');
                              setTimeout(() => setMensagemSucesso(''), 3000);
                            }).catch(() => {
                              setMensagemSucesso('Não foi possível copiar automaticamente — copie o código manualmente.');
                              setTimeout(() => setMensagemSucesso(''), 4000);
                            });
                          }}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition mb-2"
                        >
                          Copiar código Pix
                        </button>
                        <button
                          onClick={() => { setDadosPix(null); setPixEmAndamento(null); }}
                          className="w-full text-xs text-slate-500 hover:text-slate-700 transition"
                        >
                          Cancelar
                        </button>
                        <p className="text-[11px] text-slate-400 mt-4">
                          A confirmação é automática — assim que o pagamento cair, essa tela fecha sozinha e o status muda pra "Pagamento em dia".
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="lg:col-span-2 bg-white rounded-xl shadow-sm p-6 border border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                      <BookOpen className="w-5 h-5 text-emerald-600" /> Material Didático (Prática em Casa)
                    </h3>
                    <div className="space-y-3">
                      {materiaisCadastrados
                        .filter((mat) => mat.instrumento === 'todos' || mat.instrumento === meusAgendamentos[0]?.instrumento)
                        .map((mat) => (
                          <a
                            key={mat.id}
                            href={mat.link}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition"
                          >
                            <div>
                              <p className="text-sm font-bold text-slate-800">{mat.titulo}</p>
                              <p className="text-xs text-slate-500 uppercase tracking-wide">{mat.tipo}</p>
                            </div>
                            <span className="text-xs font-semibold text-emerald-700 border border-emerald-200 bg-white px-3 py-1.5 rounded-lg">Abrir</span>
                          </a>
                        ))}
                    </div>
                    {materiaisCadastrados.filter((mat) => mat.instrumento === 'todos' || mat.instrumento === meusAgendamentos[0]?.instrumento).length === 0 && (
                      <p className="text-xs text-slate-400 mt-4">
                        Nenhum material disponível ainda — a coordenação ainda vai subir o conteúdo aqui.
                      </p>
                    )}
                  </div>

                  <div className="lg:col-span-3 bg-white rounded-xl shadow-sm p-6 border border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                      <CheckSquare className="w-5 h-5 text-emerald-600" /> Histórico de Frequência
                    </h3>
                    {(() => {
                      const meusIds = new Set(meusAgendamentos.map((item) => item.id));
                      const minhasPresencas = presencasCadastradas
                        .filter((p) => meusIds.has(p.agendamentoId))
                        .sort((a, b) => (a.data < b.data ? 1 : -1));
                      if (minhasPresencas.length === 0) {
                        return <p className="text-xs text-slate-400">Nenhuma chamada registrada ainda.</p>;
                      }
                      return (
                        <div className="space-y-2">
                          {minhasPresencas.map((p) => (
                            <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg border border-slate-100 bg-slate-50 text-sm">
                              <span className="text-slate-700 font-medium">{formatarDataCalendario(p.data)}</span>
                              <span className={`px-3 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${p.presente ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                {p.presente ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                {p.presente ? 'PRESENTE' : 'FALTOU'}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="lg:col-span-3 bg-white rounded-xl shadow-sm p-6 border border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                      <Award className="w-5 h-5 text-emerald-600" /> Avaliações de Desempenho
                    </h3>
                    {(() => {
                      const meusIds = new Set(meusAgendamentos.map((item) => item.id));
                      const minhasAvaliacoes = avaliacoesCadastradas
                        .filter((a) => meusIds.has(a.agendamentoId))
                        .sort((a, b) => (a.data < b.data ? 1 : -1));
                      if (minhasAvaliacoes.length === 0) {
                        return <p className="text-xs text-slate-400">A coordenação ainda não deixou nenhuma avaliação por aqui.</p>;
                      }
                      return (
                        <div className="space-y-3">
                          {minhasAvaliacoes.map((a) => (
                            <div key={a.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                              <p className="text-xs font-semibold text-emerald-700 mb-1">{formatarDataCalendario(a.data)}</p>
                              <p className="text-sm text-slate-700 whitespace-pre-wrap">{a.texto}</p>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {(() => {
                  const integrantes = LOCALIZACOES.find(l => l.id === meusAgendamentos[0]?.local)?.integrantesBanda || [];
                  if (integrantes.length === 0) return null;
                  return (
                    <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
                      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                        <Users className="w-5 h-5 text-emerald-600" /> Integrantes da Banda
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {integrantes.map((integrante) => (
                          <div key={integrante.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                            <span className="text-sm font-medium text-slate-700">{integrante.nome}</span>
                            <span className="text-xs font-semibold uppercase text-emerald-700">{integrante.funcao}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                </>
              )}
            </div>
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-6 max-w-md mx-auto">
              <User className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 font-medium">Faça login pra ver seu portal.</p>
              <button
                onClick={() => setAbaAtiva('loginAluno')}
                className="mt-4 inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition"
              >
                Entrar
              </button>
            </div>
          )
        )}

        {abaAtiva === 'portalIgreja' && (
          souIgreja ? (
            minhaIgreja ? (
              <div className="max-w-5xl mx-auto space-y-6">
                <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-emerald-500 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">Olá, {minhaIgreja.nome}!</h2>
                    <p className="text-sm text-slate-500 mt-1">
                      Polo: {LOCALIZACOES.find(l => l.id === minhaIgreja.poloId)?.nome || 'Polo não encontrado'}
                      {minhaIgreja.responsavel ? ` · ${minhaIgreja.responsavel}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={fazerLogout}
                    className="px-4 py-2 text-sm font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition w-full sm:w-auto"
                  >
                    Sair da Conta
                  </button>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <DollarSign className="w-5 h-5 text-emerald-600" /> Pagamento do Pacote
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase">Valor combinado</p>
                      <p className="text-sm font-bold text-slate-800">{minhaIgreja.valorCombinado ? formatarBRL(minhaIgreja.valorCombinado) : 'A combinar'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase">Forma</p>
                      <p className="text-sm font-bold text-slate-800 capitalize">{minhaIgreja.formaPagamento || 'Pix'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase">Data do pagamento</p>
                      <p className="text-sm font-bold text-slate-800">{minhaIgreja.dataPagamento ? new Date(minhaIgreja.dataPagamento + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase">Status</p>
                      <span className={`inline-block mt-0.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${minhaIgreja.pago ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {minhaIgreja.pago ? 'PAGO ✓' : 'PENDENTE ✕'}
                      </span>
                    </div>
                  </div>

                  {!minhaIgreja.pago && (
                    minhaIgreja.valorCombinado ? (
                      <button
                        onClick={() => gerarPixIgreja(minhaIgreja)}
                        disabled={gerandoPixIgreja}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-3 py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                      >
                        <DollarSign className="w-3.5 h-3.5" />
                        {gerandoPixIgreja ? 'Gerando Pix...' : `Pagar ${formatarBRL(minhaIgreja.valorCombinado)} com Pix`}
                      </button>
                    ) : (
                      <p className="text-xs text-slate-400 italic">Aguardando a coordenação combinar o valor do pacote.</p>
                    )
                  )}

                  {erroPixIgreja && (
                    <div className="mt-3 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{erroPixIgreja}</span>
                    </div>
                  )}

                  {dadosPixIgreja && (
                    <div className="mt-4 bg-white border-4 border-double border-emerald-700 rounded-2xl p-6 text-center shadow-xl max-w-sm mx-auto">
                      <h3 className="text-base font-bold text-emerald-900 mb-1">Pagamento via Pix</h3>
                      <p className="text-xs text-slate-500 mb-4">Escaneie o QR Code ou copie o código no app do banco.</p>
                      {dadosPixIgreja.qrCodeBase64 && (
                        <img
                          src={`data:image/png;base64,${dadosPixIgreja.qrCodeBase64}`}
                          alt="QR Code Pix"
                          className="mx-auto mb-4 w-48 h-48 rounded-lg border border-slate-200"
                        />
                      )}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(dadosPixIgreja.qrCode || '').then(() => {
                            setMensagemSucesso('Código Pix copiado!');
                            setTimeout(() => setMensagemSucesso(''), 3000);
                          }).catch(() => {
                            setMensagemSucesso('Não foi possível copiar automaticamente — copie o código manualmente.');
                            setTimeout(() => setMensagemSucesso(''), 4000);
                          });
                        }}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition mb-2"
                      >
                        Copiar código Pix
                      </button>
                      <button
                        onClick={() => { setDadosPixIgreja(null); setIgrejaComPixAberto(null); }}
                        className="w-full text-xs text-slate-500 hover:text-slate-700 transition"
                      >
                        Cancelar
                      </button>
                      <p className="text-[11px] text-slate-400 mt-4">
                        A confirmação é automática — assim que o pagamento cair, essa tela atualiza sozinha.
                      </p>
                    </div>
                  )}

                  {minhaIgreja.dataPagamento && (
                    <button
                      onClick={() => abrirReciboIgreja(minhaIgreja)}
                      className="mt-3 w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5"
                    >
                      <Printer className="w-3.5 h-3.5" /> Gerar Recibo (em nome da igreja)
                    </button>
                  )}
                </div>

                {(() => {
                  const integrantes = LOCALIZACOES.find(l => l.id === minhaIgreja.poloId)?.integrantesBanda || [];
                  if (integrantes.length === 0) return null;
                  return (
                    <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
                      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                        <Users className="w-5 h-5 text-emerald-600" /> Integrantes da Banda
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {integrantes.map((integrante) => (
                          <div key={integrante.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                            <span className="text-sm font-medium text-slate-700">{integrante.nome}</span>
                            <span className="text-xs font-semibold uppercase text-emerald-700">{integrante.funcao}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
                  <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Users className="w-5 h-5 text-emerald-600" /> Alunos do seu polo
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    {meusAlunosIgreja.length} aluno(s) — clique num aluno pra ver o histórico de frequência e as avaliações de desempenho.
                  </p>
                  {meusAlunosIgreja.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-6">Nenhum aluno registrado nesse polo ainda.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                            <th className="p-3">Aluno</th>
                            <th className="p-3">Instrumento</th>
                            <th className="p-3 text-center">Última aula</th>
                            <th className="p-3 text-center">Detalhes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {meusAlunosIgreja.map((item) => {
                            const presencasDoAluno = presencasCadastradas
                              .filter((p) => p.agendamentoId === item.id)
                              .sort((a, b) => (a.data < b.data ? 1 : -1));
                            const avaliacoesDoAluno = avaliacoesCadastradas
                              .filter((a) => a.agendamentoId === item.id)
                              .sort((a, b) => (a.data < b.data ? 1 : -1));
                            const ultimaPresenca = presencasDoAluno[0];
                            const expandido = igrejaAlunoExpandido === item.id;
                            return (
                              <React.Fragment key={item.id}>
                                <tr
                                  onClick={() => setIgrejaAlunoExpandido(expandido ? null : item.id)}
                                  className="hover:bg-slate-50 transition cursor-pointer"
                                >
                                  <td className="p-3 font-bold text-slate-800">{item.nome}</td>
                                  <td className="p-3 text-xs text-slate-600 capitalize">{item.instrumento}</td>
                                  <td className="p-3 text-center">
                                    {ultimaPresenca ? (
                                      <span className={`px-3 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${ultimaPresenca.presente ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                        {ultimaPresenca.presente ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                        {formatarDataCalendario(ultimaPresenca.data)}
                                      </span>
                                    ) : (
                                      <span className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-500">Sem chamada ainda</span>
                                    )}
                                  </td>
                                  <td className="p-3 text-center text-xs text-emerald-600 font-semibold whitespace-nowrap">
                                    {expandido ? 'Ocultar ▲' : 'Ver detalhes ▾'}
                                  </td>
                                </tr>
                                {expandido && (
                                  <tr>
                                    <td colSpan={4} className="p-4 bg-slate-50">
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                          <p className="text-xs font-bold text-slate-600 uppercase mb-2">Histórico de Frequência</p>
                                          {presencasDoAluno.length === 0 ? (
                                            <p className="text-xs text-slate-400">Nenhuma chamada registrada ainda.</p>
                                          ) : (
                                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                              {presencasDoAluno.map((p) => (
                                                <div key={p.id} className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                                                  <span className="text-slate-600">{formatarDataCalendario(p.data)}</span>
                                                  <span className={`font-bold ${p.presente ? 'text-emerald-700' : 'text-slate-400'}`}>
                                                    {p.presente ? 'PRESENTE' : 'FALTOU'}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                        <div>
                                          <p className="text-xs font-bold text-slate-600 uppercase mb-2">Avaliações de Desempenho</p>
                                          {avaliacoesDoAluno.length === 0 ? (
                                            <p className="text-xs text-slate-400">Nenhuma avaliação registrada ainda.</p>
                                          ) : (
                                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                              {avaliacoesDoAluno.map((a) => (
                                                <div key={a.id} className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                                                  <p className="text-[11px] font-bold text-emerald-700">{formatarDataCalendario(a.data)}</p>
                                                  <p className="text-xs text-slate-600 whitespace-pre-wrap">{a.texto}</p>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-6 max-w-md mx-auto">
                <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-2" />
                <p className="text-slate-500 font-medium">Não encontrei o cadastro da sua igreja. Fale com a coordenação.</p>
              </div>
            )
          ) : (
            <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-6 max-w-md mx-auto">
              <BookOpen className="w-12 h-12 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 font-medium">Faça login pra ver o portal da sua igreja.</p>
              <button
                onClick={() => setAbaAtiva('loginIgreja')}
                className="mt-4 inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition"
              >
                Entrar
              </button>
            </div>
          )
        )}

        {abaAtiva === 'login' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-sm mx-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
              <LogIn className="w-5 h-5 text-emerald-600" /> Acesso do Administrador
            </h2>
            <p className="text-xs text-slate-500 mb-4">Digite seu e-mail e senha do Firebase abaixo para conectar.</p>
            
            {erroLogin && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{erroLogin}</span>
              </div>
            )}

            <form onSubmit={fazerLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">E-mail</label>
                <input 
                  type="email" 
                  required
                  value={emailAdmin}
                  onChange={(e) => setEmailAdmin(e.target.value)}
                  placeholder="ex: auladeinstrumentos@..." 
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Senha</label>
                <input 
                  type="password" 
                  required
                  value={senhaAdmin}
                  onChange={(e) => setSenhaAdmin(e.target.value)}
                  placeholder="••••••••" 
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button 
                  type="submit"
                  className="w-full bg-emerald-600 text-white font-medium py-2 rounded-lg text-sm hover:bg-emerald-700 transition shadow-sm"
                >
                  Entrar no Painel
                </button>
                <button 
                  type="button"
                  onClick={() => setAbaAtiva('painel')}
                  className="w-full px-3 py-2 border border-slate-300 text-slate-600 font-medium rounded-lg text-sm hover:bg-slate-50 transition text-center"
                >
                  Voltar
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 mt-8 py-4 text-center text-xs text-slate-500 print:hidden">
        Projeto Acordes de Davi &bull; Sistema Integrado com Firebase
      </footer>
    </div>
    </>
  );
}
