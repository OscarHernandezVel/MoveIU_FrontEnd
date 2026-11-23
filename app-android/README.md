# MoveIU para Android (APK de prueba)

App Android que abre la web publicada de MoveIU (`frontend/`, servida por el EC2) en pantalla completa, con su
icono y permiso de ubicación para «Cerca de mí». No contiene datos ni lógica propia: todo llega del backend en
AWS, así que funciona en cualquier lugar con internet, aunque la maqueta y el Arduino estén en el portátil.

* La compila GitHub Actions (`.github/workflows/apk.yml`) en cada cambio de esta carpeta o del icono, y la publica
  en la release **apk-latest**: <https://github.com/OscarHernandezVel/MoveIU_FrontEnd/releases/tag/apk-latest>
* Para apuntarla a otro servidor, cambie `server.url` en `capacitor.config.json`.
* Es un APK de **prueba** (firma de depuración): se instala por WhatsApp o cable, no se publica en Play Store.
