# 🎸 Projeto Acordes de Davi

> *"A Música Transforma Vidas"* — Baseado em 1 Samuel 16:23

Bem-vindo ao repositório oficial do **Projeto Acordes de Davi**. Este é um sistema web moderno desenvolvido para gerenciar o agendamento de aulas de música de forma prática, rápida e em tempo real.

## 🎯 Sobre o Projeto

O objetivo deste sistema é organizar as turmas de Violão e Bateria, permitindo que os alunos se cadastrem e reservem seus horários de forma autônoma. O sistema bloqueia automaticamente as vagas já preenchidas, evitando conflitos de horários.

O projeto atende a três polos de ensino com regras e calendários específicos:
*   **São Luiz:** Aulas quinzenais (Violão às sextas, Bateria aos sábados).
*   **Mata Fria / Penha do Côco:** Aulas de bateria pela manhã e violão à tarde, ajustadas conforme a agenda de São Luiz.
*   **Chalé:** Aulas de violão aos domingos (quinzenal).

## 🚀 Tecnologias Utilizadas

Este projeto foi construído com ferramentas modernas de desenvolvimento web:

*   **[React](https://reactjs.org/)** + **[Vite](https://vitejs.dev/):** Para a construção de uma interface de usuário rápida e reativa.
*   **[Tailwind CSS](https://tailwindcss.com/):** Para a estilização visual responsiva e moderna.
*   **[Firebase (Cloud Firestore)](https://firebase.google.com/):** Banco de dados NoSQL em nuvem para salvar os agendamentos e atualizar as vagas disponíveis em tempo real.
*   **[Vercel](https://vercel.com/):** Plataforma de hospedagem e deploy contínuo.
*   **[Lucide React](https://lucide.dev/):** Biblioteca de ícones.

## ⚙️ Funcionalidades

- **Interface Intuitiva:** Separação clara por Polos de ensino.
- **Lógica de Agendamento:** Cálculo automático de blocos de 40 minutos com base nos horários de funcionamento de cada local.
- **Sincronização em Tempo Real:** Conexão direta com o Firestore. Se um aluno agenda um horário, ele some da lista para os outros no mesmo instante.
- **Design Responsivo:** Funciona perfeitamente em celulares, tablets e computadores.

## 🛠️ Como executar localmente

Se você deseja rodar este projeto na sua própria máquina, siga os passos abaixo:

1. Clone este repositório:
   ```bash
   git clone [https://github.com/SEU_USUARIO/projeto-acordes-de-davi.git](https://github.com/SEU_USUARIO/projeto-acordes-de-davi.git)
