"""Encryption at rest for what the users wrote, in the wizard's database.

The conversation and the session's other state (``wizard_sessions.metadata``)
and the blueprints (``blueprint_versions.content`` and ``draft``) are stored
encrypted with AES-256-GCM (``EncryptedJSON``); the api decrypts on read.

Keys come from ``WIZARD_DATA_KEYS``: ``<id>:<base64 of 32 bytes>``, several
separated by commas. The first one encrypts; every listed one decrypts.
``start`` (run before the api serves) brings every stored value onto the first
key. A stored value encrypted for a key that is not listed is an error, never
an empty value.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import func, or_, select, text, type_coerce, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import TypeDecorator

from wizard_api import config

logger = logging.getLogger(__name__)

KEYS_ENV = config.DATA_KEYS_ENV
#: The JSON key an encrypted value is stored under.
ENC = "_enc"
_FORMAT = "v1"
_KEY_ID = re.compile(r"[A-Za-z0-9_-]{1,32}")
_NONCE = 12


class DataKeyError(RuntimeError):
    """The keys are malformed, or a stored value cannot be decrypted with them."""


@dataclass(frozen=True)
class DataKeys:
    current: str
    keys: dict[str, bytes]


def parse_keys(raw: str | None) -> DataKeys | None:
    """``id:base64,...`` -> keys; None when nothing is set. Raises on a bad entry.

    The messages name the key id, never a key.
    """
    if raw is None or not raw.strip():
        return None
    keys: dict[str, bytes] = {}
    order: list[str] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        key_id, sep, encoded = entry.partition(":")
        key_id = key_id.strip()
        if not sep or not _KEY_ID.fullmatch(key_id):
            raise DataKeyError(f"{KEYS_ENV}: an entry is not <id>:<base64 key>")
        if key_id in keys:
            raise DataKeyError(f"{KEYS_ENV}: key id {key_id} is listed twice")
        try:
            key = base64.b64decode(encoded.strip(), validate=True)
        except (binascii.Error, ValueError):
            raise DataKeyError(f"{KEYS_ENV}: key {key_id} is not base64") from None
        if len(key) != 32:
            raise DataKeyError(f"{KEYS_ENV}: key {key_id} is not 32 bytes")
        keys[key_id] = key
        order.append(key_id)
    if not order:
        return None
    return DataKeys(current=order[0], keys=keys)


_cache: tuple[str | None, DataKeys | None] | None = None
#: Set by ``write_plain``: values are written unencrypted, to go back to an api
#: from before encryption.
_write_plain = False
#: ``1``: the api writes everything unencrypted, still reading what is
#: encrypted, and writes it all back plain at start (going back to an older api).
PLAIN_ENV = "WIZARD_DATA_WRITE_PLAIN"


def plain_writes() -> bool:
    return _write_plain or os.environ.get(PLAIN_ENV, "").strip() == "1"


def data_keys() -> DataKeys | None:
    """The keys, parsed once per value of ``WIZARD_DATA_KEYS``."""
    global _cache
    raw = config.get_data_keys_raw()
    if _cache is None or _cache[0] != raw:
        _cache = (raw, parse_keys(raw))
    return _cache[1]


def new_key() -> str:
    """A fresh key, base64, for an entry of ``WIZARD_DATA_KEYS``."""
    return base64.b64encode(os.urandom(32)).decode()


def key_id_of(value: Any) -> str | None:
    """The key a stored value is encrypted for; None for a plain value."""
    if not isinstance(value, dict) or not isinstance(value.get(ENC), str):
        return None
    parts = value[ENC].split(":", 2)
    return parts[1] if len(parts) == 3 and parts[0] == _FORMAT else None


def _seal(plain: bytes, keys: DataKeys, aad: bytes) -> str:
    nonce = os.urandom(_NONCE)
    sealed = AESGCM(keys.keys[keys.current]).encrypt(nonce, plain, aad)
    return f"{_FORMAT}:{keys.current}:{base64.b64encode(nonce + sealed).decode()}"


def _open(token: str, keys: DataKeys | None, aad: bytes) -> bytes:
    fmt, _, rest = token.partition(":")
    key_id, _, body = rest.partition(":")
    if fmt != _FORMAT or not key_id or not body:
        raise DataKeyError("a stored value is not in a known encrypted form")
    if keys is None or key_id not in keys.keys:
        raise DataKeyError(
            f"a stored value is encrypted for key {key_id}, which {KEYS_ENV} does not list"
        )
    try:
        raw = base64.b64decode(body, validate=True)
        return AESGCM(keys.keys[key_id]).decrypt(raw[:_NONCE], raw[_NONCE:], aad)
    except Exception as exc:  # noqa: BLE001 - wrong key, wrong column or a changed value
        raise DataKeyError(f"a stored value does not decrypt with key {key_id}") from exc


class EncryptedJSON(TypeDecorator):
    """A JSON value stored encrypted inside a JSONB column.

    Stored form: ``{"_enc": "v1:<key id>:<base64 nonce + ciphertext>"}``, plus
    the top-level keys named in ``plain_keys``, which stay readable so SQL can
    read them (conversation ids, nothing a user wrote). A value stored before
    encryption (no ``_enc``) is read as it is and encrypted when next written.
    ``aad`` binds a ciphertext to its column: moved to another, it does not open.
    """

    impl = JSONB
    cache_ok = True

    def __init__(self, aad: str, plain_keys: tuple[str, ...] = (), none_as_null: bool = False):
        super().__init__(none_as_null=none_as_null)
        self.aad = aad
        self.plain_keys = plain_keys

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        if isinstance(value, dict) and ENC in value:
            # Stored as it is, the value would later be read as an encrypted one.
            raise ValueError(f"{self.aad}: the key {ENC} is reserved for encrypted values")
        keys = data_keys()
        if value is None or keys is None or plain_writes():
            return value
        if isinstance(value, dict):
            kept = {k: value[k] for k in self.plain_keys if k in value}
            rest: Any = {k: v for k, v in value.items() if k not in self.plain_keys}
        else:
            kept, rest = {}, value
        plain = json.dumps(rest, separators=(",", ":"), ensure_ascii=False).encode()
        return {**kept, ENC: _seal(plain, keys, self.aad.encode())}

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        if not isinstance(value, dict) or not isinstance(value.get(ENC), str):
            return value
        rest = json.loads(_open(value[ENC], data_keys(), self.aad.encode()))
        if isinstance(rest, dict):
            return {**{k: v for k, v in value.items() if k != ENC}, **rest}
        return rest


def stored_json(column: Any) -> Any:
    """``column`` as the JSONB it is stored as, for SQL that reads a plain key."""
    return type_coerce(column, JSONB)


# --- the columns, and writing them again with the current key ----------------


def _columns() -> list[tuple[Any, Any, Any]]:
    """(table, primary key column, encrypted column) for each encrypted column."""
    from wizard_api.models.blueprint_version import BlueprintVersion  # noqa: PLC0415
    from wizard_api.models.wizard_session import WizardSession  # noqa: PLC0415

    sessions = WizardSession.__table__
    versions = BlueprintVersion.__table__
    return [
        (sessions, sessions.c.id, sessions.c.metadata),
        (versions, versions.c.id, versions.c.content),
        (versions, versions.c.id, versions.c.draft),
    ]


def column_state(db: Any) -> dict[str, dict[str, int]]:
    """Rows per column: how many are plain and how many each key encrypts."""
    state: dict[str, dict[str, int]] = {}
    for table, _, column in _columns():
        rows = db.execute(
            text(
                f"SELECT CASE WHEN {column.name} ? '{ENC}' "  # noqa: S608 - fixed names
                f"THEN split_part({column.name}->>'{ENC}', ':', 2) ELSE 'plain' END, count(*) "
                f"FROM {table.name} WHERE {column.name} IS NOT NULL GROUP BY 1"
            )
        ).all()
        state[f"{table.name}.{column.name}"] = {str(k): int(n) for k, n in rows}
    return state


def _once(done: set[Any], row_id: Any, column: Any) -> None:
    """A row that comes back after it was written was not written as meant: stop."""
    if row_id in done:
        raise DataKeyError(f"{column.table.name}.{column.name} {row_id} was not rewritten")
    done.add(row_id)


def reencrypt(db: Any, batch: int = 50) -> int:
    """Write every value that is plain or on an older key again, with the current key.

    Idempotent; returns how many values it wrote. Each batch commits on its
    own, so a restart in the middle loses nothing. The rows are updated with
    plain UPDATEs, so ``updated_at`` (which the 90-day removal reads) stays as
    it was.
    """
    keys = data_keys()
    if keys is None:
        return 0
    written = 0
    for table, pk, column in _columns():
        # Compared as plain JSONB: through EncryptedJSON the operands would be
        # encrypted too.
        stored = type_coerce(column, JSONB)
        stale = column.is_not(None) & or_(
            ~stored.has_key(ENC),
            func.split_part(stored[ENC].astext, ":", 2) != keys.current,
        )
        done: set[Any] = set()
        while True:
            rows = db.execute(select(pk, column).where(stale).limit(batch)).all()
            if not rows:
                break
            for row_id, value in rows:
                _once(done, row_id, column)
                values: dict[str, Any] = {column.name: value}
                if "updated_at" in table.c:
                    values["updated_at"] = table.c.updated_at
                db.execute(update(table).where(pk == row_id).values(**values))
            written += len(rows)
            db.commit()
    return written


def write_plain(db: Any, batch: int = 50) -> int:
    """Write every encrypted value back plain (the keys must still be listed).

    For taking an api image from before encryption back into use; afterwards
    start the api without ``WIZARD_DATA_KEYS``, or it encrypts again at start.
    """
    global _write_plain
    written = 0
    _write_plain = True
    try:
        for table, pk, column in _columns():
            sealed = type_coerce(column, JSONB).has_key(ENC)
            done: set[Any] = set()
            while True:
                rows = db.execute(select(pk, column).where(sealed).limit(batch)).all()
                if not rows:
                    break
                for row_id, value in rows:
                    _once(done, row_id, column)
                    values: dict[str, Any] = {column.name: value}
                    if "updated_at" in table.c:
                        values["updated_at"] = table.c.updated_at
                    db.execute(update(table).where(pk == row_id).values(**values))
                written += len(rows)
                db.commit()
    finally:
        _write_plain = False
    return written


def startup_report(db: Any) -> str:
    """One line for the api's log at start: on or off, and with which key."""
    keys = data_keys()
    if keys is None:
        return (
            f"{KEYS_ENV} is not set: conversations and blueprints are stored in the "
            "database unencrypted. Set it in any deployed environment."
        )
    state = column_state(db)
    left = sum(n for counts in state.values() for k, n in counts.items() if k != keys.current)
    if plain_writes():
        sealed = sum(n for counts in state.values() for k, n in counts.items() if k != "plain")
        return f"{PLAIN_ENV}=1: writing plain; {sealed} values still encrypted"
    return f"data at rest encrypted with key {keys.current}; {left} values not on it"


