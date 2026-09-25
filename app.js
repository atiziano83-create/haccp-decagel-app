// ============================================================
// CONFIGURAZIONE FIREBASE
// Incolla qui sotto il blocco "firebaseConfig" che trovi nella
// console Firebase (Impostazioni progetto > Generali > Le tue app).
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyCOIXb0ggmrd8-R1xtS0GPbWhZT5wjCJK0",
    authDomain: "haccp-decagel.firebaseapp.com",
    projectId: "haccp-decagel",
    storageBucket: "haccp-decagel.firebasestorage.app",
    messagingSenderId: "585663608757",
    appId: "1:585663608757:web:e92845b6f14078461a0bfc",
};

// ============================================================
// ELENCO CAMION
// Modifica/aggiungi righe qui per tenere aggiornato l'elenco.
// ============================================================
const CAMION = [
    { targa: "FH316ZA", modello: "Iveco Daily 35C15" },
    { targa: "FH356ZA", modello: "Iveco Daily 35C16" },
    { targa: "GM384DJ", modello: "Iveco Daily 35C16" },
    { targa: "GV863DA", modello: "Renault Master" },
];

// ============================================================
// INIZIALIZZAZIONE FIREBASE (con supporto offline)
// ============================================================
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch((errore) => {
    console.warn("Persistenza offline non attivata:", errore.code);
});

// ============================================================
// STATO
// ============================================================
let azioneCorrente = null; // "partenza" oppure "fine"
let valoreTemp = -18;
let docOggiRef = null;
let annullaAscolto = null;

// ============================================================
// UTILITÀ
// ============================================================
function dataOggiISO() {
    const ora = new Date();
    const anno = ora.getFullYear();
    const mese = String(ora.getMonth() + 1).padStart(2, "0");
    const giorno = String(ora.getDate()).padStart(2, "0");
    return `${anno}-${mese}-${giorno}`;
}

function dataOggiLeggibile() {
    const ora = new Date();
    return ora.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}

function oraCorrenteHHMM() {
    const ora = new Date();
    return `${String(ora.getHours()).padStart(2, "0")}:${String(ora.getMinutes()).padStart(2, "0")}`;
}

function mostraSchermo(id) {
    document.querySelectorAll(".schermo").forEach((el) => el.classList.remove("attiva"));
    document.getElementById(id).classList.add("attiva");
}

// ============================================================
// BADGE ONLINE/OFFLINE
// ============================================================
function aggiornaBadgeConnessione() {
    const badge = document.getElementById("badge-stato");
    if (navigator.onLine) {
        badge.textContent = "🟢 Online";
        badge.className = "badge-stato online";
    } else {
        badge.textContent = "🟠 Offline (salvataggio in locale)";
        badge.className = "badge-stato offline";
    }
}
window.addEventListener("online", aggiornaBadgeConnessione);
window.addEventListener("offline", aggiornaBadgeConnessione);

// ============================================================
// SETUP INIZIALE (nome + camion)
// ============================================================
function popolaSelectCamion() {
    const select = document.getElementById("input-camion");
    select.innerHTML = "";
    CAMION.forEach((c) => {
        const opzione = document.createElement("option");
        opzione.value = c.targa;
        opzione.textContent = `${c.targa} - ${c.modello}`;
        select.appendChild(opzione);
    });
}

function haIdentitaSalvata() {
    return localStorage.getItem("haccp_autista") && localStorage.getItem("haccp_targa");
}

document.getElementById("btn-conferma-setup").addEventListener("click", () => {
    const nome = document.getElementById("input-nome").value.trim();
    const targa = document.getElementById("input-camion").value;
    if (!nome) {
        alert("Scrivi il tuo nome prima di continuare.");
        return;
    }
    localStorage.setItem("haccp_autista", nome);
    localStorage.setItem("haccp_targa", targa);
    avviaSchermoPrincipale();
});

document.getElementById("btn-cambia-identita").addEventListener("click", () => {
    if (annullaAscolto) annullaAscolto();
    document.getElementById("input-nome").value = localStorage.getItem("haccp_autista") || "";
    document.getElementById("input-camion").value = localStorage.getItem("haccp_targa") || "";
    mostraSchermo("schermo-setup");
});

