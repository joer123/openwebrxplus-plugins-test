/**
 * dxcluster.js
 * 
 * An OpenWebRX+ plugin to display DX Cluster spots on the waterfall.
 * Fetches spot data from a given API based on the current frequency.
 * 
 * License: MIT 
 * Copyright (c) 2026 dl1hqh
 */

(function() {
    'use strict';

    const PLUGIN_ID = "dxcluster";
    console.log(`[${PLUGIN_ID}] Plugin loaded.`);

    const API_URL_ALL_SPOTS = "https://dxc.jo30.de/dxcache/spots";
    const FETCH_INTERVAL_MS = 5 * 60 * 1000;
    const RENDER_INTERVAL_MS = 1000;
    const MAX_SPOT_AGE_MS = 15 * 60 * 1000;
    const BANDS = [ // in kHz
        { start: 1800, end: 2000 },
        { start: 3500, end: 4000 },
        { start: 5351, end: 5366 },
        { start: 7000, end: 7200 },
        { start: 10100, end: 10150 },
        { start: 14000, end: 14350 },
        { start: 18068, end: 18168 },
        { start: 21000, end: 21450 },
        { start: 24890, end: 24990 },
        { start: 28000, end: 29700 },
        { start: 50000, end: 52000 },
    ];

    let last_freq_khz = -1; // Initialize to invalidate on first run
    let last_span = -1;
    let last_scale = -1;
    let overlay_enabled = false;
    let hook_attempts = 0;
    let all_spots_cache = [];
    let overlay_container = null;
    let current_scale = 1.0;
    let blinked_spots = new Set(); // Track spots that have already blinked

    /**
     * Maps a frequency in kHz to an x-coordinate.
     * @param {number} frequency - The frequency in kHz.
     * @returns {number} - The x-coordinate.
     */
    function freqToX(frequency) {
        const view_span = last_span / last_scale;
        const view_start_freq = last_freq_khz - view_span / 2;
        if (view_span <= 0) return -1; // Avoid division by zero
        return (frequency - view_start_freq) / view_span * overlay_container.clientWidth;
    }

    /**
     * Initializes the plugin.
     */
    function init() {
        const savedState = localStorage.getItem('dxcluster_overlay_enabled');
        if (savedState !== null) {
            overlay_enabled = (savedState === 'true');
        } else {            
            overlay_enabled = false;
        }

        if (!create_overlay()) {
            setTimeout(init, 500);
            return;
        }
        if (!create_ui()) {
            setTimeout(init, 500);
            return;
        }
        setInterval(main_loop, RENDER_INTERVAL_MS);
        update_all_spots();
        setInterval(update_all_spots, FETCH_INTERVAL_MS);

        attempt_hook_openwebrx();
        update_dxc_button_state();
    }

    /**
     * Hooks into UI functions for responsiveness.
     */
    function attempt_hook_openwebrx() {
        if (typeof UI !== 'undefined' && typeof UI.setFrequency === 'function' && !UI.setFrequency.is_dxcluster_hooked) {
            const original_setFrequency = UI.setFrequency;
            UI.setFrequency = function(freq) {
                const result = original_setFrequency.apply(this, arguments);
                setTimeout(main_loop, 250);
                return result;
            };
            UI.setFrequency.is_dxcluster_hooked = true;

            if (typeof UI.viewChanged === 'function' && !UI.viewChanged.is_dxcluster_hooked) {
                const original_viewChanged = UI.viewChanged;
                UI.viewChanged = function() {
                    original_viewChanged.apply(this, arguments);
                    // Force a re-render on the next interval tick by invalidating the last known state.
                    last_freq_khz = -1;
                    setTimeout(main_loop, 100);
                };
                UI.viewChanged.is_dxcluster_hooked = true;
            }
        } else if (hook_attempts < 20) { 
            hook_attempts++;
            setTimeout(attempt_hook_openwebrx, 500);
        }
    }

    /**
     * Creates the overlay container.
     * @returns {boolean} - True on success.
     */
    function create_overlay() {
        let waterfall_container = document.querySelector('#webrx-canvas-container');

        if (!waterfall_container) {
            return false;
        }

        overlay_container = document.createElement('div');
        overlay_container.id = 'dxcluster-overlay';
        overlay_container.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            overflow: hidden;
            z-index: 5;
        `;
        waterfall_container.appendChild(overlay_container);

        // Add event listeners to detect zoom and pan interactions.
        const force_update_handler = function() {
            last_freq_khz = -1; // Invalidate cache to force re-render
            setTimeout(main_loop, 100); // Wait for OpenWebRX to update globals
        };
        waterfall_container.addEventListener('wheel', force_update_handler, { passive: true });
        waterfall_container.addEventListener('mouseup', force_update_handler, { passive: true });
        waterfall_container.addEventListener('touchend', force_update_handler, { passive: true });
        waterfall_container.addEventListener('touchcancel', force_update_handler, { passive: true });
        init_event_delegation(overlay_container);

        return true;
    }

    /**
     * Creates the toggle button.
     * @returns {boolean} - True on success.
     */
    function create_ui() {
        var container = document.querySelector('#openwebrx-panel-receiver');
        if (!container) return false;

        if (!document.getElementById('dxcluster-toggle-btn')) {
            var toggleBtn = document.createElement('div');
            toggleBtn.id = 'dxcluster-toggle-btn';
            toggleBtn.textContent = 'DX';
            toggleBtn.title = 'Toggle DX-Cluster Overlay';
            toggleBtn.style.cssText = 'position: absolute; bottom: 3px; left: 4px; z-index: 99; font-size: 12px; font-weight: bold; color: #aaa; cursor: pointer; background: rgba(0,0,0,0.5); padding: 0px 4px; border-radius: 3px; border: 1px solid #666; user-select: none; line-height: 12px; transition: left 0.2s;';
            
            toggleBtn.onclick = function() {
                overlay_enabled = !overlay_enabled;
                localStorage.setItem('dxcluster_overlay_enabled', overlay_enabled);
                update_dxc_button_state();
                if (overlay_enabled) { // If cache is empty, fetch now. Otherwise, force a re-render.
                    if (all_spots_cache.length === 0) {
                        update_all_spots();
                    } else {
                        last_freq_khz = -1;
                        main_loop();
                    }
                } else {
                    clear_spots();
                }
            };
            
            container.appendChild(toggleBtn);

            // Auto-positioning logic
            var dxc_update_pos = function() {
                var btn = document.getElementById('dxcluster-toggle-btn');
                if (!btn) return;
                var cont = document.querySelector('#openwebrx-panel-receiver');
                if (!cont) return;

                var allButtons = Array.from(cont.querySelectorAll('div[id$="-toggle-btn"], div[id$="-btn"], div[id="openwebrx-clock-utc"]'))
                    .filter(b => b.offsetParent !== null);

                // Sort: clock first, then alphabetical.
                allButtons.sort((a, b) => {
                    if (a.id === 'openwebrx-clock-utc') return -1;
                    if (b.id === 'openwebrx-clock-utc') return 1;
                    return a.id.localeCompare(b.id);
                });

                var left = 4;
                for (var i = 0; i < allButtons.length; i++) {
                    var currentBtn = allButtons[i];
                    if (currentBtn.id === btn.id) {
                        break;
                    }
                    var rect = currentBtn.getBoundingClientRect();
                    if (rect.width > 0) {
                        left += rect.width + 4;
                    }
                }

                btn.style.left = left + 'px';
            };
            setInterval(dxc_update_pos, 1000);
            dxc_update_pos();
        }
        return true;
    }

    /**
     * Main loop, checks for view changes and triggers a re-render.
     */
    function main_loop() {
        if (document.hidden) return;
        
        if (typeof UI.getScale === 'function') {
            current_scale = UI.getScale();
        }

        if (typeof window.center_freq === 'undefined' || typeof window.bandwidth === 'undefined') {
            return;
        }

        const center_freq = window.center_freq / 1000;
        const span = window.bandwidth / 1000;

        if (center_freq === last_freq_khz && span === last_span && current_scale === last_scale) {
            return;
        }
        last_freq_khz = center_freq;
        last_span = span;
        last_scale = current_scale;

        if (overlay_enabled) {
            render_spots(all_spots_cache);
        } else {
            clear_spots();
        }
    }

    /**
     * Fetches all DX cluster spots and caches them.
     */
    async function update_all_spots() {
        if (!overlay_enabled) return;

        const url = API_URL_ALL_SPOTS;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`[${PLUGIN_ID}] API request for all spots failed: ${response.status}`);
                return;
            }
            const spotsData = await response.json();

            if (Array.isArray(spotsData)) {
                all_spots_cache = spotsData;
                last_freq_khz = -1;
                main_loop();
            } else {
                all_spots_cache = [];
            }
        } catch (error) {
            console.error(`[${PLUGIN_ID}] Error fetching all spots:`, error);
        }
    }

    /**
     * Sets up delegated event listeners on the overlay container.
     * @param {HTMLElement} container - The overlay container element.
     */
    function init_event_delegation(container) {
        let longPressTriggered = false;
        let pressTimer = null;
        let startX = 0, startY = 0;

        const get_marker = (e) => e.target.closest('.dxcluster-marker');

        const startPress = (e) => {
            const marker = get_marker(e);
            if (!marker) return;

            if (e.touches && e.touches.length === 1) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            }
            longPressTriggered = false;
            pressTimer = setTimeout(() => {
                longPressTriggered = true;
                const popup = show_spot_details_popup(marker, marker.dataset.tooltip);
                if (popup) popup.dataset.source = 'longpress';
            }, 500);
        };

        const cancelPress = (e) => {
            if (pressTimer) clearTimeout(pressTimer);
            if (e && e.type === 'touchmove' && e.touches && e.touches.length === 1) {
                if (Math.abs(e.touches[0].clientX - startX) > 10 || Math.abs(e.touches[0].clientY - startY) > 10) {
                    if (pressTimer) clearTimeout(pressTimer);
                }
            }
        };

        container.addEventListener('mouseover', (e) => {
            const marker = get_marker(e);
            if (!marker) return;

            const existing = document.getElementById('dxcluster-spot-popup');
            if (existing && existing.dataset.source === 'longpress') return;
            const popup = show_spot_details_popup(marker, marker.dataset.tooltip);
            if (popup) popup.dataset.source = 'hover';
        });

        container.addEventListener('mouseout', (e) => {
            const marker = get_marker(e);
            if (!marker) return;

            const existing = document.getElementById('dxcluster-spot-popup');
            if (existing && existing.dataset.source === 'hover') {
                existing.remove();
            }
        });

        container.addEventListener('click', (e) => {
            const marker = get_marker(e);
            if (!marker || longPressTriggered) {
                e.stopPropagation();
                return;
            }
            e.stopPropagation();
            const freq = parseFloat(marker.dataset.freq);
            if (freq && typeof UI !== 'undefined' && typeof UI.setFrequency === 'function') {
                UI.setFrequency(freq * 1000);
            }
        });

        container.addEventListener('contextmenu', e => e.preventDefault());
        container.addEventListener('mousedown', startPress);
        container.addEventListener('mouseup', cancelPress);
        container.addEventListener('touchstart', startPress, { passive: true });
        container.addEventListener('touchend', cancelPress);
        container.addEventListener('touchmove', cancelPress);
    }

    /**
     * Shows a popup with spot details.
     * @param {HTMLElement} targetElement The element to anchor the popup to.
     * @param {string} text The text content for the popup.
     */
    function show_spot_details_popup(targetElement, text) {
        const existing = document.getElementById('dxcluster-spot-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.id = 'dxcluster-spot-popup';
        popup.style.cssText = `
            position: fixed;
            background: rgba(0, 0, 0, 0.85);
            border: 1px solid #888;
            color: #eee;
            z-index: 10001;
            border-radius: 5px;
            padding: 8px;
            font-family: sans-serif;
            font-size: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.5);
            max-width: 250px;
            white-space: pre-wrap;
            pointer-events: auto;
        `;
        popup.innerHTML = text.replace(/\n/g, '<br>');

        document.body.appendChild(popup);

        const rect = targetElement.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();

        let top = rect.top - popupRect.height - 5;
        if (top < 5) { top = rect.bottom + 5; }

        let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
        if (left < 5) left = 5;
        if (left + popupRect.width > window.innerWidth - 5) { left = window.innerWidth - popupRect.width - 5; }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;

        return popup;
    }

    /**
     * Triggers a 3-blink animation on a marker element.
     * @param {HTMLElement} marker - The marker element to blink.
     */
    function blink_marker(marker) {
        let blink_count = 0;
        const max_blinks = 3;
        const blink_interval = 150; // ms

        const blink = () => {
            if (blink_count >= max_blinks * 2) {
                marker.style.opacity = '1';
                return;
            }
            marker.style.opacity = marker.style.opacity === '0' ? '1' : '0';
            blink_count++;
            setTimeout(blink, blink_interval);
        };
        blink();
    }

    /**
     * Renders spots on the waterfall overlay.
     * @param {Array} spots - An array of spot objects.
     */
    function render_spots(spots) {
        if (!overlay_container || !spots || !Array.isArray(spots) || spots.length === 0) {
            clear_spots();
            return;
        }

        clear_spots();

    const view_span = last_span / last_scale;
    const view_start_freq = last_freq_khz - view_span / 2;
    const view_end_freq = last_freq_khz + view_span / 2;

        const in_band = BANDS.some(band => view_start_freq <= band.end && view_end_freq >= band.start);
        if (!in_band) return;

        const now = Date.now();
        const minTime = now - MAX_SPOT_AGE_MS;

        // Clean up blinked_spots for old spots
        blinked_spots.forEach(spotId => {
            const [freq, time] = spotId.split('|');
            if (parseInt(time) < minTime) {
                blinked_spots.delete(spotId);
            }
        });

        const visible_spots = spots.filter(spot => {
            const timestampStr = spot.when || spot.timestamp;
            if (!timestampStr) return false;
            const spot_time = new Date(timestampStr).getTime();
            if (spot_time < minTime) return false;

            const spot_freq = parseFloat(spot.frequency);
            return spot_freq >= view_start_freq && spot_freq <= view_end_freq;
        });
        
        visible_spots.sort((a, b) => parseFloat(a.frequency) - parseFloat(b.frequency));

        let level_end_x = [-1000, -1000, -1000]; // Tracks end x-pos for each of the 3 levels
        const marker_width_estimate = 80; // A generous estimate for overlap detection

        visible_spots.forEach((spot, index) => {
            const spot_freq = parseFloat(spot.frequency);
            const x_pos = freqToX(spot_freq);

            if (x_pos < 0) return;

            const marker = document.createElement('div');
            marker.className = 'dxcluster-marker';

            const dx_call = spot.dx_call || spot.spotted;
            const de_call = spot.de_call || spot.spotter;
            const comment = spot.comment || spot.message;

            marker.textContent = dx_call;
            marker.dataset.tooltip = `${dx_call} spotted by ${de_call} on ${spot.frequency} kHz\n${comment || ''}`;
            marker.dataset.freq = spot.frequency;

            // --- Smart Label Placement ---
            let current_level = 0;
            for (let i = 0; i < level_end_x.length; i++) {
                if (x_pos - (marker_width_estimate / 2) > level_end_x[i]) {
                    current_level = i;
                    break;
                }
                if (i === level_end_x.length - 1) {
                    current_level = (current_level + 1) % level_end_x.length;
                }
            }
            const top_offset = (5 + current_level * 20) + 'px';

            const timestampStr = spot.when || spot.timestamp;
            const spot_time = new Date(timestampStr).getTime();
            const is_new = (now - spot_time < 6 * 60 * 1000);
            const border_style = is_new ? '2px solid #39FF14' : '1px solid #666'; // Green border for new spots

            // Center the marker on its x_pos.
            const final_transform = `translateX(-50%)`;
            marker.style.cssText = `
                position: absolute;
                will-change: transform, left;
                top: ${top_offset};
                left: ${x_pos}px;
                transform: ${final_transform};
                transform-origin: center top;
                background: rgba(220, 50, 50, 0.3);
                color: white;
                padding: 1px 4px;
                border-radius: 5px;
                font-size: 11px;
                font-weight: bold;
                white-space: nowrap;
                cursor: pointer;
                z-index: 10;
                pointer-events: all;
                border: ${border_style};
                box-sizing: border-box;
                box-shadow: 0 0 5px black;
            `;

            // Update the end position for the chosen level.
            level_end_x[current_level] = x_pos + (marker_width_estimate / 2);

            overlay_container.appendChild(marker);

            // Trigger blink animation for new spots that haven't blinked yet
            if (is_new) {
                const spot_id = `${spot.frequency}|${spot_time}`;
                if (!blinked_spots.has(spot_id)) {
                    blinked_spots.add(spot_id);
                    blink_marker(marker);
                }
            }
        });
    }

    /**
     * Removes all spot markers.
     */
    function clear_spots() {
        if (overlay_container) {
            overlay_container.innerHTML = '';
        }
    }

    /**
     * Updates the toggle button color.
     */
    function update_dxc_button_state() {
        var btn = document.getElementById('dxcluster-toggle-btn');
        if (!btn) return;
        if (overlay_enabled) {
            btn.style.color = '#39FF14';
            btn.style.borderColor = '#39FF14';
        } else {
            btn.style.color = '#aaa';
            btn.style.borderColor = '#666';
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('load', init);
    }

    Plugins.dxcluster = { no_css: true };
})();
