/**
 * dxcluster.js
 * 
 * An OpenWebRX+ plugin to display DX Cluster spots on the waterfall
 * and in an interactive floating mini-window.
 * Uses the new OpenWebRX ext-windows Plugin API (Plugins.addButton & Plugins.addWindow).
 * 
 * License: MIT 
 * Copyright (c) 2026 dl1hqh
 */

(function() {
    'use strict';

    const PLUGIN_ID = "dxcluster";
    console.log(`[${PLUGIN_ID}] Plugin loading...`);

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

    let last_freq_khz = -1;
    let last_span = -1;
    let last_scale = -1;
    let overlay_enabled = false;
    let filter_visible_only = true;
    let hook_attempts = 0;
    let all_spots_cache = [];
    let overlay_container = null;
    let current_scale = 1.0;
    let blinked_spots = new Set();
    let window_created = false;
    let plugin_button = null;

    function freqToX(frequency) {
        if (!overlay_container || overlay_container.clientWidth <= 0) return -1;
        const view_span = last_span / last_scale;
        const view_start_freq = last_freq_khz - view_span / 2;
        if (view_span <= 0) return -1;
        return (frequency - view_start_freq) / view_span * overlay_container.clientWidth;
    }

    function init() {
        const savedOverlay = localStorage.getItem('dxcluster_overlay_enabled');
        if (savedOverlay !== null) {
            overlay_enabled = (savedOverlay === 'true');
        } else {            
            overlay_enabled = true; // Default to enabled
        }

        const savedFilter = localStorage.getItem('dxcluster_filter_visible_only');
        if (savedFilter !== null) {
            filter_visible_only = (savedFilter === 'true');
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
        update_button_state();
    }

    function create_ui() {
        if (typeof Plugin !== 'undefined' && typeof Plugins.addButton === 'function') {
            if (!plugin_button) {
                plugin_button = Plugins.addButton(PLUGIN_ID, 'DX', on_plugin_button_click);
            }
            if (!window_created) {
                create_mini_window();
            }
            return true;
        }

        return create_fallback_ui();
    }

    function on_plugin_button_click() {
        if (!window_created) {
            create_mini_window();
        }
        if (typeof Plugin !== 'undefined' && typeof Plugins.toggleWindow === 'function') {
            Plugins.toggleWindow(PLUGIN_ID);
        } else {
            const win = document.getElementById('plugin-window-' + PLUGIN_ID);
            if (win) {
                win.style.display = (win.style.display === 'none' || !win.style.display) ? 'flex' : 'none';
            }
        }
        render_window_spots();
    }

    let sort_by = 'time'; // 'time', 'freq', 'dx', 'de'
    let sort_dir = 'desc'; // 'desc' = newest first for time

    function create_mini_window() {
        if (window_created) return;

        const windowHtml = `
            <div id="dxcluster-window-container" style="display: flex; flex-direction: column; height: 100%; width: 100%; box-sizing: border-box; font-family: sans-serif; font-size: 12px; color: #ddd;">
                <!-- Toolbar -->
                <div id="dxcluster-toolbar" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; background: rgba(0,0,0,0.3); border-radius: 4px; margin-bottom: 6px; gap: 8px; flex-shrink: 0;">
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none;">
                        <input type="checkbox" id="dxcluster-chk-overlay" ${overlay_enabled ? 'checked' : ''} style="cursor: pointer; margin: 0;">
                        <span>Waterfall overlay</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; user-select: none;">
                        <input type="checkbox" id="dxcluster-chk-visible-only" ${filter_visible_only ? 'checked' : ''} style="cursor: pointer; margin: 0;">
                        <span>Visible band only</span>
                    </label>
                    <div style="margin-left: auto; display: flex; align-items: center; gap: 6px;">
                        <span id="dxcluster-spot-count" style="color: #aaa; font-size: 11px;">0 spots</span>
                        <button id="dxcluster-btn-refresh" title="Reload spots" style="cursor: pointer; background: #333; color: #fff; border: 1px solid #666; border-radius: 3px; padding: 1px 6px; font-size: 11px;">⟳</button>
                    </div>
                </div>

                <!-- Spot Table Container -->
                <div id="dxcluster-table-scroll" style="flex: 1; overflow-y: auto; overflow-x: hidden; border: 1px solid #444; border-radius: 3px; background: rgba(0,0,0,0.25);">
                    <table id="dxcluster-table" style="width: 100%; border-collapse: collapse; font-family: monospace; font-size: 11px; text-align: left;">
                        <thead style="position: sticky; top: 0; background: #333; color: #bbb; z-index: 2; user-select: none;">
                            <tr>
                                <th data-sort="freq" style="padding: 4px 6px; border-bottom: 1px solid #555; cursor: pointer;" title="Sort by frequency">kHz <span class="sort-indicator" id="dxcluster-sort-freq"></span></th>
                                <th data-sort="dx" style="padding: 4px 6px; border-bottom: 1px solid #555; cursor: pointer;" title="Sort by DX callsign">DX <span class="sort-indicator" id="dxcluster-sort-dx"></span></th>
                                <th data-sort="de" style="padding: 4px 6px; border-bottom: 1px solid #555; cursor: pointer;" title="Sort by spotter">Spotter <span class="sort-indicator" id="dxcluster-sort-de"></span></th>
                                <th data-sort="time" style="padding: 4px 6px; border-bottom: 1px solid #555; cursor: pointer;" title="Sort by time">Time <span class="sort-indicator" id="dxcluster-sort-time">▼</span></th>
                                <th style="padding: 4px 6px; border-bottom: 1px solid #555; width: 35%;">Comment</th>
                            </tr>
                        </thead>
                        <tbody id="dxcluster-table-body">
                            <tr><td colspan="5" style="padding: 10px; text-align: center; color: #888;">Loading spots...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        let winElem = null;
        if (typeof Plugin !== 'undefined' && typeof Plugins.addWindow === 'function') {
            winElem = Plugins.addWindow(PLUGIN_ID, 'DX Cluster', windowHtml);
        }

        if (winElem) {
            if (typeof LS !== 'undefined') {
                const name = 'plugin_' + PLUGIN_ID;
                if (!LS.has(name + '_w')) {
                    winElem.style.width = '440px';
                }
                if (!LS.has(name + '_h')) {
                    winElem.style.height = '300px';
                }
            }
        }

        setTimeout(() => {
            const chkOverlay = document.getElementById('dxcluster-chk-overlay');
            if (chkOverlay) {
                chkOverlay.addEventListener('change', (e) => {
                    overlay_enabled = e.target.checked;
                    localStorage.setItem('dxcluster_overlay_enabled', overlay_enabled);
                    update_button_state();
                    if (overlay_enabled) {
                        last_freq_khz = -1;
                        main_loop();
                    } else {
                        clear_spots();
                    }
                });
            }

            const chkVisible = document.getElementById('dxcluster-chk-visible-only');
            if (chkVisible) {
                chkVisible.addEventListener('change', (e) => {
                    filter_visible_only = e.target.checked;
                    localStorage.setItem('dxcluster_filter_visible_only', filter_visible_only);
                    render_window_spots();
                });
            }

            const btnRefresh = document.getElementById('dxcluster-btn-refresh');
            if (btnRefresh) {
                btnRefresh.addEventListener('click', () => {
                    update_all_spots();
                });
            }

            const table = document.getElementById('dxcluster-table');
            if (table) {
                const thead = table.querySelector('thead');
                if (thead) {
                    thead.addEventListener('click', (e) => {
                        const th = e.target.closest('th[data-sort]');
                        if (!th) return;
                        const col = th.dataset.sort;
                        if (sort_by === col) {
                            sort_dir = (sort_dir === 'asc') ? 'desc' : 'asc';
                        } else {
                            sort_by = col;
                            sort_dir = (col === 'time') ? 'desc' : 'asc';
                        }
                        update_sort_indicators();
                        render_window_spots();
                    });
                }
            }

            const tableBody = document.getElementById('dxcluster-table-body');
            if (tableBody) {
                tableBody.addEventListener('click', (e) => {
                    const row = e.target.closest('tr[data-freq]');
                    if (!row) return;
                    const freq = parseFloat(row.dataset.freq);
                    const call = row.dataset.call || '';
                    if (freq && typeof UI !== 'undefined' && typeof UI.setFrequency === 'function') {
                        UI.setFrequency(freq * 1000);
                        if (typeof UI.showBubble === 'function' && call) {
                            UI.showBubble(`${call} ➔ ${freq} kHz`);
                        }
                    }
                });
            }

            update_sort_indicators();
        }, 100);

        window_created = true;
    }

    function update_sort_indicators() {
        ['freq', 'dx', 'de', 'time'].forEach(col => {
            const el = document.getElementById('dxcluster-sort-' + col);
            if (!el) return;
            if (sort_by === col) {
                el.textContent = (sort_dir === 'asc') ? '▲' : '▼';
                el.style.color = '#39FF14';
            } else {
                el.textContent = '';
            }
        });
    }

    function create_fallback_ui() {
        const container = document.querySelector('#openwebrx-panel-receiver');
        if (!container) return false;

        if (!document.getElementById('dxcluster-toggle-btn')) {
            const toggleBtn = document.createElement('div');
            toggleBtn.id = 'dxcluster-toggle-btn';
            toggleBtn.textContent = 'DX';
            toggleBtn.title = 'Toggle DX-Cluster Overlay';
            toggleBtn.style.cssText = 'position: absolute; bottom: 3px; left: 4px; z-index: 99; font-size: 12px; font-weight: bold; color: #aaa; cursor: pointer; background: rgba(0,0,0,0.5); padding: 0px 4px; border-radius: 3px; border: 1px solid #666; user-select: none; line-height: 12px; transition: left 0.2s;';
            
            toggleBtn.onclick = function() {
                overlay_enabled = !overlay_enabled;
                localStorage.setItem('dxcluster_overlay_enabled', overlay_enabled);
                update_button_state();
                if (overlay_enabled) {
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

            const dxc_update_pos = function() {
                const btn = document.getElementById('dxcluster-toggle-btn');
                if (!btn) return;
                const cont = document.querySelector('#openwebrx-panel-receiver');
                if (!cont) return;

                const allButtons = Array.from(cont.querySelectorAll('div[id$="-toggle-btn"], div[id$="-btn"], div[id="openwebrx-clock-utc"]'))
                    .filter(b => b.offsetParent !== null);

                allButtons.sort((a, b) => {
                    if (a.id === 'openwebrx-clock-utc') return -1;
                    if (b.id === 'openwebrx-clock-utc') return 1;
                    return a.id.localeCompare(b.id);
                });

                let left = 4;
                for (let i = 0; i < allButtons.length; i++) {
                    const currentBtn = allButtons[i];
                    if (currentBtn.id === btn.id) break;
                    const rect = currentBtn.getBoundingClientRect();
                    if (rect.width > 0) left += rect.width + 4;
                }
                btn.style.left = left + 'px';
            };
            setInterval(dxc_update_pos, 1000);
            dxc_update_pos();
        }
        return true;
    }

    function render_window_spots() {
        const tableBody = document.getElementById('dxcluster-table-body');
        const countSpan = document.getElementById('dxcluster-spot-count');
        if (!tableBody) return;

        const now = Date.now();
        const minTime = now - MAX_SPOT_AGE_MS;

        const view_span = (last_span > 0 && last_scale > 0) ? (last_span / last_scale) : 0;
        const view_start_freq = last_freq_khz - view_span / 2;
        const view_end_freq = last_freq_khz + view_span / 2;

        let spots = all_spots_cache.filter(spot => {
            const timestampStr = spot.when || spot.timestamp;
            if (!timestampStr) return false;
            const spot_time = new Date(timestampStr).getTime();
            return spot_time >= minTime;
        });

        if (filter_visible_only && view_span > 0) {
            spots = spots.filter(spot => {
                const freq = parseFloat(spot.frequency);
                return freq >= view_start_freq && freq <= view_end_freq;
            });
        }

        spots.sort((a, b) => {
            let res = 0;
            if (sort_by === 'time') {
                const timeA = new Date(a.when || a.timestamp || 0).getTime();
                const timeB = new Date(b.when || b.timestamp || 0).getTime();
                res = timeA - timeB;
            } else if (sort_by === 'freq') {
                res = parseFloat(a.frequency || 0) - parseFloat(b.frequency || 0);
            } else if (sort_by === 'dx') {
                const dxA = (a.dx_call || a.spotted || '').toUpperCase();
                const dxB = (b.dx_call || b.spotted || '').toUpperCase();
                res = dxA.localeCompare(dxB);
            } else if (sort_by === 'de') {
                const deA = (a.de_call || a.spotter || '').toUpperCase();
                const deB = (b.de_call || b.spotter || '').toUpperCase();
                res = deA.localeCompare(deB);
            }
            return (sort_dir === 'desc') ? -res : res;
        });

        if (countSpan) {
            countSpan.textContent = `${spots.length} spots${filter_visible_only ? ' (visible)' : ''}`;
        }

        if (spots.length === 0) {
            const noSpotsMsg = filter_visible_only ? 'No spots in visible range' : 'No spots available';
            tableBody.innerHTML = `<tr><td colspan="5" style="padding: 10px; text-align: center; color: #888;">${noSpotsMsg}</td></tr>`;
            return;
        }

        let html = '';
        spots.forEach((spot, index) => {
            const dx_call = Utils.htmlEscape ? Utils.htmlEscape(spot.dx_call || spot.spotted || '') : (spot.dx_call || spot.spotted || '');
            const de_call = Utils.htmlEscape ? Utils.htmlEscape(spot.de_call || spot.spotter || '') : (spot.de_call || spot.spotter || '');
            const comment = Utils.htmlEscape ? Utils.htmlEscape(spot.comment || spot.message || '') : (spot.comment || spot.message || '');
            const freq = parseFloat(spot.frequency).toFixed(1);

            const timestampStr = spot.when || spot.timestamp;
            const spotDate = new Date(timestampStr);
            const spot_time = spotDate.getTime();
            const ageMinutes = Math.max(0, Math.round((now - spot_time) / 60000));
            const is_new = (now - spot_time < 6 * 60 * 1000);

            let timeStr = `${ageMinutes}m`;
            if (!isNaN(spot_time)) {
                const hh = String(spotDate.getUTCHours()).padStart(2, '0');
                const mm = String(spotDate.getUTCMinutes()).padStart(2, '0');
                timeStr = `${hh}:${mm}z (${ageMinutes}m)`;
            }

            const rowBg = index % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent';
            const callColor = is_new ? '#39FF14' : '#fff';

            html += `
                <tr data-freq="${spot.frequency}" data-call="${dx_call}" style="background: ${rowBg}; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); transition: background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='${rowBg}'" title="Click to tune to ${freq} kHz (${dx_call})">
                    <td style="padding: 3px 6px; color: #4dc3ff; font-weight: bold;">${freq}</td>
                    <td style="padding: 3px 6px; color: ${callColor}; font-weight: bold; text-decoration: underline dotted;" title="Click to tune to ${dx_call}">${dx_call}</td>
                    <td style="padding: 3px 6px; color: #aaa;">${de_call}</td>
                    <td style="padding: 3px 6px; color: #888; white-space: nowrap;">${timeStr}</td>
                    <td style="padding: 3px 6px; color: #ccc; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${comment}">${comment || '-'}</td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;
    }

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

    function create_overlay() {
        const waterfall_container = document.querySelector('#webrx-canvas-container');
        if (!waterfall_container) return false;

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

        const force_update_handler = function() {
            last_freq_khz = -1;
            setTimeout(main_loop, 100);
        };
        waterfall_container.addEventListener('wheel', force_update_handler, { passive: true });
        waterfall_container.addEventListener('mouseup', force_update_handler, { passive: true });
        waterfall_container.addEventListener('touchend', force_update_handler, { passive: true });
        waterfall_container.addEventListener('touchcancel', force_update_handler, { passive: true });
        init_event_delegation(overlay_container);

        return true;
    }

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

        if (filter_visible_only) {
            render_window_spots();
        }
    }

    async function update_all_spots() {
        const url = API_URL_ALL_SPOTS;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`[${PLUGIN_ID}] API request for spots failed: ${response.status}`);
                return;
            }
            const spotsData = await response.json();

            if (Array.isArray(spotsData)) {
                all_spots_cache = spotsData;
                last_freq_khz = -1;
                main_loop();
                render_window_spots();
            } else {
                all_spots_cache = [];
            }
        } catch (error) {
            console.error(`[${PLUGIN_ID}] Error fetching spots:`, error);
        }
    }

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
        if (top < 5) top = rect.bottom + 5;

        let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
        if (left < 5) left = 5;
        if (left + popupRect.width > window.innerWidth - 5) left = window.innerWidth - popupRect.width - 5;

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;

        return popup;
    }

    function blink_marker(marker) {
        let blink_count = 0;
        const max_blinks = 3;
        const blink_interval = 150;

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

        blinked_spots.forEach(spotId => {
            const [, time] = spotId.split('|');
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

        let level_end_x = [-1000, -1000, -1000];
        const marker_width_estimate = 80;

        visible_spots.forEach((spot) => {
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
            const border_style = is_new ? '2px solid #39FF14' : '1px solid #666';

            marker.style.cssText = `
                position: absolute;
                will-change: transform, left;
                top: ${top_offset};
                left: ${x_pos}px;
                transform: translateX(-50%);
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

            level_end_x[current_level] = x_pos + (marker_width_estimate / 2);
            overlay_container.appendChild(marker);

            if (is_new) {
                const spot_id = `${spot.frequency}|${spot_time}`;
                if (!blinked_spots.has(spot_id)) {
                    blinked_spots.add(spot_id);
                    blink_marker(marker);
                }
            }
        });
    }

    function clear_spots() {
        if (overlay_container) {
            overlay_container.innerHTML = '';
        }
    }

    function update_button_state() {
        const fallbackBtn = document.getElementById('dxcluster-toggle-btn');
        if (fallbackBtn) {
            if (overlay_enabled) {
                fallbackBtn.style.color = '#39FF14';
                fallbackBtn.style.borderColor = '#39FF14';
            } else {
                fallbackBtn.style.color = '#aaa';
                fallbackBtn.style.borderColor = '#666';
            }
        }

        const chkOverlay = document.getElementById('dxcluster-chk-overlay');
        if (chkOverlay) {
            chkOverlay.checked = overlay_enabled;
        }
    }

    window.DxClusterPlugin = {
        myname: PLUGIN_ID,
        init: init,
        toggle: on_plugin_button_click
    };

    if (typeof Plugins !== 'undefined') {
        Plugins.dxcluster = {
            no_css: true,
            init: function() {
                init();
                return true;
            }
        };
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('load', init);
    }

})();
