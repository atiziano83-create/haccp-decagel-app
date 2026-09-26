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

    for (const cella of CELLE) {
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
    contenitore.innerHTML = html;

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
// AVVIO: se la sessione ha già superato il login in questa scheda,
// entra direttamente (evita di richiedere la password ad ogni click
// se l'admin naviga avanti e indietro nella stessa sessione browser).
// ============================================================
if (sessionStorage.getItem("haccp_admin_ok") === "1") {
    avviaDashboard();
} else {
    mostraSchermo("schermo-login");
}
