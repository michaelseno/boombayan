from .penalty_engine import run_penalty_check


def handler(event, context):
    charged_count = run_penalty_check()
    return {"charged_count": charged_count}
