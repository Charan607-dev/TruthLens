import os
import sys
from typing import Dict, List
import joblib
import numpy as np

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from ml.preprocess import preprocess_for_vectorizer, tokenize_text


def load_artifact(artifact_path: str, models_dir: str | None = None) -> Dict:
    if os.path.exists(artifact_path):
        return joblib.load(artifact_path)
    if models_dir:
        fallback = os.path.join(models_dir, os.path.basename(artifact_path))
        if os.path.exists(fallback):
            return joblib.load(fallback)
    raise FileNotFoundError(f"Model artifact not found: {artifact_path}")


def explain_prediction(pipeline, processed_text: str, algorithm: str, top_k: int = 8) -> Dict:
    vectorizer = pipeline.named_steps["tfidf"]
    clf = pipeline.named_steps["clf"]
    X = vectorizer.transform([processed_text])
    feature_names = vectorizer.get_feature_names_out()
    nonzero_idx = X.nonzero()[1]

    contributions: List[Dict] = []
    if algorithm == "tfidf_logreg":
        coefs = clf.coef_[0]
        for idx in nonzero_idx:
            val = float(X[0, idx])
            w = float(coefs[idx])
            c = val * w
            if abs(c) > 1e-5:
                contributions.append({
                    "term": str(feature_names[idx]),
                    "tfidf": val,
                    "weight": w,
                    "contribution": c,
                    "direction": "fake" if c >= 0 else "real",
                })
    elif algorithm == "tfidf_nb":
        ll_diff = clf.feature_log_prob_[1] - clf.feature_log_prob_[0]
        for idx in nonzero_idx:
            val = float(X[0, idx])
            w = float(ll_diff[idx])
            c = val * w
            if abs(c) > 1e-5:
                contributions.append({
                    "term": str(feature_names[idx]),
                    "tfidf": val,
                    "weight": w,
                    "contribution": c,
                    "direction": "fake" if c >= 0 else "real",
                })
    else:
        coefs = np.mean([cc.estimator.coef_[0] for cc in clf.calibrated_classifiers_], axis=0)
        for idx in nonzero_idx:
            val = float(X[0, idx])
            w = float(coefs[idx])
            c = val * w
            if abs(c) > 1e-5:
                contributions.append({
                    "term": str(feature_names[idx]),
                    "tfidf": val,
                    "weight": w,
                    "contribution": c,
                    "direction": "fake" if c >= 0 else "real",
                })

    top_fake = sorted([c for c in contributions if c["contribution"] > 0], key=lambda x: -x["contribution"])[:top_k]
    top_real = sorted([c for c in contributions if c["contribution"] < 0], key=lambda x: x["contribution"])[:top_k]
    all_matched_terms = [
        {"term": c["term"], "direction": c["direction"], "contribution": c["contribution"]}
        for c in sorted(contributions, key=lambda x: -abs(x["contribution"]))[:24]
    ]

    unigram_vocab_hits = sum(1 for idx in nonzero_idx if " " not in str(feature_names[idx]))

    return {
        "matched_features_count": int(len(nonzero_idx)),
        "unigram_vocab_hits": int(unigram_vocab_hits),
        "top_fake_features": top_fake,
        "top_real_features": top_real,
        "all_matched_terms": all_matched_terms,
    }


def predict_news(
    text: str,
    artifact: Dict,
    uncertainty_threshold: float = 0.62,
) -> Dict:
    pipeline = artifact["pipeline"]
    remove_stopwords = artifact.get("remove_stopwords", True)
    tokens = tokenize_text(text, remove_stopwords=remove_stopwords)
    processed = preprocess_for_vectorizer(text, remove_stopwords=remove_stopwords)

    probs = pipeline.predict_proba([processed])[0]
    prob_real = float(probs[0])
    prob_fake = float(probs[1])
    confidence = max(prob_real, prob_fake)
    raw_label = "FAKE" if prob_fake >= 0.5 else "REAL"

    explanation = explain_prediction(pipeline, processed, artifact["algorithm"])
    matched_count = explanation["matched_features_count"]
    unique_unigrams = len(set(tokens))
    vocab_coverage = (explanation["unigram_vocab_hits"] / unique_unigrams) if unique_unigrams > 0 else 0.0

    is_insufficient = matched_count < 2 or len(tokens) < 3
    if is_insufficient or confidence < uncertainty_threshold:
        prediction = "UNCERTAIN"
    else:
        prediction = raw_label

    model_name = artifact.get("model_name", artifact["algorithm"])
    model_version = artifact.get("version", "v1.0.0")
    dataset_name = artifact.get("dataset_name", "TruthLens Curated Corpus")
    dataset_size = int(artifact.get("dataset_size", 0))

    if is_insufficient:
        summary = (
            f"Only {matched_count} recognized vocabulary term(s) matched the active model "
            f"({vocab_coverage * 100:.0f}% unigram coverage). Input length is insufficient for reliable "
            "statistical classification, so it is classified as UNCERTAIN."
        )
    elif prediction == "UNCERTAIN":
        summary = (
            f"Model probability ({confidence * 100:.1f}%) falls below the configured "
            f"{uncertainty_threshold * 100:.0f}% confidence threshold across {matched_count} matched features "
            f"({vocab_coverage * 100:.0f}% unigram coverage). Both misinformation-correlated and "
            "institutional-reporting signals were detected without a decisive margin."
        )
    elif prediction == "FAKE":
        terms = ", ".join(f'"{f["term"]}"' for f in explanation["top_fake_features"][:4])
        summary = (
            f"The active {model_name} classifier assigned a {prob_fake * 100:.1f}% statistical score toward "
            f"the FAKE training class ({vocab_coverage * 100:.0f}% unigram coverage), driven primarily by "
            f"phrasing such as {terms or 'misinformation-correlated patterns'} learned from the training dataset."
        )
    else:
        terms = ", ".join(f'"{f["term"]}"' for f in explanation["top_real_features"][:4])
        summary = (
            f"The active {model_name} classifier assigned a {prob_real * 100:.1f}% statistical score toward "
            f"the REAL training class ({vocab_coverage * 100:.0f}% unigram coverage), driven by reporting "
            f"patterns such as {terms or 'standard journalistic terms'} learned from the training dataset."
        )

    limitations = [
        "Statistical NLP predictions reflect linguistic patterns observed in the training corpus and do NOT constitute proof of factual truth or falsehood.",
        "Short headlines contain fewer TF-IDF features than full-length articles, which can lower model confidence.",
        f'Model trained on "{dataset_name}" ({dataset_size} cleaned records); domain shift outside this corpus may reduce accuracy.',
    ]

    return {
        "prediction": prediction,
        "raw_label": raw_label,
        "confidence": confidence,
        "prob_fake": prob_fake,
        "prob_real": prob_real,
        "uncertainty_threshold": uncertainty_threshold,
        "model_name": model_name,
        "model_version": model_version,
        "algorithm": artifact["algorithm"],
        "matched_features_count": matched_count,
        "total_tokens": len(tokens),
        "vocabulary_coverage": vocab_coverage,
        "top_fake_features": explanation["top_fake_features"],
        "top_real_features": explanation["top_real_features"],
        "all_matched_terms": explanation["all_matched_terms"],
        "explanation_summary": summary,
        "limitations": limitations,
    }
