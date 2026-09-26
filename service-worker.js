// Nome della cache: cambialo (es. "haccp-v2") ogni volta che aggiorni
// i file dell'app, così i telefoni scaricano la versione nuova invece
// di continuare a usare quella salvata.
const NOME_CACHE = "haccp-v3";

const FILE_DA_SALVARE = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
];

self.addEventListener("install", (evento) => {
    evento.waitUntil(
        caches.open(NOME_CACHE).then((cache) => cache.addAll(FILE_DA_SALVARE))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
    evento.waitUntil(
        caches.keys().then((nomi) =>
            Promise.all(
                nomi.filter((nome) => nome !== NOME_CACHE).map((nome) => caches.delete(nome))
            )
        )
    );
    self.clients.claim();
});

// Strategia: prova prima la cache (veloce, funziona offline), e se il
// file non c'è prova la rete. I dati (Firestore) NON passano da qui:
// quelli li gestisce direttamente la libreria Firebase con la sua
// cache separata (IndexedDB), impostata in app.js.
self.addEventListener("fetch", (evento) => {
    evento.respondWith(
        caches.match(evento.request).then((rispostaCache) => rispostaCache || fetch(evento.request))
    );
});
