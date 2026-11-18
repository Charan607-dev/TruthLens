import os
import ipaddress
import socket
from urllib.parse import urlparse
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from supabase import create_client, Client

from ml.predict_engine import load_artifact, predict_news
from ml.train_pipeline import train_and_evaluate

load_dotenv()

app = Flask(__name__)
CORS(app, origins=os.getenv("ALLOWED_ORIGINS", "*").split(","))
limiter = Limiter(get_remote_address, app=app, default_limits=["120 per minute"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
MODELS_DIR = os.getenv("MODELS_DIR", "./models")
DATASETS_DIR = os.getenv("DATASETS_DIR", "./datasets")

supabase: Client | None = (
    create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    else None
)


def validate_public_url(raw_url: str) -> str:
    parsed = urlparse(raw_url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Invalid HTTP/HTTPS URL.")
    host = parsed.hostname.lower()
    if host in ("localhost", "metadata.google.internal") or host.endswith((".local", ".internal")):
        raise ValueError("Internal hosts are blocked for SSRF protection.")
    ip = socket.gethostbyname(host)
    addr = ipaddress.ip_address(ip)
    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
        raise ValueError("Private or reserved IP targets are blocked.")
    return parsed.geturl()


def get_active_model_record():
    if not supabase:
        return None
    res = (
        supabase.table("model_versions")
        .select("*")
        .eq("status", "active")
        .order("trained_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


@app.get("/api/health")
def health():
    active = get_active_model_record()
    return jsonify({
        "status": "healthy",
        "supabase_connected": supabase is not None,
        "active_model": active,
    })


@app.get("/api/model/info")
def model_info():
    active = get_active_model_record()
    if not active:
        return jsonify({"trained": False, "status": "Model not trained"}), 200
    return jsonify({"trained": True, **active})


@app.post("/api/analyze-url")
@limiter.limit("20/minute")
def analyze_url():
    payload = request.get_json(silent=True) or {}
    raw_url = str(payload.get("url", "")).strip()
    try:
        safe_url = validate_public_url(raw_url)
        resp = requests.get(
            safe_url,
            timeout=10,
            headers={"User-Agent": "TruthLensAI-VerificationBot/1.0"},
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "aside"]):
            tag.decompose()
        title = soup.title.string.strip() if soup.title and soup.title.string else ""
        paragraphs = [p.get_text(" ", strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True)) >= 40]
        body = "\n\n".join(paragraphs)
        if len(body.split()) < 25:
            return jsonify({"error": "Could not extract article text (possible paywall or JS wall)."}), 400
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

    active = get_active_model_record()
    if not active:
        return jsonify({"error": "Model not trained."}), 503

    artifact = load_artifact(active["artifact_path"])
    result = predict_news(f"{title}. {body}", artifact)
    return jsonify({"headline": title, "article_text": body, "source_url": safe_url, "ml_result": result})


@app.post("/api/analyze")
@limiter.limit("30/minute")
def analyze():
    payload = request.get_json(silent=True) or {}
    headline = str(payload.get("headline", "")).strip()
    article_text = str(payload.get("article_text", "")).strip()
    combined = f"{headline}. {article_text}".strip(". ")
    if len(combined) < 15:
        return jsonify({"error": "Input text is too short for classification."}), 400

    active = get_active_model_record()
    if not active:
        return jsonify({"error": "Model not trained."}), 503

    artifact = load_artifact(active["artifact_path"])
    result = predict_news(combined, artifact)
    return jsonify({"headline": headline, "ml_result": result})


@app.post("/api/admin/train")
def admin_train():
    payload = request.get_json(silent=True) or {}
    csv_path = payload.get("csv_path")
    if not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "Valid CSV dataset file path required."}), 400
    results = train_and_evaluate(csv_path=csv_path, models_dir=MODELS_DIR)
    return jsonify({"results": results}), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
