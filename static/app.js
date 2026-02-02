// National Rail API base URL (alternative Huxley-style proxy)
const HUXLEY_BASE_URL = 'https://national-rail-api.davwheat.dev';

// Current state - default to Stoneleigh → Waterloo route
let fromStation = { code: 'SNL', name: 'Stoneleigh' };
let toStation = { code: 'WAT', name: 'London Waterloo' };
let currentTab = 'snl-to-wat';
let currentTimeOffset = 0; // Time offset in minutes from now
let refreshInterval;
let countdownInterval;
let countdown = 60;

// Route definitions for quick tabs
const ROUTES = {
    'snl-to-wat': { from: 'SNL', fromName: 'Stoneleigh', to: 'WAT', toName: 'London Waterloo' },
    'wat-to-snl': { from: 'WAT', fromName: 'London Waterloo', to: 'SNL', toName: 'Stoneleigh' }
};

// DOM elements
const fromStationSearch = document.getElementById('from-station-search');
const fromSearchResults = document.getElementById('from-search-results');
const fromStationDisplay = document.getElementById('from-station-display');
const toStationSearch = document.getElementById('to-station-search');
const toSearchResults = document.getElementById('to-search-results');
const toStationDisplay = document.getElementById('to-station-display');
const swapBtn = document.getElementById('swap-stations');
const departuresStationSearch = document.getElementById('departures-station-search');
const departuresSearchResults = document.getElementById('departures-search-results');
const departuresStationDisplay = document.getElementById('departures-station-display');
const trainList = document.getElementById('train-list');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const trainBoard = document.getElementById('train-board');
const countdownEl = document.getElementById('countdown');
const lastUpdatedEl = document.getElementById('last-updated');
const refreshBtn = document.getElementById('refresh-btn');
const tabBtns = document.querySelectorAll('.tab-btn');
const travelTimeInput = document.getElementById('travel-time');
const searchBtn = document.getElementById('search-btn');
const nowBtn = document.getElementById('now-btn');
const searchInfoEl = document.getElementById('search-info');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check URL for station parameters
    const urlParams = new URLSearchParams(window.location.search);
    const fromParam = urlParams.get('from');
    const toParam = urlParams.get('to');

    if (fromParam) {
        fromStation = { code: fromParam.toUpperCase(), name: getStationName(fromParam.toUpperCase()) };
        updateFromStationDisplay();
    }
    if (toParam) {
        toStation = { code: toParam.toUpperCase(), name: getStationName(toParam.toUpperCase()) };
        updateToStationDisplay();
    }

    // Set default time to now
    setTimeToNow();

    loadTrains();
    loadCommutePanels();
    startAutoRefresh();
    setupEventListeners();
});

// Set the time input to current time
function setTimeToNow() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    if (travelTimeInput) {
        travelTimeInput.value = `${hours}:${minutes}`;
    }
    currentTimeOffset = 0;
}

// Calculate time offset in minutes from now based on selected time
function calculateTimeOffset() {
    if (!travelTimeInput || !travelTimeInput.value) {
        return 0;
    }

    const now = new Date();
    const selectedTime = travelTimeInput.value.split(':');
    const selectedHours = parseInt(selectedTime[0], 10);
    const selectedMinutes = parseInt(selectedTime[1], 10);

    const targetDate = new Date();
    targetDate.setHours(selectedHours, selectedMinutes, 0, 0);

    const diffMs = targetDate - now;
    const diffMinutes = Math.round(diffMs / 60000);

    // API supports -120 to 119 for timeOffset
    return diffMinutes;
}

// Check if the time offset is within API limits
function isTimeOffsetValid(offset) {
    return offset >= -120 && offset <= 119;
}

// Get a formatted string for the selected time
function getSelectedTimeString() {
    if (!travelTimeInput || !travelTimeInput.value) {
        return null;
    }
    return travelTimeInput.value;
}

// Update the search info display
function updateSearchInfo() {
    if (!searchInfoEl) return;

    if (currentTimeOffset === 0) {
        searchInfoEl.classList.remove('active');
        return;
    }

    const timeText = travelTimeInput?.value || '';

    if (timeText) {
        searchInfoEl.innerHTML = `Showing trains from <span class="time-label">${timeText}</span> (2 hours)`;
        searchInfoEl.classList.add('active');
    } else {
        searchInfoEl.classList.remove('active');
    }
}

