import joblib
import numpy as np
from typing import Dict, List
from ml.preprocess import preprocess_for_vectorizer


def load_artifact(artifact_path: str) -> Dict:
    return joblib.load(artifact_path)


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
            contributions.append({
                "term": feature_names[idx],
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
            contributions.append({
                "term": feature_names[idx],
                "tfidf": val,
                "weight": w,
                "contribution": c,
                "direction": "fake" if c >= 0 else "real",
            })
    else:
        # Calibrated LinearSVC: average primal coefficients across calibration folds
        coefs = np.mean([cc.estimator.coef_[0] for cc in clf.calibrated_classifiers_], axis=0)
        for idx in nonzero_idx:
            val = float(X[0, idx])
            w = float(coefs[idx])
            c = val * w
            contributions.append({
                "term": feature_names[idx],
                "tfidf": val,
                "weight": w,
                "contribution": c,
                "direction": "fake" if c >= 0 else "real",
            })

    top_fake = sorted([c for c in contributions if c["contribution"] > 0], key=lambda x: -x["contribution"])[:top_k]
    top_real = sorted([c for c in contributions if c["contribution"] < 0], key=lambda x: x["contribution"])[:top_k]

    return {
        "matched_features_count": len(nonzero_idx),
        "top_fake_features": top_fake,
        "top_real_features": top_real,
    }


def predict_news(
    text: str,
    artifact: Dict,
    uncertainty_threshold: float = 0.62,
) -> Dict:
    pipeline = artifact["pipeline"]
    processed = preprocess_for_vectorizer(text, remove_stopwords=artifact.get("remove_stopwords", True))
    probs = pipeline.predict_proba([processed])[0]
    prob_real = float(probs[0])
    prob_fake = float(probs[1])
    confidence = max(prob_real, prob_fake)
    raw_label = "FAKE" if prob_fake >= 0.5 else "REAL"

    explanation = explain_prediction(pipeline, processed, artifact["algorithm"])
    if explanation["matched_features_count"] < 3 or confidence < uncertainty_threshold:
        prediction = "UNCERTAIN"
    else:
        prediction = raw_label

    return {
        "prediction": prediction,
        "raw_label": raw_label,
        "confidence": confidence,
        "prob_fake": prob_fake,
        "prob_real": prob_real,
        "model_name": artifact["algorithm"],
        "model_version": artifact["version"],
        **explanation,
    }
