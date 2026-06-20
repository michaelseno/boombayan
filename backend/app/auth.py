import jwt
from fastapi import Depends, Header, HTTPException

from .config import settings
from .db import get_user_by_id
from .models.user import User

_jwks_client: jwt.PyJWKClient | None = None


def _get_jwks_client() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = (
            f"https://cognito-idp.{settings.aws_region}.amazonaws.com/"
            f"{settings.cognito_user_pool_id}/.well-known/jwks.json"
        )
        _jwks_client = jwt.PyJWKClient(url)
    return _jwks_client


def decode_token(token: str) -> dict:
    signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        audience=settings.cognito_client_id,
    )
    if claims.get("token_use") != "id":
        raise jwt.InvalidTokenError("Expected an ID token")
    return claims


def get_current_user_id(authorization: str = Header(...)) -> str:
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    try:
        claims = decode_token(token)
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc
    return claims["sub"]


def get_current_user(user_id: str = Depends(get_current_user_id)) -> User:
    # A valid Cognito token with no matching Users-table row is a real, not
    # hypothetical, case: this system has no self-registration, so every
    # account is provisioned by an out-of-band process (scripts/seed_admin.py
    # is the only sanctioned one so far). If a Cognito user is ever created
    # some other way, they'll authenticate successfully but land here.
    user = get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_administrator:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user
