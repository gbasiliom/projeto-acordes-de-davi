import React, { useState, useEffect, useMemo } from 'react';
import { BookOpen, Calendar, Clock, Guitar, Music, User, LogIn, CheckCircle, AlertTriangle, Users, MapPin } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc } from 'firebase/firestore';

const LOCATIONS = [
  { id: 'saoluiz', name: 'São Luiz' },
  { id: 'matafria', name: 'Mata Fria / Penha do Côco' },
  { id: 'chale', name: 'Chalé' }
];

const INSTRUMENTS = [
  { id: 'violao', name: 'Turma de Violão', icon: <Guitar className="w-6 h-6" /> },
  { id: 'bateria', name: 'Turma de Bateria', icon: <Music className="w-6 h-6" /> },
];

// --- Horários Específicos por Polo ---

// 1. São Luiz (Manhã estendida - 40 em 40 min)
const TIMES_SAO_LUIZ = [
  { label: '08:00 - 08:40', value: '08:00' }, { label: '08:40 - 09:20', value: '08:40' },
  { label: '09:20 - 10:00', value: '09:20' }, { label: '10:00 - 10:40', value: '10:00' },
  { label: '10:40 - 11:20', value: '10:40' }, { label: '11:20 - 12:00', value: '11:20' },
  { label: '12:00 - 12:40', value: '12:00' }, { label: '12:40 - 13:20', value: '12:40' }
];

// 2. Mata Fria / Penha do Côco
const TIMES_MATA_FRIA_QUARTA = [
  { label: '07:00 - 07:40', value: '07:00' }, { label: '07:40 - 08:20', value: '07:40' },
  { label: '08:20 - 09:00', value: '08:20' }, { label: '09:00 - 09:40', value: '09:00' },
  { label: '09:40 - 10:20', value: '09:40' }, { label: '10:20 - 11:00', value: '10:20' },
  { label: '11:00 - 11:40', value: '11:00' }
];
const TIMES_MATA_FRIA_SABADO_MANHA = [
  { label: '08:00 - 08:40', value: '08:00' }, { label: '08:40 - 09:20', value: '08:40' },
  { label: '09:20 - 10:00', value: '09:20' }, { label: '10:00 - 10:40', value: '10:00' },
  { label: '10:40 - 11:20', value: '10:40' }, { label: '11:20 - 12:00', value: '11:20' }
];

// Sábado à tarde (Semana A) - Dias COM aula em São Luiz de manhã
const TIMES_MATA_FRIA_SABADO_TARDE_SEMANA_A = [
  { label: '14:00 - 14:40', value: '14:00' }, { label: '14:40 - 15:20', value: '14:40' },
  { label: '15:20 - 16:00', value: '15:20' }, { label: '16:00 - 16:40', value: '16:00' }
];

// Sábado à tarde (Semana B) - Dias SEM aula em São Luiz de manhã
const TIMES_MATA_FRIA_SABADO_TARDE_SEMANA_B = [
  { label: '13:00 - 13:40', value: '13:00' }, { label: '13:40 - 14:20', value: '13:40' },
  { label: '14:20 - 15:00', value: '14:20' }, { label: '15:00 - 15:40', value: '15:00' },
  { label: '15:40 - 16:20', value: '15:40' }, { label: '16:20 - 17:00', value: '16:20' }
];

// 3. Chalé (11:00 às 15:00 com almoço 12:40-12:55)
const TIMES_CHALE = [
  { label: '11:00 - 11:40', value: '11:00' }, { label: '11:40 - 12:20', value: '11:40' },
  // Intervalo 12:20 às 12:40 (tempo livre) -> Almoço 12:40 às 12:55
  { label: '12:55 - 13:35', value: '12:55' }, { label: '13:35 - 14:15', value: '13:35' },
  { label: '14:15 - 14:55', value: '14:15' }
];

