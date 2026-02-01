// Huxley2 API base URL
const HUXLEY_BASE_URL = 'https://huxley2.azurewebsites.net';

// Current state
let currentStation = 'KGX';
let currentStationNameText = 'King\'s Cross';
let currentTab = 'departures';
let currentTimeInterval = 120; // Time window in minutes (max 120 per API limit)
let currentRouteFilter = null; // { from: 'SNL', to: 'WAT' } for route-specific tabs
let refreshInterval;
let countdownInterval;
let countdown = 15;

// Route definitions
const ROUTES = {
    'snl-to-wat': { from: 'SNL', fromName: 'Stoneleigh', to: 'WAT', toName: 'London Waterloo' },
    'wat-to-snl': { from: 'WAT', fromName: 'London Waterloo', to: 'SNL', toName: 'Stoneleigh' }
};

// DOM elements
const stationSearch = document.getElementById('station-search');
const searchResults = document.getElementById('search-results');
const currentStationName = document.getElementById('current-station-name');
const trainList = document.getElementById('train-list');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const trainBoard = document.getElementById('train-board');
const countdownEl = document.getElementById('countdown');
const lastUpdatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-btn');
const tabBtns = document.querySelectorAll('.tab-btn');
const timeIntervalSelect = document.getElementById('time-interval');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check URL for station parameter
    const urlParams = new URLSearchParams(window.location.search);
    const stationParam = urlParams.get('station');
    if (stationParam) {
        currentStation = stationParam.toUpperCase();
        currentStationNameText = getStationName(currentStation);
        currentStationName.textContent = currentStationNameText;
        document.querySelector('.station-code').textContent = `(${currentStation})`;
    }

    loadTrains();
    startAutoRefresh();
    setupEventListeners();
});

function setupEventListeners() {
    // Station search
    let searchTimeout;
    stationSearch.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();

        if (query.length < 2) {
            searchResults.classList.remove('active');
            return;
        }

        searchTimeout = setTimeout(() => {
            displaySearchResults(query);
        }, 300);
    });

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchResults.classList.remove('active');
        }
    });

    // Tab switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTab = btn.dataset.tab;

            // Handle route-specific tabs
            if (ROUTES[currentTab]) {
                const route = ROUTES[currentTab];
                currentRouteFilter = { from: route.from, to: route.to, toName: route.toName };
                currentStation = route.from;
                currentStationNameText = route.fromName;
                currentStationName.textContent = route.fromName;
                document.querySelector('.station-code').textContent = `(${route.from})`;
            } else {
                currentRouteFilter = null;
            }

            loadTrains();
        });
    });

    // Manual refresh
    refreshBtn.addEventListener('click', () => {
        loadTrains();
        resetCountdown();
    });

    // Time interval filter
    timeIntervalSelect.addEventListener('change', (e) => {
        currentTimeInterval = parseInt(e.target.value, 10);
        loadTrains();
    });
}

function displaySearchResults(query) {
    const stations = searchStations(query);

    if (stations.length === 0) {
        searchResults.innerHTML = '<div class="search-result-item">No stations found</div>';
    } else {
        searchResults.innerHTML = stations.map(station =>
            `<div class="search-result-item" data-code="${station.code}">
                <span class="code">${station.code}</span>
                <span class="name">${station.name}</span>
            </div>`
        ).join('');

        // Add click handlers
        searchResults.querySelectorAll('.search-result-item[data-code]').forEach(item => {
            item.addEventListener('click', () => {
                selectStation(item.dataset.code, item.querySelector('.name').textContent);
            });
        });
    }

    searchResults.classList.add('active');
}

function selectStation(code, name) {
    currentStation = code;
    currentStationNameText = name;
    currentStationName.textContent = name;
    document.querySelector('.station-code').textContent = `(${code})`;
    stationSearch.value = '';
    searchResults.classList.remove('active');

    // Clear route filter and switch to departures tab
    currentRouteFilter = null;
    currentTab = 'departures';
    tabBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('[data-tab="departures"]').classList.add('active');

    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('station', code);
    window.history.pushState({}, '', url);

    // Update page title
    document.title = `UK Train Times - ${name}`;

    loadTrains();
    resetCountdown();
}

async function fetchDeparturesChunk(stationCode, timeOffset, timeWindow, filterTo = null) {
    let url;
    if (filterTo) {
        url = `${HUXLEY_BASE_URL}/departures/${stationCode.toUpperCase()}/to/${filterTo.toUpperCase()}/50`;
    } else {
        url = `${HUXLEY_BASE_URL}/departures/${stationCode.toUpperCase()}/50`;
    }

    const params = new URLSearchParams({
        expand: 'true',
        timeOffset: timeOffset,
        timeWindow: timeWindow
    });

    const response = await fetch(`${url}?${params}`);
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return response.json();
}

