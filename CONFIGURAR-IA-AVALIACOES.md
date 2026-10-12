# Como configurar a IA das Avaliações (ANTHROPIC_API_KEY)

O botão "Gerar com IA", na aba Avaliações, chama a API da Anthropic (a empresa que faz o
Claude). Pra isso funcionar, você precisa criar uma conta lá, pegar uma chave de API, e
colar ela nas configurações do projeto na Vercel. É pago, mas o custo por avaliação gerada
é bem pequeno (cada chamada usa poucas centenas de "tokens" — geralmente frações de
centavo de dólar).

## 1. Criar a conta e pegar a chave

1. Acesse **console.anthropic.com** e crie uma conta (ou entre, se já tiver).
2. Adicione um cartão/crédito na seção de faturamento (**Billing**) — a Anthropic cobra
   por uso, sem mensalidade fixa. Um valor pequeno (ex: US$ 5) já cobre bastante tempo de
   uso nesse projeto.
3. Vá em **API Keys** e clique em **Create Key**. Dê um nome (ex: "acordes-de-davi") e
   copie a chave gerada (começa com `sk-ant-...`) — ela só aparece uma vez, então copie
   antes de fechar a tela.

## 2. Colar a chave na Vercel

1. Acesse o painel do seu projeto na Vercel (**vercel.com** → o projeto
   "gbasiliom-projeto-acordes-de-davi").
2. Vá em **Settings → Environment Variables**.
3. Clique em **Add New**:
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: cole a chave `sk-ant-...` que você copiou
   - Marque pra valer em **Production** (e Preview/Development, se quiser testar fora do
     ar também)
4. Salve.
5. Importante: variável de ambiente nova só vale depois de um novo deploy — faça um novo
   `git push` (ou clique em "Redeploy" no painel da Vercel) depois de salvar a chave.

## 3. Pronto

Depois disso, o botão "Gerar com IA" (dentro de Avaliações → clique num aluno) já
funciona. Se algum dia a Anthropic descontinuar o modelo usado (`claude-3-5-haiku-latest`),
dá pra trocar sem mexer no código: crie outra variável de ambiente chamada
`ANTHROPIC_MODEL` na Vercel com o nome do modelo novo (veja a lista atual em
docs.anthropic.com/en/docs/about-claude/models).
