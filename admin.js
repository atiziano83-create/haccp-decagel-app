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
db.enablePersistence({ synchronizeTabs: true }).catch((errore) => {
    console.warn("Persistenza offline non attivata:", errore.code);
});

// Accesso anonimo: le regole di sicurezza richiedono un utente
// autenticato (anche solo in modo anonimo) per leggere i dati.
const accessoAnonimoPronto = firebase.auth().signInAnonymously().catch((errore) => {
    console.error("Accesso anonimo non riuscito:", errore.code);
});

function oraCorrenteHHMM() {
    const ora = new Date();
    return `${String(ora.getHours()).padStart(2, "0")}:${String(ora.getMinutes()).padStart(2, "0")}`;
}

// ============================================================
// REGOLA GIORNI LAVORATIVI: da lunedì a venerdì sempre, il sabato
// solo nei mesi estivi. Modifica l'elenco qui sotto per cambiare
// quali mesi contano come "estivi" (1 = gennaio ... 12 = dicembre).
// ============================================================
const MESI_ESTIVI = [6, 7, 8]; // giugno, luglio, agosto

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
// ANAGRAFICA (furgoni, autisti, celle) — caricata da Firestore.
// CAMION_INIZIALE/CELLE_INIZIALE (dati-camion.js/dati-celle.js)
// servono solo come elenco di partenza per la prima importazione,
// vedi sezione "ANAGRAFICA" più sotto.
// ============================================================
let CAMION = [];
let CELLE = [];
let AUTISTI = [];
let anagraficaCaricata = false;

// Un furgone/cella senza il campo "attivo" (dati creati prima di questa
// funzione) si considera attivo di default.
function eAttivo(elemento) {
    return elemento.attivo !== false;
}

async function caricaAnagrafica(forza) {
    if (anagraficaCaricata && !forza) return;
    const [snapCamion, snapCelle] = await Promise.all([
        db.collection("anagrafica_camion").get(),
        db.collection("anagrafica_celle").get(),
    ]);
    CAMION = snapCamion.docs.map((doc) => doc.data()).sort((a, b) => a.targa.localeCompare(b.targa));
    CELLE = snapCelle.docs.map((doc) => doc.data()).sort((a, b) => a.id.localeCompare(b.id));
    // Solo i furgoni attualmente attivi entrano nei controlli giornalieri
    // (situazione di oggi, giorni mancanti): un furgone fermo/fuori
    // stagione non deve generare falsi allarmi.
    AUTISTI = CAMION.filter((c) => c.autista && eAttivo(c));
    anagraficaCaricata = true;
}

async function avviaDashboard() {
    mostraSchermo("schermo-dashboard");
    document.getElementById("sottotitolo-data").textContent = dataLeggibile(new Date());
    await accessoAnonimoPronto;
    await caricaAnagrafica();
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
            const dettagli = document.createElement("details");
            dettagli.className = "card-autista-mancante";

            const righe = mancanti.map((giornoISO) => {
                const dati = mappaDati[giornoISO];
                const mancaPartenza = !dati || dati.temp_partenza === undefined || dati.temp_partenza === null;
                const mancaFine = !dati || dati.temp_fine === undefined || dati.temp_fine === null;
                const dataLeg = dataLeggibile(new Date(giornoISO + "T00:00:00"));

                const bottoni = [];
                if (mancaPartenza) bottoni.push(`<button class="btn-inserisci-mancante" data-targa="${camion.targa}" data-giorno="${giornoISO}" data-momento="partenza">🌅 Inserisci partenza</button>`);
                if (mancaFine) bottoni.push(`<button class="btn-inserisci-mancante" data-targa="${camion.targa}" data-giorno="${giornoISO}" data-momento="fine">🌇 Inserisci fine</button>`);

                return `<li>${dataLeg} <div class="azioni-giorno-mancante">${bottoni.join("")}</div></li>`;
            }).join("");

            dettagli.innerHTML = `
                <summary>${camion.autista} — ${camion.targa} (${mancanti.length} ${mancanti.length === 1 ? "giorno" : "giorni"})</summary>
                <ul>${righe}</ul>
            `;
            contenitore.appendChild(dettagli);
        }
    }

    if (!qualcheMancante) {
        contenitore.innerHTML = '<div class="messaggio-ok">✅ Nessun giorno mancante negli ultimi 14 giorni lavorativi.</div>';
    }

    contenitore.querySelectorAll(".btn-inserisci-mancante").forEach((bottone) => {
        bottone.addEventListener("click", () => {
            apriModaleBackfillCamion(bottone.dataset.targa, bottone.dataset.giorno, bottone.dataset.momento);
        });
    });
}

// ============================================================
// INSERIMENTO A POSTERIORI (giorni mancanti) TEMP CAMION
// ============================================================
let backfillTarga = null;
let backfillGiorno = null;
let backfillMomento = null; // "partenza" oppure "fine"
let valoreTempBackfill = -18;
let backfillAlSalvataggio = null; // funzione da richiamare dopo il salvataggio (per aggiornare dashboard o report)

function apriModaleBackfillCamion(targa, giornoISO, momento, alSalvataggio) {
    backfillTarga = targa;
    backfillGiorno = giornoISO;
    backfillMomento = momento;
    backfillAlSalvataggio = alSalvataggio || caricaGiorniMancanti;
    valoreTempBackfill = -18;

    const camionInfo = CAMION.find((c) => c.targa === targa);
    document.getElementById("valore-temp-backfill").textContent = valoreTempBackfill;
    document.getElementById("titolo-modale-backfill").textContent =
        `${momento === "partenza" ? "🌅 Partenza" : "🌇 Fine"} — ${camionInfo ? camionInfo.autista : targa}`;
    document.getElementById("sottotitolo-modale-backfill").textContent =
        `${targa} · ${dataLeggibile(new Date(giornoISO + "T00:00:00"))}`;
    document.getElementById("overlay-backfill-camion").classList.add("attiva");
}

function chiudiModaleBackfillCamion() {
    document.getElementById("overlay-backfill-camion").classList.remove("attiva");
    backfillTarga = null;
    backfillGiorno = null;
    backfillMomento = null;
}

document.getElementById("btn-meno-backfill").addEventListener("click", () => {
    valoreTempBackfill -= 1;
    document.getElementById("valore-temp-backfill").textContent = valoreTempBackfill;
});
document.getElementById("btn-piu-backfill").addEventListener("click", () => {
    valoreTempBackfill += 1;
    document.getElementById("valore-temp-backfill").textContent = valoreTempBackfill;
});
document.getElementById("btn-annulla-backfill").addEventListener("click", chiudiModaleBackfillCamion);

