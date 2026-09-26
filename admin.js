// ============================================================
// CONFIGURAZIONE FIREBASE (stessa app del resto del progetto)
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyCOIXb0ggmrd8-R1xtS0GPbWhZT5wjCJK0",
    authDomain: "haccp-decagel.firebaseapp.com",
    projectId: "haccp-decagel",
    storageBucket: "haccp-decagel.firebasestorage.app",
    messagingSenderId: "585663608757",
    appId: "1:585663608757:web:e92845b6f14078461a0bfc",
};

// Hash SHA-256 della password admin (per ora la stessa del Listino B2B).
const PASSWORD_HASH = "893b1f8fc0fcc0587bb2f02fa8df1ca3039b9c8deae23935b6b3243e97e857a0";

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Accesso anonimo: le regole di sicurezza richiedono un utente
// autenticato (anche solo in modo anonimo) per leggere i dati.
const accessoAnonimoPronto = firebase.auth().signInAnonymously().catch((errore) => {
    console.error("Accesso anonimo non riuscito:", errore.code);
});

// ============================================================
// REGOLA GIORNI LAVORATIVI: da lunedì a venerdì sempre, il sabato
// solo nei mesi estivi. Modifica l'elenco qui sotto per cambiare
// quali mesi contano come "estivi" (1 = gennaio ... 12 = dicembre).
// ============================================================
const MESI_ESTIVI = [6, 7, 8, 9]; // giugno, luglio, agosto, settembre

function giornoLavorativo(data) {
    const giorno = data.getDay(); // 0 = domenica ... 6 = sabato
    if (giorno === 0) return false; // domenica mai
    if (giorno === 6) {
        const mese = data.getMonth() + 1;
        return MESI_ESTIVI.includes(mese);
    }
    return giorno >= 1 && giorno <= 5; // lunedì - venerdì
}

function dataISO(data) {
    const anno = data.getFullYear();
    const mese = String(data.getMonth() + 1).padStart(2, "0");
    const giorno = String(data.getDate()).padStart(2, "0");
    return `${anno}-${mese}-${giorno}`;
}

function dataLeggibile(data) {
    return data.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
}

function mostraSchermo(id) {
    document.querySelectorAll(".schermo").forEach((el) => el.classList.remove("attiva"));
    document.getElementById(id).classList.add("attiva");
}

async function calcolaHash(testo) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(testo));
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================================
// LOGIN
// ============================================================
document.getElementById("btn-login").addEventListener("click", eseguiLogin);
document.getElementById("input-password").addEventListener("keydown", (evento) => {
    if (evento.key === "Enter") eseguiLogin();
});

async function eseguiLogin() {
    const password = document.getElementById("input-password").value;
    const hash = await calcolaHash(password);
    const erroreEl = document.getElementById("errore-login");

    if (hash === PASSWORD_HASH) {
        erroreEl.style.display = "none";
        sessionStorage.setItem("haccp_admin_ok", "1");
        avviaDashboard();
    } else {
        erroreEl.style.display = "block";
    }
}

// ============================================================
// DASHBOARD
// ============================================================
const AUTISTI = CAMION.filter((c) => c.autista);

async function avviaDashboard() {
    mostraSchermo("schermo-dashboard");
    document.getElementById("sottotitolo-data").textContent = dataLeggibile(new Date());
    await accessoAnonimoPronto;
    await Promise.all([caricaSituazioneOggi(), caricaGiorniMancanti()]);
}

async function caricaSituazioneOggi() {
    const contenitore = document.getElementById("lista-oggi");
    contenitore.innerHTML = "";
    const oggiISO = dataISO(new Date());

    for (const camion of AUTISTI) {
        const idDoc = `${oggiISO}_${camion.targa}`;
        let dati = {};
        try {
            const snap = await db.collection("temp_camion").doc(idDoc).get();
            dati = snap.exists ? snap.data() : {};
        } catch (errore) {
            console.error("Errore lettura", idDoc, errore);
        }

        const riga = document.createElement("div");
        riga.className = "riga-camion";
        riga.innerHTML = `
            <div class="info-camion">
                <strong>${camion.autista}</strong>
                <span>${camion.targa} - ${camion.modello}</span>
            </div>
            <div class="stati">
                ${pallino("Partenza", dati.temp_partenza)}
                ${pallino("Fine", dati.temp_fine)}
            </div>
        `;
        contenitore.appendChild(riga);
    }
}

