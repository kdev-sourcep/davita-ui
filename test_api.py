"""Tests for the DAVITA REST API — CRUD, validation, FK protection."""

import pytest

import db
from api import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Fresh SQLite DB per test; Flask test client authed as admin."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    with app.test_client() as c:
        r = c.post("/api/auth/login",
                   json={"username": "admin", "password": "davita"})
        c.environ_base["HTTP_AUTHORIZATION"] = \
            f"Bearer {r.get_json()['token']}"
        yield c


def login_as(client, username, password):
    r = client.post("/api/auth/login",
                    json={"username": username, "password": password})
    assert r.status_code == 200
    return r.get_json()["token"]


def make_user(client, **over):
    body = {"username": "staff1", "password": "secret6", "role": "viewer"}
    body.update(over)
    return client.post("/api/users", json=body)


def make_physician(client, **over):
    body = {"first_name": "Jane", "last_name": "Smith", "npi": "1234567890",
            "specialty": "Nephrology"}
    body.update(over)
    return client.post("/api/physicians", json=body)


def make_facility(client, **over):
    body = {"facility_name": "Denver Dialysis", "ccn": "012345",
            "facility_type": "Dialysis Clinic", "station_count": 20}
    body.update(over)
    return client.post("/api/facilities", json=body)


def make_coverage(client, pid=1, **over):
    body = {"priority": 1, "payer_code": "aetna", "policy_no": "W123456789",
            "subscriber_rel": "Self", "group_no": "GRP-100",
            "effective_date": "2026-01-01"}
    body.update(over)
    return client.post(f"/api/patients/{pid}/insurance", json=body)


def make_patient(client, **over):
    body = {"first_name": "John", "last_name": "Doe", "gender": "Male",
            "date_of_birth": "1980-05-15", "zip": "80202",
            "email": "john@example.com"}
    body.update(over)
    return client.post("/api/patients", json=body)


# ----------------------------- CRUD -----------------------------
class TestCrud:
    def test_create_and_read_patient(self, client):
        r = make_patient(client)
        assert r.status_code == 201
        created = r.get_json()
        assert created["id"] == 1
        assert created["first_name"] == "John"
        assert created["created_at"]  # read-back verification

        r = client.get("/api/patients/1")
        assert r.status_code == 200
        assert r.get_json()["last_name"] == "Doe"

        r = client.get("/api/patients")
        assert len(r.get_json()) == 1

    def test_create_physician_and_facility(self, client):
        assert make_physician(client).status_code == 201
        assert make_facility(client).status_code == 201

    def test_update_patient(self, client):
        make_patient(client)
        r = client.put("/api/patients/1", json={
            "first_name": "John", "last_name": "Doe",
            "phone": "303-555-0100", "city": "Denver"})
        assert r.status_code == 200
        assert r.get_json()["phone"] == "303-555-0100"
        assert r.get_json()["city"] == "Denver"

    def test_delete_patient(self, client):
        make_patient(client)
        r = client.delete("/api/patients/1")
        assert r.status_code == 200
        assert r.get_json()["deleted"] is True
        assert client.get("/api/patients/1").status_code == 404

    def test_missing_record_404(self, client):
        assert client.get("/api/patients/99").status_code == 404
        assert client.put("/api/patients/99", json={}).status_code == 404
        assert client.delete("/api/patients/99").status_code == 404

    def test_unknown_entity_404(self, client):
        assert client.get("/api/aliens").status_code == 404

    def test_mrn_auto_generated(self, client):
        r = make_patient(client)  # no mrn supplied
        assert r.status_code == 201
        assert r.get_json()["mrn"] == "DAV-000001"

    def test_mrn_unique(self, client):
        r = make_patient(client, mrn="EXT-123")
        assert r.status_code == 201
        r = make_patient(client, mrn="EXT-123")
        assert r.status_code == 409

    def test_mrn_immutable(self, client):
        make_patient(client)
        r = client.put("/api/patients/1", json={
            "first_name": "John", "last_name": "Doe", "mrn": "CHANGED"})
        assert r.status_code == 400
        assert any("mrn" in e for e in r.get_json()["errors"])

    def test_mrn_preserved_when_omitted(self, client):
        make_patient(client)
        r = client.put("/api/patients/1", json={
            "first_name": "John", "last_name": "Doe", "city": "Denver"})
        assert r.status_code == 200
        assert r.get_json()["mrn"] == "DAV-000001"

    def test_mrn_unchanged_on_update(self, client):
        make_patient(client)
        r = client.put("/api/patients/1", json={
            "first_name": "John", "last_name": "Doe", "mrn": "DAV-000001",
            "city": "Denver"})
        assert r.status_code == 200
        assert r.get_json()["mrn"] == "DAV-000001"

    def test_patient_search(self, client):
        make_patient(client, first_name="John", last_name="Doe",
                     mrn="EXT-999")
        make_patient(client, first_name="Alice", last_name="Ng")
        r = client.get("/api/patients?q=doe")
        assert [p["last_name"] for p in r.get_json()] == ["Doe"]
        r = client.get("/api/patients?q=EXT-999")  # search by MRN
        assert len(r.get_json()) == 1
        r = client.get("/api/patients?q=zzz")
        assert r.get_json() == []

    def test_patient_links(self, client):
        make_physician(client)
        make_facility(client)
        r = make_patient(client, physician_id=1, facility_id=1)
        assert r.status_code == 201
        row = r.get_json()
        assert row["physician_id"] == 1 and row["facility_id"] == 1
        # list view resolves names
        listed = client.get("/api/patients").get_json()[0]
        assert listed["physician_name"] == "Smith, Jane"
        assert listed["facility_name"] == "Denver Dialysis"


