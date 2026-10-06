const $ = id => document.getElementById(id);
const SAVED_KEY = 'pe_lead_generator_saved_v1';
let config = { googleEnabled:false, crmWebhookEnabled:false, categories:[], services:[] };
let leads = [];
let saved = loadSaved();
let lastSearchAt = 0;

const OSM_CATEGORY_FILTERS = {
  housing_society: ['["building"="apartments"]', '["building"="residential"]'],
  builders: ['["craft"="builder"]', '["office"="construction"]'],
  hotels: ['["tourism"="hotel"]', '["tourism"="guest_house"]'],
  restaurants: ['["amenity"="restaurant"]', '["amenity"="cafe"]', '["amenity"="fast_food"]'],
  offices: ['["office"]'],
  schools: ['["amenity"="school"]', '["amenity"="college"]', '["amenity"="university"]'],
  healthcare: ['["amenity"="hospital"]', '["amenity"="clinic"]', '["healthcare"]'],
  shops: ['["shop"]'],
  warehouses: ['["building"="warehouse"]', '["industrial"]'],
  property_manager: ['["office"="estate_agent"]']
};

const SERVICE_LABELS = {
  auto: 'Best Opportunity',
  painting: 'Painting',
  waterproofing: 'Waterproofing',
  civil: 'Civil Work / Renovation',
  plumbing: 'Plumbing',
  electrical: 'Electrical Work',
  cleaning: 'Deep Cleaning'
};

const CATEGORY_DEFAULT_OPPORTUNITY = {
  housing_society: 'Waterproofing + Exterior Painting + Civil Work',
  builders: 'Painting + Civil Work + Electrical + Plumbing',
  hotels: 'Painting + Deep Cleaning + Plumbing',
  restaurants: 'Painting + Deep Cleaning + Electrical',
  offices: 'Painting + Electrical + Deep Cleaning',
  schools: 'Painting + Waterproofing + Civil Work',
  healthcare: 'Painting + Electrical + Plumbing + Deep Cleaning',
  shops: 'Painting + Electrical + Deep Cleaning',
  warehouses: 'Waterproofing + Painting + Electrical',
  property_manager: 'Painting + Waterproofing + Civil Work'
};

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
      $('providerStatus').textContent='OpenStreetMap browser-direct ready • Google key not configured';
    }else{
      $('providerStatus').textContent='OpenStreetMap browser-direct + Google Places ready';
    }
  }catch(e){
    $('providerStatus').textContent='Backend unavailable • browser OSM fallback available';
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
  const now=Date.now();
  if(now-lastSearchAt<8000)return toast('Please wait a few seconds before searching again');
  lastSearchAt=now;

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

  btn.disabled=true;
  btn.textContent='Searching public data...';
  showMessage('Searching public business/property data. This can take 10–30 seconds.',false);

  try{
    let data;
    if(payload.provider==='osm'){
      showMessage('Searching OpenStreetMap directly from your browser…',false);
      data=await browserOSMSearch(payload);
    }else{
      const r=await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      data=await r.json();
      if(!r.ok)throw new Error(data.error||'Server search failed');
    }

    applySearchResult(data);
    if(data.warnings?.length){
      showMessage(`Search completed. ${data.warnings.join(' | ')}`,false);
    }else{
      hideMessage();
    }
  }catch(err){
    leads=[];
    renderLeads();
    $('totalFound').textContent='0';
    $('hotFound').textContent='0';
    $('withPhone').textContent='0';
    showMessage(err.message,true);
  }finally{
    btn.disabled=false;
    btn.textContent='⚡ Generate Leads';
  }
}

function applySearchResult(data){
  leads=data.leads||[];
  $('resultMeta').textContent=`${data.count??leads.length} leads • ${data.category||''} • ${data.area||''}`;
  $('totalFound').textContent=leads.length;
  $('hotFound').textContent=leads.filter(x=>x.score>=80).length;
  $('withPhone').textContent=leads.filter(x=>onlyDigits(x.phone).length>=10).length;
  renderLeads();
}

function categoryLabel(value){
  return config.categories.find(x=>x.value===value)?.label || value;
}

function opportunityFor(category, service){
  if(service && service!=='auto') return SERVICE_LABELS[service] || service;
  return CATEGORY_DEFAULT_OPPORTUNITY[category] || 'Painting + Waterproofing + Civil Work';
}

function browserOverpassQuery(lat,lon,radius,category){
  const filters=OSM_CATEGORY_FILTERS[category]||OSM_CATEGORY_FILTERS.offices;
  const parts=[];
  for(const f of filters){
    parts.push(`nwr${f}["name"](around:${radius},${lat},${lon});`);
    if(category==='housing_society'){
      parts.push(`nwr${f}["addr:housename"](around:${radius},${lat},${lon});`);
    }
  }
  return `[out:json][timeout:20];(${parts.join('')});out tags center qt 120;`;
}

async function fetchTimeout(url,options={},timeoutMs=18000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetch(url,{...options,signal:controller.signal});
  }finally{
    clearTimeout(timer);
  }
}

