def test_put_and_get_user_roundtrip(dynamodb_users_table):
    from app.db import get_user_by_id, put_user
    from app.models.user import User

    user = User(user_id="abc123", email="board@boombayan.org", is_administrator=True, member_id="mem-1")
    put_user(user)

    fetched = get_user_by_id("abc123")
    assert fetched == user


def test_get_user_by_id_returns_none_when_missing(dynamodb_users_table):
    from app.db import get_user_by_id

    assert get_user_by_id("does-not-exist") is None


def test_put_and_get_member_roundtrip(dynamodb_members_table):
    from app.db import get_member_by_id, put_member
    from app.models.member import Member

    member = Member(
        member_id="mem-1",
        first_name="Ana",
        last_name="Reyes",
        email="ana@example.com",
        phone="09171234567",
        date_joined="2026-01-15",
    )
    put_member(member)

    fetched = get_member_by_id("mem-1")
    assert fetched == member


def test_get_member_by_id_returns_none_when_missing(dynamodb_members_table):
    from app.db import get_member_by_id

    assert get_member_by_id("does-not-exist") is None


def test_list_members_returns_all_members(dynamodb_members_table):
    from app.db import list_members, put_member
    from app.models.member import Member

    put_member(
        Member(
            member_id="mem-1", first_name="Ana", last_name="Reyes",
            email="ana@example.com", phone="1", date_joined="2026-01-15",
        )
    )
    put_member(
        Member(
            member_id="mem-2", first_name="Bo", last_name="Cruz",
            email="bo@example.com", phone="2", date_joined="2026-01-16",
        )
    )

    members = list_members()
    assert {m.member_id for m in members} == {"mem-1", "mem-2"}


def test_put_member_persists_share_history(dynamodb_members_table):
    from app.db import get_member_by_id, put_member
    from app.models.member import Member, ShareHistoryEntry

    member = Member(
        member_id="mem-1",
        first_name="Ana",
        last_name="Reyes",
        email="ana@example.com",
        phone="1",
        date_joined="2026-01-15",
        current_shares=2,
        current_capital_amount=1000,
        share_history=[
            ShareHistoryEntry(
                shares_purchased=2, share_value_at_purchase=500, amount_paid=1000, date="2026-02-01",
            ),
        ],
    )
    put_member(member)

    fetched = get_member_by_id("mem-1")
    assert fetched == member


def test_put_member_persists_fractional_monetary_amounts(dynamodb_members_table):
    from app.db import get_member_by_id, put_member
    from app.models.member import Member, ShareHistoryEntry

    member = Member(
        member_id="mem-1",
        first_name="Ana",
        last_name="Reyes",
        email="ana@example.com",
        phone="1",
        date_joined="2026-01-15",
        current_shares=2,
        current_capital_amount=1000.10,
        share_history=[
            ShareHistoryEntry(
                shares_purchased=2, share_value_at_purchase=500.25, amount_paid=1000.55, date="2026-02-01",
            ),
        ],
    )
    put_member(member)

    fetched = get_member_by_id("mem-1")
    assert fetched == member


def test_get_config_returns_defaults_when_not_set(dynamodb_config_table):
    from app.db import get_config
    from app.models.config import Config

    assert get_config() == Config()


def test_put_and_get_config_roundtrip(dynamodb_config_table):
    from app.db import get_config, put_config
    from app.models.config import Config

    config = Config(
        share_value=500,
        max_shares_per_member=5,
        default_interest_rate=0.05,
        penalty_rate=0.02,
        penalty_grace_period_hours=24,
    )
    put_config(config)

    assert get_config() == config


def test_list_users_returns_all_users(dynamodb_users_table):
    from app.db import list_users, put_user
    from app.models.user import User

    put_user(User(user_id="admin-1", email="admin@boombayan.org", is_administrator=True))
    put_user(User(user_id="board-1", email="board@boombayan.org", is_administrator=False))

    users = list_users()
    assert {u.user_id for u in users} == {"admin-1", "board-1"}


