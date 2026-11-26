"""Keeps the wizard_api tests off any database that is not a test database (#278).

After each test the ``db_session`` fixture (conftest.py) deletes every row of the
sessions, blueprint versions and usage tables, so the suite must never run against a
database that someone keeps data in. ``conftest.pytest_configure`` calls ``check``
before the first test and stops the run with the message it returns.

- A database that answers must have a name that marks it as a test database: the word
  ``test`` or ``tests`` in it, set off by ``_``, ``-`` or ``.`` (``wizard_test``,
  ``test_wizard``). The name is the one the server reports for the open connection
  (``current_database()``), not the one the URL asks for. The API's default URL, used
  when ``WIZARD_DATABASE_URL`` is unset, names ``wizard``, the local stack's database,
  so that one is refused.
- When nothing answers, the run goes on and the tests that need Postgres skip, as
  before: there is no database to protect. A test database that the server reports
  missing stops the run instead, since every Postgres test would skip without a word.
- A test database at another Alembic revision than this checkout's head, or one
  without Alembic whose tables lack a column the models define, stops the run: its
  tables are older than the code, and hundreds of tests would fail for that reason
  alone.

The guard only connects and reads; it never writes to the database it checks. Its
messages describe the connection by driver, user, host, port and database only, never
by a password or the URL's connection options.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from alembic.script import ScriptDirectory
from sqlalchemy import MetaData, create_engine, inspect, make_url, text
from sqlalchemy.engine import URL, Connection
from sqlalchemy.exc import ArgumentError, OperationalError

ALEMBIC_DIR = Path(__file__).resolve().parents[1] / "alembic"

TEST_DATABASE_NAME = re.compile(r"(?:^|[._-])tests?(?:$|[._-])", re.IGNORECASE)

# Every Postgres server has one of these; the guard reads the catalogue through it.
_MAINTENANCE_DATABASES = ("postgres", "template1")

_PREFIX = "wizard_api tests:"


def is_test_database_name(name: str | None) -> bool:
    return bool(name) and TEST_DATABASE_NAME.search(name) is not None


def alembic_heads() -> set[str]:
    return set(ScriptDirectory(str(ALEMBIC_DIR)).get_heads())


def compose_test_url() -> str:
    """``wizard_test`` on the compose Postgres (docker-compose.yml), whose credentials are
    in the repository, on the host port the stack publishes it on: ``POSTGRES_HOST_PORT``,
    5432 unless that is set."""
    port = os.environ.get("POSTGRES_HOST_PORT") or "5432"
    return f"postgresql+psycopg://wizard:wizard@localhost:{port}/wizard_test"


def _described(url: URL) -> str:
    """The connection for a message, from fields that carry no credential: driver, user,
    host, port and database, with a password masked. The URL's connection options are
    left out, since some of them can carry credentials as well."""
    shown = URL.create(
        url.drivername,
        username=url.username,
        password="x" if url.password else None,
        host=url.host,
        port=url.port,
        database=url.database,
    ).render_as_string(hide_password=True)
    return shown + (", connection options not shown" if url.query else "")


def name_problem(url: URL, reached: str | None = None) -> str | None:
    """Why the tests must not use the database the connection reached, or None if they may.

    ``reached`` is the name the server reports for the open connection; without it, the
    name in ``url``.
    """
    database = url.database if reached is None else reached
    if is_test_database_name(database):
        return None
    where = _described(url)
    if database != url.database:
        where += f'; the connection reached "{database}", not "{url.database}"'
    return (
        f'{_PREFIX} refusing to use database "{database}" ({where}).\n'
        "After each test they delete every session, blueprint version and usage row, so "
        "they run only against a database whose name marks it as a test database: "
        '"test" as a word in the name, such as wizard_test.\n'
        "Set WIZARD_DATABASE_URL to such a database; when it is unset, the tests use the "
        "API's default, the local stack's database \"wizard\". For the compose Postgres:\n"
        "  docker compose exec postgres createdb -U wizard wizard_test\n"
        f"  export WIZARD_DATABASE_URL={compose_test_url()}"
        "   # the port: POSTGRES_HOST_PORT, 5432 unless set\n"
        "Or run the suite in Docker, which recreates wizard_test for each run:\n"
        "  scripts/docker-test.sh --step api"
    )


def missing_database_problem(url: URL) -> str:
    return (
        f'{_PREFIX} the test database "{url.database}" does not exist on the server at '
        f"{_described(url)}, so every test that needs Postgres would skip.\n"
        "Create it; for the compose Postgres:\n"
        f"  docker compose exec postgres createdb -U {url.username or 'wizard'} {url.database}"
    )


def schema_problem(conn: Connection, url: URL, metadata: MetaData, heads: set[str]) -> str | None:
    """Why the tables in ``conn``'s database do not fit the models, or None if they do.

    With an ``alembic_version`` table the database must be at ``heads``. Without one the
    tables came from ``metadata.create_all``, which adds a missing table but never a
    missing column, so every column the models define must already be there.
    """
    database, user = url.database, url.username or "wizard"
    inspector = inspect(conn)
    if inspector.has_table("alembic_version"):
        current = {row[0] for row in conn.execute(text("SELECT version_num FROM alembic_version"))}
        if current == heads:
            return None
        return (
            f'{_PREFIX} the test database "{database}" is at Alembic revision '
            f"{', '.join(sorted(current)) or '(none)'}, and this checkout's migrations end "
            f"at {', '.join(sorted(heads))}. Its tables do not match the models, and most "
            "tests would fail for that reason alone.\n"
            "Migrate it from implementation_layer/wizard_api, with WIZARD_DATABASE_URL "
            "pointing at it:\n"
            "  alembic upgrade head\n"
            "or drop it and create it empty; the tests then create the tables from the "
            "models."
        )

    gaps = []
    for table in metadata.sorted_tables:
        if not inspector.has_table(table.name, schema=table.schema):
            continue
        present = {c["name"] for c in inspector.get_columns(table.name, schema=table.schema)}
        missing = [c.name for c in table.columns if c.name not in present]
        if missing:
            gaps.append(f"{table.name} lacks {', '.join(missing)}")
    if not gaps:
        return None
    return (
        f'{_PREFIX} in the test database "{database}", '
        + "; ".join(gaps)
        + ". The models define these columns, but the tables were created from older "
        "models: the tests add a missing table, never a missing column, and most tests "
        "would fail for that reason alone.\n"
        "Drop the database and create it empty; for the compose Postgres:\n"
        f"  docker compose exec postgres dropdb -U {user} {database}\n"
        f"  docker compose exec postgres createdb -U {user} {database}"
    )


def database_is_missing(url: URL) -> bool:
    """Whether the server at ``url`` answers and has no database of ``url``'s name.

    Read from the server's catalogue through a maintenance database. A failed connect
    does not say it: psycopg 3 leaves the SQLSTATE of a connection failure unset
    (``sqlstate`` and ``diag.sqlstate`` are None), and the message is in the server's
    language.
    """
    for maintenance in _MAINTENANCE_DATABASES:
        engine = create_engine(url.set(database=maintenance))
        try:
            with engine.connect() as conn:
                found = conn.execute(
                    text("SELECT 1 FROM pg_database WHERE datname = :name"),
                    {"name": url.database},
                ).first()
            return found is None
        except Exception:
            continue
        finally:
            engine.dispose()
    return False


def check(url: str, metadata: MetaData) -> str | None:
    """The reason the suite must not run against ``url``, or None when it may."""
    try:
        parsed = make_url(url)
    except ArgumentError:
        # The URL itself is not shown: it may carry a password.
        return f"{_PREFIX} WIZARD_DATABASE_URL is not a database URL."
    try:
        engine = create_engine(parsed)
    except Exception:
        return None  # a driver that is not installed: nothing can be reached
    try:
        try:
            conn = engine.connect()
        except OperationalError:
            if is_test_database_name(parsed.database) and database_is_missing(parsed):
                return missing_database_problem(parsed)
            return None  # nothing answers; the Postgres tests skip
        except Exception:
            return None
        with conn:
            # The name in the URL is a request; the server says where the connection is.
            reached = conn.execute(text("SELECT current_database()")).scalar()
            return name_problem(parsed, reached) or schema_problem(
                conn, parsed.set(database=reached), metadata, alembic_heads()
            )
    finally:
        engine.dispose()
