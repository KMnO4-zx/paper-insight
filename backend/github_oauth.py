from dataclasses import dataclass
from typing import Any

import requests


GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_EMAILS_URL = "https://api.github.com/user/emails"


class GithubOAuthError(Exception):
    """Raised when GitHub OAuth cannot produce a verified user identity."""


@dataclass(frozen=True)
class GithubOAuthUser:
    provider_user_id: str
    login: str
    email: str
    name: str | None = None
    avatar_url: str | None = None


def _get_json(url: str, access_token: str) -> Any:
    try:
        response = requests.get(
            url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {access_token}",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=10,
        )
    except requests.RequestException as exc:
        raise GithubOAuthError("GitHub API request failed") from exc

    if not response.ok:
        raise GithubOAuthError(f"GitHub API returned HTTP {response.status_code}")
    return response.json()


def exchange_github_code(
    client_id: str,
    client_secret: str,
    code: str,
    redirect_uri: str,
) -> str:
    try:
        response = requests.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            timeout=10,
        )
    except requests.RequestException as exc:
        raise GithubOAuthError("GitHub token request failed") from exc

    if not response.ok:
        raise GithubOAuthError(f"GitHub token endpoint returned HTTP {response.status_code}")

    payload = response.json()
    if payload.get("error"):
        raise GithubOAuthError(str(payload.get("error_description") or payload["error"]))
    access_token = payload.get("access_token")
    if not access_token:
        raise GithubOAuthError("GitHub token response did not include access_token")
    return str(access_token)


def _select_verified_email(emails: Any) -> str:
    if not isinstance(emails, list):
        raise GithubOAuthError("GitHub email response was malformed")

    verified = [
        email
        for email in emails
        if isinstance(email, dict) and email.get("verified") and email.get("email")
    ]
    primary = [email for email in verified if email.get("primary")]
    selected = (primary or verified)[0] if verified else None
    if not selected:
        raise GithubOAuthError("GitHub account does not expose a verified email")
    return str(selected["email"])


def fetch_github_oauth_user(access_token: str) -> GithubOAuthUser:
    user = _get_json(GITHUB_USER_URL, access_token)
    emails = _get_json(GITHUB_EMAILS_URL, access_token)
    if not isinstance(user, dict) or not user.get("id") or not user.get("login"):
        raise GithubOAuthError("GitHub user response was malformed")

    return GithubOAuthUser(
        provider_user_id=str(user["id"]),
        login=str(user["login"]),
        email=_select_verified_email(emails),
        name=str(user["name"]) if user.get("name") else None,
        avatar_url=str(user["avatar_url"]) if user.get("avatar_url") else None,
    )
