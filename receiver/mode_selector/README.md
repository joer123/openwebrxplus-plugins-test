---
layout: page
title: "OpenWebRX+ Receiver Plugin: Mode Selector"
permalink: /receiver/mode_selector
---

This `receiver` plugin replaces the visible analog modulation buttons in the OpenWebRX+ receiver panel with one compact mode selector. It provides a single menu for the available analog demodulation modes and keeps the receiver's existing digital controls separate.

## Load

Add this line in your `init.js` file:

```js
// remote
Plugins.load('https://0xaf.github.io/openwebrxplus-plugins/receiver/mode_selector/mode_selector.js');
// local
Plugins.load('mode_selector');
```

## Usage

After the receiver mode controls have loaded, the plugin adds a **MODE** button to the receiver's mode section. The button label changes to the currently selected mode. Click it to open the selector and click a mode to change the demodulation mode.

The selector is built from the analog modes provided by OpenWebRX+ and only shows modes that are available in the current receiver interface. The menu is arranged in a compact grid. LSB and USB are placed around the center of the selector when available, while HDR and other available modes are added to the remaining rows.

### Frequency Tune Buttons

To the left and right of the **MODE** button, the plugin adds two triangular groups of step-tune buttons (one large step on top, two smaller steps side by side below it, mirrored between the left and right side). Clicking a button nudges the receive frequency down (left) or up (right) by its step and rounds to the nearest multiple of that step. The default steps are 10kHz/1kHz/500Hz; see Configuration below to change them.

### Mode Selector Button

* **MODE**: Opens the mode selector when no known mode is currently active.
* **Current mode name**: Opens the selector and indicates the active modulation mode.
* **Outside click or Escape**: Closes the open selector.
* **Receiver section closed**: The selector closes automatically.

### Analog Modes

Analog modes are selected directly through `UI.setModulation()`. The plugin does not hard-code a fixed list, so modes added or removed by the current OpenWebRX+ configuration are reflected automatically.

Digital mode controls are not the focus of this plugin. If OpenWebRX+ exposes a digital mode definition through the same mode API, it may appear in the generated list; the existing digital-mode row remains available separately.

## Behavior

* The original mode grid buttons are hidden while the selector is active.
* The existing digital-mode row remains available separately when OpenWebRX+ provides it.
* The active mode is highlighted in the open menu.
* The plugin waits for the receiver mode panel and mode definitions when they are not available at initialisation time.
* A small synchronization loop restores the selector placement if OpenWebRX+ rebuilds the receiver panel.
* The plugin injects its own layout styles and does not require a separate CSS file.

## Configuration

The tune button steps can be preset in `init.js`, before the plugin loads:

```js
Plugins.mode_selector_steps = [12500, 5000, 1000]; // 12.5kHz, 5kHz, 1kHz
```

Order is largest to smallest. If not set, the steps default to `[10000, 1000, 500]`. No other manual configuration is required - the selector otherwise uses the mode definitions and receiver controls supplied by the active OpenWebRX+ profile.

## License

MIT

## Code

[Github repo](https://github.com/0xAF/openwebrxplus-plugins/tree/main/receiver/mode_selector)
