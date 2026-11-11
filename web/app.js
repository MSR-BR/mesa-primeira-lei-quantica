'use strict';
let workspace;
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => new Date(value).toLocaleString('pt-BR', {dateStyle:'medium',timeStyle:'short'});
const githubURL = path => `https://github.com/${workspace.repository}/${path}`;
function setView() {
  const hash=location.hash.slice(1)||'article';
  const aliases={suggestions:'revisions',versions:'article'};
  const view=(hash.startsWith('manuscript-') ? 'manuscript' : aliases[hash])||(['article','manuscript','revisions','guide'].includes(hash)?hash:'article');
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==view);
  document.querySelectorAll('nav a').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  if(!['article','manuscript','revisions','guide','suggestions','versions'].includes(hash))requestAnimationFrame(()=>document.getElementById(hash)?.scrollIntoView());
}
function editableSections(){return [{id:'abstract',title:'Abstract',path:'article/main.tex',fragment:'abstract'},...workspace.sections];}
function setupBlockEditors() {
  for (const article of document.querySelectorAll('#article-sections > article')) {
    const section = workspace.sections.find(item => article.id === 'section-' + item.id);
    article.querySelectorAll('.article-body h1, .article-body h2').forEach((heading, index) => {
      const actions = document.createElement('div');
      actions.className = 'section-tools block-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Abrir editor';
      button.setAttribute('aria-label', 'Abrir editor de ' + heading.textContent.trim());
      button.onclick = () => openSection(section.path, index);
      actions.append(button);
      heading.after(actions);
    });
  }
}
let manuscript;
const manuscriptPath = 'manuscript.json';
const manuscriptIsLocal = () => workspace.repository === 'example-owner/example-article';
const manuscriptStorageKey = () => 'article-manuscript:' + workspace.repository + ':' + workspace.title;

function renderManuscript() {
  const container = $('#manuscript-sections');
  container.replaceChildren();
  for (const section of manuscript.sections) {
    const article = document.createElement('article');
    article.className = 'article-section manuscript-section';
    article.id = 'manuscript-' + section.id;
    const heading = document.createElement('h2');
    heading.textContent = section.title;
    article.append(heading);
    if (!section.blocks.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Sem conteúdo.';
      article.append(empty);
    }
    for (const block of section.blocks) {
      const details = document.createElement('details');
      details.open = true;
      const label = document.createElement('summary');
      label.textContent = block.title;
      const body = document.createElement('pre');
      body.textContent = block.source;
      details.append(label, body);
      if (block.manualReferences) {
        const manual = document.createElement('p');
        manual.textContent = 'Referências manuais: ' + block.manualReferences;
        details.append(manual);
      }
      if (block.researchReferences?.length) {
        const references = document.createElement('ul');
        for (const reference of block.researchReferences) {
          const item = document.createElement('li');
          item.textContent = [reference.title, reference.year, reference.doi || reference.url].filter(Boolean).join(' · ');
          references.append(item);
        }
        details.append(references);
      }
      article.append(details);
    }
    container.append(article);
  }
}

async function setupManuscript() {
  const response = await fetch(manuscriptPath, {cache:'no-store'});
  if (!response.ok) throw new Error('Não foi possível carregar o manuscrito.');
  manuscript = await response.json();
  if (manuscriptIsLocal()) {
    const saved = localStorage.getItem(manuscriptStorageKey());
    if (saved) manuscript = JSON.parse(saved);
  }
  renderManuscript();
  $('#transfer-section').onchange = () => {
    const custom = $('#transfer-section').value === 'other';
    $('#custom-section').hidden = !custom;
    $('#transfer-title').required = custom;
    if (custom) $('#transfer-title').focus();
  };
  $('#transfer-form').onsubmit = transferToManuscript;
}

