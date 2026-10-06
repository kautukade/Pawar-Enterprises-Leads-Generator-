const $ = id => document.getElementById(id);
const SAVED_KEY = 'pe_lead_generator_saved_v1';
let config = { googleEnabled:false, crmWebhookEnabled:false, categories:[], services:[] };
let leads = [];
let saved = loadSaved();

function loadSaved(){
  try{return JSON.parse(localStorage.getItem(SAVED_KEY))||[]}catch{return []}
}
function saveSaved(){localStorage.setItem(SAVED_KEY,JSON.stringify(saved));updateSavedCount()}
function updateSavedCount(){$('savedCount').textContent=saved.length}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function onlyDigits(v=''){return String(v).replace(/\D/g,'')}
function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.hidden=true,2400)}
function csvEscape(v){const s=String(v??'');return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function isSaved(id){return saved.some(x=>x.id===id)}

async function init(){
  updateSavedCount();
  bindNav();
  bindActions();
  try{
    const r=await fetch('/api/config');
    config=await r.json();
    $('category').innerHTML=config.categories.map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');
    $('service').innerHTML=config.services.map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');
    if(!config.googleEnabled){
      [...$('provider').options].forEach(o=>{if(o.value==='google'||o.value==='both')o.disabled=true});
      $('providerStatus').textContent='OpenStreetMap ready • Google key not configured';
    }else{
      $('providerStatus').textContent='OpenStreetMap + Google Places ready';
    }
  }catch(e){
    $('providerStatus').textContent='Backend unavailable';
    showMessage(e.message,true);
  }
  renderSaved();
}

function bindNav(){
  document.querySelectorAll('.nav').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===btn));
    const view=btn.dataset.view;
    $('discoverView').hidden=view!=='discover';
    $('savedView').hidden=view!=='saved';
    $('aboutView').hidden=view!=='about';
    $('pageTitle').textContent=view==='discover'?'Discover Leads':view==='saved'?'Saved Leads':'System Info';
    if(view==='saved')renderSaved();
  }));
}

function bindActions(){
  $('searchForm').addEventListener('submit',runSearch);
  $('tableSearch').addEventListener('input',renderLeads);
  $('scoreFilter').addEventListener('change',renderLeads);
  $('exportBtn').addEventListener('click',()=>downloadCSV(filteredLeads(),'pawar-leads.csv'));
  $('savedExportBtn').addEventListener('click',()=>downloadCSV(saved,'pawar-saved-leads.csv'));
  $('clearSavedBtn').addEventListener('click',()=>{if(confirm('Clear all saved leads?')){saved=[];saveSaved();renderSaved();toast('Saved leads cleared')}});
  $('leadRows').addEventListener('click',handleLeadAction);
  $('savedRows').addEventListener('click',handleLeadAction);
}

async function runSearch(e){
  e.preventDefault();
  const btn=$('generateBtn');
  const payload={
    area:$('area').value.trim(),
    category:$('category').value,
    service:$('service').value,
    provider:$('provider').value,
    radius:Number($('radius').value),
    limit:Number($('limit').value)
  };
  if(!payload.area)return;
  btn.disabled=true;btn.textContent='Searching public data...';
  showMessage('Searching public map/business data. This can take 10–30 seconds.',false);
  try{
    const r=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||'Search failed');
    leads=data.leads||[];
    $('resultMeta').textContent=`${data.count} leads • ${data.category} • ${data.area}`;
    $('totalFound').textContent=leads.length;
    $('hotFound').textContent=leads.filter(x=>x.score>=80).length;
    $('withPhone').textContent=leads.filter(x=>onlyDigits(x.phone).length>=10).length;
    renderLeads();
    if(data.warnings?.length)showMessage(`Completed with warning: ${data.warnings.join(' | ')}`,false);else hideMessage();
  }catch(err){
    leads=[];renderLeads();showMessage(err.message,true);
  }finally{
    btn.disabled=false;btn.textContent='⚡ Generate Leads';
  }
}

function filteredLeads(){
  const q=$('tableSearch').value.trim().toLowerCase();
  const min=Number($('scoreFilter').value||0);
  return leads.filter(l=>l.score>=min&&(!q||[l.name,l.address,l.phone,l.category,l.opportunity].join(' ').toLowerCase().includes(q)));
}

