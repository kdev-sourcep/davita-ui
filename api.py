"""DAVITA REST API — CRUD for patients, physicians, facilities.

Run:  python3 api.py        (serves on http://localhost:5000)
"""

import json
import os
import re
import sqlite3
from datetime import date
from functools import wraps
from pathlib import Path

from flask import Flask, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, \
    URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

from db import get_connection, init_db

app = Flask(__name__)
init_db()

MENU_OPTIONS = json.loads(
    (Path(__file__).parent / "menu_options.json").read_text())

# code -> label lookup for each coded patient field
CODE_MAPS = {
    "race_code": {o["code"]: o["label"]
                  for o in MENU_OPTIONS["race_options"]},
    "ethnicity_code": {o["code"]: o["label"]
                       for o in MENU_OPTIONS["ethnicity_options"]},
    "primary_language_code": {
        o["code"]: o["label"]
        for o in (MENU_OPTIONS["primary_language_featured"]
                  + MENU_OPTIONS["primary_language_alphabetical"])
    },
    # insurance options use {value, label} pairs
    "insurance_provider_code": {o["value"]: o["label"]
                                for o in MENU_OPTIONS["insurance_options"]},
}
# which label field each code field normalizes
CODE_LABEL_FIELD = {
    "race_code": "race",
    "ethnicity_code": "ethnicity",
    "primary_language_code": "primary_language",
    "insurance_provider_code": "insurance_provider",
}


# --------------------------- CORS ---------------------------
# Locked to the Angular dev origin; override with DAVITA_ORIGIN for others.
ALLOWED_ORIGIN = os.environ.get("DAVITA_ORIGIN", "http://localhost:4200")


@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    resp.headers["Access-Control-Allow-Headers"] = \
        "Content-Type, Authorization"
    resp.headers["Access-Control-Allow-Methods"] = \
        "GET, POST, PUT, DELETE, OPTIONS"
    return resp


# --------------------------- auth / RBAC ---------------------------
# Roles: viewer (read-only) < registrar (read + write) < admin (full).
ROLE_RANK = {"viewer": 0, "registrar": 1, "admin": 2}
TOKEN_TTL = 24 * 3600  # signed tokens expire after 24 h

# Dev default — set DAVITA_SECRET_KEY in real deployments.
_serializer = URLSafeTimedSerializer(
    os.environ.get("DAVITA_SECRET_KEY", "davita-dev-secret"),
    salt="davita-auth")


def current_user():
    """Authenticated user dict {id, username, role} or None.

    Deliberately parsed on every call — Flask's `g` is application-context
    scoped, and test clients (or a long-lived context) can serve several
    requests with different credentials under one context. HMAC verification
    plus a SELECT is cheap, so there's no need to cache.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        uid = _serializer.loads(auth[7:], max_age=TOKEN_TTL).get("uid")
    except (BadSignature, SignatureExpired):
        return None
    if not uid:
        return None
    row = conn().execute(
        "SELECT id, username, role FROM users WHERE id = ?",
        (uid,)).fetchone()
    return dict(row) if row else None


def auth_error(min_role):
    """Returns a 401/403 response if the caller lacks min_role, else None."""
    if request.method == "OPTIONS":
        return None  # CORS preflight
    u = current_user()
    if u is None:
        return jsonify({"errors": ["authentication required"]}), 401
    if ROLE_RANK.get(u["role"], -1) < ROLE_RANK[min_role]:
        return jsonify({"errors": [
            f"'{min_role}' role required — you are '{u['role']}'"]}), 403
    return None


def require_role(min_role):
    """Decorator form of auth_error for dedicated routes."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            err = auth_error(min_role)
            if err is not None:
                return err
            return fn(*args, **kwargs)
        return wrapper
    return deco


# --------------------------- auth routes ---------------------------
@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    row = conn().execute(
        "SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if row is None or not check_password_hash(
            row["password_hash"], data.get("password") or ""):
        return jsonify({"errors": ["invalid username or password"]}), 401
    token = _serializer.dumps({"uid": row["id"]})
    return jsonify({"token": token,
                    "user": {"id": row["id"], "username": row["username"],
                             "role": row["role"]}})


@app.get("/api/auth/me")
def me():
    u = current_user()
    if u is None:
        return jsonify({"errors": ["authentication required"]}), 401
    return jsonify({"user": u})


