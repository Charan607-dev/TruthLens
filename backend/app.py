import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import ipaddress
import json
import os
import re
import socket
import sqlite3
import sys
import threading
import time
from urllib.parse import urlparse
import uuid

from bs4 import BeautifulSoup
from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import requests

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_BACKEND_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from ml.predict_engine import load_artifact, predict_news
from ml.train_pipeline import load_and_clean_dataset, train_and_evaluate

load_dotenv()

# ================= CONFIGURATION =================
DATA_DIR = os.path.abspath(os.getenv("DATA_DIR", os.path.join(_BACKEND_DIR, "data")))
MODELS_DIR = os.path.abspath(os.getenv("MODELS_DIR", os.path.join(DATA_DIR, "models")))
DATASETS_DIR = os.path.abspath(os.getenv("DATASETS_DIR", os.path.join(DATA_DIR, "datasets")))
DB_PATH = os.path.join(DATA_DIR, "truthlens_flask.db")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(DATASETS_DIR, exist_ok=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

_RAW_JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
if _RAW_JWT_SECRET and _RAW_JWT_SECRET != "change-me-in-production-use-long-random-hex":
    TOKEN_SECRET = _RAW_JWT_SECRET.encode("utf-8")
else:
    TOKEN_SECRET = hashlib.sha256(f"truthlens-flask-{DATA_DIR}".encode("utf-8")).digest()

supabase = None
if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
    try:
        from supabase import create_client
        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    except Exception as exc:
        print(f"[WARN] Supabase client initialization skipped: {exc}")
        supabase = None


# ================= CORS CONFIGURATION =================
def _parse_allowed_origins() -> list[str] | str:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw or raw == "*":
        return "*"
    origins = []
    for item in raw.split(","):
        o = item.strip().rstrip("/")
        if not o:
            continue
        if o == "*":
            return "*"
        if not re.match(r"^https?://", o, re.IGNORECASE):
            o = f"https://{o}"
        origins.append(o)
    return origins or "*"


ALLOWED_ORIGINS = _parse_allowed_origins()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

CORS(
    app,
    resources={r"/*": {"origins": ALLOWED_ORIGINS}},
    allow_headers=["Content-Type", "Authorization", "Accept"],
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    max_age=86400,
)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["240 per minute"],
    storage_uri="memory://",
)

EMAIL_REGEX = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@app.before_request
def handle_cors_preflight():
    if request.method == "OPTIONS":
        resp = app.make_response(("", 204))
        origin = (request.headers.get("Origin") or "").rstrip("/")
        if ALLOWED_ORIGINS == "*":
            resp.headers["Access-Control-Allow-Origin"] = "*"
        elif origin and origin in ALLOWED_ORIGINS:
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Accept"
        resp.headers["Access-Control-Max-Age"] = "86400"
        return resp


# ================= JSON ERROR HANDLERS =================
@app.errorhandler(400)
def err_400(err):
    return jsonify({"error": getattr(err, "description", "Bad request.")}), 400


@app.errorhandler(404)
def err_404(_err):
    return jsonify({
        "error": "Endpoint not found.",
        "service": "TruthLens AI Backend",
        "health": "/health",
    }), 404


@app.errorhandler(405)
def err_405(_err):
    return jsonify({"error": "HTTP method not allowed on this endpoint."}), 405


@app.errorhandler(413)
def err_413(_err):
    return jsonify({"error": "Uploaded file exceeds 16 MB limit."}), 413


@app.errorhandler(429)
def err_429(_err):
    return jsonify({"error": "Too many requests. Please wait briefly before retrying."}), 429


@app.errorhandler(Exception)
def err_500(err):
    print(f"[ERROR] Unhandled exception: {err}")
    return jsonify({"error": str(err) or "Unexpected internal server error."}), 500


