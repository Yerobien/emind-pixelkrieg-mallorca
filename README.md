# Pixel-Krieg

Multiplayer-Territorialspiel auf Mallorca: 4 Teams, ein KI-Golem, geheime Verräter, Ereigniskarten, 90 Sekunden.
Node.js + Express + Socket.io, keine Datenbank nötig (Zustand im Speicher).

## Schnelltest allein (Demo mit 14 Bots)

```bash
npm install
npm run demo
```

Dann im Browser `http://localhost:3000/admin?key=mallorca` (Steuerung) und `http://localhost:3000/beamer` öffnen,
optional `http://localhost:3000/` als dritter Tab, um selbst mitzuspielen. Im Admin auf „Runde starten“ klicken.

## Starten

```bash
npm install
ADMIN_KEY=geheim node server.js
```

Windows (PowerShell): `$env:ADMIN_KEY="geheim"; node server.js`

Der Server gibt beim Start alle Links aus:

| Ansicht | URL | Wofür |
|---|---|---|
| Spieler | `http://<server>:3000/` | Jeder auf seinem Laptop/Handy (QR-Code auf dem Beamer) |
| Beamer  | `http://<server>:3000/beamer` | Großes Feld, Punktestand, QR-Code – auf den Beamer |
| Admin   | `http://<server>:3000/admin?key=geheim` | Runde starten/stoppen, Bots, Rundendauer |

Auf Beamer und Admin einmal auf „Ton einschalten“ klicken (Browser spielen Töne erst nach einem Klick).
Spieler bekommen den Ton automatisch mit dem „Beitreten“-Klick.

## Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | 3000 | Port |
| `MAP` | mallorca | `mallorca` oder `rechteck` (Teams in den Ecken) |
| `COLS` / `ROWS` | 50 / 36 | Feldgröße (Mallorca hat dabei ~640 Landfelder) |
| `ROUND` | 90 | Rundendauer in Sekunden (im Admin auch pro Runde änderbar) |
| `COOLDOWN` | 2.5 | Sekunden zwischen zwei Zügen (Schurke: halb) |
| `ADMIN_KEY` | mallorca | Schlüssel für die Admin-Ansicht |
| `PUBLIC_URL` | – | Feste URL für den QR-Code, z. B. hinter einem Reverse Proxy |

## Ablauf einer Runde

1. Admin klickt „Runde starten“ → Feld wird zurückgesetzt, **START IN 5 4 3 2 1 GO!** mit Beeps.
2. Runde läuft. Die letzten **15 Sekunden** werden groß heruntergezählt: jede Sekunde ein Tick, bei 15/10/5 ein anderer Beep, bei 0 ein Schluss-Ton.
3. Alle 20 Sekunden eine Ereigniskarte (Siesta, Freitags-Deployment, Sangria-Runde, Golem erwacht, Rückenwind).
4. Finale: zuerst die Verräter-Enthüllung (ihre Felder blinken und wechseln die Farbe, der Punktestand ändert sich!), dann Feld zerfällt → „GEWINNER IST“ → Welle in der Siegerfarbe + Fanfare → „DANKE“ → eMind-Logo.

## Regeln

- Gespielt wird auf Mallorca, Meer ist tabu. Basen (3×3, uneinnehmbar): Andratx, Alcúdia, Santanyí, Cala Millor; der Golem startet in der Inselmitte.
- Verräter: In jedem Team mit mindestens 2 Spielern wird einer heimlich ausgelost. Seine Felder sehen aus wie die seines
  Teams, zählen am Ende aber für ein anderes Team. Nur er selbst sieht das auf seinem Bildschirm.
- Setzen nur direkt angrenzend ans eigene Gebiet. Neutral = sofort eures, Feindfeld = 2 Treffer.
- Rand eines Feldes = Farbe des Vorbesitzers. Felder vom Golem bringen +1 Bonuspunkt.
- Rollen (pro Team je eine, automatisch verteilt): Krieger, Baumeister, Schurke, Magier, Paladin.

## Hinweise fürs Event

- Alle müssen den Server erreichen. Hotel-WLANs blockieren oft Verbindungen zwischen Geräten
  (Client-Isolation) → dann Handy-Hotspot oder öffentlich erreichbare VM nutzen.
- Hinter einem Reverse Proxy (nginx etc.) müssen WebSockets durchgereicht werden (`Upgrade`/`Connection`-Header).
- Lädt ein Spieler die Seite neu, landet er über die gespeicherte ID wieder im selben Team.
