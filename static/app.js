// Current state
let currentStation = STATION_CODE;
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
            searchStations(query);
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

async function searchStations(query) {
    try {
        const response = await fetch(`/api/stations?q=${encodeURIComponent(query)}`);
        const stations = await response.json();

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
    } catch (error) {
        console.error('Error searching stations:', error);
    }
}

function selectStation(code, name) {
    currentStation = code;
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

async function loadTrains() {
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    trainBoard.style.display = 'none';

    try {
        // Build API URL with optional destination filter
        let apiUrl = `/api/departures/${currentStation}?timeWindow=${currentTimeInterval}`;
        if (currentRouteFilter) {
            apiUrl += `&filterTo=${currentRouteFilter.to}`;
        }

        const response = await fetch(apiUrl);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        renderTrains(data.services);
        updateLastUpdated(data.generatedAt);

        loadingEl.style.display = 'none';
        trainBoard.style.display = 'table';
    } catch (error) {
        loadingEl.style.display = 'none';
        errorEl.textContent = `Error loading train times: ${error.message}`;
        errorEl.style.display = 'block';
    }
}

function parseTimeToMinutes(timeStr) {
    // Parse time string like "14:30" to minutes from midnight
    if (!timeStr || typeof timeStr !== 'string') return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function filterByTimeInterval(services) {
    if (currentTimeInterval === 0) return services; // All day - no filter

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const cutoffMinutes = currentMinutes + currentTimeInterval;

    return services.filter(service => {
        const time = service.std;
        const trainMinutes = parseTimeToMinutes(time);
        if (trainMinutes === null) return true; // Keep if can't parse

        // Handle midnight crossover (e.g., current time 23:00, looking for trains until 01:00)
        if (cutoffMinutes >= 1440) {
            // Cutoff crosses midnight
            return trainMinutes >= currentMinutes || trainMinutes <= (cutoffMinutes - 1440);
        }

        return trainMinutes >= currentMinutes && trainMinutes <= cutoffMinutes;
    });
}

function renderTrains(services) {
    // Apply time filter
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

    // Toggle visibility
    if (callingPointsRow.style.display === 'none') {
        callingPointsRow.style.display = 'table-row';
        expandIcon.textContent = '-';
        row.classList.add('expanded');

        // Fetch calling points if not already loaded
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
        const response = await fetch(`/api/service/${encodeURIComponent(serviceId)}?station=${currentStation}`);
        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (!data.callingPoints || data.callingPoints.length === 0) {
            container.innerHTML = '<div class="calling-points-empty">No intermediate stops</div>';
            return;
        }

        const stopsHtml = data.callingPoints.map((point, idx) => {
            const isLast = idx === data.callingPoints.length - 1;
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
    // Refresh every 15 seconds
    refreshInterval = setInterval(() => {
        loadTrains();
        resetCountdown();
    }, 15000);

    // Countdown timer
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
        loadTrains();
    }
});
