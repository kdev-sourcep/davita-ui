# DAVITA — Demographics Database

Patient / Physician / Facility demographic records with normalized insurance
coverage, backed by SQLite, a Flask REST API, and an Angular frontend.

## Architecture

| Layer | Tech | Entry point |
|---|---|---|
| Database | SQLite | `davita.db` (schema in `schema.sql`, init/migration in `db.py`) |
| REST API | Flask | `api.py` → http://localhost:5000 |
| Frontend | Angular 22 + Material + d3 | `frontend/` → http://localhost:4200 |
| Menu data | JSON | `menu_options.json` (served via `GET /api/options`) |

## Data model

- **patients** — demographics, coded race/ethnicity/language, MRN,
  FKs to primary physician + facility
- **physicians** — NPI, specialty, license, contact
- **facilities** — CCN, dialysis facility type, station count, contact
- **insurers** — payer master data (name, payer code, EDI payer id,
  support contact, address)
- **insurance_policies** — a policy issued by an insurer
  (policy/member #, group #, plan type, effective/termination dates)
- **patient_insurance** — junction: patient ↔ policy with priority order,
  subscriber details, copays, eligibility-verification flag
- **treatments** — dialysis sessions per patient (date, modality, facility,
  duration, notes); cascades on patient delete

All tables carry `created_at` / `updated_at` audit timestamps.

## Pages

| Route | Contents |
|---|---|
| `/` | Dashboard — stat cards, recent patients |
| `/patients` | Patient records + search + CSV; edit a patient to manage
their insurance coverage and dialysis treatments inline. Duplicate
name+DOB creates are blocked with an explicit "create anyway" path |
| `/physicians` | Physician records + filter + CSV |
| `/facilities` | Facility records + filter + CSV + **US map** —
states shaded by facility count, hover for names, click to filter |
| `/insurance` | All coverage across patients, payer/insurer directory
(add/edit/delete insurance companies) |

All list tables support column sorting (click a header) and pagination
(10/25/50 rows per page).

## Run

```bash
# backend (port 5000)
python3 api.py

# frontend (port 4200) — first time: cd frontend && npm install --legacy-peer-deps
cd frontend && npx ng serve --port 4200

# tests (50 tests: CRUD, validation, coverage model, insurers, search)
python3 -m pytest test_api.py -v
```

Requires Python 3.12+ (`pip install -r requirements.txt`) and Node —
Angular 22 wants an LTS release (22/24/26).

## API

```
GET    /api/options                          menu datasets (race, ethnicity,
                                             languages, payers, plan types,
                                             facility types, relationships)
GET    /api/summary                          dashboard counts + recent patients
GET    /api/insurance                        all coverage records, joined to
                                             policies, insurers, patients
GET    /api/<entity>                         list  (?q= searches patients)
POST   /api/<entity>                         create
GET    /api/<entity>/<id>                    read
PUT    /api/<entity>/<id>                    update
DELETE /api/<entity>/<id>                    delete (409 if referenced)
GET/POST        /api/patients/<id>/insurance        coverage list / create
GET/PUT/DELETE  /api/patients/<id>/insurance/<iid>  coverage item
```

`<entity>` ∈ `patients`, `physicians`, `facilities`, `insurers`,
`treatments`.

Patient create returns `409` with `duplicate_of` when name + DOB matches an
existing record; resubmit with `{"allow_duplicate": true}` to override.

## Rules enforced server-side

- **MRN** — auto-assigned `DAV-######` when blank, unique, immutable
- **NPI** 10 digits · **CCN** 6 alphanumeric · phone/email/ZIP formats · ISO dates
- **Coded menus** — race / ethnicity / language / payer codes validated;
  label normalized from code (`menu_options.json` is the single source)
- **Coverage** — one row per priority (primary/secondary/tertiary);
  policy # required per payer; Medicare requires a valid MBI
  (`1EG4-TE5-MK73`); self-pay holds no policy; "Other" payer auto-creates
  an insurer; plan types menu-validated; copays ≥ 0; term ≥ effective date
- **Insurers** — unique payer name; can't delete one linked to policies
- **Referential integrity** — physicians/facilities in use can't be deleted;
  coverage cascades on patient delete; orphaned policies are cleaned up

## Notes

- `db.py` — connection helper + schema init/migration
  (`DAVITA_DB_PATH` env var overrides the DB location; used by tests)
- The Facilities map uses `us-atlas` TopoJSON served from
  `frontend/public/us-states-albers-10m.json` — fully offline
- Legacy flat coverage payloads (`priority`, `policy_no`, `payer_code`)
  are still accepted as aliases for compatibility
- Dev-mode CORS is open (`*`) and there is no auth — local use only
