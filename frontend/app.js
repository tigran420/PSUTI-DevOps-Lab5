/* Вариант 22: карта площадок Казани и расписание выбранной площадки. */
const API = '/api/v1';
const KAZAN_CENTER = [55.795518, 49.124544];

const elements = {
  district: document.querySelector('#district-select'),
  capacity: document.querySelector('#capacity-input'),
  search: document.querySelector('#search-input'),
  apply: document.querySelector('#apply-filters'),
  reset: document.querySelector('#reset-filters'),
  venueList: document.querySelector('#venue-list'),
  venueCount: document.querySelector('#venue-count'),
  eventCount: document.querySelector('#event-count'),
  resultsBadge: document.querySelector('#results-badge'),
  filterHint: document.querySelector('#filter-hint'),
  selected: document.querySelector('#selected-section'),
  selectedName: document.querySelector('#selected-name'),
  selectedAddress: document.querySelector('#selected-address'),
  selectedCapacity: document.querySelector('#selected-capacity'),
  selectedDistrict: document.querySelector('#selected-district'),
  selectedCoordinates: document.querySelector('#selected-coordinates'),
  eventsList: document.querySelector('#events-list'),
  eventsCount: document.querySelector('#selected-events-count'),
  closeSelected: document.querySelector('#close-selected'),
  toast: document.querySelector('#toast'),
  mapNote: document.querySelector('#map-note')
};

let map;
let markerLayer;
let venues = [];
let districtsByCode = new Map();
let selectedVenueId = null;
let referenceTime = null;
let toastTimer = null;

function escapeText(value) {
  return String(value ?? '');
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 4200);
}

