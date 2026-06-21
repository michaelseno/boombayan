from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import config, health, loans, members, users


def _parse_allowed_origins(value: str) -> list[str]:
    """Split a comma-separated origin list, trimming whitespace around each
    entry so "a, b" (the natural way most people write a multi-origin list)
    works the same as "a,b"."""
    return [origin.strip() for origin in value.split(",") if origin.strip()]


app = FastAPI(title="Boombayan LMS API")
# API Gateway HTTP API's automatic CORS handling doesn't engage for OPTIONS
# requests against a $default catch-all route (this Lambda's only route,
# per infra/serverless.yml's `httpApi: '*'`) - the preflight just falls
# through to the Lambda, which returned 405 with no CORSMiddleware. Handling
# CORS here instead works regardless of routing and needs no serverless.yml
# changes as new routes are added. allow_origins is an explicit allowlist
# (CORS_ALLOWED_ORIGINS, comma-separated) rather than "*": every endpoint
# requires a valid bearer token regardless of origin today, but an explicit
# allowlist is one less thing to reason about once any cookie-based or
# unauthenticated endpoint is ever added.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_allowed_origins(settings.cors_allowed_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(users.router)
app.include_router(members.router)
app.include_router(config.router)
app.include_router(loans.router)
