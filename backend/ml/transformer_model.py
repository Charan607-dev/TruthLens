"""
Optional DistilBERT Transformer Classifier for TruthLens AI.
Requires torch and transformers packages installed in a GPU/CPU Python environment.
"""
from typing import Dict, List


def train_distilbert_classifier(
    texts: List[str],
    labels: List[int],
    output_dir: str,
    epochs: int = 3,
    batch_size: int = 16,
) -> Dict:
    try:
        import torch
        from transformers import (
            AutoModelForSequenceClassification,
            AutoTokenizer,
            Trainer,
            TrainingArguments,
        )
        from sklearn.model_selection import train_test_split
    except ImportError as exc:
        raise RuntimeError(
            "DistilBERT training requires 'torch' and 'transformers'. Install them in requirements.txt."
        ) from exc

    X_train, X_val, y_train, y_val = train_test_split(
        texts, labels, test_size=0.2, stratify=labels, random_state=42
    )

    model_ckpt = "distilbert-base-uncased"
    tokenizer = AutoTokenizer.from_pretrained(model_ckpt)
    train_enc = tokenizer(X_train, truncation=True, padding=True, max_length=256)
    val_enc = tokenizer(X_val, truncation=True, padding=True, max_length=256)

    class NewsDataset(torch.utils.data.Dataset):
        def __init__(self, encodings, targets):
            self.encodings = encodings
            self.targets = targets

        def __getitem__(self, idx):
            item = {k: torch.tensor(v[idx]) for k, v in self.encodings.items()}
            item["labels"] = torch.tensor(self.targets[idx], dtype=torch.long)
            return item

        def __len__(self):
            return len(self.targets)

    model = AutoModelForSequenceClassification.from_pretrained(model_ckpt, num_labels=2)
    args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        per_device_eval_batch_size=batch_size,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        logging_steps=20,
    )
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=NewsDataset(train_enc, y_train),
        eval_dataset=NewsDataset(val_enc, y_val),
    )
    trainer.train()
    eval_metrics = trainer.evaluate()
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    return {"status": "trained", "output_dir": output_dir, "eval_metrics": eval_metrics}
