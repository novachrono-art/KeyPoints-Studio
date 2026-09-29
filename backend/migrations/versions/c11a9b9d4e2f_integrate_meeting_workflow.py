"""Integrate the existing meeting workflow with the Phase 9 schema.

Revision ID: c11a9b9d4e2f
Revises: f9e1351cc23e
Create Date: 2026-08-17
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c11a9b9d4e2f"
down_revision: Union[str, Sequence[str], None] = "f9e1351cc23e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    meeting_columns = {column["name"] for column in inspector.get_columns("meetings")}
    with op.batch_alter_table("meetings") as batch_op:
        if "original_filename" not in meeting_columns:
            batch_op.add_column(sa.Column("original_filename", sa.String(length=255), nullable=True))
        if "saved_filename" not in meeting_columns:
            batch_op.add_column(sa.Column("saved_filename", sa.String(length=255), nullable=True))

    inspector = sa.inspect(op.get_bind())
    mom_columns = {column["name"] for column in inspector.get_columns("moms")}
    with op.batch_alter_table("moms") as batch_op:
        if "meeting_title" not in mom_columns:
            batch_op.add_column(sa.Column("meeting_title", sa.String(length=255), nullable=True))
        if "meeting_date" not in mom_columns:
            batch_op.add_column(sa.Column("meeting_date", sa.String(length=100), nullable=True))
        if "participants" not in mom_columns:
            batch_op.add_column(sa.Column("participants", sa.Text(), nullable=True))
        if "pending_issues" not in mom_columns:
            batch_op.add_column(sa.Column("pending_issues", sa.Text(), nullable=True))


def downgrade() -> None:
    # These additions preserve existing meeting data; downgrade is intentionally
    # conservative rather than dropping user-created MOM content.
    pass