# --------------------------- user admin (admin only) ---------------------------
@app.route("/api/users", methods=["GET", "POST", "OPTIONS"])
def users_collection():
    if request.method == "OPTIONS":
        return "", 204
    err = auth_error("admin")
    if err is not None:
        return err
    if request.method == "GET":
        rows = conn().execute(
            "SELECT id, username, role, created_at, updated_at "
            "FROM users ORDER BY username").fetchall()
        return jsonify([dict(r) for r in rows])

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = data.get("role") or "viewer"
    errors = []
    if not re.fullmatch(r"[A-Za-z0-9_.\-]{3,40}", username):
        errors.append("username: 3-40 chars (letters, digits, _ . -)")
    if len(password) < 6:
        errors.append("password: at least 6 characters")
    if role not in ROLE_RANK:
        errors.append(f"role must be one of {sorted(ROLE_RANK)}")
    if errors:
        return jsonify({"errors": errors}), 400
    try:
        cur = conn().execute(
            "INSERT INTO users (username, password_hash, role) "
            "VALUES (?, ?, ?)",
            (username, generate_password_hash(password), role))
        conn().commit()
    except sqlite3.IntegrityError:
        conn().rollback()
        return jsonify({"errors": ["username already exists"]}), 409
    u = conn().execute(
        "SELECT id, username, role FROM users WHERE id = ?",
        (cur.lastrowid,)).fetchone()
    return jsonify(dict(u)), 201


@app.route("/api/users/<int:uid>", methods=["PUT", "DELETE", "OPTIONS"])
def user_record(uid):
    if request.method == "OPTIONS":
        return "", 204
    err = auth_error("admin")
    if err is not None:
        return err
    row = conn().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    if row is None:
        return jsonify({"errors": [f"user {uid} not found"]}), 404

    if request.method == "DELETE":
        if uid == current_user()["id"]:
            return jsonify({"errors": ["cannot delete your own account"]}), 400
        conn().execute("DELETE FROM users WHERE id = ?", (uid,))
        conn().commit()
        return jsonify({"deleted": True, "id": uid})

    data = request.get_json(silent=True) or {}
    sets, params, errors = [], {}, []
    if "role" in data:
        if data["role"] not in ROLE_RANK:
            errors.append(f"role must be one of {sorted(ROLE_RANK)}")
        else:
            sets.append("role = :role")
            params["role"] = data["role"]
    if data.get("password"):
        if len(data["password"]) < 6:
            errors.append("password: at least 6 characters")
        else:
            sets.append("password_hash = :pw")
            params["pw"] = generate_password_hash(data["password"])
    if errors:
        return jsonify({"errors": errors}), 400
    if not sets:
        return jsonify({"errors": ["nothing to update"]}), 400
    params["uid"] = uid
    conn().execute(
        f"UPDATE users SET {', '.join(sets)}, "
        "updated_at = datetime('now') WHERE id = :uid", params)
    conn().commit()
    u = conn().execute(
        "SELECT id, username, role FROM users WHERE id = ?", (uid,)).fetchone()
    return jsonify(dict(u))


@app.teardown_appcontext
def close_conn(_exc):
    conn = g.pop("conn", None)
    if conn is not None:
        conn.close()


def conn() -> sqlite3.Connection:
    if "conn" not in g:
        g.conn = get_connection()
    return g.conn


# --------------------------- validation ---------------------------
def is_phone(v):
    return bool(re.fullmatch(r"[0-9()+.\-\s]{7,25}", str(v).strip()))


def is_email(v):
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", str(v).strip()))


def is_zip(v):
    return bool(re.fullmatch(r"\d{5}(-\d{4})?", str(v).strip()))


def is_npi(v):
    return bool(re.fullmatch(r"\d{10}", str(v).strip()))


def is_ccn(v):
    return bool(re.fullmatch(r"[A-Za-z0-9]{6}", str(v).strip()))


def is_date(v):
    try:
        date.fromisoformat(str(v))
        return True
    except (ValueError, TypeError):
        return False


# CMS Medicare Beneficiary Identifier: 11 chars — digits at 1,4,7,10,11;
# letters (excl. S,L,O,I,B,Z) at 2,5,8,9; alphanumeric at 3,6.
MBI_RE = re.compile(
    r"^[1-9][AC-HJ-KM-NP-RT-Y][AC-HJ-KM-NP-RT-Y0-9]\d"
    r"[AC-HJ-KM-NP-RT-Y][AC-HJ-KM-NP-RT-Y0-9]\d"
    r"[AC-HJ-KM-NP-RT-Y]{2}\d{2}$")

MEDICARE_CODES = {"medicare_original", "medicare_advantage"}


def is_mbi(v) -> bool:
    return bool(MBI_RE.fullmatch(str(v)))


ADDRESS_FIELDS = ["address_line1", "address_line2", "city", "state", "zip"]
CONTACT_FIELDS = ["phone", "email"]

FIELD_CHECKS = {
    "phone": (is_phone, "phone format is invalid"),
    "fax": (is_phone, "fax format is invalid"),
    "email": (is_email, "email format is invalid"),
    "zip": (is_zip, "zip must be 5 digits or ZIP+4"),
    "postal_code": (is_zip, "postal_code must be 5 digits or ZIP+4"),
    "npi": (is_npi, "NPI must be exactly 10 digits"),
    "ccn": (is_ccn, "CCN must be exactly 6 letters/digits"),
    "date_of_birth": (is_date, "date_of_birth must be YYYY-MM-DD"),
    "treatment_date": (is_date, "treatment_date must be YYYY-MM-DD"),
}

