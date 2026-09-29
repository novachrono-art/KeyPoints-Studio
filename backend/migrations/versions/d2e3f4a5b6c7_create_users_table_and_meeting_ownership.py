"""create users table and add meeting ownership

Revision ID: d2e3f4a5b6c7
Revises: b3d9e2f7a51c
Create Date: 2026-08-19

Phase 12 (Authentication): add the `users` table and a nullable `user_id`
foreign key on `meetings` so every meeting can be owned by a user and
authorization can be enforced server-side.

`user_id` is nullable so meetings created before this migration (and not
backfilled) still load; new meetings are always created with an owner.
SQLite does not enforce foreign keys by default, so the FK is declared on
the ORM model (app.models.meeting.Meeting) for create_all / relationship
support and is intentionally not duplicated as a DB constraint here - this
matches how the project's earlier migrations add columns.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, Sequence[str], None] = "b3d9e2f7a51c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # --- users table ---
    if "users" not in tables:
        op.create_table(
            "users",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("username", sa.String(length=50), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=True),
            sa.Column("password_hash", sa.String(length=255), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(),
                server_default=sa.text("CURRENT_TIMESTAMP"),
                nullable=False,
            ),
            sa.UniqueConstraint("username"),
            sa.UniqueConstraint("email"),
            sa.PrimaryKeyConstraint("id"),
        )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(
        op.f("ix_users_username"), "users", ["username"], unique=True
    )
    # email is unique via its constraint; index it for lookups too.
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)

    # --- meeting ownership (nullable: legacy rows still load) ---
    meeting_columns = {c["name"] for c in inspector.get_columns("meetings")}
    if "user_id" not in meeting_columns:
        op.add_column(
            "meetings",
            sa.Column("user_id", sa.Integer(), nullable=True, index=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    meeting_columns = {c["name"] for c in inspector.get_columns("meetings")}
    if "user_id" in meeting_columns:
        op.drop_index(op.f("ix_meetings_user_id"), table_name="meetings")
        op.drop_column("meetings", "user_id")

    if "users" in set(inspector.get_table_names()):
        op.drop_index(op.f("ix_users_email"), table_name="users")
        op.drop_index(op.f("ix_users_username"), table_name="users")
        op.drop_index(op.f("ix_users_id"), table_name="users")
        op.drop_table("users")
