# AGENTS.md

Guide for AI coding agents (ChatGPT, Claude Code, Codex, OpenCode, Cursor, …) working in this repository. Read this before changing code. It describes how the project is put together, how to run it, and the conventions and traps that are easy to get wrong.

If something here disagrees with the code, trust the code and update this file.

---

## 1. What this project is

A map-first web app for the **urban furniture inventory of Aveiro** (traffic signs, public lighting, waste bins).

- Users upload photos. The furniture detector runs before face and plate anonymization. Furniture detections are projected into map coordinates using the camera position and heading.
- Detections of the same class within a radius are merged into one inventory item.
- Anyone can browse the map and item details.
- Logged-in users can upload images and file reports.
- **Technicians** can additionally rename items, move item/image coordinates, delete images/items, and resolve reports.

The UI is in Portuguese (`pt-PT`). Keep user-facing strings in Portuguese.

### Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8, Leaflet, Bootstrap Icons, custom CSS |
| Backend | FastAPI + Uvicorn, psycopg 3 connection pool |
| Database | PostgreSQL + PostGIS (schema `aveiro`) |
| Auth | Supabase Auth (email/password); JWT validated server-side |
| Images | Local filesystem (`images/public`, `images/private`) |
| Map tiles | CARTO (Voyager / Dark Matter) with API key; OpenStreetMap fallback |

The FastAPI process serves the built SPA, the API, and the images from one origin.

---

## 2. Repository layout

```
.
├── AGENTS.md                  ← this file
├── README.md                  ← setup notes (partly stale, see §10)
├── flake.nix / .envrc         ← Nix dev shell (Node 26, Python 3.12, PostgreSQL+PostGIS, uv)
├── requirements.txt           ← Python deps for the server and dataset tools
├── .env / .env.example        ← backend env (DATABASE_URL, Mapillary token)
├── .venv/                     ← existing uv-managed Python env (gitignored)
├── aveiro-data/               ← local Postgres cluster (gitignored)
├── Datasets/                  ← Mapillary/downloaded data (mostly gitignored)
├── yolo/                      ← detection checkpoint and subtype classifiers
├── dot/                       ← stray empty npm package; ignore it
├── server/
│   ├── app/
│   │   ├── __init__.py        ← FastAPI app, routes, auth, upload/publish logic
│   │   ├── __main__.py        ← CLI entry point (--host, --port, --data-dir)
│   │   └── config.py          ← settings, hardcoded Supabase/CORS/dedup values
│   ├── imaging.py             ← EXIF, YOLO detection, JPEG preparation, projection
│   ├── anonymization.py       ← face and plate detection, blur and pixelation
│   ├── inventory.py           ← SQL for items/images/detections, dedupe, recompute
│   ├── migrations/001_inventory.sql
│   ├── schema.sql             ← psql entry point for migrations
│   ├── tests/test_workflows.py
│   └── Caddyfile, skyloft.nix ← deployment leftovers
└── web/
    ├── .env / .env.example    ← Vite env (Supabase + API + CARTO key)
    ├── dist/                  ← build output served by FastAPI (gitignored)
    ├── src/config.ts          ← typed frontend config read by the app
    └── dot/                   ← the actual Vite project
        ├── index.html
        ├── vite.config.ts     ← envDir = web/, outDir = ../dist, dev proxy
        └── src/
            ├── App.tsx        ← state, data fetching, dialog orchestration
            ├── main.tsx       ← React root + CSS imports
            ├── api.ts         ← typed fetch wrapper for /api
            ├── supabase.ts    ← Supabase client
            ├── constants.ts   ← categories, class→category map, labels, formatting
            ├── types.ts       ← shared API types
            ├── mapTiles.ts    ← CARTO/OSM tile URLs + attribution
            ├── theme.tsx      ← light/dark theme context + persistence
            ├── toast.tsx      ← toast context
            ├── index.css      ← the entire design system
            └── components/    ← AuthDialog, DetectionImage, FilterPanel, Header,
                                  ImagesDialog, ItemDrawer, LocationPicker, MapView,
                                  Modal, ReportsDialog, UploadDialog
```

Notes:

