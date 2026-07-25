---
layout: page
title: "OpenWebRX+ Receiver Plugin: Audio Filter"
permalink: /receiver/audio_filter
---

# Audio Filter Plugin

> [!WARNING]
> **Note: Without AudioWorkletNode (which requires SSL in OpenWebRX+), audio dropouts may occur in the browser.**
>
> `AudioWorkletNode` is a modern Web API that runs audio processing in a separate thread for smooth performance. However, browsers restrict this feature to **Secure Contexts** (HTTPS/SSL or localhost).
>
> If your OpenWebRX+ instance is accessed via plain HTTP (without SSL), the plugin must fall back to the older `ScriptProcessorNode`. This runs on the browser's main thread, which is shared with the user interface and waterfall rendering. Heavy load on the main thread can interrupt audio processing, leading to stuttering or dropouts.

## Description

The **Audio Filter Plugin** (`audio_filter.js`) is an extension for OpenWebRX+ aimed at improving audio quality across all modulation modes (SSB, AM, CW, FM, Digital). By using the Web Audio API, client-side ter chains (Highpass, Lowpass, Gain, Dynamics) are inserted into the signal path to minimize noise and increase speech intelligibility.

**Note:** This plugin acts as a supplement to the excellent built-in NR (Noise Reduction) feature of OpenWebRX+.

## Features

- **Adaptive Filtering**: Automatically selects filter profiles based on modulation (SSB, AM, CW, NFM, WFM, Digital).
- **Noise Blanker (NB)**: Suppresses impulse noise (ignition noise, static crashes) using a smart blanking algorithm.
- **Spectral Noise Reduction (NR)**: FFT-based spectral subtraction to reduce steady-state background noise.
- **Advanced AGC/Compressor**: Hang-AGC implementation with integrated Noise Gate (Expander) to boost weak signals while keeping pauses silent.
- **Auto Notch**: Automatically detects and suppresses interfering carriers (heterodynes).
- **3-Band EQ**: Integrated equalizer (Bass/Treble/Presence) plus Loudness boost.
- **Real-time Visualizer**: Displays input/output spectrums and visualizes active filter ranges (EQ, Comp, Notch).
- **Per-Mode Persistence**: All settings (EQ, Comp, etc.) are saved separately for each mode.
- **Settings Management**: Export and Import your configuration profiles as JSON.
- **UI Integration**: Adds controls directly to the OpenWebRX+ interface.
- **Automatic Initialization**: Waits for the OpenWebRX `audio_context`.

## Preview

![Audio_Filter Preview](https://0xaf.github.io/openwebrxplus-plugins/receiver/audio_filter/audio_filter.jpg)

## Load

Add this line in your `init.js` file:

```js
// load remote
Plugins.load('https://0xaf.github.io/openwebrxplus-plugins/receiver/audio_filter/audio_filter.js');
// or local
Plugins.load('audio_filter')
```


## Usage

A small **FI** button is added to the bottom left of the receiver panel. Clicking this button opens a floating, draggable window containing the audio filter controls.

### FI Button Status
* **Grey**: Filter window is closed and no filters are active.
* **Green**: Filter window is open.
* **Yellow**: Filter window is closed, but one or more filters (EQ, Notch, NB, Comp) are active.

### Audio Filter Window Buttons
* **NB**: Activates the Noise Blanker for impulse noise reduction.
* **Notch**: Enables the automatic notch filter against heterodyne whistles.
  - *Long-Press*: Opens the Notch menu (Notch Q, Max Notches, Detection Center/Width).
* **NR**: Activates the Spectral Noise Reduction.
  - *Long-Press*: Opens the NR menu (Gain, Alpha, Active SNR, Comb Strength).
* **EQ**: Enables the equalizer and bandpass filters.
  - *Long-Press*: Opens the EQ menu (Bass, Treble, Presence Gain/Freq/Width, Loudness).
* **Comp**: Activates the Compressor/AGC.
  - *Long-Press*: Opens the Compressor menu (Air Gain, Max Boost, Gate Threshold, Hang Time, Recovery, Comp Volume, Comp Center/Width).
* **Set**: Opens the Settings menu to Export or Import configurations.
* **Graph**: Toggles the visualizer pane at the bottom of the window.

### Visualizer (Graph)
The graph shows the audio spectrum in real-time:
* **Yellow Line**: Input signal (before processing).
* **Cyan Line**: Output signal (after EQ, Comp, Gain).
* **Legend**: Click "In" or "Out" in the top left to toggle the respective curves.
* **Overlays**: Colored areas indicate active filter ranges:
  - **Green**: Compressor range.
  - **Yellow**: Presence filter range.
  - **Red**: Auto-Notch detection range.
* **Markers**: Small yellow bars at the top indicate currently active notch filters.

## Configuration

Default profiles are defined in the `CONFIG` constant within `audio_filter.js`.
However, users can override these settings via the **Long-Press Menus** on the EQ, Notch, and Comp buttons. Changes are automatically saved to the browser's LocalStorage.

## Technical Notes

The plugin attempts to hook into the existing `AudioContext`. Since OpenWebRX connects audio nodes dynamically, this script uses an approach to monitor `AudioNode.prototype.connect` (monkey patching) to correctly insert the filter chain.

## Status

This is a proof-of-concept plugin (`POC`). Integration into the signal path depends heavily on the OpenWebRX version used and may need adjustment.

## License
See source code.
