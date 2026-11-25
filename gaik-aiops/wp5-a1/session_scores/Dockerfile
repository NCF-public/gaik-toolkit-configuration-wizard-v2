# The session scoring job (WP5): reads settled wizard sessions' traces from MLflow and writes their
# outcome scores back. Runs under any UID (OpenShift assigns a random one in group 0).
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
COPY session_scores ./session_scores
RUN pip install --no-cache-dir . && useradd --uid 10001 --no-create-home scores
ENV HOME=/tmp MLFLOW_DISABLE_AGENT_HINT=1
USER 10001
CMD ["session-scores"]
