"""The guard that keeps the suite off a database that is not a test database (#278).

``conftest.pytest_configure`` stops the run with ``database_guard.check``'s message.
The pure parts are checked here without Postgres (the schema checks on SQLite); the
parts that need a server use this suite's own and the server's ``postgres`` database,
which the guard only connects to and reads.
"""

import os
import subprocess
import sys
import uuid
from pathlib import Path

import database_guard
import pytest
from helpers import requires_postgres
from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, make_url, text
from wizard_api.config import get_database_url
from wizard_api.models import Base

API_ROOT = Path(__file__).resolve().parents[1]
UNREACHABLE_URL = "postgresql+psycopg://wizard:wizard@127.0.0.1:1/wizard?connect_timeout=2"


@pytest.mark.parametrize(
    "name",
    ["wizard_test", "test_wizard", "wizard-tests", "wizard.test", "test", "WIZARD_TEST_2"],
)
def test_a_name_with_test_as_a_word_is_a_test_database(name):
    assert database_guard.is_test_database_name(name)


@pytest.mark.parametrize(
    "name", ["wizard", "wizard_v2", "latest", "contest", "wizardtest", "attestation", "", None]
)
def test_a_name_without_test_as_a_word_is_not_a_test_database(name):
    assert not database_guard.is_test_database_name(name)


def test_the_default_url_is_refused_and_the_message_says_what_to_set(monkeypatch):
    monkeypatch.delenv("POSTGRES_HOST_PORT", raising=False)
    problem = database_guard.name_problem(
        make_url("postgresql+psycopg://wizard:wizard@localhost:5432/wizard")
    )
    assert problem is not None
    assert 'refusing to use database "wizard"' in problem
    assert "WIZARD_DATABASE_URL" in problem
    assert "postgresql+psycopg://wizard:wizard@localhost:5432/wizard_test" in problem
    assert "scripts/docker-test.sh --step api" in problem


def test_the_suggested_url_has_the_port_the_compose_postgres_is_published_on(monkeypatch):
    monkeypatch.setenv("POSTGRES_HOST_PORT", "5435")
    problem = database_guard.name_problem(make_url("postgresql+psycopg://w:w@localhost/wizard"))
    assert "@localhost:5435/wizard_test" in problem


def test_test_in_the_user_or_host_does_not_make_a_test_database():
    url = make_url("postgresql+psycopg://test:pw@test-db:5432/wizard")
    assert database_guard.name_problem(url) is not None


def test_a_refusal_does_not_show_the_password():
    url = make_url("postgresql+psycopg://wizard:s3cret-pw@db.example:5432/wizard")
    assert "s3cret-pw" not in database_guard.name_problem(url)
    missing = make_url("postgresql+psycopg://wizard:s3cret-pw@db.example:5432/wizard_test")
    assert "s3cret-pw" not in database_guard.missing_database_problem(missing)


def test_a_url_that_does_not_parse_is_refused_without_repeating_it():
    problem = database_guard.check("not-a-url-s3cret", Base.metadata)
    assert problem is not None
    assert "s3cret" not in problem


def test_nothing_answering_lets_the_run_go_on():
    assert database_guard.check(UNREACHABLE_URL, Base.metadata) is None


def test_a_server_that_does_not_answer_does_not_count_as_missing_the_database():
    unreachable = make_url(UNREACHABLE_URL).set(database="wizard_test")
    assert not database_guard.database_is_missing(unreachable)


def test_the_migrations_have_one_head():
    # Two heads would mean a merge migration is missing; the guard compares against all.
    assert len(database_guard.alembic_heads()) == 1


# --- Schema checks, on SQLite -----------------------------------------------------------

SQLITE = make_url("sqlite://")


def _models() -> MetaData:
    metadata = MetaData()
    Table("sessions", metadata, Column("id", Integer, primary_key=True), Column("note", String))
    Table("usage", metadata, Column("id", Integer, primary_key=True))
    return metadata


def _database(*statements: str):
    engine = create_engine(SQLITE)
    conn = engine.connect()
    for statement in statements:
        conn.execute(text(statement))
    return engine, conn


