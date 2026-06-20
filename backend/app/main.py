from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import health, users

app = FastAPI(title="Boombayan LMS API")
# API Gateway HTTP API's automatic CORS handling doesn't engage for OPTIONS
# requests against a $default catch-all route (this Lambda's only route,
# per infra/serverless.yml's `httpApi: '*'`) - the preflight just falls
# through to the Lambda, which returned 405 with no CORSMiddleware. Handling
# CORS here instead works regardless of routing and needs no serverless.yml
# changes as new routes are added.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(users.router)
