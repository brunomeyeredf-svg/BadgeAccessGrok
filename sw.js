// sw.js - Service Worker pour la PWA Lecteur Badges RFID (Version améliorée)
const CACHE_NAME = 'nfc-badge-reader-v1.0.3'; // Mise à jour pour forcer le rafraîchissement
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
const MAX_RETRY_ATTEMPTS = 3; // Nombre max de tentatives pour la sync
const RETRY_DELAY = 5000; // Délai entre les retries en ms (5 secondes)

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

// Installation du Service Worker avec précaching amélioré
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
                return self.skipWaiting(); // Active immédiatement le nouveau SW
            })
            .catch((error) => {
                console.error('Service Worker: Erreur lors du précaching:', error);
            })
    );
});

// Activation du Service Worker avec nettoyage amélioré
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
            return self.clients.claim(); // Prend le contrôle de toutes les pages
        }).catch((error) => {
            console.error('Service Worker: Erreur lors de l\'activation:', error);
        })
    );
});

// Interception des requêtes réseau avec stratégies améliorées
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Stratégie Cache First pour les ressources statiques (documents, scripts, styles, images)
    if (['document', 'script', 'style', 'image'].includes(event.request.destination)) {
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
                                }).catch((error) => {
                                    console.error('Service Worker: Erreur mise en cache:', error);
                                });
                            console.log('Service Worker: Réponse mise en cache:', event.request.url);
                            return response;
                        })
                        .catch((error) => {
                            console.error('Service Worker: Erreur fetch:', error);
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
                            if (event.request.destination === 'image') {
                                return caches.match('/placeholder-image.png');
                            }
                            return new Response('Ressource indisponible hors ligne', { status: 503 });
                        });
                })
        );
    } 
    // Stratégie Network First pour les API avec fallback cache et gestion des POST
    else if (url.pathname.includes('/api/') || event.request.method === 'POST') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (event.request.method === 'GET' && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            }).catch((error) => {
                                console.error('Service Worker: Erreur mise en cache API:', error);
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
    } else {
        // Stale-while-revalidate pour les autres requêtes (ex: fonts externes)
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((cachedResponse) => {
                    const fetchedResponse = fetch(event.request).then((networkResponse) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    }).catch(() => undefined);
                    return cachedResponse || fetchedResponse;
                });
            })
        );
    }
});

// Gestion de la synchronisation en arrière-plan avec retries
self.addEventListener('sync', (event) => {
    console.log('Service Worker: Événement de synchronisation:', event.tag);
    if (event.tag === 'badge-sync') {
        event.waitUntil(syncBadgeData(1));
    }
});

// Synchronisation des badges avec logique de retry et batching
async function syncBadgeData(attempt = 1) {
    console.log(`Service Worker: Début de la synchronisation des badges (tentative ${attempt})...`);
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

        const response = await fetch('/api/badges/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(badges)
        });

        if (response.ok) {
            for (const badge of badges) {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                badge.synced = true;
                store.put(badge);
                console.log('Service Worker: Badge synchronisé:', badge.uid);
            }
            console.log('Service Worker: Tous les badges synchronisés en batch');
        } else if (attempt < MAX_RETRY_ATTEMPTS) {
            console.warn(`Service Worker: Échec de la sync (code ${response.status}), retry dans ${RETRY_DELAY / 1000} secondes...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return syncBadgeData(attempt + 1);
        } else {
            throw new Error('Échec après max retries');
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
        if (attempt < MAX_RETRY_ATTEMPTS) {
            console.warn(`Service Worker: Retry de la sync dans ${RETRY_DELAY / 1000} secondes...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return syncBadgeData(attempt + 1);
        } else {
            throw error;
        }
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
            .catch((error) => console.error('Service Worker: Erreur notification:', error))
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