# --------------------------- validation ---------------------------
class TestValidation:
    def test_required_fields(self, client):
        r = client.post("/api/patients", json={"first_name": "John"})
        assert r.status_code == 400
        assert any("last_name" in e for e in r.get_json()["errors"])

        r = client.post("/api/facilities", json={})
        assert r.status_code == 400

    def test_npi_must_be_10_digits(self, client):
        r = make_physician(client, npi="123")
        assert r.status_code == 400
        r = make_physician(client, npi="1234567890")
        assert r.status_code == 201

    def test_bad_contact_fields(self, client):
        r = make_patient(client, email="not-an-email", zip="123",
                         phone="x")
        assert r.status_code == 400
        errors = " ".join(r.get_json()["errors"])
        assert "email" in errors and "zip" in errors and "phone" in errors

    def test_bad_ccn(self, client):
        r = make_facility(client, ccn="123")  # must be 6 chars
        assert r.status_code == 400

    def test_bad_date(self, client):
        r = make_patient(client, date_of_birth="May 5 1980")
        assert r.status_code == 400

    def test_bad_station_count(self, client):
        r = make_facility(client, station_count=-3)
        assert r.status_code == 400

    def test_linked_record_must_exist(self, client):
        r = make_patient(client, physician_id=999)
        assert r.status_code == 400
        assert any("physician" in e for e in r.get_json()["errors"])

    def test_empty_strings_become_null(self, client):
        r = make_patient(client, email="", phone="")
        assert r.status_code == 201
        row = r.get_json()
        assert row["email"] is None and row["phone"] is None


# ------------------------- FK protection -------------------------
class TestForeignKeys:
    def test_cannot_delete_linked_physician(self, client):
        make_physician(client)
        make_patient(client, physician_id=1)
        r = client.delete("/api/physicians/1")
        assert r.status_code == 409

    def test_cannot_delete_linked_facility(self, client):
        make_facility(client)
        make_patient(client, facility_id=1)
        r = client.delete("/api/facilities/1")
        assert r.status_code == 409

    def test_can_delete_unlinked(self, client):
        make_physician(client)
        r = client.delete("/api/physicians/1")
        assert r.status_code == 200


