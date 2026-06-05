import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from github_oauth import GithubOAuthError, _select_verified_email


def test_select_verified_email_prefers_primary_verified_email():
    email = _select_verified_email(
        [
            {"email": "secondary@example.com", "verified": True, "primary": False},
            {"email": "primary@example.com", "verified": True, "primary": True},
        ]
    )

    assert email == "primary@example.com"


def test_select_verified_email_rejects_unverified_emails():
    with pytest.raises(GithubOAuthError):
        _select_verified_email(
            [
                {"email": "private@example.com", "verified": False, "primary": True},
            ]
        )