function resetTransfer() {
  const form = $('#transfer-form');
  form.reset();
  $('#manuscript-transfer').open = false;
  $('#transfer-status').textContent = '';
  $('#custom-section').hidden = true;
  $('#transfer-title').required = false;
  $('#transfer-section').replaceChildren(new Option('Escolha uma seção', ''), ...manuscript.sections.map(s => new Option(s.title, s.id)), new Option('Outra', 'other'));
  $('#transfer-position').replaceChildren(...manuscript.sections.map((s, index) => new Option('Antes de ' + s.title, index)), new Option('No fim do manuscrito', manuscript.sections.length));
  $('#transfer-position').value = String(manuscript.sections.length);
}

function insertManuscriptBlock(draft, destination, title, beforeId, block) {
  let section;
  if (destination === 'other') {
    if (!title || draft.sections.some(item => item.title.toLocaleLowerCase() === title.toLocaleLowerCase()))
      throw new Error('Informe um nome de seção novo.');
    const position = beforeId === null ? draft.sections.length : draft.sections.findIndex(item => item.id === beforeId);
    if (position < 0) throw new Error('A ordem das seções mudou. Reabra o editor.');
    section = {id:crypto.randomUUID(), title, blocks:[]};
    draft.sections.splice(position, 0, section);
  } else {
    section = draft.sections.find(item => item.id === destination);
    if (!section) throw new Error('Escolha uma seção de destino.');
  }
  section.blocks.push(block);
  return section.id;
}

async function transferToManuscript(event) {
  event.preventDefault();
  if (reviewBusy) return;
  const status = $('#transfer-status');
  const source = $('#section-source').value.trim();
  if (!source) {
    status.textContent = 'O bloco está vazio.';
    return;
  }
  const destination = $('#transfer-section').value;
  const title = $('#transfer-title').value.trim();
  const beforeId = manuscript.sections[Number($('#transfer-position').value)]?.id ?? null;
  const block = {
    title: activeSection.title, source, analysisVersion:workspace.version,
    manualReferences:$('#manual-references').value.trim(),
    researchReferences:[...selectedResearch.values()]
  };
  reviewBusy = true;
  $('#transfer-submit').disabled = true;
  try {
    let draft, remoteFile;
    if (manuscriptIsLocal()) {
      draft = JSON.parse(localStorage.getItem(manuscriptStorageKey()) || JSON.stringify(manuscript));
    } else {
      if (!accessToken) throw new Error('Entre com GitHub para salvar no manuscrito compartilhado.');
      remoteFile = await gh('contents/' + manuscriptPath + '?ref=' + encodeURIComponent(workspace.branch || 'main'), {cache:'no-store'});
      draft = JSON.parse(decodeText(remoteFile.content));
    }
    const id = insertManuscriptBlock(draft, destination, title, beforeId, block);
    if (remoteFile) {
      await gh('contents/' + manuscriptPath, {method:'PUT', body:JSON.stringify({
        message:'Incluir bloco no manuscrito: ' + block.title,
        content:encodeText(JSON.stringify(draft, null, 2) + '\n'),
        sha:remoteFile.sha, branch:workspace.branch || 'main'
      })});
    } else {
      localStorage.setItem(manuscriptStorageKey(), JSON.stringify(draft));
    }
    manuscript = draft;
    renderManuscript();
    $('#section-editor').close();
    location.hash = 'manuscript-' + id;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    reviewBusy = false;
    $('#transfer-submit').disabled = false;
  }
}

