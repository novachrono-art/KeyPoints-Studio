"""
webhook_service.py

Handles real outbound webhook integrations, specifically Slack Incoming Webhooks
for automated notification of meeting minutes and action items.

SEC-02 (SSRF hardening):
  - Only HTTPS is permitted.
  - Only explicitly allowlisted Slack/Teams hostnames are reachable.
  - The resolved IP address is checked against all private, loopback, link-local
    and reserved ranges before any outbound connection is made.
  - HTTP redirects are blocked so an attacker cannot pivot from an allowlisted
    hostname to an internal endpoint (e.g. AWS metadata at 169.254.169.254)
    via a 301/302.
"""

import ipaddress
import json
import logging
import socket
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from app.schemas.mom import MOMResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# SSRF defence helpers
# ---------------------------------------------------------------------------

# Only these exact hostnames may receive outbound webhook POSTs.
_ALLOWED_WEBHOOK_HOSTS: frozenset[str] = frozenset({
    "hooks.slack.com",
    "hooks.slack-gov.com",
})
# Teams webhook hostnames use a wildcard suffix; checked separately.
_ALLOWED_TEAMS_SUFFIX = ".webhook.office.com"


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Block all HTTP redirects — prevents SSRF via open redirects."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        raise urllib.error.URLError(
            f"Redirects are blocked for security (attempted redirect to {newurl})"
        )


def _validate_webhook_url(url: str) -> None:
    """
    Validate that `url` is safe to send an outbound POST to.

    Raises ValueError with a descriptive message on any policy violation.
    This function MUST be called before every outbound request.
    """
    # 1. Parse and enforce HTTPS scheme.
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        raise ValueError("Invalid webhook URL.")

    if parsed.scheme != "https":
        raise ValueError("Webhook URL must use HTTPS.")

    hostname = parsed.hostname or ""
    if not hostname:
        raise ValueError("Webhook URL is missing a hostname.")

    # 2. Enforce allowlist.
    is_slack = hostname in _ALLOWED_WEBHOOK_HOSTS
    is_teams = hostname.endswith(_ALLOWED_TEAMS_SUFFIX)
    if not (is_slack or is_teams):
        raise ValueError(
            f"Webhook hostname '{hostname}' is not on the allowlist. "
            f"Only Slack (hooks.slack.com) and Teams (*.webhook.office.com) "
            f"webhooks are supported."
        )

    # 3. Resolve hostname and reject private/reserved IPs.
    try:
        addr_infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as exc:
        raise ValueError(f"Unable to resolve webhook hostname '{hostname}': {exc}")

    for addr_info in addr_infos:
        raw_ip = addr_info[4][0]
        try:
            ip = ipaddress.ip_address(raw_ip)
        except ValueError:
            raise ValueError(f"Could not parse resolved IP address: {raw_ip}")

        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            logger.warning(
                "SSRF: webhook hostname %s resolved to blocked IP %s", hostname, ip
            )
            raise ValueError(
                f"Webhook hostname '{hostname}' resolved to a private or reserved "
                f"IP address. This request has been blocked."
            )


def test_slack_webhook(webhook_url: str) -> dict:
    """Send a test ping message to verify the Slack Webhook URL."""
    # SEC-02: full SSRF validation (scheme, allowlist, IP resolution)
    _validate_webhook_url(webhook_url)

    payload = {
        "text": "🎙️ *KeyPoints Studio Test Ping*: Slack integration connected successfully!",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": "🎙️ *KeyPoints Studio Connection Verified*\nYour Slack Incoming Webhook is working and ready to receive meeting notes and action items.",
                },
            }
        ],
    }

    _post_json(webhook_url, payload)
    return {"status": "success", "message": "Test ping sent to Slack."}


def send_slack_mom(
    webhook_url: str,
    mom: MOMResult,
    sender_name: Optional[str] = None,
    custom_note: Optional[str] = None,
) -> dict:
    """Post structured Minutes of Meeting to a Slack Incoming Webhook."""
    # SEC-02: full SSRF validation before building the payload
    _validate_webhook_url(webhook_url)

    title = mom.meeting_title or "Meeting Minutes"
    date_str = mom.meeting_date or "Recorded Session"
    summary = mom.summary or "No summary available."

    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"📋 {title}",
                "emoji": True,
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"*Date:* {date_str}  |  *Shared by:* {sender_name or 'KeyPoints Studio'}",
                }
            ],
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Executive Summary:*\n{summary}",
            },
        },
    ]

    if custom_note:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"💬 *Note from sender:*\n_{custom_note}_",
            },
        })

    # Decisions
    if mom.decisions:
        decisions_txt = "\n".join([f"• *{d}*" for d in mom.decisions])
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Key Decisions:*\n{decisions_txt}",
            },
        })

    # Action Items
    if mom.action_items:
        items_txt = ""
        for item in mom.action_items[:10]:
            prio = f"[{item.priority.upper()}]" if item.priority else ""
            assignee = f"(@{item.assignee})" if item.assignee else "(Unassigned)"
            deadline = f"— Due: {item.deadline}" if item.deadline else ""
            items_txt += f"• `{prio}` *{item.task}* {assignee} {deadline}\n"

        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*Action Items ({len(mom.action_items)}):*\n{items_txt}",
            },
        })

    payload = {
        "text": f"📋 *{title}* - Minutes of Meeting generated",
        "blocks": blocks,
    }

    _post_json(webhook_url, payload)
    return {"status": "success", "message": "MOM posted to Slack channel successfully."}


def _post_json(url: str, data: dict):
    """POST JSON to a pre-validated webhook URL.

    Uses a custom opener that blocks HTTP redirects (SEC-02) so an attacker
    cannot craft a Slack URL that bounces to an internal service via 301/302.
    """
    req_data = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    # Build a custom opener that blocks all redirects.
    opener = urllib.request.build_opener(_NoRedirectHandler)
    try:
        with opener.open(req, timeout=10) as resp:
            if resp.status not in (200, 204):
                raise ValueError(f"Slack webhook returned HTTP status {resp.status}")
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", errors="ignore")
        logger.error("Slack webhook HTTP error: %s - %s", err.code, body)
        raise ValueError(f"Slack webhook failed ({err.code}): {body or err.reason}")
    except Exception as err:
        logger.error("Slack webhook dispatch failed: %s", err)
        raise ValueError(f"Failed to reach Slack: {str(err)}")

