"""add google auth and user identity fields

Revision ID: e6f7a8b9c0d1
Revises: e5f6a7b8c9d0
Create Date: 2026-09-29
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e6f7a8b9c0d1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    user_columns = {c["name"] for c in inspector.get_columns("users")}

    with op.batch_alter_table("users", schema=None) as batch_op:
        if "google_id" not in user_columns:
            batch_op.add_column(
                sa.Column("google_id", sa.String(length=128), nullable=True)
            )
            batch_op.create_index(
                "ix_users_google_id", ["google_id"], unique=True
            )
        if "auth_provider" not in user_columns:
            batch_op.add_column(
                sa.Column(
                    "auth_provider",
                    sa.String(length=32),
                    server_default="local",
                    nullable=False,
                )
            )
        if "avatar_url" not in user_columns:
            batch_op.add_column(
                sa.Column("avatar_url", sa.String(length=512), nullable=True)
            )
        if "email_verified" not in user_columns:
            batch_op.add_column(
                sa.Column(
                    "email_verified",
                    sa.Integer(),
                    server_default="0",
                    nullable=False,
                )
            )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index("ix_users_google_id")
        batch_op.drop_column("email_verified")
        batch_op.drop_column("avatar_url")
        batch_op.drop_column("auth_provider")
        batch_op.drop_column("google_id")
