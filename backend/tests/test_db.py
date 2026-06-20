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
