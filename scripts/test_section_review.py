import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('section_review',Path(__file__).with_name('section_review.py'))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class SectionReviewTests(unittest.TestCase):
 def test_validation_rejects_paths_and_missing_source(self):
  source=next((worker.ROOT/'article/sections').glob('*.tex'))
  valid={'request_id':'a'*8+'-'+'b'*4+'-'+'c'*4+'-'+'d'*4+'-'+'e'*12,'section':source.relative_to(worker.ROOT).as_posix(),'base_sha':'a'*40,'source':'Texto'}
  worker.validate(valid)
  worker.validate(dict(valid,section="article/main.tex"))
  for patch in [{'section':'article/sections/../../.env'},{'source':''},{'source':'a'*45001},{'base_sha':'bad'},{'request_id':'../outside'}]:
   with self.assertRaises(ValueError):worker.validate(dict(valid,**patch))
if __name__=='__main__':unittest.main()
