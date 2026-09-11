# Pagamento via Pix dentro do site — passo a passo pra ativar

Isso aqui NÃO precisa de código novo. É configuração que só você consegue fazer (nas suas
contas do Mercado Pago, Firebase e Vercel). Depois de feito, some com o resto e fica
funcionando sozinho.

## O que foi adicionado no projeto

- `api/mercadopago/criar-pix.js` — gera a cobrança Pix quando o aluno clica em "Pagar
  com Pix" no Portal do Aluno.
- `api/mercadopago/webhook.js` — recebe a confirmação do Mercado Pago quando o Pix cai,
  e marca o agendamento como "pago" sozinho.
- `api/_firebaseAdmin.js` — conexão de back-end com o Firestore (usada pelos dois acima).
- No `App.jsx`: campo **"Valor combinado"** em cada card da aba Pagamentos (admin), e o
  botão **"Pagar com Pix"** no Portal do Aluno, que só aparece depois que você preencher
  esse valor.
- `package.json` ganhou a dependência `firebase-admin`.

## Passo 1 — Criar/acessar sua conta no Mercado Pago Developers

1. Entre em https://www.mercadopago.com.br/developers/panel com a conta do Mercado Pago
   que vai receber os pagamentos (pode ser sua conta pessoal ou da Guilda/projeto).
2. Crie uma aplicação (qualquer nome, ex: "Acordes de Davi").
3. Dentro da aplicação, vá em **"Credenciais de produção"** e copie o **Access Token**
   (uma string longa, geralmente começando com `APP_USR-...`).
   - Se quiser testar antes sem mexer com dinheiro de verdade, use as
     **"Credenciais de teste"** no lugar (o Access Token de teste) e crie um
     [usuário de teste comprador](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/additional-content/your-integrations/test/accounts)
     pra simular o pagamento. Quando estiver tudo certo, troca pro token de produção.

## Passo 2 — Gerar a chave da conta de serviço do Firebase

1. No [Firebase Console](https://console.firebase.google.com/), abra o projeto do
   Acordes de Davi.
2. Vá em **Configurações do Projeto** (ícone de engrenagem) → **Contas de Serviço**.
3. Clique em **"Gerar nova chave privada"** — baixa um arquivo `.json`.
4. Abra esse arquivo com qualquer editor de texto e copie o conteúdo INTEIRO
   (começa com `{"type": "service_account", ...}`).
   ⚠️ Esse arquivo dá acesso total ao seu banco de dados — não suba ele pro GitHub, não
   mande por WhatsApp. Ele só vai pra dentro da Vercel, no passo 3.

## Passo 3 — Configurar as variáveis de ambiente na Vercel

1. No painel da Vercel, abra o projeto → **Settings** → **Environment Variables**.
2. Adicione:
   | Nome | Valor |
   |---|---|
   | `MERCADOPAGO_ACCESS_TOKEN` | o Access Token do Passo 1 |
   | `FIREBASE_SERVICE_ACCOUNT` | o conteúdo INTEIRO do arquivo `.json` do Passo 2, colado como texto |
   | `MERCADOPAGO_WEBHOOK_SECRET` | opcional — veja o Passo 4 |
3. Marque as três opções de ambiente (Production, Preview, Development) ou pelo menos
   Production.
4. Clique em **Save**.
5. Depois de salvar, faça um **redeploy** (Vercel → aba Deployments → "..." → Redeploy)
   pra essas variáveis passarem a valer.

## Passo 4 (recomendado, opcional) — Assinatura secreta do Webhook

Deixa o webhook mais seguro (confirma que a notificação realmente veio do Mercado
Pago). Sem isso, o pagamento continua funcionando normalmente — é só uma camada extra.

1. No painel do Mercado Pago Developers, dentro da sua aplicação, vá em
   **Webhooks** → **Configurar notificações**.
2. Coloque a URL: `https://SEU-DOMINIO-NA-VERCEL/api/mercadopago/webhook`
   (troque `SEU-DOMINIO-NA-VERCEL` pelo domínio real do seu site publicado).
3. Selecione o evento **"Pagamentos"**.
4. O Mercado Pago mostra uma **"Assinatura secreta"** — copie ela e cole na Vercel como
   a variável `MERCADOPAGO_WEBHOOK_SECRET` (Passo 3), depois faça o redeploy de novo.

## Passo 5 — Testar

1. Depois do redeploy, entre como admin → aba **Pagamentos**.
2. Escolha um aluno, defina o **Tipo** (pacote/individual) e clique em
   **"usar sugestão"** no campo **Valor combinado** (ou digite o valor manualmente) →
   isso já salva.
3. Agora, logado como aquele aluno (ou pedindo pra ele testar), entre no
   **Portal do Aluno** — deve aparecer o botão **"Pagar R$ X,XX com Pix"** no card da
   aula dele.
4. Clique nele: aparece um QR Code + código "copia e cola". Pague (de teste ou de
   verdade, dependendo do token usado no Passo 1).
5. Em poucos segundos, sem precisar recarregar a página, o status muda pra
   **"Pagamento em dia"** — o webhook fez isso sozinho.

## Se der erro

- **"O pagamento online ainda não foi configurado neste site"** → falta o
  `MERCADOPAGO_ACCESS_TOKEN` na Vercel (Passo 3), ou o redeploy ainda não aconteceu.
- **Erro genérico ao gerar o Pix** → confira nos **Logs** da Vercel (aba Deployments →
  entrar no deploy → Functions → `criar-pix`) a mensagem de erro exata — geralmente é o
  `FIREBASE_SERVICE_ACCOUNT` colado errado (com quebra de linha ou faltando alguma
  chave `{ }`).
- **Pagou mas não confirmou automaticamente** → confira se a URL do Webhook (Passo 4)
  está exatamente igual ao domínio real do site, e se o evento "Pagamentos" está
  marcado. Enquanto isso, você sempre pode marcar "Pago" manualmente na aba Pagamentos
  como já funcionava antes.
