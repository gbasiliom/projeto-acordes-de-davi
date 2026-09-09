import React, { useState, useEffect, useMemo } from 'react';
import { BookOpen, Calendar, Clock, Music, User, LogIn, CheckCircle, AlertTriangle, Users, MapPin } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc } from 'firebase/firestore';

const LOCALIZACOES = [
  { id: 'saoluiz', nome: 'São Luiz' },
  { id: 'matafria', nome: 'Mata Fria / Penha do Côco' },
  { id: 'chale', nome: 'Chalé' }
];

const INSTRUMENTOS = [
  { id: 'violao', nome: 'Turma de Violão', ícone: <Music className="w-6 h-6"/> },
  { id: 'bateria', nome: 'Turma de Bateria', ícone: <Music className="w-6 h-6"/> }
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
  const [novoAgendamento, setNovoAgendamento] = useState({
    nome: '',
    telefone: '',
    local: 'saoluiz',
    instrumento: 'violao',
    data: '',
    horario: ''
  });
  const [mensagemSucesso, setMensagemSucesso] = useState('');

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try {
          await signInAnonymously(auth);
        } catch (err) {
          console.error("Erro na autenticação anônima:", err);
        }
      }
    });

    const unsubscribe = onSnapshot(collection(db, 'agendamentos'), (snapshot) => {
      const lista = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
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

  const salvarAgendamento = async (e) => {
    e.preventDefault();
    if (!novoAgendamento.nome || !novoAgendamento.data || !novoAgendamento.horario) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    try {
      await addDoc(collection(db, 'agendamentos'), {
        ...novoAgendamento,
        criadoEm: new Date().toISOString()
      });
      setMensagemSucesso('Agendamento realizado com sucesso!');
      setNovoAgendamento({ nome: '', telefone: '', local: 'saoluiz', instrumento: 'violao', data: '', horario: '' });
      setTimeout(() => setMensagemSucesso(''), 4000);
      setAbaAtiva('painel');
    } catch (err) {
      console.error("Erro ao salvar:", err);
      alert('Erro ao salvar agendamento. Verifique sua conexão.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      <header className="bg-emerald-800 text-white shadow-md">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-3">
            <Music className="w-8 h-8 text-emerald-300" />
            <div>
              <h1 className="text-xl font-bold">Projeto Acordes de Davi</h1>
              <p className="text-xs text-emerald-200">A Música Transforma Vidas</p>
            </div>
          </div>
          <nav className="flex gap-2">
            <button 
              onClick={() => setAbaAtiva('painel')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'painel' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
            >
              Agendamentos
            </button>
            <button 
              onClick={() => setAbaAtiva('novo')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${abaAtiva === 'novo' ? 'bg-emerald-900 text-white' : 'hover:bg-emerald-700'}`}
            >
              + Novo Cadastro
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6">
        {abaAtiva === 'painel' && (
          <div className="space-y-6">
            <div className="bg-white border-l-4 border-emerald-600 p-4 rounded-r-xl shadow-sm text-center">
              <p className="italic text-slate-700 font-medium">
                "E sucedia que, quando o espírito maligno da parte de Deus vinha sobre Saul, Davi tomava a harpa, e a touxia com a sua mão; então Saul andava aliviado, e se sentia melhor, e o espírito maligno se retirava dele."
              </p>
              <span className="block mt-2 text-xs font-bold text-emerald-800 uppercase tracking-wide">1 Samuel 16:23</span>
            </div>

            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold text-slate-700">Aulas Agendadas na Nuvem</h2>
              <span className="text-xs bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-medium">
                {agendamentos.length} {agendamentos.length === 1 ? 'aula marcada' : 'aulas marcadas'}
              </span>
            </div>

            {loading ? (
              <div className="text-center py-12 text-slate-400">Carregando dados em tempo real...</div>
            ) : agendamentos.length === 0 ? (
              <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300 p-6">
                <Music className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 font-medium">Nenhum agendamento encontrado no banco de dados.</p>
                <button 
                  onClick={() => setAbaAtiva('novo')}
                  className="mt-4 inline-flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 transition"
                >
                  Cadastrar Primeira Aula
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {agendamentos.map((item) => (
                  <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded uppercase">
                          {LOCALIZACOES.find(l => l.id === item.local)?.nome || item.local}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">{item.data} às {item.horario}</span>
                      </div>
                      <h3 className="font-bold text-slate-800 text-base">{item.nome}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Telefone: {item.telefone || 'Não informado'}</p>
                    </div>
                    <div className="mt-4 pt-2 border-t border-slate-100 flex items-center gap-1.5 text-xs text-slate-600">
                      <Music className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="capitalize font-medium">{item.instrumento}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {abaAtiva === 'novo' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-lg mx-auto">
            <h2 className="text-lg font-bold text-slate-800 mb-4">Novo Agendamento de Aula</h2>
            
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
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Telefone / WhatsApp</label>
                <input 
                  type="text" 
                  value={novoAgendamento.telefone}
                  onChange={(e) => setNovoAgendamento({...novoAgendamento, telefone: e.target.value})}
                  placeholder="(35) 99999-9999" 
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Polo / Local</label>
                  <select 
                    value={novoAgendamento.local}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, local: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
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
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                  >
                    <option value="violao">Violão</option>
                    <option value="bateria">Bateria</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Data da Aula</label>
                  <input 
                    type="date" 
                    required
                    value={novoAgendamento.data}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, data: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">Horário</label>
                  <input 
                    type="time" 
                    required
                    value={novoAgendamento.horario}
                    onChange={(e) => setNovoAgendamento({...novoAgendamento, horario: e.target.value})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button 
                  type="submit"
                  className="flex-1 bg-emerald-600 text-white font-medium py-2.5 rounded-lg text-sm hover:bg-emerald-700 transition shadow-sm"
                >
                  Salvar Agendamento
                </button>
                <button 
                  type="button"
                  onClick={() => setAbaAtiva('painel')}
                  className="px-4 py-2.5 border border-slate-300 text-slate-600 font-medium rounded-lg text-sm hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 mt-8 py-4 text-center text-xs text-slate-500">
        Projeto Acordes de Davi &bull; Conectado via Firebase em Tempo Real
      </footer>
    </div>
  );
}

