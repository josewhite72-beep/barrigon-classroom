/* =====================================================
   Barrigón Classroom · Service Worker
   Estrategia: Cache First para shell, Network First para datos
   ===================================================== */

const CACHE_VERSION = 'barrigon-v1';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const DATA_CACHE    = `${CACHE_VERSION}-data`;

// Archivos que se cachean al instalar (shell de la app)
const SHELL_ASSETS = [
  './index.html',
  './tareas.html',
  './calificaciones.html',
  './anuncios.html',
  './estudiantes.html',
  './recursos.html',
  './entregas.html',
  './logo.png',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;900&family=Nunito+Sans:wght@400;600&display=swap',
];

// ===== INSTALL =====
self.addEventListener('install', event => {
  console.log('[SW] Instalando Barrigón Classroom...');
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => {
        console.log('[SW] Shell cacheado ✓');
        return self.skipWaiting();
      })
      .catch(err => console.warn('[SW] Error cacheando shell:', err))
  );
});

// ===== ACTIVATE =====
self.addEventListener('activate', event => {
  console.log('[SW] Activando...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('barrigon-') && key !== SHELL_CACHE && key !== DATA_CACHE)
          .map(key => {
            console.log('[SW] Eliminando caché viejo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ===== FETCH =====
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requests que no son GET
  if (request.method !== 'GET') return;

  // Ignorar Cloudinary (entregas siempre requieren internet)
  if (url.hostname.includes('cloudinary.com')) return;

  // Ignorar Firebase (datos siempre frescos cuando hay internet)
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('firebase.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Ignorar API de Anthropic (CRAg)
  if (url.hostname.includes('anthropic.com')) return;

  // Shell assets → Cache First
  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Todo lo demás → Network First con fallback
  event.respondWith(networkFirst(request));
});

// ===== ESTRATEGIAS =====

// Cache First: sirve desde caché, actualiza en segundo plano
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Actualizar en segundo plano (stale-while-revalidate)
    fetch(request).then(response => {
      if (response && response.ok) {
        caches.open(SHELL_CACHE).then(cache => cache.put(request, response));
      }
    }).catch(() => {});
    return cached;
  }
  // No está en caché, ir a la red
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return offlineFallback(request);
  }
}

// Network First: intenta red, fallback a caché
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

// Fallback offline
async function offlineFallback(request) {
  const url = new URL(request.url);
  // Si es navegación, servir index.html
  if (request.mode === 'navigate') {
    const cached = await caches.match('./index.html');
    if (cached) return cached;
  }
  // Respuesta genérica offline
  return new Response(
    JSON.stringify({ offline: true, message: 'Sin conexión' }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  );
}

// Determinar si es un asset del shell
function isShellAsset(url) {
  const shellPaths = [
    'index.html', 'tareas.html', 'calificaciones.html',
    'anuncios.html', 'estudiantes.html', 'recursos.html',
    'entregas.html', 'logo.png', 'manifest.json'
  ];
  return shellPaths.some(path => url.pathname.endsWith(path)) ||
         url.hostname.includes('fonts.googleapis.com') ||
         url.hostname.includes('fonts.gstatic.com') ||
         url.hostname.includes('unpkg.com');
}

// ===== MENSAJES =====
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
});