function processService(service) {
    return {
        serviceId: service.serviceID || service.rsid || '',
        sta: service.sta || '',
        eta: service.eta || '',
        std: service.std || '',
        etd: service.etd || '',
        platform: service.platform || '-',
        origin: service.origin && service.origin[0] ? getStationName(service.origin[0].crs) : '',
        destination: service.destination && service.destination[0] ? getStationName(service.destination[0].crs) : '',
        operator: service.operator || '',
        isCancelled: service.isCancelled || false,
        cancelReason: service.cancelReason || '',
        delayReason: service.delayReason || ''
    };
}

async function loadTrains() {
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    trainBoard.style.display = 'none';

    try {
        const timeWindow = Math.min(Math.max(currentTimeInterval, 1), 120);
        const filterTo = currentRouteFilter ? currentRouteFilter.to : null;

        // Make multiple requests with different time offsets to get more trains
        const chunkSize = 30;
        const allServices = {};
        let generatedAt = null;

        const numChunks = Math.ceil(timeWindow / chunkSize);

        for (let i = 0; i < numChunks; i++) {
            const offset = i * chunkSize;
            const window = Math.min(chunkSize, timeWindow - offset);

            try {
                const data = await fetchDeparturesChunk(currentStation, offset, window, filterTo);

                if (!generatedAt) {
                    generatedAt = data.generatedAt || '';
                }

                const trainServices = data.trainServices || [];
                for (const service of trainServices) {
                    const processed = processService(service);
                    const key = processed.serviceId || `${processed.std}_${processed.destination}`;
                    if (key && !allServices[key]) {
                        allServices[key] = processed;
                    }
                }
            } catch (e) {
                console.warn(`Failed to fetch chunk ${i}:`, e);
            }
        }

        // Convert to sorted array
        const services = Object.values(allServices);
        services.sort((a, b) => (a.std || '99:99').localeCompare(b.std || '99:99'));

        renderTrains(services);
        updateLastUpdated(generatedAt);

        loadingEl.style.display = 'none';
        trainBoard.style.display = 'table';
    } catch (error) {
        loadingEl.style.display = 'none';
        errorEl.textContent = `Error loading train times: ${error.message}`;
        errorEl.style.display = 'block';
    }
}

function parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function filterByTimeInterval(services) {
    if (currentTimeInterval === 0) return services;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const cutoffMinutes = currentMinutes + currentTimeInterval;

    return services.filter(service => {
        const time = service.std;
        const trainMinutes = parseTimeToMinutes(time);
        if (trainMinutes === null) return true;

        if (cutoffMinutes >= 1440) {
            return trainMinutes >= currentMinutes || trainMinutes <= (cutoffMinutes - 1440);
        }

        return trainMinutes >= currentMinutes && trainMinutes <= cutoffMinutes;
    });
}

