"""
email_service.py

Email delivery service for sending generated Minutes of Meeting (MOM)
and action items to team members and meeting participants.
"""

import logging
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Optional

from app.core.config import (
    SMTP_FROM_EMAIL,
    SMTP_FROM_NAME,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USER,
)
from app.schemas.mom import MOMResult

logger = logging.getLogger(__name__)


def build_mom_html_email(
    mom: MOMResult,
    sender_name: str,
    custom_note: Optional[str] = None,
) -> str:
    """Build a clean, responsive HTML email for Minutes of Meeting."""
    title = mom.meeting_title or "Meeting Minutes"
    date_str = mom.meeting_date or "Recorded Meeting"
    summary = mom.summary or "No summary provided."

    # Format discussion points
    discussion_html = ""
    if mom.discussion_points:
        items = "".join(f"<li style='margin-bottom: 8px;'>{pt}</li>" for pt in mom.discussion_points)
        discussion_html = f"""
        <div style="margin-top: 24px;">
            <h3 style="color: #1a202c; font-size: 16px; margin-bottom: 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">Key Discussion Points</h3>
            <ul style="color: #4a5568; line-height: 1.6; padding-left: 20px;">
                {items}
            </ul>
        </div>
        """

    # Format decisions
    decisions_html = ""
    if mom.decisions:
        items = "".join(f"<li style='margin-bottom: 8px;'><strong>{d}</strong></li>" for d in mom.decisions)
        decisions_html = f"""
        <div style="margin-top: 24px;">
            <h3 style="color: #1a202c; font-size: 16px; margin-bottom: 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">Key Decisions</h3>
            <ul style="color: #2d3748; line-height: 1.6; padding-left: 20px;">
                {items}
            </ul>
        </div>
        """

    # Format action items table
    action_items_html = ""
    if mom.action_items:
        rows = ""
        for item in mom.action_items:
            priority_color = "#3182ce" if item.priority == "medium" else "#e53e3e" if item.priority == "high" else "#718096"
            priority_badge = f"<span style='background: {priority_color}20; color: {priority_color}; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: bold;'>{(item.priority or 'Normal').upper()}</span>"
            status_text = (item.status or "Pending").replace("_", " ").title()
            rows += f"""
            <tr style="border-bottom: 1px solid #edf2f7;">
                <td style="padding: 10px 12px; color: #2d3748; font-weight: 500;">{item.task}</td>
                <td style="padding: 10px 12px; color: #4a5568;">{item.assignee or 'Unassigned'}</td>
                <td style="padding: 10px 12px; color: #718096; font-size: 12px;">{item.deadline or '—'}</td>
                <td style="padding: 10px 12px;">{priority_badge}</td>
                <td style="padding: 10px 12px; color: #4a5568; font-size: 12px;">{status_text}</td>
            </tr>
            """
        action_items_html = f"""
        <div style="margin-top: 24px;">
            <h3 style="color: #1a202c; font-size: 16px; margin-bottom: 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">Action Items</h3>
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
                <thead>
                    <tr style="background: #f7fafc; border-bottom: 2px solid #edf2f7; color: #718096;">
                        <th style="padding: 8px 12px;">Task</th>
                        <th style="padding: 8px 12px;">Assignee</th>
                        <th style="padding: 8px 12px;">Deadline</th>
                        <th style="padding: 8px 12px;">Priority</th>
                        <th style="padding: 8px 12px;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    {rows}
                </tbody>
            </table>
        </div>
        """

    # Participants
    participants_html = ""
    if mom.participants:
        p_list = ", ".join(mom.participants)
        participants_html = f"<p style='color: #718096; font-size: 12px; margin-top: 8px;'><strong>Participants:</strong> {p_list}</p>"

    note_block = ""
    if custom_note:
        note_block = f"""
        <div style="background: #ebf8ff; border-left: 4px solid #3182ce; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #2b6cb0; font-size: 13px; line-height: 1.5;"><strong>Note from {sender_name}:</strong><br/>{custom_note}</p>
        </div>
        """

    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>{title}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7fafc; margin: 0; padding: 24px; color: #2d3748;">
        <div style="max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
            <div style="border-bottom: 2px solid #4fa98c; padding-bottom: 16px; margin-bottom: 20px;">
                <span style="font-size: 12px; font-weight: bold; color: #4fa98c; text-transform: uppercase; letter-spacing: 1px;">Minutes of Meeting</span>
                <h1 style="color: #1a202c; font-size: 22px; margin: 6px 0 4px 0;">{title}</h1>
                <p style="color: #718096; font-size: 13px; margin: 0;">Date: {date_str} · Shared by {sender_name}</p>
                {participants_html}
            </div>

            {note_block}

            <div style="margin-top: 16px;">
                <h3 style="color: #1a202c; font-size: 16px; margin-bottom: 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px;">Executive Summary</h3>
                <p style="color: #4a5568; line-height: 1.6; font-size: 14px; margin: 0;">{summary}</p>
            </div>

            {decisions_html}
            {action_items_html}
            {discussion_html}

            <div style="margin-top: 36px; padding-top: 16px; border-top: 1px solid #edf2f7; text-align: center; color: #a0aec0; font-size: 12px;">
                <p style="margin: 0;">Generated automatically by KeyPoints Studio</p>
            </div>
        </div>
    </body>
    </html>
    """


def send_mom_email(
    recipients: List[str],
    mom: MOMResult,
    sender_name: str,
    custom_note: Optional[str] = None,
    pdf_bytes: Optional[bytes] = None,
) -> dict:
    """
    Send formatted MOM to the list of recipient emails.

    If SMTP is configured in environment, transmits via TLS.
    If SMTP is not yet configured, safely simulates delivery and returns
    structured success with full delivery details.
    """
    valid_recipients = [r.strip() for r in recipients if r and "@" in r]
    if not valid_recipients:
        raise ValueError("No valid recipient email addresses provided.")

    title = mom.meeting_title or "Meeting Minutes"
    subject = f"Minutes of Meeting: {title}"

    html_content = build_mom_html_email(mom, sender_name, custom_note)
    plain_text = f"Minutes of Meeting: {title}\nDate: {mom.meeting_date or 'N/A'}\n\nSummary:\n{mom.summary or 'N/A'}\n\nGenerated by AI Meeting MOM Studio."

    # Check if real SMTP credentials are present
    has_smtp = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)

    if has_smtp:
        try:
            msg = MIMEMultipart("mixed")
            msg["Subject"] = subject
            msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
            msg["To"] = ", ".join(valid_recipients)

            alt_part = MIMEMultipart("alternative")
            alt_part.attach(MIMEText(plain_text, "plain", "utf-8"))
            alt_part.attach(MIMEText(html_content, "html", "utf-8"))
            msg.attach(alt_part)

            if pdf_bytes:
                pdf_attachment = MIMEApplication(pdf_bytes, _subtype="pdf")
                pdf_attachment.add_header(
                    "Content-Disposition",
                    "attachment",
                    filename=f"MOM_{title.replace(' ', '_')[:30]}.pdf",
                )
                msg.attach(pdf_attachment)

            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
                server.starttls()
                server.login(SMTP_USER, SMTP_PASSWORD)
                server.sendmail(SMTP_FROM_EMAIL, valid_recipients, msg.as_string())

            logger.info("Successfully sent MOM email via SMTP to %s", valid_recipients)
            return {
                "success": True,
                "mode": "smtp",
                "recipients": valid_recipients,
                "message": f"MOM sent successfully to {len(valid_recipients)} recipient(s) via SMTP.",
            }

        except Exception as exc:
            logger.error("SMTP delivery failed: %s", exc)
            raise RuntimeError(f"Failed to send email via SMTP server: {str(exc)}")
    else:
        # Development / Simulation mode
        logger.info(
            "[EMAIL SIMULATION] MOM email dispatched to %s with subject '%s'",
            valid_recipients,
            subject,
        )
        return {
            "success": True,
            "mode": "simulated",
            "recipients": valid_recipients,
            "message": f"MOM email dispatched to {len(valid_recipients)} team member(s) ({', '.join(valid_recipients)}).",
            "notice": "SMTP server is not configured in .env (add SMTP_HOST, SMTP_USER, SMTP_PASSWORD for live outbound mail).",
        }
