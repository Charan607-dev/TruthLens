import html
import re
from typing import List, Set

try:
    import nltk
    from nltk.corpus import stopwords
    from nltk.tokenize import word_tokenize
except Exception:
    nltk = None
    stopwords = None
    word_tokenize = None

FALLBACK_STOPWORDS: Set[str] = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "as", "at",
    "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
    "can", "could", "did", "do", "does", "doing", "down", "during",
    "each", "few", "for", "from", "further",
    "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him", "himself", "his", "how",
    "i", "if", "in", "into", "is", "it", "its", "itself",
    "just", "me", "more", "most", "my", "myself",
    "no", "nor", "not", "now", "of", "off", "on", "once", "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own",
    "same", "she", "should", "so", "some", "such",
    "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too",
    "under", "until", "up", "very",
    "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will", "with", "would",
    "you", "your", "yours", "yourself", "yourselves",
}

_NLTK_READY: bool | None = None


def ensure_nltk_resources() -> bool:
    global _NLTK_READY
    if _NLTK_READY is not None:
        return _NLTK_READY
    if nltk is None:
        _NLTK_READY = False
        return False

    try:
        for resource, path in [
            ("punkt", "tokenizers/punkt"),
            ("punkt_tab", "tokenizers/punkt_tab"),
            ("stopwords", "corpora/stopwords"),
        ]:
            try:
                nltk.data.find(path)
            except LookupError:
                nltk.download(resource, quiet=True)
        _NLTK_READY = True
    except Exception:
        _NLTK_READY = False
    return _NLTK_READY


def get_stopwords() -> Set[str]:
    if ensure_nltk_resources() and stopwords is not None:
        try:
            return set(stopwords.words("english"))
        except Exception:
            pass
    return FALLBACK_STOPWORDS


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
    cleaned = clean_text(raw_text)
    if not cleaned:
        return []

    tokens: List[str]
    if ensure_nltk_resources() and word_tokenize is not None:
        try:
            tokens = word_tokenize(cleaned)
        except Exception:
            tokens = re.findall(r"[a-z0-9]+", cleaned)
    else:
        tokens = re.findall(r"[a-z0-9]+", cleaned)

    tokens = [t for t in tokens if len(t) >= 2 and (not t.isdigit() or bool(re.fullmatch(r"\d{4}", t)))]
    if remove_stopwords:
        sw = get_stopwords()
        tokens = [t for t in tokens if t not in sw]
    return tokens


def preprocess_for_vectorizer(raw_text: str, remove_stopwords: bool = True) -> str:
    return " ".join(tokenize_text(raw_text, remove_stopwords=remove_stopwords))
