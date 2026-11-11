import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('workspace_build',Path(__file__).with_name('build.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class PdfHistoryTests(unittest.TestCase):
 def test_interface_builds_do_not_duplicate_manuscript_pdfs(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder)
   def git(*args):subprocess.run(['git',*args],cwd=root,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   git('init');(root/'article').mkdir();(root/'article/main.tex').write_text('Version one')
   def commit():
    git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','Fixture')
   commit();git('tag','r1.1-11111111')
   (root/'web.txt').write_text('Only interface changed');commit();git('tag','r2.1-22222222')
   (root/'article/main.tex').write_text('Current manuscript');commit();git('tag','r3.1-33333333')
   old=builder.ROOT;builder.ROOT=root
   try:revisions=builder.pdf_revisions('article-')
   finally:builder.ROOT=old
   self.assertEqual([item['version'] for item in revisions],['r2.1-22222222'])
   self.assertTrue(revisions[0]['pdf'].endswith('/article-r2.1-22222222.pdf'))
if __name__=='__main__':unittest.main()
