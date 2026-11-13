"""Offline checks of the runner's own logic.

Run in this folder: python -m unittest test_run_usecases
"""

import argparse
import json
import tempfile
import unittest
from pathlib import Path

import make_inputs
import run_usecases

HERE = Path(__file__).resolve().parent
EVALUATION = HERE.parents[2] / "evaluation_layer/eval_methods/Solution wizard evaluation/use cases"
ANSWERS = [
    {"id": "A1", "topic": "users_and_reviewers", "text": "Technicians use it."},
    {"id": "A2", "keywords": ["schema", "fields", "types"], "text": "Use the Ticket schema."},
    {"id": "A3", "keywords": ["privacy", "retention", "fields"], "text": "Keep nothing."},
    {"id": "A4", "topic": "budget", "text": "No budget is set.", "repeatable": True},
]


class QuestionsIn(unittest.TestCase):
    def test_list_items_that_ask_are_the_questions(self):
        reply = (
            "Tarvitsen vielä muutaman tiedon:\n\n"
            "1. Missä muodossa laskut tulevat?\n"
            "2. Kuka tarkistaa tuloksen,\n   ja kuinka usein?\n"
            "- Oletan, että kieli on suomi.\n"
        )
        self.assertEqual(len(run_usecases.questions_in(reply)), 2)

    def test_code_addresses_and_fenced_blocks_do_not_ask(self):
        reply = (
            "- Run `ls ?` first\n"
            "- See https://example.org/search?q=1 for more.\n"
            "```\n- is this a question?\n```\n"
        )
        self.assertEqual(run_usecases.questions_in(reply), [])

    def test_a_closing_question_in_prose_is_one_question(self):
        self.assertEqual(len(run_usecases.questions_in("Got it.\n\nWho reads the result?")), 1)
        self.assertEqual(run_usecases.questions_in("Is it? Yes.\n\nI will go on."), [])

    def test_a_statement_asks_nothing(self):
        self.assertEqual(run_usecases.questions_in("Here is the specification.\n- Input: PDF"), [])


class ScriptedAnswers(unittest.TestCase):
    def picks(self, questions, sent=frozenset()):
        return [index for index, _ in run_usecases.match_answers(questions, ANSWERS, sent)]

    def test_a_question_takes_the_answer_its_words_name(self):
        asked = ["Who are the users?", "What is the retention period?", "Which colour is best?"]
        self.assertEqual(self.picks(asked), [0, 2, None])

    def test_keywords_come_from_the_topic_when_none_are_given(self):
        self.assertEqual(run_usecases.answer_keywords(ANSWERS[0]), ["users", "reviewers"])
        self.assertEqual(run_usecases.answer_keywords(ANSWERS[1]), ["schema", "fields", "types"])

    def test_a_keyword_two_answers_share_does_not_decide(self):
        # "fields" is in A2 and A3; "privacy" is in A3 alone.
        self.assertEqual(self.picks(["Which fields raise privacy concerns?"]), [2])
        self.assertEqual(self.picks(["Which fields are there?"]), [1])  # a tie: the first listed

    def test_a_word_form_still_hits(self):
        self.assertEqual(self.picks(["Who will review the result?"]), [0])
        self.assertEqual(self.picks(["What field type is the date?"]), [1])

    def test_an_answer_goes_out_once_unless_repeatable(self):
        self.assertEqual(self.picks(["What is the schema?", "And its types?"]), [1, None])
        self.assertEqual(self.picks(["What is the schema?"], sent={1}), [None])
        self.assertEqual(self.picks(["Is there a budget?"], sent={3}), [3])

    def test_code_and_addresses_in_a_question_do_not_match(self):
        self.assertEqual(self.picks(["Is `schema` at https://example.org/fields fine?"]), [None])

    def walk(self, folder, answers):
        case = {"id": "t", "title": "t", "locale": "en", "description": "d", "answers": answers}
        return run_usecases.Walk(None, case, Path(folder), argparse.Namespace(pace=None))

    def test_the_reply_carries_the_matched_answers_and_the_generic_line(self):
        with tempfile.TemporaryDirectory() as folder:
            walk = self.walk(folder, ANSWERS)
            message, answered = walk.reply_to(["What is the schema?", "Which colour?"])
            self.assertTrue(answered)
            self.assertEqual(message, "- Use the Ticket schema.\n\n" + run_usecases.GO_ON["en"])
            self.assertEqual(walk.sent, {1})
            self.assertEqual(walk.reply_to(["Which colour?"]), (run_usecases.GO_ON["en"], False))
            said = []
            walk.say = said.append
            self.assertTrue(walk.send_unsent_answers())
            self.assertEqual(
                said, ["Also note:\n- Technicians use it.\n- Keep nothing.\n- No budget is set."]
            )
            self.assertFalse(walk.send_unsent_answers())  # each of them once
            walk.log_file.close()

    def test_a_case_without_answers_says_the_generic_line(self):
        with tempfile.TemporaryDirectory() as folder:
            walk = self.walk(folder, [])
            said = walk.reply_to(["What is the schema?"])
            self.assertEqual(said, (run_usecases.GO_ON["en"], False))
            walk.log_file.close()