document.getElementById("btn-conferma-backfill").addEventListener("click", async () => {
    if (!backfillTarga || !backfillGiorno || !backfillMomento) return;

    const camionInfo = CAMION.find((c) => c.targa === backfillTarga);
    const campoTemp = backfillMomento === "partenza" ? "temp_partenza" : "temp_fine";
    const campoOra = backfillMomento === "partenza" ? "ora_partenza" : "ora_fine";
    const idDoc = `${backfillGiorno}_${backfillTarga}`;

    const dati = {
        data: backfillGiorno,
        targa: backfillTarga,
        autista: camionInfo ? camionInfo.autista : "",
        [campoTemp]: valoreTempBackfill,
        [campoOra]: `${oraCorrenteHHMM()} (inserito da admin)`,
        aggiornato_il: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("temp_camion").doc(idDoc).set(dati, { merge: true });

    chiudiModaleBackfillCamion();
    if (backfillAlSalvataggio) backfillAlSalvataggio();
});

// ============================================================
// INSERIMENTO A POSTERIORI (giorni mancanti) TEMP CELLE
// ============================================================
let backfillIdCella = null;
let backfillGiornoCella = null;
let backfillMomentoCella = null; // "mattina" oppure "pomeriggio"
let valoreTempBackfillCella = -20;
let backfillCellaAlSalvataggio = null;

function apriModaleBackfillCella(idCella, giornoISO, momento, alSalvataggio) {
    backfillIdCella = idCella;
    backfillGiornoCella = giornoISO;
    backfillMomentoCella = momento;
    backfillCellaAlSalvataggio = alSalvataggio || null;

    const cellaInfo = CELLE.find((c) => c.id === idCella);
    valoreTempBackfillCella = cellaInfo ? Math.round(cellaInfo.temp_nominale) : -20;

    document.getElementById("valore-temp-backfill-cella").textContent = valoreTempBackfillCella;
    document.getElementById("titolo-modale-backfill-cella").textContent =
        `${momento === "mattina" ? "🌅 Mattina" : "🌇 Pomeriggio"} — ${cellaInfo ? cellaInfo.nome : idCella}`;
    document.getElementById("sottotitolo-modale-backfill-cella").textContent =
        `${idCella} · ${dataLeggibile(new Date(giornoISO + "T00:00:00"))}`;
    document.getElementById("overlay-backfill-cella").classList.add("attiva");
}

function chiudiModaleBackfillCella() {
    document.getElementById("overlay-backfill-cella").classList.remove("attiva");
    backfillIdCella = null;
    backfillGiornoCella = null;
    backfillMomentoCella = null;
}

document.getElementById("btn-meno-backfill-cella").addEventListener("click", () => {
    valoreTempBackfillCella -= 1;
    document.getElementById("valore-temp-backfill-cella").textContent = valoreTempBackfillCella;
});
document.getElementById("btn-piu-backfill-cella").addEventListener("click", () => {
    valoreTempBackfillCella += 1;
    document.getElementById("valore-temp-backfill-cella").textContent = valoreTempBackfillCella;
});
document.getElementById("btn-annulla-backfill-cella").addEventListener("click", chiudiModaleBackfillCella);

document.getElementById("btn-conferma-backfill-cella").addEventListener("click", async () => {
    if (!backfillIdCella || !backfillGiornoCella || !backfillMomentoCella) return;

    const cellaInfo = CELLE.find((c) => c.id === backfillIdCella);
    const campoTemp = backfillMomentoCella === "mattina" ? "temp_mattina" : "temp_pomeriggio";
    const campoOra = backfillMomentoCella === "mattina" ? "ora_mattina" : "ora_pomeriggio";
    const idDoc = `${backfillGiornoCella}_${backfillIdCella}`;

    const dati = {
        data: backfillGiornoCella,
        id_cella: backfillIdCella,
        nome_cella: cellaInfo ? cellaInfo.nome : "",
        [campoTemp]: valoreTempBackfillCella,
        [campoOra]: `${oraCorrenteHHMM()} (inserito da admin)`,
        aggiornato_il: firebase.firestore.FieldValue.serverTimestamp(),
    };

    await db.collection("temp_celle").doc(idDoc).set(dati, { merge: true });

    chiudiModaleBackfillCella();
    if (backfillCellaAlSalvataggio) backfillCellaAlSalvataggio();
});

// ============================================================
// TEMPERATURE CELLE (mattina/pomeriggio)
// ============================================================
let cellaCorrente = null;
let momentoCorrente = null; // "mattina" oppure "pomeriggio"
let valoreTempCella = -20;

document.getElementById("btn-celle").addEventListener("click", async () => {
    mostraSchermo("schermo-celle");
    document.getElementById("sottotitolo-data-celle").textContent = dataLeggibile(new Date());
    await accessoAnonimoPronto;
    caricaSituazioneCelle();
});
document.getElementById("btn-torna-dashboard").addEventListener("click", () => mostraSchermo("schermo-dashboard"));

async function caricaSituazioneCelle() {
    const contenitore = document.getElementById("lista-celle");
    contenitore.innerHTML = "Caricamento…";
    const oggiISO = dataISO(new Date());
    let html = "";

    for (const cella of CELLE.filter(eAttivo)) {
        const idDoc = `${oggiISO}_${cella.id}`;
        let dati = {};
        try {
            const snap = await db.collection("temp_celle").doc(idDoc).get();
            dati = snap.exists ? snap.data() : {};
        } catch (errore) {
            console.error("Errore lettura cella", idDoc, errore);
        }

        html += `
            <div class="card-identita">
                <div class="info">
                    <strong>${cella.nome}</strong>
                    <span>${cella.localizzazione} · nominale ${cella.temp_nominale}°C</span>
                </div>
            </div>
            <div class="azioni">
                <div class="riquadro-azione partenza">
                    <div class="titolo-riga"><span class="titolo">🌅 Mattina</span></div>
                    <div class="esito ${dati.temp_mattina != null ? "" : "vuoto"}">${dati.temp_mattina != null ? `✅ ${dati.temp_mattina}°C alle ${dati.ora_mattina || "—"}` : "Non ancora registrata"}</div>
                    <button class="grande btn-registra-cella" data-id-cella="${cella.id}" data-momento="mattina">${dati.temp_mattina != null ? "Modifica" : "Registra temperatura"}</button>
                </div>
                <div class="riquadro-azione fine">
                    <div class="titolo-riga"><span class="titolo">🌇 Pomeriggio</span></div>
                    <div class="esito ${dati.temp_pomeriggio != null ? "" : "vuoto"}">${dati.temp_pomeriggio != null ? `✅ ${dati.temp_pomeriggio}°C alle ${dati.ora_pomeriggio || "—"}` : "Non ancora registrata"}</div>
                    <button class="grande btn-registra-cella" data-id-cella="${cella.id}" data-momento="pomeriggio">${dati.temp_pomeriggio != null ? "Modifica" : "Registra temperatura"}</button>
                </div>
            </div>
        `;
    }
    contenitore.innerHTML = html || '<div class="messaggio-ok">Nessuna cella attiva al momento (vedi Anagrafica).</div>';

    contenitore.querySelectorAll(".btn-registra-cella").forEach((bottone) => {
        bottone.addEventListener("click", () => {
            apriModaleCella(bottone.dataset.idCella, bottone.dataset.momento);
        });
    });
}

function apriModaleCella(idCella, momento) {
    cellaCorrente = CELLE.find((c) => c.id === idCella);
    momentoCorrente = momento;
    if (!cellaCorrente) return;

    valoreTempCella = Math.round(cellaCorrente.temp_nominale);
    document.getElementById("valore-temp-cella").textContent = valoreTempCella;
    document.getElementById("titolo-modale-cella").textContent =
        `${momento === "mattina" ? "🌅" : "🌇"} ${cellaCorrente.nome} — ${momento === "mattina" ? "Mattina" : "Pomeriggio"}`;
    document.getElementById("ora-modale-cella").textContent = `Ora attuale: ${oraCorrenteHHMM()}`;
    document.getElementById("input-note-cella").value = "";
    document.getElementById("overlay-temp-cella").classList.add("attiva");
}

function chiudiModaleCella() {
    document.getElementById("overlay-temp-cella").classList.remove("attiva");
    cellaCorrente = null;
    momentoCorrente = null;
}

document.getElementById("btn-meno-cella").addEventListener("click", () => {
    valoreTempCella -= 1;
    document.getElementById("valore-temp-cella").textContent = valoreTempCella;
});
document.getElementById("btn-piu-cella").addEventListener("click", () => {
    valoreTempCella += 1;
    document.getElementById("valore-temp-cella").textContent = valoreTempCella;
});
document.getElementById("btn-annulla-temp-cella").addEventListener("click", chiudiModaleCella);

document.getElementById("btn-conferma-temp-cella").addEventListener("click", async () => {
    if (!cellaCorrente || !momentoCorrente) return;

    const oggiISO = dataISO(new Date());
    const idDoc = `${oggiISO}_${cellaCorrente.id}`;
    const campoTemp = momentoCorrente === "mattina" ? "temp_mattina" : "temp_pomeriggio";
    const campoOra = momentoCorrente === "mattina" ? "ora_mattina" : "ora_pomeriggio";
    const note = document.getElementById("input-note-cella").value.trim();

    const dati = {
        data: oggiISO,
        id_cella: cellaCorrente.id,
        nome_cella: cellaCorrente.nome,
        [campoTemp]: valoreTempCella,
        [campoOra]: oraCorrenteHHMM(),
        aggiornato_il: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (note) dati.note = note;

    // Il .set con merge:true funziona anche offline: la scrittura resta
    // in coda in locale e parte da sola non appena torna la connessione.
    db.collection("temp_celle").doc(idDoc).set(dati, { merge: true });

    chiudiModaleCella();
    caricaSituazioneCelle();
});

// ============================================================
// RICEVIMENTO MERCE
// ============================================================
const VALORE_FORNITORE_ALTRO = "__altro__";
let conformitaScelta = null; // "CONFORME" oppure "NON_CONFORME"

document.getElementById("btn-ricevimento").addEventListener("click", async () => {
    mostraSchermo("schermo-ricevimento");
    document.getElementById("sottotitolo-data-ricevimento").textContent = dataLeggibile(new Date());
    popolaSelectFornitore();
    precompilaOperatore();
    await accessoAnonimoPronto;
    caricaRicevimentiOggi();
});
document.getElementById("btn-torna-dashboard-ricevimento").addEventListener("click", () => mostraSchermo("schermo-dashboard"));

function popolaSelectFornitore() {
    const select = document.getElementById("input-fornitore");
    if (select.dataset.popolato === "1") return; // evita di ripopolare ad ogni apertura
    select.innerHTML = "";
    FORNITORI.forEach((nome) => {
        const opzione = document.createElement("option");
        opzione.value = nome;
        opzione.textContent = nome;
        select.appendChild(opzione);
    });
    const opzioneAltro = document.createElement("option");
    opzioneAltro.value = VALORE_FORNITORE_ALTRO;
    opzioneAltro.textContent = "Altro (non in elenco)";
    select.appendChild(opzioneAltro);
    select.dataset.popolato = "1";

    select.addEventListener("change", () => {
        document.getElementById("campo-fornitore-altro").style.display =
            select.value === VALORE_FORNITORE_ALTRO ? "block" : "none";
    });
}

function precompilaOperatore() {
    const campo = document.getElementById("input-operatore");
    if (!campo.value) {
        campo.value = localStorage.getItem("haccp_operatore_ricevimento") || "";
    }
}

function impostaConformita(valore) {
    conformitaScelta = valore;
    document.getElementById("btn-conforme").classList.toggle("selezionato", valore === "CONFORME");
    document.getElementById("btn-non-conforme").classList.toggle("selezionato", valore === "NON_CONFORME");
}
document.getElementById("btn-conforme").addEventListener("click", () => impostaConformita("CONFORME"));
document.getElementById("btn-non-conforme").addEventListener("click", () => impostaConformita("NON_CONFORME"));

document.getElementById("btn-salva-ricevimento").addEventListener("click", async () => {
    const sceltaFornitore = document.getElementById("input-fornitore").value;
    const fornitore = sceltaFornitore === VALORE_FORNITORE_ALTRO
        ? document.getElementById("input-fornitore-altro").value.trim()
        : sceltaFornitore;
    const categoria = document.getElementById("input-categoria").value;
    const numDoc = document.getElementById("input-num-doc").value.trim();
    const tempTesto = document.getElementById("input-temp-automezzo").value;
    const note = document.getElementById("input-note-ricevimento").value.trim();
    const operatore = document.getElementById("input-operatore").value.trim();

    if (!fornitore) { alert("Indica il fornitore."); return; }
    if (!conformitaScelta) { alert("Seleziona la conformità (Conforme / Non conforme)."); return; }
    if (!operatore) { alert("Scrivi il nome dell'operatore."); return; }

    const dati = {
        data: dataISO(new Date()),
        ora: oraCorrenteHHMM(),
        fornitore,
        categoria,
        num_doc: numDoc,
        conformita: conformitaScelta,
        note,
        operatore,
        creato_il: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (tempTesto !== "") dati.temp_automezzo = Number(tempTesto);

    localStorage.setItem("haccp_operatore_ricevimento", operatore);

    // .add() funziona anche offline: la scrittura resta in coda in
    // locale e parte da sola non appena torna la connessione.
    db.collection("ricevimento_merce").add(dati);

    // Reset del form per il prossimo ricevimento
    document.getElementById("input-num-doc").value = "";
    document.getElementById("input-temp-automezzo").value = "";
    document.getElementById("input-note-ricevimento").value = "";
    impostaConformita(null);

    caricaRicevimentiOggi();
});

async function caricaRicevimentiOggi() {
    const contenitore = document.getElementById("lista-ricevimenti");
    contenitore.innerHTML = "Caricamento…";
    const oggiISO = dataISO(new Date());

    let documenti = [];
    try {
        const snap = await db.collection("ricevimento_merce").where("data", "==", oggiISO).get();
        documenti = snap.docs.map((doc) => doc.data());
    } catch (errore) {
        console.error("Errore lettura ricevimenti di oggi:", errore);
    }

    if (documenti.length === 0) {
        contenitore.innerHTML = '<div class="messaggio-ok">Nessun ricevimento registrato oggi.</div>';
        return;
    }

    documenti.sort((a, b) => (a.ora || "").localeCompare(b.ora || ""));

    contenitore.innerHTML = documenti.map((r) => {
        const badge = r.conformita === "CONFORME"
            ? '<span class="pallino ok">✅ Conforme</span>'
            : '<span class="pallino mancante">⚠️ Non conforme</span>';
        const nota = r.note ? `<div class="note-ricevimento">📝 ${r.note}</div>` : "";
        const temp = r.temp_automezzo !== undefined ? ` · ${r.temp_automezzo}°C automezzo` : "";
        return `
            <div class="riga-ricevimento">
                <div class="riga-top">
                    <strong>${r.fornitore}</strong>
                    ${badge}
                </div>
                <div class="dettagli">${r.ora || "—"} · ${r.categoria || "—"} · DDT ${r.num_doc || "—"}${temp} · ${r.operatore || "—"}</div>
                ${nota}
            </div>
        `;
    }).join("");
}

// ============================================================
// REGISTRO PULIZIE
// ============================================================
let esitoPuliziaScelto = null; // "Completato" oppure "Non completato"

document.getElementById("btn-pulizie").addEventListener("click", async () => {
    mostraSchermo("schermo-pulizie");
    document.getElementById("sottotitolo-data-pulizie").textContent = dataLeggibile(new Date());
    popolaSelectAreaPulizia();
    popolaSelectFrequenza();
    precompilaOperatorePulizia();
    await accessoAnonimoPronto;
    caricaPulizieOggi();
});
document.getElementById("btn-torna-dashboard-pulizie").addEventListener("click", () => mostraSchermo("schermo-dashboard"));

function popolaSelectAreaPulizia() {
    const select = document.getElementById("input-area-pulizia");
    if (select.dataset.popolato === "1") return;
    select.innerHTML = "";

    const gruppoGenerico = document.createElement("optgroup");
    gruppoGenerico.label = "Aree generiche";
    AREE_PULIZIA_GENERICHE.forEach((nome) => {
        const opzione = document.createElement("option");
        opzione.value = nome;
        opzione.textContent = nome;
        gruppoGenerico.appendChild(opzione);
    });
    select.appendChild(gruppoGenerico);

    const gruppoCelle = document.createElement("optgroup");
    gruppoCelle.label = "Celle frigo";
    CELLE.forEach((cella) => {
        const opzione = document.createElement("option");
        opzione.value = `${cella.nome} (${cella.id})`;
        opzione.textContent = `${cella.nome} (${cella.id})`;
        gruppoCelle.appendChild(opzione);
    });
    select.appendChild(gruppoCelle);

    const gruppoCamion = document.createElement("optgroup");
    gruppoCamion.label = "Camion";
    CAMION.forEach((camion) => {
        const opzione = document.createElement("option");
        opzione.value = `${camion.targa} - ${camion.modello}`;
        opzione.textContent = `${camion.targa} - ${camion.modello}`;
        gruppoCamion.appendChild(opzione);
    });
    select.appendChild(gruppoCamion);

    select.dataset.popolato = "1";
}

function popolaSelectFrequenza() {
    const select = document.getElementById("input-frequenza");
    if (select.dataset.popolato === "1") return;
    select.innerHTML = "";
    FREQUENZE_PULIZIA.forEach((freq) => {
        const opzione = document.createElement("option");
        opzione.value = freq;
        opzione.textContent = freq;
        select.appendChild(opzione);
    });
    select.dataset.popolato = "1";
}

function precompilaOperatorePulizia() {
    const campo = document.getElementById("input-operatore-pulizia");
    if (!campo.value) {
        campo.value = localStorage.getItem("haccp_operatore_pulizia") || "";
    }
}

function impostaEsitoPulizia(valore) {
    esitoPuliziaScelto = valore;
    document.getElementById("btn-completato").classList.toggle("selezionato", valore === "Completato");
    document.getElementById("btn-non-completato").classList.toggle("selezionato", valore === "Non completato");
}
document.getElementById("btn-completato").addEventListener("click", () => impostaEsitoPulizia("Completato"));
document.getElementById("btn-non-completato").addEventListener("click", () => impostaEsitoPulizia("Non completato"));

document.getElementById("btn-salva-pulizia").addEventListener("click", async () => {
    const area = document.getElementById("input-area-pulizia").value;
    const frequenza = document.getElementById("input-frequenza").value;
    const note = document.getElementById("input-note-pulizia").value.trim();
    const operatore = document.getElementById("input-operatore-pulizia").value.trim();

    if (!esitoPuliziaScelto) { alert("Seleziona l'esito (Completato / Non completato)."); return; }
    if (!operatore) { alert("Scrivi il nome dell'operatore."); return; }

    const dati = {
        data: dataISO(new Date()),
        ora: oraCorrenteHHMM(),
        area,
        frequenza,
        esito: esitoPuliziaScelto,
        note,
        operatore,
        creato_il: firebase.firestore.FieldValue.serverTimestamp(),
    };

    localStorage.setItem("haccp_operatore_pulizia", operatore);

    // .add() funziona anche offline: la scrittura resta in coda in
    // locale e parte da sola non appena torna la connessione.
    db.collection("registro_pulizie").add(dati);

    document.getElementById("input-note-pulizia").value = "";
    impostaEsitoPulizia(null);

    caricaPulizieOggi();
});

async function caricaPulizieOggi() {
    const contenitore = document.getElementById("lista-pulizie");
    contenitore.innerHTML = "Caricamento…";
    const oggiISO = dataISO(new Date());

    let documenti = [];
    try {
        const snap = await db.collection("registro_pulizie").where("data", "==", oggiISO).get();
        documenti = snap.docs.map((doc) => doc.data());
    } catch (errore) {
        console.error("Errore lettura pulizie di oggi:", errore);
    }

    if (documenti.length === 0) {
        contenitore.innerHTML = '<div class="messaggio-ok">Nessuna pulizia registrata oggi.</div>';
        return;
    }

    documenti.sort((a, b) => (a.ora || "").localeCompare(b.ora || ""));

    contenitore.innerHTML = documenti.map((p) => {
        const badge = p.esito === "Completato"
            ? '<span class="pallino ok">✅ Completato</span>'
            : '<span class="pallino mancante">⚠️ Non completato</span>';
        const nota = p.note ? `<div class="note-ricevimento">📝 ${p.note}</div>` : "";
        return `
            <div class="riga-ricevimento">
                <div class="riga-top">
                    <strong>${p.area}</strong>
                    ${badge}
                </div>
                <div class="dettagli">${p.ora || "—"} · ${p.frequenza || "—"} · ${p.operatore || "—"}</div>
                ${nota}
            </div>
        `;
    }).join("");
}

// ============================================================
// ANAGRAFICA: gestione furgoni/autisti e celle direttamente
// dall'app, invece di modificare i file dati-camion.js/dati-celle.js
// a mano. I dati vivono su Firestore (anagrafica_camion, doc id =
// targa; anagrafica_celle, doc id = codice cella).
// ============================================================
document.getElementById("btn-anagrafica").addEventListener("click", async () => {
    mostraSchermo("schermo-anagrafica");
    await accessoAnonimoPronto;
    await caricaAnagrafica(true);
    disegnaListaAnagrafica();
});
document.getElementById("btn-torna-dashboard-anagrafica").addEventListener("click", () => mostraSchermo("schermo-dashboard"));

function disegnaListaAnagrafica() {
    const contFurgoni = document.getElementById("lista-furgoni-anagrafica");
    if (CAMION.length === 0) {
        contFurgoni.innerHTML = `
            <div class="messaggio-ok" style="color:#9c640c;">Nessun furgone in elenco.</div>
            <button class="bottone-secondario" id="btn-importa-predefiniti">📥 Importa elenco predefinito</button>
        `;
        const btnImporta = document.getElementById("btn-importa-predefiniti");
        if (btnImporta) btnImporta.addEventListener("click", importaElencoPredefinito);
    } else {
        contFurgoni.innerHTML = CAMION.map((c) => `
            <div class="riga-camion">
                <div class="info-camion">
                    <strong>${c.targa}${c.autista ? " — " + c.autista : ""}</strong>
                    <span>${c.modello || "—"}</span>
                    ${eAttivo(c) ? "" : '<span class="badge-inattivo">⏸️ Non attivo</span>'}
                </div>
                <button class="bottone-secondario btn-modifica-furgone" data-targa="${c.targa}">Modifica</button>
            </div>
        `).join("");
        contFurgoni.querySelectorAll(".btn-modifica-furgone").forEach((bottone) => {
            bottone.addEventListener("click", () => apriModaleFurgone(bottone.dataset.targa));
        });
    }

    const contCelle = document.getElementById("lista-celle-anagrafica");
    if (CELLE.length === 0) {
        contCelle.innerHTML = '<div class="messaggio-ok" style="color:#9c640c;">Nessuna cella in elenco.</div>';
    } else {
        contCelle.innerHTML = CELLE.map((c) => `
            <div class="riga-camion">
                <div class="info-camion">
                    <strong>${c.nome} (${c.id})</strong>
                    <span>${c.localizzazione || "—"} · nominale ${c.temp_nominale}°C</span>
                    ${eAttivo(c) ? "" : '<span class="badge-inattivo">⏸️ Non attiva</span>'}
                </div>
                <button class="bottone-secondario btn-modifica-cella-anagrafica" data-id-cella="${c.id}">Modifica</button>
            </div>
        `).join("");
        contCelle.querySelectorAll(".btn-modifica-cella-anagrafica").forEach((bottone) => {
            bottone.addEventListener("click", () => apriModaleCellaAnagrafica(bottone.dataset.idCella));
        });
    }
}

async function importaElencoPredefinito() {
    const scritture = [
        ...CAMION_INIZIALE.map((c) => db.collection("anagrafica_camion").doc(c.targa).set(c)),
        ...CELLE_INIZIALE.map((c) => db.collection("anagrafica_celle").doc(c.id).set(c)),
    ];
    await Promise.all(scritture);
    await ricaricaDopoModificaAnagrafica();
}

async function ricaricaDopoModificaAnagrafica() {
    await caricaAnagrafica(true);
    disegnaListaAnagrafica();
    // I menu a tendina che dipendono da CAMION/CELLE si ripopolano da
    // zero alla prossima apertura, così mostrano subito le modifiche.
    ["input-camion-report", "input-area-pulizia"].forEach((idSelect) => {
        const select = document.getElementById(idSelect);
        if (select) delete select.dataset.popolato;
    });
}

// --- Modale furgone (aggiungi/modifica/elimina) ---
let targaFurgoneInModifica = null;

function apriModaleFurgone(targa) {
    targaFurgoneInModifica = targa || null;
    const furgone = targa ? CAMION.find((c) => c.targa === targa) : null;

    document.getElementById("titolo-modale-furgone").textContent = furgone ? "Modifica furgone" : "Nuovo furgone";
    document.getElementById("input-targa-furgone").value = furgone ? furgone.targa : "";
    document.getElementById("input-targa-furgone").disabled = !!furgone;
    document.getElementById("input-modello-furgone").value = furgone ? (furgone.modello || "") : "";
    document.getElementById("input-autista-furgone").value = furgone ? (furgone.autista || "") : "";
    document.getElementById("input-attivo-furgone").checked = furgone ? eAttivo(furgone) : true;
    document.getElementById("btn-elimina-furgone").style.display = furgone ? "block" : "none";

    document.getElementById("overlay-furgone").classList.add("attiva");
}

function chiudiModaleFurgone() {
    document.getElementById("overlay-furgone").classList.remove("attiva");
    document.getElementById("input-targa-furgone").disabled = false;
    targaFurgoneInModifica = null;
}

document.getElementById("btn-aggiungi-furgone").addEventListener("click", () => apriModaleFurgone(null));
document.getElementById("btn-annulla-furgone").addEventListener("click", chiudiModaleFurgone);

document.getElementById("btn-conferma-furgone").addEventListener("click", async () => {
    const targa = document.getElementById("input-targa-furgone").value.trim().toUpperCase();
    const modello = document.getElementById("input-modello-furgone").value.trim();
    const autista = document.getElementById("input-autista-furgone").value.trim();
    const attivo = document.getElementById("input-attivo-furgone").checked;

    if (!targa) { alert("Indica la targa."); return; }

    await db.collection("anagrafica_camion").doc(targa).set({ targa, modello, autista, attivo });
    chiudiModaleFurgone();
    await ricaricaDopoModificaAnagrafica();
});

document.getElementById("btn-elimina-furgone").addEventListener("click", async () => {
    if (!targaFurgoneInModifica) return;
    if (!confirm(`Eliminare il furgone ${targaFurgoneInModifica} dall'anagrafica? (le temperature già registrate restano salvate)`)) return;
    await db.collection("anagrafica_camion").doc(targaFurgoneInModifica).delete();
    chiudiModaleFurgone();
    await ricaricaDopoModificaAnagrafica();
});

// --- Modale cella (aggiungi/modifica/elimina) ---
let idCellaInModifica = null;

function apriModaleCellaAnagrafica(idCella) {
    idCellaInModifica = idCella || null;
    const cella = idCella ? CELLE.find((c) => c.id === idCella) : null;

    document.getElementById("titolo-modale-cella-anagrafica").textContent = cella ? "Modifica cella" : "Nuova cella";
    document.getElementById("input-id-cella-anagrafica").value = cella ? cella.id : "";
    document.getElementById("input-id-cella-anagrafica").disabled = !!cella;
    document.getElementById("input-nome-cella-anagrafica").value = cella ? cella.nome : "";
    document.getElementById("input-localizzazione-cella-anagrafica").value = cella ? (cella.localizzazione || "") : "";
    document.getElementById("input-temp-nominale-cella-anagrafica").value = cella ? cella.temp_nominale : "";
    document.getElementById("input-attivo-cella-anagrafica").checked = cella ? eAttivo(cella) : true;
    document.getElementById("btn-elimina-cella-anagrafica").style.display = cella ? "block" : "none";

    document.getElementById("overlay-cella-anagrafica").classList.add("attiva");
}

function chiudiModaleCellaAnagrafica() {
    document.getElementById("overlay-cella-anagrafica").classList.remove("attiva");
    document.getElementById("input-id-cella-anagrafica").disabled = false;
    idCellaInModifica = null;
}

document.getElementById("btn-aggiungi-cella").addEventListener("click", () => apriModaleCellaAnagrafica(null));
document.getElementById("btn-annulla-cella-anagrafica").addEventListener("click", chiudiModaleCellaAnagrafica);

document.getElementById("btn-conferma-cella-anagrafica").addEventListener("click", async () => {
    const id = document.getElementById("input-id-cella-anagrafica").value.trim().toUpperCase();
    const nome = document.getElementById("input-nome-cella-anagrafica").value.trim();
    const localizzazione = document.getElementById("input-localizzazione-cella-anagrafica").value.trim();
    const tempTesto = document.getElementById("input-temp-nominale-cella-anagrafica").value;

    if (!id) { alert("Indica il codice della cella."); return; }
    if (!nome) { alert("Indica il nome della cella."); return; }
    if (tempTesto === "") { alert("Indica la temperatura nominale."); return; }
    const attivo = document.getElementById("input-attivo-cella-anagrafica").checked;

    await db.collection("anagrafica_celle").doc(id).set({
        id, nome, localizzazione, temp_nominale: Number(tempTesto), attivo,
    });
    chiudiModaleCellaAnagrafica();
    await ricaricaDopoModificaAnagrafica();
});

document.getElementById("btn-elimina-cella-anagrafica").addEventListener("click", async () => {
    if (!idCellaInModifica) return;
    if (!confirm(`Eliminare la cella ${idCellaInModifica} dall'anagrafica? (le temperature già registrate restano salvate)`)) return;
    await db.collection("anagrafica_celle").doc(idCellaInModifica).delete();
    chiudiModaleCellaAnagrafica();
    await ricaricaDopoModificaAnagrafica();
});

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

// ============================================================
// REPORT MENSILE (da mostrare o stampare in caso di controlli)
// ============================================================
function dataLeggibileBreve(dataISOStr) {
    const [anno, mese, giorno] = dataISOStr.split("-");
    return `${giorno}/${mese}/${anno}`;
}

function primoEUltimoGiornoMese(annoMeseStr) {
    // annoMeseStr arriva da <input type="month"> nel formato "AAAA-MM"
    const [anno, mese] = annoMeseStr.split("-").map(Number);
    const primo = `${anno}-${String(mese).padStart(2, "0")}-01`;
    const ultimoGiorno = new Date(anno, mese, 0).getDate(); // giorno 0 del mese dopo = ultimo giorno di questo mese
    const ultimo = `${anno}-${String(mese).padStart(2, "0")}-${String(ultimoGiorno).padStart(2, "0")}`;
    return { primo, ultimo };
}

// Elenco dei giorni lavorativi tra primoISO e ultimoISO (inclusi), senza
// mai superare ieri: il giorno di oggi non è ancora finito, quindi non
// ha senso segnalarlo come "mancante". Usa la stessa regola sabato/
// domenica di giornoLavorativo() (niente sabato/domenica fuori dai mesi
// estivi, mai la domenica).
function giorniLavorativiNelPeriodo(primoISO, ultimoISO) {
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    const ieri = new Date(oggi);
    ieri.setDate(ieri.getDate() - 1);

    const primo = new Date(primoISO + "T00:00:00");
    const ultimoRichiesto = new Date(ultimoISO + "T00:00:00");
    const ultimo = ultimoRichiesto < ieri ? ultimoRichiesto : ieri;

    const giorni = [];
    for (let d = new Date(primo); d <= ultimo; d.setDate(d.getDate() + 1)) {
        if (giornoLavorativo(d)) giorni.push(dataISO(d));
    }
    return giorni;
}

function calcolaGiorniMancantiCamion(targa, primo, ultimo, righeGruppo) {
    const mappa = {};
    righeGruppo.forEach((r) => { mappa[r.data] = r; });
    return giorniLavorativiNelPeriodo(primo, ultimo)
        .map((giornoISO) => {
            const r = mappa[giornoISO];
            const mancaPartenza = !r || r.temp_partenza === undefined || r.temp_partenza === null;
            const mancaFine = !r || r.temp_fine === undefined || r.temp_fine === null;
            return (mancaPartenza || mancaFine) ? { giornoISO, mancaPartenza, mancaFine } : null;
        })
        .filter(Boolean);
}

function calcolaGiorniMancantiCella(idCella, primo, ultimo, righeGruppo) {
    const mappa = {};
    righeGruppo.forEach((r) => { mappa[r.data] = r; });
    return giorniLavorativiNelPeriodo(primo, ultimo)
        .map((giornoISO) => {
            const r = mappa[giornoISO];
            const mancaMattina = !r || r.temp_mattina === undefined || r.temp_mattina === null;
            const mancaPomeriggio = !r || r.temp_pomeriggio === undefined || r.temp_pomeriggio === null;
            return (mancaMattina || mancaPomeriggio) ? { giornoISO, mancaMattina, mancaPomeriggio } : null;
        })
        .filter(Boolean);
}

// Riga HTML con l'elenco dei giorni mancanti e un pulsante per
// inserirli subito (riusa le stesse modali di backfill della
// dashboard). I pulsanti hanno classe "no-stampa": compaiono a
// schermo ma non nella versione stampata/PDF del report.
function blocoGiorniMancantiReport(mancanti, tipo, chiave) {
    if (mancanti.length === 0) return "";
    const righe = mancanti.map((m) => {
        const dataLeg = dataLeggibileBreve(m.giornoISO);
        const bottoni = [];
        if (tipo === "camion") {
            if (m.mancaPartenza) bottoni.push(`<button class="btn-inserisci-mancante no-stampa" data-tipo="camion" data-chiave="${chiave}" data-giorno="${m.giornoISO}" data-momento="partenza">🌅 Inserisci partenza</button>`);
            if (m.mancaFine) bottoni.push(`<button class="btn-inserisci-mancante no-stampa" data-tipo="camion" data-chiave="${chiave}" data-giorno="${m.giornoISO}" data-momento="fine">🌇 Inserisci fine</button>`);
        } else {
            if (m.mancaMattina) bottoni.push(`<button class="btn-inserisci-mancante no-stampa" data-tipo="cella" data-chiave="${chiave}" data-giorno="${m.giornoISO}" data-momento="mattina">🌅 Inserisci mattina</button>`);
            if (m.mancaPomeriggio) bottoni.push(`<button class="btn-inserisci-mancante no-stampa" data-tipo="cella" data-chiave="${chiave}" data-giorno="${m.giornoISO}" data-momento="pomeriggio">🌇 Inserisci pomeriggio</button>`);
        }
        return `<li>⚠️ ${dataLeg} — nessuna registrazione<div class="azioni-giorno-mancante">${bottoni.join("")}</div></li>`;
    }).join("");
    return `<div class="blocco-giorni-mancanti-report"><ul>${righe}</ul></div>`;
}

document.getElementById("btn-report").addEventListener("click", () => {
    mostraSchermo("schermo-report");
    // Precompila con il mese corrente
    const oggi = new Date();
    document.getElementById("input-mese-report").value =
        `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, "0")}`;
    document.getElementById("contenuto-report").innerHTML = "";
    document.getElementById("btn-stampa-report").style.display = "none";
    document.getElementById("input-tipo-report").value = "tutto";
    document.getElementById("campo-camion-report").style.display = "none";
    popolaSelectCamionReport();
});
document.getElementById("btn-torna-dashboard-report").addEventListener("click", () => mostraSchermo("schermo-dashboard"));
document.getElementById("btn-stampa-report").addEventListener("click", () => window.print());

document.getElementById("input-tipo-report").addEventListener("change", () => {
    const tipo = document.getElementById("input-tipo-report").value;
    document.getElementById("campo-camion-report").style.display = tipo === "camion" ? "block" : "none";
});

function popolaSelectCamionReport() {
    const select = document.getElementById("input-camion-report");
    if (select.dataset.popolato === "1") return;
    select.innerHTML = "";
    const opzioneTutti = document.createElement("option");
    opzioneTutti.value = "";
    opzioneTutti.textContent = "Tutti i furgoni";
    select.appendChild(opzioneTutti);
    CAMION.forEach((c) => {
        const opzione = document.createElement("option");
        opzione.value = c.targa;
        opzione.textContent = `${c.targa} - ${c.modello}${c.autista ? " (" + c.autista + ")" : ""}`;
        select.appendChild(opzione);
    });
    select.dataset.popolato = "1";
}

document.getElementById("btn-genera-report").addEventListener("click", generaReportMensile);

async function generaReportMensile() {
    const meseScelto = document.getElementById("input-mese-report").value;
    if (!meseScelto) { alert("Scegli un mese."); return; }
    const tipoReport = document.getElementById("input-tipo-report").value;
    const targaScelta = document.getElementById("input-camion-report").value;

    const contenitore = document.getElementById("contenuto-report");
    contenitore.innerHTML = "<p>Generazione report in corso…</p>";
    document.getElementById("btn-stampa-report").style.display = "none";

    await accessoAnonimoPronto;
    await caricaAnagrafica(); // assicura CAMION/CELLE già pronti (serve ai giorni mancanti)
    const { primo, ultimo } = primoEUltimoGiornoMese(meseScelto);

    // Scarica solo le collezioni che servono davvero per il tipo scelto.
    const serveTutto = tipoReport === "tutto";
    const [camion, celle, ricevimenti, pulizie] = await Promise.all([
        (serveTutto || tipoReport === "camion") ? recuperaIntervallo("temp_camion", primo, ultimo) : [],
        (serveTutto || tipoReport === "celle") ? recuperaIntervallo("temp_celle", primo, ultimo) : [],
        (serveTutto || tipoReport === "ricevimento") ? recuperaIntervallo("ricevimento_merce", primo, ultimo) : [],
        (serveTutto || tipoReport === "pulizie") ? recuperaIntervallo("registro_pulizie", primo, ultimo) : [],
    ]);

    const camionFiltrati = (tipoReport === "camion" && targaScelta) ? camion.filter((r) => r.targa === targaScelta) : camion;

    camionFiltrati.sort((a, b) => (a.data + a.targa).localeCompare(b.data + b.targa));
    celle.sort((a, b) => (a.data + a.id_cella).localeCompare(b.data + b.id_cella));
    ricevimenti.sort((a, b) => (a.data + (a.ora || "")).localeCompare(b.data + (b.ora || "")));
    pulizie.sort((a, b) => (a.data + (a.ora || "")).localeCompare(b.data + (b.ora || "")));

    const titoloMese = new Date(`${meseScelto}-01T00:00:00`)
        .toLocaleDateString("it-IT", { month: "long", year: "numeric" });

    const sottotitoliPerTipo = {
        tutto: "Report completo",
        camion: targaScelta ? `Temperature Camion — ${targaScelta}` : "Temperature Camion — tutti i furgoni",
        celle: "Temperature Celle",
        ricevimento: "Ricevimento Merce",
        pulizie: "Registro Pulizie",
    };

    const soloTargaFiltro = (tipoReport === "camion" && targaScelta) ? targaScelta : null;

    let sezioniHtml = "";
    if (serveTutto || tipoReport === "camion") sezioniHtml += sezioneTabellaCamion(camionFiltrati, primo, ultimo, soloTargaFiltro);
    if (serveTutto || tipoReport === "celle") sezioniHtml += sezioneTabellaCelle(celle, primo, ultimo);
    if (serveTutto || tipoReport === "ricevimento") sezioniHtml += sezioneTabellaRicevimenti(ricevimenti);
    if (serveTutto || tipoReport === "pulizie") sezioniHtml += sezioneTabellaPulizie(pulizie);

    contenitore.innerHTML = `
        <div class="intestazione-report">
            <div class="nome-azienda">${AZIENDA.ragioneSociale}</div>
            <div class="dati-azienda">${AZIENDA.indirizzo} · ${AZIENDA.cfPiva}</div>
            <div class="dati-azienda">Tel. ${AZIENDA.telefono} · ${AZIENDA.email}</div>
            <div class="titolo-report">${sottotitoliPerTipo[tipoReport]} — ${titoloMese}</div>
        </div>
        ${sezioniHtml}
        <div class="blocco-firma">
            <div class="riga-firma">
                <div class="etichetta-firma">Firma del responsabile<br>dell'autocontrollo</div>
                <div class="linea-firma">&nbsp;</div>
            </div>
        </div>
    `;

    document.getElementById("btn-stampa-report").style.display = "block";

    // Pulsanti "Inserisci" sui giorni mancanti: riaprono le stesse
    // modali di backfill della dashboard e, una volta salvato,
    // rigenerano il report per far sparire subito il giorno sistemato.
    contenitore.querySelectorAll(".btn-inserisci-mancante[data-tipo]").forEach((bottone) => {
        bottone.addEventListener("click", () => {
            const { tipo, chiave, giorno, momento } = bottone.dataset;
            if (tipo === "camion") {
                apriModaleBackfillCamion(chiave, giorno, momento, generaReportMensile);
            } else {
                apriModaleBackfillCella(chiave, giorno, momento, generaReportMensile);
            }
        });
    });
}

async function recuperaIntervallo(collezione, primo, ultimo) {
    try {
        const snap = await db.collection(collezione)
            .where("data", ">=", primo)
            .where("data", "<=", ultimo)
            .get();
        return snap.docs.map((doc) => doc.data());
    } catch (errore) {
        console.error(`Errore lettura ${collezione} per il report:`, errore);
        return [];
    }
}

function sezioneTabellaCamion(righe, primo, ultimo, soloTarga) {
    // Senza un furgone specifico selezionato, mostra tutti i furgoni
    // attivi (anche quelli senza nessuna registrazione nel periodo, così
    // i loro giorni mancanti restano visibili). Con un furgone specifico
    // selezionato, mostra solo quello, anche se non più attivo.
    const furgoniDaMostrare = soloTarga
        ? CAMION.filter((c) => c.targa === soloTarga)
        : CAMION.filter(eAttivo);

    if (furgoniDaMostrare.length === 0) {
        return `<div class="report-sezione"><h3>🚚 Temperature Camion</h3><div class="nessun-dato">Nessun furgone da mostrare.</div></div>`;
    }

    const gruppi = {};
    righe.forEach((r) => {
        if (!gruppi[r.targa]) gruppi[r.targa] = [];
        gruppi[r.targa].push(r);
    });

    const sottotabelle = furgoniDaMostrare.map((camionInfo) => {
        const targa = camionInfo.targa;
        const righeGruppo = gruppi[targa] || [];
        const attivo = eAttivo(camionInfo);
        const mancanti = attivo ? calcolaGiorniMancantiCamion(targa, primo, ultimo, righeGruppo) : [];
        const titolo = `🚚 Targa ${targa}${camionInfo.modello ? ` — ${camionInfo.modello}` : ""}`;

        if (righeGruppo.length === 0 && mancanti.length === 0) {
            const messaggio = attivo
                ? "Nessun dato nel periodo selezionato."
                : "Furgone non attivo in questo periodo — nessuna registrazione prevista.";
            return `<div class="sotto-tabella-titolo">${titolo}</div><div class="nessun-dato">${messaggio}</div>`;
        }

        const nomiAutisti = [...new Set(righeGruppo.map((r) => r.autista).filter(Boolean))].join(", ") || camionInfo.autista || "—";
        let tabella = "";
        if (righeGruppo.length > 0) {
            const corpo = righeGruppo.map((r) => `
                <tr>
                    <td>${dataLeggibileBreve(r.data)}</td>
                    <td class="centro">${r.temp_partenza != null ? `${r.temp_partenza}°C alle ${r.ora_partenza || "—"}` : "—"}</td>
                    <td class="centro">${r.temp_fine != null ? `${r.temp_fine}°C alle ${r.ora_fine || "—"}` : "—"}</td>
                </tr>
            `).join("");
            tabella = `
                <table class="tabella-report">
                    <thead><tr><th>Data</th><th>Partenza</th><th>Fine</th></tr></thead>
                    <tbody>${corpo}</tbody>
                </table>
            `;
        }

        return `
            <div class="sotto-tabella-titolo">${titolo} · Operatore: ${nomiAutisti}</div>
            ${tabella}
            ${blocoGiorniMancantiReport(mancanti, "camion", targa)}
        `;
    }).join("");

    return `<div class="report-sezione"><h3>🚚 Temperature Camion</h3>${sottotabelle}</div>`;
}

function sezioneTabellaCelle(righe, primo, ultimo) {
    const celleDaMostrare = CELLE.filter(eAttivo);

    if (celleDaMostrare.length === 0) {
        return `<div class="report-sezione"><h3>🧊 Temperature Celle</h3><div class="nessun-dato">Nessuna cella attiva al momento.</div></div>`;
    }

    const gruppi = {};
    righe.forEach((r) => {
        if (!gruppi[r.id_cella]) gruppi[r.id_cella] = [];
        gruppi[r.id_cella].push(r);
    });

    const sottotabelle = celleDaMostrare.map((cellaInfo) => {
        const idCella = cellaInfo.id;
        const righeGruppo = gruppi[idCella] || [];
        const mancanti = calcolaGiorniMancantiCella(idCella, primo, ultimo, righeGruppo);
        const titolo = `🧊 ${cellaInfo.nome} (${idCella})`;

        if (righeGruppo.length === 0 && mancanti.length === 0) {
            return `<div class="sotto-tabella-titolo">${titolo}</div><div class="nessun-dato">Nessun dato nel periodo selezionato.</div>`;
        }

        let tabella = "";
        if (righeGruppo.length > 0) {
            const corpo = righeGruppo.map((r) => `
                <tr>
                    <td>${dataLeggibileBreve(r.data)}</td>
                    <td class="centro">${r.temp_mattina != null ? `${r.temp_mattina}°C alle ${r.ora_mattina || "—"}` : "—"}</td>
                    <td class="centro">${r.temp_pomeriggio != null ? `${r.temp_pomeriggio}°C alle ${r.ora_pomeriggio || "—"}` : "—"}</td>
                    <td>${r.note || "—"}</td>
                </tr>
            `).join("");
            tabella = `
                <table class="tabella-report">
                    <thead><tr><th>Data</th><th>Mattina</th><th>Pomeriggio</th><th>Note</th></tr></thead>
                    <tbody>${corpo}</tbody>
                </table>
            `;
        }

        return `
            <div class="sotto-tabella-titolo">${titolo}</div>
            ${tabella}
            ${blocoGiorniMancantiReport(mancanti, "cella", idCella)}
        `;
    }).join("");

    return `<div class="report-sezione"><h3>🧊 Temperature Celle</h3>${sottotabelle}</div>`;
}

function sezioneTabellaRicevimenti(righe) {
    if (righe.length === 0) {
        return `<div class="report-sezione"><h3>📦 Ricevimento Merce</h3><div class="nessun-dato">Nessun dato nel mese selezionato.</div></div>`;
    }
    const corpo = righe.map((r) => `
        <tr>
            <td>${dataLeggibileBreve(r.data)}</td>
            <td class="centro">${r.ora || "—"}</td>
            <td>${r.fornitore || "—"}</td>
            <td>${r.categoria || "—"}</td>
            <td>${r.num_doc || "—"}</td>
            <td class="centro">${r.conformita === "CONFORME" ? "✅ Conforme" : "⚠️ Non conforme"}</td>
            <td>${r.note || "—"}</td>
            <td>${r.operatore || "—"}</td>
        </tr>
    `).join("");
    return `
        <div class="report-sezione">
            <h3>📦 Ricevimento Merce</h3>
            <table class="tabella-report">
                <thead><tr><th>Data</th><th>Ora</th><th>Fornitore</th><th>Categoria</th><th>DDT</th><th>Conformità</th><th>Note</th><th>Operatore</th></tr></thead>
                <tbody>${corpo}</tbody>
            </table>
        </div>
    `;
}

function sezioneTabellaPulizie(righe) {
    if (righe.length === 0) {
        return `<div class="report-sezione"><h3>🧹 Registro Pulizie</h3><div class="nessun-dato">Nessun dato nel mese selezionato.</div></div>`;
    }
    const corpo = righe.map((r) => `
        <tr>
            <td>${dataLeggibileBreve(r.data)}</td>
            <td class="centro">${r.ora || "—"}</td>
            <td>${r.area || "—"}</td>
            <td>${r.frequenza || "—"}</td>
            <td class="centro">${r.esito === "Completato" ? "✅ Completato" : "⚠️ Non completato"}</td>
            <td>${r.note || "—"}</td>
            <td>${r.operatore || "—"}</td>
        </tr>
    `).join("");
    return `
        <div class="report-sezione">
            <h3>🧹 Registro Pulizie</h3>
            <table class="tabella-report">
                <thead><tr><th>Data</th><th>Ora</th><th>Area</th><th>Frequenza</th><th>Esito</th><th>Note</th><th>Operatore</th></tr></thead>
                <tbody>${corpo}</tbody>
            </table>
        </div>
    `;
}
