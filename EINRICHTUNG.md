# Festival-Orga einrichten

Einmalig, etwa 15 Minuten. Alles ist kostenlos.

## 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto anlegen. Am besten mit einer E-Mail-Adresse des Kollektivs, nicht mit einer privaten.
2. **New project** wÃ¤hlen:
   - Name: zum Beispiel `festival-orga`
   - Region: **Central EU (Frankfurt)**
   - Datenbank-Passwort: sicher aufbewahren, die App braucht es nicht
3. Warten, bis das Projekt bereit ist.

## 2. Anmeldung Ã¼bers GerÃ¤t einschalten

Unter **Authentication** in den Anmelde-Einstellungen (vermutlich **Sign In / Providers**) die Option **Allow anonymous sign-ins** einschalten und speichern. Supabase stellt das MenÃ¼ ab und zu um. Wenn du sie nicht findest, hilft die [Anleitung von Supabase](https://supabase.com/docs/guides/auth/auth-anonymous).

So kann man ohne E-Mail und ohne Passwort beitreten. Wer reinkommt, entscheidet allein der Einladungslink. Ein GerÃ¤t ohne gÃ¼ltigen Link sieht nichts, das regelt die Datenbank.

## 3. Datenbank anlegen

1. **SQL Editor â†’ New query** Ã¶ffnen.
2. Den kompletten Inhalt von `supabase/migrations/0001_grundgeruest.sql` einfÃ¼gen und auf **Run** klicken. Danach genauso mit `0002_schichten_lineup_kalender.sql`, `0003` bis `0008` (alle in `supabase/migrations`), immer in dieser Reihenfolge. (Oder gleich `supabase/setup_komplett.sql`, da stehen alle acht drin.)
3. Eine neue Abfrage Ã¶ffnen, den Namen eures Kollektivs einsetzen und ausfÃ¼hren:

   ```sql
   select * from create_collective('Euer Kollektiv');
   ```

   Heraus kommen drei Codes: `admin`, `crew` und `helfer`. **Den Admin-Code nur selbst benutzen.** Er gilt genau einmal.

Dabei werden auch eure Bereiche angelegt: Orga, Barschichten, Aufbau, Designs, Deko, Essen, Social Media, Spiele Olympiade, GlÃ¼cksrad, Shuttle, DJs und Awareness.

## 4. App mit Supabase verbinden

1. In Supabase die **Project URL** und den **Publishable key** (beginnt mit `sb_publishable_`) kopieren. Beides steht in den Projekt-Einstellungen unter **API Keys** bzw. **Data API**. Der Ã¤ltere **anon key** funktioniert genauso.
2. Im Ordner `app` die Datei `.env.example` kopieren, die Kopie `.env` nennen und beide Werte eintragen.
3. App starten:

   ```bash
   npm install
   npm run dev
   ```

## 5. Als Admin beitreten

Im Browser `http://localhost:5173/#/join/ADMINCODE` Ã¶ffnen, wobei `ADMINCODE` der Admin-Code aus Schritt 3 ist. Namen eingeben, fertig.

Danach findest du unter **Menschen â†’ Leute einladen** den Helfer:innen-Link und den Crew-Link.

## Neues Handy oder Browserdaten gelÃ¶scht?

Unter **Menschen â†’ Bearbeiten â†’ Wiederanmelde-Link erzeugen** bekommt die Person einen Link, der einmal und 24 Stunden gilt. Damit Ã¼bernimmt sie ihr Profil auf dem neuen GerÃ¤t.

## Datenbank-Regeln testen

```bash
npm run test:db
```

Der Test prÃ¼ft ohne Internet, ob die Rechte stimmen: wer was sehen, anlegen und abhaken darf, wie Einladungs- und Wiederanmelde-Links funktionieren.

