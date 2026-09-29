"""add upload metadata to meetings

Revision ID: 74ed46465b06
Revises: eb9e06349257
Create Date: 2026-08-15 23:52:04.310979
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '74ed46465b06'
down_revision: Union[str, Sequence[str], None] = 'eb9e06349257'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""

    op.add_column(
        'meetings',
        sa.Column(
            'status',
            sa.String(length=50),
            nullable=False,
            server_default='uploaded'
        )
    )


def downgrade() -> None:
    """Downgrade schema."""

    op.drop_column('meetings', 'status')
    op.drop_column('meetings', 'saved_filename')
    op.drop_column('meetings', 'original_filename')