"""Compile the article and build a portable GitHub Pages workspace."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'article-workspace.json').read_text())
REPO = os.getenv('GITHUB_REPOSITORY', CONFIG['repository'])
SECTIONS = sorted((ROOT / 'article/sections').rglob('*.tex'))

def run(args, cwd=ROOT):
    result = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if result.returncode:
        print(result.stdout[-6000:])
        raise RuntimeError(f'Build tool failed: {args[0]}')

def convert(path, bibliography=True):
    args = ['pandoc', str(path), '--from=latex' if path.suffix == '.tex' else '--from=markdown', '--to=html5', '--mathml']
    if bibliography:
        args += ['--citeproc', '--bibliography', str(ROOT / 'article/references.bib')]
    if path.suffix == '.tex':
        # Normalize display-only TeX commands that Pandoc's MathML parser cannot read.
        latex = re.sub(r'\\hspace\{[^{}]*\}', '', path.read_text())
        latex = latex.replace(r'\textcolor{blue}', '')
        args[1] = '-'
        return subprocess.check_output(args, cwd=ROOT, text=True, input=latex)
    return subprocess.check_output(args, cwd=ROOT, text=True)


def stamp_date(main, value):
    """Replace a real date command, preserving balanced nested LaTeX braces."""
    match = re.search(r'(?m)^[ \t]*\\date\s*\{', main)
    if match:
        depth, end = 1, match.end()
        while end < len(main) and depth:
            char = main[end]
            if char == '\\':
                end += 2
                continue
            depth += (char == '{') - (char == '}')
            end += 1
        if depth:
            raise ValueError('Unbalanced date command in main.tex')
        return main[:match.start()] + value + main[end:]
    marker = r'\begin{document}'
    if marker not in main:
        raise ValueError('main.tex needs a document environment')
    return main.replace(marker, value + '\n' + marker, 1)

def pdf_revisions(prefix):
    """One archived PDF per prior manuscript tree; skip interface-only rebuilds."""
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    try:
        current = git('rev-parse', 'HEAD:article')
        tags = [tag for tag in git('tag', '--list').splitlines() if re.fullmatch(r'r\d+\.\d+-[0-9a-f]{8}', tag)]
    except subprocess.CalledProcessError:
        return []
    tags.sort(key=lambda tag: tuple(map(int, re.match(r'r(\d+)\.(\d+)-', tag).groups())), reverse=True)
    seen, revisions = {current}, []
    for tag in tags:
        try:
            tree = git('rev-parse', tag + ':article')
        except subprocess.CalledProcessError:
            continue
        if tree in seen:
            continue
        seen.add(tree)
        revisions.append({'version': tag, 'pdf': f'https://github.com/{REPO}/releases/download/{tag}/{prefix}{tag}.pdf'})
    return revisions

def build(output, compile_pdf=True, previous_pdf=None):
    output = Path(output).resolve()
    if output == ROOT or ROOT not in output.parents:
        raise ValueError('Output must be a subdirectory of this workspace')
    output.mkdir(parents=True, exist_ok=True)
    sha = os.getenv('GITHUB_SHA') or hashlib.sha256(b''.join(p.read_bytes() for p in sorted((ROOT / 'article').rglob('*.tex')))).hexdigest()
    revision = os.getenv('GITHUB_RUN_NUMBER', 'local')
    attempt = os.getenv('GITHUB_RUN_ATTEMPT', '1')
    now = dt.datetime.now(dt.timezone.utc)
    version = f'r{revision}.{attempt}-{sha[:8]}'
    pdfname = f'article-{version}.pdf'
    references = {}
    pdf_request = os.getenv('PDF_REQUEST', '')
    if compile_pdf:
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary) / 'article'
            shutil.copytree(ROOT / 'article', work)
            main = (work / 'main.tex').read_text()
            main = stamp_date(main, r'\date{Working draft --- ' + version + r'\\' + now.strftime('%Y-%m-%d %H:%M UTC') + '}')
            (work / 'main.tex').write_text(main)
            run(['latexmk', '-xelatex', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-latexoption=-no-shell-escape', 'main.tex'], work)
            references = dict(re.findall(r'\\newlabel\{([^}]+)\}\{\{([^}]+)\}', (work / 'main.aux').read_text()))
            shutil.copy2(work / 'main.pdf', output / pdfname)
    elif previous_pdf is not None and (previous_pdf / 'version.json').is_file():
        previous = json.loads((previous_pdf / 'version.json').read_text())
        pdfname = previous['pdf']
        if not re.fullmatch(r'article-r[0-9]+[.][0-9]+-[a-f0-9]{8}[.]pdf', pdfname):
            raise ValueError('Nome inválido para o PDF anterior.')
        shutil.copy2(previous_pdf / pdfname, output / pdfname)
        pdf_request = previous.get('pdfRequest', '')
    else:
        pdfname = ''
    if pdfname:
        shutil.copy2(output / pdfname, output / 'article.pdf')
    assets = output / 'figures'
    assets.mkdir(exist_ok=True)
    for figure in (ROOT / 'article/figures').rglob('*'):
        if not figure.is_file():
            continue
        destination = assets / figure.relative_to(ROOT / 'article/figures')
        destination.parent.mkdir(parents=True, exist_ok=True)
        if figure.suffix.lower() == '.pdf':
            run(['pdftoppm', '-scale-to', '1600', '-png', '-singlefile', str(figure), str(destination.with_suffix(''))])
        elif figure.suffix.lower() in {'.png', '.jpg', '.jpeg', '.svg'}:
            shutil.copy2(figure, destination)
    sections = []
    section_labels = {}
    for index, source in enumerate(SECTIONS, 1):
        for label in re.findall(r'\\label\{(sec:[^}]+)\}', source.read_text()):
            section_labels[label] = (source.stem, index)
    for source in SECTIONS:
        body = convert(source)
        body = re.sub(r'src="figures/([^\"]+)\.pdf"', r'src="figures/\1.png"', body)
        body = re.sub(r'<embed src="([^"]+)"\s*/>', r'<img src="\1" alt="Figure from the manuscript" loading="lazy">', body)
        for label, number in references.items():
            body = re.sub(r'(<a[^>]+data-reference="' + re.escape(label) + r'">)[^<]+(</a>)', lambda m: m.group(1) + number + m.group(2), body)
        table_labels = re.findall(r'\\begin\{table\}[^\n]*[\s\S]*?\\label\{([^}]+)\}[\s\S]*?\\end\{table\}', source.read_text())
        for label in table_labels:
            body = body.replace('<table>', '<table id="' + label + '">', 1)
        for label, (target, number) in section_labels.items():
            body = body.replace('href="#' + label + '"', 'href="#section-' + target + '"').replace('[' + label + ']', str(number))
        body = body.replace('id="refs"', 'id="refs-' + source.stem + '"').replace('id="ref-', 'id="' + source.stem + '-ref-').replace('href="#ref-', 'href="#' + source.stem + '-ref-')
        match = re.search(r'\\section\{([^}]+)\}', source.read_text())
        heading = re.search(r'^% Mesa: (.+)$', source.read_text(), re.M)
        sections.append({'id': source.stem, 'title': heading.group(1) if heading else match.group(1) if match else source.stem, 'path': str(source.relative_to(ROOT)), 'html': body, 'source': source.read_text()})
    # Render title and abstract from the canonical source, without duplicating sections.
    main = (ROOT / 'article/main.tex').read_text()
    abstract_match = re.search(r'\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}', main)
    abstract = abstract_match.group(1).strip() if abstract_match else ''
    data = {'pdfRevisions': pdf_revisions('article-'), 'authUrl': CONFIG.get('authUrl',''), 'branch': CONFIG.get('branch','main'), 'repository': REPO, 'title': CONFIG['title'], 'theme': CONFIG.get('theme') or CONFIG['title'], 'subtitle': CONFIG.get('subtitle', ''), 'shortTitle': CONFIG.get('shortTitle', 'ARTIGO EM GRUPO'), 'authors': CONFIG['authors'], 'version': version, 'sha': sha, 'generatedAt': now.isoformat(), 'pdf': pdfname, 'compiled': compile_pdf, 'abstract': abstract, 'sections': sections, 'runUrl': f'https://github.com/{REPO}/actions/runs/{os.getenv("GITHUB_RUN_ID", "")}' }
    data['pdfRequest'] = pdf_request
    (output / 'workspace.json').write_text(json.dumps(data, ensure_ascii=False))
    shutil.copy2(ROOT / 'manuscript.json', output / 'manuscript.json')
    for name in ['index.html', 'style.css', 'app.js']:
        shutil.copy2(ROOT / 'web' / name, output / name)
    index = output / 'index.html'
    html = index.read_text()
    for attribute, asset in [('src', 'app.js'), ('href', 'style.css')]:
        digest = hashlib.sha256((output / asset).read_bytes()).hexdigest()[:12]
        html = html.replace(f'{attribute}="{asset}"', f'{attribute}="{asset}?v={digest}"')
    index.write_text(html)
    (output / '.nojekyll').touch()
    (output / 'version.json').write_text(json.dumps({k: data[k] for k in ['version', 'sha', 'generatedAt', 'pdf', 'compiled', 'pdfRequest']}))
    print(json.dumps({'version': version, 'pdf': pdfname, 'output': str(output)}))
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            stream.write(f'version={version}\npdf={pdfname}\n')
    return data

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default=str(ROOT / 'site'))
    parser.add_argument("--site-only", action="store_true")
    parser.add_argument("--previous-pdf", type=Path)
    args = parser.parse_args()
    build(args.output, compile_pdf=not args.site_only, previous_pdf=args.previous_pdf)
