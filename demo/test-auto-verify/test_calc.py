import unittest
from calc import add, subtract

class TestCalc(unittest.TestCase):
    def test_add_positive_numbers(self):
        """正の整数同士の加算をテスト（例：2 + 3 = 5）"""
        self.assertEqual(add(2, 3), 5)

    def test_add_negative_numbers(self):
        """負の整数を含む加算をテスト（例：-1 + 1 = 0, -1 + -1 = -2）"""
        self.assertEqual(add(-1, 1), 0)
        self.assertEqual(add(-1, -1), -2)

    def test_add_zero(self):
        """ゼロを含む加算をテスト（例：5 + 0 = 5）"""
        self.assertEqual(add(5, 0), 5)
        self.assertEqual(add(0, 0), 0)

    def test_subtract(self):
        """減算をテスト"""
        self.assertEqual(subtract(10, 5), 5)
        self.assertEqual(subtract(-1, -1), 0)

if __name__ == "__main__":
    unittest.main()
