"""align mom schema

Revision ID: f9e1351cc23e
Revises: aa05114aa4de
Create Date: 2026-08-17 10:39:36.188082

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f9e1351cc23e"
down_revision: Union[str, Sequence[str], None] = "aa05114aa4de"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---------------------------------------------------------
    # MOM columns
    # ---------------------------------------------------------

    # These columns were already partially added by the failed
    # migration, so do NOT add them again.

    # ---------------------------------------------------------
    # ACTION_ITEMS
    # ---------------------------------------------------------

    # Add mom_id only if it does not already exist.
    conn = op.get_bind()

    inspector = sa.inspect(conn)

    action_columns = {
        column["name"]
        for column in inspector.get_columns("action_items")
    }

    if "mom_id" not in action_columns:
        op.add_column(
            "action_items",
            sa.Column(
                "mom_id",
                sa.Integer(),
                nullable=True,
            ),
        )

    # IMPORTANT:
    # Existing ActionItem rows may not have a MOM yet.
    # Therefore we leave mom_id nullable during migration.

    # The old meeting_id column may still exist depending on
    # how far the previous failed migration got.

    inspector = sa.inspect(conn)

    action_columns = {
        column["name"]
        for column in inspector.get_columns("action_items")
    }

    if "meeting_id" in action_columns:
        with op.batch_alter_table("action_items") as batch_op:
            batch_op.drop_column("meeting_id")

    # ---------------------------------------------------------
    # Make mom_id non-nullable only after existing data is handled
    # ---------------------------------------------------------

    # For now we keep it nullable because old ActionItems may exist.
    # New application-created ActionItems will always receive mom_id.

    # ---------------------------------------------------------
    # Foreign key
    # ---------------------------------------------------------

    inspector = sa.inspect(conn)

    foreign_keys = inspector.get_foreign_keys("action_items")

    has_mom_fk = any(
        fk.get("referred_table") == "moms"
        and fk.get("constrained_columns") == ["mom_id"]
        for fk in foreign_keys
    )

    if not has_mom_fk:
        with op.batch_alter_table("action_items") as batch_op:
            batch_op.create_foreign_key(
                "fk_action_items_mom_id",
                "moms",
                ["mom_id"],
                ["id"],
                ondelete="CASCADE",
            )


def downgrade() -> None:
    # This migration is intended for the current Phase 9/10 schema.
    # Keep downgrade conservative.

    conn = op.get_bind()
    inspector = sa.inspect(conn)

    action_columns = {
        column["name"]
        for column in inspector.get_columns("action_items")
    }

    if "mom_id" in action_columns:

        foreign_keys = inspector.get_foreign_keys("action_items")

        for fk in foreign_keys:
            if (
                fk.get("constrained_columns") == ["mom_id"]
                and fk.get("referred_table") == "moms"
            ):
                constraint_name = fk.get("name")

                if constraint_name:
                    with op.batch_alter_table("action_items") as batch_op:
                        batch_op.drop_constraint(
                            constraint_name,
                            type_="foreignkey",
                        )

        with op.batch_alter_table("action_items") as batch_op:
            batch_op.drop_column("mom_id")