function latexBlocks(source) {
  return [...source.matchAll(/^[ \t]*\\(subsection|section)\{([^{}]+)\}[^\n]*\n/gm)];
}
function blockRange(source, index) {
  const headings = latexBlocks(source);
  const heading = headings[index];
  if (!heading) throw new Error('Este trecho mudou. Recarregue o manuscrito.');
  const next = headings.slice(index + 1).find(item => heading[1] === 'subsection' || item[1] === 'section');
  const start = heading.index + heading[0].length;
  const end = next?.index ?? source.length;
  return {start, end, title: heading[2]};
}
function abstractMatch(source){const matches=[...source.matchAll(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g)];if(matches.length!==1)throw new Error('O arquivo precisa conter um único Abstract.');return matches[0];}
function replaceAbstract(source,body){if(/\\(?:begin|end)\{abstract\}/.test(body))throw new Error('Edite somente o texto dentro do Abstract.');const match=abstractMatch(source);const start=match.index+'\\begin{abstract}'.length;return source.slice(0,start)+'\n'+body.trim()+'\n'+source.slice(start+match[1].length);}
function renderRevisionPdfs(){
  const revisions=(workspace.pdfRevisions||[]).filter(item=>typeof item.pdf==='string'&&item.pdf.startsWith(`https://github.com/${workspace.repository}/releases/download/`)&&item.pdf.endsWith('.pdf'));
  $('#revisions-status').textContent=revisions.length?'':'Nenhuma revisão anterior em PDF.';
  $('#revision-pdfs').innerHTML=revisions.map(item=>`<a class="pdf-revision" href="${escapeHTML(item.pdf)}" target="_blank" rel="noopener">PDF · ${escapeHTML(item.version)} ↗</a>`).join('');
}
async function init() {
  try {
    const response = await fetch('workspace.json?v='+Date.now(), {cache:'no-store'});
    if (!response.ok) throw new Error('Não foi possível carregar o manuscrito.');
    workspace = await response.json();
    document.title = workspace.title + ' · Mesa de trabalho';
    $('#article-title').textContent = workspace.title;
    const theme = $('#article-theme');
    theme.textContent = workspace.theme || '';
    theme.hidden = !theme.textContent || theme.textContent === workspace.title;
    $('#article-subtitle').textContent = workspace.subtitle || '';
    $('#article-authors').textContent = workspace.authors.join(' · ');
    $('#team-label').textContent = workspace.authors.join(' / ');
    $('#workspace-name').textContent = workspace.shortTitle || 'ARTIGO EM GRUPO';
    $('#version').textContent = workspace.version;
    $('#repo-link').href = githubURL('');

    $('#download-pdf').hidden = !workspace.pdf;
    if (workspace.pdf) $('#download-pdf').href = workspace.pdf;
    $('#generate-pdf').onclick = generatePdf;

    $('#abstract-text').textContent = workspace.abstract;
    $('#section-abstract').hidden = !workspace.abstract;
    $('#abstract-history').href=githubURL('commits/'+(workspace.branch||'main')+'/article/main.tex');
    $('#article-sections').innerHTML = workspace.sections.map((s,i) => `<article class="article-section" id="section-${escapeHTML(s.id)}"><div class="section-tools"><button data-edit-section="${escapeHTML(s.path)}">Abrir editor</button><a href="${githubURL('commits/main/' + s.path)}" target="_blank" rel="noopener">Histórico ↗</a></div><h2>${escapeHTML(s.title)}</h2><div class="article-body">${s.html}</div></article>`).join('');
    setupBlockEditors();
    await setupManuscript();
    renderRevisionPdfs();
    window.addEventListener('hashchange', setView);
    setupSectionReview(); $('#loading').hidden=true; await completeGitHubLogin(); setView();
  } catch (error) { $('#loading').textContent = 'Não foi possível abrir a área de trabalho. Atualize a página ou consulte o repositório no GitHub.'; console.error(error.message); }
}
init();