ENTITIES = {
    "patients": {
        "table": "patients",
        "label": "Patient",
        "required": ["first_name", "last_name"],
        "fields": [
            "mrn", "first_name", "last_name", "date_of_birth", "gender",
            "race", "race_code", "ethnicity", "ethnicity_code",
            "primary_language", "primary_language_code",
            "physician_id", "facility_id",
        ] + CONTACT_FIELDS + ADDRESS_FIELDS,
        "list_sql": """
            SELECT p.*,
                   (ph.last_name || ', ' || ph.first_name) AS physician_name,
                   f.facility_name,
                   ins.payer_name AS primary_payer
            FROM patients p
            LEFT JOIN physicians ph ON ph.id = p.physician_id
            LEFT JOIN facilities f ON f.id = p.facility_id
            LEFT JOIN patient_insurance pi
                   ON pi.patient_id = p.id AND pi.priority_order = 1
            LEFT JOIN insurance_policies ip ON ip.id = pi.policy_id
            LEFT JOIN insurers ins ON ins.id = ip.insurer_id
            ORDER BY p.id DESC
        """,
        "linked_msg": "patient",
        "unique_msg": "mrn already exists — must be unique",
    },
    "physicians": {
        "table": "physicians",
        "label": "Physician",
        "required": ["first_name", "last_name"],
        "fields": ["first_name", "last_name", "npi", "specialty",
                   "license_number"] + CONTACT_FIELDS + ADDRESS_FIELDS,
        "list_sql": "SELECT * FROM physicians ORDER BY id DESC",
        "linked_msg": "physician",
    },
    "facilities": {
        "table": "facilities",
        "label": "Facility",
        "required": ["facility_name"],
        "fields": ["facility_name", "ccn", "facility_type", "fax",
                   "station_count"] + CONTACT_FIELDS + ADDRESS_FIELDS,
        "list_sql": "SELECT * FROM facilities ORDER BY id DESC",
        "linked_msg": "facility",
    },
    "insurers": {
        "table": "insurers",
        "label": "Insurer",
        "required": ["payer_name"],
        "fields": ["payer_name", "payer_code", "payer_id", "phone_support",
                   "address_line1", "address_line2", "city", "state",
                   "postal_code"],
        "list_sql": "SELECT * FROM insurers ORDER BY payer_name",
        "linked_msg": "insurer",
        "linked_to": "insurance policy",
        "unique_msg": "payer_name already exists — must be unique",
    },
    "treatments": {
        "table": "treatments",
        "label": "Treatment",
        "required": ["patient_id", "facility_id", "treatment_date"],
        "fields": ["patient_id", "facility_id", "treatment_date",
                   "modality", "duration_minutes", "notes"],
        "list_sql": """
            SELECT t.*,
                   (p.last_name || ', ' || p.first_name) AS patient_name,
                   p.mrn,
                   f.facility_name
            FROM treatments t
            JOIN patients p ON p.id = t.patient_id
            JOIN facilities f ON f.id = t.facility_id
            ORDER BY t.treatment_date DESC, t.id DESC
        """,
        "linked_msg": "treatment",
    },
}


def clean_payload(cfg: dict, data: dict):
    """Validate request JSON. Returns (values, errors)."""
    errors = []
    values = {}
    for field in cfg["fields"]:
        v = data.get(field)
        if isinstance(v, str):
            v = v.strip()
        if v == "":
            v = None
        if v is not None and field in FIELD_CHECKS:
            check, msg = FIELD_CHECKS[field]
            if not check(v):
                errors.append(f"{field}: {msg}")
        if field in ("station_count", "duration_minutes") and v is not None:
            try:
                v = int(v)
                if v < 0:
                    raise ValueError
            except (TypeError, ValueError):
                errors.append(
                    f"{field} must be a non-negative integer")
                continue
        values[field] = v

    for field in cfg["required"]:
        if not values.get(field):
            errors.append(f"{field} is required")

    # Coded fields: code must be a known menu code; when valid, the label
    # is normalized to the canonical menu label so code/label never diverge.
    for code_field, code_map in CODE_MAPS.items():
        if code_field in values:
            code = values.get(code_field)
            if code is not None:
                if code not in code_map:
                    errors.append(f"{code_field}: unknown code '{code}'")
                else:
                    values[CODE_LABEL_FIELD[code_field]] = code_map[code]

    # Referenced records must exist.
    for fk, table, label in (
        ("physician_id", "physicians", "physician"),
        ("facility_id", "facilities", "facility"),
        ("patient_id", "patients", "patient"),
    ):
        if fk in values and values[fk] is not None:
            try:
                values[fk] = int(values[fk])
            except (TypeError, ValueError):
                errors.append(f"{fk} must be an integer")
                continue
            row = conn().execute(
                f"SELECT 1 FROM {table} WHERE id = ?",
                (values[fk],)).fetchone()
            if not row:
                errors.append(f"linked {label} (id {values[fk]}) does not exist")

    return values, errors