# ================= DATABASE & CRYPTO HELPERS =================
_DB_INIT_LOCK = threading.Lock()
_DB_INITIALIZED = False


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def hash_password(password: str) -> str:
    salt = os.urandom(16).hex()
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=16384,
        r=8,
        p=1,
        dklen=64,
    )
    return f"scrypt:{salt}:{dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        parts = stored.split(":")
        if len(parts) == 3 and parts[0] == "scrypt":
            _, salt, hex_hash = parts
            dk = hashlib.scrypt(
                password.encode("utf-8"),
                salt=salt.encode("utf-8"),
                n=16384,
                r=8,
                p=1,
                dklen=64,
            )
            return hmac.compare_digest(dk, bytes.fromhex(hex_hash))
        if len(parts) == 2:
            salt, hex_hash = parts
            dk = hashlib.scrypt(
                password.encode("utf-8"),
                salt=salt.encode("utf-8"),
                n=16384,
                r=8,
                p=1,
                dklen=64,
            )
            return hmac.compare_digest(dk, bytes.fromhex(hex_hash))
        return False
    except Exception:
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def sign_token(user_id: str, email: str, role: str) -> str:
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode("utf-8"))
    payload_obj = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": int(time.time()) + 60 * 60 * 24 * 7,
    }
    body = _b64url_encode(json.dumps(payload_obj, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(TOKEN_SECRET, f"{header}.{body}".encode("utf-8"), hashlib.sha256).digest()
    return f"{header}.{body}.{_b64url_encode(sig)}"


def verify_token(token: str) -> dict | None:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header, body, sig = parts
        expected = _b64url_encode(
            hmac.new(TOKEN_SECRET, f"{header}.{body}".encode("utf-8"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(sig, expected):
            return None
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        if not payload.get("sub") or int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def _find_seed_csv() -> str | None:
    candidates = [
        os.path.join(DATA_DIR, "welfake_curated_benchmark.csv"),
        os.path.join(_BACKEND_DIR, "data", "welfake_curated_benchmark.csv"),
        os.path.join(_REPO_ROOT, "data", "datasets", "welfake_curated_benchmark.csv"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _init_db_and_seed():
    global _DB_INITIALIZED
    with _DB_INIT_LOCK:
        if _DB_INITIALIZED:
            return

        conn = get_db()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    full_name TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS password_resets (
                    token TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    used INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS datasets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    dataset_format TEXT NOT NULL DEFAULT 'custom',
                    file_reference TEXT NOT NULL,
                    column_mapping_json TEXT,
                    record_count INTEGER NOT NULL DEFAULT 0,
                    fake_count INTEGER NOT NULL DEFAULT 0,
                    real_count INTEGER NOT NULL DEFAULT 0,
                    duplicates_removed INTEGER NOT NULL DEFAULT 0,
                    missing_removed INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'validated',
                    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS model_versions (
                    id TEXT PRIMARY KEY,
                    model_name TEXT NOT NULL,
                    algorithm TEXT NOT NULL,
                    version TEXT NOT NULL,
                    dataset_id TEXT NOT NULL,
                    accuracy REAL NOT NULL DEFAULT 0,
                    precision_score REAL NOT NULL DEFAULT 0,
                    recall_score REAL NOT NULL DEFAULT 0,
                    f1_score REAL NOT NULL DEFAULT 0,
                    roc_auc REAL NOT NULL DEFAULT 0,
                    confusion_matrix_json TEXT,
                    cv_scores_json TEXT,
                    hyperparams_json TEXT,
                    artifact_path TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'trained' CHECK (status IN ('trained', 'active', 'archived', 'failed')),
                    error_message TEXT,
                    trained_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS analyses (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    input_mode TEXT NOT NULL DEFAULT 'article',
                    headline TEXT,
                    article_text TEXT NOT NULL,
                    source_url TEXT,
                    extracted_meta_json TEXT,
                    prediction TEXT NOT NULL CHECK (prediction IN ('REAL', 'FAKE', 'UNCERTAIN')),
                    confidence REAL NOT NULL,
                    model_name TEXT NOT NULL,
                    model_version TEXT NOT NULL,
                    explanation_json TEXT NOT NULL,
                    source_credibility_json TEXT,
                    limitations_json TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS feedback (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    analysis_id TEXT NOT NULL,
                    feedback_type TEXT NOT NULL,
                    rating INTEGER,
                    comments TEXT,
                    reference_url TEXT,
                    moderation_status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS verification_sources (
                    id TEXT PRIMARY KEY,
                    analysis_id TEXT NOT NULL,
                    claim_text TEXT,
                    source_name TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    finding TEXT NOT NULL,
                    stance TEXT DEFAULT 'context',
                    publication_date TEXT,
                    FOREIGN KEY (analysis_id) REFERENCES analyses(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS training_jobs (
                    id TEXT PRIMARY KEY,
                    dataset_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    progress INTEGER NOT NULL DEFAULT 0,
                    current_step TEXT,
                    algorithms_json TEXT,
                    results_json TEXT,
                    error TEXT,
                    started_at TEXT NOT NULL DEFAULT (datetime('now')),
                    completed_at TEXT
                );
                """
            )

            user_count = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
            if user_count == 0:
                conn.execute(
                    "INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), "Dr. Elena Vance (Admin)", "admin@truthlens.ai", hash_password("AdminTruth2026!"), "admin"),
                )
                conn.execute(
                    "INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), "Marcus Chen (Researcher)", "researcher@truthlens.ai", hash_password("Research2026!"), "user"),
                )
                conn.commit()

            # Check if an active model artifact exists on disk
            active_row = conn.execute(
                "SELECT id, artifact_path FROM model_versions WHERE status = 'active' LIMIT 1"
            ).fetchone()
            artifact_ok = bool(
                active_row
                and (
                    os.path.exists(active_row["artifact_path"])
                    or os.path.exists(os.path.join(MODELS_DIR, os.path.basename(active_row["artifact_path"])))
                )
            )

            if not artifact_ok:
                seed_csv = _find_seed_csv()
                if seed_csv:
                    ds_row = conn.execute("SELECT id, name FROM datasets ORDER BY uploaded_at ASC LIMIT 1").fetchone()
                    if ds_row:
                        dataset_id = ds_row["id"]
                        dataset_name = ds_row["name"]
                    else:
                        _, stats = load_and_clean_dataset(seed_csv)
                        dataset_id = str(uuid.uuid4())
                        dataset_name = "WELFake Curated Benchmark Corpus"
                        dest_csv = os.path.join(DATASETS_DIR, "welfake_curated_benchmark.csv")
                        if os.path.abspath(seed_csv) != os.path.abspath(dest_csv):
                            with open(seed_csv, "rb") as src, open(dest_csv, "wb") as dst:
                                dst.write(src.read())
                        else:
                            dest_csv = seed_csv
                        conn.execute(
                            """INSERT INTO datasets (id, name, dataset_format, file_reference, column_mapping_json, record_count, fake_count, real_count, duplicates_removed, missing_removed, status)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (
                                dataset_id,
                                dataset_name,
                                "welfake",
                                dest_csv,
                                json.dumps(stats["column_mapping"]),
                                stats["valid_rows"],
                                stats["fake_count"],
                                stats["real_count"],
                                stats["duplicates_removed"],
                                stats["missing_removed"],
                                "validated",
                            ),
                        )

                    # Clean stale missing model records
                    for m in conn.execute("SELECT id, artifact_path FROM model_versions").fetchall():
                        p = m["artifact_path"]
                        if not os.path.exists(p) and not os.path.exists(os.path.join(MODELS_DIR, os.path.basename(p))):
                            conn.execute("DELETE FROM model_versions WHERE id = ?", (m["id"],))

                    trained = train_and_evaluate(
                        csv_path=seed_csv,
                        models_dir=MODELS_DIR,
                        algorithms=["tfidf_logreg", "tfidf_nb", "tfidf_svm"],
                        test_size=0.2,
                        cv_folds=3,
                        version="v1.0.0",
                        dataset_id=dataset_id,
                        dataset_name=dataset_name,
                    )
                    for item in trained:
                        m = item["metrics"]
                        status = "active" if item["algorithm"] == "tfidf_logreg" else "trained"
                        conn.execute(
                            """INSERT INTO model_versions (id, model_name, algorithm, version, dataset_id, accuracy, precision_score, recall_score, f1_score, roc_auc, confusion_matrix_json, cv_scores_json, hyperparams_json, artifact_path, status)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            (
                                item["id"],
                                item["model_name"],
                                item["algorithm"],
                                item["version"],
                                dataset_id,
                                m["accuracy"],
                                m["precision"],
                                m["recall"],
                                m["f1_score"],
                                m["roc_auc"],
                                json.dumps(m["confusion_matrix"]),
                                json.dumps({
                                    "cv_accuracy_mean": m["cv_accuracy_mean"],
                                    "cv_f1_mean": m["cv_f1_mean"],
                                    "brier_score": m["brier_score"],
                                    "per_class": m["per_class"],
                                    "train_size": m["train_size"],
                                    "test_size": m["test_size"],
                                }),
                                json.dumps(item["hyperparams"]),
                                item["artifact_path"],
                                status,
                            ),
                        )
                    conn.commit()
            _DB_INITIALIZED = True
        finally:
            conn.close()


_init_db_and_seed()


# ================= AUTH HELPERS =================
def _row_to_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "full_name": row["full_name"],
        "email": row["email"],
        "role": row["role"],
        "created_at": row["created_at"],
    }


def _extract_auth_user() -> dict | None:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    if not token:
        return None

    # 1. Verify backend-signed JWT
    payload = verify_token(token)
    if payload:
        conn = get_db()
        try:
            row = conn.execute(
                "SELECT id, full_name, email, role, created_at FROM users WHERE id = ?",
                (payload["sub"],),
            ).fetchone()
            if row:
                return _row_to_user(row)
        finally:
            conn.close()

    # 2. If Supabase is configured, also accept valid Supabase Auth JWTs
    if supabase is not None:
        try:
            user_resp = supabase.auth.get_user(token)
            if user_resp and user_resp.user:
                sb_user = user_resp.user
                email = (sb_user.email or "").lower()
                full_name = (sb_user.user_metadata or {}).get("full_name") or email.split("@")[0]
                role = "user"
                try:
                    prof = supabase.table("profiles").select("full_name,role,created_at").eq("id", sb_user.id).limit(1).execute()
                    if prof.data:
                        full_name = prof.data[0].get("full_name") or full_name
                        role = prof.data[0].get("role") or "user"
                except Exception:
                    pass
                return {
                    "id": sb_user.id,
                    "full_name": full_name,
                    "email": email,
                    "role": role,
                    "created_at": str(sb_user.created_at or datetime.now(timezone.utc).isoformat()),
                }
        except Exception:
            pass

    return None


def require_auth(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = _extract_auth_user()
        if not user:
            return jsonify({"error": "Authentication required."}), 401
        g.current_user = user
        return fn(*args, **kwargs)

    return wrapper


def require_admin(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = getattr(g, "current_user", None)
        if not user or user.get("role") != "admin":
            return jsonify({"error": "Administrator privileges required."}), 403
        return fn(*args, **kwargs)

    return wrapper


# ================= SOURCE CREDIBILITY & URL EXTRACTION =================
KNOWN_PUBLISHERS = {
    "reuters.com": {
        "publisher": "Reuters",
        "status": "verified_news_organization",
        "standards": "International wire service adhering to Thomson Reuters Trust Principles.",
        "summary": "Established global news agency with documented editorial corrections policies.",
    },
    "apnews.com": {
        "publisher": "Associated Press",
        "status": "verified_news_organization",
        "standards": "Independent non-profit news cooperative with published AP News Values.",
        "summary": "Primary wire reporting organization with transparent sourcing guidelines.",
    },
    "bbc.com": {
        "publisher": "BBC News",
        "status": "verified_news_organization",
        "standards": "Public service broadcaster governed by editorial impartiality guidelines.",
        "summary": "Established international news organization.",
    },
    "bbc.co.uk": {
        "publisher": "BBC News",
        "status": "verified_news_organization",
        "standards": "Public service broadcaster governed by editorial impartiality guidelines.",
        "summary": "Established international news organization.",
    },
    "npr.org": {
        "publisher": "NPR",
        "status": "verified_news_organization",
        "standards": "Public radio newsroom with Ombudsman and published ethics handbook.",
        "summary": "Publicly funded journalism organization.",
    },
    "nature.com": {
        "publisher": "Nature Portfolio",
        "status": "verified_news_organization",
        "standards": "Peer-reviewed scientific journal and science news division.",
        "summary": "Recognized academic and scientific publishing institution.",
    },
    "theguardian.com": {
        "publisher": "The Guardian",
        "status": "verified_news_organization",
        "standards": "Independent editorial trust with public corrections column.",
        "summary": "Established international daily newspaper.",
    },
    "nytimes.com": {
        "publisher": "The New York Times",
        "status": "verified_news_organization",
        "standards": "Published Standards and Ethics guidelines with formal corrections desk.",
        "summary": "Established national and international newspaper.",
    },
    "snopes.com": {
        "publisher": "Snopes",
        "status": "fact_checking_body",
        "standards": "IFCN signatory independent fact-checking publication.",
        "summary": "Dedicated fact-checking outlet documenting primary citations.",
    },
    "politifact.com": {
        "publisher": "PolitiFact",
        "status": "fact_checking_body",
        "standards": "IFCN signatory fact-checking initiative operated by Poynter Institute.",
        "summary": "Dedicated claim-verification newsroom.",
    },
    "factcheck.org": {
        "publisher": "FactCheck.org",
        "status": "fact_checking_body",
        "standards": "Annenberg Public Policy Center nonpartisan fact-checking project.",
        "summary": "Academic non-profit claim verification organization.",
    },
    "theonion.com": {
        "publisher": "The Onion",
        "status": "satire_or_parody",
        "standards": "Explicitly self-described satirical news publication.",
        "summary": "Satire publication; articles are intentionally fictional parody.",
    },
    "babylonbee.com": {
        "publisher": "The Babylon Bee",
        "status": "satire_or_parody",
        "standards": "Explicitly self-described Christian/political satire website.",
        "summary": "Satire publication; articles are intentionally fictional parody.",
    },
}


def analyze_source_credibility(
    source_url: str | None = None,
    author: str | None = None,
    published_date: str | None = None,
    site_name: str | None = None,
) -> dict:
    transparency_signals = []
    domain = None
    uses_https = None

    if source_url:
        try:
            parsed = urlparse(source_url)
            if parsed.hostname:
                domain = parsed.hostname.replace("www.", "", 1).lower() if parsed.hostname.startswith("www.") else parsed.hostname.lower()
                uses_https = parsed.scheme.lower() == "https"
                transparency_signals.append(
                    "Encrypted HTTPS transport verified" if uses_https else "Unencrypted HTTP transport"
                )
        except Exception:
            domain = None

    if author:
        transparency_signals.append(f"Attributed author present: {author}")
    elif source_url:
        transparency_signals.append("No explicit author byline detected in HTML metadata")

    if published_date:
        transparency_signals.append(f"Publication timestamp detected: {published_date}")
    elif source_url:
        transparency_signals.append("No structured publication timestamp detected in HTML metadata")

    known_profile = {
        "status": "unrated_domain",
        "summary": (
            f'Domain "{domain}" is not in the curated transparency reference registry. Unknown domains are NOT classified as fake.'
            if domain
            else "No source URL was provided; source credibility evaluation requires a publisher domain."
        ),
        "editorial_standards": "Independent editorial review recommended.",
    }
    publisher_name = site_name or domain

    if domain:
        parts = domain.split(".")
        candidates = [domain]
        if len(parts) > 2:
            candidates.append(".".join(parts[-2:]))
            candidates.append(".".join(parts[-3:]))
        for cand in candidates:
            entry = KNOWN_PUBLISHERS.get(cand)
            if entry:
                publisher_name = entry["publisher"]
                known_profile = {
                    "status": entry["status"],
                    "summary": entry["summary"],
                    "editorial_standards": entry["standards"],
                }
                transparency_signals.append(f"Matched transparency registry: {entry['publisher']}")
                break

    return {
        "domain": domain,
        "publisher_name": publisher_name,
        "uses_https": uses_https,
        "author_detected": author,
        "publication_date": published_date,
        "transparency_signals": transparency_signals,
        "known_profile": known_profile,
        "disclaimer": (
            "Source credibility reflects publisher transparency indicators and reference listings only. "
            "Even reputable publishers can make errors, and unfamiliar domains can publish accurate reporting."
        ),
    }


def _is_private_ip(ip_str: str) -> bool:
    addr = ipaddress.ip_address(ip_str)
    return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast


def validate_public_url(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Invalid URL format. Provide a complete http:// or https:// address.")
    host = parsed.hostname.lower()
    if (
        host in ("localhost", "metadata.google.internal")
        or host.endswith(".localhost")
        or host.endswith(".local")
        or host.endswith(".internal")
    ):
        raise ValueError("Access to local or internal network hosts is blocked for SSRF protection.")

    try:
        ip_obj = ipaddress.ip_address(host)
        if _is_private_ip(str(ip_obj)):
            raise ValueError("Direct requests to private or reserved IP ranges are not permitted.")
    except ValueError as exc:
        if "not permitted" in str(exc):
            raise
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror as gexc:
            raise ValueError(f'Could not resolve domain "{host}". Check that the URL is reachable.') from gexc
        if not infos:
            raise ValueError(f'No DNS records found for "{host}".')
        for info in infos:
            resolved_ip = info[4][0]
            if _is_private_ip(resolved_ip):
                raise ValueError("Resolved destination IP belongs to a restricted internal network.")

    return parsed.geturl()


def fetch_and_extract_article(raw_url: str) -> dict:
    safe_url = validate_public_url(raw_url)
    resp = requests.get(
        safe_url,
        timeout=10,
        allow_redirects=True,
        headers={
            "User-Agent": "TruthLensAI-VerificationBot/1.0 (+https://truthlens.ai)",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    if resp.url and resp.url != safe_url:
        validate_public_url(resp.url)

    if resp.status_code in (401, 402, 403):
        raise ValueError(
            f"Publisher returned HTTP {resp.status_code} (access restricted or paywalled). Paste the article text directly into Full Article mode instead."
        )
    if not resp.ok:
        raise ValueError(f"Failed to fetch URL: Publisher responded with HTTP {resp.status_code}.")

    content_type = (resp.headers.get("Content-Type") or "").lower()
    if "text/html" not in content_type and "application/xhtml" not in content_type:
        raise ValueError(f'Unsupported content type "{content_type or "unknown"}". Only HTML news pages can be extracted.')

    if len(resp.text) > 2_500_000:
        raise ValueError("Fetched HTML document exceeds the 2.5 MB extraction safety limit.")

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "noscript", "iframe", "svg", "nav", "footer", "aside", "form", "button"]):
        tag.decompose()

    def meta_val(attr: str, key: str) -> str | None:
        el = soup.find("meta", attrs={attr: key})
        if el and el.get("content"):
            val = str(el["content"]).strip()
            return val or None
        return None

    h1 = soup.find("h1")
    title = (
        meta_val("property", "og:title")
        or meta_val("name", "twitter:title")
        or (h1.get_text(" ", strip=True) if h1 else None)
        or (soup.title.string.strip() if soup.title and soup.title.string else None)
        or "Extracted Article"
    )
    author = (
        meta_val("name", "author")
        or meta_val("property", "article:author")
        or None
    )
    published_date = (
        meta_val("property", "article:published_time")
        or meta_val("name", "pubdate")
        or meta_val("name", "date")
        or None
    )
    parsed_final = urlparse(resp.url or safe_url)
    domain = (parsed_final.hostname or "").lower()
    if domain.startswith("www."):
        domain = domain[4:]
    site_name = meta_val("property", "og:site_name") or domain

    container = soup.find("article") or soup.find("main") or soup.find(attrs={"role": "main"}) or soup.body or soup
    paragraphs = []
    for p in container.find_all("p"):
        txt = re.sub(r"\s+", " ", p.get_text(" ", strip=True)).strip()
        if len(txt) >= 40:
            paragraphs.append(txt)
    if not paragraphs:
        for p in soup.find_all("p"):
            txt = re.sub(r"\s+", " ", p.get_text(" ", strip=True)).strip()
            if len(txt) >= 35:
                paragraphs.append(txt)

    body = "\n\n".join(paragraphs).strip()
    word_count = len(body.split()) if body else 0
    lower_body = body.lower()
    if (
        word_count < 25
        or "enable javascript and cookies to continue" in lower_body
        or "subscribe to read the full article" in lower_body
    ):
        raise ValueError(
            "Article body could not be cleanly extracted (possible paywall, JavaScript-rendered wall, or minimal text). Use Full Article mode to paste the text directly."
        )

    return {
        "url": resp.url or safe_url,
        "domain": domain,
        "title": title,
        "body": body[:15000],
        "author": author,
        "published_date": published_date,
        "site_name": site_name,
        "word_count": word_count,
    }


def verify_claims_independently(headline: str | None, article_text: str) -> dict:
    if not GEMINI_API_KEY or GEMINI_API_KEY == "MY_GEMINI_API_KEY" or len(GEMINI_API_KEY) < 10:
        return {
            "available": False,
            "reason": "Independent evidence search is not configured (GEMINI_API_KEY missing). Machine learning linguistic analysis remains fully active.",
            "extracted_claims": [],
            "references": [],
        }

    try:
        excerpt = f"{f'Headline: {headline}' + chr(10) if headline else ''}Article: {article_text[:2200]}"
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"

        claims_resp = requests.post(
            endpoint,
            timeout=15,
            json={
                "contents": [
                    {
                        "parts": [
                            {
                                "text": (
                                    "Extract 1 to 3 concrete, checkable factual claims from the following news text. "
                                    "Return strictly valid JSON: {\"claims\": [\"...\"]}.\n\n" + excerpt
                                )
                            }
                        ]
                    }
                ],
                "generationConfig": {"responseMimeType": "application/json"},
            },
        )
        claims_resp.raise_for_status()
        claims_text = (
            claims_resp.json()
            .get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [{}])[0]
            .get("text", "{}")
        )
        claims = [str(c) for c in json.loads(claims_text).get("claims", [])[:3]]
        if not claims:
            return {
                "available": False,
                "reason": "No specific verifiable factual claims could be extracted from the submitted text.",
                "extracted_claims": [],
                "references": [],
            }

        search_resp = requests.post(
            endpoint,
            timeout=20,
            json={
                "contents": [
                    {
                        "parts": [
                            {
                                "text": (
                                    "Search independent news and fact-checking sources for the following claims. "
                                    "Summarize objectively whether grounded web sources support, contradict, or provide context. "
                                    "Never invent citations.\n\nClaims:\n"
                                    + "\n".join(f"{i + 1}. {c}" for i, c in enumerate(claims))
                                )
                            }
                        ]
                    }
                ],
                "tools": [{"google_search": {}}],
            },
        )
        search_resp.raise_for_status()
        cand = search_resp.json().get("candidates", [{}])[0]
        chunks = cand.get("groundingMetadata", {}).get("groundingChunks", []) or []
        web_sources = [
            {"title": c["web"]["title"], "uri": c["web"]["uri"]}
            for c in chunks
            if isinstance(c, dict) and c.get("web", {}).get("uri") and c.get("web", {}).get("title")
        ]
        if not web_sources:
            return {
                "available": False,
                "reason": "Independent verification was unavailable: no matching external fact-checking or corroborating news references were returned by web search.",
                "extracted_claims": claims,
                "references": [],
            }

        summary_text = (
            cand.get("content", {}).get("parts", [{}])[0].get("text", "") or ""
        ).strip()
        lower_sum = summary_text.lower()
        if any(k in lower_sum for k in ("false", "contradict", "no evidence", "debunk")):
            stance = "contradicting"
        elif any(k in lower_sum for k in ("confirm", "corroborat", "support")):
            stance = "supporting"
        else:
            stance = "context"

        references = []
        for idx, src in enumerate(web_sources[:5]):
            host = urlparse(src["uri"]).hostname or src["title"]
            host = host[4:] if host.startswith("www.") else host
            references.append({
                "claim_text": claims[idx % len(claims)],
                "source_name": src["title"] or host,
                "source_url": src["uri"],
                "finding": (
                    summary_text[:340] + ("..." if len(summary_text) > 340 else "")
                    if idx == 0 and summary_text
                    else f"Grounded web reference retrieved for claim review via {host}."
                ),
                "stance": stance,
                "publication_date": None,
            })

        return {
            "available": True,
            "reason": None,
            "extracted_claims": claims,
            "references": references,
        }
    except Exception as exc:
        return {
            "available": False,
            "reason": f"Independent verification unavailable ({exc}).",
            "extracted_claims": [],
            "references": [],
        }


# ================= ACTIVE MODEL HELPER =================
def _get_active_model_row(conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute(
        """SELECT m.*, d.name as dataset_name, d.record_count as dataset_size
           FROM model_versions m
           JOIN datasets d ON m.dataset_id = d.id
           WHERE m.status = 'active'
           ORDER BY m.trained_at DESC LIMIT 1"""
    ).fetchone()


# ================= HEALTH & ROOT ROUTES =================
@app.get("/")
def root_status():
    return jsonify({
        "service": "TruthLens AI Backend",
        "status": "running",
        "version": "2.0.0",
        "health": "/health",
        "api_health": "/api/health",
    }), 200


@app.get("/health")
def health_simple():
    conn = get_db()
    try:
        active = conn.execute(
            "SELECT id, model_name, version, trained_at FROM model_versions WHERE status = 'active' LIMIT 1"
        ).fetchone()
        return jsonify({
            "status": "healthy",
            "service": "TruthLens AI Backend",
            "database": "connected",
            "supabase_connected": supabase is not None,
            "ml_model_active": active is not None,
            "active_model": dict(active) if active else None,
        }), 200
    finally:
        conn.close()


@app.get("/api/health")
def health_api():
    conn = get_db()
    try:
        active = conn.execute(
            "SELECT id, model_name, version, trained_at FROM model_versions WHERE status = 'active' LIMIT 1"
        ).fetchone()
        return jsonify({
            "status": "healthy",
            "service": "TruthLens AI Backend",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "database": "connected",
            "supabase_connected": supabase is not None,
            "ml_model_active": active is not None,
            "active_model": dict(active) if active else None,
            "fact_check_grounding": bool(GEMINI_API_KEY and GEMINI_API_KEY != "MY_GEMINI_API_KEY"),
        }), 200
    finally:
        conn.close()


# ================= PUBLIC METRICS & DEMO =================
@app.get("/api/public/model-metrics")
def public_model_metrics():
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT m.id, m.model_name, m.algorithm, m.version, m.accuracy, m.precision_score,
                      m.recall_score, m.f1_score, m.roc_auc, m.confusion_matrix_json,
                      m.cv_scores_json, m.status, m.trained_at, d.name as dataset_name, d.record_count
               FROM model_versions m
               JOIN datasets d ON m.dataset_id = d.id
               WHERE m.status IN ('active', 'trained')
               ORDER BY m.trained_at DESC LIMIT 6"""
        ).fetchall()
        models = []
        active = None
        for r in rows:
            item = dict(r)
            item["confusion_matrix"] = json.loads(item["confusion_matrix_json"]) if item.get("confusion_matrix_json") else None
            item["cv_scores"] = json.loads(item["cv_scores_json"]) if item.get("cv_scores_json") else None
            models.append(item)
            if item["status"] == "active" and active is None:
                active = item
        return jsonify({"active_model": active, "models": models}), 200
    finally:
        conn.close()


@app.post("/api/public/demo-analyze")
@limiter.limit("20 per minute")
def public_demo_analyze():
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text", "")).strip()
    if len(text) < 20:
        return jsonify({"error": "Provide at least 20 characters for live demonstration."}), 400

    conn = get_db()
    try:
        active = conn.execute(
            "SELECT * FROM model_versions WHERE status = 'active' ORDER BY trained_at DESC LIMIT 1"
        ).fetchone()
        if not active:
            return jsonify({"error": "Model not trained. Active model required."}), 503
        artifact = load_artifact(active["artifact_path"], models_dir=MODELS_DIR)
        result = predict_news(text[:3000], artifact, uncertainty_threshold=0.62)
        return jsonify(result), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        conn.close()


# ================= AUTHENTICATION =================
@app.post("/api/auth/register")
@limiter.limit("15 per minute")
def auth_register():
    payload = request.get_json(silent=True) or {}
    full_name = str(payload.get("full_name", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))

    if len(full_name) < 2:
        return jsonify({"error": "Full name must be at least 2 characters."}), 400
    if not EMAIL_REGEX.match(email):
        return jsonify({"error": "Please enter a valid email address."}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters long."}), 400

    conn = get_db()
    try:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            return jsonify({"error": "An account with this email already exists."}), 409

        user_id = str(uuid.uuid4())

        # Optional Supabase Auth user provisioning when Supabase service role is configured
        if supabase is not None:
            try:
                created = supabase.auth.admin.create_user({
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                    "user_metadata": {"full_name": full_name},
                })
                if created and created.user and created.user.id:
                    user_id = str(created.user.id)
                    try:
                        supabase.table("profiles").upsert({
                            "id": user_id,
                            "full_name": full_name,
                            "email": email,
                            "role": "user",
                        }).execute()
                    except Exception as prof_exc:
                        print(f"[WARN] Supabase profile upsert notice: {prof_exc}")
            except Exception as sb_exc:
                msg = str(sb_exc)
                if "already" in msg.lower() or "registered" in msg.lower() or "exists" in msg.lower():
                    return jsonify({"error": "An account with this email already exists."}), 409
                print(f"[WARN] Supabase register fallback notice: {sb_exc}")

        pw_hash = hash_password(password)
        conn.execute(
            "INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, 'user')",
            (user_id, full_name, email, pw_hash),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, full_name, email, role, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return jsonify({"error": "User profile creation failed. Please try again."}), 500
        user = _row_to_user(row)
        token = sign_token(user["id"], user["email"], user["role"])
        return jsonify({"token": token, "user": user}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "An account with this email already exists."}), 409
    except Exception as exc:
        return jsonify({"error": f"Registration error: {exc}"}), 500
    finally:
        conn.close()


@app.post("/api/auth/login")
@limiter.limit("20 per minute")
def auth_login():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))

    if not email or not password:
        return jsonify({"error": "Email and password are required."}), 400

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, full_name, email, password_hash, role, created_at FROM users WHERE email = ?",
            (email,),
        ).fetchone()
        if row and verify_password(password, row["password_hash"]):
            user = _row_to_user(row)
            token = sign_token(user["id"], user["email"], user["role"])
            return jsonify({"token": token, "user": user}), 200

        # Also attempt Supabase Auth login if configured & user exists in Supabase
        if supabase is not None and SUPABASE_ANON_KEY:
            try:
                auth_res = requests.post(
                    f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                    timeout=10,
                    headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
                    json={"email": email, "password": password},
                )
                if auth_res.ok:
                    data = auth_res.json()
                    sb_user = data.get("user", {})
                    sb_id = str(sb_user.get("id") or uuid.uuid4())
                    full_name = (sb_user.get("user_metadata") or {}).get("full_name") or email.split("@")[0]
                    if not row:
                        conn.execute(
                            "INSERT OR IGNORE INTO users (id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, 'user')",
                            (sb_id, full_name, email, hash_password(password)),
                        )
                        conn.commit()
                        row = conn.execute(
                            "SELECT id, full_name, email, role, created_at FROM users WHERE email = ?",
                            (email,),
                        ).fetchone()
                    user = _row_to_user(row) if row else {
                        "id": sb_id,
                        "full_name": full_name,
                        "email": email,
                        "role": "user",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }
                    token = sign_token(user["id"], user["email"], user["role"])
                    return jsonify({"token": token, "user": user}), 200
            except Exception as sb_exc:
                print(f"[WARN] Supabase login check failed: {sb_exc}")

        return jsonify({"error": "Invalid email or password."}), 401
    finally:
        conn.close()


@app.get("/api/auth/google-status")
def auth_google_status():
    configured = bool(SUPABASE_URL and SUPABASE_ANON_KEY)
    return jsonify({
        "configured": configured,
        "message": (
            "Google OAuth available via Supabase Auth."
            if configured
            else "Google OAuth requires SUPABASE_URL and SUPABASE_ANON_KEY with Google provider enabled in Supabase Dashboard."
        ),
    }), 200


@app.post("/api/auth/forgot-password")
@limiter.limit("10 per minute")
def auth_forgot_password():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    if not email:
        return jsonify({"error": "Email address is required."}), 400

    conn = get_db()
    try:
        user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            return jsonify({
                "message": "If an account matches that email, a password reset token has been generated."
            }), 200
        token = uuid.uuid4().hex + uuid.uuid4().hex[:16]
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat()
        conn.execute(
            "INSERT INTO password_resets (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)",
            (token, user["id"], expires_at),
        )
        conn.commit()
        return jsonify({
            "message": "Password reset token generated. Valid for 30 minutes.",
            "dev_reset_token": token,
        }), 200
    finally:
        conn.close()


@app.post("/api/auth/reset-password")
@limiter.limit("10 per minute")
def auth_reset_password():
    payload = request.get_json(silent=True) or {}
    token = str(payload.get("token", "")).strip()
    new_password = str(payload.get("new_password", ""))
    if not token or len(new_password) < 8:
        return jsonify({"error": "Valid reset token and password (min 8 chars) required."}), 400

    conn = get_db()
    try:
        row = conn.execute(
            "SELECT token, user_id, expires_at, used FROM password_resets WHERE token = ?",
            (token,),
        ).fetchone()
        if not row or row["used"] == 1:
            return jsonify({"error": "Reset token is invalid or expired."}), 400
        exp = datetime.fromisoformat(row["expires_at"])
        if exp < datetime.now(timezone.utc):
            return jsonify({"error": "Reset token is invalid or expired."}), 400

        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), row["user_id"]))
        conn.execute("UPDATE password_resets SET used = 1 WHERE token = ?", (token,))
        conn.commit()
        return jsonify({"message": "Password updated successfully. You may now sign in."}), 200
    finally:
        conn.close()


@app.get("/api/auth/me")
@require_auth
def auth_me():
    return jsonify({"user": g.current_user}), 200


@app.patch("/api/auth/profile")
@require_auth
def auth_profile():
    payload = request.get_json(silent=True) or {}
    full_name = str(payload.get("full_name", "")).strip()
    if len(full_name) < 2:
        return jsonify({"error": "Full name must be at least 2 characters."}), 400

    conn = get_db()
    try:
        conn.execute("UPDATE users SET full_name = ? WHERE id = ?", (full_name, g.current_user["id"]))
        conn.commit()
        row = conn.execute(
            "SELECT id, full_name, email, role, created_at FROM users WHERE id = ?",
            (g.current_user["id"],),
        ).fetchone()
        return jsonify({"user": _row_to_user(row) if row else {**g.current_user, "full_name": full_name}}), 200
    finally:
        conn.close()


# ================= MODEL INFO =================
@app.get("/api/model/info")
@require_auth
def model_info():
    conn = get_db()
    try:
        row = _get_active_model_row(conn)
        if not row:
            return jsonify({
                "trained": False,
                "status": "Model not trained",
                "message": "No active trained model is currently deployed. An administrator must train and activate a model.",
            }), 200
        return jsonify({
            "trained": True,
            "id": row["id"],
            "model_name": row["model_name"],
            "algorithm": row["algorithm"],
            "version": row["version"],
            "dataset_name": row["dataset_name"],
            "dataset_size": row["dataset_size"],
            "accuracy": row["accuracy"],
            "precision": row["precision_score"],
            "recall": row["recall_score"],
            "f1_score": row["f1_score"],
            "roc_auc": row["roc_auc"],
            "confusion_matrix": json.loads(row["confusion_matrix_json"]) if row["confusion_matrix_json"] else None,
            "cv_scores": json.loads(row["cv_scores_json"]) if row["cv_scores_json"] else None,
            "trained_at": row["trained_at"],
            "status": row["status"],
        }), 200
    finally:
        conn.close()


# ================= ANALYZE & URL EXTRACTION =================
def _persist_analysis(
    conn: sqlite3.Connection,
    user_id: str,
    input_mode: str,
    headline: str,
    article_text: str,
    source_url: str | None,
    extracted_meta: dict,
    ml_result: dict,
    source_credibility: dict,
    fact_check: dict,
) -> tuple[str, str]:
    analysis_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO analyses (
               id, user_id, input_mode, headline, article_text, source_url,
               extracted_meta_json, prediction, confidence, model_name, model_version,
               explanation_json, source_credibility_json, limitations_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            analysis_id,
            user_id,
            input_mode,
            headline,
            article_text,
            source_url,
            json.dumps(extracted_meta),
            ml_result["prediction"],
            ml_result["confidence"],
            ml_result["model_name"],
            ml_result["model_version"],
            json.dumps(ml_result),
            json.dumps(source_credibility),
            json.dumps(ml_result.get("limitations", [])),
            created_at,
        ),
    )
    for ref in fact_check.get("references", []):
        conn.execute(
            """INSERT INTO verification_sources (
                   id, analysis_id, claim_text, source_name, source_url, finding, stance, publication_date
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid.uuid4()),
                analysis_id,
                ref.get("claim_text"),
                ref["source_name"],
                ref["source_url"],
                ref["finding"],
                ref.get("stance", "context"),
                ref.get("publication_date"),
            ),
        )
    conn.commit()
    return analysis_id, created_at


@app.post("/api/analyze-url")
@require_auth
@limiter.limit("20 per minute")
def analyze_url():
    payload = request.get_json(silent=True) or {}
    raw_url = str(payload.get("url", "")).strip()
    preview_only = bool(payload.get("preview_only"))
    run_fact_check = bool(payload.get("run_fact_check"))
    threshold = min(0.9, max(0.5, float(payload.get("uncertainty_threshold") or 0.62)))

    if not raw_url:
        return jsonify({"error": "News article URL is required."}), 400

    try:
        extracted = fetch_and_extract_article(raw_url)
        source_cred = analyze_source_credibility(
            source_url=extracted["url"],
            author=extracted["author"],
            published_date=extracted["published_date"],
            site_name=extracted["site_name"],
        )
        if preview_only:
            return jsonify({"extracted": extracted, "source_credibility": source_cred}), 200

        conn = get_db()
        try:
            active_row = _get_active_model_row(conn)
            if not active_row:
                return jsonify({"error": "Model not trained. Please train and activate a model first."}), 503

            artifact = load_artifact(active_row["artifact_path"], models_dir=MODELS_DIR)
            combined = f"{extracted['title']}. {extracted['body']}"
            ml_result = predict_news(combined, artifact, uncertainty_threshold=threshold)
            fact_check = (
                verify_claims_independently(extracted["title"], extracted["body"])
                if run_fact_check
                else {
                    "available": False,
                    "reason": "Independent evidence lookup was not requested for this run.",
                    "extracted_claims": [],
                    "references": [],
                }
            )
            analysis_id, created_at = _persist_analysis(
                conn=conn,
                user_id=g.current_user["id"],
                input_mode="url",
                headline=extracted["title"],
                article_text=extracted["body"],
                source_url=extracted["url"],
                extracted_meta={
                    "author": extracted["author"],
                    "published_date": extracted["published_date"],
                    "site_name": extracted["site_name"],
                    "word_count": extracted["word_count"],
                },
                ml_result=ml_result,
                source_credibility=source_cred,
                fact_check=fact_check,
            )
            return jsonify({
                "id": analysis_id,
                "created_at": created_at,
                "input_mode": "url",
                "headline": extracted["title"],
                "article_text": extracted["body"],
                "source_url": extracted["url"],
                "extracted_meta": extracted,
                "ml_result": ml_result,
                "source_credibility": source_cred,
                "fact_check": fact_check,
            }), 201
        finally:
            conn.close()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400


@app.post("/api/analyze")
@require_auth
@limiter.limit("30 per minute")
def analyze():
    payload = request.get_json(silent=True) or {}
    mode_raw = payload.get("mode")
    mode = "headline" if mode_raw == "headline" else "url" if mode_raw == "url" else "article"
    headline = str(payload.get("headline", "")).strip()
    article_text = str(payload.get("article_text", "")).strip()
    source_url = str(payload["source_url"]).strip() if payload.get("source_url") else None
    author = str(payload["author"]).strip() if payload.get("author") else None
    published_date = str(payload["published_date"]).strip() if payload.get("published_date") else None
    run_fact_check = bool(payload.get("run_fact_check"))
    threshold = min(0.9, max(0.5, float(payload.get("uncertainty_threshold") or 0.62)))

    if mode == "headline" and len(headline) < 12:
        return jsonify({"error": "Headline must be at least 12 characters long."}), 400
    if mode != "headline" and len(article_text) < 40:
        return jsonify({"error": "Article text must be at least 40 characters long."}), 400

    conn = get_db()
    try:
        active_row = _get_active_model_row(conn)
        if not active_row:
            return jsonify({
                "error": "Model not trained. No active trained model is available for production predictions."
            }), 503

        artifact = load_artifact(active_row["artifact_path"], models_dir=MODELS_DIR)
        full_text = headline if mode == "headline" else (f"{headline}. {article_text}" if headline else article_text)
        ml_result = predict_news(full_text, artifact, uncertainty_threshold=threshold)
        source_cred = analyze_source_credibility(
            source_url=source_url,
            author=author,
            published_date=published_date,
        )
        fact_check = (
            verify_claims_independently(headline or None, full_text)
            if run_fact_check
            else {
                "available": False,
                "reason": "Independent evidence search was not enabled for this request.",
                "extracted_claims": [],
                "references": [],
            }
        )
        stored_headline = headline or article_text[:110]
        stored_body = article_text or headline
        analysis_id, created_at = _persist_analysis(
            conn=conn,
            user_id=g.current_user["id"],
            input_mode=mode,
            headline=stored_headline,
            article_text=stored_body,
            source_url=source_url,
            extracted_meta={"author": author, "published_date": published_date},
            ml_result=ml_result,
            source_credibility=source_cred,
            fact_check=fact_check,
        )
        return jsonify({
            "id": analysis_id,
            "created_at": created_at,
            "input_mode": mode,
            "headline": stored_headline,
            "article_text": stored_body,
            "source_url": source_url,
            "ml_result": ml_result,
            "source_credibility": source_cred,
            "fact_check": fact_check,
        }), 201
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    finally:
        conn.close()


# ================= HISTORY & DASHBOARD =================
@app.get("/api/history")
@require_auth
def history_list():
    search = str(request.args.get("search", "")).strip().lower()
    prediction = str(request.args.get("prediction", "ALL")).upper()
    sort = "ASC" if request.args.get("sort") == "oldest" else "DESC"

    sql = (
        "SELECT id, input_mode, headline, source_url, prediction, confidence, model_name, model_version, created_at "
        "FROM analyses WHERE user_id = ?"
    )
    params: list = [g.current_user["id"]]
    if prediction in ("REAL", "FAKE", "UNCERTAIN"):
        sql += " AND prediction = ?"
        params.append(prediction)
    if search:
        sql += " AND (LOWER(headline) LIKE ? OR LOWER(article_text) LIKE ? OR LOWER(COALESCE(source_url, '')) LIKE ?)"
        like = f"%{search}%"
        params.extend([like, like, like])
    sql += f" ORDER BY created_at {sort} LIMIT 100"

    conn = get_db()
    try:
        rows = [dict(r) for r in conn.execute(sql, params).fetchall()]
        return jsonify({"items": rows}), 200
    finally:
        conn.close()


@app.get("/api/history/<analysis_id>")
@require_auth
def history_detail(analysis_id: str):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
        if not row:
            return jsonify({"error": "Analysis record not found."}), 404
        if row["user_id"] != g.current_user["id"] and g.current_user["role"] != "admin":
            return jsonify({"error": "You do not have permission to view this analysis."}), 403
        refs = [
            dict(r)
            for r in conn.execute("SELECT * FROM verification_sources WHERE analysis_id = ?", (analysis_id,)).fetchall()
        ]
        return jsonify({
            "id": row["id"],
            "user_id": row["user_id"],
            "input_mode": row["input_mode"],
            "headline": row["headline"],
            "article_text": row["article_text"],
            "source_url": row["source_url"],
            "extracted_meta": json.loads(row["extracted_meta_json"]) if row["extracted_meta_json"] else None,
            "prediction": row["prediction"],
            "confidence": row["confidence"],
            "model_name": row["model_name"],
            "model_version": row["model_version"],
            "ml_result": json.loads(row["explanation_json"]),
            "source_credibility": json.loads(row["source_credibility_json"]) if row["source_credibility_json"] else None,
            "limitations": json.loads(row["limitations_json"]) if row["limitations_json"] else [],
            "verification_sources": refs,
            "created_at": row["created_at"],
        }), 200
    finally:
        conn.close()


@app.delete("/api/history/<analysis_id>")
@require_auth
def history_delete(analysis_id: str):
    conn = get_db()
    try:
        row = conn.execute("SELECT user_id FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
        if not row:
            return jsonify({"error": "Analysis record not found."}), 404
        if row["user_id"] != g.current_user["id"] and g.current_user["role"] != "admin":
            return jsonify({"error": "You cannot delete another user's analysis."}), 403
        conn.execute("DELETE FROM analyses WHERE id = ?", (analysis_id,))
        conn.commit()
        return jsonify({"deleted": True}), 200
    finally:
        conn.close()


@app.get("/api/dashboard/stats")
@require_auth
def dashboard_stats():
    user_id = g.current_user["id"]
    conn = get_db()
    try:
        counts = conn.execute(
            """SELECT COUNT(*) as total,
                      SUM(CASE WHEN prediction = 'FAKE' THEN 1 ELSE 0 END) as fake_count,
                      SUM(CASE WHEN prediction = 'REAL' THEN 1 ELSE 0 END) as real_count,
                      SUM(CASE WHEN prediction = 'UNCERTAIN' THEN 1 ELSE 0 END) as uncertain_count
               FROM analyses WHERE user_id = ?""",
            (user_id,),
        ).fetchone()
        daily = [
            dict(r)
            for r in conn.execute(
                """SELECT substr(created_at, 1, 10) as day,
                          COUNT(*) as total,
                          SUM(CASE WHEN prediction = 'FAKE' THEN 1 ELSE 0 END) as fake,
                          SUM(CASE WHEN prediction = 'REAL' THEN 1 ELSE 0 END) as real,
                          SUM(CASE WHEN prediction = 'UNCERTAIN' THEN 1 ELSE 0 END) as uncertain
                   FROM analyses WHERE user_id = ?
                   GROUP BY substr(created_at, 1, 10)
                   ORDER BY day ASC LIMIT 14""",
                (user_id,),
            ).fetchall()
        ]
        recent = [
            dict(r)
            for r in conn.execute(
                "SELECT id, input_mode, headline, source_url, prediction, confidence, model_name, model_version, created_at "
                "FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 6",
                (user_id,),
            ).fetchall()
        ]
        active = _get_active_model_row(conn)
        return jsonify({
            "totals": {
                "total": counts["total"] or 0,
                "fake": counts["fake_count"] or 0,
                "real": counts["real_count"] or 0,
                "uncertain": counts["uncertain_count"] or 0,
            },
            "daily_activity": daily,
            "recent_analyses": recent,
            "active_model": dict(active) if active else None,
        }), 200
    finally:
        conn.close()


# ================= FEEDBACK =================
@app.post("/api/feedback")
@require_auth
def submit_feedback():
    payload = request.get_json(silent=True) or {}
    analysis_id = str(payload.get("analysis_id", "")).strip()
    feedback_type = str(payload.get("feedback_type", "")).strip()
    rating = int(payload["rating"]) if payload.get("rating") is not None else None
    comments = str(payload.get("comments", "")).strip()
    reference_url = str(payload["reference_url"]).strip() if payload.get("reference_url") else None

    if not analysis_id or not feedback_type:
        return jsonify({"error": "Analysis ID and feedback type are required."}), 400

    conn = get_db()
    try:
        exists = conn.execute("SELECT id FROM analyses WHERE id = ?", (analysis_id,)).fetchone()
        if not exists:
            return jsonify({"error": "Referenced analysis record does not exist."}), 404
        fid = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO feedback (id, user_id, analysis_id, feedback_type, rating, comments, reference_url, moderation_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (fid, g.current_user["id"], analysis_id, feedback_type, rating, comments, reference_url),
        )
        conn.commit()
        return jsonify({
            "id": fid,
            "message": "Feedback recorded separately from training datasets for administrator review.",
        }), 201
    finally:
        conn.close()


# ================= ADMIN ROUTES =================
@app.post("/api/admin/datasets/preview")
@require_auth
@require_admin
def admin_datasets_preview():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "Please select a CSV file to inspect."}), 400
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only .csv dataset files are permitted."}), 400

    tmp_path = os.path.join(DATASETS_DIR, f"preview_{uuid.uuid4().hex}.csv")
    try:
        file.save(tmp_path)
        numeric_fake = "0" if request.form.get("numeric_fake_value") == "0" else "1"
        _, stats = load_and_clean_dataset(
            tmp_path,
            title_col=request.form.get("title_col") or None,
            text_col=request.form.get("text_col") or None,
            label_col=request.form.get("label_col") or None,
            numeric_fake_value=numeric_fake,
        )
        return jsonify({
            "headers": stats["headers"],
            "detected_mapping": {
                "titleCol": stats["column_mapping"]["title_col"],
                "textCol": stats["column_mapping"]["text_col"],
                "labelCol": stats["column_mapping"]["label_col"],
            },
            "total_rows": stats["total_rows"],
            "valid_rows": stats["valid_rows"],
            "fake_count": stats["fake_count"],
            "real_count": stats["real_count"],
            "duplicates_removed": stats["duplicates_removed"],
            "missing_removed": stats["missing_removed"],
            "invalid_label_rows": stats["invalid_labels_removed"],
            "sample_rows": stats["sample_rows"],
            "warnings": stats["warnings"],
        }), 200
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/api/admin/datasets/upload")
@require_auth
@require_admin
def admin_datasets_upload():
    file = request.files.get("file")
    if not file or not file.filename:
        return jsonify({"error": "CSV dataset file is required."}), 400
    if not file.filename.lower().endswith(".csv"):
        return jsonify({"error": "Only .csv dataset files are permitted."}), 400

    dataset_id = str(uuid.uuid4())
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", file.filename)
    dest_path = os.path.join(DATASETS_DIR, f"{dataset_id}_{safe_name}")
    try:
        file.save(dest_path)
        numeric_fake = "0" if request.form.get("numeric_fake_value") == "0" else "1"
        _, stats = load_and_clean_dataset(
            dest_path,
            title_col=request.form.get("title_col") or None,
            text_col=request.form.get("text_col") or None,
            label_col=request.form.get("label_col") or None,
            numeric_fake_value=numeric_fake,
        )
        name = str(request.form.get("name") or re.sub(r"\.csv$", "", file.filename, flags=re.IGNORECASE)).strip()
        fmt = str(request.form.get("dataset_format") or "custom").strip()

        conn = get_db()
        try:
            conn.execute(
                """INSERT INTO datasets (id, name, dataset_format, file_reference, column_mapping_json, record_count, fake_count, real_count, duplicates_removed, missing_removed, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'validated')""",
                (
                    dataset_id,
                    name,
                    fmt,
                    dest_path,
                    json.dumps({**stats["column_mapping"], "numericFake": numeric_fake}),
                    stats["valid_rows"],
                    stats["fake_count"],
                    stats["real_count"],
                    stats["duplicates_removed"],
                    stats["missing_removed"],
                ),
            )
            conn.commit()
        finally:
            conn.close()

        return jsonify({
            "id": dataset_id,
            "name": name,
            "dataset_format": fmt,
            "record_count": stats["valid_rows"],
            "fake_count": stats["fake_count"],
            "real_count": stats["real_count"],
            "duplicates_removed": stats["duplicates_removed"],
            "missing_removed": stats["missing_removed"],
            "warnings": stats["warnings"],
        }), 201
    except Exception as exc:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        return jsonify({"error": str(exc)}), 400


@app.get("/api/admin/datasets")
@require_auth
@require_admin
def admin_datasets_list():
    conn = get_db()
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM datasets ORDER BY uploaded_at DESC").fetchall()]
        return jsonify({"datasets": rows}), 200
    finally:
        conn.close()


@app.post("/api/admin/train")
@require_auth
@require_admin
def admin_train():
    payload = request.get_json(silent=True) or {}
    dataset_id = str(payload.get("dataset_id", "")).strip()
    raw_algos = payload.get("algorithms")
    algos = [a for a in (raw_algos if isinstance(raw_algos, list) else ["tfidf_logreg", "tfidf_nb", "tfidf_svm"]) if a in ("tfidf_logreg", "tfidf_nb", "tfidf_svm")]
    if not dataset_id or not algos:
        return jsonify({"error": "Valid dataset_id and at least one algorithm are required."}), 400

    conn = get_db()
    try:
        dataset = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,)).fetchone()
        if not dataset:
            return jsonify({"error": "Dataset not found."}), 404
        job_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO training_jobs (id, dataset_id, status, progress, current_step, algorithms_json) VALUES (?, ?, 'running', 10, 'Loading and cleaning dataset...', ?)",
            (job_id, dataset_id, json.dumps(algos)),
        )
        conn.commit()
        dataset_dict = dict(dataset)
    finally:
        conn.close()

    test_ratio = min(0.4, max(0.1, float(payload.get("test_ratio") or 0.2)))
    cv_folds = min(5, max(2, int(payload.get("cv_folds") or 3)))
    remove_stopwords = payload.get("remove_stopwords", True) is not False
    use_bigrams = payload.get("use_bigrams", True) is not False
    max_features = min(10000, max(500, int(payload.get("max_features") or 6500)))

    def _run_job():
        bg_conn = get_db()
        try:
            mapping = json.loads(dataset_dict["column_mapping_json"]) if dataset_dict.get("column_mapping_json") else {}
            count_row = bg_conn.execute("SELECT COUNT(*) as c FROM model_versions").fetchone()
            version_tag = f"v1.{count_row['c']}.0"
            trained_items = train_and_evaluate(
                csv_path=dataset_dict["file_reference"],
                models_dir=MODELS_DIR,
                algorithms=algos,
                test_size=test_ratio,
                cv_folds=cv_folds,
                remove_stopwords=remove_stopwords,
                use_bigrams=use_bigrams,
                max_features=max_features,
                version=version_tag,
                dataset_id=dataset_id,
                dataset_name=dataset_dict["name"],
                title_col=mapping.get("title_col") or mapping.get("titleCol"),
                text_col=mapping.get("text_col") or mapping.get("textCol"),
                label_col=mapping.get("label_col") or mapping.get("labelCol"),
                numeric_fake_value="0" if mapping.get("numericFake") == "0" else "1",
            )
            summary = []
            for item in trained_items:
                m = item["metrics"]
                bg_conn.execute(
                    """INSERT INTO model_versions (id, model_name, algorithm, version, dataset_id, accuracy, precision_score, recall_score, f1_score, roc_auc, confusion_matrix_json, cv_scores_json, hyperparams_json, artifact_path, status)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trained')""",
                    (
                        item["id"],
                        item["model_name"],
                        item["algorithm"],
                        version_tag,
                        dataset_id,
                        m["accuracy"],
                        m["precision"],
                        m["recall"],
                        m["f1_score"],
                        m["roc_auc"],
                        json.dumps(m["confusion_matrix"]),
                        json.dumps({
                            "cv_accuracy_mean": m["cv_accuracy_mean"],
                            "cv_f1_mean": m["cv_f1_mean"],
                            "brier_score": m["brier_score"],
                            "per_class": m["per_class"],
                            "train_size": m["train_size"],
                            "test_size": m["test_size"],
                        }),
                        json.dumps(item["hyperparams"]),
                        item["artifact_path"],
                    ),
                )
                summary.append({
                    "id": item["id"],
                    "model_name": item["model_name"],
                    "algorithm": item["algorithm"],
                    "version": version_tag,
                    "metrics": m,
                })
            bg_conn.execute(
                "UPDATE training_jobs SET status = 'completed', progress = 100, current_step = 'Training & evaluation complete. Review metrics before activating.', results_json = ?, completed_at = datetime('now') WHERE id = ?",
                (json.dumps(summary), job_id),
            )
            bg_conn.commit()
        except Exception as exc:
            bg_conn.execute(
                "UPDATE training_jobs SET status = 'failed', current_step = 'Training failed; previous active model preserved.', error = ?, completed_at = datetime('now') WHERE id = ?",
                (str(exc), job_id),
            )
            bg_conn.commit()
        finally:
            bg_conn.close()

    threading.Thread(target=_run_job, daemon=True).start()
    return jsonify({"job_id": job_id, "status": "running"}), 202


@app.get("/api/admin/train/status")
@require_auth
@require_admin
def admin_train_status():
    job_id = request.args.get("job_id")
    conn = get_db()
    try:
        row = (
            conn.execute("SELECT * FROM training_jobs WHERE id = ?", (job_id,)).fetchone()
            if job_id
            else conn.execute("SELECT * FROM training_jobs ORDER BY started_at DESC LIMIT 1").fetchone()
        )
        if not row:
            return jsonify({"status": "idle", "progress": 0}), 200
        item = dict(row)
        item["results"] = json.loads(item["results_json"]) if item.get("results_json") else []
        return jsonify(item), 200
    finally:
        conn.close()


@app.get("/api/admin/models")
@require_auth
@require_admin
def admin_models_list():
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT m.*, d.name as dataset_name, d.record_count as dataset_size
               FROM model_versions m
               JOIN datasets d ON m.dataset_id = d.id
               ORDER BY m.trained_at DESC"""
        ).fetchall()
        models = []
        for r in rows:
            item = dict(r)
            item["confusion_matrix"] = json.loads(item["confusion_matrix_json"]) if item.get("confusion_matrix_json") else None
            item["cv_scores"] = json.loads(item["cv_scores_json"]) if item.get("cv_scores_json") else None
            item["hyperparams"] = json.loads(item["hyperparams_json"]) if item.get("hyperparams_json") else None
            models.append(item)
        return jsonify({"models": models}), 200
    finally:
        conn.close()


@app.post("/api/admin/models/activate")
@require_auth
@require_admin
def admin_models_activate():
    payload = request.get_json(silent=True) or {}
    model_id = str(payload.get("model_id", "")).strip()
    deactivate = bool(payload.get("deactivate"))

    conn = get_db()
    try:
        if deactivate:
            conn.execute("UPDATE model_versions SET status = 'trained' WHERE status = 'active'")
            conn.commit()
            return jsonify({"active_model_id": None, "message": "Active model deactivated."}), 200

        row = conn.execute("SELECT * FROM model_versions WHERE id = ?", (model_id,)).fetchone()
        if not row:
            return jsonify({"error": "Model version not found."}), 404
        if not os.path.exists(row["artifact_path"]) and not os.path.exists(
            os.path.join(MODELS_DIR, os.path.basename(row["artifact_path"]))
        ):
            return jsonify({"error": "Cannot activate: model artifact missing on disk."}), 400

        conn.execute("UPDATE model_versions SET status = 'trained' WHERE status = 'active'")
        conn.execute("UPDATE model_versions SET status = 'active' WHERE id = ?", (model_id,))
        conn.commit()
        return jsonify({
            "active_model_id": model_id,
            "message": f"Activated {row['model_name']} ({row['version']}).",
        }), 200
    finally:
        conn.close()


@app.get("/api/admin/users")
@require_auth
@require_admin
def admin_users():
    conn = get_db()
    try:
        rows = [
            dict(r)
            for r in conn.execute(
                """SELECT u.id, u.full_name, u.email, u.role, u.created_at, COUNT(a.id) as analysis_count
                   FROM users u
                   LEFT JOIN analyses a ON u.id = a.user_id
                   GROUP BY u.id
                   ORDER BY u.created_at DESC"""
            ).fetchall()
        ]
        return jsonify({"users": rows}), 200
    finally:
        conn.close()


@app.patch("/api/admin/users/<user_id>/role")
@require_auth
@require_admin
def admin_user_role(user_id: str):
    payload = request.get_json(silent=True) or {}
    role = "admin" if payload.get("role") == "admin" else "user"
    if user_id == g.current_user["id"] and role != "admin":
        return jsonify({"error": "You cannot demote your own admin session."}), 400
    conn = get_db()
    try:
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        conn.commit()
        return jsonify({"updated": True, "role": role}), 200
    finally:
        conn.close()


@app.get("/api/admin/feedback")
@require_auth
@require_admin
def admin_feedback():
    conn = get_db()
    try:
        rows = [
            dict(r)
            for r in conn.execute(
                """SELECT f.*, u.email as user_email, a.headline, a.prediction, a.confidence
                   FROM feedback f
                   JOIN users u ON f.user_id = u.id
                   JOIN analyses a ON f.analysis_id = a.id
                   ORDER BY f.created_at DESC LIMIT 100"""
            ).fetchall()
        ]
        return jsonify({"feedback": rows}), 200
    finally:
        conn.close()


@app.patch("/api/admin/feedback/<feedback_id>")
@require_auth
@require_admin
def admin_feedback_moderate(feedback_id: str):
    payload = request.get_json(silent=True) or {}
    status = payload.get("moderation_status")
    if status not in ("pending", "reviewed", "dismissed"):
        status = "reviewed"
    conn = get_db()
    try:
        conn.execute("UPDATE feedback SET moderation_status = ? WHERE id = ?", (status, feedback_id))
        conn.commit()
        return jsonify({"updated": True, "moderation_status": status}), 200
    finally:
        conn.close()


@app.get("/api/admin/analyses")
@require_auth
@require_admin
def admin_analyses():
    conn = get_db()
    try:
        rows = [
            dict(r)
            for r in conn.execute(
                """SELECT a.id, a.input_mode, a.headline, a.source_url, a.prediction, a.confidence,
                          a.model_name, a.model_version, a.created_at, u.email as user_email
                   FROM analyses a
                   JOIN users u ON a.user_id = u.id
                   ORDER BY a.created_at DESC LIMIT 100"""
            ).fetchall()
        ]
        return jsonify({"analyses": rows}), 200
    finally:
        conn.close()


@app.get("/api/admin/system")
@require_auth
@require_admin
def admin_system():
    conn = get_db()
    try:
        return jsonify({
            "total_users": conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"],
            "total_analyses": conn.execute("SELECT COUNT(*) as c FROM analyses").fetchone()["c"],
            "total_datasets": conn.execute("SELECT COUNT(*) as c FROM datasets").fetchone()["c"],
            "total_models": conn.execute("SELECT COUNT(*) as c FROM model_versions").fetchone()["c"],
            "pending_feedback": conn.execute(
                "SELECT COUNT(*) as c FROM feedback WHERE moderation_status = 'pending'"
            ).fetchone()["c"],
            "python_version": sys.version.split()[0],
            "gemini_grounding_configured": bool(GEMINI_API_KEY and GEMINI_API_KEY != "MY_GEMINI_API_KEY"),
            "supabase_configured": supabase is not None,
        }), 200
    finally:
        conn.close()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