/* Section review: credentials remain in memory and are never sent to OpenAI. */
let accessToken = '', activeSection, baseSha, originalText, sourceDocument, reviewResult, reviewBusy=false;
async function generatePdf() {
  const button = $('#generate-pdf');
  const status = $('#pdf-status');
  button.disabled = true;
  status.hidden = false;
  status.textContent = 'Solicitando a geração do PDF…';
  try {
    if (manuscriptIsLocal()) {
      const response = await fetch('generate-pdf', {method:'POST'});
      if (!response.ok) throw new Error('A geração local requer o servidor da mesa (scripts/preview.py).');
      const data = await response.json();
      $('#download-pdf').href = data.pdf + '?v=' + Date.now();
      $('#download-pdf').hidden = false;
      status.textContent = 'PDF pronto para baixar.';
    } else {
      if (!accessToken) throw new Error('Entre com GitHub para gerar o PDF.');
      const requestId = crypto.randomUUID();
      await gh('actions/workflows/publish.yml/dispatches', {
        method:'POST',
        body:JSON.stringify({ref:workspace.branch || 'main', inputs:{pdf_request:requestId}})
      });
      status.textContent = 'Gerando PDF…';
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        const response = await fetch('workspace.json', {cache:'no-store'});
        if (!response.ok) continue;
        const data = await response.json();
        if (data.pdfRequest !== requestId) continue;
        $('#download-pdf').href = data.pdf;
        $('#download-pdf').hidden = false;
        status.textContent = 'PDF pronto para baixar.';
        return;
      }
      status.textContent = 'O PDF ainda não apareceu na mesa. Confira a execução em Actions.';
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function gh(path, options={}) {
  if (!accessToken && options.method && options.method!=='GET') throw new Error('Entre com sua conta pelo botão Entrar com GitHub primeiro.');
  const response=await fetch(`https://api.github.com/repos/${workspace.repository}/${path}`, {...options,headers:{Accept:'application/vnd.github+json',...(accessToken ? {Authorization:`Bearer ${accessToken}`} : {}),'Content-Type':'application/json',...options.headers}});
  if(response.status===401){accessToken='';$('#connect-github').hidden=false;$('#editor-connect').hidden=false;$('#disconnect-github').hidden=true;throw new Error('Sua sessão expirou. Clique em Entrar com GitHub para continuar.');}
  if (!response.ok) throw new Error(response.status===409 || response.status===422 ? 'A seção mudou desde sua leitura. Reabra o formulário para comparar antes de salvar.' : `GitHub: operação não concluída (${response.status}). Confira acesso e permissões.`);
  return response.status===204 ? null : response.json();
}
const encodeText = text => btoa(Array.from(new TextEncoder().encode(text), byte=>String.fromCharCode(byte)).join(''));
const decodeText = text => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g,'')), c=>c.charCodeAt(0)));
function coloredDiff(before, after) {
  const a=before.match(/\s+|[^\s]+/g)||[], b=after.match(/\s+|[^\s]+/g)||[];
  const parts=[]; const emit=(kind,text)=>{if(!text)return;const last=parts[parts.length-1];if(last?.kind===kind)last.text+=text;else parts.push({kind,text});};
  let i=0,j=0;
  if((a.length+1)*(b.length+1)<=4000000){
    const rows=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
    for(let x=a.length-1;x>=0;x--)for(let y=b.length-1;y>=0;y--)rows[x][y]=a[x]===b[y]?rows[x+1][y+1]+1:Math.max(rows[x+1][y],rows[x][y+1]);
    while(i<a.length || j<b.length){if(i<a.length && j<b.length && a[i]===b[j]){emit('',a[i++]);j++;}else if(i<a.length && (j===b.length || rows[i+1][j]>=rows[i][j+1]))emit('del',a[i++]);else emit('ins',b[j++]);}
  }else{
    // Bounded alignment for very long sections; never omits or interprets text.
    while(i<a.length && j<b.length){if(a[i]===b[j]){emit('',a[i++]);j++;continue;}let best;
      for(let x=0;x<40 && i+x<a.length;x++)for(let y=0;y<40 && j+y<b.length;y++)if(a[i+x]===b[j+y] && (!best || x+y<best[0]+best[1]))best=[x,y];
      if(best){emit('del',a.slice(i,i+best[0]).join(''));emit('ins',b.slice(j,j+best[1]).join(''));i+=best[0];j+=best[1];}else{emit('del',a[i++]);emit('ins',b[j++]);}}
    emit('del',a.slice(i).join(''));emit('ins',b.slice(j).join(''));
  }
  return parts.map(part=>part.kind?`<${part.kind}>${escapeHTML(part.text)}</${part.kind}>`:escapeHTML(part.text)).join('');
}
async function openSection(path, block = null) {
  if (reviewBusy) return;
  const section = editableSections().find(item => item.path === path);
  if (!section) return;
  activeSection = {...section, block};
  const editing = activeSection;
  reviewResult = null;
  baseSha = null;
  $('#review-focus').value = '';
  $('#manual-references').value = '';
  $('#research-query').value = '';
  $('#research-results').replaceChildren();
  $('#research-status').textContent = '';
  selectedResearch = new Map();
  $('#research-selected').textContent = '';
  $('#section-comparison').hidden = true;
  $('#accept-review').hidden = true;
  $('#editor-connect').hidden = Boolean(accessToken);
  const local = workspace.repository === 'example-owner/example-article';
  $('#review-section').disabled = $('#save-section').disabled = $('#research-search').disabled = local;
  const cached = section.source || workspace.abstract || '';
  const range = block === null ? null : blockRange(cached, block);
  editing.title = range?.title || section.title;
  $('#section-editor-title').textContent = editing.title;
  $('#research-query').value = [workspace.title, editing.title].filter(Boolean).join(' — ');
  $('#section-source').value = range ? cached.slice(range.start, range.end).trim() : cached;
  $('#section-feedback').textContent = local ? 'Prévia local. A busca e a revisão com IA estarão disponíveis após configurar o repositório.' : 'Carregando texto atual…';
  $('#section-editor').showModal();
  resetTransfer();
  $('#section-source').focus();
  if (local) return;
  try {
    const file = await gh(`contents/${path}?ref=${encodeURIComponent(workspace.branch || 'main')}`);
    if (activeSection !== editing || !$('#section-editor').open) return;
    sourceDocument = decodeText(file.content);
    if (range) {
      const current = blockRange(sourceDocument, block);
      const publishedHeadings = latexBlocks(cached).map(item => item[0].trim());
      const currentHeadings = latexBlocks(sourceDocument).map(item => item[0].trim());
      if (JSON.stringify(currentHeadings) !== JSON.stringify(publishedHeadings))
        throw new Error('A estrutura mudou. Abra a versão mais recente da mesa.');
      editing.range = current;
    }
    originalText = range ? sourceDocument.slice(editing.range.start, editing.range.end).trim()
      : editing.fragment === 'abstract' ? abstractMatch(sourceDocument)[1].trim() : sourceDocument;
    $('#section-source').value = originalText;
    baseSha = file.sha;
    $('#section-feedback').textContent = 'Descreva a mudança, edite o trecho ou inclua referências para a revisão.';
  } catch (error) {
    if (activeSection === editing) $('#section-feedback').textContent = error.message;
  }
}