function updateFromStationDisplay() {
    if (fromStation.code) {
        fromStationDisplay.textContent = `${fromStation.name} (${fromStation.code})`;
    } else {
        fromStationDisplay.textContent = 'Select a station...';
    }
}

function updateToStationDisplay() {
    if (toStation.code) {
        toStationDisplay.textContent = `${toStation.name} (${toStation.code})`;
    } else {
        toStationDisplay.textContent = 'Any destination';
    }
}

function setupEventListeners() {
    // From station search
    let fromSearchTimeout;
    fromStationSearch.addEventListener('input', (e) => {
        clearTimeout(fromSearchTimeout);
        const query = e.target.value.trim();

        if (query.length < 2) {
            fromSearchResults.classList.remove('active');
            return;
        }

        fromSearchTimeout = setTimeout(() => {
            displaySearchResults(query, fromSearchResults, 'from');
        }, 300);
    });

    // To station search
    let toSearchTimeout;
    toStationSearch.addEventListener('input', (e) => {
        clearTimeout(toSearchTimeout);
        const query = e.target.value.trim();

        if (query.length < 2) {
            toSearchResults.classList.remove('active');
            return;
        }

        toSearchTimeout = setTimeout(() => {
            displaySearchResults(query, toSearchResults, 'to');
        }, 300);
    });

    // Departures station search (for viewing all departures from any station)
    let departuresSearchTimeout;
    departuresStationSearch.addEventListener('input', (e) => {
        clearTimeout(departuresSearchTimeout);
        const query = e.target.value.trim();

        if (query.length < 2) {
            departuresSearchResults.classList.remove('active');
            return;
        }

        departuresSearchTimeout = setTimeout(() => {
            displayDeparturesSearchResults(query);
        }, 300);
    });

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container') && !e.target.closest('.departures-search')) {
            fromSearchResults.classList.remove('active');
            toSearchResults.classList.remove('active');
            departuresSearchResults.classList.remove('active');
        }
    });

    // Swap stations button
    swapBtn.addEventListener('click', () => {
        // Only swap if we have a "to" station
        if (toStation.code) {
            const temp = { ...fromStation };
            fromStation = { ...toStation };
            toStation = temp;
            updateFromStationDisplay();
            updateToStationDisplay();
            updateURL();

            // Clear route tab selection since we're now on a custom route
            currentTab = 'custom';
            tabBtns.forEach(b => b.classList.remove('active'));

            // Clear departures station display since we're using the from/to fields
            departuresStationDisplay.textContent = '';
            departuresStationSearch.value = '';

            loadTrains();
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
                fromStation = { code: route.from, name: route.fromName };
                toStation = { code: route.to, name: route.toName };
                updateFromStationDisplay();
                updateToStationDisplay();
                updateURL();

                // Clear departures station display since we're using a route tab
                departuresStationDisplay.textContent = '';
                departuresStationSearch.value = '';

                loadTrains();
            }
        });
    });

    // Manual refresh
    refreshBtn.addEventListener('click', () => {
        loadTrains();
        loadCommutePanels();
        resetCountdown();
    });

    // Search button - search for trains at selected date/time
    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            currentTimeOffset = calculateTimeOffset();
            loadTrains();
        });
    }

    // Now button - reset to current time
    if (nowBtn) {
        nowBtn.addEventListener('click', () => {
            setTimeToNow();
            loadTrains();
        });
    }

    // Also search when pressing Enter in the time input
    if (travelTimeInput) {
        travelTimeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                currentTimeOffset = calculateTimeOffset();
                loadTrains();
            }
        });
    }

    // Allow clearing "to" station by pressing Escape or clearing the field
    toStationSearch.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            toStation = { code: null, name: null };
            toStationSearch.value = '';
            updateToStationDisplay();
            toSearchResults.classList.remove('active');
            updateURL();
            loadTrains();
        }
    });
}

