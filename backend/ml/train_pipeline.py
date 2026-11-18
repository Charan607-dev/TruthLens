from datetime import datetime, timezone
import os
import sys
from typing import Dict, List, Optional, Tuple
import uuid
import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_validate, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from ml.preprocess import preprocess_for_vectorizer


ALGORITHM_DISPLAY_NAMES = {
    "tfidf_logreg": "TF-IDF + Logistic Regression",
    "tfidf_nb": "TF-IDF + Multinomial Naive Bayes",
    "tfidf_svm": "TF-IDF + Linear SVM",
}

LABEL_MAP = {
    "fake": 1,
    "false": 1,
    "pants-fire": 1,
    "barely-true": 1,
    "misleading": 1,
    "fabricated": 1,
    "real": 0,
    "true": 0,
    "mostly-true": 0,
    "verified": 0,
}


def detect_columns(df: pd.DataFrame) -> Dict[str, Optional[str]]:
    cols = {str(c).lower().strip(): str(c) for c in df.columns}
    title_col = next((cols[k] for k in ["title", "headline", "header"] if k in cols), None)
    text_col = next(
        (cols[k] for k in ["text", "article", "body", "content", "statement"] if k in cols),
        title_col,
    )
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
    headers = [str(c) for c in df.columns]
    detected = detect_columns(df)
    title_col = title_col or detected["title_col"]
    text_col = text_col or detected["text_col"]
    label_col = label_col or detected["label_col"]

    if not text_col or text_col not in df.columns:
        raise ValueError("Unable to identify article text column. Provide manual column mapping.")
    if not label_col or label_col not in df.columns:
        raise ValueError("Unable to identify target label column. Provide manual column mapping.")

    total_rows = len(df)
    title_series = (
        df[title_col].fillna("").astype(str).str.strip()
        if title_col and title_col in df.columns
        else pd.Series([""] * total_rows)
    )
    text_series = df[text_col].fillna("").astype(str).str.strip()

    combined = np.where(
        (title_series.str.len() > 0) & (title_series != text_series),
        title_series + ". " + text_series,
        text_series,
    )

    cleaned_df = pd.DataFrame({
        "title": title_series,
        "text": text_series,
        "raw_text": combined,
        "raw_label": df[label_col],
    })
    cleaned_df["raw_text"] = cleaned_df["raw_text"].str.strip()
    missing_removed = int((cleaned_df["raw_text"].str.len() < 15).sum())
    cleaned_df = cleaned_df[cleaned_df["raw_text"].str.len() >= 15].copy()

    def map_label(v):
        s = str(v).strip().lower()
        if s in ("0", "1"):
            return 1 if s == str(numeric_fake_value) else 0
        return LABEL_MAP.get(s, None)

    cleaned_df["label"] = cleaned_df["raw_label"].apply(map_label)
    invalid_labels = int(cleaned_df["label"].isna().sum())
    cleaned_df = cleaned_df.dropna(subset=["label"]).copy()
    cleaned_df["label"] = cleaned_df["label"].astype(int)

    cleaned_df["dedupe_key"] = (
        cleaned_df["raw_text"].str.lower().str.replace(r"\s+", " ", regex=True).str[:400]
    )
    before_dedupe = len(cleaned_df)
    cleaned_df = cleaned_df.drop_duplicates(subset=["dedupe_key"]).drop(columns=["dedupe_key"])
    duplicates_removed = before_dedupe - len(cleaned_df)

    fake_count = int((cleaned_df["label"] == 1).sum())
    real_count = int((cleaned_df["label"] == 0).sum())
    if len(cleaned_df) < 12 or fake_count < 3 or real_count < 3:
        raise ValueError("Dataset must contain at least 12 valid rows with both REAL and FAKE examples.")

    warnings: List[str] = []
    imbalance_ratio = max(fake_count, real_count) / max(1, min(fake_count, real_count))
    if imbalance_ratio > 1.8:
        warnings.append(
            f"Class imbalance detected (REAL={real_count}, FAKE={fake_count}); class weighting applied."
        )

    sample_rows = [
        {
            "title": str(row["title"])[:140] or str(row["text"])[:80],
            "text": str(row["text"])[:220],
            "label": "FAKE" if int(row["label"]) == 1 else "REAL",
        }
        for _, row in cleaned_df.head(6).iterrows()
    ]

    stats = {
        "headers": headers,
        "total_rows": total_rows,
        "valid_rows": len(cleaned_df),
        "fake_count": fake_count,
        "real_count": real_count,
        "missing_removed": missing_removed,
        "invalid_labels_removed": invalid_labels,
        "duplicates_removed": duplicates_removed,
        "column_mapping": {"title_col": title_col, "text_col": text_col, "label_col": label_col},
        "sample_rows": sample_rows,
        "warnings": warnings,
    }
    return cleaned_df, stats