# ------------------------- menu options -------------------------
class TestMenuOptions:
    def test_options_endpoint(self, client):
        r = client.get("/api/options")
        assert r.status_code == 200
        data = r.get_json()
        assert len(data["race_options"]) == 8
        assert len(data["facility_type_options"]) == 11
        assert len(data["insurance_options"]) == 13
        assert data["primary_language_featured"][0]["label"] == "English"
        assert any(o["code"] == "ase"
                   for o in data["primary_language_alphabetical"])

    def test_code_normalizes_label(self, client):
        # Label is overwritten by the canonical label for the given code.
        r = make_patient(client, primary_language="Espanol",
                         primary_language_code="es")
        assert r.status_code == 201
        assert r.get_json()["primary_language"] == "Spanish"

    def test_codes_stored_with_labels(self, client):
        r = make_patient(client, race="White", race_code="2106-3",
                         ethnicity="Hispanic or Latino",
                         ethnicity_code="2135-2")
        assert r.status_code == 201
        row = r.get_json()
        assert row["race"] == "White" and row["race_code"] == "2106-3"
        assert row["ethnicity_code"] == "2135-2"

    def test_invalid_code_rejected(self, client):
        r = make_patient(client, race_code="bogus")
        assert r.status_code == 400
        assert any("race_code" in e for e in r.get_json()["errors"])

    def test_label_only_is_allowed(self, client):
        # Free-text label without a code is stored as-is.
        r = make_patient(client, race="Custom Race")
        assert r.status_code == 201
        assert r.get_json()["race"] == "Custom Race"


