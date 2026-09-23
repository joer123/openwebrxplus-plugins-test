// OpenWebRX+ plugin: radial mode selector for analog modes.

(function () {
    'use strict';

    var MODE_SELECTOR_ID = 'mode-selector';
    var state = {
        button: null,
        menu: null,
        buttonHost: null,
        modesPanel: null,
        receiverPanel: null,
        section: null,
        digitalRow: null,
        modes: [],
        open: false,
        initialized: false,
        syncTimer: null
    };

    function getModes() {
        if (typeof Modes === 'undefined' || typeof Modes.getModes !== 'function')
            return [];

        return Modes.getModes().filter(function (mode) {
            if (!mode || !mode.modulation || !mode.name) return false;

            return !!document.querySelector(
                '#openwebrx-panel-receiver .openwebrx-modes ' +
                '.openwebrx-demodulator-button[data-modulation="' +
                mode.modulation + '"]'
            );
        });
    }

    function getCurrentMode() {
        if (typeof UI === 'undefined' || typeof UI.getModulation !== 'function')
            return '';
        return UI.getModulation() || '';
    }

    function getCurrentUnderlying() {
        if (typeof UI === 'undefined' || typeof UI.getUnderlying !== 'function')
            return '';
        return UI.getUnderlying() || '';
    }

    function hideOriginalControls() {
        var modesPanel = document.querySelector('#openwebrx-panel-receiver .openwebrx-modes');
        if (!modesPanel) return;

        modesPanel.querySelectorAll('.openwebrx-modes-grid .openwebrx-demodulator-button')
            .forEach(function (element) {
                element.dataset.modeSelectorHidden = 'true';
                element.style.display = 'none';
            });
    }

    function restoreOriginalControls() {
        document.querySelectorAll('[data-mode-selector-hidden="true"]')
            .forEach(function (element) {
                element.style.display = '';
                delete element.dataset.modeSelectorHidden;
            });
    }

    function createModeButton(mode) {
        var item = document.createElement('button');

        item.type = 'button';
        item.className = 'openwebrx-button mode-selector-item';
        item.dataset.modulation = mode.modulation;
        item.textContent = mode.name;
        item.title = mode.type === 'digimode' ?
            mode.name + ' (digital mode)' : mode.name;
        item.addEventListener('click', function (event) {
            event.stopPropagation();
            selectMode(mode);
        });
        return item;
    }

    function renderMenu() {
        if (!state.menu) return;
        state.menu.innerHTML = '';
        state.modes = getModes();

        var lsb = state.modes.find(function (mode) {
            return mode.modulation === 'lsb';
        });
        var usb = state.modes.find(function (mode) {
            return mode.modulation === 'usb';
        });
        var hdr = state.modes.find(function (mode) {
            return mode.modulation === 'hdr';
        });
        var reserved = ['lsb', 'usb', 'hdr'];
        var remaining = state.modes.filter(function (mode) {
            return reserved.indexOf(mode.modulation) < 0;
        });

        function appendRow(rowModes, special) {
            if (!rowModes.length) return;

            var row = document.createElement('div');
            row.className = 'mode-selector-row';
            if (special) row.classList.add('mode-selector-special-row');
            if (special) {
                row.style.gridTemplateColumns = 'minmax(0, 1fr) 82px minmax(0, 1fr)';
            } else if (rowModes.length < 4) {
                row.classList.add('mode-selector-bottom-row');
                row.style.gridTemplateColumns = 'repeat(' + rowModes.length + ', minmax(0, 1fr))';
            }

            rowModes.forEach(function (mode) {
                if (mode) {
                    row.appendChild(createModeButton(mode));
                    return;
                }

                var hole = document.createElement('div');
                hole.className = 'mode-selector-hole';
                row.appendChild(hole);
            });
            state.menu.appendChild(row);
        }

        appendRow(remaining.slice(0, 4), false);

        var specialRow = [];
        if (lsb) specialRow.push(lsb);
        specialRow.push(null);
        if (usb) specialRow.push(usb);
        appendRow(specialRow, true);

        var tail = remaining.slice(4);
        if (hdr) tail.push(hdr);
        for (var index = 0; index < tail.length; index += 4)
            appendRow(tail.slice(index, index + 4), false);
    }

    function openMenu() {
        if (!state.menu || !state.modes.length) return;
        renderMenu();
        state.open = true;
        if (state.section) state.section.classList.add('mode-selector-menu-open');
        state.menu.classList.add('is-open');
        state.button.classList.add('is-open');
        state.button.setAttribute('aria-expanded', 'true');
    }

    function closeMenu() {
        if (!state.menu || !state.button) return;
        state.open = false;
        if (state.section && state.section.classList.contains('mode-selector-menu-open'))
            state.section.classList.remove('mode-selector-menu-open');
        state.menu.classList.remove('is-open');
        state.button.classList.remove('is-open');
        state.button.setAttribute('aria-expanded', 'false');
    }

    function selectMode(mode) {
        if (typeof UI === 'undefined' || typeof UI.setModulation !== 'function')
            return;

        var underlying;
        if (mode.type === 'digimode') {
            var currentUnderlying = getCurrentUnderlying();
            underlying = mode.underlying.indexOf(currentUnderlying) >= 0 ?
                currentUnderlying : mode.underlying[0];
        }

        UI.setModulation(mode.modulation, underlying);
        closeMenu();
        updateButton();
    }

    function updateButton() {
        if (!state.button) return;

        if (state.open && state.section && state.section.classList.contains('closed'))
            closeMenu();

        var current = getCurrentMode();
        var mode = state.modes.find(function (entry) {
            return entry.modulation === current;
        });
        state.button.textContent = mode ? mode.name : 'MODE';
        state.button.title = mode ? 'Current mode: ' + mode.name : 'Select mode';
        state.button.classList.toggle('has-mode', !!mode);

        if (state.menu) {
            state.menu.querySelectorAll('.mode-selector-item').forEach(function (item) {
                item.classList.toggle('highlighted', item.dataset.modulation === current);
            });
        }
    }

    function restoreUiElements() {
        var currentPanel = document.querySelector('#openwebrx-panel-receiver .openwebrx-modes');
        if (!currentPanel) return;

        if (currentPanel !== state.modesPanel) {
            state.modesPanel = currentPanel;
            currentPanel.classList.add('mode-selector-host');
            var currentSection = currentPanel.closest('.openwebrx-section');
            if (currentSection) {
                currentSection.classList.add('mode-selector-section');
                state.section = currentSection;
            }
        }

        if (!state.modesPanel.contains(state.buttonHost))
            state.modesPanel.appendChild(state.buttonHost);
        if (!state.modesPanel.contains(state.menu)) state.modesPanel.appendChild(state.menu);
        state.button.style.setProperty('display', 'block', 'important');
        state.button.style.setProperty('visibility', 'visible', 'important');
        state.button.style.setProperty('opacity', '1', 'important');

        var digitalButton = state.modesPanel.querySelector('.openwebrx-button-dig');
        var digitalRow = digitalButton && digitalButton.closest('.openwebrx-panel-flex-line');
        if (digitalRow) {
            state.digitalRow = digitalRow;
            digitalRow.classList.add('mode-selector-digital-row');
            if (digitalRow.parentElement !== state.modesPanel)
                state.modesPanel.appendChild(digitalRow);
        }
    }

    function closeOnOutsideClick(event) {
        if (!state.open || !state.menu || !state.button) return;
        if (!state.menu.contains(event.target) && event.target !== state.button)
            closeMenu();
    }

    function injectCss() {
        if (document.getElementById('mode-selector-css')) return;

        var style = document.createElement('style');
        style.id = 'mode-selector-css';
        style.textContent =
            '#mode-selector-menu {' +
            ' display: none; position: absolute; left: 0; right: 0; top: -22px;' +
            ' width: 100%; box-sizing: border-box; padding: 4px;' +
            ' z-index: 10001; background: transparent;' +
            ' }' +
            '#mode-selector-menu::before {' +
            ' content: ""; position: absolute; inset: 0; z-index: 0;' +
            ' background: rgba(0, 0, 24, 0.94); border-radius: 7px;' +
            ' box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35);' +
            ' pointer-events: none;' +
            ' }' +
            '#mode-selector-menu.is-open {' +
            ' display: block;' +
            ' }' +
            '.mode-selector-row {' +
            ' display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));' +
            ' gap: 4px; margin-bottom: 4px; position: relative; z-index: 1;' +
            ' }' +
            '.mode-selector-row:not(.mode-selector-special-row) {' +
            ' top: -10px;' +
            ' }' +
            '.mode-selector-item {' +
            ' width: 100%; min-width: 0; min-height: 30px; padding: 3px 2px;' +
            ' border-radius: 5px; cursor: pointer; font-size: 11px;' +
            ' line-height: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' +
            ' opacity: 1; touch-action: manipulation;' +
            ' transition: filter 120ms ease, color 120ms ease;' +
            ' }' +
            '.mode-selector-hole {' +
            ' min-height: 48px; pointer-events: none;' +
            ' }' +
            '.mode-selector-special-row {' +
            ' min-height: 48px; align-items: center;' +
            ' }' +
            '.mode-selector-special-row .mode-selector-item {' +
            ' position: relative; top: -9px; height: 38px; min-height: 38px;' +
            ' }' +
            '.mode-selector-bottom-row {' +
            ' margin-bottom: 0;' +
            ' }' +
            '.mode-selector-item:hover, .mode-selector-item:focus-visible {' +
            ' filter: saturate(140%) brightness(125%); outline: 2px solid #fff;' +
            ' }' +
            '.mode-selector-trigger {' +
            ' position: relative; z-index: 10002; display: block !important;' +
            ' width: 82px; height: 38px; margin: 0; padding: 0 12px;' +
            ' border-radius: 999px; box-sizing: border-box;' +
            ' font-size: 14px; font-weight: bold; text-align: center;' +
            ' cursor: pointer; user-select: none;' +
            ' transition: background 120ms ease, color 120ms ease, transform 120ms ease;' +
            ' }' +
            '.mode-selector-button-host {' +
            ' position: relative; z-index: 10002; display: flex; align-items: center;' +
            ' justify-content: center; height: 58px; width: 100%;' +
            ' }' +
            '.mode-selector-host {' +
            ' position: relative; min-height: 0;' +
            ' box-sizing: border-box; overflow: visible;' +
            ' }' +
            '.mode-selector-digital-row {' +
            ' position: relative; z-index: 1;' +
            ' }' +
            '.mode-selector-section {' +
            ' overflow: hidden;' +
            ' }' +
            '.mode-selector-section.mode-selector-menu-open {' +
            ' overflow: visible;' +
            ' }';
        document.head.appendChild(style);
    }

    function createUi() {
        if (state.initialized) return true;
        var modesPanel = document.querySelector('#openwebrx-panel-receiver .openwebrx-modes');
        if (!modesPanel)
            return false;
        if (!getModes().length) return false;

        injectCss();
        state.modesPanel = modesPanel;
        state.receiverPanel = document.querySelector('#openwebrx-panel-receiver');
        if (!state.receiverPanel) return false;
        modesPanel.classList.add('mode-selector-host');
        var section = modesPanel.closest('.openwebrx-section');
        if (section) {
            section.classList.add('mode-selector-section');
            state.section = section;
        }
        state.modes = getModes();
        state.button = document.createElement('button');
        state.button.type = 'button';
        state.button.className = 'openwebrx-button mode-selector-trigger';
        state.button.textContent = 'MODE';
        state.button.style.setProperty('display', 'block', 'important');
        state.button.style.setProperty('visibility', 'visible', 'important');
        state.button.style.setProperty('opacity', '1', 'important');
        state.button.addEventListener('click', function () {
            if (state.open) closeMenu();
            else openMenu();
        });
        modesPanel.appendChild(state.button);

        state.buttonHost = document.createElement('div');
        state.buttonHost.className = 'mode-selector-button-host';
        state.buttonHost.appendChild(state.button);
        modesPanel.appendChild(state.buttonHost);

        state.button.setAttribute('role', 'button');
        state.button.setAttribute('aria-haspopup', 'true');
        state.button.setAttribute('aria-expanded', 'false');

        state.menu = document.createElement('div');
        state.menu.id = 'mode-selector-menu';
        modesPanel.appendChild(state.menu);

        state.digitalRow = modesPanel.querySelector('.openwebrx-button-dig') &&
            modesPanel.querySelector('.openwebrx-button-dig').closest('.openwebrx-panel-flex-line');
        if (state.digitalRow) {
            state.digitalRow.classList.add('mode-selector-digital-row');
            modesPanel.appendChild(state.digitalRow);
        }

        hideOriginalControls();
        document.addEventListener('mousedown', closeOnOutsideClick);
        document.addEventListener('touchstart', closeOnOutsideClick, { passive: true });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') closeMenu();
        });
        state.initialized = true;
        updateButton();
        state.syncTimer = setInterval(function () {
            restoreUiElements();
            hideOriginalControls();
            updateButton();
        }, 500);
        return true;
    }

    Plugins.mode_selector = {
        no_css: true,
        name: 'Mode Selector',
        description: 'Select analog demodulation modes from one radial button',
        version: '1.0.0',
        init: function () {
            if (createUi()) return true;
            var attempts = 0;
            var retry = setInterval(function () {
                if (createUi() || ++attempts >= 40) clearInterval(retry);
            }, 250);
            return true;
        }
    };
})();