let selectedResearch = new Map();
async function workflowResult(inputs) {
  const id = crypto.randomUUID();
  await gh('actions/workflows/section-review.yml/dispatches', {
    method: 'POST',
    body: JSON.stringify({ref: workspace.branch || 'main', inputs: {request_id: id, ...inputs}})
  });
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    try {
      const file = await gh(`contents/reviews/requests/${id}.json?ref=collaboration`);
      const result = JSON.parse(decodeText(file.content));
      if (result.error) throw new Error(result.error);
      return result;
    } catch (error) {
      if (!error.message.includes('(404)')) throw error;
    }
  }
  throw new Error('A solicitação ainda está em andamento. Confira a execução no GitHub.');
}
async function searchResearchStarter() {
  const topic = $('#research-query').value.trim();
  if (!topic || reviewBusy || !baseSha) return;
  reviewBusy = true;
  $('#research-search').disabled = $('#review-section').disabled = $('#save-section').disabled = true;
  const status = $('#research-status');
  status.textContent = 'Buscando referências no Research Starter…';
  try {
    const result = await workflowResult({mode:'research', section:activeSection.path, base_sha:baseSha, topic});
    const list = $('#research-results');
    list.replaceChildren();
    for (const reference of result.references) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      const key = reference.doi || reference.url || reference.title;
      checkbox.checked = selectedResearch.has(key);
      checkbox.onchange = () => {
        if (checkbox.checked) selectedResearch.set(key, {...reference, reportId:result.reportId, topic});
        else selectedResearch.delete(key);
        $('#research-selected').textContent = selectedResearch.size + ' referência(s) do RS selecionada(s)';
      };
      label.append(checkbox, ' ' + reference.title + (reference.year ? ' (' + reference.year + ')' : ''));
      list.append(label);
    }
    status.textContent = result.references.length ? 'Selecione as referências para esta revisão.' : 'Nenhuma referência retornada.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    reviewBusy = false;
    $('#research-search').disabled = $('#review-section').disabled = $('#save-section').disabled = false;
  }
}
async function requestSectionReview() {
  if(reviewBusy || !baseSha) return;
  if(new TextEncoder().encode($('#section-source').value).length>45000){$('#section-feedback').textContent='Esta seção ultrapassa o limite de 45000 bytes para revisão.';return;}
  reviewBusy=true; $('#review-section').disabled=true; $('#save-section').disabled=true;
  const source=$('#section-source').value, section=activeSection.path;
  $('#section-feedback').textContent='Revisão solicitada. Aguarde; você pode manter este formulário aberto.';
  try {
    const references = JSON.stringify({manual:$('#manual-references').value.trim(), researchStarter:[...selectedResearch.values()]});
    if (references.length > 12000) throw new Error('Reduza a lista de referências para enviar a revisão.');
    const result = await workflowResult({section, source, base_sha:baseSha, focus:$('#review-focus').value, references, block_title:activeSection.title});
    if(activeSection.path!==section || $('#section-source').value!==source) throw new Error('O texto do formulário mudou durante a revisão. Solicite novamente para comparar a versão atual.');
    reviewResult=result; $('#review-original').textContent=source; $('#review-proposed').textContent=result.revised;
    $('#review-diff').innerHTML=coloredDiff(source,result.revised); $('#review-reason').textContent=result.summary;
    $('#section-comparison').hidden=false; $('#accept-review').hidden=false; $('#accept-review').focus();
    $('#section-feedback').textContent='Confira a comparação. Aceitar coloca a proposta no campo de edição; salvar publica uma nova versão.';
  } catch(error) { $('#section-feedback').textContent=error.message; }
  finally {reviewBusy=false; $('#review-section').disabled=false; $('#save-section').disabled=false;}
}
async function saveWithReference(path, source, branch, entry, message) {
  const key = /^@(?!string\b|preamble\b|comment\b)\w+\s*\{\s*([A-Za-z0-9_.:+/-]+)\s*,/i.exec(entry)?.[1];
  if (!key) throw new Error('Cole uma entrada BibTeX com uma chave válida.');
  let depth = 0;
  const start = entry.indexOf('{');
  for (let i = start; i < entry.length; i++) {
    if (entry[i] === '\\') { i++; continue; }
    if (entry[i] === '{') depth++;
    if (entry[i] === '}' && --depth === 0 && i !== entry.length - 1)
      throw new Error('Cole uma entrada BibTeX por salvamento.');
  }
  if (depth !== 0 || !entry.endsWith('}')) throw new Error('Confira as chaves da entrada BibTeX.');
  const ref = 'git/refs/heads/' + encodeURIComponent(branch);
  const head = (await gh(ref)).object.sha;
  const at = '?ref=' + head;
  const bibPath = 'article/references.bib';
  const [commit, section, bibliography] = await Promise.all([
    gh('git/commits/' + head), gh('contents/' + path + at), gh('contents/' + bibPath + at)
  ]);
  if (section.sha !== baseSha) throw new Error('A seção mudou no GitHub. Reabra o editor antes de salvar.');
  const bib = decodeText(bibliography.content);
  const keys = [...bib.matchAll(/@\w+\s*[{(]\s*([^,\s]+)\s*,/g)].map(item => item[1]);
  if (keys.includes(key) && !bib.includes(entry)) throw new Error('Já existe uma referência com a chave ' + key + '.');
  const tree = [{path, mode:'100644', type:'blob', content:source}];
  if (!keys.includes(key)) tree.push({path:bibPath, mode:'100644', type:'blob', content:bib.trimEnd() + '\n\n' + entry + '\n'});
  const write = (endpoint, method, data) => gh(endpoint, {method, body:JSON.stringify(data)});
  const nextTree = await write('git/trees', 'POST', {base_tree:commit.tree.sha, tree});
  const next = await write('git/commits', 'POST', {message, tree:nextTree.sha, parents:[head]});
  const saved = await gh('contents/' + path + '?ref=' + next.sha);
  await write(ref, 'PATCH', {sha:next.sha, force:false});
  return {content:{sha:saved.sha}};
}
async function saveSection() {
  if (reviewBusy) return;
  if (!baseSha) {
    $('#section-feedback').textContent = 'Reabra o editor para carregar a versão atual antes de salvar.';
    return;
  }
  if (reviewResult) {
    $('#section-feedback').textContent = 'Aceite ou descarte a proposta da IA antes de salvar.';
    $('#accept-review').focus();
    return;
  }
  $('#save-section').disabled=true;
  try {
    const body = $('#section-source').value;
    if (activeSection.range && latexBlocks(body).length !== latexBlocks(originalText).length)
      throw new Error('Preserve a estrutura de seções ao editar este trecho.');
    const updatedSource=activeSection.range
      ? sourceDocument.slice(0, activeSection.range.start) + body.trim() + '\n\n' + sourceDocument.slice(activeSection.range.end)
      : activeSection.fragment==='abstract'?replaceAbstract(sourceDocument,$('#section-source').value):$('#section-source').value;
    const entry = $('#manual-references').value.trim();
    const branch = workspace.branch || 'main';
    const path = activeSection.path;
    const message = 'Atualizar seção: ' + activeSection.title;
    const result = /^@\w+\s*[{(]/.test(entry)
      ? await saveWithReference(path, updatedSource, branch, entry, message + ' e bibliografia')
      : await gh('contents/' + path, {method:'PUT',body:JSON.stringify({message,content:encodeText(updatedSource),sha:baseSha,branch})});
    baseSha=result.content.sha; sourceDocument=updatedSource; originalText=$('#section-source').value;
    if (activeSection.range) activeSection.range = blockRange(updatedSource, activeSection.block);
    $('#section-feedback').textContent='Seção salva. Recarregue a mesa após a publicação da alteração.';
  } catch(error) {$('#section-feedback').textContent=error.message;}
  finally {$('#save-section').disabled=false;}
}
function setupSectionReview() {
 const panel=$('#collaboration-account'); panel.innerHTML='<strong>Sua conta para colaborar</strong><p>Entre com sua conta do GitHub para revisar e salvar. A autorização fica limitada ao repositório do artigo; nenhuma credencial precisa ser copiada.</p><button type="button" id="connect-github" class="button primary">Entrar com GitHub</button> <button type="button" id="disconnect-github" class="button" hidden>Sair</button><p id="connection-status" role="status"></p>';
 $('#connect-github').onclick=beginGitHubLogin; $('#editor-connect').onclick=beginGitHubLogin;
 $('#disconnect-github').onclick=disconnectGitHub;
 document.querySelectorAll('[data-edit-section]').forEach(button=>button.onclick=()=>openSection(button.dataset.editSection));
 $('#close-section-editor').onclick=()=>{if(!reviewBusy)$('#section-editor').close();};
 $('#section-editor').addEventListener('cancel',event=>{if(reviewBusy)event.preventDefault();});
 $('#research-search').onclick=searchResearchStarter;
 $('#review-section').onclick=requestSectionReview; $('#save-section').onclick=saveSection;
 $('#accept-review').onclick=()=>{if(reviewResult){$('#section-source').value=reviewResult.revised;reviewResult=null;$('#section-comparison').hidden=true;$('#accept-review').hidden=true;$('#save-section').focus();$('#section-feedback').textContent='Sugestão aplicada ao formulário. Você pode ajustar o texto antes de salvar.';}};
 $('#discard-review').onclick=()=>{reviewResult=null;$('#section-comparison').hidden=true;$('#accept-review').hidden=true;};
}

let tokenExpiresAt=0;
const authStorageKey='article-github-login';
function authBase(){const url=new URL(workspace.authUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/')throw new Error('A conexão com GitHub ainda está em configuração.');return url.origin;}
async function beginGitHubLogin(){
 try{
  const base=authBase(),verifier=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const state=btoa(Array.from(digest,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const draft=activeSection && $('#section-editor').open ? {section:activeSection.path,source:$('#section-source').value,sha:baseSha,focus:$('#review-focus').value,block:activeSection.block,manual:$('#manual-references').value,topic:$('#research-query').value,selected:[...selectedResearch]}:null;
  sessionStorage.setItem(authStorageKey,JSON.stringify({repository:workspace.repository,verifier,hash:location.hash,draft,createdAt:Date.now()}));
  location.assign(`${base}/api/login?state=${encodeURIComponent(state)}`);
 }catch(error){$('#connection-status').textContent=error.message;$('#section-feedback').textContent=error.message;}
}
async function completeGitHubLogin(){
 if(!location.hash.startsWith('#github-login='))return;
 const ticket=location.hash.slice('#github-login='.length);
 let saved;try{saved=JSON.parse(sessionStorage.getItem(authStorageKey)||'null');sessionStorage.removeItem(authStorageKey);}catch{/* No credential is stored. */}
 history.replaceState(null,'',saved?.hash||'#article');setView();
 try{
  if(!saved || saved.repository!==workspace.repository || Date.now()-saved.createdAt>900000)throw new Error('A entrada não pertence a esta aba ou expirou. Clique em Entrar com GitHub novamente.');
  const response=await fetch(authBase()+'/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,verifier:saved.verifier})});
  const grant=await response.json();if(!response.ok||grant.error)throw new Error(grant.error||'Não foi possível concluir a entrada.');
  if(typeof grant.token!=='string'||!/^ghu_[A-Za-z0-9_]{10,300}$/.test(grant.token)||typeof grant.login!=='string')throw new Error('Não foi possível confirmar a conexão.');
  accessToken=grant.token;tokenExpiresAt=Date.now()+Math.min(Number(grant.expiresIn)||28800,28800)*1000;
  $('#connection-status').textContent=`Conectado como ${grant.login}. Você pode revisar e salvar seções.`;
  $('#connect-github').hidden=true;$('#editor-connect').hidden=true;$('#disconnect-github').hidden=false;

 }catch(error){$('#connection-status').textContent=error.message;}
 finally{
  if(saved?.repository===workspace.repository && saved.draft && editableSections().some(section=>section.path===saved.draft.section)){
   await openSection(saved.draft.section,saved.draft.block??null);const currentSha=baseSha;baseSha=currentSha===saved.draft.sha?currentSha:null;$('#section-source').value=saved.draft.source;$('#review-focus').value=saved.draft.focus;$('#manual-references').value=saved.draft.manual||'';$('#research-query').value=saved.draft.topic||'';selectedResearch=new Map(saved.draft.selected||[]);$('#research-selected').textContent=selectedResearch.size?selectedResearch.size+' referência(s) do RS selecionada(s)':'';
   $('#section-feedback').textContent=currentSha!==saved.draft.sha?'Seu texto foi preservado, mas a seção mudou durante a entrada. Compare com a versão atual antes de salvar.':accessToken?'Conectado ao GitHub. Seu texto foi preservado; você pode revisar ou salvar.':'Seu texto foi preservado. Entre com GitHub para revisar ou salvar.';
  }
 }
}
async function disconnectGitHub(){
 const token=accessToken;accessToken='';tokenExpiresAt=0;
 $('#connect-github').hidden=false;$('#editor-connect').hidden=false;$('#disconnect-github').hidden=true;$('#connection-status').textContent='Desconectado desta página.';
 if(token)try{const response=await fetch(authBase()+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});if(!response.ok)throw new Error();}catch{$('#connection-status').textContent='Desconectado desta página. Não foi possível confirmar a revogação da sessão no GitHub; ela expirará automaticamente.';}
}
