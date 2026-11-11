import unittest
from build import stamp_date

class DateStampTests(unittest.TestCase):
    def test_replaces_balanced_date(self):
        source=r'\date{\textit{A date}}'+'\n'+r'\begin{document}'
        self.assertEqual(stamp_date(source,r'\date{version}'),r'\date{version}'+'\n'+r'\begin{document}')
    def test_adds_date_when_missing(self):
        self.assertIn(r'\date{version}'+'\n'+r'\begin{document}',stamp_date(r'\begin{document}',r'\date{version}'))
    def test_ignores_commented_date(self):
        source='% '+r'\date{old}'+'\n'+r'\begin{document}'
        self.assertIn('% '+r'\date{old}',stamp_date(source,r'\date{version}'))

if __name__=='__main__':unittest.main()