// ============================================================
// SCHERMO PRINCIPALE
// ============================================================
function avviaSchermoPrincipale() {
    const nome = localStorage.getItem("haccp_autista");
    const targa = localStorage.getItem("haccp_targa");
    const camion = CAMION.find((c) => c.targa === targa);

    document.getElementById("titolo-data").textContent = dataOggiLeggibile();
    document.getElementById("testo-autista").textContent = nome;
    document.getElementById("testo-camion").textContent = camion
        ? `${camion.targa} - ${camion.modello}`
        : targa;

    mostraSchermo("schermo-principale");
    ascoltaDocumentoOggi(targa);
}

function idDocumentoOggi(targa) {
    return `${dataOggiISO()}_${targa}`;
}

function ascoltaDocumentoOggi(targa) {
    if (annullaAscolto) annullaAscolto();

    docOggiRef = db.collection("temp_camion").doc(idDocumentoOggi(targa));

    annullaAscolto = docOggiRef.onSnapshot(
        (snap) => {
            const dati = snap.exists ? snap.data() : {};
            aggiornaRiquadro("partenza", dati.temp_partenza, dati.ora_partenza);
            aggiornaRiquadro("fine", dati.temp_fine, dati.ora_fine);
        },
        (errore) => {
            console.error("Errore lettura dati di oggi:", errore);
        }
    );
}

function aggiornaRiquadro(tipo, temp, ora) {
    const riquadro = document.getElementById(`riquadro-${tipo}`);
    const esito = document.getElementById(`esito-${tipo}`);
    const bottone = document.getElementById(`btn-${tipo}`);

    if (temp !== undefined && temp !== null) {
        esito.textContent = `✅ ${temp}°C alle ${ora || "—"}`;
        esito.classList.remove("vuoto");
        riquadro.classList.add("fatto");
        bottone.textContent = "Modifica";
    } else {
        esito.textContent = "Non ancora registrata";
        esito.classList.add("vuoto");
        riquadro.classList.remove("fatto");
        bottone.textContent = "Registra temperatura";
    }
}

// ============================================================
// MODALE INSERIMENTO TEMPERATURA
// ============================================================
function apriModaleTemp(tipo) {
    azioneCorrente = tipo;
    valoreTemp = -18;
    document.getElementById("valore-temp").textContent = valoreTemp;
    document.getElementById("titolo-modale").textContent =
        tipo === "partenza" ? "🌅 Temperatura di partenza" : "🌇 Temperatura di fine giro";
    document.getElementById("ora-modale").textContent = `Ora attuale: ${oraCorrenteHHMM()}`;
    document.getElementById("overlay-temp").classList.add("attiva");
}

function chiudiModaleTemp() {
    document.getElementById("overlay-temp").classList.remove("attiva");
    azioneCorrente = null;
}

document.getElementById("btn-partenza").addEventListener("click", () => apriModaleTemp("partenza"));
document.getElementById("btn-fine").addEventListener("click", () => apriModaleTemp("fine"));
document.getElementById("btn-annulla-temp").addEventListener("click", chiudiModaleTemp);

document.getElementById("btn-meno").addEventListener("click", () => {
    valoreTemp -= 1;
    document.getElementById("valore-temp").textContent = valoreTemp;
});
document.getElementById("btn-piu").addEventListener("click", () => {
    valoreTemp += 1;
    document.getElementById("valore-temp").textContent = valoreTemp;
});

document.getElementById("btn-conferma-temp").addEventListener("click", () => {
    const targa = localStorage.getItem("haccp_targa");
    const nome = localStorage.getItem("haccp_autista");
    const campoTemp = azioneCorrente === "partenza" ? "temp_partenza" : "temp_fine";
    const campoOra = azioneCorrente === "partenza" ? "ora_partenza" : "ora_fine";

    const dati = {
        data: dataOggiISO(),
        targa: targa,
        autista: nome,
        [campoTemp]: valoreTemp,
        [campoOra]: oraCorrenteHHMM(),
        aggiornato_il: firebase.firestore.FieldValue.serverTimestamp(),
    };

    // Il .set con merge:true funziona anche offline: Firestore mette la
    // scrittura in coda localmente e la manda al server da sola non
    // appena il telefono torna online, senza bisogno di fare nulla.
    docOggiRef.set(dati, { merge: true });

    chiudiModaleTemp();
});

// ============================================================
// SERVICE WORKER (per far funzionare l'app anche offline)
// ============================================================
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js");
    });
}

// ============================================================
// AVVIO
// ============================================================
popolaSelectCamion();
aggiornaBadgeConnessione();

if (haIdentitaSalvata()) {
    avviaSchermoPrincipale();
} else {
    mostraSchermo("schermo-setup");
}