class RunDue(unittest.TestCase):
    def test_the_first_run_is_due(self):
        self.assertTrue(run_usecases.run_due(0, False, None, "v1", False))

    def test_a_changed_package_is_run_again(self):
        self.assertTrue(run_usecases.run_due(1, False, "v1", "v2", True))
        self.assertTrue(run_usecases.run_due(1, True, "v1", "v2", False))  # after a reopened gate

    def test_the_same_package_is_not_run_again(self):
        self.assertFalse(run_usecases.run_due(1, False, "v1", "v1", True))
        self.assertFalse(run_usecases.run_due(1, True, "v1", "v1", True))

    def test_without_a_version_a_reply_after_a_failed_run_is_enough(self):
        self.assertTrue(run_usecases.run_due(1, False, None, None, True))
        self.assertFalse(run_usecases.run_due(1, False, None, None, False))
        self.assertFalse(run_usecases.run_due(1, True, None, None, True))

    def test_three_runs_a_case(self):
        self.assertTrue(run_usecases.run_due(2, False, "v2", "v3", True))
        self.assertFalse(run_usecases.run_due(3, False, "v3", "v4", True))


@unittest.skipUnless(EVALUATION.is_dir(), "the evaluation cases are not in this checkout")
class FromEvaluation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = {c["id"]: c for c in run_usecases.cases_from_evaluation(EVALUATION)}

    def test_every_evaluation_case_becomes_a_case(self):
        self.assertEqual(len(self.cases), 5)
        for case in self.cases.values():
            self.assertTrue(case["description"], case["id"])
            self.assertGreaterEqual(len(case["answers"]), 9, case["id"])
            for answer in case["answers"]:
                self.assertRegex(answer["id"], r"^SA\d\d$")
                self.assertTrue(answer["text"] and answer["keywords"], answer["id"])
            self.assertTrue(case["inputs"], case["id"])
            for name in case["inputs"]:
                self.assertTrue(Path(name).is_file(), name)

    def test_the_inputs_are_what_a_run_reads_not_what_it_is_checked_against(self):
        names = [Path(p).name for p in self.cases["uc01-audio-incident"]["inputs"]]
        self.assertEqual(names, ["incident_report_fi.wav"])
        names = {Path(p).name for p in self.cases["uc03-document-rag"]["inputs"]}
        self.assertEqual(len(names), 6)  # three documents, two JSON files and the bundle
        self.assertIn("poc_input_bundle.json", names)
        for case in self.cases.values():
            for name in case["inputs"]:
                self.assertNotIn("expected", Path(name).name)

    def test_a_question_about_the_schema_gets_the_schema_answer(self):
        answers = self.cases["uc01-audio-incident"]["answers"]
        asked = [
            "Which fields should the ticket contain, and which are required?",
            "Who reviews the ticket before it goes into the system?",
        ]
        picked = [answers[i]["id"] for i, _ in run_usecases.match_answers(asked, answers)]
        self.assertEqual(picked[0], "SA03")
        self.assertIn(picked[1], ("SA01", "SA05"))

    def test_the_cases_file_is_not_written_into_a_repository(self):
        self.assertIsNotNone(run_usecases.repository_of(HERE))
        self.assertIsNone(run_usecases.repository_of(Path(tempfile.gettempdir())))


class Cases(unittest.TestCase):
    def test_every_listed_input_exists_and_is_small(self):
        cases = json.loads((HERE / "usecases.json").read_text(encoding="utf-8"))["cases"]
        total = 0
        for case in cases:
            self.assertIn(case.get("pace"), (None, "quick", "thorough"), case["id"])
            for name in case.get("inputs", []):
                path = HERE / name
                self.assertTrue(path.is_file(), f"{case['id']}: {name}")
                total += path.stat().st_size
        self.assertLess(total, 600_000)

    def test_pace_lines_exist_in_both_languages(self):
        for pace in ("quick", "thorough"):
            self.assertEqual(set(run_usecases.PACE[pace]), {"fi", "en"})

    def test_generated_inputs_are_the_committed_ones(self):
        invoice = make_inputs.invoice(
            "1001",
            "3.11.2026",
            "17.11.2026",
            "10016",
            [("Kopiopaperi A4, 5 x 500 arkkia", 12, 24.90), ("Mustekasetti MK-12", 4, 39.00)],
        )
        self.assertEqual(invoice, (HERE / "inputs" / "invoice-1001.pdf").read_bytes())
        self.assertTrue(invoice.startswith(b"%PDF-") and invoice.rstrip().endswith(b"%%EOF"))


if __name__ == "__main__":
    unittest.main()
