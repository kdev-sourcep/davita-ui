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

CREATE INDEX IF NOT EXISTS idx_insurance_patient ON patient_insurance(patient_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policy  ON patient_insurance(policy_id);
CREATE INDEX IF NOT EXISTS idx_policies_insurer  ON insurance_policies(insurer_id);

CREATE INDEX IF NOT EXISTS idx_patients_physician ON patients(physician_id);
CREATE INDEX IF NOT EXISTS idx_patients_facility  ON patients(facility_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_mrn
    ON patients(mrn) WHERE mrn IS NOT NULL;