def row_or_none(table: str, rec_id: int):
    row = conn().execute(
        f"SELECT * FROM {table} WHERE id = ?", (rec_id,)).fetchone()
    return dict(row) if row else None


def save(cfg: dict, values: dict, rec_id=None) -> int:
    if rec_id is None:
        cols = ", ".join(values)
        marks = ", ".join(f":{k}" for k in values)
        cur = conn().execute(
            f"INSERT INTO {cfg['table']} ({cols}, updated_at) "
            f"VALUES ({marks}, datetime('now'))", values)
        return cur.lastrowid
    sets = ", ".join(f"{k} = :{k}" for k in values)
    sets += ", updated_at = datetime('now')"
    conn().execute(
        f"UPDATE {cfg['table']} SET {sets} WHERE id = :id",
        {**values, "id": rec_id})
    return rec_id


# --------------------- insurance coverage ----------------------
RELATIONSHIPS = set(MENU_OPTIONS["subscriber_relationship_options"])
PLAN_TYPES = set(MENU_OPTIONS.get("plan_type_options", []))

JUNCTION_FIELDS = [
    "priority_order", "subscriber_rel", "subscriber_first_name",
    "subscriber_last_name", "subscriber_dob", "copay_primary_care",
    "copay_specialist", "is_verified", "verification_date",
]
POLICY_FIELDS = [
    "insurer_id", "policy_number", "group_number", "plan_type",
    "effective_date", "termination_date",
]


def clean_coverage(data: dict):
    """Validate a coverage payload. Returns (junction, policy, errors).

    The junction holds patient_insurance fields; policy holds
    insurance_policies fields (insurer_id resolved from insurer_id or
    payer_code). Legacy flat field names are accepted as aliases.
    """
    errors = []
    d = dict(data)
    # Legacy aliases accepted from older clients.
    for old, new in (("priority", "priority_order"),
                     ("policy_no", "policy_number"),
                     ("group_no", "group_number")):
        if d.get(new) in (None, "") and d.get(old) not in (None, ""):
            d[new] = d[old]
    if (d.get("subscriber_name")
            and not d.get("subscriber_first_name")
            and not d.get("subscriber_last_name")):
        first, _, last = str(d["subscriber_name"]).partition(" ")
        d["subscriber_first_name"] = first or None
        d["subscriber_last_name"] = last or None

    def norm(v):
        if isinstance(v, str):
            v = v.strip()
        return v if v != "" else None

    junction = {f: norm(d.get(f)) for f in JUNCTION_FIELDS}
    policy = {f: norm(d.get(f)) for f in POLICY_FIELDS}

    # ---- resolve insurer ----
    payer_code = norm(d.get("payer_code"))
    payer_other = norm(d.get("payer_other"))
    insurer_id = norm(d.get("insurer_id"))
    insurer = None
    if insurer_id is not None:
        try:
            insurer_id = int(insurer_id)
        except (TypeError, ValueError):
            errors.append("insurer_id must be an integer")
            insurer_id = None
        else:
            insurer = conn().execute(
                "SELECT * FROM insurers WHERE id = ?",
                (insurer_id,)).fetchone()
            if insurer is None:
                errors.append(f"insurer (id {insurer_id}) does not exist")
    elif payer_code:
        if payer_code not in CODE_MAPS["insurance_provider_code"]:
            errors.append(f"payer_code: unknown code '{payer_code}'")
        elif payer_code == "other":
            # "Other" means the payer isn't in the master list — create it.
            if not payer_other:
                errors.append("payer_other is required when payer is "
                              "'Other / Not Listed'")
            else:
                insurer = conn().execute(
                    "SELECT * FROM insurers WHERE payer_name = ?",
                    (payer_other,)).fetchone()
                insurer_id = (insurer["id"] if insurer else conn().execute(
                    "INSERT INTO insurers (payer_name) VALUES (?)",
                    (payer_other,)).lastrowid)
        else:
            insurer = conn().execute(
                "SELECT * FROM insurers WHERE payer_code = ?",
                (payer_code,)).fetchone()
            insurer_id = (insurer["id"] if insurer else conn().execute(
                "INSERT INTO insurers (payer_name, payer_code) VALUES (?, ?)",
                (CODE_MAPS["insurance_provider_code"][payer_code],
                 payer_code)).lastrowid)
    else:
        errors.append("insurer_id or payer_code is required")

    if insurer_id is not None and payer_code is None:
        row = insurer or conn().execute(
            "SELECT * FROM insurers WHERE id = ?",
            (insurer_id,)).fetchone()
        payer_code = row["payer_code"] if row else None
    policy["insurer_id"] = insurer_id

    # ---- priority ----
    try:
        junction["priority_order"] = int(junction["priority_order"]) \
            if junction["priority_order"] is not None else None
    except (TypeError, ValueError):
        junction["priority_order"] = None
    if junction["priority_order"] not in (1, 2, 3):
        errors.append("priority_order must be 1 (primary), 2 (secondary), "
                      "or 3 (tertiary)")

    # ---- policy number / MBI ----
    if payer_code == "self_pay":
        policy["policy_number"] = None
    elif payer_code and not policy.get("policy_number"):
        errors.append("policy_number is required for the selected payer")
    elif payer_code in MEDICARE_CODES and policy.get("policy_number"):
        mbi = re.sub(r"[\s\-]", "", policy["policy_number"]).upper()
        if not is_mbi(mbi):
            errors.append("policy_number: invalid MBI — expected format "
                          "like 1EG4-TE5-MK73")
        else:
            policy["policy_number"] = f"{mbi[:4]}-{mbi[4:7]}-{mbi[7:]}"

    # ---- plan type ----
    if policy["plan_type"] and PLAN_TYPES \
            and policy["plan_type"] not in PLAN_TYPES:
        errors.append(f"plan_type must be one of {sorted(PLAN_TYPES)}")

    # ---- subscriber ----
    if junction["subscriber_rel"] and \
            junction["subscriber_rel"] not in RELATIONSHIPS:
        errors.append(
            f"subscriber_rel must be one of {sorted(RELATIONSHIPS)}")

    # ---- copays ----
    for f in ("copay_primary_care", "copay_specialist"):
        if junction[f] is not None:
            try:
                junction[f] = float(junction[f])
                if junction[f] < 0:
                    raise ValueError
            except (TypeError, ValueError):
                errors.append(f"{f} must be a non-negative number")
                junction[f] = None

    # ---- eligibility verification flag ----
    junction["is_verified"] = 1 if d.get("is_verified") in (
        True, 1, "1", "true", "True", "on") else 0

    # ---- dates ----
    if junction["subscriber_dob"] and not is_date(junction["subscriber_dob"]):
        errors.append("subscriber_dob must be YYYY-MM-DD")
    if junction["verification_date"] and \
            not is_date(str(junction["verification_date"])[:10]):
        errors.append("verification_date must be YYYY-MM-DD")
    for fld in ("effective_date", "termination_date"):
        if policy[fld] and not is_date(policy[fld]):
            errors.append(f"{fld} must be YYYY-MM-DD")
    if (policy["effective_date"] and policy["termination_date"]
            and policy["termination_date"] < policy["effective_date"]):
        errors.append("termination_date is before effective_date")

    return junction, policy, errors