# ---------------------- insurance coverage ----------------------
class TestCoverage:
    def test_create_and_read_coverage(self, client):
        make_patient(client)
        r = make_coverage(client)
        assert r.status_code == 201
        cov = r.get_json()
        assert cov["patient_id"] == 1
        assert cov["payer"] == "Aetna"  # label normalized from code
        assert cov["priority"] == 1

        listed = client.get("/api/patients/1/insurance").get_json()
        assert len(listed) == 1

    def test_coverage_requires_patient(self, client):
        r = make_coverage(client, pid=999)
        assert r.status_code == 404

    def test_multiple_priorities(self, client):
        make_patient(client)
        assert make_coverage(client).status_code == 201
        r = make_coverage(client, priority=2, payer_code="medicaid",
                          policy_no="MCD-777")
        assert r.status_code == 201

    def test_duplicate_priority_rejected(self, client):
        make_patient(client)
        make_coverage(client)
        r = make_coverage(client, priority=1, payer_code="cigna",
                          policy_no="CIG-1")
        assert r.status_code == 400
        assert any("priority" in e for e in r.get_json()["errors"])

    def test_update_and_delete_coverage(self, client):
        make_patient(client)
        make_coverage(client)
        r = client.put("/api/patients/1/insurance/1",
                       json={"priority": 2, "payer_code": "medicaid",
                             "policy_no": "MCD-1", "group_no": "G2"})
        assert r.status_code == 200
        assert r.get_json()["priority"] == 2
        assert r.get_json()["payer"] == "Medicaid / State Managed Care"

        r = client.delete("/api/patients/1/insurance/1")
        assert r.status_code == 200
        assert client.get("/api/patients/1/insurance/1").status_code == 404

    def test_medicare_mbi_normalized(self, client):
        make_patient(client)
        r = make_coverage(client, payer_code="medicare_original",
                          policy_no="1eg4-te5-mk73")
        assert r.status_code == 201
        assert r.get_json()["policy_no"] == "1EG4-TE5-MK73"

    def test_medicare_bad_mbi_rejected(self, client):
        make_patient(client)
        r = make_coverage(client, payer_code="medicare_advantage",
                          policy_no="ABC")
        assert r.status_code == 400
        assert any("policy_number" in e for e in r.get_json()["errors"])

    def test_policy_required_for_payer(self, client):
        make_patient(client)
        r = make_coverage(client, policy_no=None)
        assert r.status_code == 400
        assert any("policy_number" in e for e in r.get_json()["errors"])

    def test_self_pay_clears_policy(self, client):
        make_patient(client)
        r = make_coverage(client, payer_code="self_pay")
        assert r.status_code == 201
        assert r.get_json()["policy_no"] is None

    def test_other_payer_requires_name(self, client):
        make_patient(client)
        r = make_coverage(client, payer_code="other", policy_no="X1")
        assert r.status_code == 400
        assert any("payer_other" in e for e in r.get_json()["errors"])

        r = make_coverage(client, payer_code="other",
                          payer_other="Acme Health Plan", policy_no="X1")
        assert r.status_code == 201
        assert r.get_json()["payer_other"] == "Acme Health Plan"

    def test_bad_subscriber_rel(self, client):
        make_patient(client)
        r = make_coverage(client, subscriber_rel="Cousin")
        assert r.status_code == 400
        assert any("subscriber_rel" in e for e in r.get_json()["errors"])

    def test_bad_dates(self, client):
        make_patient(client)
        r = make_coverage(client, effective_date="Jan 1 2026")
        assert r.status_code == 400
        r = make_coverage(client, effective_date="2026-06-01",
                          termination_date="2026-01-01")
        assert r.status_code == 400

    def test_insurers_seeded_and_listed(self, client):
        rows = client.get("/api/insurers").get_json()
        codes = {r["payer_code"] for r in rows}
        assert {"aetna", "medicare_original", "self_pay"} <= codes

    def test_insurer_crud_and_uniqueness(self, client):
        r = client.post("/api/insurers",
                        json={"payer_name": "Test Payer", "payer_id": "TPI01"})
        assert r.status_code == 201
        assert client.post(
            "/api/insurers",
            json={"payer_name": "Test Payer"}).status_code == 409

    def test_normalized_model_fields(self, client):
        make_patient(client)
        ins = next(r for r in client.get("/api/insurers").get_json()
                   if r["payer_code"] == "aetna")
        r = client.post("/api/patients/1/insurance", json={
            "insurer_id": ins["id"], "priority_order": 1,
            "policy_number": "W999", "group_number": "G1",
            "plan_type": "PPO", "copay_primary_care": 25,
            "copay_specialist": 50.5, "is_verified": True,
            "verification_date": "2026-10-01",
            "effective_date": "2026-01-01"})
        assert r.status_code == 201
        cov = r.get_json()
        assert cov["payer_name"] == "Aetna"
        assert cov["insurer_id"] == ins["id"]
        assert cov["plan_type"] == "PPO"
        assert cov["copay_primary_care"] == 25.0
        assert cov["copay_specialist"] == 50.5
        assert cov["is_verified"] is True
        assert cov["verification_date"] == "2026-10-01"

    def test_bad_plan_type(self, client):
        make_patient(client)
        r = make_coverage(client, plan_type="XYZ")
        assert r.status_code == 400
        assert any("plan_type" in e for e in r.get_json()["errors"])

    def test_bad_copay(self, client):
        make_patient(client)
        r = make_coverage(client, copay_primary_care=-5)
        assert r.status_code == 400
        assert any("copay" in e for e in r.get_json()["errors"])

    def test_all_insurance_lists_across_patients(self, client):
        make_patient(client)
        make_coverage(client)
        rows = client.get("/api/insurance").get_json()
        assert len(rows) == 1
        assert rows[0]["payer"] == "Aetna"
        assert rows[0]["mrn"] == "DAV-000001"
        assert rows[0]["last_name"] == "Doe"

    def test_patient_delete_cascades(self, client):
        make_patient(client)
        make_coverage(client)
        client.delete("/api/patients/1")
        # patient row gone; coverage row must be gone too
        import db as dbmod
        conn = dbmod.get_connection()
        n = conn.execute("SELECT COUNT(*) FROM patient_insurance").fetchone()[0]
        conn.close()
        assert n == 0

    def test_patient_list_shows_primary_payer(self, client):
        make_patient(client)
        make_coverage(client)
        row = client.get("/api/patients").get_json()[0]
        assert row["primary_payer"] == "Aetna"


# ---------------------------- summary ----------------------------
def test_summary(client):
    make_physician(client)
    make_facility(client)
    make_patient(client)
    r = client.get("/api/summary")
    assert r.status_code == 200
    data = r.get_json()
    assert data["patients"] == 1
    assert data["physicians"] == 1
    assert data["facilities"] == 1
    assert data["coverages"] == 0
    assert data["insurers"] > 0
    assert data["recent_patients"][0]["last_name"] == "Doe"


