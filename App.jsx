import React, { useState, useEffect } from 'react';
import { BookOpen, Calendar, Clock, Music, User, LogIn, LogOut, CheckCircle, AlertTriangle, Users, MapPin, Trash2, Settings, PlusCircle, Upload, FileText, CheckSquare, Square, DollarSign, Award, Printer } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';

const LOCALIZACOES = [
  { id: 'saoluiz', nome: 'São Luiz' },
  { id: 'matafria', nome: 'Mata Fria / Penha do Côco' },
  { id: 'chale', nome: 'Chalé' }
];

const firebaseConfig = {
  apiKey: "AIzaSyC1zP4nWqJ6wEwgSMqIo_",
  authDomain: "acordes-de-davi.firebaseapp.com",
  projectId: "acordes-de-davi",
  storageBucket: "acordes-de-davi.appspot.com",
  messagingSenderId: "22623463664",
  appId: "1:22623463664:web:7d7f45f82f4f5bf48fbfc",
  measurementId: "G-K9C7Q7J7D"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export default function App() {
  const [agendamentos, setAgendamentos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState('painel');
  const [usuario, setUsuario] = useState(null);
  
  const [emailAdmin, setEmailAdmin] = useState('');
  const [senhaAdmin, setSenhaAdmin] = useState('');
  const [erroLogin, setErroLogin] = useState('');

  const [filtroLocal, setFiltroLocal] = useState('todos');
  const [filtroInstrumento, setFiltroInstrumento] = useState('todos');

  const [alunoCertificado, setAlunoCertificado] = useState('');
  const [instrumentoCertificado, setInstrumentoCertificado] = useState('Violão');
  const [emitirCertificado, setEmitirCertificado] = useState(false);

  const [novoAgendamento, setNovoAgendamento] = useState({
    nome: '',
    telefone: '',
    local: 'saoluiz',
    instrumento: 'violao',
    data: '',
    horario: '',
    presenca: false,
    tipoPagamento: 'pacote',
    pago: false
  });
  const [mensagemSucesso, setMensagemSucesso] = useState('');
  const [mensagemImportacao, setMensagemImportacao] = useState('');

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

    return () => {
      unsubAuth();
      unsubscribe();
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

  const loginAutomaticoAdmin = async () => {
    try {
      // Pega o primeiro usuário cadastrado no seu auth ou usa o padrão que configurou
      await signInWithEmailAndPassword(auth, emailAdmin || 'auladeinstrumentos.adm@gmail.com', senhaAdmin || '123456');
      setAbaAtiva('gerenciar');
    } catch (err) {
      console.error("Erro ao logar automático:", err);
      setErroLogin('Defina seu e-mail e senha corretos uma vez abaixo para salvar.');
      setAbaAtiva('login');
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

  const salvarAgendamento = async (e) => {
    e.preventDefault();
    if (!novoAgendamento.nome) {
      alert('Por favor, preencha o nome do aluno.');
      return;
    }

    try {
      await addDoc(collection(db, 'agendamentos'), {
        ...novoAgendamento,
        criadoEm: new Date().toISOString()
      });
      setMensagemSucesso('Registro salvo com sucesso!');
      setNovoAgendamento({
        nome: '',
        telefone: '',
        local: 'saoluiz',
        instrumento: 'violao',
        data: '',
        horario: '',
        presenca: false,
        tipoPagamento: 'pacote',
        pago: false
      });
      setTimeout(() => setMensagemSucesso(''), 4000);
    } catch (err) {
      console.error("Erro ao salvar:", err);
      alert('Erro ao salvar no banco de dados.');
    }
  };

  const excluirAgendamento = async (id) => {
    if (window.confirm('Tem certeza que deseja excluir este registro?')) {
      try {
        await deleteDoc(doc(db, 'agendamentos', id));
      } catch (err) {
        console.error("Erro ao excluir:", err);
        alert('Erro ao excluir registro.');
      }
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

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const lines = text.split('\n');
      let importadosCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(/[,;]/).map(c => c.replace(/^["']|["']$/g, '').trim());
        const [nome, telefone, local = 'saoluiz', instrumento = 'violao', data = '', horario = '', tipoPagamento = 'pacote'] = cols;

        if (nome) {
          try {
            await addDoc(collection(db, 'agendamentos'), {
              nome,
              telefone: telefone || '',
              local: local.toLowerCase().includes('mata') ? 'matafria' : local.toLowerCase().includes('chal') ? 'chale' : 'saoluiz',
              instrumento: instrumento.toLowerCase().includes('bat') ? 'bateria' : 'violao',
              data: data || '',
              horario: horario || '',
              presenca: false,
              tipoPagamento: tipoPagamento.toLowerCase().includes('ind') ? 'individual' : 'pacote',
              pago: false,
              criadoEm: new Date().toISOString()
            });
            importadosCount++;
          } catch (err) {
            console.error("Erro ao importar linha:", err);
          }
        }
      }
      setMensagemImportacao(`${importadosCount} registros importados com sucesso da planilha!`);
      setTimeout(() => setMensagemImportacao(''), 6000);
    };
    reader.readAsText(file);
  };

  const agendamentosFiltrados = agendamentos.filter(item => {
    const matchLocal = filtroLocal === 'todos' || item.local === filtroLocal;
    const matchInst = filtroInstrumento === 'todos' || item.instrumento === filtroInstrumento;
    return matchLocal && matchInst;
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <header className="bg-emerald-800 text-white shadow-md print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-3">
            <Music className="w-8 h-8 text-emerald-300" />
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

            {usuario && !usuario.isAnonymous && (
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
              </>
            )}

            <button 
              onClick={() => setAbaAtiva('novo')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'novo' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
            >
              <PlusCircle className="w-4 h-4" /> Novo Cadastro
            </button>
            
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
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition ml-2 ${abaAtiva === 'login' ? 'bg-emerald-900 text-white' : 'bg-emerald-700 hover:bg-emerald-600'}`}
              >
                <LogIn className="w-4 h-4" /> Admin
              </button>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 print:p-0 print:max-w-none">
        {abaAtiva === 'painel' && (
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
                        <span className="text-xs text-slate-400 font-medium">{item.data || 'A combinar'} {item.horario ? `às ${item.horario}` : ''}</span>
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
              <button 
                onClick={() => setAbaAtiva('novo')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
              >
                <PlusCircle className="w-4 h-4" /> Adicionar Novo Aluno
              </button>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-emerald-700 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-900">Importar Alunos via Planilha (CSV)</h3>
                  <p className="text-xs text-emerald-700">Colunas: Nome, Telefone, Local, Instrumento, Data, Horário, TipoPagamento</p>
                </div>
              </div>
              <label className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition shadow-sm inline-flex items-center gap-2 shrink-0">
                <Upload className="w-4 h-4" /> Selecionar CSV
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>

            {mensagemImportacao && (
              <div className="bg-emerald-100 border border-emerald-300 text-emerald-900 p-3 rounded-lg text-xs flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>{mensagemImportacao}</span>
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
                        {item.data ? `${item.data} às ${item.horario}` : 'A combinar'}
                      </td>
                      <td className="p-3">
                        <span className={`text-xs px-2 py-1 rounded font-medium uppercase ${item.pago ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                          {item.tipoPagamento || 'pacote'} - {item.pago ? 'Pago' : 'Pendente'}
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <button 
                          onClick={() => excluirAgendamento(item.id)}
                          className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium transition inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {abaAtiva === 'pauta' && (
          <div className="space-y-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <CheckSquare className="w-6 h-6 text-emerald-600" /> Pauta de Chamada de Alunos
              </h2>
              <p className="text-xs text-slate-500">Marque a presença dos alunos nas aulas com apenas um clique.</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase bg-slate-50">
                    <th className="p-3">Aluno</th>
                    <th className="p-3">Polo / Instrumento</th>
                    <th className="p-3 text-center">Presença (Marcar Aula)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {agendamentos.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 transition">
                      <td className="p-3 font-bold text-slate-800">{item.nome}</td>
                      <td className="p-3 text-xs text-slate-600">
                        <span className="uppercase font-semibold text-emerald-700">{LOCALIZACOES.find(l => l.id === item.local)?.nome}</span> ({item.instrumento})
                      </td>
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
        )}

        {abaAtiva === 'pagamentos' && (
          <div className="space-y-6 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <DollarSign className="w-6 h-6 text-emerald-600" /> Gerenciador de Pagamentos
              </h2>
              <p className="text-xs text-slate-500">Controle o status financeiro de mensalidades (pacotes) e aulas avulsas.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {agendamentos.map((item) => (
                <div key={item.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-xs font-bold uppercase text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                        {item.tipoPagamento === 'individual' ? 'Aula Individual' : 'Pacote Mensal'}
                      </span>
                    </div>
                    <h3 className="font-bold text-slate-800 text-base mt-2">{item.nome}</h3>
                    <p className="text-xs text-slate-500 mt-0.5 uppercase">{LOCALIZACOES.find(l => l.id === item.local)?.nome} - {item.instrumento}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
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
                </div>
              ))}
            </div>
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
                <div className="absolute top-4 right-4 print:hidden">
                  <button 
                    onClick={() => window.print()}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 shadow transition"
                  >
                    <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
                  </button>
                </div>

                <div className="mb-6">
                  <Music className="w-16 h-16 text-emerald-700 mx-auto mb-2" />
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
            )}
          </div>
        )}

        {abaAtiva === 'novo' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-lg mx-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Cadastrar Novo Aluno</h2>
            
            {mensagemSucesso && (
              <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-lg text-sm flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>{mensagemSucesso}</span>
              </div>
            )}

            <form onSubmit={salvarAgendamento} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Nome do Aluno</label>
                <input 
                  type="text" 
                  required
                  value={novoAgendamento.nome}
                  onChange={(e) => setNovoAgendamento({...novoAgendamento, nome: e.target.value})}
                  placeholder="Ex: João da Silva" 
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Telefone / WhatsApp</label>
                <input 
                  type="text" 
                  value={novoAgendamento.telefone}
                  onChange={(e) => setNovoAgendamento({...novoAgendamento, telefone: e.target.value})}
                  placeholder="(35) 99999-9999" 
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Polo / Local</label>
                  <select 
                    value={novoAgendamento.local}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, local: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    {LOCALIZACOES.map(l => (
                      <option key={l.id} value={l.id}>{l.nome}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Instrumento</label>
                  <select 
                    value={novoAgendamento.instrumento}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, instrumento: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="violao">Violão</option>
                    <option value="bateria">Bateria</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Tipo de Pagamento</label>
                  <select 
                    value={novoAgendamento.tipoPagamento}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, tipoPagamento: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="pacote">Pacote Mensal</option>
                    <option value="individual">Aula Individual</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Status Pagamento</label>
                  <select 
                    value={novoAgendamento.pago ? 'sim' : 'nao'}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, pago: e.target.value === 'sim'})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="nao">Pendente</option>
                    <option value="sim">Pago</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Data da Aula</label>
                  <input 
                    type="date" 
                    value={novoAgendamento.data}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, data: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Horário</label>
                  <input 
                    type="time" 
                    value={novoAgendamento.horario}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, horario: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button 
                  type="submit"
                  className="flex-1 bg-emerald-600 text-white font-medium py-2.5 rounded-lg text-sm hover:bg-emerald-700 transition shadow-sm"
                >
                  Salvar Cadastro
                </button>
                <button 
                  type="button"
                  onClick={() => setAbaAtiva(usuario && !usuario.isAnonymous ? 'gerenciar' : 'painel')}
                  className="px-4 py-2.5 border border-slate-300 text-slate-600 font-medium rounded-lg text-sm hover:bg-slate-50 transition"
                >
                  Voltar
                </button>
              </div>
            </form>
          </div>
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
