// Trocar esse número (v1 -> v2 -> v3...) força TODO MUNDO a jogar fora o cache antigo
// na próxima vez que abrir o app — é o "botão de emergência" caso um dia isso precise
// ser repetido (ex: depois de algum problema estranho que só resolve fechando e abrindo
// o app várias vezes). Bati esse número pra v2 justamente por causa desse problema.
const CACHE_NAME = 'acordes-de-davi-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Guarda em cache só os arquivos do próprio site (HTML/JS/CSS/ícones).
// Nunca intercepta chamadas do Firebase/Firestore — essas sempre vão direto pra rede,
// pra não correr o risco de mostrar dado desatualizado (vaga ocupada, pagamento, etc.).
//
// IMPORTANTE: antes, aqui embaixo mostrava primeiro a versão GUARDADA (cache) e só
// buscava a versão nova por baixo dos panos, pra usar da próxima vez — então, toda vez
// que você publicava uma correção (como as dessa conversa), o app instalado continuava
// mostrando o código ANTIGO até você fechar e abrir de novo (às vezes mais de uma vez),
// o que parecia um "bug" (ex: o Portal do Aluno não reconhecer uma aula que já existia).
// Agora é o contrário: tenta a rede primeiro (pega sempre a versão mais nova, com
// qualquer correção publicada), e só usa a versão guardada em cache se estiver sem
// internet no momento. Com internet normal, você nunca mais deve precisar "atualizar
// direto" pra ver uma correção nova.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        // Só cai pro cache quando a rede falha de verdade (sem internet) — nunca por
        // preferência, pra sempre priorizar a versão mais atual do site.
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
      }
    })
  );
});