async function apiGet(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: 'application/json' }
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = text; }
  if (!response.ok) {
    const message = body?.error?.message || body?.detail || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function initMap() {
  if (!window.L) throw new Error('Не удалось загрузить библиотеку карты Leaflet. Проверьте подключение к интернету.');
  map = L.map('map', { scrollWheelZoom: true }).setView(KAZAN_CENTER, 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function createDistrictOptions(rows) {
  elements.district.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'Все районы';
  elements.district.append(all);
  for (const item of rows) {
    districtsByCode.set(item.code, item.name);
    const option = document.createElement('option');
    option.value = item.code;
    option.textContent = item.name;
    elements.district.append(option);
  }
}

function districtName(code) {
  return districtsByCode.get(code) || code || 'Не указан';
}

function setLoading(isLoading) {
  elements.apply.disabled = isLoading;
  elements.apply.textContent = isLoading ? 'Загрузка…' : '⌕ Показать площадки';
}

function venueAddress(venue) {
  return venue.formatted_address || [venue.city, venue.street, venue.house].filter(Boolean).join(', ') || 'Адрес не указан';
}

function renderVenueList() {
  elements.venueList.replaceChildren();
  if (!venues.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = 'По выбранным параметрам площадок не найдено. Измените фильтры и попробуйте ещё раз.';
    empty.append(p);
    elements.venueList.append(empty);
    return;
  }

  for (const venue of venues) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `venue-card${venue.id === selectedVenueId ? ' active' : ''}`;
    const head = document.createElement('div');
    head.className = 'venue-card-head';
    const title = document.createElement('strong');
    title.textContent = escapeText(venue.name || 'Без названия');
    const capacity = document.createElement('span');
    capacity.className = 'capacity';
    capacity.textContent = `${Number(venue.capacity || 0).toLocaleString('ru-RU')} мест`;
    head.append(title, capacity);
    const address = document.createElement('div');
    address.className = 'address';
    address.textContent = venueAddress(venue);
    const district = document.createElement('span');
    district.className = 'district-tag';
    district.textContent = districtName(venue.district_code);
    button.append(head, address, district);
    button.addEventListener('click', () => selectVenue(venue));
    elements.venueList.append(button);
  }
}

function markerIcon(isSelected = false) {
  return L.divIcon({
    className: '',
    html: `<span class="venue-pin${isSelected ? ' selected' : ''}"></span>`,
    iconSize: isSelected ? [20, 20] : [16, 16],
    iconAnchor: isSelected ? [10, 10] : [8, 8]
  });
}

function renderMarkers() {
  markerLayer.clearLayers();
  const bounds = [];
  for (const venue of venues) {
    const lat = Number(venue.latitude);
    const lon = Number(venue.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const marker = L.marker([lat, lon], { icon: markerIcon(venue.id === selectedVenueId) });
    const popup = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = escapeText(venue.name || 'Площадка');
    const details = document.createElement('div');
    details.textContent = `${Number(venue.capacity || 0).toLocaleString('ru-RU')} мест · ${districtName(venue.district_code)}`;
    popup.append(strong, details);
    marker.bindPopup(popup);
    marker.on('click', () => selectVenue(venue));
    marker.addTo(markerLayer);
    bounds.push([lat, lon]);
  }
  if (bounds.length) {
    map.fitBounds(bounds, { padding: [35, 35], maxZoom: 14 });
  } else {
    map.setView(KAZAN_CENTER, 12);
  }
  elements.mapNote.textContent = bounds.length
    ? 'Выберите маркер на карте или площадку в каталоге, чтобы открыть расписание.'
    : 'Нет площадок с координатами для отображения на карте.';
}

async function loadVenues() {
  setLoading(true);
  elements.filterHint.textContent = 'Получаем площадки из API…';
  try {
    const params = new URLSearchParams({ has_coordinates: 'true', limit: '1000' });
    if (elements.district.value) params.set('district_code', elements.district.value);
    const rawCapacity = elements.capacity.value.trim();
    if (rawCapacity) {
      const capacity = Number(rawCapacity);
      if (!Number.isInteger(capacity) || capacity < 1) {
        throw new Error('Минимальная вместимость должна быть целым числом не меньше 1.');
      }
      params.set('capacity_min', String(capacity));
    }
    if (elements.search.value.trim()) params.set('q', elements.search.value.trim());

    const collection = await apiGet(`/venues/geojson?${params.toString()}`);
    venues = (collection.features || []).map(feature => ({
      ...feature.properties,
      // GeoJSON uses [longitude, latitude]; VenueOut also includes named latitude/longitude.
      longitude: feature.properties?.longitude ?? feature.geometry?.coordinates?.[0],
      latitude: feature.properties?.latitude ?? feature.geometry?.coordinates?.[1]
    }));

    if (selectedVenueId && !venues.some(v => v.id === selectedVenueId)) closeSelection();
    elements.venueCount.textContent = venues.length.toLocaleString('ru-RU');
    elements.resultsBadge.textContent = venues.length.toLocaleString('ru-RU');
    elements.filterHint.textContent = `Найдено площадок: ${venues.length}. Фильтры применяются на стороне backend.`;
    renderVenueList();
    renderMarkers();
  } catch (error) {
    venues = [];
    renderVenueList();
    renderMarkers();
    elements.filterHint.textContent = 'Не удалось загрузить каталог.';
    showToast(`Ошибка загрузки площадок: ${error.message}`);
  } finally {
    setLoading(false);
  }
}

function formatDate(value) {
  if (!value) return 'Дата не указана';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Moscow'
  }).format(date);
}

function renderEvents(events) {
  elements.eventsList.replaceChildren();
  elements.eventsCount.textContent = events.length.toLocaleString('ru-RU');
  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = 'Для этой площадки пока нет опубликованных предстоящих мероприятий.';
    empty.append(p);
    elements.eventsList.append(empty);
    return;
  }

  for (const event of events) {
    const card = document.createElement('article');
    card.className = 'event-card';
    const title = document.createElement('h4');
    title.textContent = escapeText(event.title || 'Без названия');
    const meta = document.createElement('div');
    meta.className = 'event-meta';
    meta.textContent = `${formatDate(event.starts_at)} · ${formatDate(event.ends_at)}`;
    const tags = document.createElement('div');
    tags.className = 'event-tags';
    const price = document.createElement('span');
    price.textContent = event.price_rub === 0 ? 'Бесплатно' : `${Number(event.price_rub || 0).toLocaleString('ru-RU')} ₽`;
    const age = document.createElement('span');
    age.textContent = `${event.age_rating ?? 0}+`;
    const genre = document.createElement('span');
    genre.textContent = escapeText(event.genre_code || 'Событие');
    tags.append(price, age, genre);
    card.append(title, meta);
    if (event.description) {
      const description = document.createElement('p');
      description.className = 'event-description';
      description.textContent = escapeText(event.description);
      card.append(description);
    }
    card.append(tags);
    elements.eventsList.append(card);
  }
}

