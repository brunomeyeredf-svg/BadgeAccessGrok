const DB_NAME = 'badge-reader-db';
const DB_VERSION = 1;
const STORE_NAME = 'badges';

let currentMode = 'scanner'; // Par défaut : mode scanner

// Initialisation IndexedDB
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Vérification WebNFC
async function checkWebNFC() {
    const status = document.getElementById('nfc-status');
    if ('NDEFReader' in window) {
        status.innerHTML = '<span>📶</span><p>WebNFC prêt</p>';
        return true;
    } else {
        status.innerHTML = '<span>📴</span><p>WebNFC non supporté</p><p>Veuillez utiliser Chrome 89+ sur Android avec NFC activé</p>';
        return false;
    }
}

// Scanner un badge NFC
async function scanNFC() {
    try {
        const ndef = new NDEFReader();
        await ndef.scan();
        document.getElementById('nfc-status').innerHTML = '<span>🔍</span><p>En attente d\'un badge...</p>';

        ndef.onreading = async ({ message, serialNumber }) => {
            const badgeInfo = {
                id: Date.now(),
                uid: serialNumber,
                records: message.records.map(record => ({
                    recordType: record.recordType,
                    data: record.data ? new TextDecoder().decode(record.data) : ''
                })),
                timestamp: new Date().toISOString(),
                synced: false
            };

            // Selon le mode
            if (currentMode === 'enregistreur') {
                badgeInfo.action = 'enregistrement';
            } else if (currentMode === 'verificateur') {
                badgeInfo.action = 'vérification';
                // Simuler une vérification (exemple : vérifier si le badge est dans une liste autorisée)
                badgeInfo.status = Math.random() > 0.3 ? 'Autorisé' : 'Non autorisé';
            }

            await saveBadge(badgeInfo);
            displayBadgeInfo(badgeInfo);
            updateHistory();
            triggerSync();
        };
    } catch (error) {
        document.getElementById('nfc-status').innerHTML = `<span>❌</span><p>Erreur NFC : ${error}</p>`;
    }
}

// Enregistrer un badge dans IndexedDB
async function saveBadge(badge) {
    const db = await initDB();
    return new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.add(badge);
        transaction.oncomplete = () => resolve();
    });
}

// Afficher les informations du badge
function displayBadgeInfo(badge) {
    const infoDiv = document.getElementById('badge-info');
    infoDiv.innerHTML = `
        <p><strong>UID :</strong> ${badge.uid}</p>
        <p><strong>Date :</strong> ${badge.timestamp}</p>
        <p><strong>Données :</strong> ${badge.records.map(r => r.data).join(', ')}</p>
        ${badge.action ? `<p><strong>Action :</strong> ${badge.action}</p>` : ''}
        ${badge.status ? `<p><strong>Statut :</strong> ${badge.status}</p>` : ''}
    `;
}

// Mettre à jour l'historique (derniers 5 badges)
async function updateHistory() {
    const db = await initDB();
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
        const badges = request.result.slice(-5).reverse();
        const historyDiv = document.getElementById('history');
        if (badges.length === 0) {
            historyDiv.innerHTML = '<p>Aucun historique disponible</p>';
            return;
        }

        historyDiv.innerHTML = badges.map(badge => `
            <div class="history-item">
                <p><strong>UID :</strong> ${badge.uid}</p>
                <p><strong>Date :</strong> ${badge.timestamp}</p>
                ${badge.action ? `<p><strong>Action :</strong> ${badge.action}</p>` : ''}
                ${badge.status ? `<p><strong>Statut :</strong> ${badge.status}</p>` : ''}
            </div>
        `).join('');
    };
}

// Déclencher une synchronisation
function triggerSync() {
    if (navigator.serviceWorker) {
        navigator.serviceWorker.ready.then(registration => {
            registration.sync.register('badge-sync');
        });
    }
}

// Gestion des modes
document.getElementById('record-mode').addEventListener('click', () => {
    currentMode = 'enregistreur';
    document.getElementById('nfc-status').innerHTML = '<span>📝</span><p>Mode Enregistreur activé</p>';
});

document.getElementById('verify-mode').addEventListener('click', () => {
    currentMode = 'verificateur';
    document.getElementById('nfc-status').innerHTML = '<span>✅</span><p>Mode Vérificateur activé</p>';
});

// Gestion du bouton de scan
document.getElementById('scan-button').addEventListener('click', () => {
    scanNFC();
});

// Initialisation
window.addEventListener('load', async () => {
    await checkWebNFC();
    await updateHistory();

    // Écouter les messages du Service Worker
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'SYNC_COMPLETE') {
            document.getElementById('nfc-status').innerHTML = `<span>✅</span><p>Synchronisation terminée (${event.data.syncedCount} badges)</p>`;
            updateHistory();
        }
    });
});