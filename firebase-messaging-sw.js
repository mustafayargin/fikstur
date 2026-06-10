/* firebase-messaging-sw.js */

importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js",
);

firebase.initializeApp({
  apiKey: "AIzaSyDNBlZiB--PvK2QGJbumfvrt16mkD-fPQ0",
  authDomain: "superlig-tahmin-panel.firebaseapp.com",
  databaseURL:
    "https://superlig-tahmin-panel-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "superlig-tahmin-panel",
  storageBucket: "superlig-tahmin-panel.firebasestorage.app",
  messagingSenderId: "89142067230",
  appId: "1:89142067230:web:96a69696dc1dbcac16ee0f",
  measurementId: "G-9E1VX0KTQH",
});

const messaging = firebase.messaging();

function notificationAssetUrl(path) {
  return new URL(path, self.location.origin + "/").toString();
}

messaging.onBackgroundMessage((payload) => {
  console.log("[FCM SW] Arka plan bildirimi geldi:", payload);

  const title = payload?.data?.title || payload?.notification?.title || "Tahmin Paneli";
  const body = payload?.data?.body || payload?.notification?.body || "Yeni bildirimin var.";

  const options = {
    body,
    icon: payload?.data?.icon || notificationAssetUrl("/icons/icon-192.png"),
    badge: payload?.data?.badge || notificationAssetUrl("/icons/badge-72.png"),
    image: payload?.data?.image || notificationAssetUrl("/icons/icon-512.png"),
    tag: payload?.data?.tag || `fikstur-${title}-${body}`,
    renotify: false,
    data: {
      url: payload?.data?.url || notificationAssetUrl("/index.html"),
      ...(payload?.data || {}),
    },
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "./index.html";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }

        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }

        return null;
      }),
  );
});
