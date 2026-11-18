import os
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

from ml.preprocess import preprocess_for_vectorizer


LABEL_MAP = {
    "fake": 1,
    "false": 1,
    "pants-fire": 1,
    "barely-true": 1,
    "1": 1,
    "real": 0,
    "true": 0,
    "mostly-true": 0,
    "0": 0,
}


def detect_columns(df: pd.DataFrame) -> Dict[str, Optional[str]]:
    cols = {c.lower().strip(): c for c in df.columns}
    title_col = next((cols[k] for k in ["title", "headline", "header"] if k in cols), None)
    text_col = next((cols[k] for k in ["text", "article", "body", "content", "statement"] if k in cols), title_col)
    label_col = next((cols[k] for k in ["label", "class", "target", "verdict"] if k in cols), None)
    return {"title_col": title_col, "text_col": text_col, "label_col": label_col}


def load_and_clean_dataset(
    csv_path: str,
    title_col: Optional[str] = None,
    text_col: Optional[str] = None,
    label_col: Optional[str] = None,
    numeric_fake_value: str = "1",
) -> Tuple[pd.DataFrame, Dict]:
    df = pd.read_csv(csv_path)
    detected = detect_columns(df)
    title_col = title_col or detected["title_col"]
    text_col = text_col or detected["text_col"]
    label_col = label_col or detected["label_col"]

    if not text_col or text_col not in df.columns:
        raise ValueError("Unable to identify article text column. Provide manual column mapping.")
    if not label_col or label_col not in df.columns:
        raise ValueError("Unable to identify target label column. Provide manual column mapping.")

    total_rows = len(df)
    title_series = df[title_col].fillna("").astype(str) if title_col and title_col in df.columns else pd.Series([""] * total_rows)
    text_series = df[text_col].fillna("").astype(str)

    combined = np.where(
        (title_series.str.len() > 0) & (title_series != text_series),
        title_series + ". " + text_series,
        text_series,
    )

    cleaned_df = pd.DataFrame({"raw_text": combined, "raw_label": df[label_col]})
    cleaned_df["raw_text"] = cleaned_df["raw_text"].str.strip()
    missing_removed = int((cleaned_df["raw_text"].str.len() < 15).sum())
    cleaned_df = cleaned_df[cleaned_df["raw_text"].str.len() >= 15].copy()

    def map_label(v):
        s = str(v).strip().lower()
        if s in ("0", "1"):
            return 1 if s == numeric_fake_value else 0
        return LABEL_MAP.get(s, None)

    cleaned_df["label"] = cleaned_df["raw_label"].apply(map_label)
    invalid_labels = int(cleaned_df["label"].isna().sum())
    cleaned_df = cleaned_df.dropna(subset=["label"]).copy()
    cleaned_df["label"] = cleaned_df["label"].astype(int)

    cleaned_df["dedupe_key"] = cleaned_df["raw_text"].str.lower().str.replace(r"\s+", " ", regex=True).str[:400]
    before_dedupe = len(cleaned_df)
    cleaned_df = cleaned_df.drop_duplicates(subset=["dedupe_key"]).drop(columns=["dedupe_key"])
    duplicates_removed = before_dedupe - len(cleaned_df)

    stats = {
        "total_rows": total_rows,
        "valid_rows": len(cleaned_df),
        "fake_count": int((cleaned_df["label"] == 1).sum()),
        "real_count": int((cleaned_df["label"] == 0).sum()),
        "missing_removed": missing_removed,
        "invalid_labels_removed": invalid_labels,
        "duplicates_removed": duplicates_removed,
        "column_mapping": {"title_col": title_col, "text_col": text_col, "label_col": label_col},
    }
    return cleaned_df, stats


def build_pipeline(algorithm: str, max_features: int = 10000, ngram_max: int = 2) -> Pipeline:
    vectorizer = TfidfVectorizer(
        max_features=max_features,
        ngram_range=(1, ngram_max),
        min_df=2,
        sublinear_tf=True,
    )
    if algorithm == "tfidf_logreg":
        clf = LogisticRegression(C=2.0, max_iter=1000, class_weight="balanced", random_state=42)
    elif algorithm == "tfidf_nb":
        clf = MultinomialNB(alpha=1.0)
    elif algorithm == "tfidf_svm":
        base_svm = LinearSVC(C=1.5, class_weight="balanced", random_state=42)
        clf = CalibratedClassifierCV(base_svm, cv=3, method="sigmoid")
    else:
        raise ValueError(f"Unsupported algorithm: {algorithm}")

    return Pipeline([("tfidf", vectorizer), ("clf", clf)])


def train_and_evaluate(
    csv_path: str,
    models_dir: str,
    algorithms: Optional[List[str]] = None,
    test_size: float = 0.2,
    cv_folds: int = 5,
    remove_stopwords: bool = True,
    version: str = "v1.0.0",
) -> List[Dict]:
    if algorithms is None:
        algorithms = ["tfidf_logreg", "tfidf_nb", "tfidf_svm"]

    df, dataset_stats = load_and_clean_dataset(csv_path)
    df["processed_text"] = df["raw_text"].apply(
        lambda t: preprocess_for_vectorizer(t, remove_stopwords=remove_stopwords)
    )

    # Leakage-free stratified split BEFORE fitting vectorizers
    X_train, X_test, y_train, y_test = train_test_split(
        df["processed_text"].values,
        df["label"].values,
        test_size=test_size,
        stratify=df["label"].values,
        random_state=42,
    )

    os.makedirs(models_dir, exist_ok=True)
    results = []

    for algo in algorithms:
        pipeline = build_pipeline(algo)
        skf = StratifiedKFold(n_splits=min(cv_folds, int(np.bincount(y_train).min())), shuffle=True, random_state=42)
        cv_out = cross_validate(pipeline, X_train, y_train, cv=skf, scoring=["accuracy", "f1"])

        pipeline.fit(X_train, y_train)
        y_pred = pipeline.predict(X_test)
        y_prob = pipeline.predict_proba(X_test)[:, 1]

        cm = confusion_matrix(y_test, y_pred).tolist()
        metrics = {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision": float(precision_score(y_test, y_pred, zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, zero_division=0)),
            "f1_score": float(f1_score(y_test, y_pred, zero_division=0)),
            "roc_auc": float(roc_auc_score(y_test, y_prob)),
            "confusion_matrix": cm,
            "cv_accuracy_mean": float(np.mean(cv_out["test_accuracy"])),
            "cv_f1_mean": float(np.mean(cv_out["test_f1"])),
        }

        artifact_name = f"{algo}_{version}.joblib"
        artifact_path = os.path.join(models_dir, artifact_name)
        joblib.dump(
            {
                "pipeline": pipeline,
                "algorithm": algo,
                "version": version,
                "remove_stopwords": remove_stopwords,
                "metrics": metrics,
                "dataset_stats": dataset_stats,
                "trained_at": datetime.now(timezone.utc).isoformat(),
            },
            artifact_path,
        )

        results.append(
            {
                "algorithm": algo,
                "version": version,
                "artifact_path": artifact_path,
                "metrics": metrics,
                "dataset_stats": dataset_stats,
                "status": "trained",
            }
        )

    return results