function pallino(etichetta, valore) {
    const presente = valore !== undefined && valore !== null;
    const classe = presente ? "ok" : "mancante";
    const testo = presente ? `✅ ${etichetta}` : `⏳ ${etichetta}`;
    return `<span class="pallino ${classe}">${testo}</span>`;
}

// ============================================================
// GIORNI MANCANTI (ultime 2 settimane, solo giorni lavorativi)
// ============================================================
const GIORNI_DA_CONTROLLARE = 14;

async function caricaGiorniMancanti() {
    const contenitore = document.getElementById("lista-mancanti");
    contenitore.innerHTML = "";

    // Intervallo: da GIORNI_DA_CONTROLLARE giorni fa fino a ieri (oggi
    // escluso, perché la giornata di oggi non è ancora finita).
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    const ieri = new Date(oggi);
    ieri.setDate(ieri.getDate() - 1);
    const inizio = new Date(oggi);
    inizio.setDate(inizio.getDate() - GIORNI_DA_CONTROLLARE);

    const giorniLavorativi = [];
    for (let d = new Date(inizio); d <= ieri; d.setDate(d.getDate() + 1)) {
        if (giornoLavorativo(d)) giorniLavorativi.push(dataISO(d));
    }

    let qualcheMancante = false;

    for (const camion of AUTISTI) {
        let documenti = [];
        try {
            const snap = await db.collection("temp_camion")
                .where("targa", "==", camion.targa)
                .where("data", ">=", dataISO(inizio))
                .where("data", "<=", dataISO(ieri))
                .get();
            documenti = snap.docs.map((doc) => doc.data());
        } catch (errore) {
            console.error("Errore verifica giorni mancanti per", camion.targa, errore);
        }

        const mappaDati = {};
        documenti.forEach((dati) => { mappaDati[dati.data] = dati; });

        const mancanti = giorniLavorativi.filter((giornoISO) => {
            const dati = mappaDati[giornoISO];
            if (!dati) return true;
            return dati.temp_partenza === undefined || dati.temp_partenza === null
                || dati.temp_fine === undefined || dati.temp_fine === null;
        });

        if (mancanti.length > 0) {
            qualcheMancante = true;
            const card = document.createElement("div");
            card.className = "card-autista-mancante";
            const elenco = mancanti.map((giornoISO) => {
                const dati = mappaDati[giornoISO];
                const parziale = dati && (dati.temp_partenza !== undefined || dati.temp_fine !== undefined);
                const dataLeg = dataLeggibile(new Date(giornoISO + "T00:00:00"));
                return `<li>${dataLeg}${parziale ? " (registrazione incompleta)" : " (nessun dato)"}</li>`;
            }).join("");
            card.innerHTML = `<strong>${camion.autista} — ${camion.targa}</strong><ul>${elenco}</ul>`;
            contenitore.appendChild(card);
        }
    }

    if (!qualcheMancante) {
        contenitore.innerHTML = '<div class="messaggio-ok">✅ Nessun giorno mancante negli ultimi 14 giorni lavorativi.</div>';
    }
}

// ============================================================
// AVVIO: se la sessione ha già superato il login in questa scheda,
// entra direttamente (evita di richiedere la password ad ogni click
// se l'admin naviga avanti e indietro nella stessa sessione browser).
// ============================================================
if (sessionStorage.getItem("haccp_admin_ok") === "1") {
    avviaDashboard();
} else {
    mostraSchermo("schermo-login");
}
