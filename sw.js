/**
 * Service Worker - オフライン対応
 * 一度読み込んだリソースをキャッシュし、オフラインでも動作可能にする
 */
const CACHE_NAME = 'draw-system-v2.4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './css/print.css',
  './js/config.js',
  './js/ranking-loader.js',
  './js/fuzzy-match.js',
  './js/entry-store.js',
  './js/tournament-store.js',
  './js/seed-rules.js',
  './js/draw-engine.js',
  './js/draw-renderer.js',
  './js/cloud-share.js',
  './js/github_backup.js',
  './js/google_drive_backup.js',
  './js/app.js',
  './js/schedule-engine.js',
  './data/furigana.json',
  './logo.png',
  'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js'
];

// インストール時: 全アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// アクティベート時: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// フェッチ時: キャッシュ優先、なければネットワーク
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Google Sheets API・Firebase等の外部データ取得はネットワーク優先
  if (url.hostname.includes('googleapis.com') ||
      url.hostname.includes('google.com') ||
      url.hostname.includes('docs.google.com') ||
      url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firebasedatabase.app')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // それ以外はキャッシュ優先（Stale-While-Revalidate）
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // キャッシュがあればそれを返しつつ、バックグラウンドで更新
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // ネットワークエラー時はキャッシュを使う
        return cachedResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});
