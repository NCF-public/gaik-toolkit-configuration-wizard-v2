# GAIK Solution Wizard — basic UI -prototyyppi

Erillinen Next.js-prototyyppi GAIK Solution Wizardin web-UI:sta. Sisältää:

- **Supabase-kirjautumisen** (sähköposti + salasana), reitit suojattu middlewarella
- **Session-hallinnan** (Sprint 1 -tarina): session-lista, uuden aloitus, sekä wizard-näkymä jossa kolme paneelia (chat | työtila | vaiheet). Stepper näyttää nykyisen vaiheen, valmiit vaiheet ja gate-statukset; käyttäjä etenee vaiheissa ja hyväksyy gatet.
- **Chat-paneelin SSE-streamauksella**: viestilista (käyttäjä/assistentti) + syöte. Vastaus striimataan reaaliajassa `text/event-stream`-endpointista (`/api/sessions/[id]/chat`) token kerrallaan. Mock-vastaus on vaihe-tietoinen ja käyttäjän kielellä; chat-historia tallentuu session-dataan. Varsinainen agentti (Claude Agent SDK) kytketään saman SSE-rajapinnan taakse Sprint 2:ssa.
- **Työtila-paneelin** neljällä välilehdellä: **Työnkulku** (virallinen BPMN 2.0 -kaavio inline bpmn-js:llä; vaihe 8+), **Blueprint** (lomake-editori: nimi/tavoite/kuvaus + vaihekortit, komponentti + asetukset per vaihe; raaka JSON kehittäjänäkymän takana), **Suunnitelma** (SME-5: sama sisältö liiketoimintakielellä — syötteet/vaiheet/tulosteet/ihmisen tarkistukset) ja **PoC** ("Aja PoC" striimaa mock-lokit SSE:llä terminaaliin + status). BPMN V2 aloitettu (#34): asiakkaan referenssi-XML + standardirenderöinti; muokkaus ja JSON-synkka Sprint 2–3.
- **Design-systeemi**: yhtenäinen ammattimainen ilme (teal-brandi `#0d9488`, slate-neutraalit). Semanttiset väri-/varjo-/radius-tokenit `app/globals.css`:n `@theme`-lohkossa (esim. `bg-surface`, `text-text-muted`, `bg-brand`, status-/gate-tokenit, `term-*`). Käytä näitä tokeneita, älä raakoja Tailwind-värejä, jotta ilme pysyy yhtenäisenä.
- **Kielivalinnan fi/en**: kevyt eväste-pohjainen i18n, vaihto headerin FI/EN-valitsimesta. Toimii server-renderöinnissä ja säilyy session yli.

> **Sessions:** without `WIZARD_API_URL`, state is in-memory mock (`lib/mock-sessions.ts`) — fine for quick UI checks only. **Demo / persistence / editable BPMN:** set `WIZARD_API_URL` (Postgres via `wizard_api`). See [`../WIZARD-DEV.md`](../WIZARD-DEV.md).

Tämä on prototyyppi näytille, ei vielä toiminnallinen wizard (chat, BPMN ja PoC ovat placeholdereita). Pino vastaa GAIK demo-appia (Next.js + Supabase) niin että sen voi myöhemmin siirtää demo-appin laajennokseksi.

## Käyttöönotto

1. Asenna riippuvuudet:
   ```
   npm install
   ```
2. Luo Supabase-projekti (https://supabase.com) tai käytä olemassa olevaa. Ota talteen Project URL ja anon/publishable key (Project Settings → API).
3. Kopioi ympäristömuuttujat:
   ```
   cp .env.local.example .env.local
   ```
   ja täytä `NEXT_PUBLIC_SUPABASE_URL` ja `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Käynnistä:
   ```
   npm run dev
   ```
   Avaa http://localhost:3000 — kirjautumaton käyttäjä ohjataan `/login`-sivulle.

## Kirjautuminen

- **Rekisteröidy**-napilla luot tilin. Jos Supabase-projektissa on sähköpostivahvistus päällä, vahvista linkki sähköpostista ennen kirjautumista (tai kytke vahvistus pois: Authentication → Providers → Email → Confirm email).
- **Kirjaudu**-napilla kirjaudut sisään, jolloin pääset wizard-runkoon.
- **Kirjaudu ulos** -nappi headerissa.

## Rakenne

```
app/
  layout.tsx          juuri-layout (asettaa <html lang> kielen mukaan)
  page.tsx            suojattu session-lista + uuden aloitus
  actions.ts          server action: startSession (luo + ohjaa wizardiin)
  locale-actions.ts   server action: setLocale (kielenvaihto)
  api/sessions/[id]/chat/
    route.ts          SSE-streaming-endpoint chatin (mock) vastaukselle
  sessions/[id]/
    page.tsx          wizard-näkymä (3 paneelia, stepper, vaiheen ohjaus)
    actions.ts        server actions: advance / regress / approve
  login/
    page.tsx          kirjautumis-/rekisteröitymislomake
    actions.ts        server actions: login / signup / signOut
components/
  locale-switcher.tsx FI/EN-kielivalitsin
  chat-panel.tsx      chat-paneeli (client; lukee SSE-striimin, päivittää reaaliajassa)
  workspace-panel.tsx työtila-paneeli (client; Työnkulku-vuokaavio + Blueprint JSON)
lib/
  current-user.ts     jaettu getCurrentUser (dev-eväste tai Supabase)
  mock-sessions.ts    session-malli + mock-tietovarasto (muistissa)
  i18n.ts             sanakirjat (fi/en) + getLocale/getI18n
  auth.ts             dev-tilan vakiot
  supabase/
    client.ts         selainpuolen Supabase-client
    server.ts         palvelinpuolen Supabase-client
    middleware.ts     session-päivitys + reittisuojaus
middleware.ts         Next.js middleware -kytkentä
```

## Testit ja laatu

```bash
npm run test          # unit (vitest)
npm run test:e2e      # UI (Playwright)
npm run test:all      # molemmat
ESLINT_USE_FLAT_CONFIG=false npm run lint
```

Koko stack + CI: [`../WIZARD-DEV.md`](../WIZARD-DEV.md). Tietoturva: [`docs/SECURITY.md`](docs/SECURITY.md).

## Logitus

Strukturoitu JSON-logitus (`pino`, `lib/logger.ts`) jokaisella API-reitillä
`withLogging`-wrapperin kautta (`lib/with-logging.ts`): `traceId`, tapahtuma,
HTTP-status ja kesto joka pyynnöstä. Auth-, session- ja
blueprint/BPMN-muutokset kirjautuvat lisäksi audit-tapahtumina
(`lib/audit.ts`). `traceId` kulkee `x-trace-id`-headerissa middlewaresta
lähtien ja välittyy myös `wizard_api`-kutsuihin. Ei salasanoja, tokeneita,
evästeitä tai koko blueprint-/chat-sisältöä lokeissa. Tausta:
[`docs/2026-08-logging/technical-task-logging.md`](docs/2026-08-logging/technical-task-logging.md).

Lokien lukeminen kehityksessä:

```bash
npm run dev | npx pino-pretty
```

Oletustaso on `debug` kehityksessä ja `info` tuotannossa (`lib/logger.ts`);
ohita `LOG_LEVEL`-ympäristömuuttujalla tarvittaessa (`warn`/`error` näyttää
vähemmän). Ilman `pino-pretty`-putkitusta lokit tulostuvat yhtenä
JSON-rivinä per tapahtuma (helppo grepata `traceId`:llä).

## Seuraavat askeleet

- ~~Korvaa `mock-sessions.ts` oikealla persistenssillä~~ → `WIZARD_API_URL` + `lib/sessions.ts` (Sprint 1)
- Chat: kytke SSE-endpointin mock-vastaus oikeaan agenttiin (Claude Agent SDK, Sprint 2)
- Työnkulku: bpmn-js Modeler + blueprint JSON -synkka + dynaaminen BPMN-generointi (V2 #34)
- Tuotantokirjautuminen (HAKA / Entra ID) Supabasen sijaan, jos tilaaja niin päättää
