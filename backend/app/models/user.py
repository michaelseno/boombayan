from pydantic import BaseModel


class User(BaseModel):
    user_id: str
    email: str
    is_administrator: bool = False
    member_id: str | None = None