COVERAGE_SELECT = """
    SELECT pi.id, pi.patient_id, pi.policy_id, pi.priority_order,
           pi.subscriber_rel, pi.subscriber_first_name,
           pi.subscriber_last_name, pi.subscriber_dob,
           pi.copay_primary_care, pi.copay_specialist,
           pi.is_verified, pi.verification_date,
           ip.insurer_id, ip.policy_number, ip.group_number,
           ip.plan_type, ip.effective_date, ip.termination_date,
           ins.payer_name, ins.payer_code, ins.payer_id
    FROM patient_insurance pi
    JOIN insurance_policies ip ON ip.id = pi.policy_id
    JOIN insurers ins ON ins.id = ip.insurer_id
"""


def coverage_view(row: sqlite3.Row) -> dict:
    """Joined coverage row with legacy field aliases included."""
    v = dict(row)
    first, last = v["subscriber_first_name"], v["subscriber_last_name"]
    # Legacy aliases kept so older clients/tests keep working.
    v["payer"] = v["payer_name"]
    v["priority"] = v["priority_order"]
    v["policy_no"] = v["policy_number"]
    v["group_no"] = v["group_number"]
    v["subscriber_name"] = " ".join(
        p for p in (first, last) if p) or None
    v["payer_other"] = v["payer_name"] \
        if v["payer_code"] == "other" or v["payer_code"] is None else None
    v["is_verified"] = bool(v["is_verified"])
    return v


def coverage_row(cov_id: int):
    row = conn().execute(
        COVERAGE_SELECT + " WHERE pi.id = ?", (cov_id,)).fetchone()
    return coverage_view(row) if row else None


def priority_taken(patient_id: int, priority: int, exclude_id=None) -> bool:
    q = ("SELECT 1 FROM patient_insurance "
         "WHERE patient_id = ? AND priority_order = ?")
    args = [patient_id, priority]
    if exclude_id is not None:
        q += " AND id != ?"
        args.append(exclude_id)
    return conn().execute(q, args).fetchone() is not None