def test_put_and_get_loan_roundtrip(dynamodb_loans_table):
    from app.db import get_loan_by_id, put_loan
    from app.models.loan import ApprovalEntry, Loan

    loan = Loan(
        loan_id="loan-1",
        member_id="mem-1",
        requested_amount=10000,
        repayment_interval_days=30,
        interest_rate=0.05,
        application_date="2026-06-21",
        approvals={"admin-1": ApprovalEntry(email="admin@boombayan.org")},
    )
    put_loan(loan)

    fetched = get_loan_by_id("loan-1")
    assert fetched == loan


def test_get_loan_by_id_returns_none_when_missing(dynamodb_loans_table):
    from app.db import get_loan_by_id

    assert get_loan_by_id("does-not-exist") is None


def test_list_loans_returns_all_loans(dynamodb_loans_table):
    from app.db import list_loans, put_loan
    from app.models.loan import Loan

    put_loan(
        Loan(
            loan_id="loan-1", member_id="mem-1", requested_amount=10000,
            repayment_interval_days=30, interest_rate=0.05, application_date="2026-06-21",
        )
    )
    put_loan(
        Loan(
            loan_id="loan-2", member_id="mem-2", requested_amount=5000,
            repayment_interval_days=15, interest_rate=0.05, application_date="2026-06-22",
        )
    )

    loans = list_loans()
    assert {loan.loan_id for loan in loans} == {"loan-1", "loan-2"}


def test_put_loan_persists_release_fields(dynamodb_loans_table):
    from app.db import get_loan_by_id, put_loan
    from app.models.loan import Loan, LoanStatus

    loan = Loan(
        loan_id="loan-1",
        member_id="mem-1",
        requested_amount=10000,
        approved_amount=10000,
        repayment_interval_days=30,
        interest_rate=0.05,
        application_date="2026-06-21",
        status=LoanStatus.ACTIVE,
        release_date="2026-06-22",
        interest_deduction=500,
        net_release_amount=9500,
        remaining_balance=10000,
        next_due_date="2026-07-22",
    )
    put_loan(loan)

    fetched = get_loan_by_id("loan-1")
    assert fetched == loan


def test_put_and_get_loan_persists_penalty_charged_flag_and_completed_status(dynamodb_loans_table):
    from app.db import get_loan_by_id, put_loan
    from app.models.loan import Loan, LoanStatus

    loan = Loan(
        loan_id="loan-1",
        member_id="mem-1",
        requested_amount=10000,
        approved_amount=10000,
        repayment_interval_days=30,
        interest_rate=0.05,
        application_date="2026-06-21",
        status=LoanStatus.COMPLETED,
        release_date="2026-06-21",
        interest_deduction=500,
        net_release_amount=9500,
        remaining_balance=0,
        next_due_date="2026-07-21",
        penalty_charged_for_current_cycle=True,
    )
    put_loan(loan)

    fetched = get_loan_by_id("loan-1")
    assert fetched == loan


def test_put_and_get_transaction_roundtrip(dynamodb_transactions_table):
    from app.db import get_transactions_table, put_transaction
    from app.models.transaction import Transaction, TransactionType

    transaction = Transaction(
        transaction_id="txn-1",
        loan_id="loan-1",
        timestamp="2026-07-21T10:00:00+00:00",
        type=TransactionType.PAYMENT,
        amount=3000,
        remaining_balance_after=7000,
        recorded_by="admin-1",
        notes="First installment",
    )
    put_transaction(transaction)

    response = get_transactions_table().get_item(
        Key={"LoanId": "loan-1", "Timestamp": "2026-07-21T10:00:00+00:00"}
    )
    assert response["Item"]["TransactionId"] == "txn-1"


def test_list_transactions_for_loan_returns_oldest_first(dynamodb_transactions_table):
    from app.db import list_transactions_for_loan, put_transaction
    from app.models.transaction import Transaction, TransactionType

    put_transaction(
        Transaction(
            transaction_id="txn-2", loan_id="loan-1", timestamp="2026-07-21T12:00:00+00:00",
            type=TransactionType.PAYMENT, amount=1000, remaining_balance_after=9000,
        )
    )
    put_transaction(
        Transaction(
            transaction_id="txn-1", loan_id="loan-1", timestamp="2026-07-21T10:00:00+00:00",
            type=TransactionType.PAYMENT, amount=1000, remaining_balance_after=8000,
        )
    )

    transactions = list_transactions_for_loan("loan-1")
    assert [t.transaction_id for t in transactions] == ["txn-1", "txn-2"]
