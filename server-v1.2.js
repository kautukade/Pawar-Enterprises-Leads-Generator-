const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const CRM_WEBHOOK_URL = process.env.CRM_WEBHOOK_URL || '';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const buckets = new Map();
app.use('/api', (req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const max = 40;
  let entry = buckets.get(key) || { start: now, count: 0 };
  if (now - entry.start > windowMs) entry = { start: now, count: 0 };
  entry.count += 1;
  buckets.set(key, entry);
  if (entry.count > max) return res.status(429).json({ error: 'Too many requests. Please wait a few minutes.' });
  next();
});

const categoryConfig = {
  housing_society: { label: 'Housing Societies / Apartments', filters: ['["building"="apartments"]', '["building"="residential"]'], google: 'housing society apartment complex', houseName: true },
  builders: { label: 'Builders / Construction Companies', filters: ['["craft"="builder"]', '["office"="construction"]'], google: 'builder construction company' },
  hotels: { label: 'Hotels / Lodges', filters: ['["tourism"="hotel"]', '["tourism"="guest_house"]'], google: 'hotel' },
  restaurants: { label: 'Restaurants / Cafes', filters: ['["amenity"="restaurant"]', '["amenity"="cafe"]', '["amenity"="fast_food"]'], google: 'restaurant cafe' },
  offices: { label: 'Offices / Companies', filters: ['["office"]'], google: 'office company' },
  schools: { label: 'Schools / Colleges', filters: ['["amenity"="school"]', '["amenity"="college"]', '["amenity"="university"]'], google: 'school college' },
  healthcare: { label: 'Hospitals / Clinics', filters: ['["amenity"="hospital"]', '["amenity"="clinic"]', '["healthcare"]'], google: 'hospital clinic' },
  shops: { label: 'Shops / Showrooms', filters: ['["shop"]'], google: 'shop showroom' },
  warehouses: { label: 'Warehouses / Industrial', filters: ['["building"="warehouse"]', '["industrial"]'], google: 'warehouse industrial company' },
  property_manager: { label: 'Property / Estate Agencies', filters: ['["office"="estate_agent"]'], google: 'property dealer estate agent' }
};

const serviceLabels = {
  auto: 'Best Opportunity',
  painting: 'Painting',
  waterproofing: 'Waterproofing',
  civil: 'Civil Work / Renovation',
  plumbing: 'Plumbing',
  electrical: 'Electrical Work',
  cleaning: 'Deep Cleaning'
};

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

function cleanPhone(value = '') {
  const raw = String(value).trim();
  return raw ? raw.replace(/\s+/g, ' ') : '';
}
function normalizedPhone(value = '') { return String(value).replace(/\D/g, '').slice(-10); }
function buildAddress(tags = {}, fallback = '') {
  if (tags['addr:full']) return tags['addr:full'];
  return [tags['addr:housename'], tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city'], tags['addr:district'], tags['addr:postcode']].filter(Boolean).join(', ') || fallback;
}
function inferOpportunity(category, selectedService) {
  if (selectedService && selectedService !== 'auto') return serviceLabels[selectedService] || selectedService;
  const map = {
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
  return map[category] || 'Painting + Waterproofing + Civil Work';
}
function scoreLead(lead, category, selectedService) {
  let score = 10;
  if (lead.name) score += 10;
  if (normalizedPhone(lead.phone).length === 10) score += 25;
  if (lead.website) score += 15;
  if (lead.email) score += 10;
  if (lead.address) score += 10;
  if (lead.lat && lead.lon) score += 5;
  if (category) score += 10;
  if (selectedService) score += 10;
  if (lead.source === 'Google Places') score += 5;
  return Math.min(100, score);
}
function priority(score) { return score >= 80 ? 'Hot' : score >= 60 ? 'Good' : 'Normal'; }

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeArea(area) {
  const userAgent = 'PawarEnterprisesLeadGenerator/1.2 (pawarenterpriseulwe@gmail.com)';
  const errors = [];

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(`${area}, India`)}`;
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': userAgent, 'Accept-Language': 'en' } }, 10000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (Array.isArray(data) && data.length) return { lat: Number(data[0].lat), lon: Number(data[0].lon), displayName: data[0].display_name || area, geocoder: 'Nominatim' };
    errors.push('Nominatim returned no result');
  } catch (e) {
    errors.push(`Nominatim ${e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message)}`);
  }

  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(`${area}, India`)}&limit=1&lang=en`;
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': userAgent } }, 10000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const f = data?.features?.[0];
    if (f?.geometry?.coordinates?.length >= 2) {
      const [lon, lat] = f.geometry.coordinates;
      const p = f.properties || {};
      return { lat: Number(lat), lon: Number(lon), displayName: [p.name, p.city, p.state, p.country].filter(Boolean).join(', ') || area, geocoder: 'Photon' };
    }
    errors.push('Photon returned no result');
  } catch (e) {
    errors.push(`Photon ${e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message)}`);
  }

  throw new Error(`Area lookup failed. ${errors.join(' | ')}`);
}