async function loadVenueEvents(venueId) {
  elements.eventsList.innerHTML = '<div class="empty-state"><span class="loader"></span><p>Загружаем расписание…</p></div>';
  try {
    if (!referenceTime) {
      const meta = await apiGet('/meta');
      referenceTime = meta.reference_time || meta.dataset?.reference_time;
    }
    if (!referenceTime) throw new Error('Backend не вернул reference_time для фильтра будущих событий.');

    const params = new URLSearchParams({
      venue_id: venueId,
      status: 'published',
      starts_from: referenceTime,
      page: '1',
      page_size: '100'
    });
    const result = await apiGet(`/events?${params.toString()}`);
    const events = (result.data || []).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    renderEvents(events);
    updateTotalEventsCount();
  } catch (error) {
    elements.eventsList.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const message = document.createElement('p');
    message.textContent = `Не удалось загрузить события: ${error.message}`;
    empty.append(message);
    elements.eventsList.append(empty);
    elements.eventsCount.textContent = '—';
  }
}

function updateTotalEventsCount() {
  const selected = document.querySelectorAll('.event-card').length;
  elements.eventCount.textContent = selected.toLocaleString('ru-RU');
}

async function selectVenue(venue) {
  selectedVenueId = venue.id;
  renderVenueList();
  renderMarkers();
  map.setView([Number(venue.latitude), Number(venue.longitude)], Math.max(map.getZoom(), 14));
  elements.selected.classList.remove('hidden');
  elements.selectedName.textContent = escapeText(venue.name || 'Площадка');
  elements.selectedAddress.textContent = venueAddress(venue);
  elements.selectedCapacity.textContent = `${Number(venue.capacity || 0).toLocaleString('ru-RU')} человек`;
  elements.selectedDistrict.textContent = districtName(venue.district_code);
  elements.selectedCoordinates.textContent = `${Number(venue.latitude).toFixed(5)}, ${Number(venue.longitude).toFixed(5)}`;
  elements.eventsList.innerHTML = '<div class="empty-state"><span class="loader"></span><p>Загружаем расписание…</p></div>';
  elements.selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  loadVenueEvents(venue.id);
}

function closeSelection() {
  selectedVenueId = null;
  elements.selected.classList.add('hidden');
  elements.eventsList.replaceChildren();
  elements.eventsList.innerHTML = '<div class="empty-state"><p>Выберите площадку на карте.</p></div>';
  elements.eventsCount.textContent = '0';
  renderVenueList();
  if (markerLayer) renderMarkers();
}

async function bootstrap() {
  try {
    initMap();
    const [districts, meta] = await Promise.all([
      apiGet('/meta/districts'),
      apiGet('/meta')
    ]);
    createDistrictOptions(districts.data || []);
    referenceTime = meta.reference_time || meta.dataset?.reference_time || null;
    if (referenceTime) {
      const time = new Date(referenceTime);
      elements.filterHint.textContent = `Данные API готовы. Учебная дата набора: ${formatDate(referenceTime)}.`;
    }
    await loadVenues();
  } catch (error) {
    elements.venueList.innerHTML = '';
    const message = document.createElement('p');
    message.className = 'empty-state';
    message.textContent = `Не удалось подключиться к backend: ${error.message}`;
    elements.venueList.append(message);
    showToast('Проверьте запуск Docker Compose и доступность backend.');
  }
}

elements.apply.addEventListener('click', loadVenues);
elements.reset.addEventListener('click', () => {
  elements.district.value = '';
  elements.capacity.value = '1';
  elements.search.value = '';
  closeSelection();
  loadVenues();
});
elements.search.addEventListener('keydown', event => {
  if (event.key === 'Enter') loadVenues();
});
elements.closeSelected.addEventListener('click', closeSelection);

bootstrap();
