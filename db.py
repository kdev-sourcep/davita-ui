import json
import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DAVITA_DB_PATH", BASE_DIR / "davita.db"))
SCHEMA_PATH = BASE_DIR / "schema.sql"
MENU_PATH = BASE_DIR / "menu_options.json"


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def menu_options() -> dict:
    return json.loads(MENU_PATH.read_text())


EXTRA_COLUMNS = {
    "patients": ("race_code", "ethnicity_code", "primary_language_code",
                 "insurance_provider_code", "insurance_other", "updated_at"),
    "physicians": ("updated_at",),
    "facilities": ("updated_at",),
    "insurers": ("updated_at",),
    "insurance_policies": ("updated_at",),
    "patient_insurance": ("updated_at",),
}


def table_columns(conn: sqlite3.Connection, table: str) -> set:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def seed_insurers(conn: sqlite3.Connection) -> None:
    """Payers from the menu JSON become insurer master records."""
    for o in menu_options()["insurance_options"]:
        conn.execute(
            "INSERT OR IGNORE INTO insurers (payer_name, payer_code) "
            "VALUES (?, ?)", (o["label"], o["value"]))


def seed_users(conn: sqlite3.Connection) -> None:
    """Bootstrap a default admin when the user table is empty.

    Password comes from DAVITA_ADMIN_PASSWORD (default 'davita') — change it
    for anything beyond local development.
    """
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        return
    from werkzeug.security import generate_password_hash
    pw = os.environ.get("DAVITA_ADMIN_PASSWORD", "davita")
    conn.execute(
        "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
        ("admin", generate_password_hash(pw), "admin"))


def migrate_insurance_rows(conn: sqlite3.Connection) -> None:
    """Move rows from patient_insurance_v1 into the normalized model."""
    for r in conn.execute("SELECT * FROM patient_insurance_v1").fetchall():
        ins = conn.execute(
            "SELECT id FROM insurers WHERE payer_code = ?",
            (r["payer_code"],)).fetchone()
        if ins is None:
            name = r["payer_other"] or r["payer"] or "Unknown Payer"
            ins = conn.execute(
                "SELECT id FROM insurers WHERE payer_name = ?",
                (name,)).fetchone() or conn.execute(
                    "INSERT INTO insurers (payer_name) VALUES (?)",
                    (name,))
        insurer_id = ins["id"] if isinstance(ins, sqlite3.Row) \
            else ins.lastrowid

        policy_id = conn.execute(
            "INSERT INTO insurance_policies (insurer_id, policy_number, "
            "group_number, effective_date, termination_date) "
            "VALUES (?, ?, ?, ?, ?)",
            (insurer_id, r["policy_no"], r["group_no"],
             r["effective_date"], r["termination_date"])).lastrowid

        first, _, last = (r["subscriber_name"] or "").partition(" ")
        conn.execute(
            "INSERT INTO patient_insurance (patient_id, policy_id, "
            "priority_order, subscriber_rel, subscriber_first_name, "
            "subscriber_last_name, subscriber_dob) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (r["patient_id"], policy_id, r["priority"], r["subscriber_rel"],
             first or None, last or None, r["subscriber_dob"]))

    conn.execute("DROP TABLE patient_insurance_v1")


def init_db() -> None:
    conn = get_connection()
    try:
        # An old flat patient_insurance table must be renamed before the
        # schema runs — the new indexes reference columns it lacks.
        needs_migration = (
            "patient_insurance" in {
                r[0] for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'")}
            and "policy_id" not in table_columns(conn, "patient_insurance"))
        if needs_migration:
            conn.execute(
                "ALTER TABLE patient_insurance RENAME TO patient_insurance_v1")

        conn.executescript(SCHEMA_PATH.read_text())
        # Migrate older databases that predate these columns.
        for table, cols in EXTRA_COLUMNS.items():
            existing = table_columns(conn, table)
            for col in cols:
                if col not in existing:
                    conn.execute(
                        f"ALTER TABLE {table} ADD COLUMN {col} TEXT")
        seed_insurers(conn)
        seed_users(conn)
        if needs_migration:
            migrate_insurance_rows(conn)
        conn.commit()
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Initialized database at {DB_PATH}")