# ------------------- duplicates / audit / treatments -------------------
class TestDuplicatePatient:
    def test_duplicate_name_dob_rejected(self, client):
        make_patient(client)
        r = client.post("/api/patients", json={
            "first_name": "john", "last_name": "DOE",
            "date_of_birth": "1980-05-15"})
        assert r.status_code == 409
        data = r.get_json()
        assert data["duplicate_of"]["id"] == 1
        assert data["duplicate_of"]["mrn"].startswith("DAV-")
        assert "duplicate" in data["errors"][0].lower()

    def test_allow_duplicate_override(self, client):
        make_patient(client)
        r = client.post("/api/patients", json={
            "first_name": "John", "last_name": "Doe",
            "date_of_birth": "1980-05-15", "allow_duplicate": True})
        assert r.status_code == 201
        assert r.get_json()["id"] == 2

    def test_same_name_different_dob_ok(self, client):
        make_patient(client)
        r = client.post("/api/patients", json={
            "first_name": "John", "last_name": "Doe",
            "date_of_birth": "1990-01-01"})
        assert r.status_code == 201

    def test_update_not_flagged(self, client):
        make_patient(client)
        r = client.put("/api/patients/1", json={
            "first_name": "John", "last_name": "Doe",
            "date_of_birth": "1980-05-15", "phone": "303-555-0100"})
        assert r.status_code == 200


class TestAuditTimestamps:
    def test_updated_at_changes_on_update(self, client):
        make_patient(client)
        before = client.get("/api/patients/1").get_json()
        assert before.get("created_at")
        assert before.get("updated_at")
        client.put("/api/patients/1", json={
            "first_name": "John", "last_name": "Doe",
            "date_of_birth": "1980-05-15", "phone": "303-555-1234"})
        after = client.get("/api/patients/1").get_json()
        assert after["updated_at"] >= before["updated_at"]

    def test_updated_at_on_other_entities(self, client):
        make_facility(client)
        f = client.get("/api/facilities/1").get_json()
        assert f.get("updated_at")
        r = client.put("/api/facilities/1", json={
            "facility_name": "Denver Dialysis", "station_count": 30})
        assert r.status_code == 200
        assert client.get("/api/facilities/1") \
            .get_json()["updated_at"] >= f["updated_at"]


class TestTreatments:
    def test_create_and_read(self, client):
        make_patient(client)
        make_facility(client)
        r = client.post("/api/treatments", json={
            "patient_id": 1, "facility_id": 1,
            "treatment_date": "2026-03-01",
            "modality": "In-Center Hemodialysis",
            "duration_minutes": 240})
        assert r.status_code == 201
        lst = client.get("/api/treatments").get_json()
        assert len(lst) == 1
        assert lst[0]["patient_name"] == "Doe, John"
        assert lst[0]["facility_name"] == "Denver Dialysis"
        assert lst[0]["mrn"].startswith("DAV-")

    def test_update_and_delete(self, client):
        make_patient(client)
        make_facility(client)
        client.post("/api/treatments", json={
            "patient_id": 1, "facility_id": 1,
            "treatment_date": "2026-03-01"})
        r = client.put("/api/treatments/1", json={
            "patient_id": 1, "facility_id": 1,
            "treatment_date": "2026-03-01",
            "duration_minutes": 210, "notes": "uneventful"})
        assert r.status_code == 200
        t = r.get_json()
        assert t["duration_minutes"] == 210
        assert t["notes"] == "uneventful"

        r = client.delete("/api/treatments/1")
        assert r.status_code == 200
        assert r.get_json()["deleted"] is True
        assert client.get("/api/treatments/1").status_code == 404

    def test_patient_fk_required(self, client):
        r = client.post("/api/treatments", json={
            "treatment_date": "2026-03-01"})
        assert r.status_code == 400
        assert any("patient" in e for e in r.get_json()["errors"])

    def test_bad_patient_fk(self, client):
        make_facility(client)
        r = client.post("/api/treatments", json={
            "patient_id": 99, "facility_id": 1,
            "treatment_date": "2026-03-01"})
        assert r.status_code == 400

    def test_bad_modality(self, client):
        make_patient(client)
        make_facility(client)
        r = client.post("/api/treatments", json={
            "patient_id": 1, "facility_id": 1,
            "treatment_date": "2026-03-01",
            "modality": "Teleportation"})
        assert r.status_code == 400
        assert any("modality" in e for e in r.get_json()["errors"])

    def test_bad_duration(self, client):
        make_patient(client)
        make_facility(client)
        r = client.post("/api/treatments", json={
            "patient_id": 1, "facility_id": 1,
            "treatment_date": "2026-03-01",
            "duration_minutes": -5})
        assert r.status_code == 400
        assert any("duration_minutes" in e for e in r.get_json()["errors"])

    def test_cascade_on_patient_delete(self, client):
        make_patient(client)
        make_facility(client)
        client.post("/api/treatments", json={
            "patient_id": 1, "facility_id": 1,
            "treatment_date": "2026-03-01"})
        client.delete("/api/patients/1")
        assert client.get("/api/treatments").get_json() == []

    def test_facility_protected_when_linked(self, client):
        make_patient(client)
        make_facility(client)
        client.post("/api/treatments", json={
            "patient_id": 1, "facility_id": 1,
            "treatment_date": "2026-03-01"})
        r = client.delete("/api/facilities/1")
        assert r.status_code == 409


