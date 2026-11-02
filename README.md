# Festival-Orga

Interne Orga-App für ein Festival-Kollektiv: Aufgaben, Schichten, Kalender, Line-up und Team. Läuft im Browser und lässt sich aufs Handy legen. Daten und Anmeldung liegen bei Supabase (kostenloser Plan).

- **Einrichten:** [EINRICHTUNG.md](EINRICHTUNG.md)
- **Entwickeln:** `npm install`, dann `npm run dev`. Ohne Datenbank gibt es unter `?demo=helfer`, `?demo=crew` oder `?demo=admin` Beispieldaten.
- **Rechte testen:** `npm run test:db` prüft ohne Internet, wer was sehen und ändern darf.
- **Online stellen:** Jeder Push auf `main` baut die App und veröffentlicht sie über GitHub Pages. Adresse und Schlüssel stehen in den Repository-Variablen `SUPABASE_URL` und `SUPABASE_KEY`.
