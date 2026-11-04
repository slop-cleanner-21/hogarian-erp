// Service worker de Hogarian ERP: solo notificaciones push (no cachea la app).

self.addEventListener("push", (event) => {
  const d = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(d.titulo || "Hogarian ERP", {
      body: d.cuerpo || undefined,
      icon: "/icono/192",
      badge: "/icono/192",
      tag: d.id ? `aviso-${d.id}` : undefined,
      data: { href: d.href || "/avisos" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.href || "/avisos", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ("focus" in v) {
          v.navigate(destino);
          return v.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
