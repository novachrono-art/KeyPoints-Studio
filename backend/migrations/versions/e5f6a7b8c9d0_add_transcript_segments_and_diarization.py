"""add transcript segments and diarization flag

Adds two nullable columns to the ``transcripts`` table for Phase 14
(Speaker Diarization):

  segments_json    TEXT     JSON-encoded list of {start, end, text, speaker?}
                            per Whisper segment, for rich frontend display.
                            Null for transcripts created before Phase 14.

  has_diarization  BOOLEAN  True when diarization was applied and speaker
                            labels are present in segments_json.

Both columns are nullable so every existing row is unaffected.

Revision ID: e5f6a7b8c9d0
Revises: d3e4f5a6b7c8
Create Date: 2026-08-24
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e5f6a7b8c9d0"
down_revision = "d3e4f5a6b7c8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite requires batch mode for ALTER TABLE operations.
    with op.batch_alter_table("transcripts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("segments_json", sa.Text(), nullable=True)
        )
        batch_op.add_column(
            sa.Column(
                "has_diarization",
                sa.Boolean(),
                nullable=True,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("transcripts", schema=None) as batch_op:
        batch_op.drop_column("has_diarization")
        batch_op.drop_column("segments_json")