// Matriz de regras para geração de vagas
const SLOT_DEFINITIONS = [
  // --- São Luiz ---
  { location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', times: TIMES_SAO_LUIZ },
  { location: 'saoluiz', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana A)', times: TIMES_SAO_LUIZ },
  
  // --- Mata Fria / Penha do Côco ---
  { location: 'matafria', instrument: 'bateria', day: 'Quarta-feira', times: TIMES_MATA_FRIA_QUARTA },
  { location: 'matafria', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana B)', times: TIMES_MATA_FRIA_SABADO_MANHA },
  { location: 'matafria', instrument: 'violao', day: 'Sábado (Tarde - Semana A)', times: TIMES_MATA_FRIA_SABADO_TARDE_SEMANA_A },
  { location: 'matafria', instrument: 'violao', day: 'Sábado (Tarde - Semana B)', times: TIMES_MATA_FRIA_SABADO_TARDE_SEMANA_B },

  // --- Chalé ---
  { location: 'chale', instrument: 'violao', day: 'Domingo (Quinzenal)', times: TIMES_CHALE },
];

// Alunos extraídos do PDF original - vinculados ao polo São Luiz
const INITIAL_STUDENTS = [
  // Turma de Violão (Sexta)
  { id: '1', studentName: 'Walisom Daniel Braun', studentEmail: 'analuciabraun931@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', time: '08:00' },
  { id: '2', studentName: 'Thallia Fernanda Pereira', studentEmail: 'thallitaamacieto348@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', time: '08:40' },
  { id: '3', studentName: 'Manassés Perera Lourer', studentEmail: 'monicapererarpa123@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', time: '09:20' },
  { id: '4', studentName: 'Marina Gomes da Silva', studentEmail: 'jouquimmateusipanema@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', time: '10:00' },
  { id: '5', studentName: 'Ester Albina Teixeira', studentEmail: 'taismelo075@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', time: '10:40' },
  { id: '6', studentName: 'Joana Darc Romano Nog', studentEmail: 'jeanadarcromano1@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', time: '11:20' },
  { id: '7', studentName: 'Jonathan Romano Nogue', studentEmail: 'njonathanmmano@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', time: '12:00' },
  { id: '8', studentName: 'Denis Lopes da Silva', studentEmail: 'denisiopes913@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'violao', day: 'Sexta (Quinzenal)', time: '12:40' },

  // Turma de Bateria (Sábado - Semana A)
  { id: '9', studentName: 'Wemersom Daniel Braun', studentEmail: 'pereiraedvaldo6893@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana A)', time: '08:00' },
  { id: '10', studentName: 'Victor Gabriel de Souza', studentEmail: 'joquebedepereira09@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana A)', time: '08:40' },
  { id: '11', studentName: 'Davi Lucas Souza Braun', studentEmail: 'locmarp008@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana A)', time: '09:20' },
  { id: '12', studentName: 'Ana Júlia Braun Joi', studentEmail: 'braummana934@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana A)', time: '10:00' },
  { id: '13', studentName: 'Luz Maria Braun Jo', studentEmail: 'gilmataaparecidabraunjoi@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana A)', time: '10:40' },
  { id: '14', studentName: 'Mayara', studentEmail: 'natanaelmayaru@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana A)', time: '11:20' },
  { id: '15', studentName: 'Cleonice', studentEmail: 'mayaranatanael0210@gmail.com', studentPassword: '123', location: 'saoluiz', instrument: 'bateria', day: 'Sábado (Quinzenal - Semana A)', time: '12:00' }
].map(student => ({ 
  ...student, 
  slotId: `slot-${student.location}-${student.instrument}-${student.day}-${student.time}`,
}));

const generateInitialSlots = () => {
  const slots = [];
  
  SLOT_DEFINITIONS.forEach(def => {
    def.times.forEach(timeObj => {
      const slotId = `slot-${def.location}-${def.instrument}-${def.day}-${timeObj.value}`;
      const preBookedStudent = INITIAL_STUDENTS.find(s => s.slotId === slotId);
      
      slots.push({
        id: slotId,
        location: def.location,
        instrument: def.instrument,
        day: def.day,
        time: timeObj.value,
        timeLabel: timeObj.label,
        isBooked: !!preBookedStudent,
        studentName: preBookedStudent ? preBookedStudent.studentName : null,
      });
    });
  });
  return slots;
};

// Materiais Didáticos de Exemplo
const MATERIALS = {
  violao: [
    { title: "Acordes Básicos C, D, G", type: "PDF" },
    { title: "Exercício de Dedilhado 1", type: "Vídeo" },
    { title: "Escala Maior - Shape 1", type: "PDF" }
  ],
  bateria: [
    { title: "Virada Simples 4x4", type: "Vídeo" },
    { title: "Coordenação Mão/Pé - Exercício 1", type: "PDF" },
    { title: "Ritmo Básico de Rock", type: "Vídeo" }
  ]
};

// ATENÇÃO: Quando for publicar na Vercel, substitua os dados abaixo pelas SUAS chaves (Passo 1 do guia)
const MEU_BANCO_DE_DADOS = {
apiKey: "AIzaSyC1zP4nWqCjW6EWgSMqIo_",
  authDomain: "acordes-de-davi.firebaseapp.com",
  projectId: "acordes-de-davi",
  storageBucket: "acordes-de-davi.appspot.com",
  messagingSenderId: "226236446346",
  appId: "1:226236446346:web:7d7f45f8b2f4f5bf48fbfc",
  measurementId: "G-KQ9C7Q7J7D"
};

// Variáveis de ambiente para o Banco de Dados
const appId = typeof __app_id !== 'undefined' ? __app_id : 'projeto-acordes-davi';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : (MEU_BANCO_DE_DADOS.apiKey !== "COLE_AQUI_A_API_KEY" ? MEU_BANCO_DE_DADOS : null);

let app, auth, db;
if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

export default function App() {
  const [currentView, setCurrentView] = useState('home'); 
  const [user, setUser] = useState(null); // Firebase User
  const [dbBookings, setDbBookings] = useState([]); // Real-time bookings from Firebase
  
  // Combinar os alunos antigos da planilha com os novos agendamentos da nuvem
  const allBookings = useMemo(() => [...INITIAL_STUDENTS, ...dbBookings], [dbBookings]);

  // Gerar vagas dinamicamente e bloquear as que já foram reservadas
  const slots = useMemo(() => {
    const currentSlots = [];
    SLOT_DEFINITIONS.forEach(def => {
      def.times.forEach(timeObj => {
        const slotId = `slot-${def.location}-${def.instrument}-${def.day}-${timeObj.value}`;
        const preBookedStudent = allBookings.find(s => s.slotId === slotId);
        currentSlots.push({
          id: slotId, location: def.location, instrument: def.instrument, day: def.day,
          time: timeObj.value, timeLabel: timeObj.label,
          isBooked: !!preBookedStudent, studentName: preBookedStudent ? preBookedStudent.studentName : null,
        });
      });
    });
    return currentSlots;
  }, [allBookings]);
  
  // Scheduling Form State
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedInstrument, setSelectedInstrument] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState('');
  
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [studentPassword, setStudentPassword] = useState('');
  
  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loggedInStudent, setLoggedInStudent] = useState(null);

  // Notifications
  const [notification, setNotification] = useState(null);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // --- 1. Inicializa Autenticação do Firebase ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Erro na autenticação:", err);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- 2. Busca e escuta os agendamentos em Tempo Real ---
  useEffect(() => {
    if (!user || !db) return;
    
    const bookingsRef = collection(db, 'artifacts', appId, 'public', 'data', 'bookings');
    const unsubscribe = onSnapshot(bookingsRef, (snapshot) => {
      const fetchedBookings = [];
      snapshot.forEach((doc) => {
        fetchedBookings.push({ id: doc.id, ...doc.data() });
      });
      setDbBookings(fetchedBookings);
    }, (error) => {
      console.error("Erro ao escutar dados:", error);
    });
    
    return () => unsubscribe();
  }, [user]);

  const handleSchedule = async (e) => {
    e.preventDefault();
    if (!selectedLocation || !selectedInstrument || !selectedSlotId || !studentName || !studentEmail || !studentPassword) {
      showNotification('Por favor, preencha todos os campos.', 'error');
      return;
    }

    const slotToUpdate = slots.find(s => s.id === selectedSlotId);
    if (!slotToUpdate || slotToUpdate.isBooked) {
      showNotification('Este horário já foi reservado por outra pessoa.', 'error');
      return;
    }

    const newBooking = {
      studentName,
      studentEmail,
      studentPassword,
      location: selectedLocation,
      instrument: selectedInstrument,
      day: slotToUpdate.day,
      time: slotToUpdate.time,
      timeLabel: slotToUpdate.timeLabel,
      slotId: selectedSlotId,
      createdAt: new Date().toISOString()
    };

    try {
      if (db && user) {
        // Salva os dados na nuvem (Firebase)
        const bookingsRef = collection(db, 'artifacts', appId, 'public', 'data', 'bookings');
        await addDoc(bookingsRef, newBooking);
      } else {
        // Fallback local se o banco não estiver disponível
        setDbBookings(prev => [...prev, newBooking]);
      }

      showNotification('Aula agendada com sucesso! Faça login no portal.', 'success');
      
      // Reset form
      setSelectedLocation('');
      setSelectedInstrument('');
      setSelectedSlotId('');
      setStudentName('');
      setStudentEmail('');
      setStudentPassword('');
      setCurrentView('home');
    } catch (error) {
      showNotification('Erro ao agendar. Tente novamente.', 'error');
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    // Procura o aluno tanto nos dados antigos (PDF) quanto nos novos (Nuvem)
    const student = allBookings.find(b => b.studentEmail.trim().toLowerCase() === loginEmail.trim().toLowerCase() && b.studentPassword === loginPassword);
    
    if (student) {
      setLoggedInStudent(student);
      setCurrentView('portal');
      setLoginEmail('');
      setLoginPassword('');
    } else {
      showNotification('Email ou senha incorretos.', 'error');
    }
  };

  const handleLogout = () => {
    setLoggedInStudent(null);
    setCurrentView('home');
  };

  // Helper getters
  const availableSlots = slots.filter(s => s.location === selectedLocation && s.instrument === selectedInstrument);
  
  // Para agrupar as vagas por DIA na interface
  const slotsGroupedByDay = availableSlots.reduce((acc, slot) => {
    if (!acc[slot.day]) acc[slot.day] = [];
    acc[slot.day].push(slot);
    return acc;
  }, {});

  const getLocationName = (locId) => LOCATIONS.find(l => l.id === locId)?.name || 'Polo Desconhecido';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      {/* Navigation */}
      <nav className="bg-emerald-800 text-white shadow-md border-b-4 border-emerald-600">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center cursor-pointer" onClick={() => setCurrentView('home')}>
              {}
              <Guitar className="w-8 h-8 mr-2 text-emerald-300" />
              <span className="font-bold text-xl tracking-tight hidden sm:block">Projeto Acordes de Davi</span>
            </div>
            <div className="flex space-x-2 sm:space-x-4 overflow-x-auto">
              <button onClick={() => setCurrentView('schedule')} className={`whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 transition-colors ${currentView === 'schedule' ? 'bg-emerald-900' : ''}`}>Novo Cadastro</button>
              {loggedInStudent ? (
                <button onClick={() => setCurrentView('portal')} className={`whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 transition-colors ${currentView === 'portal' ? 'bg-emerald-900' : ''}`}>Meu Portal</button>
              ) : (
                <button onClick={() => setCurrentView('login')} className={`whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center ${currentView === 'login' ? 'bg-emerald-900' : ''}`}><LogIn className="w-4 h-4 mr-1 hidden sm:block" /> Portal do Aluno</button>
              )}
               <button onClick={() => setCurrentView('admin')} className={`whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium hover:bg-emerald-700 transition-colors ${currentView === 'admin' ? 'bg-emerald-900' : ''}`}>Polos (Admin)</button>
            </div>
          </div>
        </div>
      </nav>

      {/* Notifications */}
      {notification && (
        <div className={`fixed top-20 right-4 p-4 rounded-md shadow-lg z-50 text-white flex items-center animate-fade-in-down max-w-sm ${notification.type === 'error' ? 'bg-red-500' : 'bg-emerald-600'}`}>
          {notification.type === 'success' ? <CheckCircle className="w-5 h-5 mr-2 shrink-0" /> : <AlertTriangle className="w-5 h-5 mr-2 shrink-0"/>}
          <span className="text-sm">{notification.message}</span>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* VIEW: HOME */}
        {currentView === 'home' && (
          <div className="text-center mt-8 animate-fade-in">
            <div className="inline-block bg-emerald-100 text-emerald-800 px-4 py-1 rounded-full text-sm font-bold mb-4 border border-emerald-200">
              Novos polos disponíveis: Mata Fria e Chalé!
            </div>
            
            {}
            <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl md:text-6xl tracking-tight">
              Projeto Acordes de <span className="text-emerald-600">Davi</span>
            </h1>
            
            <div className="mt-6 max-w-2xl mx-auto italic text-gray-700 bg-emerald-50/50 p-6 rounded-xl border border-emerald-100 shadow-sm relative">
              <span className="absolute top-2 left-4 text-4xl text-emerald-300">"</span>
              <p className="relative z-10 text-lg leading-relaxed">
                Sempre que o espírito mandado por Deus se apoderava de Saul, Davi apanhava a harpa e tocava. Então Saul sentia alívio e melhorava, e o espírito maligno o deixava.
              </p>
              <p className="text-sm font-bold mt-4 text-emerald-800 tracking-wide">— 1 Samuel 16:23</p>
            </div>

            <p className="mt-6 max-w-md mx-auto text-base text-gray-500 sm:text-lg md:text-xl md:max-w-3xl font-medium">
              <span className="text-emerald-700 font-bold">A Música Transforma Vidas.</span> Escolha o polo mais próximo de você, agende seu horário exclusivo e acesse os materiais de estudo.
            </p>
            
            <div className="mt-8 max-w-md mx-auto sm:flex sm:justify-center">
              <div className="rounded-md shadow hover:shadow-lg transition-shadow duration-300">
                <button onClick={() => setCurrentView('schedule')} className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-emerald-600 hover:bg-emerald-700 md:py-4 md:text-lg md:px-10 transition-all">
                  Ver Polos e Agendar
                </button>
              </div>
            </div>

            <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-3 max-w-5xl mx-auto">
               <div className="bg-white p-6 rounded-xl shadow-sm border-t-4 border-emerald-500 flex flex-col items-center hover:-translate-y-1 transition-transform duration-300">
                 <MapPin className="w-10 h-10 text-emerald-500 mb-3" />
                 <h3 className="text-xl font-bold text-gray-900">São Luiz</h3>
                 <p className="mt-2 text-sm text-gray-500 text-center">Aulas quinzenais de Violão na sexta e Bateria no sábado.</p>
               </div>
               <div className="bg-white p-6 rounded-xl shadow-sm border-t-4 border-emerald-500 flex flex-col items-center hover:-translate-y-1 transition-transform duration-300">
                 <MapPin className="w-10 h-10 text-emerald-500 mb-3" />
                 <h3 className="text-xl font-bold text-gray-900">Mata Fria</h3>
                 <p className="mt-2 text-sm text-gray-500 text-center">Bateria às quartas/sábados e Violão aos sábados à tarde.</p>
               </div>
               <div className="bg-white p-6 rounded-xl shadow-sm border-t-4 border-emerald-500 flex flex-col items-center hover:-translate-y-1 transition-transform duration-300">
                 <MapPin className="w-10 h-10 text-emerald-500 mb-3" />
                 <h3 className="text-xl font-bold text-gray-900">Chalé</h3>
                 <p className="mt-2 text-sm text-gray-500 text-center">Aulas de Violão aos domingos (quinzenais). Garanta sua vaga!</p>
               </div>
            </div>
          </div>
        )}

        {/* VIEW: SCHEDULE */}
        {currentView === 'schedule' && (
          <div className="max-w-4xl mx-auto bg-white p-6 sm:p-8 rounded-xl shadow-md animate-fade-in border border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center border-b pb-4">
              <Calendar className="mr-2 text-emerald-600" /> Cadastro e Agendamento
            </h2>
            <form onSubmit={handleSchedule} className="space-y-8">
              
              {/* 1. Location Selection */}
              <div>
                <label className="block text-base font-bold text-gray-800 mb-3 flex items-center">
                  <span className="bg-emerald-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-sm mr-2">1</span> 
                  Selecione o Polo de Ensino
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {LOCATIONS.map((loc) => (
                    <div 
                      key={loc.id}
                      onClick={() => { setSelectedLocation(loc.id); setSelectedInstrument(''); setSelectedSlotId(''); }}
                      className={`cursor-pointer rounded-lg border-2 p-4 flex flex-col items-center justify-center transition-all ${selectedLocation === loc.id ? 'border-emerald-600 bg-emerald-50 text-emerald-800 shadow-sm' : 'border-gray-200 hover:border-emerald-300 text-gray-600'}`}
                    >
                      <MapPin className={`w-6 h-6 mb-2 ${selectedLocation === loc.id ? 'text-emerald-600' : 'text-gray-400'}`} />
                      <span className="font-bold text-center">{loc.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 2. Instrument Selection */}
              {selectedLocation && (
                <div className="animate-fade-in">
                  <label className="block text-base font-bold text-gray-800 mb-3 flex items-center">
                    <span className="bg-emerald-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-sm mr-2">2</span> 
                    Turma / Instrumento
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {INSTRUMENTS.map((inst) => {
                       // Verifica se há vagas para este instrumento neste polo
                       const hasSlots = slots.some(s => s.location === selectedLocation && s.instrument === inst.id);
                       if (!hasSlots) return null;

                       return (
                        <div 
                          key={inst.id}
                          onClick={() => { setSelectedInstrument(inst.id); setSelectedSlotId(''); }}
                          className={`cursor-pointer rounded-lg border-2 p-4 flex flex-col items-center justify-center transition-all ${selectedInstrument === inst.id ? 'border-emerald-600 bg-emerald-50 text-emerald-800 shadow-sm' : 'border-gray-200 hover:border-emerald-300 text-gray-600'}`}
                        >
                          {inst.icon}
                          <span className="mt-2 font-bold text-lg">{inst.name}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 3. Slot Selection */}
              {selectedLocation && selectedInstrument && (
                <div className="animate-fade-in">
                  <label className="block text-base font-bold text-gray-800 mb-3 flex items-center">
                    <span className="bg-emerald-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-sm mr-2">3</span> 
                    Escolha o Dia e Horário Disponível
                  </label>
                  <p className="text-sm text-gray-500 mb-4 bg-gray-50 p-2 rounded border border-gray-100">
                    Lembre-se: Após a escolha, este horário será exclusivamente seu. 
                    {selectedLocation === 'saoluiz' && " As aulas em São Luiz são quinzenais."}
                    {selectedLocation === 'matafria' && selectedInstrument === 'violao' && " No sábado à tarde, as aulas iniciam às 14:00 (Semana A) ou às 13:00 (Semana B)."}
                    {selectedLocation === 'chale' && " As aulas no Chalé ocorrem aos domingos (quinzenais) e têm intervalo para almoço às 12:40."}
                  </p>
                  
                  <div className="space-y-6">
                    {Object.keys(slotsGroupedByDay).map(day => (
                       <div key={day} className="bg-white border rounded-lg overflow-hidden">
                          <div className="bg-gray-100 px-4 py-2 font-bold text-gray-800 border-b flex justify-between items-center">
                            {day}
                            {day.includes('Quinzenal') && <span className="text-xs bg-emerald-200 text-emerald-800 px-2 py-1 rounded-full uppercase tracking-wider">A cada 15 dias</span>}
                          </div>
                          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-60 overflow-y-auto">
                            {slotsGroupedByDay[day].map((slot) => (
                              <button
                                key={slot.id}
                                type="button"
                                disabled={slot.isBooked}
                                onClick={() => setSelectedSlotId(slot.id)}
                                className={`
                                  py-2 px-2 rounded-md text-sm font-medium flex flex-col items-center border
                                  ${slot.isBooked ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed' : 
                                    selectedSlotId === slot.id ? 'bg-emerald-600 text-white border-emerald-600 shadow-md transform scale-105' : 'bg-white text-gray-700 border-gray-300 hover:border-emerald-500 hover:text-emerald-700 shadow-sm'}
                                  transition-all duration-200
                                `}
                              >
                                <span className="flex items-center mb-1"><Clock className="w-3 h-3 mr-1"/> {slot.timeLabel}</span>
                                {slot.isBooked && (
                                  <span className="text-[10px] mt-1 text-red-500 font-bold flex flex-col items-center leading-tight">
                                    Reservado
                                    <span className="font-normal text-gray-400 truncate w-20 text-center">{slot.studentName}</span>
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                       </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Student Details */}
              {selectedSlotId && (
                <div className="bg-gray-50 p-6 rounded-lg border border-gray-200 space-y-4 animate-fade-in mt-8">
                  <label className="block text-base font-bold text-gray-800 border-b pb-2 flex items-center">
                    <span className="bg-emerald-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-sm mr-2">4</span> 
                    Dados do Aluno
                  </label>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Nome Completo</label>
                      <input type="text" required value={studentName} onChange={(e) => setStudentName(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm p-3 border" placeholder="Ex: João da Silva"/>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Email</label>
                      <input type="email" required value={studentEmail} onChange={(e) => setStudentEmail(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm p-3 border" placeholder="joao@email.com"/>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700">Senha de Acesso (para o portal do aluno)</label>
                      <input type="password" required value={studentPassword} onChange={(e) => setStudentPassword(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm p-3 border" placeholder="Crie uma senha segura"/>
                    </div>
                  </div>
                </div>
              )}

              {selectedSlotId && (
                <button type="submit" className="w-full flex justify-center py-4 px-4 border border-transparent rounded-md shadow-lg text-lg font-bold text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-colors animate-fade-in">
                  Confirmar Vaga e Agendar
                </button>
              )}
            </form>
          </div>
        )}

        {/* VIEW: LOGIN */}
        {currentView === 'login' && (
          <div className="max-w-md mx-auto bg-white p-8 rounded-xl shadow-md mt-10 animate-fade-in border border-gray-100">
             <div className="text-center mb-6">
                <LogIn className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
                <h2 className="text-2xl font-bold text-gray-900">Portal do Aluno</h2>
                <p className="text-sm text-gray-500 mt-2 bg-yellow-50 p-2 rounded border border-yellow-100">
                  Alunos do PDF (São Luiz) utilizam a senha <strong>123</strong>.
                </p>
             </div>
             
             <form onSubmit={handleLogin} className="space-y-5">
               <div>
                  <label className="block text-sm font-medium text-gray-700">Email</label>
                  <input type="email" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-base p-3 border" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Senha</label>
                  <input type="password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-base p-3 border" />
                </div>
                <button type="submit" className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-bold text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none">
                  Acessar Materiais
                </button>
             </form>
          </div>
        )}

        {/* VIEW: PORTAL */}
        {currentView === 'portal' && loggedInStudent && (
          <div className="max-w-5xl mx-auto animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 bg-white p-6 rounded-xl shadow-sm border-l-4 border-emerald-500 gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Olá, {loggedInStudent.studentName}!</h2>
                <p className="text-gray-600 text-sm mt-1">
                  Polo: <strong className="text-emerald-700">{getLocationName(loggedInStudent.location)}</strong> | 
                  Turma: <strong>{loggedInStudent.instrument === 'violao' ? 'Violão' : 'Bateria'}</strong>
                </p>
              </div>
              <button onClick={handleLogout} className="px-4 py-2 text-sm font-bold text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors w-full sm:w-auto">Sair da Conta</button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 bg-emerald-800 text-white rounded-xl shadow-md p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center text-emerald-200 mb-2">
                    <Calendar className="w-5 h-5 mr-2" />
                    <span className="text-sm uppercase tracking-wider font-semibold">Sua Agenda Oficial</span>
                  </div>
                  <h3 className="text-2xl font-bold mt-2 leading-tight">{loggedInStudent.day}</h3>
                  <div className="mt-4 space-y-3 bg-emerald-900/50 p-4 rounded-lg">
                    <p className="flex items-center text-xl font-bold text-emerald-100"><Clock className="w-6 h-6 mr-3 text-emerald-400"/> {loggedInStudent.timeLabel || loggedInStudent.time}</p>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-emerald-600/50">
                  <p className="text-sm text-emerald-200 text-center">Horário reservado exclusivamente para você.</p>
                </div>
              </div>

              <div className="lg:col-span-2 bg-white rounded-xl shadow-md p-6 border border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center border-b pb-3">
                  <BookOpen className="w-6 h-6 mr-2 text-emerald-600" />
                  Material Didático (Prática em Casa)
                </h3>
                
                <div className="space-y-3 mt-4">
                  {MATERIALS[loggedInStudent.instrument]?.map((mat, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50 transition-colors group cursor-pointer shadow-sm">
                      <div className="flex items-center">
                        <div className={`p-3 rounded-md mr-4 shrink-0 ${mat.type === 'PDF' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        </div>
                        <div>
                          <p className="text-base font-bold text-gray-900 group-hover:text-emerald-700">{mat.title}</p>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{mat.type}</p>
                        </div>
                      </div>
                      <button className="text-sm font-bold text-emerald-700 bg-white border-2 border-emerald-200 px-4 py-2 rounded-lg hover:bg-emerald-600 hover:text-white transition-colors">
                        Abrir
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: ADMIN */}
        {currentView === 'admin' && (
          <div className="max-w-7xl mx-auto space-y-12 animate-fade-in">
             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <h2 className="text-2xl font-bold text-gray-900 flex items-center">
                  <MapPin className="mr-2 text-emerald-600" /> Gestão de Polos e Alunos (Admin)
                </h2>
                <p className="text-gray-600 mt-2">Visão geral de todos os agendamentos divididos por Polo e Turma.</p>
             </div>

             {LOCATIONS.map(location => {
               const locBookings = allBookings.filter(b => b.location === location.id);
               if (locBookings.length === 0) return null;

               return (
                 <div key={location.id} className="bg-gray-50 p-6 rounded-xl border border-gray-300">
                   <h3 className="text-2xl font-extrabold text-emerald-900 mb-6 uppercase tracking-wide border-b-2 border-emerald-200 pb-2">
                     Polo: {location.name}
                   </h3>
                   
                   <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      {INSTRUMENTS.map(inst => {
                        const instBookings = locBookings.filter(b => b.instrument === inst.id);
                        if (instBookings.length === 0) return null;

                        return (
                          <div key={inst.id} className="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                            <h4 className="text-lg font-bold text-gray-800 mb-4 flex items-center justify-between">
                              <span className="flex items-center">{inst.icon} <span className="ml-2">{inst.name}</span></span>
                              <span className="bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">{instBookings.length} Aluno(s)</span>
                            </h4>
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead>
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500 uppercase">Aluno</th>
                                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500 uppercase">Dia / Horário</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {instBookings.map((b) => (
                                    <tr key={b.id} className="hover:bg-gray-50">
                                      <td className="px-3 py-3">
                                        <div className="text-sm font-bold text-gray-900">{b.studentName}</div>
                                        <div className="text-xs text-gray-500">{b.studentEmail}</div>
                                      </td>
                                      <td className="px-3 py-3">
                                        <div className="text-sm font-medium text-emerald-700">{b.day}</div>
                                        <div className="text-xs bg-gray-100 inline-block px-2 py-1 rounded mt-1">{b.timeLabel || b.time}</div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )
                      })}
                   </div>
                 </div>
               )
             })}
          </div>
        )}

      </main>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeInDown { from { opacity: 0; transform: translateY(-15px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
        .animate-fade-in-down { animation: fadeInDown 0.4s ease-out forwards; }
        
        /* Custom scrollbar for slot container */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
        ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
      `}} />
    </div>
  );
}
