import re
import html
from typing import List, Set
import nltk
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize


def ensure_nltk_resources() -> None:
    for resource, path in [
        ("punkt", "tokenizers/punkt"),
        ("punkt_tab", "tokenizers/punkt_tab"),
        ("stopwords", "corpora/stopwords"),
    ]:
        try:
            nltk.data.find(path)
        except LookupError:
            nltk.download(resource, quiet=True)


def get_stopwords() -> Set[str]:
    ensure_nltk_resources()
    return set(stopwords.words("english"))


def clean_text(raw_text: str) -> str:
    if not isinstance(raw_text, str):
        return ""
    text = html.unescape(raw_text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"https?://\S+|www\.\S+", " ", text)
    text = re.sub(r"\S+@\S+\.\S+", " ", text)
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def tokenize_text(raw_text: str, remove_stopwords: bool = True) -> List[str]:
    ensure_nltk_resources()
    cleaned = clean_text(raw_text)
    if not cleaned:
        return []
    tokens = word_tokenize(cleaned)
    tokens = [t for t in tokens if len(t) >= 2 and (not t.isdigit() or bool(re.fullmatch(r"\d{4}", t)))]
    if remove_stopwords:
        sw = get_stopwords()
        tokens = [t for t in tokens if t not in sw]
    return tokens


def preprocess_for_vectorizer(raw_text: str, remove_stopwords: bool = True) -> str:
    return " ".join(tokenize_text(raw_text, remove_stopwords=remove_stopwords))