async function browserGeocode(area){
  const errors=[];
  try{
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(`${area}, India`)}`;
    const r=await fetchTimeout(url,{headers:{'Accept-Language':'en'}},12000);
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    if(Array.isArray(data)&&data.length){
      return {lat:Number(data[0].lat),lon:Number(data[0].lon),displayName:data[0].display_name||area,source:'Nominatim'};
    }
    errors.push('Nominatim: no result');
  }catch(e){
    errors.push(`Nominatim: ${e.name==='AbortError'?'timeout':e.message}`);
  }

  try{
    const url=`https://photon.komoot.io/api/?q=${encodeURIComponent(`${area}, India`)}&limit=1&lang=en`;
    const r=await fetchTimeout(url,{},12000);
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    const f=data?.features?.[0];
    if(f?.geometry?.coordinates?.length>=2){
      const [lon,lat]=f.geometry.coordinates;
      const p=f.properties||{};
      return {lat:Number(lat),lon:Number(lon),displayName:[p.name,p.city,p.state,p.country].filter(Boolean).join(', ')||area,source:'Photon'};
    }
    errors.push('Photon: no result');
  }catch(e){
    errors.push(`Photon: ${e.name==='AbortError'?'timeout':e.message}`);
  }

  throw new Error(`Area lookup failed in browser. ${errors.join(' | ')}`);
}

async function browserFetchOverpass(query){
  const endpoints=[
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];
  const errors=[];

  for(const endpoint of endpoints){
    try{
      const url=`${endpoint}?data=${encodeURIComponent(query)}`;
      const r=await fetchTimeout(url,{headers:{'Accept':'application/json'}},18000);
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const data=await r.json();
      if(!Array.isArray(data?.elements))throw new Error('Invalid response');
      return {data,host:new URL(endpoint).hostname};
    }catch(e){
      errors.push(`${new URL(endpoint).hostname}: ${e.name==='AbortError'?'timeout':e.message}`);
    }
  }
  throw new Error(`Public OSM services are temporarily unavailable from both Render and this browser. ${errors.join(' | ')}`);
}

function buildOSMAddress(tags,area){
  return tags['addr:full'] || [
    tags['addr:housename'],tags['addr:housenumber'],tags['addr:street'],
    tags['addr:suburb'],tags['addr:city'],tags['addr:district'],tags['addr:postcode']
  ].filter(Boolean).join(', ') || area;
}

function browserScoreLead(lead,category,service){
  let score=10;
  if(lead.name)score+=10;
  if(onlyDigits(lead.phone).slice(-10).length===10)score+=25;
  if(lead.website)score+=15;
  if(lead.email)score+=10;
  if(lead.address)score+=10;
  if(lead.lat&&lead.lon)score+=5;
  if(category)score+=10;
  if(service)score+=10;
  return Math.min(100,score);
}

function browserPriority(score){
  return score>=80?'Hot':score>=60?'Good':'Normal';
}

async function browserOSMSearch(payload){
  const geo=await browserGeocode(payload.area);
  const query=browserOverpassQuery(geo.lat,geo.lon,payload.radius,payload.category);
  const {data,host}=await browserFetchOverpass(query);
  const out=[];
  const seen=new Set();

  for(const el of data.elements||[]){
    const t=el.tags||{};
    const name=t.name||t.brand||t.operator||t['addr:housename']||'';
    if(!name)continue;
    const phone=String(t.phone||t['contact:phone']||t.mobile||t['contact:mobile']||'').trim();
    const website=t.website||t['contact:website']||'';
    const email=t.email||t['contact:email']||'';
    const lat=el.lat||el.center?.lat||null;
    const lon=el.lon||el.center?.lon||null;
    const address=buildOSMAddress(t,payload.area);
    const key=onlyDigits(phone).slice(-10)||`${name.toLowerCase().replace(/\s+/g,'')}|${address.toLowerCase().slice(0,50)}`;
    if(seen.has(key))continue;
    seen.add(key);

    const lead={
      id:`osm-${el.type}-${el.id}`,
      name,phone,email,website,address,
      area:payload.area,
      category:categoryLabel(payload.category),
      opportunity:opportunityFor(payload.category,payload.service),
      source:`OpenStreetMap (${host})`,
      lat,lon,
      mapUrl:lat&&lon?`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`:'',
      osmId:`${el.type}/${el.id}`
    };
    lead.score=browserScoreLead(lead,payload.category,payload.service);
    lead.priority=browserPriority(lead.score);
    out.push(lead);
  }

  out.sort((a,b)=>b.score-a.score);
  const finalLeads=out.slice(0,payload.limit);
  return {
    area:payload.area,
    category:categoryLabel(payload.category),
    service:SERVICE_LABELS[payload.service]||payload.service,
    count:finalLeads.length,
    leads:finalLeads,
    warnings:[`Browser-direct OSM via ${host}; geocoder: ${geo.source}`]
  };
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