def start(db: Any) -> int:
    """What the api runs before it serves (Dockerfile). Non-zero stops the start.

    - Keys set: everything plain or on an older key is written with the current one,
      or, with ``WIZARD_DATA_WRITE_PLAIN=1``, everything is written back plain.
    - No keys, nothing encrypted: plain as before, said in the log.
    - No keys but encrypted values stored: refuse to start. Serving then would
      fail on every such session; the key must be set again first.
    """
    keys = data_keys()
    if keys is None:
        sealed = sum(
            n for counts in column_state(db).values() for k, n in counts.items() if k != "plain"
        )
        if sealed:
            print(
                f"{KEYS_ENV} is not set, but {sealed} stored values are encrypted: "
                "set the keys again before the api starts (README, Encryption at rest)."
            )
            return 1
    elif plain_writes():
        print(f"wrote {write_plain(db)} values plain ({PLAIN_ENV}=1)")
    else:
        print(f"re-encrypted {reencrypt(db)} values with key {keys.current}")
    print(startup_report(db))
    return 0


def main(argv: list[str]) -> int:
    """``start`` | ``status`` | ``reencrypt`` | ``write-plain`` | ``new-key``."""
    command = argv[0] if argv else "status"
    if command == "new-key":
        print(new_key())
        return 0
    if command not in ("start", "status", "reencrypt", "write-plain"):
        print(
            "usage: python -m wizard_api.data_crypto [start|status|reencrypt|write-plain|new-key]"
        )
        return 2
    from wizard_api.db import SessionLocal  # noqa: PLC0415

    keys = data_keys()
    with SessionLocal() as db:
        if command == "start":
            return start(db)
        if command == "reencrypt" and keys is not None:
            print(f"re-encrypted {reencrypt(db)} values with key {keys.current}")
        if command == "write-plain":
            print(f"wrote {write_plain(db)} values plain; start the api without {KEYS_ENV} now")
        print(startup_report(db))
        for column, counts in column_state(db).items():
            print(f"  {column}: " + ", ".join(f"{k} {n}" for k, n in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    # Run through the imported module: with ``python -m`` this file is also
    # ``__main__``, and the column types use ``wizard_api.data_crypto``'s state.
    from wizard_api import data_crypto as _module

    sys.exit(_module.main(sys.argv[1:]))
