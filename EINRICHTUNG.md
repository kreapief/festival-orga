# Festival-Orga einrichten

Einmalig, etwa 15 Minuten. Alles ist kostenlos.

## 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto anlegen. Am besten mit einer E-Mail-Adresse des Kollektivs, nicht mit einer privaten.
2. **New project** wählen:
   - Name: zum Beispiel `festival-orga`
   - Region: **Central EU (Frankfurt)**
   - Datenbank-Passwort: sicher aufbewahren, die App braucht es nicht
3. Warten, bis das Projekt bereit ist.

## 2. Anmeldung übers Gerät einschalten

Unter **Authentication** in den Anmelde-Einstellungen (vermutlich **Sign In / Providers**) die Option **Allow anonymous sign-ins** einschalten und speichern. Supabase stellt das Menü ab und zu um. Wenn du sie nicht findest, hilft die [Anleitung von Supabase](https://supabase.com/docs/guides/auth/auth-anonymous).

So kann man ohne E-Mail und ohne Passwort beitreten. Wer reinkommt, entscheidet allein der Einladungslink. Ein Gerät ohne gültigen Link sieht nichts, das regelt die Datenbank.

## 3. Datenbank anlegen

1. **SQL Editor → New query** öffnen.
2. Den kompletten Inhalt von `supabase/migrations/0001_grundgeruest.sql` einfügen und auf **Run** klicken. Danach genauso mit `0002_schichten_lineup_kalender.sql`, `0003` bis `0007` (alle in `supabase/migrations`), immer in dieser Reihenfolge. (Oder gleich `supabase/setup_komplett.sql`, da stehen alle sieben drin.)
3. Eine neue Abfrage öffnen, den Namen eures Kollektivs einsetzen und ausführen:

   ```sql
   select * from create_collective('Euer Kollektiv');
   ```

   Heraus kommen drei Codes: `admin`, `crew` und `helfer`. **Den Admin-Code nur selbst benutzen.** Er gilt genau einmal.

Dabei werden auch eure Bereiche angelegt: Orga, Barschichten, Aufbau, Designs, Deko, Essen, Social Media, Spiele Olympiade, Glücksrad, Shuttle, DJs und Awareness.

## 4. App mit Supabase verbinden

1. In Supabase die **Project URL** und den **Publishable key** (beginnt mit `sb_publishable_`) kopieren. Beides steht in den Projekt-Einstellungen unter **API Keys** bzw. **Data API**. Der ältere **anon key** funktioniert genauso.
2. Im Ordner `app` die Datei `.env.example` kopieren, die Kopie `.env` nennen und beide Werte eintragen.
3. App starten:

   ```bash
   npm install
   npm run dev
   ```

## 5. Als Admin beitreten

Im Browser `http://localhost:5173/#/join/ADMINCODE` öffnen, wobei `ADMINCODE` der Admin-Code aus Schritt 3 ist. Namen eingeben, fertig.

Danach findest du unter **Menschen → Leute einladen** den Helfer:innen-Link und den Crew-Link.

## Neues Handy oder Browserdaten gelöscht?

Unter **Menschen → Bearbeiten → Wiederanmelde-Link erzeugen** bekommt die Person einen Link, der einmal und 24 Stunden gilt. Damit übernimmt sie ihr Profil auf dem neuen Gerät.

## Datenbank-Regeln testen

```bash
npm run test:db
```

Der Test prüft ohne Internet, ob die Rechte stimmen: wer was sehen, anlegen und abhaken darf, wie Einladungs- und Wiederanmelde-Links funktionieren.