def test_an_empty_database_fits_the_models():
    engine, conn = _database()
    with conn:
        assert database_guard.schema_problem(conn, SQLITE, _models(), {"005"}) is None
    engine.dispose()


def test_tables_made_from_the_current_models_fit():
    engine, conn = _database(
        "CREATE TABLE sessions (id INTEGER PRIMARY KEY, note VARCHAR)",
        "CREATE TABLE usage (id INTEGER PRIMARY KEY)",
    )
    with conn:
        assert database_guard.schema_problem(conn, SQLITE, _models(), {"005"}) is None
    engine.dispose()


def test_a_table_without_a_column_of_the_models_stops_the_run():
    engine, conn = _database("CREATE TABLE sessions (id INTEGER PRIMARY KEY)")
    with conn:
        problem = database_guard.schema_problem(conn, SQLITE, _models(), {"005"})
    engine.dispose()
    assert problem is not None
    assert "sessions lacks note" in problem
    assert "dropdb" in problem


def test_a_database_at_the_head_revision_fits():
    engine, conn = _database(
        "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)",
        "INSERT INTO alembic_version VALUES ('005')",
    )
    with conn:
        assert database_guard.schema_problem(conn, SQLITE, _models(), {"005"}) is None
    engine.dispose()


def test_a_database_at_an_older_revision_stops_the_run():
    engine, conn = _database(
        "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)",
        "INSERT INTO alembic_version VALUES ('004')",
    )
    with conn:
        problem = database_guard.schema_problem(conn, SQLITE, _models(), {"005"})
    engine.dispose()
    assert problem is not None
    assert "revision 004" in problem
    assert "end at 005" in problem
    assert "alembic upgrade head" in problem


# --- Against a server -------------------------------------------------------------------


def _same_server(database: str) -> str:
    return make_url(get_database_url()).set(database=database).render_as_string(hide_password=False)


@requires_postgres
def test_the_suites_own_database_passes():
    assert database_guard.check(get_database_url(), Base.metadata) is None


@requires_postgres
def test_a_database_that_answers_without_a_test_name_is_refused():
    problem = database_guard.check(_same_server("postgres"), Base.metadata)
    assert problem is not None
    assert 'refusing to use database "postgres"' in problem


@requires_postgres
def test_a_test_database_that_does_not_exist_stops_the_run():
    name = f"wizard_test_missing_{uuid.uuid4().hex[:8]}"
    problem = database_guard.check(_same_server(name), Base.metadata)
    assert problem is not None
    assert f'"{name}" does not exist' in problem
    assert f"createdb -U wizard {name}" in problem


@requires_postgres
def test_the_servers_catalogue_tells_a_missing_database_from_an_existing_one():
    # Read from pg_database, not from the connect error, whose text is in the
    # server's language and whose SQLSTATE psycopg 3 leaves unset.
    missing = make_url(_same_server(f"wizard_test_missing_{uuid.uuid4().hex[:8]}"))
    assert database_guard.database_is_missing(missing)
    assert not database_guard.database_is_missing(make_url(get_database_url()))


# --- The conftest hook, in a pytest of its own ------------------------------------------


def _collect_with(url: str) -> subprocess.CompletedProcess:
    # --collect-only: should the guard ever let the run through, no test runs either.
    return subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider"]
        + ["tests/test_database_guard.py"],
        cwd=API_ROOT,
        env={**os.environ, "WIZARD_DATABASE_URL": url},
        capture_output=True,
        text=True,
        timeout=180,
    )


@requires_postgres
def test_pytest_stops_before_the_first_test_on_a_database_that_is_not_a_test_database():
    result = _collect_with(_same_server("postgres"))
    output = result.stdout + result.stderr
    assert result.returncode == pytest.ExitCode.USAGE_ERROR, output
    assert 'refusing to use database "postgres"' in output
    assert "test_database_guard.py::" not in output


def test_pytest_goes_on_when_no_database_answers():
    result = _collect_with(UNREACHABLE_URL)
    output = result.stdout + result.stderr
    assert result.returncode == pytest.ExitCode.OK, output
    assert "test_database_guard.py::" in output
