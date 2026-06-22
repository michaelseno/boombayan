def test_penalty_handler_invokes_run_penalty_check(
    dynamodb_config_table, dynamodb_loans_table, dynamodb_transactions_table
):
    from app.db import put_config
    from app.models.config import Config
    from app.penalty_handler import handler

    put_config(Config(penalty_rate=0, penalty_grace_period_hours=0))

    response = handler({}, None)

    assert response == {"charged_count": 0}
