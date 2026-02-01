from flask import Flask, render_template, jsonify, request
import requests
from stations import get_station_name, search_stations, STATIONS

app = Flask(__name__)

HUXLEY_BASE_URL = "https://huxley2.azurewebsites.net"


@app.route("/")
def index():
    """Main page - displays train board for a station."""
    station = request.args.get("station", "KGX")  # Default to King's Cross
    station_name = get_station_name(station)
    return render_template("index.html", station_code=station, station_name=station_name)


def fetch_departures_chunk(station_code, time_offset, time_window, filter_to=None):
    """Fetch a chunk of departures with given time offset and window.

    If filter_to is provided, uses the /departures/{from}/to/{destination} endpoint
    to get trains calling at the destination station.
    """
    if filter_to:
        # Use the filtered endpoint: /departures/{from}/to/{destination}/50
        url = f"{HUXLEY_BASE_URL}/departures/{station_code.upper()}/to/{filter_to.upper()}/50"
    else:
        url = f"{HUXLEY_BASE_URL}/departures/{station_code.upper()}/50"

    response = requests.get(
        url,
        params={
            "expand": "true",
            "timeOffset": time_offset,
            "timeWindow": time_window
        },
        timeout=10
    )
    response.raise_for_status()
    return response.json()


def process_service(service):
    """Process a single service into our format."""
    return {
        "serviceId": service.get("serviceID", "") or service.get("rsid", ""),
        "sta": service.get("sta", ""),
        "eta": service.get("eta", ""),
        "std": service.get("std", ""),
        "etd": service.get("etd", ""),
        "platform": service.get("platform", "-"),
        "origin": get_station_name(service.get("origin", [{}])[0].get("crs", "")) if service.get("origin") else "",
        "destination": get_station_name(service.get("destination", [{}])[0].get("crs", "")) if service.get("destination") else "",
        "operator": service.get("operator", ""),
        "isCancelled": service.get("isCancelled", False),
        "cancelReason": service.get("cancelReason", ""),
        "delayReason": service.get("delayReason", ""),
    }


@app.route("/api/departures/<station_code>")
def get_departures(station_code):
    """Get departures from a station."""
    try:
        # timeWindow: how far ahead to look (max 120 minutes per Darwin API)
        time_window = request.args.get("timeWindow", 120, type=int)
        time_window = min(max(time_window, 1), 120)  # Clamp between 1-120

        # Optional filter to only show trains calling at a specific station
        filter_to = request.args.get("filterTo", None)

        # Darwin API typically limits results to ~10 per request
        # To get more trains, we make multiple requests with different time offsets
        # and combine the results
        chunk_size = 30  # 30-minute chunks
        all_services = {}
        generated_at = None

        # Calculate how many chunks we need
        num_chunks = (time_window + chunk_size - 1) // chunk_size  # Ceiling division

        for i in range(num_chunks):
            offset = i * chunk_size
            # Don't exceed the requested time window
            window = min(chunk_size, time_window - offset)

            try:
                data = fetch_departures_chunk(station_code, offset, window, filter_to)

                if generated_at is None:
                    generated_at = data.get("generatedAt", "")

                # Process services and deduplicate by serviceId
                for service in data.get("trainServices", []) or []:
                    processed = process_service(service)
                    service_id = processed["serviceId"]
                    # Use std + destination as fallback key if no serviceId
                    key = service_id if service_id else f"{processed['std']}_{processed['destination']}"
                    if key and key not in all_services:
                        all_services[key] = processed

            except requests.RequestException:
                # If one chunk fails, continue with others
                continue

        # Convert to list and sort by departure time
        services = list(all_services.values())
        services.sort(key=lambda s: s.get("std", "99:99"))

        return jsonify({
            "station": get_station_name(station_code),
            "stationCode": station_code.upper(),
            "generatedAt": generated_at or "",
            "services": services
        })
    except requests.RequestException as e:
        return jsonify({"error": str(e), "services": []}), 500


@app.route("/api/service/<service_id>")
def get_service_details(service_id):
    """Get detailed information about a specific train service including calling points."""
    try:
        # Get the current station to filter calling points
        current_station = request.args.get("station", "").upper()

        response = requests.get(
            f"{HUXLEY_BASE_URL}/service/{service_id}",
            params={"expand": "true"},
            timeout=10
        )
        response.raise_for_status()
        data = response.json()

        # Extract subsequent calling points (stops after current station)
        calling_points = []
        found_current_station = False

        # Process subsequent calling points
        subsequent = data.get("subsequentCallingPoints", [])
        if subsequent and len(subsequent) > 0:
            # The API returns an array of calling point lists
            points_list = subsequent[0].get("callingPoint", []) if isinstance(subsequent[0], dict) else []
            for point in points_list:
                crs = point.get("crs", "")
                calling_points.append({
                    "station": get_station_name(crs),
                    "crs": crs,
                    "st": point.get("st", ""),  # Scheduled time
                    "et": point.get("et", ""),  # Expected time
                    "at": point.get("at", ""),  # Actual time (if arrived)
                    "isCancelled": point.get("isCancelled", False),
                })

        return jsonify({
            "serviceId": service_id,
            "operator": data.get("operator", ""),
            "callingPoints": calling_points
        })
    except requests.RequestException as e:
        return jsonify({"error": str(e), "callingPoints": []}), 500


@app.route("/api/stations")
def api_search_stations():
    """Search for stations by name or code."""
    query = request.args.get("q", "")
    if len(query) < 2:
        return jsonify([])

    results = search_stations(query)
    return jsonify(results)


if __name__ == "__main__":
    app.run(debug=True)