# --------------------------- routes ---------------------------
@app.get("/api/options")
@require_role("viewer")
def options():
    return jsonify(MENU_OPTIONS)


@app.get("/api/summary")
@require_role("viewer")
def summary():
    c = conn()
    return jsonify({
        "patients": c.execute("SELECT COUNT(*) FROM patients").fetchone()[0],
        "physicians": c.execute("SELECT COUNT(*) FROM physicians").fetchone()[0],
        "facilities": c.execute("SELECT COUNT(*) FROM facilities").fetchone()[0],
        "coverages": c.execute(
            "SELECT COUNT(*) FROM patient_insurance").fetchone()[0],
        "insurers": c.execute("SELECT COUNT(*) FROM insurers").fetchone()[0],
        "recent_patients": [
            dict(r) for r in c.execute(
                "SELECT id, first_name, last_name, created_at "
                "FROM patients ORDER BY id DESC LIMIT 5").fetchall()
        ],
    })


@app.get("/api/relationships")
@require_role("viewer")
def relationships():
    """Entity relationship graph: patients ↔ physicians ↔ facilities.

    Direct links come from patient FKs; physician↔facility edges are derived
    from shared patients; treatment sessions add 'treated at' edges.
    """
    c = conn()
    phys = {r["id"]: r for r in c.execute("SELECT * FROM physicians")}
    facs = {r["id"]: r for r in c.execute("SELECT * FROM facilities")}

    nodes, links, seen_nodes, seen_links = [], [], set(), set()

    def node(key, kind, label, sub=""):
        if key not in seen_nodes:
            seen_nodes.add(key)
            nodes.append({"id": key, "kind": kind, "label": label,
                          "sub": sub})

    def link(src, dst, ltype):
        edge = (src, dst, ltype)
        if src in seen_nodes and dst in seen_nodes and edge not in seen_links:
            seen_links.add(edge)
            links.append({"source": src, "target": dst, "type": ltype})

    def fac_node(fid):
        f = facs.get(fid)
        if f:
            loc = ", ".join(x for x in (f["city"], f["state"]) if x)
            node(f"f{fid}", "facility", f["facility_name"], loc)

    def phys_node(phid):
        ph = phys.get(phid)
        if ph:
            node(f"ph{phid}", "physician",
                 f"{ph['last_name']}, {ph['first_name']}",
                 ph["specialty"] or "")

    for p in c.execute("SELECT * FROM patients").fetchall():
        pk = f"p{p['id']}"
        node(pk, "patient", f"{p['last_name']}, {p['first_name']}",
             p["mrn"] or "")
        if p["physician_id"]:
            phys_node(p["physician_id"])
            link(pk, f"ph{p['physician_id']}", "assigned physician")
        if p["facility_id"]:
            fac_node(p["facility_id"])
            link(pk, f"f{p['facility_id']}", "registered at")

    # dialysis sessions: patient treated at facility
    for t in c.execute(
            "SELECT DISTINCT patient_id, facility_id FROM treatments"
            ).fetchall():
        pk, fk = f"p{t['patient_id']}", f"f{t['facility_id']}"
        fac_node(t["facility_id"])
        link(pk, fk, "treated at")

    # physician ↔ facility, derived: this physician has patients there
    for r in c.execute(
            "SELECT DISTINCT physician_id, facility_id FROM patients "
            "WHERE physician_id IS NOT NULL AND facility_id IS NOT NULL"
            ).fetchall():
        phys_node(r["physician_id"])
        fac_node(r["facility_id"])
        link(f"ph{r['physician_id']}", f"f{r['facility_id']}",
             "has patients at")

    return jsonify({"nodes": nodes, "links": links})