function renderLeads(){
  const rows=filteredLeads();
  $('leadRows').innerHTML=rows.length?rows.map(rowHTML).join(''):'<tr><td colspan="6" class="empty">No matching leads found.</td></tr>';
}

function renderSaved(){
  $('savedRows').innerHTML=saved.length?saved.map(rowHTML).join(''):'<tr><td colspan="6" class="empty">No saved leads yet.</td></tr>';
}

function rowHTML(l){
  const phoneDigits=onlyDigits(l.phone).slice(-10);
  const wa=phoneDigits?`https://wa.me/91${phoneDigits}?text=${encodeURIComponent(`Hello ${l.name}, this is Pawar Enterprises. We provide professional Painting, Waterproofing, Civil Work, Plumbing, Electrical and Deep Cleaning services. We would like to discuss your property maintenance requirements.`)}`:'';
  return `<tr>
    <td class="lead-name"><strong>${esc(l.name)}</strong><span>${esc(l.category)}</span><span>${esc(l.address||l.area||'')}</span></td>
    <td class="opportunity"><strong>${esc(l.opportunity)}</strong>${l.rating?`<div style="margin-top:4px;color:#6c7789;font-size:9px">★ ${esc(l.rating)} • ${esc(l.reviewCount||0)} reviews</div>`:''}</td>
    <td class="contact-cell"><strong>${esc(l.phone||'No public phone')}</strong>${l.email?`<span>${esc(l.email)}</span>`:''}${l.website?`<span>${esc(l.website.replace(/^https?:\/\//,''))}</span>`:''}</td>
    <td><div class="score-wrap"><div class="score">${esc(l.score)}</div><span class="priority ${String(l.priority).toLowerCase()}">${esc(l.priority)}</span></div></td>
    <td><span class="source">${esc(l.source)}</span></td>
    <td><div class="actions">
      ${phoneDigits?`<a class="action" href="tel:+91${phoneDigits}">Call</a><a class="action" href="${wa}" target="_blank">WhatsApp</a>`:''}
      ${l.mapUrl?`<a class="action" href="${esc(l.mapUrl)}" target="_blank">Map</a>`:''}
      ${l.website?`<a class="action" href="${esc(l.website)}" target="_blank">Website</a>`:''}
      <button class="action ${isSaved(l.id)?'saved':'primary'}" data-save="${esc(l.id)}">${isSaved(l.id)?'Saved ✓':'Save Lead'}</button>
      ${config.crmWebhookEnabled?`<button class="action" data-crm="${esc(l.id)}">Send CRM</button>`:''}
    </div></td>
  </tr>`;
}

function findLead(id){return leads.find(x=>x.id===id)||saved.find(x=>x.id===id)}
async function handleLeadAction(e){
  const saveBtn=e.target.closest('[data-save]');
  if(saveBtn){
    const l=findLead(saveBtn.dataset.save);if(!l)return;
    if(isSaved(l.id)){saved=saved.filter(x=>x.id!==l.id);toast('Lead removed from saved');}else{saved.unshift({...l,savedAt:new Date().toISOString()});toast('Lead saved');}
    saveSaved();renderLeads();renderSaved();return;
  }
  const crmBtn=e.target.closest('[data-crm]');
  if(crmBtn){
    const l=findLead(crmBtn.dataset.crm);if(!l)return;
    crmBtn.disabled=true;
    try{
      const r=await fetch('/api/crm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lead:l})});
      const data=await r.json();if(!r.ok)throw new Error(data.error||'CRM sync failed');toast('Lead sent to CRM');
    }catch(err){toast(err.message)}finally{crmBtn.disabled=false}
  }
}

function downloadCSV(items,filename){
  if(!items.length)return toast('No leads to export');
  const headers=['Name','Phone','Email','Address','Area','Category','Opportunity','Score','Priority','Source','Website','Map URL'];
  const lines=[headers.join(',')];
  for(const l of items)lines.push([l.name,l.phone,l.email,l.address,l.area,l.category,l.opportunity,l.score,l.priority,l.source,l.website,l.mapUrl].map(csvEscape).join(','));
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

function showMessage(msg,isError){const el=$('searchMessage');el.hidden=false;el.textContent=msg;el.style.background=isError?'#fdeaea':'#fff5e7';el.style.color=isError?'#9f3434':'#85601f';el.style.borderColor=isError?'#f2c8c8':'#f3dfb8'}
function hideMessage(){$('searchMessage').hidden=true}

init();