function overpassQuery(lat, lon, radius, category) {
  const cfg = categoryConfig[category] || categoryConfig.offices;
  const blocks = [];
  for (const filter of cfg.filters) {
    blocks.push(`nwr${filter}["name"](around:${radius},${lat},${lon});`);
    if (cfg.houseName) blocks.push(`nwr${filter}["addr:housename"](around:${radius},${lat},${lon});`);
  }
  return `[out:json][timeout:18];(${blocks.join('')});out tags center qt 120;`;
}

async function fetchOverpass(query) {
  const errors = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const url = `${endpoint}?data=${encodeURIComponent(query)}`;
      const r = await fetchWithTimeout(url, { headers: { 'User-Agent': 'PawarEnterprisesLeadGenerator/1.2', 'Accept': 'application/json' } }, 16000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!Array.isArray(data?.elements)) throw new Error('Invalid response');
      return { data, endpoint };
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message || 'request failed');
      errors.push(`${new URL(endpoint).hostname}: ${msg}`);
      console.error('[Overpass]', new URL(endpoint).hostname, msg);
    }
  }
  throw new Error(`All OpenStreetMap mirrors failed. ${errors.join(' | ')}`);
}

function dedupe(leads) {
  const seen = new Set();
  const out = [];
  for (const l of leads) {
    const key = normalizedPhone(l.phone) || `${String(l.name).toLowerCase().replace(/\s+/g, '')}|${String(l.address).toLowerCase().slice(0, 50)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

async function fetchOSMLeads(area, category, service, radius, limit) {
  const geo = await geocodeArea(area);
  const query = overpassQuery(geo.lat, geo.lon, radius, category);
  const { data, endpoint } = await fetchOverpass(query);
  const leads = [];

  for (const el of data.elements || []) {
    const t = el.tags || {};
    const name = t.name || t.brand || t.operator || t['addr:housename'] || '';
    if (!name) continue;
    const phone = cleanPhone(t.phone || t['contact:phone'] || t.mobile || t['contact:mobile'] || '');
    const website = t.website || t['contact:website'] || '';
    const email = t.email || t['contact:email'] || '';
    const lat = el.lat || el.center?.lat || null;
    const lon = el.lon || el.center?.lon || null;
    const address = buildAddress(t, geo.displayName.split(',').slice(0, 4).join(','));
    const lead = {
      id: `osm-${el.type}-${el.id}`,
      name, phone, email, website, address, area,
      category: categoryConfig[category]?.label || category,
      opportunity: inferOpportunity(category, service),
      source: 'OpenStreetMap',
      lat, lon,
      mapUrl: lat && lon ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}` : '',
      osmId: `${el.type}/${el.id}`
    };
    lead.score = scoreLead(lead, category, service);
    lead.priority = priority(lead.score);
    leads.push(lead);
  }

  return {
    leads: dedupe(leads).sort((a, b) => b.score - a.score).slice(0, limit),
    meta: { geocoder: geo.geocoder, overpassHost: new URL(endpoint).hostname }
  };
}

