# Smart Trip Planner

A production-ready web app that generates day-by-day travel itineraries using OpenAI.

## Features

- **Input form**: Country, city, number of nights (1–14), and multi-select travel style
- **AI-generated itinerary**: Day-by-day plan with Morning, Lunch, Afternoon, Dinner, Evening
- **Smart depth**: 1–2 nights = highlights only; 3–4 = hidden spots; 5+ = day trips
- **Responsive UI**: Mobile-first, cards, soft shadows, loading states
- **Fast city search**: Local dataset with Korean/English city names
- **Share links**: Save and share itineraries via Supabase

## Setup

1. **Install dependencies**

   ```bash
   cd smart-trip-planner
   npm install
   ```

2. **Configure environment**

   Copy the example env file and add your OpenAI API key:

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and set:

   ```
   OPENAI_API_KEY=sk-your-actual-key
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

3. **Run the app**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Share link setup (Supabase)

Create a table for shared itineraries:

```sql
create extension if not exists "pgcrypto";

create table if not exists public.itineraries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  markdown text not null,
  payload jsonb not null,
  expires_at timestamptz,
  delete_token uuid,
  deleted_at timestamptz
);
```

You do not need client-side keys because the API routes use the service role key on the server.

If you already created the table, run:

```sql
alter table public.itineraries
  add column if not exists expires_at timestamptz,
  add column if not exists delete_token uuid,
  add column if not exists deleted_at timestamptz;
```

## KakaoTalk share setup

1. Create a Kakao Developers app and enable Kakao Link for Web.
2. Register your web domain in the Kakao Developers console.
3. Add the JavaScript key to `.env.local`:

```
NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY=your-kakao-js-key
```

Optionally, pin the SDK version and integrity hash:

```
NEXT_PUBLIC_KAKAO_SDK_VERSION=2.7.9
NEXT_PUBLIC_KAKAO_SDK_INTEGRITY=...
```

## Data generation (optional)

`data/countries.json` and `data/cities/*.json` are already generated. If you want to rebuild them:

1. Download GeoNames dumps to `data/geonames/raw`:
   - `https://download.geonames.org/export/dump/cities1000.zip`
   - `https://download.geonames.org/export/dump/alternateNamesV2.zip`
   - `https://download.geonames.org/export/dump/countryInfo.txt`
2. Extract the zip files into the same folder.
3. Run:

```bash
node scripts/build_geonames_dataset.js
```

## Project structure

```
smart-trip-planner/
├─ app/
│  ├─ api/generate/route.ts
│  ├─ api/regenerate-day/route.ts
│  ├─ api/countries/route.ts
│  ├─ api/cities/route.ts
│  ├─ api/share/route.ts
│  ├─ api/share/[id]/route.ts
│  ├─ itinerary/page.tsx
│  ├─ share/[id]/page.tsx
│  ├─ layout.tsx
│  ├─ page.tsx
│  └─ globals.css
├─ components/
│  ├─ TripForm.tsx
│  ├─ ItineraryView.tsx
│  └─ LoadingSpinner.tsx
├─ data/
│  ├─ countries.json
│  └─ cities/
├─ scripts/
│  └─ build_geonames_dataset.js
├─ .env.example
└─ README.md
```

## Sample OpenAI prompt (API)

The `/api/generate` route builds a prompt like this:

```
You are an expert travel planner. Create a day-by-day itinerary in Markdown.

**Destination:** Tokyo, Japan
**Number of days:** 4 (3 nights)
**Travel style(s):** Food & Dining, Culture & History

**Instructions:**
- Output ONLY valid Markdown. No preamble.
- Structure each day: ## Day N - [Theme], then ### Morning, ### Lunch, ### Afternoon, ### Dinner, ### Evening (optional).
- For each activity: name, short description, and **estimated travel time** to next item.
- [Depth instruction based on nights: 1–2 = core highlights; 3–4 = hidden spots; 5+ = day trips.]
- Group locations geographically. Avoid excessive daily schedule.
- Balance food, attractions, and free time.
```

## Data source and license

City and country data are generated from GeoNames dumps (CC-BY 4.0). You must keep attribution when redistributing.

## Build for production

```bash
npm run build
npm start
```
