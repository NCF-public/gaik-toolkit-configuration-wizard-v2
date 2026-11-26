"""wizard_sessions.aiops_recording: whether the session's traces may be stored

Revision ID: 005
Revises: 004
Create Date: 2026-11-24

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Sessions made before the question existed were never asked: ``not_asked``,
    # which is treated as not stored.
    op.add_column(
        "wizard_sessions",
        sa.Column("aiops_recording", sa.String(16), nullable=False, server_default="not_asked"),
    )


def downgrade() -> None:
    op.drop_column("wizard_sessions", "aiops_recording")
