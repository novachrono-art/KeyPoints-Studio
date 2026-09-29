"""add priority to action items

Revision ID: b3d9e2f7a51c
Revises: c11a9b9d4e2f
Create Date: 2026-08-18

Phase 11 (Advanced MOM intelligence): action items gain a normalized
priority (one of low/medium/high, or NULL). The status column already
existed. This only ADDS a nullable column, so it never touches existing
data.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b3d9e2f7a51c"
down_revision: Union[str, Sequence[str], None] = "c11a9b9d4e2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the nullable priority column to action_items."""
    op.add_column(
        "action_items",
        sa.Column("priority", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    """Drop the priority column (conservative - only our own new column)."""
    op.drop_column("action_items", "priority")