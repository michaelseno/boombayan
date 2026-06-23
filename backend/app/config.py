from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    users_table: str = "boombayan-api-dev-users"
    config_table: str = "boombayan-api-dev-config"
    members_table: str = "boombayan-api-dev-members"
    loans_table: str = "boombayan-api-dev-loans"
    transactions_table: str = "boombayan-api-dev-transactions"
    cycles_table: str = "boombayan-api-dev-cycles"
    dividends_table: str = "boombayan-api-dev-dividends"
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    aws_region: str = "us-east-1"
    cors_allowed_origins: str = "http://localhost:5173"


settings = Settings()
