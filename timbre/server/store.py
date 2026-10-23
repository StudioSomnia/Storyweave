"""SQLite persistence for voices, reference clips, training jobs and generations."""

from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

EMOTIONS = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "excited",
    "calm",
    "fearful",
    "whisper",
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'en',
    consent INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    engine TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    model_meta TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL REFERENCES voices(id) ON DELETE CASCADE,
    emotion TEXT NOT NULL,
    path TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    transcript TEXT NOT NULL DEFAULT '',
    metrics TEXT NOT NULL DEFAULT '{}',
    created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS clips_voice ON clips(voice_id, emotion);

CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL,
    text TEXT NOT NULL,
    emotion TEXT NOT NULL,
    intensity REAL NOT NULL DEFAULT 1,
    speed REAL NOT NULL DEFAULT 1,
    language TEXT NOT NULL DEFAULT 'en',
    engine TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL,
    duration REAL NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS generations_created ON generations(created_at DESC);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    progress REAL NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    log TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL,
    finished_at REAL
);
"""


def _now() -> float:
    return time.time()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class Store:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.voices_root = self.root / "voices"
        self.outputs_root = self.root / "outputs"
        self.voices_root.mkdir(parents=True, exist_ok=True)
        self.outputs_root.mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "timbre.db"
        self._lock = threading.RLock()
        with self._db() as db:
            db.executescript(SCHEMA)
        self._recover_interrupted()

    # ------------------------------------------------------------------ infra

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def _db(self):
        with self._lock:
            conn = self._conn()
            try:
                yield conn
                conn.commit()
            finally:
                conn.close()

    def _recover_interrupted(self) -> None:
        """Jobs cannot survive a restart; mark them failed instead of spinning forever."""
        with self._db() as db:
            db.execute(
                "UPDATE jobs SET status='error', error=?, message=?, finished_at=? "
                "WHERE status IN ('queued','running')",
                ("Server restarted while this job was running.", "Interrupted", _now()),
            )
            db.execute(
                "UPDATE voices SET status='draft', error=? WHERE status='training'",
                ("Training was interrupted. Run it again.",),
            )

    def voice_dir(self, voice_id: str) -> Path:
        return self.voices_root / voice_id

    def clips_dir(self, voice_id: str) -> Path:
        return self.voice_dir(voice_id) / "clips"

    def model_dir(self, voice_id: str) -> Path:
        return self.voice_dir(voice_id) / "model"

    def output_path(self, generation_id: str) -> Path:
        return self.outputs_root / f"{generation_id}.wav"

    # ----------------------------------------------------------------- voices

    def create_voice(
        self, name: str, description: str, language: str, consent: bool
    ) -> dict:
        voice_id = new_id("v")
        now = _now()
        with self._db() as db:
            db.execute(
                "INSERT INTO voices (id, name, description, language, consent, status, "
                "created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)",
                (voice_id, name, description, language, 1 if consent else 0, now, now),
            )
        self.clips_dir(voice_id).mkdir(parents=True, exist_ok=True)
        self.model_dir(voice_id).mkdir(parents=True, exist_ok=True)
        return self.get_voice(voice_id)

    def list_voices(self) -> list[dict]:
        with self._db() as db:
            rows = db.execute("SELECT * FROM voices ORDER BY created_at DESC").fetchall()
            return [self._voice_row(db, row) for row in rows]

    def get_voice(self, voice_id: str) -> dict | None:
        with self._db() as db:
            row = db.execute("SELECT * FROM voices WHERE id=?", (voice_id,)).fetchone()
            return self._voice_row(db, row) if row else None

    def update_voice(self, voice_id: str, **fields: Any) -> dict | None:
        allowed = {"name", "description", "language", "status", "engine", "error"}
        patch = {k: v for k, v in fields.items() if k in allowed}
        if patch:
            patch["updated_at"] = _now()
            sets = ", ".join(f"{k}=?" for k in patch)
            with self._db() as db:
                db.execute(
                    f"UPDATE voices SET {sets} WHERE id=?",
                    (*patch.values(), voice_id),
                )
        return self.get_voice(voice_id)

    def set_model_meta(self, voice_id: str, meta: dict, *, status: str, engine: str = "") -> None:
        with self._db() as db:
            db.execute(
                "UPDATE voices SET model_meta=?, status=?, engine=?, error='', updated_at=? "
                "WHERE id=?",
                (json.dumps(meta), status, engine, _now(), voice_id),
            )

    def mark_stale(self, voice_id: str) -> None:
        """Samples changed after training — keep the model usable but flag it."""
        with self._db() as db:
            row = db.execute("SELECT model_meta, status FROM voices WHERE id=?", (voice_id,)).fetchone()
            if not row:
                return
            meta = json.loads(row["model_meta"] or "{}")
            if row["status"] == "ready" and meta.get("emotions"):
                meta["stale"] = True
                db.execute(
                    "UPDATE voices SET model_meta=?, updated_at=? WHERE id=?",
                    (json.dumps(meta), _now(), voice_id),
                )

    def delete_voice(self, voice_id: str) -> None:
        with self._db() as db:
            db.execute("DELETE FROM clips WHERE voice_id=?", (voice_id,))
            db.execute("DELETE FROM jobs WHERE voice_id=?", (voice_id,))
            db.execute("DELETE FROM voices WHERE id=?", (voice_id,))
            generation_paths = [
                row["path"]
                for row in db.execute(
                    "SELECT path FROM generations WHERE voice_id=?", (voice_id,)
                ).fetchall()
            ]
            db.execute("DELETE FROM generations WHERE voice_id=?", (voice_id,))
        for rel in generation_paths:
            (self.root / rel).unlink(missing_ok=True)
        shutil.rmtree(self.voice_dir(voice_id), ignore_errors=True)

    # ------------------------------------------------------------------ clips

    def add_clip(
        self,
        voice_id: str,
        emotion: str,
        path: Path,
        duration: float,
        transcript: str,
        metrics: dict,
    ) -> dict:
        clip_id = new_id("c")
        with self._db() as db:
            db.execute(
                "INSERT INTO clips (id, voice_id, emotion, path, duration, transcript, "
                "metrics, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    clip_id,
                    voice_id,
                    emotion,
                    str(path.relative_to(self.root)).replace("\\", "/"),
                    round(float(duration), 3),
                    transcript,
                    json.dumps(metrics),
                    _now(),
                ),
            )
            db.execute("UPDATE voices SET updated_at=? WHERE id=?", (_now(), voice_id))
        self.mark_stale(voice_id)
        return self.get_clip(clip_id)

    def list_clips(self, voice_id: str) -> list[dict]:
        with self._db() as db:
            rows = db.execute(
                "SELECT * FROM clips WHERE voice_id=? ORDER BY created_at ASC", (voice_id,)
            ).fetchall()
            return [self._clip_row(row) for row in rows]

    def get_clip(self, clip_id: str) -> dict | None:
        with self._db() as db:
            row = db.execute("SELECT * FROM clips WHERE id=?", (clip_id,)).fetchone()
            return self._clip_row(row) if row else None

    def delete_clip(self, clip_id: str) -> dict | None:
        with self._db() as db:
            row = db.execute("SELECT * FROM clips WHERE id=?", (clip_id,)).fetchone()
            if not row:
                return None
            db.execute("DELETE FROM clips WHERE id=?", (clip_id,))
            db.execute(
                "UPDATE voices SET updated_at=? WHERE id=?", (_now(), row["voice_id"])
            )
        (self.root / row["path"]).unlink(missing_ok=True)
        self.mark_stale(row["voice_id"])
        return self._clip_row(row)

    # ------------------------------------------------------------------- jobs

    def create_job(self, voice_id: str, kind: str) -> dict:
        job_id = new_id("j")
        with self._db() as db:
            db.execute(
                "INSERT INTO jobs (id, voice_id, kind, status, progress, message, log, created_at) "
                "VALUES (?, ?, ?, 'queued', 0, 'Queued', '', ?)",
                (job_id, voice_id, kind, _now()),
            )
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> dict | None:
        with self._db() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            return dict(row) if row else None

    def latest_job(self, voice_id: str, kind: str | None = None) -> dict | None:
        query = "SELECT * FROM jobs WHERE voice_id=?"
        args: list[Any] = [voice_id]
        if kind:
            query += " AND kind=?"
            args.append(kind)
        query += " ORDER BY created_at DESC LIMIT 1"
        with self._db() as db:
            row = db.execute(query, args).fetchone()
            return dict(row) if row else None

    def update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: float | None = None,
        message: str | None = None,
        log_line: str | None = None,
        error: str | None = None,
        finished: bool = False,
    ) -> None:
        fields: dict[str, Any] = {}
        if status is not None:
            fields["status"] = status
        if progress is not None:
            fields["progress"] = max(0.0, min(100.0, float(progress)))
        if message is not None:
            fields["message"] = message
        if error is not None:
            fields["error"] = error
        if finished:
            fields["finished_at"] = _now()
        if log_line:
            with self._db() as db:
                row = db.execute("SELECT log FROM jobs WHERE id=?", (job_id,)).fetchone()
                previous = (row["log"] if row else "") or ""
                fields["log"] = (previous + log_line.rstrip() + "\n")[-20000:]
        if not fields:
            return
        sets = ", ".join(f"{k}=?" for k in fields)
        with self._db() as db:
            db.execute(f"UPDATE jobs SET {sets} WHERE id=?", (*fields.values(), job_id))

    # ------------------------------------------------------------ generations

    def add_generation(
        self,
        *,
        generation_id: str,
        voice_id: str,
        text: str,
        emotion: str,
        intensity: float,
        speed: float,
        language: str,
        engine: str,
        path: Path,
        duration: float,
    ) -> dict:
        with self._db() as db:
            db.execute(
                "INSERT INTO generations (id, voice_id, text, emotion, intensity, speed, "
                "language, engine, path, duration, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    generation_id,
                    voice_id,
                    text,
                    emotion,
                    intensity,
                    speed,
                    language,
                    engine,
                    str(path.relative_to(self.root)).replace("\\", "/"),
                    duration,
                    _now(),
                ),
            )
        return self.get_generation(generation_id)

    def get_generation(self, generation_id: str) -> dict | None:
        with self._db() as db:
            row = db.execute(
                "SELECT * FROM generations WHERE id=?", (generation_id,)
            ).fetchone()
            return self._generation_row(row) if row else None

    def list_generations(self, limit: int = 100) -> list[dict]:
        with self._db() as db:
            rows = db.execute(
                "SELECT * FROM generations ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [self._generation_row(row) for row in rows]

    def delete_generation(self, generation_id: str) -> dict | None:
        generation = self.get_generation(generation_id)
        if not generation:
            return None
        with self._db() as db:
            db.execute("DELETE FROM generations WHERE id=?", (generation_id,))
        (self.root / generation["path"]).unlink(missing_ok=True)
        return generation

    # ------------------------------------------------------------------ mappers

    def _voice_row(self, db: sqlite3.Connection, row: sqlite3.Row) -> dict:
        voice = dict(row)
        voice["consent"] = bool(voice["consent"])
        voice["model"] = json.loads(voice.pop("model_meta") or "{}")
        clips = db.execute(
            "SELECT emotion, COUNT(*) AS count, COALESCE(SUM(duration), 0) AS seconds "
            "FROM clips WHERE voice_id=? GROUP BY emotion",
            (voice["id"],),
        ).fetchall()
        samples = {
            c["emotion"]: {
                "count": c["count"],
                "seconds": round(c["seconds"], 2),
            }
            for c in clips
        }
        voice["samples"] = samples
        voice["clip_count"] = sum(s["count"] for s in samples.values())
        voice["total_seconds"] = round(sum(s["seconds"] for s in samples.values()), 2)
        voice["emotions_ready"] = sorted(
            voice["model"].get("emotions", {}).keys(),
            key=lambda e: EMOTIONS.index(e) if e in EMOTIONS else 99,
        )
        return voice

    def _clip_row(self, row: sqlite3.Row) -> dict:
        clip = dict(row)
        clip["metrics"] = json.loads(clip["metrics"] or "{}")
        clip["url"] = f"/api/clips/{clip['id']}/audio"
        return clip

    def _generation_row(self, row: sqlite3.Row) -> dict:
        generation = dict(row)
        generation["url"] = f"/api/generations/{generation['id']}/audio"
        return generation
