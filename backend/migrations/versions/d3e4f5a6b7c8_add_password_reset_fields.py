"""add password reset token fields to users

Revision ID: d3e4f5a6b7c8
Revises: d2e3f4a5b6c7
Create Date: 2026-08-21

Phase 12 follow-up (change/forgot password): add nullable
password_reset_token and password_reset_expires columns to `users`.
Both are nullable so existing rows are untouched.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, Sequence[str], None] = "d2e3f4a5b6c7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users",
        sa.Column("password_reset_token", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("password_reset_expires", sa.DateTime(), nullable=True),
    )
    op.create_index(
        op.f("ix_users_password_reset_token"),
        "users",
        ["password_reset_token"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        op.f("ix_users_password_reset_token"), table_name="users"
    )
    op.drop_column("users", "password_reset_expires")
    op.drop_column("users", "password_reset_token")