def build_pipeline(
    algorithm: str,
    max_features: int = 6500,
    ngram_max: int = 2,
    min_df: int = 2,
) -> Pipeline:
    vectorizer = TfidfVectorizer(
        max_features=max_features,
        ngram_range=(1, ngram_max),
        min_df=min_df,
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
    cv_folds: int = 3,
    remove_stopwords: bool = True,
    use_bigrams: bool = True,
    max_features: int = 6500,
    version: str = "v1.0.0",
    dataset_id: str = "",
    dataset_name: str = "TruthLens Dataset",
    title_col: Optional[str] = None,
    text_col: Optional[str] = None,
    label_col: Optional[str] = None,
    numeric_fake_value: str = "1",
) -> List[Dict]:
    if algorithms is None:
        algorithms = ["tfidf_logreg", "tfidf_nb", "tfidf_svm"]

    df, dataset_stats = load_and_clean_dataset(
        csv_path,
        title_col=title_col,
        text_col=text_col,
        label_col=label_col,
        numeric_fake_value=numeric_fake_value,
    )
    df["processed_text"] = df["raw_text"].apply(
        lambda t: preprocess_for_vectorizer(t, remove_stopwords=remove_stopwords)
    )

    X_train, X_test, y_train, y_test = train_test_split(
        df["processed_text"].values,
        df["label"].values,
        test_size=test_size,
        stratify=df["label"].values,
        random_state=42,
    )

    min_df = 1 if len(df) < 600 else 2
    ngram_max = 2 if use_bigrams else 1

    os.makedirs(models_dir, exist_ok=True)
    results = []

    for algo in algorithms:
        pipeline = build_pipeline(
            algo,
            max_features=max_features,
            ngram_max=ngram_max,
            min_df=min_df,
        )
        n_splits = max(2, min(cv_folds, int(np.bincount(y_train).min())))
        skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
        cv_out = cross_validate(pipeline, X_train, y_train, cv=skf, scoring=["accuracy", "f1"])

        pipeline.fit(X_train, y_train)
        y_pred = pipeline.predict(X_test)
        y_prob = pipeline.predict_proba(X_test)[:, 1]

        cm = confusion_matrix(y_test, y_pred, labels=[0, 1]).tolist()
        prec_arr, rec_arr, f1_arr, sup_arr = precision_recall_fscore_support(
            y_test, y_pred, labels=[0, 1], zero_division=0
        )

        metrics = {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision": float(precision_score(y_test, y_pred, zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, zero_division=0)),
            "f1_score": float(f1_score(y_test, y_pred, zero_division=0)),
            "roc_auc": float(roc_auc_score(y_test, y_prob)) if len(np.unique(y_test)) > 1 else 0.5,
            "brier_score": float(brier_score_loss(y_test, y_prob)),
            "per_class": {
                "real": {
                    "precision": float(prec_arr[0]),
                    "recall": float(rec_arr[0]),
                    "f1": float(f1_arr[0]),
                    "support": int(sup_arr[0]),
                },
                "fake": {
                    "precision": float(prec_arr[1]),
                    "recall": float(rec_arr[1]),
                    "f1": float(f1_arr[1]),
                    "support": int(sup_arr[1]),
                },
            },
            "confusion_matrix": cm,
            "cv_accuracy_mean": float(np.mean(cv_out["test_accuracy"])),
            "cv_f1_mean": float(np.mean(cv_out["test_f1"])),
            "train_size": int(len(X_train)),
            "test_size": int(len(X_test)),
        }

        model_id = str(uuid.uuid4())
        artifact_name = f"{model_id}.joblib"
        artifact_path = os.path.join(models_dir, artifact_name)
        trained_at = datetime.now(timezone.utc).isoformat()
        model_display = ALGORITHM_DISPLAY_NAMES.get(algo, algo)

        joblib.dump(
            {
                "id": model_id,
                "pipeline": pipeline,
                "model_name": model_display,
                "algorithm": algo,
                "version": version,
                "dataset_id": dataset_id,
                "dataset_name": dataset_name,
                "dataset_size": int(len(df)),
                "remove_stopwords": remove_stopwords,
                "use_bigrams": use_bigrams,
                "max_features": max_features,
                "min_df": min_df,
                "metrics": metrics,
                "dataset_stats": dataset_stats,
                "trained_at": trained_at,
            },
            artifact_path,
        )

        results.append(
            {
                "id": model_id,
                "model_name": model_display,
                "algorithm": algo,
                "version": version,
                "artifact_path": artifact_path,
                "metrics": metrics,
                "hyperparams": {
                    "removeStopwords": remove_stopwords,
                    "useBigrams": use_bigrams,
                    "maxFeatures": max_features,
                    "minDf": min_df,
                },
                "dataset_stats": dataset_stats,
                "trained_at": trained_at,
                "status": "trained",
            }
        )

    return results