# ----------------------------- auth / RBAC -----------------------------
class TestAuth:
    def test_no_token_401(self, tmp_path, monkeypatch):
        monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
        db.init_db()
        c = app.test_client()
        assert c.get("/api/patients").status_code == 401
        assert c.post("/api/patients", json={"first_name": "A",
                                             "last_name": "B"}).status_code == 401
        assert c.get("/api/summary").status_code == 401
        assert c.get("/api/options").status_code == 401

    def test_bad_login(self, client):
        r = client.post("/api/auth/login",
                        json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401

    def test_me(self, client):
        r = client.get("/api/auth/me")
        assert r.status_code == 200
        assert r.get_json()["user"]["username"] == "admin"
        assert r.get_json()["user"]["role"] == "admin"

    def test_viewer_read_only(self, client):
        make_user(client)  # viewer
        c = app.test_client()
        c.environ_base["HTTP_AUTHORIZATION"] = \
            f"Bearer {login_as(c, 'staff1', 'secret6')}"
        assert c.get("/api/patients").status_code == 200
        r = c.post("/api/patients",
                   json={"first_name": "A", "last_name": "B"})
        assert r.status_code == 403
        assert c.delete("/api/patients/1").status_code == 403

    def test_registrar_writes_but_no_delete(self, client):
        make_user(client, username="reg1", role="registrar")
        c = app.test_client()
        c.environ_base["HTTP_AUTHORIZATION"] = \
            f"Bearer {login_as(c, 'reg1', 'secret6')}"
        r = c.post("/api/patients",
                   json={"first_name": "A", "last_name": "B"})
        assert r.status_code == 201
        assert c.delete("/api/patients/1").status_code == 403

    def test_users_admin_only(self, client):
        make_user(client)  # viewer
        c = app.test_client()
        c.environ_base["HTTP_AUTHORIZATION"] = \
            f"Bearer {login_as(c, 'staff1', 'secret6')}"
        assert c.get("/api/users").status_code == 403
        assert c.post("/api/users", json={
            "username": "x", "password": "secret6"}).status_code == 403

    def test_user_crud(self, client):
        r = make_user(client, username="nurse1", role="registrar")
        assert r.status_code == 201
        uid = r.get_json()["id"]
        assert login_as(app.test_client(), "nurse1", "secret6")

        # weak password rejected
        assert client.put(f"/api/users/{uid}",
                          json={"password": "x"}).status_code == 400
        # role change works
        r = client.put(f"/api/users/{uid}", json={"role": "viewer"})
        assert r.get_json()["role"] == "viewer"

        # cannot delete yourself
        me = client.get("/api/auth/me").get_json()["user"]["id"]
        assert client.delete(f"/api/users/{me}").status_code == 400
        assert client.delete(f"/api/users/{uid}").status_code == 200

    def test_duplicate_username_409(self, client):
        make_user(client)
        assert make_user(client).status_code == 409

    def test_treatments_need_auth(self, tmp_path, monkeypatch):
        monkeypatch.setattr(db, "DB_PATH", tmp_path / "t2.db")
        db.init_db()
        c = app.test_client()
        assert c.get("/api/treatments").status_code == 401


def test_relationships_graph(client):
    make_physician(client)
    make_facility(client)
    make_patient(client, physician_id=1, facility_id=1)
    client.post("/api/treatments", json={
        "patient_id": 1, "facility_id": 1,
        "treatment_date": "2026-03-01"})

    r = client.get("/api/relationships")
    assert r.status_code == 200
    data = r.get_json()
    kinds = {n["id"]: n["kind"] for n in data["nodes"]}
    assert kinds == {"p1": "patient", "ph1": "physician",
                     "f1": "facility"}
    edges = {(l["source"], l["target"], l["type"]) for l in data["links"]}
    assert ("p1", "ph1", "assigned physician") in edges
    assert ("p1", "f1", "registered at") in edges
    assert ("p1", "f1", "treated at") in edges
    assert ("ph1", "f1", "has patients at") in edges


def test_relationships_empty(client):
    data = client.get("/api/relationships").get_json()
    assert data == {"nodes": [], "links": []}


# ------------------------- products & encounters -------------------------
def make_product(client, **over):
    body = {"sku": "TST-001", "product_name": "Test Dialyzer",
            "category": "Dialysis Supply", "unit_of_measure": "unit",
            "unit_cost": 25.0}
    body.update(over)
    return client.post("/api/products", json=body)


def make_encounter(client, **over):
    body = {"patient_id": 1, "physician_id": 1, "facility_id": 1,
            "encounter_date": "2026-11-10 08:30",
            "encounter_type": "In-Center Hemodialysis",
            "status": "Completed", "clinical_notes": "Routine session",
            "products": []}
    body.update(over)
    return client.post("/api/encounters", json=body)


def seed_products(client):
    return client.get("/api/products").get_json()


class TestProducts:
    def test_seed_present(self, client):
        prods = seed_products(client)
        assert len(prods) >= 8
        skus = {p["sku"] for p in prods}
        assert "DIA-HF-180" in skus and "MED-EPO-4K" in skus

    def test_create_and_read(self, client):
        r = make_product(client)
        assert r.status_code == 201
        p = r.get_json()
        assert p["sku"] == "TST-001"
        assert p["is_active"] == 1
        assert p["updated_at"]

    def test_bad_category(self, client):
        r = make_product(client, category="Widget")
        assert r.status_code == 400
        assert any("category" in e for e in r.get_json()["errors"])

    def test_duplicate_sku(self, client):
        make_product(client)
        assert make_product(client).status_code == 409

    def test_negative_cost(self, client):
        r = make_product(client, unit_cost=-1)
        assert r.status_code == 400
        assert any("unit_cost" in e for e in r.get_json()["errors"])

    def test_update_deactivate(self, client):
        pid = make_product(client).get_json()["id"]
        r = client.put(f"/api/products/{pid}", json={
            "sku": "TST-001", "product_name": "Test Dialyzer",
            "category": "Dialysis Supply", "unit_of_measure": "unit",
            "unit_cost": 25.0, "is_active": False})
        assert r.status_code == 200
        assert r.get_json()["is_active"] == 0


class TestEncounters:
    def _seed(self, client):
        make_patient(client)
        make_physician(client)
        make_facility(client)
        return make_product(client).get_json()["id"]

    def test_create_with_products(self, client):
        pid = self._seed(client)
        r = make_encounter(client, products=[
            {"product_id": pid, "quantity": 1, "lot_number": "LOT-A",
             "unit_price_at_time": 25.0},
            {"product_id": pid, "quantity": 2, "lot_number": "LOT-B",
             "unit_price_at_time": 25.0}])
        assert r.status_code == 201
        e = r.get_json()
        assert e["patient_name"] == "Doe, John"
        assert e["physician_name"].startswith("Smith")
        assert e["facility_name"] == "Denver Dialysis"
        assert len(e["products"]) == 2
        assert e["products"][0]["product_name"] == "Test Dialyzer"
        assert e["products"][0]["sku"] == "TST-001"

    def test_patient_nested_list(self, client):
        pid = self._seed(client)
        make_encounter(client, products=[
            {"product_id": pid, "quantity": 3, "lot_number": "L1",
             "unit_price_at_time": 10.0}])
        r = client.get("/api/patients/1/encounters")
        assert r.status_code == 200
        data = r.get_json()
        assert len(data) == 1
        assert data[0]["products"][0]["quantity"] == 3.0
        assert data[0]["products"][0]["sku"] == "TST-001"

    def test_missing_fk(self, client):
        r = client.post("/api/encounters", json={
            "encounter_date": "2026-11-10",
            "encounter_type": "Consultation"})
        assert r.status_code == 400
        errs = " ".join(r.get_json()["errors"])
        assert "patient_id is required" in errs
        assert "physician_id is required" in errs
        assert "facility_id is required" in errs

    def test_bad_fk(self, client):
        self._seed(client)
        pid = 1
        r = make_encounter(client, patient_id=99)
        assert r.status_code == 400
        assert any("patient" in e for e in r.get_json()["errors"])

    def test_bad_type_and_status(self, client):
        self._seed(client)
        pid = 1
        r = make_encounter(client, encounter_type="Warp Drive",
                           status="On fire")
        assert r.status_code == 400
        errs = " ".join(r.get_json()["errors"])
        assert "encounter_type" in errs and "status" in errs

    def test_bad_date(self, client):
        self._seed(client)
        pid = 1
        r = make_encounter(client, encounter_date="tomorrow")
        assert r.status_code == 400

    def test_line_validation(self, client):
        pid = self._seed(client)
        r = make_encounter(client, products=[
            {"product_id": 99, "quantity": 1,
             "unit_price_at_time": 5},
            {"product_id": pid, "quantity": -2,
             "unit_price_at_time": 5},
            {"product_id": pid, "quantity": 1,
             "unit_price_at_time": -5}])
        assert r.status_code == 400
        errs = r.get_json()["errors"]
        assert any("does not exist" in e for e in errs)
        assert any("quantity" in e for e in errs)
        assert any("unit_price_at_time" in e for e in errs)
        # nothing persisted on a failed transaction
        assert client.get("/api/encounters").get_json() == []

    def test_update_replaces_lines(self, client):
        pid = self._seed(client)
        r = make_encounter(client, products=[
            {"product_id": pid, "quantity": 1, "unit_price_at_time": 25.0}])
        eid = r.get_json()["id"]
        r = client.put(f"/api/encounters/{eid}", json={
            "patient_id": 1, "physician_id": 1, "facility_id": 1,
            "encounter_date": "2026-11-11 09:00",
            "encounter_type": "Consultation", "status": "Billed",
            "products": []})
        assert r.status_code == 200
        assert r.get_json()["products"] == []
        assert r.get_json()["status"] == "Billed"

    def test_update_keeps_lines_when_omitted(self, client):
        pid = self._seed(client)
        r = make_encounter(client, products=[
            {"product_id": pid, "quantity": 2, "unit_price_at_time": 25.0}])
        eid = r.get_json()["id"]
        r = client.put(f"/api/encounters/{eid}", json={
            "patient_id": 1, "physician_id": 1, "facility_id": 1,
            "encounter_date": "2026-11-12 07:00",
            "encounter_type": "Lab Review", "status": "Completed"})
        assert r.status_code == 200
        assert len(r.get_json()["products"]) == 1

    def test_delete_cascades_lines(self, client):
        pid = self._seed(client)
        r = make_encounter(client, products=[
            {"product_id": pid, "quantity": 1, "unit_price_at_time": 25.0}])
        eid = r.get_json()["id"]
        assert client.delete(f"/api/encounters/{eid}").status_code == 200
        import sqlite3 as _s
        con = _s.connect(db.DB_PATH)
        assert con.execute(
            "SELECT COUNT(*) FROM encounter_products").fetchone()[0] == 0

    def test_product_delete_blocked_when_linked(self, client):
        pid = self._seed(client)
        make_encounter(client, products=[
            {"product_id": pid, "quantity": 1, "unit_price_at_time": 25.0}])
        assert client.delete(f"/api/products/{pid}").status_code == 409

    def test_cascade_on_patient_delete(self, client):
        self._seed(client)
        make_encounter(client)
        client.delete("/api/patients/1")
        assert client.get("/api/encounters").get_json() == []
