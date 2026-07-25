# DX Cluster Plugin for OpenWebRX+

An OpenWebRX+ plugin that displays DX Cluster spots directly on the waterfall, making it easy to discover and tune into active amateur radio stations.

## Features

- **Real-time DX Cluster Overlay**: Displays spotted stations on the waterfall with their callsigns
- **Smart Label Placement**: Automatically positions labels to avoid overlap using a multi-level layout
- **Interactive Markers**: 
  - Click on a marker to tune to that frequency
  - Hover for detailed spot information (callsign, spotter, frequency, comment)
  - Long-press on touch devices for details
- **Age-based Styling**: New spots (< 6 minutes) are highlighted with a green border
- **Blink Animation**: New spots blink 3 times when they first appear
- **Auto-updates**: Fetches new spot data every 5 minutes
- **Band Filtering**: Only shows spots within defined amateur radio bands
- **Age Filtering**: Hides spots older than 15 minutes

## Supported Bands

The plugin supports the following amateur radio bands (in kHz):

- 160m: 1800-2000 kHz
- 80m: 3500-4000 kHz
- 60m: 5351-5366 kHz
- 40m: 7000-7200 kHz
- 30m: 10100-10150 kHz
- 20m: 14000-14350 kHz
- 17m: 18068-18168 kHz
- 15m: 21000-21450 kHz
- 12m: 24890-24990 kHz
- 10m: 28000-29700 kHz
- 6m: 50000-52000 kHz

## Installation

1. Copy the `dxcluster` folder to your OpenWebRX+ `receiver/` directory
2. Add this line in your `init.js` file:

```js
// load remote
Plugins.load('https://0xaf.github.io/openwebrxplus-plugins/receiver/dxcluster/dxcluster.js');
// or local
Plugins.load('dxcluster')
```

3. The plugin will be automatically loaded when OpenWebRX+ starts

## Usage

1. Click the **DX** button in the receiver panel to toggle the overlay
2. When enabled, DX Cluster spots will appear on the waterfall
3. Click on any callsign marker to tune to that frequency
4. Hover over markers for detailed information

## Configuration

The plugin uses the following settings (stored in localStorage):

- `dxcluster_overlay_enabled`: Toggle the overlay on/off (default: false)

## API

The plugin fetches spot data from:
```
https://dxc.jo30.de/dxcache/spots
```

Data is refreshed every 5 minutes.

## Technical Details

- **Render Interval**: 1 second
- **Fetch Interval**: 5 minutes
- **Maximum Spot Age**: 15 minutes
- **New Spot Threshold**: 6 minutes (green border + blink animation)
- **Blink Animation**: 3 blinks at 150ms intervals

## License

MIT License

Copyright (c) 2026 DL1HQH