@app.route("/api/<entity>", methods=["GET", "POST", "OPTIONS"])
def collection(entity):
    if request.method == "OPTIONS":
        return "", 204  # CORS preflight — headers added by after_request
    err = auth_error("registrar" if request.method == "POST" else "viewer")
    if err is not None:
        return err
    cfg = ENTITIES.get(entity)
    if not cfg:
        return jsonify({"errors": [f"unknown entity '{entity}'"]}), 404

    if request.method == "GET":
        sql = cfg["list_sql"]
        args = {}
        # Patient search: ?q= matches name, MRN, DOB, phone, city.
        if entity == "patients" and request.args.get("q", "").strip():
            args["q"] = f"%{request.args['q'].strip()}%"
            sql = sql.replace(
                "ORDER BY p.id DESC",
                "WHERE p.first_name LIKE :q OR p.last_name LIKE :q OR "
                "p.mrn LIKE :q OR p.date_of_birth LIKE :q OR "
                "p.phone LIKE :q OR p.city LIKE :q "
                "ORDER BY p.id DESC")
        rows = conn().execute(sql, args).fetchall()
        return jsonify([dict(r) for r in rows])

    data = request.get_json(silent=True) or {}
    values, errors = clean_payload(cfg, data)
    if entity == "insurers":
        code = values.get("payer_code")
        if code and code not in CODE_MAPS["insurance_provider_code"]:
            errors.append(f"payer_code: unknown code '{code}'")
    if entity == "treatments":
        mods = set(MENU_OPTIONS.get("modality_options", []))
        if values.get("modality") and mods \
                and values["modality"] not in mods:
            errors.append(f"modality must be one of {sorted(mods)}")
    if errors:
        return jsonify({"errors": errors}), 400

    # Duplicate-patient guard: same name + DOB → likely the same person.
    if cfg["table"] == "patients" and not data.get("allow_duplicate"):
        dup = conn().execute(
            "SELECT id, mrn FROM patients WHERE lower(first_name) = lower(?) "
            "AND lower(last_name) = lower(?) AND date_of_birth IS ?",
            (values["first_name"], values["last_name"],
             values.get("date_of_birth"))).fetchone()
        if dup:
            return jsonify({"errors": [
                f"possible duplicate — {dup['mrn']} (ID {dup['id']}) has "
                "the same name and date of birth; resubmit with "
                "allow_duplicate if this is a different person"],
                "duplicate_of": dict(dup)}), 409

    try:
        new_id = save(cfg, values)
        # MRNs are system-assigned when not supplied: DAV-######.
        if cfg["table"] == "patients" and not values.get("mrn"):
            conn().execute("UPDATE patients SET mrn = ? WHERE id = ?",
                           (f"DAV-{new_id:06d}", new_id))
        conn().commit()
    except sqlite3.IntegrityError:
        conn().rollback()
        return jsonify({"errors": [cfg.get(
            "unique_msg", "a record with these unique fields already "
            "exists")]}), 409
    except sqlite3.Error as e:
        conn().rollback()
        return jsonify({"errors": [f"database error: {e}"]}), 500
    # Read back what was persisted so the client can verify the write.
    return jsonify(row_or_none(cfg["table"], new_id)), 201


@app.route("/api/<entity>/<int:rec_id>",
           methods=["GET", "PUT", "DELETE", "OPTIONS"])
def record(entity, rec_id):
    if request.method == "OPTIONS":
        return "", 204  # CORS preflight — headers added by after_request
    err = auth_error({"GET": "viewer", "PUT": "registrar"}
                     .get(request.method, "admin"))
    if err is not None:
        return err
    cfg = ENTITIES.get(entity)
    if not cfg:
        return jsonify({"errors": [f"unknown entity '{entity}'"]}), 404
    existing = row_or_none(cfg["table"], rec_id)
    if existing is None:
        return jsonify({"errors": [f"{cfg['label']} {rec_id} not found"]}), 404

    if request.method == "GET":
        return jsonify(existing)

    if request.method == "DELETE":
        try:
            conn().execute(
                f"DELETE FROM {cfg['table']} WHERE id = ?", (rec_id,))
            # A deleted patient leaves orphaned policies behind — drop any
            # policy no longer linked to a patient coverage row.
            if cfg["table"] == "patients":
                conn().execute(
                    "DELETE FROM insurance_policies WHERE id NOT IN "
                    "(SELECT policy_id FROM patient_insurance)")
            conn().commit()
        except sqlite3.IntegrityError:
            conn().rollback()
            return jsonify({"errors": [
                f"cannot delete — this {cfg['linked_msg']} is linked to "
                f"{cfg.get('linked_to', 'patient')} records"]}), 409
        return jsonify({"deleted": True, "id": rec_id})

    data = request.get_json(silent=True) or {}
    values, errors = clean_payload(cfg, data)
    if entity == "insurers":
        code = values.get("payer_code")
        if code and code not in CODE_MAPS["insurance_provider_code"]:
            errors.append(f"payer_code: unknown code '{code}'")
    if entity == "treatments":
        mods = set(MENU_OPTIONS.get("modality_options", []))
        if values.get("modality") and mods \
                and values["modality"] not in mods:
            errors.append(f"modality must be one of {sorted(mods)}")
    if cfg["table"] == "patients":
        if values.get("mrn") is None:
            values["mrn"] = existing["mrn"]  # preserve assigned MRN
        elif values["mrn"] != existing["mrn"]:
            errors.append("mrn cannot be changed once assigned")
    if errors:
        return jsonify({"errors": errors}), 400
    try:
        save(cfg, values, rec_id)
        conn().commit()
    except sqlite3.Error as e:
        conn().rollback()
        return jsonify({"errors": [f"database error: {e}"]}), 500
    return jsonify(row_or_none(cfg["table"], rec_id))


