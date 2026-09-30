# Backup diário do banco de dados — passo a passo

O que isso faz: todo dia, sozinho, o sistema pega TODOS os dados do Firestore
(alunos, igrejas, turmas, polos, presenças, avaliações, configurações e o
contador de recibo) e manda pra um e-mail, como um arquivo `.json` em anexo.
Sem custar nada novo — usa só o que o projeto já tem (Vercel, Firebase Admin
SDK, Resend) — porque o Firebase desse projeto está no plano Spark (gratuito),
que não permite o backup nativo do Google Cloud (esse exige plano pago).

**O que isso NÃO faz** (pra não criar falsa segurança): não restaura sozinho
(isso é manual, de propósito — veja mais abaixo); não guarda as contas de
login do Firebase Authentication (e-mail/senha de aluno e igreja) — só os
dados do Firestore. Se um dia o projeto Firebase inteiro for excluído (não só
os dados), os logins também se perdem e precisam ser recriados à parte.

## 1. Variáveis de ambiente novas na Vercel

Painel da Vercel > seu projeto > **Settings > Environment Variables**, adicione duas:

- **`CRON_SECRET`** — uma senha longa e aleatória qualquer (ex: gere uma em
  https://generate-secret.vercel.app/32 ou qualquer gerador de senha forte).
  Serve só pra provar que quem está chamando a função de backup é o próprio
  Cron Job da Vercel, e não alguém tentando acessar a URL direto pra roubar
  os dados. Não precisa anotar em lugar nenhum — só cola na Vercel.
- **`EMAIL_BACKUP`** — o e-mail que vai RECEBER o backup todo dia. De
  propósito, o ideal é ser um e-mail DIFERENTE do
  `auladeinstrumentosmusicais2026@gmail.com` operacional — assim, se a caixa
  operacional for comprometida ou lotar, o backup continua chegando num
  lugar separado que só você (ou você e o Gabriel) acessam.

Depois de adicionar as duas, faça um novo deploy (subir os arquivos de novo
já dispara isso) — sem isso, a função de backup não vê essas variáveis.

## 2. Arquivos novos que precisam subir pro GitHub

- `api/backup/exportar.js` — a função que gera e manda o backup.
- `vercel.json` — registra o agendamento (todo dia, 6h UTC = 3h da manhã em
  Brasília, fora do horário de uso). **Se você já tiver um `vercel.json` no
  repositório com outras configurações, NÃO sobrescreva — peça pra eu juntar
  os dois** (esse arquivo aqui só tem a parte do Cron Job).
- `scripts/restaurar-backup.js` — o script de restauração (roda no seu
  computador, nunca na Vercel — explico o porquê abaixo).

## 3. IMPORTANTE — proteja a chave da service account

O script de restauração (item 4) precisa da chave da service account do
Firebase (`scripts/service-account.json`) salva no seu computador. **Essa
chave NUNCA pode subir pro GitHub** — quem tiver ela tem acesso total ao seu
Firestore, passando por cima de qualquer regra de segurança. Confirme que o
seu repositório tem um `.gitignore` com essa linha:

```
scripts/service-account.json
```

Se não tiver certeza se seu `.gitignore` já existe ou já tem isso, me avise
antes de subir os arquivos — prefiro conferir com você do que assumir.

## 4. Como testar sem esperar o dia inteiro

Antes de confiar que o backup vai funcionar todo dia sozinho, teste uma vez
à mão. Com o `CRON_SECRET` que você colou na Vercel, rode (troque
`SEU_CRON_SECRET` e a URL do seu projeto):

```
curl -H "Authorization: Bearer SEU_CRON_SECRET" https://SEU-PROJETO.vercel.app/api/backup/exportar
```

Se der `{"enviado":true, ...}`, o e-mail de backup chegou. Confira a caixa
configurada em `EMAIL_BACKUP`.

## 5. Como restaurar (se um dia precisar)

1. Baixe o anexo do e-mail de backup do dia que você quer restaurar.
2. Baixe a chave da service account (Firebase Console > ⚙️ Configurações do
   Projeto > Contas de Serviço > **Gerar nova chave privada**) e salve como
   `scripts/service-account.json` (esse nome exato, nessa pasta).
3. No terminal, dentro da pasta do projeto, rode primeiro SEM `--confirmar`
   (só simula, não grava nada — mostra quantos documentos seriam
   restaurados e avisa quais documentos existem hoje e não estavam no
   backup, sem apagar nenhum):
   ```
   node scripts/restaurar-backup.js caminho/para/backup-acordes-de-davi-2026-09-30.json
   ```
4. Se o resumo bater com o esperado, rode de novo com `--confirmar` pra
   gravar de verdade:
   ```
   node scripts/restaurar-backup.js caminho/para/backup-acordes-de-davi-2026-09-30.json --confirmar
   ```

O script nunca apaga um documento que exista hoje e não esteja no backup —
só avisa quais são, pra você decidir manualmente.

## Por que a restauração é manual, no seu computador (e não um botão no site)

Um endpoint na internet capaz de sobrescrever o banco de dados inteiro é um
risco grande demais: uma chave roubada, um bug de autorização, e alguém
apaga ou sobrescreve tudo remotamente, sem nem precisar acessar seu
computador. Rodando só local, restaurar exige ter em mãos o arquivo do
backup E a chave da service account — dobra a barreira pra um acidente ou
um ataque conseguir estragar os dados de verdade.