function renderTrains(services) {
    const filteredServices = filterByTimeInterval(services || []);

    if (!filteredServices || filteredServices.length === 0) {
        const intervalText = currentTimeInterval >= 60
            ? `${currentTimeInterval / 60} hour${currentTimeInterval > 60 ? 's' : ''}`
            : `${currentTimeInterval} minutes`;
        const routeText = currentRouteFilter
            ? ` to ${currentRouteFilter.toName}`
            : '';
        trainList.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <h3>No trains scheduled</h3>
                        <p>There are no departures${routeText} in the next ${intervalText}.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    trainList.innerHTML = filteredServices.map((service, index) => {
        const time = service.std;
        const expected = service.etd;

        let status, statusClass;
        if (service.isCancelled) {
            status = 'Cancelled';
            statusClass = 'cancelled';
        } else if (expected === 'On time') {
            status = 'On time';
            statusClass = 'on-time';
        } else if (expected === 'Delayed') {
            status = 'Delayed';
            statusClass = 'delayed';
        } else if (expected && expected !== time) {
            status = 'Delayed';
            statusClass = 'delayed';
        } else {
            status = 'On time';
            statusClass = 'on-time';
        }

        const expectedDisplay = service.isCancelled ? '-' :
            (expected === 'On time' ? time : expected || time);

        const serviceId = service.serviceId || '';

        return `
            <tr class="train-row" data-service-id="${serviceId}" data-index="${index}">
                <td class="expand-cell"><span class="expand-icon">+</span></td>
                <td class="time">${time || '-'}</td>
                <td class="expected">${expectedDisplay}</td>
                <td class="dest-col">${service.destination || '-'}</td>
                <td class="platform">${service.platform || '-'}</td>
                <td><span class="status ${statusClass}">${status}</span></td>
            </tr>
            <tr class="calling-points-row" id="calling-points-${index}" style="display: none;">
                <td colspan="6">
                    <div class="calling-points-container">
                        <div class="calling-points-loading">Loading stops...</div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Add click handlers for expanding/collapsing
    document.querySelectorAll('.train-row').forEach(row => {
        row.addEventListener('click', () => toggleCallingPoints(row));
    });
}

async function toggleCallingPoints(row) {
    const index = row.dataset.index;
    const serviceId = row.dataset.serviceId;
    const callingPointsRow = document.getElementById(`calling-points-${index}`);
    const expandIcon = row.querySelector('.expand-icon');

    if (!callingPointsRow) return;

    if (callingPointsRow.style.display === 'none') {
        callingPointsRow.style.display = 'table-row';
        expandIcon.textContent = '-';
        row.classList.add('expanded');

        const container = callingPointsRow.querySelector('.calling-points-container');
        if (container.querySelector('.calling-points-loading')) {
            await fetchCallingPoints(serviceId, container);
        }
    } else {
        callingPointsRow.style.display = 'none';
        expandIcon.textContent = '+';
        row.classList.remove('expanded');
    }
}

async function fetchCallingPoints(serviceId, container) {
    if (!serviceId) {
        container.innerHTML = '<div class="calling-points-error">Service details not available</div>';
        return;
    }

    try {
        const response = await fetch(`${HUXLEY_BASE_URL}/service/${encodeURIComponent(serviceId)}?expand=true`);
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        const data = await response.json();

        const callingPoints = [];
        const subsequent = data.subsequentCallingPoints || [];
        if (subsequent.length > 0 && subsequent[0].callingPoint) {
            for (const point of subsequent[0].callingPoint) {
                callingPoints.push({
                    station: getStationName(point.crs),
                    crs: point.crs,
                    st: point.st || '',
                    et: point.et || '',
                    at: point.at || '',
                    isCancelled: point.isCancelled || false
                });
            }
        }

        if (callingPoints.length === 0) {
            container.innerHTML = '<div class="calling-points-empty">No intermediate stops</div>';
            return;
        }

        const stopsHtml = callingPoints.map((point, idx) => {
            const isLast = idx === callingPoints.length - 1;
            let timeDisplay = point.st || '';
            let timeClass = '';

            if (point.at && point.at !== 'On time') {
                timeDisplay = point.at;
                timeClass = 'arrived';
            } else if (point.et && point.et !== 'On time' && point.et !== point.st) {
                timeDisplay = `${point.st} (exp ${point.et})`;
                timeClass = 'delayed';
            }

            if (point.isCancelled) {
                timeClass = 'cancelled';
                timeDisplay = 'Cancelled';
            }

            return `
                <div class="calling-point ${isLast ? 'final-stop' : ''}">
                    <div class="stop-indicator">
                        <div class="stop-line ${idx === 0 ? 'first' : ''}"></div>
                        <div class="stop-dot ${isLast ? 'final' : ''}"></div>
                        <div class="stop-line bottom ${isLast ? 'last' : ''}"></div>
                    </div>
                    <div class="stop-info">
                        <span class="stop-name">${point.station}</span>
                        <span class="stop-time ${timeClass}">${timeDisplay}</span>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="calling-points-header">Calling at:</div>
            <div class="calling-points-list">${stopsHtml}</div>
        `;

    } catch (error) {
        container.innerHTML = `<div class="calling-points-error">Failed to load stops: ${error.message}</div>`;
    }
}

function updateLastUpdated(timestamp) {
    if (timestamp) {
        const date = new Date(timestamp);
        lastUpdatedEl.textContent = date.toLocaleTimeString();
    } else {
        lastUpdatedEl.textContent = new Date().toLocaleTimeString();
    }
}

function startAutoRefresh() {
    refreshInterval = setInterval(() => {
        loadTrains();
        resetCountdown();
    }, 15000);

    countdownInterval = setInterval(() => {
        countdown--;
        countdownEl.textContent = countdown;
        if (countdown <= 0) {
            resetCountdown();
        }
    }, 1000);
}

function resetCountdown() {
    countdown = 15;
    countdownEl.textContent = countdown;
}

// Handle browser back/forward
window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const station = urlParams.get('station') || 'KGX';
    if (station !== currentStation) {
        currentStation = station;
        currentStationNameText = getStationName(station);
        currentStationName.textContent = currentStationNameText;
        document.querySelector('.station-code').textContent = `(${station})`;
        loadTrains();
    }
});
