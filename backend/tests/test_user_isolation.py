"""
test_user_isolation.py

Verifies authorization boundaries and multi-tenant user isolation (Phase 12/16/17).
Ensures that User A cannot read, transcribe, modify, export, or delete User B's meetings.
"""

from app.models.meeting import Meeting, Transcript, MOM


def test_user_meeting_isolation(client, db_session, test_user, auth_headers, test_user_2, auth_headers_2):
    """
    Seed a meeting owned by User 1.
    Verify User 2 gets 404 Not Found on every single meeting endpoint.
    """
    # 1. Create meeting owned by test_user (User 1)
    m1 = Meeting(
        public_id="isolation-meeting-u1",
        title="Confidential Strategy",
        original_filename="strategy.wav",
        saved_filename="isolation-meeting-u1.wav",
        status="transcribed",
        user_id=test_user.id,
    )
    db_session.add(m1)
    db_session.commit()
    db_session.refresh(m1)

    t1 = Transcript(
        meeting_id=m1.id,
        content="Confidential discussion regarding future product launch.",
    )
    db_session.add(t1)
    db_session.commit()

    meeting_id = m1.public_id

    # 2. User 1 can access it
    res_u1 = client.get(f"/api/meetings/{meeting_id}", headers=auth_headers)
    assert res_u1.status_code == 200
    assert res_u1.json()["title"] == "Confidential Strategy"

    # 3. User 2 attempts to access User 1's meeting -> Expect 404
    res_u2_detail = client.get(f"/api/meetings/{meeting_id}", headers=auth_headers_2)
    assert res_u2_detail.status_code == 404

    # User 2 attempts to read transcript -> 404
    res_u2_transcript = client.get(f"/api/meetings/{meeting_id}/transcript", headers=auth_headers_2)
    assert res_u2_transcript.status_code == 404

    # User 2 attempts to trigger MOM generation -> 404
    res_u2_gen_mom = client.post(f"/api/meetings/{meeting_id}/generate-mom", headers=auth_headers_2)
    assert res_u2_gen_mom.status_code == 404

    # User 2 attempts to read MOM -> 404
    res_u2_get_mom = client.get(f"/api/meetings/{meeting_id}/mom", headers=auth_headers_2)
    assert res_u2_get_mom.status_code == 404

    # User 2 attempts to export PDF -> 404
    res_u2_export = client.get(f"/api/meetings/{meeting_id}/export/pdf", headers=auth_headers_2)
    assert res_u2_export.status_code == 404

    # User 2 attempts to delete User 1's meeting -> 404
    res_u2_delete = client.delete(f"/api/meetings/{meeting_id}", headers=auth_headers_2)
    assert res_u2_delete.status_code == 404

    # Confirm meeting was NOT deleted
    meeting_check = db_session.query(Meeting).filter(Meeting.public_id == meeting_id).first()
    assert meeting_check is not None
