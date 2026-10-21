const state = { listings: [], user: null, csrf: '', map: null, homeMarkers: new Map(), serviceLayer: null, authMode: 'login' };
const byId = (id) => document.getElementById(id);
const listingGrid = byId('listing-grid');
const accountDialog = byId('account-dialog');
const listingDialog = byId('listing-dialog');
const landlordDialog = byId('landlord-dialog');
const adminDialog = byId('admin-dialog');

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (state.csrf && options.method && options.method !== 'GET') headers.set('X-CSRF-Token', state.csrf);
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function toast(message, isError = false) {
  const item = document.createElement('div');
  item.className = `toast${isError ? ' error' : ''}`;
  item.textContent = message;
  byId('toast-region').append(item);
  window.setTimeout(() => item.remove(), 3800);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function money(value) {
  return `KSh ${Number(value).toLocaleString('en-KE')}`;
}

function ensureMap() {
  if (state.map || !window.L) return;
  state.map = L.map('map', { scrollWheelZoom: false }).setView([-1.2864, 36.8172], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);
  state.serviceLayer = L.layerGroup().addTo(state.map);
  window.setTimeout(() => state.map?.invalidateSize(), 100);
}

function popupFor(listing) {
  const popup = document.createElement('div');
  const title = element('strong', '', listing.title);
  const area = element('div', '', `${listing.area} · ${money(listing.rent)}/mo`);
  popup.append(title, area);
  return popup;
}

function updateMap(listings) {
  ensureMap();
  if (!state.map) return;
  const nextIds = new Set(listings.map((listing) => listing.id));
  for (const [id, marker] of state.homeMarkers) {
    if (!nextIds.has(id)) { marker.remove(); state.homeMarkers.delete(id); }
  }
  for (const listing of listings) {
    if (state.homeMarkers.has(listing.id)) continue;
    const icon = L.divIcon({ className: '', html: '<div class="map-pin"><span>⌂</span></div>', iconSize: [28, 28], iconAnchor: [14, 27] });
    const marker = L.marker([listing.latitude, listing.longitude], { icon }).addTo(state.map);
    marker.bindPopup(popupFor(listing));
    marker.on('click', () => selectListing(listing, false));
    state.homeMarkers.set(listing.id, marker);
  }
  if (listings.length) {
    const bounds = L.latLngBounds(listings.map((listing) => [listing.latitude, listing.longitude]));
    state.map.fitBounds(bounds.pad(0.15), { maxZoom: 12, animate: false });
  }
}

function makeBadge(text, className = '') {
  return element('span', `badge ${className}`, text);
}

function createListingCard(listing) {
  const card = element('article', 'listing-card');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${listing.title}, ${money(listing.rent)} per month`);
  const image = element('div', 'listing-image');
  if (listing.photo) {
    const photo = document.createElement('img');
    photo.src = listing.photo;
    photo.alt = `Property photo: ${listing.title}`;
    photo.loading = 'lazy';
    image.append(photo);
  } else {
    const placeholder = element('div', 'image-placeholder');
    placeholder.append(element('b', '', '⌂'), element('span', '', 'A place in Nairobi'));
    image.append(placeholder);
  }
  const badges = element('div', 'listing-badges');
  if (listing.landlordVerified) badges.append(makeBadge('✓ Verified landlord', 'badge-verified'));
  if (listing.demo) badges.append(makeBadge('Sample listing', 'badge-demo'));
  image.append(badges);

  const body = element('div', 'listing-body');
  body.append(element('p', 'listing-area', listing.area));
  const titleRow = element('div', 'listing-title-row');
  titleRow.append(element('h3', 'listing-title', listing.title));
  const rating = listing.reviewCount ? `★ ${listing.rating} (${listing.reviewCount})` : '☆ New';
  titleRow.append(element('span', 'rating', rating));
  body.append(titleRow);
  const price = element('p', 'listing-price');
  price.append(document.createTextNode(`${money(listing.rent)} `), element('small', '', '/ month'));
  body.append(price);
  const metadata = element('div', 'listing-meta');
  metadata.append(element('span', '', `${listing.bedrooms === 0 ? 'Studio' : `${listing.bedrooms} bed`} · ${listing.type}`));
  metadata.append(element('span', '', listing.furnished ? 'Furnished' : 'Unfurnished'));
  body.append(metadata, element('p', 'listing-summary', listing.description));
  const bottom = element('div', 'listing-bottom');
  bottom.append(element('span', 'landlord-name', `Listed by ${listing.landlordName || 'Local landlord'}`));
  bottom.append(element('button', 'details-link', 'View details →'));
  body.append(bottom);
  card.append(image, body);
  card.addEventListener('click', () => selectListing(listing));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectListing(listing); }
  });
  return card;
}

function filteredListings() {
  const area = byId('area-search').value.trim().toLowerCase();
  const maxRent = Number(byId('rent-filter').value || 0);
  let found = state.listings.filter((listing) => {
    if (area && !`${listing.area} ${listing.title}`.toLowerCase().includes(area)) return false;
    if (maxRent && listing.rent > maxRent) return false;
    if (byId('student-filter').checked && listing.rent > 20000) return false;
    if (byId('furnished-filter').checked && !listing.furnished) return false;
    if (byId('verified-filter').checked && !listing.landlordVerified) return false;
    return true;
  });
  const sort = byId('sort-filter').value;
  if (sort === 'price-low') found = found.toSorted((a, b) => a.rent - b.rent);
  if (sort === 'price-high') found = found.toSorted((a, b) => b.rent - a.rent);
  if (sort === 'rating') found = found.toSorted((a, b) => b.rating - a.rating);
  return found;
}

function renderListings() {
  const listings = filteredListings();
  listingGrid.replaceChildren(...listings.map(createListingCard));
  byId('result-count').textContent = `${listings.length} ${listings.length === 1 ? 'home' : 'homes'} to explore`;
  byId('empty-state').hidden = listings.length > 0;
  updateMap(listings);
}

function selectListing(listing, openDialog = true) {
  const marker = state.homeMarkers.get(listing.id);
  if (marker && state.map) {
    state.map.setView(marker.getLatLng(), Math.max(state.map.getZoom(), 14), { animate: true });
    marker.openPopup();
  }
  if (!openDialog) return;
  const detail = byId('listing-detail');
  detail.replaceChildren();
  if (listing.photo) {
    const photo = document.createElement('img');
    photo.className = 'detail-photo'; photo.src = listing.photo; photo.alt = `Property photo: ${listing.title}`;
    detail.append(photo);
  }
  detail.append(element('p', 'detail-area', listing.area));
  detail.append(element('h2', 'detail-title', listing.title));
  const rent = element('p', 'detail-rent');
  rent.append(document.createTextNode(`${money(listing.rent)} `), element('small', '', 'per month'));
  detail.append(rent);
  detail.append(element('p', 'detail-description', listing.description));
  const attributes = [listing.type, listing.bedrooms ? `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? '' : 's'}` : 'Studio', listing.furnished ? 'Furnished' : 'Unfurnished', ...(listing.utilities || [])];
  detail.append(element('p', 'listing-meta', attributes.join(' · ')));
  detail.append(element('p', 'landlord-name', `Landlord: ${listing.landlordName || 'Local landlord'}${listing.landlordVerified ? ' · Verified' : ' · Not yet verified'}`));
  if (listing.demo) detail.append(element('p', 'form-message', 'Sample listing for preview. Confirm details directly with a landlord before making payment.'));
  if (listing.video) {
    const video = document.createElement('video');
    video.className = 'detail-video'; video.controls = true; video.preload = 'metadata'; video.src = listing.video;
    video.setAttribute('aria-label', `Video tour of ${listing.title}`);
    detail.append(element('h3', '', 'Short video tour'), video);
  }
  const actions = element('div', 'listing-bottom');
  const rating = element('span', 'rating', listing.reviewCount ? `★ ${listing.rating} · ${listing.reviewCount} rating(s)` : 'No ratings yet');
  if (listing.contactEmail) {
    const contact = document.createElement('a');
    contact.className = 'button button-dark';
    contact.href = `mailto:${encodeURIComponent(listing.contactEmail)}?subject=${encodeURIComponent(`Viewing request: ${listing.title}`)}&body=${encodeURIComponent(`Hello, I saw your listing on PATAHAO: ${listing.title} in ${listing.area}. Is it available for viewing?`)}`;
    contact.textContent = 'Ask about a viewing';
    actions.append(rating, contact);
  } else {
    actions.append(rating, element('span', 'rating', listing.demo ? 'Sample listing · no contact' : 'Contact details unavailable'));
  }
  detail.append(actions);
  if (!listing.demo) detail.append(createReviewForm(listing));
  listingDialog.showModal();
}

function createReviewForm(listing) {
  const form = element('form', 'review-form');
  const rating = document.createElement('select');
  rating.name = 'rating'; rating.setAttribute('aria-label', 'Landlord rating');
  for (let score = 5; score >= 1; score -= 1) {
    const option = document.createElement('option'); option.value = String(score); option.textContent = `${score} star${score === 1 ? '' : 's'}`;
    rating.append(option);
  }
  const comment = document.createElement('input'); comment.name = 'comment'; comment.maxLength = 300; comment.placeholder = 'Share a short, respectful note'; comment.setAttribute('aria-label', 'Review comment');
  const submit = element('button', 'button button-outline', 'Rate landlord'); submit.type = 'submit';
  form.append(rating, comment, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.user) { listingDialog.close(); openAccount(); return; }
    try {
      await api('/api/reviews', { method: 'POST', body: JSON.stringify({ listingId: listing.id, rating: Number(rating.value), comment: comment.value }) });
      toast('Thanks for sharing your rating.');
      await loadListings();
      listingDialog.close();
    } catch (error) { toast(error.message, true); }
  });
  return form;
}

async function loadListings() {
  try {
    state.listings = await api('/api/listings');
    renderListings();
  } catch (error) {
    byId('result-count').textContent = 'Homes are temporarily unavailable.';
    toast(error.message, true);
  }
}

function openAccount(mode = 'login') {
  setAuthMode(mode);
  if (!accountDialog.open) accountDialog.showModal();
}

function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === 'register';
  byId('login-tab').classList.toggle('active', !registering);
  byId('register-tab').classList.toggle('active', registering);
  byId('login-tab').setAttribute('aria-selected', String(!registering));
  byId('register-tab').setAttribute('aria-selected', String(registering));
  byId('name-field').hidden = !registering;
  byId('role-field').hidden = !registering;
  byId('auth-title')?.remove();
  byId('account-title').textContent = registering ? 'Make yourself at home.' : 'Welcome back.';
  byId('account-description').textContent = registering ? 'Create a free account to rate landlords or list a property.' : 'Sign in to rate a landlord or list a property.';
  byId('auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  byId('auth-message').textContent = '';
}

function syncAccount() {
  const label = byId('account-label');
  const button = byId('account-button');
  if (!state.user) {
    label.textContent = 'A better move starts here';
    button.textContent = 'Sign in';
  } else {
    label.textContent = state.user.name;
    button.textContent = 'Sign out';
  }
  byId('landlord-cta').textContent = state.user?.role === 'landlord' ? 'Landlord desk' : 'List your place';
}

async function restoreSession() {
  try {
    const result = await api('/api/me');
    state.user = result.user;
    state.csrf = result.csrf;
  } catch {}
  syncAccount();
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

async function showLandlordDesk() {
  if (!state.user) { openAccount('login'); toast('Sign in or create a landlord account to continue.'); return; }
  if (state.user.role !== 'landlord') { toast('Create a landlord account to publish a home.', true); return; }
  byId('verification-box').hidden = state.user.verified;
  landlordDialog.showModal();
}

async function loadVerificationQueue() {
  const queue = byId('admin-queue');
  queue.replaceChildren();
  try {
    const requests = await api('/api/admin/verification-requests');
    if (!requests.length) { queue.append(element('p', 'service-status', 'No landlord requests are waiting.')); return; }
    for (const request of requests) {
      const row = element('div', 'queue-item');
      const details = element('div'); details.append(element('strong', '', request.name), element('span', '', request.email));
      const approve = element('button', 'button button-dark', 'Approve'); approve.type = 'button';
      approve.addEventListener('click', async () => {
        try {
          await api(`/api/admin/verification-requests/${request.id}/approve`, { method: 'POST', body: '{}' });
          await loadVerificationQueue(); await loadListings(); toast(`${request.name} is now verified.`);
        } catch (error) { toast(error.message, true); }
      });
      row.append(details, approve); queue.append(row);
    }
  } catch (error) { queue.append(element('p', 'form-message', error.message)); }
}

function distanceKm(fromLat, fromLng, toLat, toLng) {
  const radians = (degree) => degree * Math.PI / 180;
  const dLat = radians(toLat - fromLat); const dLng = radians(toLng - fromLng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

async function findServices() {
  const status = byId('service-status');
  const list = byId('service-list');
  if (!navigator.geolocation) { status.textContent = 'Location is not available in this browser.'; return; }
  status.textContent = 'Waiting for location permission…';
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    const { latitude, longitude } = coords;
    ensureMap();
    if (!state.map) { status.textContent = 'The map could not load. Check your connection.'; return; }
    state.map.setView([latitude, longitude], 13);
    const here = L.circleMarker([latitude, longitude], { radius: 7, color: '#ffffff', weight: 2, fillColor: '#153a32', fillOpacity: 1 }).addTo(state.map);
    here.bindPopup('Your approximate location');
    status.textContent = 'Searching OpenStreetMap for hospitals within 5 km…';
    list.replaceChildren();
    const query = `[out:json][timeout:10];(node[amenity=hospital](around:5000,${latitude},${longitude});way[amenity=hospital](around:5000,${latitude},${longitude}););out center tags 8;`;
    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error('Nearby services are busy. Please try again shortly.');
      const data = await response.json();
      const hospitals = (data.elements || []).map((item) => ({
        name: item.tags?.name || 'Hospital',
        latitude: item.lat ?? item.center?.lat,
        longitude: item.lon ?? item.center?.lon,
      })).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
      state.serviceLayer.clearLayers();
      const icon = L.divIcon({ className: '', html: '<div class="service-pin">+</div>', iconSize: [21, 21], iconAnchor: [10, 10] });
      hospitals.forEach((hospital) => {
        const popup = element('span', '', hospital.name);
        L.marker([hospital.latitude, hospital.longitude], { icon }).bindPopup(popup).addTo(state.serviceLayer);
      });
      const ordered = hospitals.map((hospital) => ({ ...hospital, distance: distanceKm(latitude, longitude, hospital.latitude, hospital.longitude) })).sort((a, b) => a.distance - b.distance).slice(0, 5);
      list.replaceChildren(...ordered.map((hospital) => {
        const row = document.createElement('li'); row.append(element('span', '', hospital.name), element('span', '', `${hospital.distance.toFixed(1)} km`)); return row;
      }));
      status.textContent = hospitals.length ? `${hospitals.length} hospital${hospitals.length === 1 ? '' : 's'} found within 5 km.` : 'No hospitals found in the map data within 5 km.';
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'Nearby search timed out. Try again.' : error.message;
    }
  }, (error) => {
    status.textContent = error.code === 1 ? 'Location permission was declined. You can still browse the map.' : 'Could not get your location. Try again or browse the map.';
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
}

byId('search-form').addEventListener('submit', (event) => { event.preventDefault(); renderListings(); byId('homes').scrollIntoView({ behavior: 'smooth' }); });
['area-search', 'rent-filter', 'student-filter', 'furnished-filter', 'verified-filter', 'sort-filter'].forEach((id) => byId(id).addEventListener('input', renderListings));
byId('clear-filters').addEventListener('click', clearFilters);
byId('empty-clear').addEventListener('click', clearFilters);
function clearFilters() {
  byId('area-search').value = ''; byId('rent-filter').value = '';
  byId('student-filter').checked = false; byId('furnished-filter').checked = false; byId('verified-filter').checked = false;
  renderListings();
}
byId('locate-button').addEventListener('click', findServices);
byId('services-button').addEventListener('click', findServices);
byId('landlord-cta').addEventListener('click', showLandlordDesk);
byId('login-tab').addEventListener('click', () => setAuthMode('login'));
byId('register-tab').addEventListener('click', () => setAuthMode('register'));
byId('verification-button').addEventListener('click', async () => {
  try { await api('/api/verification-requests', { method: 'POST', body: '{}' }); toast('Verification request sent to the admin.'); byId('verification-button').disabled = true; byId('verification-button').textContent = 'Request sent'; }
  catch (error) { toast(error.message, true); }
});
byId('new-listing-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const message = byId('listing-message');
  button.disabled = true; button.textContent = 'Publishing…'; message.textContent = '';
  try {
    const values = new FormData(form);
    const photoFile = values.get('photo'); const videoFile = values.get('video');
    if (photoFile.size > 8 * 1024 * 1024) throw new Error('Photo must be smaller than 8 MB.');
    if (videoFile.size > 24 * 1024 * 1024) throw new Error('Video must be smaller than 24 MB.');
    const payload = Object.fromEntries(['title', 'area', 'contactEmail', 'rent', 'bedrooms', 'type', 'latitude', 'longitude', 'description'].map((key) => [key, values.get(key)]));
    payload.furnished = values.has('furnished');
    payload.utilities = [];
    payload.photo = await fileAsDataUrl(photoFile);
    payload.video = videoFile.size ? await fileAsDataUrl(videoFile) : null;
    await api('/api/listings', { method: 'POST', body: JSON.stringify(payload) });
    form.reset(); byId('landlord-dialog').close(); await loadListings(); toast('Your home is now listed.');
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Publish listing'; }
});
byId('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const register = state.authMode === 'register';
  const payload = { email: form.get('email'), password: form.get('password') };
  if (register) { payload.name = form.get('name'); payload.role = form.get('role'); }
  byId('auth-submit').disabled = true;
  byId('auth-message').textContent = '';
  try {
    const result = await api(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(payload) });
    state.user = result.user; state.csrf = result.csrf; syncAccount(); accountDialog.close(); event.currentTarget.reset(); toast(`Welcome, ${state.user.name}.`);
    if (state.user.role === 'admin') { adminDialog.showModal(); await loadVerificationQueue(); }
  } catch (error) { byId('auth-message').textContent = error.message; }
  finally { byId('auth-submit').disabled = false; }
});

for (const dialog of [accountDialog, listingDialog, landlordDialog, adminDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  });
}
byId('account-button').addEventListener('click', async () => {
  if (!state.user) { openAccount(); return; }
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  state.user = null; state.csrf = ''; syncAccount(); toast('You have signed out.');
});
restoreSession().then(loadListings);
window.addEventListener('resize', () => state.map?.invalidateSize());
