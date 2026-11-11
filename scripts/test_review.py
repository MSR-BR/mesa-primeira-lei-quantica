import unittest
from review import validate_suggestions

class SuggestionValidationTests(unittest.TestCase):
    def test_only_exact_unique_known_section_is_applicable(self):
        valid={'section':'article/sections/method.tex','original':'An exact passage','replacement':'A clearer passage'}
        unknown={'section':'../../.env','original':'secret','replacement':'x'}
        ambiguous={'section':'article/sections/method.tex','original':'repeated','replacement':'x'}
        advice={'section':'article/sections/method.tex','original':'','replacement':''}
        review={'suggestions':[valid,unknown,ambiguous,advice]}
        accepted=validate_suggestions(review, {'article/sections/method.tex':'An exact passage repeated repeated'})
        self.assertEqual(accepted,[valid])
        self.assertFalse(unknown['applicable'])
        self.assertFalse(ambiguous['applicable'])
        self.assertFalse(advice['applicable'])

    def test_overlapping_changes_are_not_applied_twice(self):
        a={'section':'section.tex','original':'one two','replacement':'first'}
        b={'section':'section.tex','original':'two','replacement':'second'}
        self.assertEqual(validate_suggestions({'suggestions':[a,b]}, {'section.tex':'one two three'}),[a])

class UnsafeReplacementTests(unittest.TestCase):
    def test_file_read_commands_are_not_proposed_as_automatic_edits(self):
        edit={'section':'section.tex','original':'original passage','replacement':r'\input{/etc/passwd}'}
        self.assertEqual(validate_suggestions({'suggestions':[edit]}, {'section.tex':'original passage'}),[])
        self.assertFalse(edit['applicable'])

if __name__=='__main__': unittest.main()
