"""Offline checks of the runner's own logic.

Run in this folder: python -m unittest test_run_usecases
"""

import json
import unittest
from pathlib import Path

import make_inputs
import run_usecases

HERE = Path(__file__).resolve().parent


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