# ------------------- insurance coverage routes -------------------
@app.get("/api/insurance")
@require_role("viewer")
def all_insurance():
    """All coverage records across patients, with patient identity."""
    rows = conn().execute(
        COVERAGE_SELECT.replace(
            "ins.payer_name, ins.payer_code, ins.payer_id",
            "ins.payer_name, ins.payer_code, ins.payer_id, "
            "p.first_name, p.last_name, p.mrn") +
        " JOIN patients p ON p.id = pi.patient_id "
        "ORDER BY p.last_name, p.first_name, pi.priority_order").fetchall()
    out = []
    for r in rows:
        v = coverage_view(r)
        v["first_name"], v["last_name"], v["mrn"] = (
            r["first_name"], r["last_name"], r["mrn"])
        out.append(v)
    return jsonify(out)


def insert_policy(policy: dict) -> int:
    cols = ", ".join(policy)
    marks = ", ".join(f":{k}" for k in policy)
    return conn().execute(
        f"INSERT INTO insurance_policies ({cols}) VALUES ({marks})",
        policy).lastrowid


def insert_junction(pid: int, policy_id: int, junction: dict) -> int:
    cols = ", ".join(junction)
    marks = ", ".join(f":{k}" for k in junction)
    return conn().execute(
        f"INSERT INTO patient_insurance (patient_id, policy_id, {cols}) "
        f"VALUES (:pid, :pol, {marks})",
        {**junction, "pid": pid, "pol": policy_id}).lastrowid


def drop_orphan_policies():
    conn().execute(
        "DELETE FROM insurance_policies WHERE id NOT IN "
        "(SELECT policy_id FROM patient_insurance)")


@app.route("/api/patients/<int:pid>/insurance",
           methods=["GET", "POST", "OPTIONS"])
def insurance_collection(pid):
    if request.method == "OPTIONS":
        return "", 204
    err = auth_error("registrar" if request.method == "POST" else "viewer")
    if err is not None:
        return err
    if row_or_none("patients", pid) is None:
        return jsonify({"errors": [f"Patient {pid} not found"]}), 404

    if request.method == "GET":
        rows = conn().execute(
            COVERAGE_SELECT + " WHERE pi.patient_id = ? "
            "ORDER BY pi.priority_order, pi.id", (pid,)).fetchall()
        return jsonify([coverage_view(r) for r in rows])

    junction, policy, errors = clean_coverage(
        request.get_json(silent=True) or {})
    if not errors and priority_taken(pid, junction["priority_order"]):
        errors.append(f"priority {junction['priority_order']} is already "
                      "assigned to another coverage for this patient")
    if errors:
        conn().rollback()
        return jsonify({"errors": errors}), 400
    try:
        policy_id = insert_policy(policy)
        cov_id = insert_junction(pid, policy_id, junction)
        conn().commit()
    except sqlite3.Error as e:
        conn().rollback()
        return jsonify({"errors": [f"database error: {e}"]}), 500
    return jsonify(coverage_row(cov_id)), 201


@app.route("/api/patients/<int:pid>/insurance/<int:iid>",
           methods=["GET", "PUT", "DELETE", "OPTIONS"])
def insurance_record(pid, iid):
    if request.method == "OPTIONS":
        return "", 204
    err = auth_error({"GET": "viewer", "PUT": "registrar"}
                     .get(request.method, "admin"))
    if err is not None:
        return err
    row = conn().execute(
        "SELECT * FROM patient_insurance WHERE id = ? AND patient_id = ?",
        (iid, pid)).fetchone()
    if row is None:
        return jsonify({"errors": ["Coverage not found"]}), 404

    if request.method == "GET":
        return jsonify(coverage_row(iid))

    if request.method == "DELETE":
        conn().execute("DELETE FROM patient_insurance WHERE id = ?", (iid,))
        drop_orphan_policies()
        conn().commit()
        return jsonify({"deleted": True, "id": iid})

    junction, policy, errors = clean_coverage(
        request.get_json(silent=True) or {})
    if not errors and priority_taken(pid, junction["priority_order"],
                                     exclude_id=iid):
        errors.append(f"priority {junction['priority_order']} is already "
                      "assigned to another coverage for this patient")
    if errors:
        conn().rollback()
        return jsonify({"errors": errors}), 400
    try:
        conn().execute(
            "UPDATE insurance_policies SET " +
            ", ".join(f"{k} = :{k}" for k in policy) +
            ", updated_at = datetime('now') WHERE id = :pol",
            {**policy, "pol": row["policy_id"]})
        conn().execute(
            "UPDATE patient_insurance SET " +
            ", ".join(f"{k} = :{k}" for k in junction) +
            ", updated_at = datetime('now') WHERE id = :iid",
            {**junction, "iid": iid})
        conn().commit()
    except sqlite3.Error as e:
        conn().rollback()
        return jsonify({"errors": [f"database error: {e}"]}), 500
    return jsonify(coverage_row(iid))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
