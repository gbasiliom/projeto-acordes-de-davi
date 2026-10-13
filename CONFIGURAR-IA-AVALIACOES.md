# Como configurar a IA das Avaliações (GEMINI_API_KEY)

O botão "Gerar com IA", na aba Avaliações, chama a API do **Google Gemini**. Pra isso
funcionar, você precisa pegar uma chave de API gratuita no Google AI Studio e colar ela
nas configurações do projeto na Vercel. Pro volume de uso desse projeto (algumas
avaliações por vez), a camada gratuita do Gemini cobre numa boa — sem precisar cadastrar
cartão de crédito.

## 1. Pegar a chave gratuita

1. Acesse **aistudio.google.com/apikey** e entre com uma conta Google (a mesma que você já
   usa no Gmail/Drive serve).
2. Clique em **Create API key** (ou "Get API key" / "Criar chave de API", dependendo do
   idioma da tela).
3. Escolha criar num projeto novo do Google Cloud (a própria tela do AI Studio oferece
   essa opção pronta — não precisa configurar nada manualmente).
4. Copie a chave gerada (começa com `AIza...`).

## 2. Colar a chave na Vercel

1. Acesse o painel do seu projeto na Vercel (**vercel.com** → o projeto
   "gbasiliom-projeto-acordes-de-davi").
2. Vá em **Settings → Environment Variables**.
3. Clique em **Add New**:
   - **Key**: `GEMINI_API_KEY`
   - **Value**: cole a chave `AIza...` que você copiou
   - Marque pra valer em **Production** (e Preview/Development, se quiser testar fora do
     ar também)
4. Salve.
5. Se você tinha configurado a variável antiga `ANTHROPIC_API_KEY` numa tentativa
   anterior, pode deixar ela lá sem problema (não é mais usada) ou remover, como preferir.
6. Importante: variável de ambiente nova só vale depois de um novo deploy — faça um novo
   `git push` (ou clique em "Redeploy" no painel da Vercel) depois de salvar a chave.

## 3. Pronto

Depois disso, o botão "Gerar com IA" (dentro de Avaliações → clique num aluno) já
funciona, gratuitamente. Se algum dia o Google descontinuar o modelo usado
(`gemini-3.8-flash`), dá pra trocar sem mexer no código: crie outra variável de ambiente
chamada `GEMINI_MODEL` na Vercel com o nome do modelo novo (veja a lista atual, e quais
têm camada gratuita, em ai.google.dev/gemini-api/docs/pricing).

## Sobre o limite gratuito

A camada gratuita do Gemini tem um limite de quantas chamadas você pode fazer por minuto
e por dia — bem acima do que esse projeto usa no dia a dia (gerar uma avaliação por
aluno, de vez em quando). Se algum dia a coordenação crescer muito e isso virar um
problema, o Google avisa com um erro específico de limite excedido (não cobra nada sem
avisar antes) — aí dá pra decidir se vale a pena habilitar faturamento ou trocar de
modelo.