- `server/` is a **namespace package** (no `server/__init__.py`). Run it as a module from the repo root.
- `web/dot/` is the Vite root. `web/src/config.ts` sits above it and is imported as `../../src/config.ts`. Vite is configured with `envDir` pointing at `web/`, so `web/.env` is the file Vite reads.
- `web/dist/` is generated; never edit it by hand.

---

## 3. First-time setup

Prerequisites: Nix (recommended) or Node ≥ 22, Python 3.12, uv, PostgreSQL with PostGIS.

```sh
# Enter the dev shell (direnv may do this automatically)
nix develop

# Python env (already present in this checkout)
uv venv .venv --python 3.12
uv pip install --python .venv --torch-backend cpu -r requirements.txt

# Frontend deps
cd web/dot && npm install && cd ../..
```

Download the two ONNX anonymization models into `<data-dir>/models` using the [server setup instructions](server/README.md#modelos-de-anonimização).

### Environment files

Two different env files, for two different runtimes. Do not mix them up.

**Root `.env`** — read by the backend:

```sh
DATABASE_URL=postgresql://aveiro@127.0.0.1:5433/aveiro
# Optional: MAPILLARY_ACCESS_TOKEN=... (dataset scripts only)
```

`server/app/config.py` loads it with `dotenv_values`, but **only `DATABASE_URL` is actually consumed**. `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CORS_ORIGINS`, and `DEDUP_RADIUS_METERS` are hardcoded constants in that file. Other variables in `.env.example` such as `IMAGE_DIR` and `PUBLIC_IMAGE_BASE_URL` are aspirational and currently ignored. If you need them configurable, implement it in `config.py` first.

**`web/.env`** — read by Vite at build/dev time:

```sh
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_API_BASE_URL=/api
VITE_CARTO_API_KEY=            # basemap tiles; public by design
```

`web/src/config.ts` applies fallbacks for the Supabase values and `apiBase`. If `VITE_CARTO_API_KEY` is empty, `mapTiles.ts` falls back to keyless OpenStreetMap tiles. The Supabase publishable key is intentionally shipped to the browser; the **secret** service key must never be committed or bundled.

### Database

```sh
# Local cluster (port 5433 in this checkout)
initdb -D aveiro-data/postgres -U aveiro --auth=trust --no-locale -E UTF8
pg_ctl -D aveiro-data/postgres -l aveiro-data/postgres.log \
  -o "-p 5433 -c listen_addresses=127.0.0.1 -c unix_socket_directories=" start
createdb -h 127.0.0.1 -p 5433 -U aveiro aveiro
psql -h 127.0.0.1 -p 5433 -U aveiro -d aveiro -c "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public"
psql -h 127.0.0.1 -p 5433 -U aveiro -d aveiro -f server/schema.sql
```

The migration is idempotent (`IF NOT EXISTS`) and runs in a transaction. `server/schema.sql` is just `\ir migrations/001_inventory.sql`, so it must be run from a context where psql can find `server/migrations/` (running it as shown above from the repo root works).

### Technician accounts

Supabase Auth handles sign-up/login. A user becomes a technician only through Supabase `app_metadata.role = 'technician'` (set with the Supabase admin API). The backend re-reads the user from Supabase on every authenticated request, so role changes take effect after the next request (no re-login strictly required, but the UI refreshes on reload).

---

## 4. Run, build, test

All commands from the repository root unless noted.

```sh
# Backend + built frontend on http://127.0.0.1:8000
uv run --python .venv python -m server.app

# Custom bind / data directory
uv run --python .venv python -m server.app --host 127.0.0.1 --port 8000 --data-dir ~/aveiro-data

# Frontend dev server on http://localhost:5173 (proxies /api and /img to :8000)
cd web/dot && npm run dev

# Production build → web/dist
cd web/dot && npm run build

# Lint (oxlint; warnings are acceptable, errors are not)
cd web/dot && npm run lint

# Python tests
uv run --python .venv python -m unittest discover -s server/tests -v
```

- `npm run build` runs `tsc -b` first. Type errors fail the build.
- `server/tests/test_workflows.py` has pure unit tests that always run, plus `InventoryWorkflow`, which is skipped unless `AVEIRO_TEST_DATABASE_URL` is set. That suite creates and drops a scratch database, so point it at a disposable Postgres/PostGIS instance, never at the real `aveiro` DB.
- **Test import currently needs `httpx2`.** `fastapi.testclient` imports `starlette.testclient`, which raises unless `httpx2` is installed. It is not in `requirements.txt` in this checkout, so `unittest discover` fails at import with `RuntimeError: The starlette.testclient module requires the httpx2 package`. Install it first: `uv pip install --python .venv httpx2` (and consider adding it to `requirements.txt`).
- After changing frontend code, rebuild before testing against `:8000`; that server only serves `web/dist`.

### Data directory

Default: `~/aveiro-data` (`Path.home() / 'aveiro-data'`, set in `server/app/config.py`). Override with `--data-dir`.

```
<data-dir>/
├── images/public/<image-id>.jpg    ← published images, served at /img/<id>.jpg
├── images/private/<preview-id>.jpg ← staged previews, deleted after 30 min
└── models/                          ← RetinaFace ResNet34 and YOLOv9-S 608 ONNX weights
```

The private and public image directories must not overlap; the app refuses to start otherwise.

---

## 5. Backend architecture

Entry point: `server/app/__main__.py` → `Settings.from_env()` → `create_app(settings)` → Uvicorn.

`create_app` builds a psycopg `ConnectionPool` (`min_size=1`, `max_size=8`, autocommit, `dict_row`) and an `APIRouter` mounted at `/api`. A background task deletes expired previews every 5 minutes. The built SPA is served as a static fallback from `web/dist`.

### Auth

- `Authorization: Bearer <supabase-jwt>` header.
- `authenticated()` calls `GET {SUPABASE_URL}/auth/v1/user` on every request, rejects anonymous users (`is_anonymous`) and non-`authenticated` roles, and derives the display name from `user_metadata.public_name`.
- `technician()` requires `app_metadata.role == 'technician'`.
- Supabase/network failures become `503`, not `401`.

### API routes (all under `/api`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/me` | user | Current account (`id`, `public_name`, `role`) |
| GET | `/items` | public | List items; filters `?category=` and `?class_name=` (repeatable) |
| GET | `/items/{id}` | public | Item detail with its images and detections |
| GET | `/images` | technician | All published images |
| POST | `/previews` | user | Detect furniture, anonymize, and return `{id, camera, detections}` |
| GET | `/previews/{id}/image` | owner | Blurred staged JPEG |
| POST | `/previews/{id}/publish` | owner | Publish with manual `{latitude, longitude, heading}` |
| GET | `/published/{id}` | user | 204 probe used to detect already-published previews |
| PATCH | `/items/{id}` | technician | Rename and/or move item |
| DELETE | `/items/{id}` | technician | Delete item (cascades detections) |
| PATCH | `/images/{id}` | technician | Correct camera position/heading, recompute projections |
| DELETE | `/images/{id}` | technician | Delete image and recompute affected items |
| POST | `/reports` | user | Create report, optional `item_id` |
| GET | `/reports` | user | List reports |
| PATCH | `/reports/{id}/resolve` | technician | Mark report resolved |

Images are served from `/img/{image-id}.jpg` (not under `/api`). CORS is only needed for the Vite dev server; the production app is same-origin.

### Upload → publish flow

1. `POST /api/previews` receives one image (max 12 MiB, JPEG/PNG/WebP).
2. `imaging.prepare_photo` reads EXIF GPS/heading, applies EXIF orientation, detects and classifies furniture, and passes the image to `anonymization.anonymize`. It strips metadata and writes the anonymized JPEG to `images/private/<preview-id>.jpg` only after both privacy models succeed.
3. The preview row stores `metadata` (camera) and `detections` for 30 minutes.
4. The client shows the blurred image with detection boxes and asks for position + heading (map picker or GPS).
5. `POST /api/previews/{id}/publish` moves the file to `images/public/`, inserts the image and detections, and creates/merges items in one transaction.

### Projection and dedupe

`server/imaging.py`:

- `projection(heading, bbox)` estimates distance/bearing from the normalized detection box (horizontal offset → bearing, box size/vertical position → distance). It is a **best guess**, not calibrated.
- `detect()` runs `yolo/detector_3classes.pt` in CPU mode before redaction and checks overlapping tiles for small signs and bins. With `yoloe-26s-seg.pt` in `<data-dir>/models`, it adds a full-image YOLOE pass using the bundled prompt embeddings. The detector normalizes the boxes and suppresses duplicates within each category.
- `anonymization.anonymize()` runs RetinaFace ResNet34 (0.30) and YOLOv9-S 608 (0.25) via ONNX Runtime. It combines boxes from both, pads them, and applies Gaussian blur and pixelation. Anonymization failures return 503 and leave no staged preview.

`server/inventory.py`:

- On publish, each detection is projected from the camera, then matched to the nearest existing item of the **same `class_name`** within `DEDUP_RADIUS_METERS` (50 m). No match → new item.
- Item positions are the centroid of their detections, unless `position_manually_corrected` is true.
- Writes that can move/remove candidates take `pg_advisory_xact_lock(610305215)` to serialize.

### Data model (`aveiro` schema)

- `items(id, category, class_name, label, position geography, position_manually_corrected)`
- `images(id, file_path, camera_position, camera_heading, uploader_id, uploader_name, submitted_at)`
- `detections(id, image_id, item_id, predicted_class, confidence, bbox jsonb, estimated_position)`
- `reports(id, description, author_id, item_id, status, submitted_at, resolved_by, resolved_at)`
- `image_previews(id, owner_id, metadata jsonb, detections jsonb, expires_at)`

`file_path` is constrained to `<id>.jpg`. Positions are `geography(Point, 4326)`; SQL reads them as `ST_Y(...)`/`ST_X(...)` aliased to `latitude`/`longitude`.

---

## 6. Frontend architecture

Single-page app. No router: `App.tsx` owns view state and opens dialogs/drawers.

- **Layout**: full-viewport Leaflet map under a glass app bar. Floating filter/search card on the left, account menu top-right, item details in a right slide-over drawer. Upload/auth/reports/images are modals. Toasts for feedback.
- **Map** (`MapView.tsx`): Leaflet with CARTO tiles from `mapTiles.ts`; category-coloured markers; fit/fly to selection.
- **Location picker** (`LocationPicker.tsx`): reusable Leaflet map used for uploads and technician corrections. Click sets the camera point, a draggable arrow sets heading, a 65° FOV wedge visualizes the view. Also supports GPS and recentring. Heading is `[0, 360)`.
- **Item drawer** (`ItemDrawer.tsx`): item metadata, image gallery/lightbox, uploader name, detections, and technician edit/move/delete controls.
- **Upload** (`UploadDialog.tsx`): file → `POST /previews` → blurred preview with boxes → location/heading → publish. Location and heading are mandatory before publishing.
- **Reports** (`ReportsDialog.tsx`): create reports (optionally tied to an item); technicians can resolve.
- **Auth** (`AuthDialog.tsx` + `supabase.ts`): email/password sign-in/sign-up; the access token is passed to `api()`.
- **Theme** (`theme.tsx`): light/dark, persisted in `localStorage`, applied before paint by an inline script in `index.html`.

### Frontend conventions

- TypeScript is strict about unused code: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. Use `import type { … }` for types.
- Relative imports include the extension: `./types.ts`, `../theme.tsx`.
- Config comes from `web/src/config.ts` via `../../src/config.ts`; do not read `import.meta.env` directly elsewhere.
- Category/class/label mapping lives in `constants.ts`. Add new classes to `CLASS_CATEGORY` and `CLASS_LABELS` there, and keep the backend `Category` literal (`sinalizacao`, `iluminacao`, `residuos`) in sync.
- Styling is plain CSS with custom properties in `index.css` (`--cat-sign`, `--cat-light`, `--cat-bin`, theme tokens). Bootstrap CSS is **not** imported; only `bootstrap-icons` is. Do not reintroduce Bootstrap/AOS/GLightbox/Swiper.
- Keep the Portuguese copy and the existing visual language (rounded cards, glass surfaces, category colours).
- Lint is `oxlint`. `set-state-in-effect` and `only-export-components` warnings are expected in a few places; don't add new errors.

---

## 7. Verification checklist

Before handing work back:

1. `cd web/dot && npm run build` — must pass (runs `tsc -b`).
2. `cd web/dot && npm run lint` — no errors.
3. `uv run --python .venv python -m unittest discover -s server/tests -v` — unit tests pass. If it fails at import, install `httpx2` first (see §4).
4. For API changes, run the server and exercise the endpoint (curl or the app). Authenticated routes need a real Supabase token.
5. For map/env changes, rebuild and confirm the served `web/dist` bundle contains the expected tile URL/key.
6. Check that no secret (Supabase **secret** key, Mapillary token) is staged for commit. The Supabase publishable key and CARTO key are public by design.

There is no end-to-end browser test suite. If browser automation is unavailable, verify with the build, lint, unit tests, and `curl` against `:8000`.

---

## 8. Common tasks

**Add an inventory class**
1. Add `class_name` → category in `web/dot/src/constants.ts` (`CLASS_CATEGORY`) and a label in `CLASS_LABELS`.
2. Ensure the detector can emit that `class_name` (`server/imaging.py`).
3. No DB migration needed; `class_name` is free text.

**Add an API endpoint**
1. Add a handler inside `create_app` on the `api` router, with the right dependency (`authenticated` or `technician`).
2. Put reusable SQL in `server/inventory.py`, not inline.
3. Add the TypeScript type in `web/dot/src/types.ts` and a wrapper call in `App.tsx`/`api.ts`.
4. Update the route table in §5.

**Change the map style/key**
- Edit `web/dot/src/mapTiles.ts` and `web/.env`. Rebuild. Without a key the app intentionally falls back to OSM.

**Extend the image processing pipeline**
- Run furniture detection and subtype classification before anonymization. `classifier_sinais.pt` and `classifier_lixos.pt` classify crops from the generic sign and bin detections. Keep the generic label when a classifier is uncertain, fails to run, or outputs a subtype the inventory cannot map. Keep the `Detection` return shape and normalized top-left bounding box coordinates when extending the pipeline.

**Add a configurable setting**
- Add it to `Settings` and `Settings.from_env` in `server/app/config.py`, read from root `.env` or `os.environ`, then document it in `.env.example`. Do not add Vite variables to the root `.env`.

---

## 9. Conventions and guardrails

- Prefer small, targeted edits. Do not rewrite `index.css` or `App.tsx` wholesale to fix a local issue.
- Keep changes consistent with the existing structure and Portuguese naming/copy.
- Do not commit or print secrets. `web/.env`, root `.env`, `.venv`, `aveiro-data/`, `web/dist/`, `node_modules/` are gitignored.
- Do not delete `aveiro-data/` or `~/aveiro-data`; they contain the local Postgres cluster and uploaded images.
- Do not touch `web/dist/` by hand; rebuild it.
- The `dot/` directory at the repo root is an unrelated empty npm package. Ignore it.
- Do not add GitHub Pages deployment back; the app is served by FastAPI. `gh-pages` is still listed in `devDependencies` but unused.
- Keep the API and frontend category/class vocabularies in sync.
- If you change behaviour described here, update this file in the same change.

---

## 10. Known gotchas / current state

- **`README.md` is partly stale.** It says the default data dir is `aveiro-data/` in the repo root; the code actually defaults to `~/aveiro-data`. It also documents root `.env` variables that `config.py` ignores.
- **Root `.env` only supplies `DATABASE_URL`.** Everything else in `config.py` is hardcoded.
- **Frontend env is `web/.env`, not the root `.env`.** Vite `envDir` is set to `web/`. Variables must be prefixed `VITE_`.
- **Supabase is contacted on every authenticated request.** No local JWT verification or caching. Expect latency and 503s when offline.
- **Anonymization depends on the two ONNX weights.** Verify the preview before publishing, especially for small or partially hidden faces and plates.
- **Projection is approximate.** Item positions are best-effort; technicians can correct them.
- **Dedupe radius is 50 m** and class-scoped. Changing it means editing `DEDUP_RADIUS_METERS` in `config.py`.
- **Postgres in this checkout is on port 5433** (per root `.env`); the Docker instructions use 5432.
- **`server/` has no `__init__.py`.** It works as a namespace package when run from the repo root; don't add a conflicting `server` package elsewhere.
- **`npm run build` type-checks.** A successful `vite build` alone is not enough.
- **No browser E2E tests.** Visual verification is manual or via the build.
- **Current local data**: a handful of items/images/detections in the dev DB; treat it as disposable.
- **Deployment leftovers**: `server/Caddyfile`, `server/skyloft.nix`, `gh-pages`, and the GitHub Pages CORS origin remain but are not part of the local workflow.
