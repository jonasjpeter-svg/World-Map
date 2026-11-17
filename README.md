# World-Map – Interaktiver 3D-Globus &amp; Skylines

Eine interaktive 3D-Weltkarte als Globus im Weltraum-Look, mit der du besuchte Länder und Städte markieren, Verbindungen von deiner Heimatbasis aus visualisieren und beim Heranzoomen 3D-Skylines der Städte entdecken kannst.

## Features
- **Interaktiver 3D-Globus:** Frei drehbar, zoombar und verschiebbar (`Three.js` + `OrbitControls`).
- **Länder &amp; Orte markieren:**
  - Klicke auf ein beliebiges Land auf dem Globus, um es als *Besucht* (Gold) zu markieren.
  - Setze eigene Stadt-/Reise-Pins mit Namen und Notiz per Klick auf den Globus.
  - Automatische Speicherung im Browser (`localStorage`) + JSON-Export/Import.
- **3D-Skylines beim Reinzoomen:** Sobald du nah an ein Land bzw. eine Stadt heranzoomst, wachsen 3D-Skylines (inkl. bekannter Wahrzeichen wie Eiffelturm, Burj Khalifa, Fernsehturm, Sydney Opera House, Pyramiden von Gizeh u. v. m.) direkt aus der Globus-Oberfläche.
- **Netzwerk &amp; Verbindungen:** Animierte 3D-Flug-/Reisebögen zwischen deiner Heimatbasis und deinen besuchten Städten mit pulsierenden Zielringen.
- **Weltraum-Hintergrund:** Funkelndes Sternenfeld sowie 3D-Planeten (Sonne, Mond, Mars, Jupiter, Saturn mit Ringen, Neptun, Venus).

## Lokal starten
Da ES-Module und `fetch('data/countries-110m.json')` verwendet werden, über einen lokalen Webserver öffnen (z. B. VS Code Live Server, PowerShell-HTTP-Server oder GitHub Pages).
