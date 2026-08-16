from heybrowsy.models import BrowserAction, SpeedMode
from heybrowsy.sharpness import action_signature, goal_complexity, planning_mode


def test_simple_fast_task_stays_fast():
    assert planning_mode(SpeedMode.fast, "Summarize this page") == SpeedMode.fast


def test_multi_stage_outreach_uses_stronger_planner():
    goal = "Analyze my profile, search the best connections, personalize a message, and send it"
    assert goal_complexity(goal) >= 5
    assert planning_mode(SpeedMode.fast, goal) == SpeedMode.balanced


def test_user_selected_balanced_and_accurate_are_never_downgraded():
    assert planning_mode(SpeedMode.balanced, "Click this button") == SpeedMode.balanced
    assert planning_mode(SpeedMode.accurate, "Click this button") == SpeedMode.accurate


def test_action_signature_ignores_generated_id_and_explanation():
    first = BrowserAction(id="one", type="read_page", rationale="first")
    second = BrowserAction(id="two", type="read_page", rationale="again")
    assert action_signature(first) == action_signature(second)
