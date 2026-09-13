import React, { useState, useEffect, useMemo } from 'react';
import { BookOpen, Calendar, Clock, Music, Guitar, User, LogIn, LogOut, CheckCircle, AlertTriangle, Users, MapPin, Trash2, Settings, PlusCircle, Upload, FileText, CheckSquare, Square, DollarSign, Award, Printer, Download, KeyRound, Pencil } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';

// E-mail que tem acesso de administrador. Todo outro login vira "aluno".
const ADMIN_EMAIL = 'auladeinstrumentosmusicais2026@gmail.com';

// Polos padrão — usados só como "semente" pra popular a coleção "polos" do Firestore
// na primeira vez (botão "Restaurar polos padrão" na aba Horários). A partir daí, quem
// manda na lista de polos é o admin, pela tela — não mais o código (igual já funciona
// pra grade de turmas/horários).
const POLOS_PADRAO = [
  { id: 'saoluiz', nome: 'São Luiz', descricao: 'Aulas quinzenais — Violão às sextas, Bateria aos sábados.' },
  { id: 'matafria', nome: 'Mata Fria / Penha do Côco', descricao: 'Bateria pela manhã e Violão à tarde, conforme a agenda de São Luiz.' },
  { id: 'chale', nome: 'Chalé', descricao: 'Aulas de Violão aos domingos (quinzenal).' }
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

const INSTRUMENTOS = [
  { id: 'violao', nome: 'Turma de Violão', Icone: Guitar },
  { id: 'bateria', nome: 'Turma de Bateria', Icone: Music }
];

// Valores fixos usados como SUGESTÃO automática ao gerar um recibo — o campo de valor
// no recibo sempre fica editável, então isso nunca trava um caso fora da regra.
// Pacote é por polo (chave = id do polo); polo pacote que não está no mapa (ex: um polo
// novo criado pela tela, ou o Tabernáculo/Penha do Côco) cai no valor padrão de pacote.
const VALOR_PACOTE_POR_POLO = {
  saoluiz: 600,
  chale: 500
};
const VALOR_PACOTE_PADRAO_OUTROS = 300; // ex: Tabernáculo / Penha do Côco
const VALOR_AULA_INDIVIDUAL = 25;

// Sugere o valor do recibo: individual = valor da aula x quantidade de aulas;
// pacote = valor fechado do polo (com fallback pro valor padrão de outros polos).
const valorSugeridoRecibo = (item, polo, quantidadeAulas = 1) => {
  if (item?.tipoPagamento === 'individual') {
    return VALOR_AULA_INDIVIDUAL * quantidadeAulas;
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

// Materiais de estudo — placeholder até haver arquivos reais vinculados
const MATERIAIS = {
  violao: [
    { titulo: 'Acordes Básicos C, D, G', tipo: 'PDF' },
    { titulo: 'Exercício de Dedilhado 1', tipo: 'Vídeo' },
    { titulo: 'Escala Maior - Shape 1', tipo: 'PDF' }
  ],
  bateria: [
    { titulo: 'Virada Simples 4x4', tipo: 'Vídeo' },
    { titulo: 'Coordenação Mão/Pé - Exercício 1', tipo: 'PDF' },
    { titulo: 'Ritmo Básico de Rock', tipo: 'Vídeo' }
  ]
};

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

export default function App() {
  const [agendamentos, setAgendamentos] = useState([]);
  const [vagasOcupadas, setVagasOcupadas] = useState([]);
  const [turmasCadastradas, setTurmasCadastradas] = useState([]);
  const [polosCadastrados, setPolosCadastrados] = useState([]);

  // --- Gestão de horários (admin) ---
  const [novaTurma, setNovaTurma] = useState({ local: 'saoluiz', instrumento: 'violao', dia: '', inicio: '', fim: '', duracao: 40 });
  const [erroTurma, setErroTurma] = useState('');
  const [salvandoTurma, setSalvandoTurma] = useState(false);

  // --- Gestão de polos (admin) ---
  const [novoPolo, setNovoPolo] = useState({ nome: '', descricao: '' });
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

    // Lista completa de agendamentos — as regras do Firestore garantem que só o admin
    // recebe todos os documentos; um aluno logado só recebe os próprios.
    const unsubscribe = onSnapshot(collection(db, 'agendamentos'), (snapshot) => {
      const lista = snapshot.docs.map(docItem => ({
        id: docItem.id,
        ...docItem.data()
      }));
      setAgendamentos(lista);
      setLoading(false);
    }, (error) => {
      console.error("Erro ao buscar agendamentos do Firestore:", error);
      setLoading(false);
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

    return () => {
      unsubAuth();
      unsubscribe();
      unsubVagas();
      unsubTurmas();
      unsubPolos();
      unsubIgrejas();
    };
  }, []);

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
          try {
            credencial = await signInWithEmailAndPassword(auth, dadosAluno.email, dadosAluno.senha);
          } catch (errLogin) {
            setErroAgendamento('Esse e-mail já tem cadastro, mas a senha não confere. Confira a senha ou entre pelo "Portal do Aluno".');
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
          // (São Luiz, Chalé, Tabernáculo, e qualquer polo novo) começam como pacote —
          // o admin ajusta exceção por exceção na aba Pagamentos se precisar.
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
    setEditandoAluno({
      id: item.id,
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
        return salvo ? { id: def.id, nome: salvo.nome ?? def.nome, descricao: salvo.descricao ?? def.descricao } : def;
      })
      .filter(Boolean),
    ...polosCadastrados
      .filter(p => !idsPadrao.has(p.id) && !p.removido)
      .map(p => ({ id: p.id, nome: p.nome, descricao: p.descricao }))
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
        criadoEm: new Date().toISOString()
      });
      setNovoPolo({ nome: '', descricao: '' });
    } catch (err) {
      console.error('Erro ao criar polo:', err);
      setErroPolo('Erro ao salvar o polo. Tente novamente.');
    } finally {
      setSalvandoPolo(false);
    }
  };

  const iniciarEdicaoPolo = (polo) => setEditandoPolo({ id: polo.id, nome: polo.nome, descricao: polo.descricao || '' });
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
        descricao: editandoPolo.descricao.trim()
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
    return Array.from(mapa.values()).filter(grupo => grupo.length > 1);
  }, [agendamentos]);

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

  // Agendamentos do próprio aluno logado (as regras do Firestore já garantem
  // que "agendamentos" só traz os dele quando não é admin, mas filtramos de novo por clareza)
  const meusAgendamentos = usuario ? agendamentos.filter(item => item.uid === usuario.uid) : [];

  // Igreja logada no Portal da Igreja e os alunos do polo que ela mantém — as regras do
  // Firestore já garantem que "agendamentos" só traz os alunos daquele polo pra essa
  // conta (nunca os alunos de outro polo), igual já acontece pro aluno individual.
  const minhaIgreja = usuario ? igrejasCadastradas.find(i => i.uid === usuario.uid) : null;
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
                  onClick={() => setAbaAtiva('igrejas')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'igrejas' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
                >
                  <BookOpen className="w-4 h-4" /> Igrejas
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
                <p className="text-xs text-red-700 -mt-2">Revise cada grupo e exclua o(s) registro(s) que não devem ficar. Nada é apagado automaticamente.</p>
                <div className="space-y-3">
                  {gruposDuplicados.map((grupo, i) => (
                    <div key={i} className="bg-white border border-red-200 rounded-lg p-3">
                      <p className="text-xs font-bold text-slate-700 mb-2">{grupo[0].nome} · {grupo[0].telefone}</p>
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
                  <option value="violao">Violão</option>
                  <option value="bateria">Bateria</option>
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
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white capitalize focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="violao">Violão</option>
                      <option value="bateria">Bateria</option>
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
              <p className="text-xs text-slate-500">Marque a presença dos alunos nas aulas com apenas um clique — separado por polo.</p>
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

                  return (
                    <div key={polo.id}>
                      <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wide flex items-center gap-2 mb-2 pb-2 border-b border-emerald-100">
                        <MapPin className="w-4 h-4" /> {polo.nome}
                        <span className="text-xs font-medium text-slate-400 normal-case">
                          ({alunosDoPolo.length} {alunosDoPolo.length === 1 ? 'aluno' : 'alunos'})
                        </span>
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                              <th className="p-3">Aluno</th>
                              <th className="p-3">Instrumento</th>
                              <th className="p-3 text-center">Presença (Marcar Aula)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 text-sm">
                            {alunosDoPolo.map((item) => (
                              <tr key={item.id} className="hover:bg-slate-50 transition">
                                <td className="p-3 font-bold text-slate-800">{item.nome}</td>
                                <td className="p-3 text-xs text-slate-600 capitalize">{item.instrumento}</td>
                                <td className="p-3 text-center">
                                  <button
                                    onClick={() => alternarPresenca(item.id, item.presenca)}
                                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition inline-flex items-center gap-1.5 ${item.presenca ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                  >
                                    {item.presenca ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                    {item.presenca ? 'PRESENTE' : 'FALTOU / A MARCAR'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
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
                                <span className="truncate">{item.nome}</span>
                                <span className="text-[10px] text-slate-400 capitalize shrink-0">{item.instrumento}</span>
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
                          setValorRecibo(String(VALOR_AULA_INDIVIDUAL * qtd));
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

              <form onSubmit={adicionarPolo} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4">
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
                      <form onSubmit={salvarEdicaoPolo} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
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
                            <span className="text-xs font-semibold uppercase text-emerald-700">{t.instrumento === 'bateria' ? 'Bateria' : 'Violão'}</span>
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
                    placeholder="Ex: Igreja Tabernáculo - Penha do Côco"
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
                      navigator.clipboard.writeText(dadosPixIgreja.qrCode || '');
                      setMensagemSucesso('Código Pix copiado!');
                      setTimeout(() => setMensagemSucesso(''), 3000);
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
                            <button
                              onClick={() => alternarPagamentoIgreja(igreja.id, igreja.pago)}
                              className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition ${igreja.pago ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                            >
                              {igreja.pago ? 'PAGO ✓' : 'PENDENTE ✕'}
                            </button>
                          </div>
                        </div>

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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                            navigator.clipboard.writeText(dadosPix.qrCode || '');
                            setMensagemSucesso('Código Pix copiado!');
                            setTimeout(() => setMensagemSucesso(''), 3000);
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
                      {(MATERIAIS[meusAgendamentos[0]?.instrumento] || []).map((mat, idx) => (
                        <div key={idx} className="flex items-center justify-between p-3 rounded-lg border border-slate-200 hover:border-emerald-300 transition">
                          <div>
                            <p className="text-sm font-bold text-slate-800">{mat.titulo}</p>
                            <p className="text-xs text-slate-500 uppercase tracking-wide">{mat.tipo}</p>
                          </div>
                          <span className="text-xs font-semibold text-slate-400 border border-slate-200 px-3 py-1.5 rounded-lg">Em breve</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-4">
                      Materiais ainda não vinculados a arquivos reais — placeholder até a coordenação subir o conteúdo.
                    </p>
                  </div>
                </div>
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
                          navigator.clipboard.writeText(dadosPixIgreja.qrCode || '');
                          setMensagemSucesso('Código Pix copiado!');
                          setTimeout(() => setMensagemSucesso(''), 3000);
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

                <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
                  <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2 border-b border-slate-100 pb-3">
                    <Users className="w-5 h-5 text-emerald-600" /> Alunos do seu polo
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    {meusAlunosIgreja.length} aluno(s) — frequência conforme a última chamada marcada pela coordenação.
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
                            <th className="p-3 text-center">Frequência</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                          {meusAlunosIgreja.map((item) => (
                            <tr key={item.id}>
                              <td className="p-3 font-bold text-slate-800">{item.nome}</td>
                              <td className="p-3 text-xs text-slate-600 capitalize">{item.instrumento}</td>
                              <td className="p-3 text-center">
                                <span className={`px-3 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 ${item.presenca ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {item.presenca ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                                  {item.presenca ? 'PRESENTE' : 'FALTOU / A MARCAR'}
                                </span>
                              </td>
                            </tr>
                          ))}
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
  );
}
