import unittest
from calculator import add, sub, mul, div
import subprocess
import sys

class TestCalculatorLogic(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(10, 5), 15)
        self.assertEqual(add(-1, 1), 0)

    def test_sub(self):
        self.assertEqual(sub(10, 5), 5)
        self.assertEqual(sub(5, 10), -5)

    def test_mul(self):
        self.assertEqual(mul(3, 4), 12)
        self.assertEqual(mul(10, 0), 0)

    def test_div(self):
        self.assertEqual(div(10, 2), 5)
        with self.assertRaises(ValueError):
            div(10, 0)

class TestCalculatorCLI(unittest.TestCase):
    def run_cli(self, args):
        result = subprocess.run(
            [sys.executable, "calculator.py"] + args,
            capture_output=True,
            text=True
        )
        return result

    def test_cli_add(self):
        res = self.run_cli(["add", "10", "5"])
        self.assertEqual(res.stdout.strip(), "15.0")
        self.assertEqual(res.returncode, 0)

    def test_cli_div_zero(self):
        res = self.run_cli(["div", "10", "0"])
        self.assertIn("Error: Cannot divide by zero", res.stderr)
        self.assertEqual(res.returncode, 1)

if __name__ == "__main__":
    unittest.main()
