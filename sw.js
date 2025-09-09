// sw.js - Service Worker pour la PWA Lecteur Badges RFID
const CACHE_NAME = 'nfc-badge-reader-v1.0.1';
const urlsToCache = [
    './',
    './index.html',
    './styles.css',
    './main.js',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'
];

const DB_NAME = 'badge-reader-db';
const DB_VERSION = 1;
const STORE_NAME = 'badges';

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

// Installation du Service Worker
self.addEventListener('install', (event) => {
    console.log('Service Worker: Installation en cours...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Cache ouvert');
                return cache.addAll(urlsToCache);
            })
            .then(() => {
                console.log('Service Worker: Toutes les ressources ont été mises en cache');
                return self.skipWaiting();
            })
    );
});

// Activation du Service Worker
self.addEventListener('activate', (event) => {
    console.log('Service Worker: Activation en cours...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Suppression ancien cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('Service Worker: Activation terminée');
            return self.clients.claim();
        })
    );
});

// Interception des requêtes réseau
self.addEventListener('fetch', (event) => {
    if (event.request.destination === 'document' || 
        event.request.destination === 'script' || 
        event.request.destination === 'style') {
        event.respondWith(
            caches.match(event.request)
                .then((response) => {
                    if (response) {
                        console.log('Service Worker: Réponse depuis le cache:', event.request.url);
                        return response;
                    }
                    return fetch(event.request)
                        .then((response) => {
                            if (!response || response.status !== 200 || response.type !== 'basic') {
                                return response;
                            }
                            const responseToCache = response.clone();
                            caches.open(CACHE_NAME)
                                .then((cache) => {
                                    cache.put(event.request, responseToCache);
                                });
                            console.log('Service Worker: Réponse mise en cache:', event.request.url);
                            return response;
                        })
                        .catch(() => {
                            if (event.request.destination === 'document') {
                                return new Response(
                                    `<!DOCTYPE html>
                                    <html>
                                    <head>
                                        <title>Hors ligne - Lecteur Badges</title>
                                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                                        <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
                                        <style>
                                            body { 
                                                font-family: 'Roboto', sans-serif; 
                                                text-align: center; 
                                                padding: 50px;
                                                background: #f5f5f5;
                                            }
                                            .offline-container {
                                                background: white;
                                                padding: 40px;
                                                border-radius: 10px;
                                                max-width: 400px;
                                                margin: 0 auto;
                                                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                                            }
                                            .offline-icon { font-size: 48px; margin-bottom: 20px; }
                                            .retry-btn {
                                                background: #2196F3;
                                                color: white;
                                                border: none;
                                                padding: 12px 24px;
                                                border-radius: 6px;
                                                cursor: pointer;
                                                margin-top: 20px;
                                            }
                                        </style>
                                    </head>
                                    <body>
                                        <div class="offline-container">
                                            <div class="offline-icon">📵</div>
                                            <h2>Mode hors ligne</h2>
                                            <p>Vous n'êtes pas connecté à Internet, mais l'application fonctionne en local.</p>
                                            <p>Les badges scannés seront synchronisés une fois la connexion rétablie.</p>
                                            <button class="retry-btn" onclick="window.location.reload()">Réessayer</button>
                                        </div>
                                    </body>
                                    </html>`,
                                    {
                                        headers: { 'Content-Type': 'text/html' }
                                    }
                                );
                            }
                        });
                })
        );
    } else if (event.request.url.includes('/api/') || event.request.method === 'POST') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (event.request.method === 'GET' && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request)
                        .then((cachedResponse) => {
                            if (cachedResponse) {
                                return cachedResponse;
                            }
                            return new Response(
                                JSON.stringify({
                                    error: 'offline',
                                    message: 'Requête mise en file d\'attente pour synchronisation ultérieure'
                                }),
                                {
                                    status: 503,
                                    headers: { 'Content-Type': 'application/json' }
                                }
                            );
                        });
                })
        );
    }
});

// Gestion de la synchronisation en arrière-plan
self.addEventListener('sync', (event) => {
    console.log('Service Worker: Événement de synchronisation:', event.tag);
    if (event.tag === 'badge-sync') {
        event.waitUntil(syncBadgeData());
    }
});

// Synchronisation des badges
async function syncBadgeData() {
    console.log('Service Worker: Début de la synchronisation des badges...');
    try {
        const db = await initDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        const badges = await new Promise((resolve) => {
            request.onsuccess = () => resolve(request.result.filter(b => !b.synced));
        });

        if (badges.length === 0) {
            console.log('Service Worker: Aucun badge à synchroniser');
            return;
        }

        for (const badge of badges) {
            try {
                const response = await fetch('/api/badges/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(badge)
                });

                if (response.ok) {
                    const transaction = db.transaction(STORE_NAME, 'readwrite');
                    const store = transaction.objectStore(STORE_NAME);
                    badge.synced = true;
                    store.put(badge);
                    console.log('Service Worker: Badge synchronisé:', badge.uid);
                }
            } catch (error) {
                console.error('Service Worker: Erreur sync badge:', error);
            }
        }

        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'SYNC_COMPLETE',
                    syncedCount: badges.length
                });
            });
        });
    } catch (error) {
        console.error('Service Worker: Erreur lors de la synchronisation:', error);
        throw error;
    }
}

// Gestion des notifications push
self.addEventListener('push', (event) => {
    console.log('Service Worker: Notification push reçue');
    const options = {
        body: event.data ? event.data.text() : 'Nouvelle notification',
        icon: './icon-192.png',
        badge: './icon-48.png',
        vibrate: [200, 100, 200],
        data: {
            timestamp: Date.now(),
            primaryKey: '1'
        },
        actions: [
            { action: 'explore', title: 'Ouvrir l\'app', icon: './icon-48.png' },
            { action: 'close', title: 'Fermer', icon: './icon-48.png' }
        ]
    };
    event.waitUntil(
        self.registration.showNotification('Lecteur Badges RFID', options)
    );
});

// Gestion des clics sur les notifications
self.addEventListener('notificationclick', (event) => {
    console.log('Service Worker: Clic sur notification:', event.action);
    event.notification.close();
    if (event.action === 'explore') {
        event.waitUntil(
            clients.matchAll({ type: 'window' })
                .then((clientList) => {
                    for (const client of clientList) {
                        if (client.url === '/' && 'focus' in client) {
                            return client.focus();
                        }
                    }
                    if (clients.openWindow) {
                        return clients.openWindow('./');
                    }
                })
        );
    }
});

// Messages depuis l'application principale
self.addEventListener('message', (event) => {
    console.log('Service Worker: Message reçu:', event.data);
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'REQUEST_SYNC') {
        self.registration.sync.register('badge-sync')
            .then(() => console.log('Service Worker: Synchronisation programmée'))
            .catch((error) => console.error('Service Worker: Erreur programmation sync:', error));
    }
});

console.log('Service Worker: Script chargé et prêt');