function displaySearchResults(query, resultsContainer, type) {
    const stations = searchStations(query);

    if (stations.length === 0) {
        resultsContainer.innerHTML = '<div class="search-result-item">No stations found</div>';
    } else {
        // Find station groups (e.g., "Heathrow" with multiple terminals)
        let groups = {};
        if (typeof findStationGroups === 'function') {
            const result = findStationGroups(stations);
            groups = result.groups || {};
        }

        // Add "Clear" option for "to" station
        let html = '';
        if (type === 'to') {
            html = `<div class="search-result-item clear-destination" data-code="">
                <span class="code">✕</span>
                <span class="name">Clear destination (show all)</span>
            </div>`;
        }

        // Add "All stations" options for groups
        for (const [prefix, groupStations] of Object.entries(groups)) {
            const codes = groupStations.map(s => s.code).join(',');
            html += `<div class="search-result-item all-stations" data-code="${codes}">
                <span class="code">ALL</span>
                <span class="name">All ${prefix} stations (${groupStations.length})</span>
            </div>`;
        }

        // Add individual stations
        html += stations.slice(0, 15).map(station =>
            `<div class="search-result-item" data-code="${station.code}">
                <span class="code">${station.code}</span>
                <span class="name">${station.name}</span>
            </div>`
        ).join('');

        resultsContainer.innerHTML = html;

        // Add click handlers
        resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const code = item.dataset.code;
                if (type === 'from') {
                    if (code) {
                        selectFromStation(code, item.querySelector('.name').textContent);
                    }
                } else {
                    if (code) {
                        selectToStation(code, item.querySelector('.name').textContent);
                    } else {
                        // Clear destination
                        toStation = { code: null, name: null };
                        toStationSearch.value = '';
                        updateToStationDisplay();
                        updateURL();
                        loadTrains();
                    }
                }
                resultsContainer.classList.remove('active');
            });
        });
    }

    resultsContainer.classList.add('active');
}

function displayDeparturesSearchResults(query) {
    const stations = searchStations(query);

    if (stations.length === 0) {
        departuresSearchResults.innerHTML = '<div class="search-result-item">No stations found</div>';
    } else {
        // Find station groups
        let groups = {};
        if (typeof findStationGroups === 'function') {
            const result = findStationGroups(stations);
            groups = result.groups || {};
        }

        let html = '';

        // Add "All stations" options for groups
        for (const [prefix, groupStations] of Object.entries(groups)) {
            const codes = groupStations.map(s => s.code).join(',');
            html += `<div class="search-result-item all-stations" data-code="${codes}">
                <span class="code">ALL</span>
                <span class="name">All ${prefix} stations (${groupStations.length})</span>
            </div>`;
        }

        // Add individual stations
        html += stations.slice(0, 15).map(station =>
            `<div class="search-result-item" data-code="${station.code}">
                <span class="code">${station.code}</span>
                <span class="name">${station.name}</span>
            </div>`
        ).join('');

        departuresSearchResults.innerHTML = html;

        // Add click handlers
        departuresSearchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const code = item.dataset.code;
                if (code) {
                    selectDeparturesStation(code, item.querySelector('.name').textContent);
                }
                departuresSearchResults.classList.remove('active');
            });
        });
    }

    departuresSearchResults.classList.add('active');
}

function selectDeparturesStation(code, name) {
    // Set the station for departures
    fromStation = { code, name };
    toStation = { code: null, name: null };

    // Update displays
    departuresStationSearch.value = '';
    departuresStationDisplay.textContent = `${name} (${code})`;

    // Clear the from/to displays to show we're using the departures section
    fromStationDisplay.textContent = 'Select a station...';
    toStationDisplay.textContent = 'Any destination';

    // Clear route tab selection
    currentTab = 'station-departures';
    tabBtns.forEach(b => b.classList.remove('active'));

    updateURL();
    document.title = `UK Train Times - ${name} Departures`;
    loadTrains();
    resetCountdown();
}

function selectFromStation(code, name) {
    fromStation = { code, name };
    fromStationSearch.value = '';
    fromStationSearch.placeholder = 'Departure station...';
    updateFromStationDisplay();

    // Make sure toStation display is in sync (in case it was cleared by departures section)
    updateToStationDisplay();

    // Clear route tab selection since we're using a custom route
    currentTab = 'custom';
    tabBtns.forEach(b => b.classList.remove('active'));

    // Clear departures station display
    departuresStationDisplay.textContent = '';
    departuresStationSearch.value = '';

    if (fromStation.code) {
        updateURL();
    }
    document.title = `UK Train Times - ${name}`;
    loadTrains();
    resetCountdown();
}