async function fetchGoogleLeads(area, category, service, limit) {
  if (!GOOGLE_PLACES_API_KEY) throw new Error('Google Places API key is not configured on the server.');
  const cfg = categoryConfig[category] || categoryConfig.offices;
  const r = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.location,places.types'
    },
    body: JSON.stringify({ textQuery: `${cfg.google} in ${area}`, maxResultCount: Math.min(20, limit), languageCode: 'en', regionCode: 'IN' })
  }, 15000);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Google Places error (${r.status}): ${txt.slice(0, 180)}`);
  }
  const data = await r.json();
  return (data.places || []).map(p => {
    const lead = {
      id: `google-${p.id}`,
      name: p.displayName?.text || 'Unnamed business',
      phone: cleanPhone(p.nationalPhoneNumber || ''),
      email: '',
      website: p.websiteUri || '',
      address: p.formattedAddress || '',
      area,
      category: cfg.label,
      opportunity: inferOpportunity(category, service),
      source: 'Google Places',
      rating: p.rating || null,
      reviewCount: p.userRatingCount || 0,
      lat: p.location?.latitude || null,
      lon: p.location?.longitude || null,
      mapUrl: p.googleMapsUri || ''
    };
    lead.score = scoreLead(lead, category, service);
    lead.priority = priority(lead.score);
    return lead;
  }).slice(0, limit);
}

app.get('/api/config', (req, res) => {
  res.json({
    googleEnabled: Boolean(GOOGLE_PLACES_API_KEY),
    crmWebhookEnabled: Boolean(CRM_WEBHOOK_URL),
    categories: Object.entries(categoryConfig).map(([value, x]) => ({ value, label: x.label })),
    services: Object.entries(serviceLabels).map(([value, label]) => ({ value, label })),
    browserFallback: true,
    version: '1.2.0'
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Pawar Enterprises Leads Generator', version: '1.2.0' }));

app.get('/api/test-osm', async (req, res) => {
  try {
    const area = String(req.query.area || 'Ulwe, Navi Mumbai').trim();
    const category = String(req.query.category || 'housing_society');
    const result = await fetchOSMLeads(area, category, 'auto', 3000, 5);
    res.json({ ok: true, count: result.leads.length, meta: result.meta, leads: result.leads });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.post('/api/search', async (req, res) => {
  try {
    const area = String(req.body.area || '').trim();
    const category = String(req.body.category || 'offices');
    const service = String(req.body.service || 'auto');
    const provider = String(req.body.provider || 'osm');
    const radius = Math.max(1000, Math.min(15000, Number(req.body.radius || 6000)));
    const limit = Math.max(5, Math.min(100, Number(req.body.limit || 30)));
    if (!area) return res.status(400).json({ error: 'Area is required.' });
    if (!categoryConfig[category]) return res.status(400).json({ error: 'Invalid category.' });

    let leads = [];
    const warnings = [];
    let osmMeta = null;

    if (provider === 'osm' || provider === 'both') {
      try {
        const osm = await fetchOSMLeads(area, category, service, radius, limit);
        leads.push(...osm.leads);
        osmMeta = osm.meta;
      } catch (e) {
        warnings.push(`OSM: ${e.message}`);
      }
    }

    if (provider === 'google' || provider === 'both') {
      try { leads.push(...await fetchGoogleLeads(area, category, service, limit)); }
      catch (e) { warnings.push(`Google: ${e.message}`); }
    }

    leads = dedupe(leads).sort((a, b) => b.score - a.score).slice(0, limit);
    if (!leads.length && warnings.length) return res.status(502).json({ error: warnings.join(' | '), browserFallbackRecommended: provider === 'osm' });

    res.json({
      area,
      category: categoryConfig[category].label,
      service: serviceLabels[service] || service,
      count: leads.length,
      leads,
      warnings,
      meta: osmMeta
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Lead search failed.' });
  }
});

app.post('/api/crm', async (req, res) => {
  if (!CRM_WEBHOOK_URL) return res.status(501).json({ error: 'CRM webhook is not configured yet.' });
  try {
    const lead = req.body.lead || req.body;
    const r = await fetchWithTimeout(CRM_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead)
    }, 12000);
    if (!r.ok) throw new Error(`CRM webhook returned ${r.status}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Pawar Enterprises Leads Generator v1.2 running on port ${PORT}`));
