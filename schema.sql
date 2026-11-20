-- Davita UI database schema
-- Demographic tables: patients, physicians, facilities

CREATE TABLE IF NOT EXISTS facilities (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_name   TEXT NOT NULL,
    ccn             TEXT,               -- CMS Certification Number
    facility_type   TEXT,               -- e.g. Dialysis Clinic, Hospital, Home Program
    phone           TEXT,
    fax             TEXT,
    email           TEXT,
    address_line1   TEXT,
    address_line2   TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    station_count   INTEGER,            -- number of dialysis stations
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS physicians (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    npi             TEXT,               -- National Provider Identifier
    specialty       TEXT,               -- e.g. Nephrology, Internal Medicine
    license_number  TEXT,
    phone           TEXT,
    email           TEXT,
    address_line1   TEXT,
    address_line2   TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS patients (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    mrn                 TEXT,           -- Medical Record Number
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    date_of_birth       TEXT,           -- ISO date YYYY-MM-DD
    gender              TEXT,
    race                TEXT,
    race_code           TEXT,           -- CDC race code (e.g. 2106-3)
    ethnicity           TEXT,
    ethnicity_code      TEXT,           -- e.g. 2135-2
    primary_language    TEXT,
    primary_language_code TEXT,         -- ISO 639 code (e.g. en, es, ase)
    phone               TEXT,
    email               TEXT,
    address_line1       TEXT,
    address_line2       TEXT,
    city                TEXT,
    state               TEXT,
    zip                 TEXT,
    insurance_provider  TEXT,
    insurance_provider_code TEXT,       -- payer code (e.g. medicare_advantage)
    insurance_policy_no TEXT,
    insurance_other     TEXT,           -- free-text payer when provider = Other
    physician_id        INTEGER REFERENCES physicians(id),
    facility_id         INTEGER REFERENCES facilities(id),
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT
);

-- Insurance is modeled as three normalized tables:
--   insurers            — payer master data (name, EDI payer id, support contact)
--   insurance_policies  — a specific plan/policy issued by an insurer
--   patient_insurance   — junction linking a patient to a policy with
--                         priority order, subscriber info, copays, verification
CREATE TABLE IF NOT EXISTS insurers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    payer_name      TEXT NOT NULL UNIQUE,   -- e.g. "Blue Cross Blue Shield (BCBS)"
    payer_code      TEXT UNIQUE,            -- menu code, e.g. medicare_original
    payer_id        TEXT,                   -- EDI payer ID for claims submission
    phone_support   TEXT,
    address_line1   TEXT,
    address_line2   TEXT,
    city            TEXT,
    state           TEXT,
    postal_code     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS insurance_policies (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    insurer_id       INTEGER NOT NULL REFERENCES insurers(id),
    policy_number    TEXT,                  -- member ID / MBI on the card
    group_number     TEXT,                  -- employer/plan group code
    plan_type        TEXT,                  -- HMO, PPO, HDHP, Medicare, ...
    effective_date   TEXT,                  -- coverage start (DOS logic)
    termination_date TEXT,                  -- coverage end, NULL while active
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT
);

CREATE TABLE IF NOT EXISTS patient_insurance (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id            INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    policy_id             INTEGER NOT NULL REFERENCES insurance_policies(id),
    priority_order        INTEGER NOT NULL,  -- 1=primary, 2=secondary, 3=tertiary
    subscriber_rel        TEXT,              -- Self, Spouse, Child, ...
    subscriber_first_name TEXT,              -- policyholder if not the patient
    subscriber_last_name  TEXT,
    subscriber_dob        TEXT,
    copay_primary_care    REAL,
    copay_specialist      REAL,
    is_verified           INTEGER NOT NULL DEFAULT 0,  -- eligibility check flag
    verification_date     TEXT,              -- last eligibility verification
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT
);

-- Dialysis treatments / encounters: a session delivered to a patient
-- at a facility on a given date.
-- Application users — role-based access control.
--   viewer    read-only
--   registrar read + create/update
--   admin     full access + user management
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('viewer', 'registrar', 'admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS treatments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    facility_id      INTEGER NOT NULL REFERENCES facilities(id),
    treatment_date   TEXT NOT NULL,         -- date of service
    modality         TEXT,                  -- In-Center HD, Home HD, PD, ...
    duration_minutes INTEGER,
    notes            TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_treatments_patient ON treatments(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatments_facility ON treatments(facility_id);

-- Product catalog: medications, dialyzers, supplies (HCPCS-style billing).
CREATE TABLE IF NOT EXISTS products (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    sku              TEXT NOT NULL UNIQUE,
    product_name     TEXT NOT NULL,
    category         TEXT NOT NULL,          -- Medication | Dialysis Supply | Equipment | Consumable
    unit_of_measure  TEXT NOT NULL,          -- unit, vial, set, box, mL, ...
    unit_cost        REAL NOT NULL,
    billable_code    TEXT,                   -- HCPCS code for claims, e.g. J0885
    is_active        INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT
);

-- Billable clinical encounter: patient + physician at a facility,
-- optionally linked to a coverage record for claim routing.
CREATE TABLE IF NOT EXISTS encounters (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    physician_id     INTEGER NOT NULL REFERENCES physicians(id),
    facility_id      INTEGER NOT NULL REFERENCES facilities(id),
    coverage_id      INTEGER REFERENCES patient_insurance(id) ON DELETE SET NULL,
    encounter_date   TEXT NOT NULL,          -- datetime of service
    encounter_type   TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'Scheduled'
                     CHECK (status IN ('Scheduled', 'In Progress',
                                       'Completed', 'Billed')),
    clinical_notes   TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT
);

-- Charge lines on an encounter — price is captured at time of service.
CREATE TABLE IF NOT EXISTS encounter_products (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id      INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    product_id        INTEGER NOT NULL REFERENCES products(id),
    quantity          REAL NOT NULL,
    lot_number        TEXT,
    unit_price_at_time REAL NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT
);

-- Lab results captured on an encounter (monthly dialysis labs etc).
CREATE TABLE IF NOT EXISTS encounter_labs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id      INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    test_code         TEXT NOT NULL,          -- e.g. 'K', 'SPKTV'
    test_name         TEXT NOT NULL,          -- display name at time of result
    result_value      TEXT NOT NULL,
    units             TEXT,
    reference_range   TEXT,
    flag              TEXT,                   -- Normal / Low / High / Critical
    collected_at      TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT
);

-- Medications administered / reconciled during an encounter.
CREATE TABLE IF NOT EXISTS encounter_medications (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id      INTEGER NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    drug_name         TEXT NOT NULL,
    dose              TEXT NOT NULL,          -- e.g. '4000 units', '10 mg'
    route             TEXT NOT NULL,          -- IV / PO / SC ...
    frequency         TEXT,                   -- e.g. 'during dialysis', 'daily'
    status            TEXT NOT NULL DEFAULT 'Administered',
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT
);

-- Treatment run-sheet for the encounter (0..1 rows per encounter):
-- the actual dialysis run parameters, weights and vascular access.
CREATE TABLE IF NOT EXISTS encounter_treatments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    encounter_id      INTEGER NOT NULL UNIQUE REFERENCES encounters(id)
                      ON DELETE CASCADE,
    modality          TEXT,
    duration_minutes  INTEGER,
    blood_flow_ml_min     INTEGER,          -- Qb
    dialysate_flow_ml_min INTEGER,          -- Qd
    ultrafiltration_goal_ml REAL,
    access_type       TEXT,
    pre_weight_kg     REAL,
    post_weight_kg    REAL,
    dry_weight_kg     REAL,
    treatment_notes   TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_encounters_patient ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_encounter_products ON encounter_products(encounter_id);
CREATE INDEX IF NOT EXISTS idx_encounter_labs ON encounter_labs(encounter_id);
CREATE INDEX IF NOT EXISTS idx_encounter_meds ON encounter_medications(encounter_id);

CREATE INDEX IF NOT EXISTS idx_insurance_patient ON patient_insurance(patient_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policy  ON patient_insurance(policy_id);
CREATE INDEX IF NOT EXISTS idx_policies_insurer  ON insurance_policies(insurer_id);

CREATE INDEX IF NOT EXISTS idx_patients_physician ON patients(physician_id);
CREATE INDEX IF NOT EXISTS idx_patients_facility  ON patients(facility_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_mrn
    ON patients(mrn) WHERE mrn IS NOT NULL;