function selectToStation(code, name) {
    toStation = { code, name };
    toStationSearch.value = '';
    updateToStationDisplay();

    // Make sure fromStation display is in sync (in case it was cleared by departures section)
    updateFromStationDisplay();

    // Clear route tab selection since we're using a custom route
    currentTab = 'custom';
    tabBtns.forEach(b => b.classList.remove('active'));

    // Clear departures station display
    departuresStationDisplay.textContent = '';
    departuresStationSearch.value = '';

    // If no "from" station selected, prompt user to select one
    if (!fromStation.code) {
        fromStationSearch.focus();
        fromStationSearch.placeholder = 'Now select departure station...';
        trainBoard.style.display = 'table';
        loadingEl.style.display = 'none';
        trainList.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <h3>Select Departure Station</h3>
                        <p>You've selected ${name} as destination. Now search for a departure station above.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    if (fromStation.code) {
        updateURL();
    }
    loadTrains();
    resetCountdown();
}

function updateURL() {
    const url = new URL(window.location);
    url.searchParams.set('from', fromStation.code);
    if (toStation.code) {
        url.searchParams.set('to', toStation.code);
    } else {
        url.searchParams.delete('to');
    }
    window.history.pushState({}, '', url);
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
    // Don't load if no departure station is selected
    if (!fromStation.code) {
        trainBoard.style.display = 'table';
        loadingEl.style.display = 'none';
        trainList.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <h3>Select a Station</h3>
                        <p>Search for a station above to see all departures.</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    trainBoard.style.display = 'none';

    try {
        const timeWindow = 120; // Show 2 hours of trains
        const timeOffset = currentTimeOffset; // Offset from now in minutes
        const filterTo = toStation.code;

        // Check if the selected time is within API limits
        if (!isTimeOffsetValid(timeOffset)) {
            loadingEl.style.display = 'none';
            const selectedDateTime = getSelectedDateTimeString() || 'the selected time';
            errorEl.innerHTML = `<strong>Time out of range</strong><br>The train data API only supports searching up to 2 hours from now.<br>Please select a time closer to the current time.`;
            errorEl.style.display = 'block';
            trainBoard.style.display = 'none';
            return;
        }

        // Handle multiple station codes (comma-separated for "All stations" selections)
        const stationCodes = fromStation.code.includes(',')
            ? fromStation.code.split(',')
            : [fromStation.code];

        const allServices = {};
        let generatedAt = null;
        let failedChunks = 0;

        // Fetch from each station
        for (const stationCode of stationCodes) {
            try {
                const data = await fetchDeparturesChunk(stationCode.trim(), timeOffset, timeWindow, filterTo);

                if (!generatedAt) {
                    generatedAt = data.generatedAt || '';
                }

                const trainServices = data.trainServices || [];
                for (const service of trainServices) {
                    const processed = processService(service);
                    // Add origin station info for multi-station queries
                    if (stationCodes.length > 1) {
                        processed.departureStation = getStationName(stationCode.trim());
                    }
                    const key = processed.serviceId || `${processed.std}_${processed.destination}_${stationCode}`;
                    if (key && !allServices[key]) {
                        allServices[key] = processed;
                    }
                }
            } catch (e) {
                console.warn(`Failed to fetch from ${stationCode}:`, e);
                failedChunks++;
            }
        }

        // Convert to sorted array
        const services = Object.values(allServices);
        services.sort((a, b) => (a.std || '99:99').localeCompare(b.std || '99:99'));

        // Check if all chunks failed
        if (services.length === 0 && failedChunks > 0) {
            loadingEl.style.display = 'none';
            errorEl.innerHTML = `<strong>Train data temporarily unavailable</strong><br>The National Rail data service (Huxley2) may be experiencing issues. Please try again in a few minutes.`;
            errorEl.style.display = 'block';
            trainBoard.style.display = 'none';
            return;
        }

        renderTrains(services, failedChunks > 0);
        updateLastUpdated(generatedAt);
        updateSearchInfo();

        loadingEl.style.display = 'none';
        trainBoard.style.display = 'table';
    } catch (error) {
        loadingEl.style.display = 'none';
        errorEl.innerHTML = `<strong>Error loading train times</strong><br>${error.message}<br><small>The data service may be temporarily unavailable.</small>`;
        errorEl.style.display = 'block';
        trainBoard.style.display = 'none';
    }
}

function parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function getSearchTimeDescription() {
    if (!travelTimeInput || !travelTimeInput.value) {
        return 'the next 2 hours';
    }
    const timeText = travelTimeInput.value;
    if (currentTimeOffset === 0) {
        return 'the next 2 hours';
    }
    return `2 hours from ${timeText}`;
}

function renderTrains(services, hadErrors = false) {
    const filteredServices = services || [];

    if (!filteredServices || filteredServices.length === 0) {
        const timeDescription = getSearchTimeDescription();
        const routeText = toStation.code
            ? ` to ${toStation.name}`
            : '';
        const errorNote = hadErrors ? '<p style="color: #ffc107; font-size: 0.85rem; margin-top: 10px;">Note: Some data may be unavailable due to connection issues.</p>' : '';
        trainList.innerHTML = `
            <tr>
                <td colspan="6">
                    <div class="empty-state">
                        <h3>No trains scheduled</h3>
                        <p>There are no departures from ${fromStation.name}${routeText} in ${timeDescription}.</p>
                        ${errorNote}
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
        loadCommutePanels();
        resetCountdown();
    }, 60000);

    countdownInterval = setInterval(() => {
        countdown--;
        countdownEl.textContent = countdown;
        if (countdown <= 0) {
            resetCountdown();
        }
    }, 1000);
}

function resetCountdown() {
    countdown = 60;
    countdownEl.textContent = countdown;
}

// Handle browser back/forward
window.addEventListener('popstate', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const fromParam = urlParams.get('from') || 'KGX';
    const toParam = urlParams.get('to');

    fromStation = { code: fromParam.toUpperCase(), name: getStationName(fromParam.toUpperCase()) };
    updateFromStationDisplay();

    if (toParam) {
        toStation = { code: toParam.toUpperCase(), name: getStationName(toParam.toUpperCase()) };
    } else {
        toStation = { code: null, name: null };
    }
    updateToStationDisplay();

    loadTrains();
});

// Commute Panels - Stoneleigh <-> Waterloo
const snlWatTrains = document.getElementById('snl-wat-trains');
const watSnlTrains = document.getElementById('wat-snl-trains');

async function loadCommutePanels() {
    await Promise.all([
        loadCommutePanel('SNL', 'WAT', snlWatTrains),
        loadCommutePanel('WAT', 'SNL', watSnlTrains)
    ]);
}

async function loadCommutePanel(fromCode, toCode, container) {
    try {
        const response = await fetch(
            `${HUXLEY_BASE_URL}/departures/${fromCode}/to/${toCode}/10?expand=true&timeOffset=0&timeWindow=120`
        );

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const services = data.trainServices || [];

        if (services.length === 0) {
            container.innerHTML = '<div class="panel-no-trains">No trains scheduled</div>';
            return;
        }

        container.innerHTML = services.slice(0, 6).map(service => {
            const time = service.std || '-';
            const expected = service.etd || '';
            const platform = service.platform || '-';

            let expectedClass = '';
            let expectedText = '';

            if (service.isCancelled) {
                expectedClass = 'cancelled';
                expectedText = 'Cancelled';
            } else if (expected === 'On time') {
                expectedClass = 'on-time';
                expectedText = 'On time';
            } else if (expected && expected !== time) {
                expectedClass = 'delayed';
                expectedText = `Exp ${expected}`;
            } else {
                expectedClass = 'on-time';
                expectedText = 'On time';
            }

            return `
                <div class="panel-train-item">
                    <div>
                        <span class="panel-train-time">${time}</span>
                        <span class="panel-train-expected ${expectedClass}">${expectedText}</span>
                    </div>
                    <span class="panel-train-platform">Plat ${platform}</span>
                </div>
            `;
        }).join('');

    } catch (error) {
        container.innerHTML = `<div class="panel-no-trains">Data service unavailable</div>`;
    }
}

// London Underground Status
const tubeLoadingEl = document.getElementById('tube-loading');
const tubeErrorEl = document.getElementById('tube-error');
const tubeLinesEl = document.getElementById('tube-lines');

async function loadTubeStatus() {
    if (!tubeLinesEl) return;

    tubeLoadingEl.style.display = 'block';
    tubeErrorEl.style.display = 'none';
    tubeLinesEl.innerHTML = '';

    try {
        // Call TfL API directly (supports CORS)
        const response = await fetch('https://api.tfl.gov.uk/Line/Mode/tube/Status');
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();

        // Transform TfL API response
        const lines = data.map(line => {
            const lineStatuses = line.lineStatuses || [];
            const statusInfo = lineStatuses[0] || {};
            return {
                id: line.id || '',
                name: line.name || '',
                status: statusInfo.statusSeverityDescription || 'Unknown',
                statusSeverity: statusInfo.statusSeverity || 0,
                reason: statusInfo.reason || ''
            };
        });

        if (lines.length === 0) {
            tubeLoadingEl.style.display = 'none';
            tubeLinesEl.innerHTML = '<div class="tube-error">No tube status available</div>';
            return;
        }

        tubeLinesEl.innerHTML = lines.map(line => {
            const statusClass = getStatusClass(line.status, line.statusSeverity);
            const lineIdClass = line.id.toLowerCase().replace(/\s+/g, '-');

            let reasonHtml = '';
            if (line.reason && line.statusSeverity < 10) {
                // Truncate long reasons
                const reason = line.reason.length > 150
                    ? line.reason.substring(0, 150) + '...'
                    : line.reason;
                reasonHtml = `<div class="tube-line-reason">${escapeHtml(reason)}</div>`;
            }

            return `
                <div class="tube-line">
                    <div class="tube-line-indicator ${lineIdClass}"></div>
                    <div class="tube-line-info">
                        <div class="tube-line-name">${escapeHtml(line.name)}</div>
                        <span class="tube-line-status ${statusClass}">${escapeHtml(line.status)}</span>
                        ${reasonHtml}
                    </div>
                </div>
            `;
        }).join('');

        tubeLoadingEl.style.display = 'none';

    } catch (error) {
        tubeLoadingEl.style.display = 'none';
        tubeErrorEl.textContent = `Error loading tube status: ${error.message}`;
        tubeErrorEl.style.display = 'block';
    }
}

function getStatusClass(status, severity) {
    const statusLower = status.toLowerCase();

    if (severity === 10 || statusLower === 'good service') {
        return 'good-service';
    } else if (severity === 9 || statusLower === 'minor delays') {
        return 'minor-delays';
    } else if (severity === 6 || statusLower === 'severe delays') {
        return 'severe-delays';
    } else if (severity === 2 || statusLower === 'suspended') {
        return 'suspended';
    } else if (severity === 3 || statusLower === 'part suspended') {
        return 'part-suspended';
    } else if (severity === 1 || statusLower === 'closed') {
        return 'closed';
    } else if (severity === 7 || statusLower === 'reduced service') {
        return 'reduced-service';
    } else if (severity === 5 || statusLower === 'part closure') {
        return 'part-closure';
    } else if (severity === 4 || statusLower === 'planned closure') {
        return 'planned-closure';
    } else if (severity === 20 || statusLower === 'service closed') {
        return 'service-closed';
    } else if (severity === 0 || statusLower === 'special service') {
        return 'special-service';
    }

    return 'good-service';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load tube status on page load and refresh
document.addEventListener('DOMContentLoaded', () => {
    loadTubeStatus();
});

// Add tube status to auto-refresh
const originalStartAutoRefresh = startAutoRefresh;
startAutoRefresh = function() {
    originalStartAutoRefresh();

    // Override the refresh interval to include tube status
    clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        loadTrains();
        loadCommutePanels();
        loadTubeStatus();
        resetCountdown();
    }, 60000);
};

// Update refresh button to also refresh tube status
const originalRefreshHandler = refreshBtn.onclick;
refreshBtn.addEventListener('click', () => {
    loadTubeStatus();
});
