from fastapi import FastAPI

from app.routers import health

app = FastAPI(title="Boombayan LMS API")
app.include_router(health.router)
