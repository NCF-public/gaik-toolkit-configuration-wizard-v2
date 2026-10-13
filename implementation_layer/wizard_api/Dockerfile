FROM python:3.11-slim AS base

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip

COPY wizard_api/pyproject.toml ./
COPY wizard_api/wizard_api ./wizard_api
COPY wizard_api/alembic ./alembic
COPY wizard_api/alembic.ini ./
COPY wizard_api/tests ./tests

# solution_wizard provides BPMN generation (V2 adapter + bpmn_generator)
COPY solution_wizard /solution_wizard
RUN pip install --no-cache-dir -e /solution_wizard

RUN pip install --no-cache-dir -e .

ENV WIZARD_SESSION_OUTPUT_ROOT=/data/sessions

EXPOSE 8100

FROM base AS dev

RUN pip install --no-cache-dir -e ".[dev]"

CMD ["sh", "-c", "alembic upgrade head && uvicorn wizard_api.main:app --host 0.0.0.0 --port 8100"]

FROM base AS production

CMD ["sh", "-c", "alembic upgrade head && uvicorn wizard_api.main:app --host 0.0.0.0 --port 8100"]
