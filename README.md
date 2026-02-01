# UK Train Times

A real-time UK train departure board web application. View live train times from any UK station with route-specific filtering and detailed calling points.

## Features

- **Real-time departures** from any UK station
- **Route-specific tabs** for Stoneleigh ↔ Waterloo commuters
- **Expandable calling points** showing all stops for each train
- **Auto-refresh** every 15 seconds
- **Time interval filtering** (30 min, 1 hour, 2 hours)
- **Station search** with autocomplete

## Live Demo

Visit: [https://francesco-botta.github.io/uk-train-arrivals](https://francesco-botta.github.io/uk-train-arrivals)

## Screenshots

The application displays a modern, dark-themed departure board with:
- Current station information
- Departure times with expected delays
- Platform numbers
- Train status (On time, Delayed, Cancelled)
- Expandable route details

## Technology

- Pure HTML, CSS, and JavaScript (no frameworks)
- [Huxley2 API](https://huxley2.azurewebsites.net/) for real-time National Rail data
- GitHub Pages for hosting

## Data Source

Train data is provided by the [National Rail Darwin API](https://www.nationalrail.co.uk/developers/darwin-data-feeds/) via the [Huxley2](https://github.com/jpsingleton/Huxley2) CORS proxy.

## Local Development

Simply open `index.html` in a web browser, or use a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve
```

Then visit `http://localhost:8000`

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Huxley2](https://github.com/jpsingleton/Huxley2) by James Sherwood-Jones for the excellent Darwin API proxy
- National Rail Enquiries for the train data
