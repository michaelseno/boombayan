from fastapi import FastAPI

from .routers import health, users

app = FastAPI(title="Boombayan LMS API")
app.include_router(health.router)
app.include_router(users.router)
