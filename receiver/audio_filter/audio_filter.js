/**
 * audio_filter.js
 * A plugin concept for OpenWebRX+ to improve audio quality (SSB, AM & Digital).
 * Features: EQ, Noise Blanker, Hang-AGC/Compressor, Auto-Notch.
 * 
 * License: MIT
 * Copyright (c) 2025 DL1HQH
 */

(function() {
    'use strict';

    const PLUGIN_ID = "audio_filter";
    console.log(`[${PLUGIN_ID}] Plugin loaded and ready.`);

    // Configuration for different modulations
    const CONFIG = {
        ssb: {
            highpassFreq: 115,
            lowpassFreq: 3500,  // Treble optimized for SSB
            peakingFreq: 2000,  // Shifted to 2000Hz for more presence
            peakingQ: 1.0,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 20.0,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 300,
            compLPF: 3000,
            nr_gain: 5,         // dB
            nr_alpha: 0.95,
            nr_snr: 12,         // dB
            nr_comb: 0.0,
            nr_speech_mode: true,
            airGain: 9.0,
            airFreq: 3000
        },
        am: {
            highpassFreq: 50,   // (Full warmth for tube sound)
            lowpassFreq: 4000,  // Treble rolled off (Vintage radio style)
            peakingFreq: 600,   // Boost low-mids for body/warmth
            peakingQ: 1.0,
            peakingGain: 5.0,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 20.0,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 300,
            compLPF: 4000,
            nr_gain: 10,
            nr_alpha: 0.99,     // Very slow/smooth tracking (Liquid background)
            nr_snr: 18,         // Higher threshold to kill background noise completely
            nr_comb: 0.2,       // Low comb factor for smooth, non-robotic sound
            nr_speech_mode: true,
            airFreq: 4000
        },
        cw: {
            highpassFreq: 300,
            lowpassFreq: 900,   // Narrow bandwidth for CW
            peakingFreq: 600,   // Center around typical pitch
            peakingQ: 3.0,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.40,
            maxBoost: 20.0,
            notchQ: 40,
            maxNotches: 4,
            compHPF: 400,
            compLPF: 1500,
            nr_gain: 0,
            nr_alpha: 0.9800,
            nr_snr: 30,
            nr_comb: 0.5,
            nr_speech_mode: false,
            airFreq: 1500
        },
        nfm: {
            highpassFreq: 50,
            lowpassFreq: 11100,
            peakingFreq: 2500,
            peakingQ: 0.7,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 20.0,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 250,
            compLPF: 5000,
            nr_gain: 0,
            nr_alpha: 0.9800,
            nr_snr: 30,
            nr_comb: 0.5,
            nr_speech_mode: true,
            airFreq: 5000
        },
        wfm: {
            highpassFreq: 50,
            lowpassFreq: 11100,
            peakingFreq: 8000,
            peakingQ: 0.5,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 6.0,      // Low boost for WFM
            notchQ: 30,
            maxNotches: 4,
            compHPF: 100,
            compLPF: 8000,
            nr_gain: 0,
            nr_alpha: 0.95,
            nr_snr: 10,
            nr_comb: 0.5,
            nr_speech_mode: false,
            airFreq: 8000
        },
        digital: {
            highpassFreq: 50,
            lowpassFreq: 11100,
            peakingFreq: 2500,
            peakingQ: 0.7,
            peakingGain: 3.3,
            gain: 0.9,
            agcTarget: 0.50,
            maxBoost: 20.0,
            notchQ: 30,
            maxNotches: 4,
            compHPF: 50,
            compLPF: 8000,
            nr_gain: 0,
            nr_alpha: 0.95,
            nr_snr: 10,
            nr_comb: 0.5,
            nr_speech_mode: false,
            airFreq: 8000
        }
    };

    // References to filter nodes for updating
    let activeFilters = {
        highpass: null,
        lowpass: null,
        nbProcessor: null,
        nrProcessor: null,
        compProcessor: null,
        loudness: null,
        air: null,
        compHighpass: null,
        compLowpass: null,
        peaking: null,
        gain: null,
        analyser: null,
        outputAnalyser: null,
        notches: []
    };
    let analysisBuffer = null;
    let last_modulation = '';
    let is_filter_enabled = false;
    let is_nb_enabled = false;
    let is_nr_enabled = false;
    let is_compressor_enabled = false;
    let is_autonotch_enabled = false;
    let is_loudness_enabled = false;
    let show_input_spectrum = localStorage.getItem('openwebrx-audio-filter-show-in-spec') !== 'false';
    let show_output_spectrum = localStorage.getItem('openwebrx-audio-filter-show-out-spec') !== 'false';

    const SETTING_KEYS = [
        'highpassFreq', 'lowpassFreq', 'peakingGain', 'peakingFreq', 'peakingQ', 'gain', 
        'agcTarget', 'maxBoost', 'gateThresh', 'hangTime', 'recoveryTime', 'compGain', 
        'notchQ', 'maxNotches', 'notchRange', 'notchCenter', 'compHPF', 'compLPF',
        'airGain', 'airFreq', 'nr_gain', 'nr_alpha', 'nr_snr', 'nr_comb', 'nr_speech_mode'
    ];

    function create_empty_settings() {
        return SETTING_KEYS.reduce((acc, key) => { acc[key] = null; return acc; }, {});
    }

    let override_settings = create_empty_settings();
    
    let settings_store = {
        ssb: create_empty_settings(),
        am: create_empty_settings(),
        cw: create_empty_settings(),
        nfm: create_empty_settings(),
        wfm: create_empty_settings(),
        digital: create_empty_settings()
    };

    function get_config_mode(mod) {
        if (!mod) return 'ssb';
        mod = String(mod).toLowerCase();
        if (mod === 'am') return 'am';
        if (mod === 'cw') return 'cw';
        if (mod === 'nfm' || mod === 'fm') return 'nfm';
        if (mod === 'wfm') return 'wfm';
        if (['dmr', 'ysf', 'dstar', 'nxdn', 'm17', 'p25', 'freedv'].includes(mod)) return 'digital';
        return 'ssb'; // lsb, usb, etc.
    }

    function saveSettings() {
        let modKey = get_config_mode(last_modulation);
        settings_store[modKey] = JSON.parse(JSON.stringify(override_settings));
        localStorage.setItem('openwebrx-audio-filter-settings', JSON.stringify(settings_store));
    }

    // Patch AudioNode.prototype.connect IMMEDIATELY
    // This ensures we catch the connection even if OpenWebRX initializes audio before window.load
    const originalConnect = AudioNode.prototype.connect;
    
    AudioNode.prototype.connect = function(destination, output, input) {
        if (destination && destination instanceof AudioDestinationNode) {
            let ctx = destination.context;
            
            if (!activeFilters.highpass || activeFilters.highpass.context !== ctx) {
                setupFilters(ctx);
            }

            if (!this.isCustomFilter) {
                // The chain is: Source -> Analyser -> Notches -> Highpass -> Lowpass -> Gain -> Destination
                return originalConnect.call(this, activeFilters.nbProcessor, output, input);
            }
        }
        return originalConnect.apply(this, arguments);
    };

    // FFT Optimization: Precompute tables
    const FFT_SIZE = 1024;
    const bitRev = new Uint16Array(FFT_SIZE);
    const cosTable = new Float32Array(FFT_SIZE / 2);
    const sinTable = new Float32Array(FFT_SIZE / 2);
    const fft_win = new Float32Array(FFT_SIZE);

    (function initFFT() {
        let m = 0, temp = FFT_SIZE;
        while (temp > 1) { temp >>= 1; m++; }
        for (let i = 0; i < FFT_SIZE; i++) {
            let j = 0, k = i;
            for (let l = 0; l < m; l++) { j = (j << 1) | (k & 1); k >>= 1; }
            bitRev[i] = j;
        }
        for (let i = 0; i < FFT_SIZE / 2; i++) {
            const theta = -2 * Math.PI * i / FFT_SIZE;
            cosTable[i] = Math.cos(theta);
            sinTable[i] = Math.sin(theta);
        }
        for(let i=0; i<FFT_SIZE; i++) fft_win[i] = Math.sin(Math.PI * i / FFT_SIZE);
    })();

    function performFFT(real, imag, inverse) {
        for (let i = 0; i < FFT_SIZE; i++) {
            const j = bitRev[i];
            if (i < j) {
                const tr = real[i]; real[i] = real[j]; real[j] = tr;
                const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
            }
        }
        let halfSize = 1;
        while (halfSize < FFT_SIZE) {
            const step = FFT_SIZE / (2 * halfSize);
            for (let i = 0; i < FFT_SIZE; i += 2 * halfSize) {
                for (let k = 0, tIdx = 0; k < halfSize; k++, tIdx += step) {
                    const t_cos = cosTable[tIdx];
                    const t_sin = inverse ? -sinTable[tIdx] : sinTable[tIdx];
                    const j = i + k + halfSize;
                    const tr = t_cos * real[j] - t_sin * imag[j];
                    const ti = t_cos * imag[j] + t_sin * real[j];
                    real[j] = real[i + k] - tr;
                    imag[j] = imag[i + k] - ti;
                    real[i + k] += tr;
                    imag[i + k] += ti;
                }
            }
            halfSize <<= 1;
        }
        if (inverse) {
            const invSize = 1.0 / FFT_SIZE;
            for (let i = 0; i < FFT_SIZE; i++) { real[i] *= invSize; imag[i] *= invSize; }
        }
    }

    function setupFilters(ctx) {
        
        // Analyser for Auto Notch
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096; // High resolution for notch detection
        analyser.smoothingTimeConstant = 0.15;
        analyser.minDecibels = -140;
        analyser.maxDecibels = -10;
        activeFilters.analyser = analyser;

        // Analyser for Visualization (Output)
        const outputAnalyser = ctx.createAnalyser();
        outputAnalyser.fftSize = 4096; // High resolution for visualization
        outputAnalyser.smoothingTimeConstant = 0.15;
        outputAnalyser.minDecibels = -140;
        outputAnalyser.maxDecibels = -10;
        activeFilters.outputAnalyser = outputAnalyser;

        // Notch Filters (Pool of 4)
        activeFilters.notches = [];
        for (let i = 0; i < 4; i++) {
            const n = ctx.createBiquadFilter();
            n.type = 'notch';
            n.frequency.value = 0; // 0 = disabled/inactive
            n.Q.value = 20;
            n.isCustomFilter = true;
            activeFilters.notches.push(n);
        }

        // Compressor Pre-Filter (Bandpass)
        const compHighpass = ctx.createBiquadFilter();
        compHighpass.type = 'highpass';
        compHighpass.frequency.value = 0;
        compHighpass.isCustomFilter = true;
        activeFilters.compHighpass = compHighpass;

        const compLowpass = ctx.createBiquadFilter();
        compLowpass.type = 'lowpass';
        compLowpass.frequency.value = (ctx.sampleRate / 2) - 100;
        compLowpass.isCustomFilter = true;
        activeFilters.compLowpass = compLowpass;

        // 1. Noise Blanker Processor (Start of Chain)
        const nbProcessor = ctx.createScriptProcessor(4096, 1, 1);
        nbProcessor.isCustomFilter = true;
        activeFilters.nbProcessor = nbProcessor;

        let nb_avg = 0.1;
        let nb_blank_counter = 0;
        let nb_last_sample = 0;
        
        // --- NB Constants for clarity ---
        const NB_AVG_DECAY = 0.99;
        const NB_THRESHOLD_MULTIPLIER = 5.0;
        const NB_BLANK_SAMPLES = 15; // ~0.3ms at 48kHz
        const NB_BLANK_ATTENUATION = 0.1;

        nbProcessor.onaudioprocess = function(audioProcessingEvent) {
            const inputBuffer = audioProcessingEvent.inputBuffer;
            const outputBuffer = audioProcessingEvent.outputBuffer;
            const inputData = inputBuffer.getChannelData(0);
            const outputData = outputBuffer.getChannelData(0);
            const s = activeFilters.dynamicsSettings; 
            
            if (!s || !s.nb_enabled) {
                outputData.set(inputData);
                return;
            }

            for (let i = 0; i < inputBuffer.length; i++) {
                let sample = inputData[i];
                const abs_raw = Math.abs(sample);
                let input_for_avg = abs_raw;
                if (input_for_avg > nb_avg * 10.0) input_for_avg = nb_avg * 10.0;
                nb_avg = nb_avg * NB_AVG_DECAY + input_for_avg * (1.0 - NB_AVG_DECAY);
                if (nb_avg < 0.001) nb_avg = 0.001;
                
                const threshold = nb_avg * NB_THRESHOLD_MULTIPLIER;
                if (nb_blank_counter > 0) {
                    sample = sample * NB_BLANK_ATTENUATION;
                    nb_blank_counter--;
                } else if (abs_raw > threshold) {
                    nb_blank_counter = NB_BLANK_SAMPLES;
                    sample = sample * NB_BLANK_ATTENUATION;
                }
                outputData[i] = sample;
            }
        };

        // 2. Spectral Noise Reduction Processor
        const nrProcessor = ctx.createScriptProcessor(4096, 1, 1);
        nrProcessor.isCustomFilter = true;
        activeFilters.nrProcessor = nrProcessor;

        const HOP_SIZE = FFT_SIZE / 2;
        const BUFFER_SIZE = 4096;

        const fft_real = new Float32Array(FFT_SIZE);
        const fft_imag = new Float32Array(FFT_SIZE);
        const fft_noise = new Float32Array(FFT_SIZE/2 + 1).fill(0);
        const fft_last_gain = new Float32Array(FFT_SIZE/2 + 1).fill(1.0);
        const fft_mag = new Float32Array(FFT_SIZE/2 + 1);
        let is_noise_init = false;
        
        // Create and expose a reset function for the NR state
        const reset_nr_state = function() {
            is_noise_init = false;
            fft_noise.fill(1e-9);
            fft_last_gain.fill(1.0);
        };
        activeFilters.reset_nr = reset_nr_state;

        let nr_was_enabled = false; // To detect toggling the NR button

        const nr_inputBuffer = new Float32Array(BUFFER_SIZE + FFT_SIZE); 
        const nr_outputBuffer = new Float32Array(BUFFER_SIZE + FFT_SIZE);

        // --- NR Constants for clarity ---
        const NR_SPEECH_ADAPT_ALPHA = 0.90;
        const NR_SPECTRAL_FLOOR = 0.005; // -46dB
        const NR_GAIN_ATTACK_SMOOTH = 0.6;
        const NR_GAIN_DECAY_SMOOTH = 0.05;


        nrProcessor.onaudioprocess = function(ev) {
            const input = ev.inputBuffer.getChannelData(0);
            const output = ev.outputBuffer.getChannelData(0);

            const nr_is_enabled = activeFilters.nrSettings && activeFilters.nrSettings.enabled;

            // Reset state if NR is toggled from OFF to ON
            if (nr_is_enabled && !nr_was_enabled) {
                reset_nr_state();
            }
            nr_was_enabled = nr_is_enabled;
            
            if (!nr_is_enabled) {
                output.set(input);
                nr_inputBuffer.copyWithin(0, BUFFER_SIZE, BUFFER_SIZE + FFT_SIZE);
                nr_inputBuffer.set(input, FFT_SIZE);
                return;
            }

            const s = activeFilters.nrSettings;
            const alpha = s.alpha;
            const snrThresh = Math.pow(10, s.snr / 20);
            const outGain = Math.pow(10, s.gain / 20);
            const combStrength = (s.comb !== undefined) ? s.comb : 0.5;
            const use_speech_mode = s.speech_mode;
            
            // In speech mode, the noise floor can be pulled down aggressively.
            // The rise factor must also be faster to allow it to recover from modulation troughs,
            // otherwise the noise estimate gets stuck at the bottom and NR has no effect.
            let alpha_for_rise = alpha;
            if (use_speech_mode && alpha > 0.98) { // Only for very slow base alphas like in AM mode
                alpha_for_rise = 0.95; 
            }
            const noiseRise = 1.0 + (1.0 - alpha_for_rise) * 0.01;

            nr_inputBuffer.copyWithin(0, BUFFER_SIZE, BUFFER_SIZE + FFT_SIZE);
            nr_inputBuffer.set(input, FFT_SIZE);
            
            nr_outputBuffer.copyWithin(0, BUFFER_SIZE, BUFFER_SIZE + FFT_SIZE);
            nr_outputBuffer.fill(0, FFT_SIZE);

            // 3. Process Frames (8 hops of 512 samples for 4096 input)
            for (let i = 0; i < BUFFER_SIZE / HOP_SIZE; i++) {
                const pos = i * HOP_SIZE + (FFT_SIZE - HOP_SIZE);
                
                for(let k=0; k<FFT_SIZE; k++) {
                    fft_real[k] = nr_inputBuffer[pos + k] * fft_win[k];
                }
                fft_imag.fill(0);

                performFFT(fft_real, fft_imag, false);

                for(let k=0; k<=FFT_SIZE/2; k++) {
                    const mag = Math.sqrt(fft_real[k]*fft_real[k] + fft_imag[k]*fft_imag[k]);
                    fft_mag[k] = mag;

                    // --- Adaptive Noise Estimation ---
                    let current_alpha = alpha;
                    // If signal drops significantly below the noise estimate (e.g., transmission ends),
                    // adapt the noise floor downwards much faster.
                    if (use_speech_mode && mag < fft_noise[k] * 0.5) {
                        current_alpha = NR_SPEECH_ADAPT_ALPHA;
                    }

                    if (mag < fft_noise[k]) {
                        fft_noise[k] = current_alpha * fft_noise[k] + (1 - current_alpha) * mag;
                    } else {
                        fft_noise[k] = fft_noise[k] * noiseRise + 1e-6; // For speech, let noise rise very slowly.
                    }
                    fft_noise[k] = Math.max(fft_noise[k], 1e-9); // Prevent noise floor from going to zero
                }

                if (!is_noise_init) {
                    for(let k=0; k<=FFT_SIZE/2; k++) {
                        fft_noise[k] = Math.max(fft_mag[k], 1e-6);
                    }
                    is_noise_init = true;
                }

                for(let k=0; k<=FFT_SIZE/2; k++) {
                    const mag = fft_mag[k];
                    const freq = k * (ctx.sampleRate / FFT_SIZE);
                    let localThresh = snrThresh;

                    // Spectral Comb / Peak Retention
                    let isPeak = false;
                    if (k > 1 && k < FFT_SIZE/2 - 1) {
                        if (mag >= fft_mag[k-1] && mag >= fft_mag[k+1]) isPeak = true;
                    }

                    // Speech Focus: 100Hz - 9000Hz
                    if (freq > 100 && freq < 9000) {
                        if (isPeak) localThresh *= (1.0 - 0.95 * combStrength);
                        else localThresh *= (1.0 + 0.9 * combStrength);
                    } else { // Original: } else {
                        // Outside speech range, suppress more
                        localThresh *= 1.2;
                    }

                    // Soft Gate / Expander
                    let snrVal = mag / (fft_noise[k] + 0.000001);
                    let gain = 1.0;
                    if (snrVal < localThresh) {
                        gain = snrVal / localThresh;
                        gain = gain * gain;
                    }
                    if (gain < NR_SPECTRAL_FLOOR) gain = NR_SPECTRAL_FLOOR;

                    // Time Smoothing (Fast Attack, Slow Decay) to reduce "musical noise"
                    if (gain > fft_last_gain[k]) {
                        fft_last_gain[k] = fft_last_gain[k] * (1.0 - NR_GAIN_ATTACK_SMOOTH) + gain * NR_GAIN_ATTACK_SMOOTH;
                    } else {
                        fft_last_gain[k] = fft_last_gain[k] * (1.0 - NR_GAIN_DECAY_SMOOTH) + gain * NR_GAIN_DECAY_SMOOTH;
                    }
                    gain = fft_last_gain[k];
                    
                    fft_real[k] *= gain;
                    fft_imag[k] *= gain;
                    if (k > 0 && k < FFT_SIZE/2) {
                        fft_real[FFT_SIZE-k] *= gain;
                        fft_imag[FFT_SIZE-k] *= gain;
                    }
                }

                performFFT(fft_real, fft_imag, true);

                for(let k=0; k<FFT_SIZE; k++) {
                    nr_outputBuffer[pos + k] += fft_real[k] * fft_win[k];
                }
            }

            for(let i=0; i<BUFFER_SIZE; i++) {
                output[i] = nr_outputBuffer[i] * outGain;
            }
        };

        // 3. Compressor Processor (End of Chain)
        const compProcessor = ctx.createScriptProcessor(4096, 1, 1);
        compProcessor.isCustomFilter = true;
        activeFilters.compProcessor = compProcessor;

        let env = 0.0;
        let gain_smooth = 1.0;
        let hang_timer = 0;

        compProcessor.onaudioprocess = function(audioProcessingEvent) {
            const inputBuffer = audioProcessingEvent.inputBuffer;
            const outputBuffer = audioProcessingEvent.outputBuffer;
            const inputData = inputBuffer.getChannelData(0);
            const outputData = outputBuffer.getChannelData(0);
            const s = activeFilters.dynamicsSettings;

            if (!s || !s.comp_enabled) {
                outputData.set(inputData);
                return;
            }

            const sampleRate = ctx.sampleRate;
            const env_decay = Math.exp(-1.0 / (0.05 * sampleRate));
            const gain_recovery = Math.exp(-1.0 / (s.recoveryTime * sampleRate));
            const hang_samples = Math.floor(s.hangTime * sampleRate);

            for (let i = 0; i < inputBuffer.length; i++) {
                let sample = inputData[i];
                const abs = Math.abs(sample);
                if (abs > env) env = abs;
                else env = env * env_decay + abs * (1 - env_decay);

                let targetGain = s.agcTarget / (env + 0.000001);
                if (targetGain > s.maxBoost) targetGain = s.maxBoost;
                if (env < s.gateThresh) {
                    let r = env / s.gateThresh;
                    targetGain *= r * r;
                }

                if (targetGain < gain_smooth) {
                    gain_smooth = targetGain;
                    hang_timer = hang_samples;
                } else {
                    if (hang_timer > 0) hang_timer--;
                    else gain_smooth = gain_smooth * gain_recovery + targetGain * (1 - gain_recovery);
                }
                sample = Math.tanh(sample * gain_smooth) * s.compGain;
                outputData[i] = sample;
            }
        };

        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 0;
        highpass.isCustomFilter = true;
        activeFilters.highpass = highpass;

        // Loudness Filter (LowShelf for Bass Boost)
        const loudness = ctx.createBiquadFilter();
        loudness.type = 'lowshelf';
        loudness.frequency.value = 150;
        loudness.gain.value = 0;
        loudness.isCustomFilter = true;
        activeFilters.loudness = loudness;

        const peaking = ctx.createBiquadFilter();
        peaking.type = 'peaking';
        peaking.frequency.value = 2000;
        peaking.Q.value = 1;
        peaking.gain.value = 0;
        peaking.isCustomFilter = true;
        activeFilters.peaking = peaking;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        // Fix: Use slightly below Nyquist frequency to be safe
        lowpass.frequency.value = (ctx.sampleRate / 2) - 100; 
        lowpass.isCustomFilter = true;
        activeFilters.lowpass = lowpass;

        // Air Filter (HighShelf)
        const air = ctx.createBiquadFilter();
        air.type = 'highshelf';
        air.frequency.value = 12000; // Default 12kHz
        air.gain.value = 0;
        air.isCustomFilter = true;
        activeFilters.air = air;

        const gainNode = ctx.createGain();
        gainNode.gain.value = 1.0;
        gainNode.isCustomFilter = true;
        activeFilters.gain = gainNode;

        // Connect the chain
        nbProcessor.connect(analyser);
        analyser.connect(activeFilters.notches[0]);
        for (let i = 0; i < activeFilters.notches.length - 1; i++) {
            activeFilters.notches[i].connect(activeFilters.notches[i+1]);
        }
        activeFilters.notches[activeFilters.notches.length - 1].connect(nrProcessor);
        nrProcessor.connect(highpass);
        
        highpass.connect(loudness);
        loudness.connect(peaking);
        peaking.connect(air);
        air.connect(lowpass);
        lowpass.connect(compHighpass);
        compHighpass.connect(compLowpass);
        compLowpass.connect(compProcessor);
        compProcessor.connect(gainNode);
        
        gainNode.connect(outputAnalyser);

        originalConnect.call(outputAnalyser, ctx.destination);
        apply_filter_settings();
    }

    function initAudioFilter() {
        try {
            if (localStorage.getItem('openwebrx-audio-filter-enabled') === 'true') is_filter_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-nr') === 'true') is_nr_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-autonotch') === 'true') is_autonotch_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-declick') === 'true') is_nb_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-compressor') === 'true') is_compressor_enabled = true;
            if (localStorage.getItem('openwebrx-audio-filter-loudness') === 'true') is_loudness_enabled = true;

            try {
                const savedSettings = localStorage.getItem('openwebrx-audio-filter-settings');
                if (savedSettings) {
                    const parsed = JSON.parse(savedSettings);
                    if (parsed.ssb || parsed.am || parsed.cw || parsed.nfm || parsed.wfm || parsed.digital) {
                        if (parsed.ssb) settings_store.ssb = parsed.ssb;
                        if (parsed.am) settings_store.am = parsed.am;
                        if (parsed.cw) settings_store.cw = parsed.cw;
                        if (parsed.nfm) settings_store.nfm = parsed.nfm;
                        if (parsed.wfm) settings_store.wfm = parsed.wfm;
                        if (parsed.digital) settings_store.digital = parsed.digital;
                    } else {
                        // Migration for old format (assume SSB)
                        settings_store.ssb = parsed;
                    }
                }
            } catch (e) {
                console.error(`[${PLUGIN_ID}] Error loading settings:`, e);
            }

            if (!create_ui()) {
                setTimeout(initAudioFilter, 250);
                return;
            }

            // Initialize last_modulation to avoid resetting settings on first loop
            last_modulation = get_modulation();
            
            let startKey = get_config_mode(last_modulation);
            if (settings_store[startKey]) {
                override_settings = JSON.parse(JSON.stringify(settings_store[startKey]));
            }

            // Start monitoring loops
            setInterval(check_modulation_loop, 500);
            setInterval(process_audio_analysis, 50); // Polling for AutoNotch
            

        } catch (e) {
            console.error(`[${PLUGIN_ID}] Error during initialization:`, e);
        }
    }

    let viz_cache = { w: 0, freqArray: null, magResponse: null, phaseResponse: null, totalResp: null, spectrumData: null };

    function draw_comp_visualization(ctx, w, h, mouseX, mouseY) {
        ctx.clearRect(0, 0, w, h);

        const maxFreq = 8000, minFreq = 50;
        const freqToX = (f) => {
            if (f < minFreq) f = minFreq;
            if (f > maxFreq) f = maxFreq;
            return (w - 2) * (Math.log(f) - Math.log(minFreq)) / (Math.log(maxFreq) - Math.log(minFreq)) + 1;
        };

        // Cache arrays to reduce GC
        if (viz_cache.w !== w) {
            viz_cache.w = w;
            viz_cache.freqArray = new Float32Array(w);
            viz_cache.magResponse = new Float32Array(w);
            viz_cache.phaseResponse = new Float32Array(w);
            viz_cache.totalResp = new Float32Array(w);
            for (let x = 0; x < w; x++) {
                let t = (x - 1) / (w - 2);
                if (t < 0) t = 0; if (t > 1) t = 1;
                viz_cache.freqArray[x] = minFreq * Math.pow(maxFreq / minFreq, t);
            }
        }
        const { freqArray, magResponse, phaseResponse, totalResp } = viz_cache;
        
        const drawCurve = (color, fill, nodes) => {
            if (!nodes || nodes.length === 0) return;
            
            totalResp.fill(1.0);
            
            let hasNodes = false;
            nodes.forEach(node => {
                if (node && node.getFrequencyResponse) {
                    node.getFrequencyResponse(freqArray, magResponse, phaseResponse);
                    for(let i=0; i<w; i++) totalResp[i] *= magResponse[i];
                    hasNodes = true;
                }
            });
            
            if (!hasNodes) return;

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            if (fill) ctx.fillStyle = fill;

            for (let x = 0; x < w; x++) {
                let mag = totalResp[x];
                if (mag < 0.00001) mag = 0.00001;
                let db = 20 * Math.log10(mag);
                let y = 40 - db * (h - 40) / 60;
                
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            
            if (fill) {
                ctx.lineTo(w, h);
                ctx.lineTo(0, h);
                ctx.fill();
            }
            ctx.stroke();
            ctx.lineWidth = 1;
        };

        // 1. Compressor Bandpass (Green)
        if (is_compressor_enabled) {
            if (activeFilters.compHighpass && activeFilters.compLowpass) {
                const xHPF = freqToX(activeFilters.compHighpass.frequency.value);
                const xLPF = freqToX(activeFilters.compLowpass.frequency.value);
                ctx.fillStyle = 'rgba(57, 255, 20, 0.1)';
                ctx.fillRect(xHPF, 0, xLPF - xHPF, h);
            }
            
            if (activeFilters.compHighpass) {
                const xHPF = freqToX(activeFilters.compHighpass.frequency.value);
                ctx.fillStyle = 'rgba(57, 255, 20, 0.8)';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('Comp', xHPF + 2, 10);
            }
        }

        // 2. EQ (Yellow)
        if (is_filter_enabled && activeFilters.highpass) {
            
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            
            const xHP = freqToX(activeFilters.highpass.frequency.value);
            ctx.beginPath();
            ctx.moveTo(xHP, 0);
            ctx.lineTo(xHP, h);
            ctx.stroke();

            if (activeFilters.lowpass) {
                const xLP = freqToX(activeFilters.lowpass.frequency.value);
                ctx.beginPath();
                ctx.moveTo(xLP, 0);
                ctx.lineTo(xLP, h);
                ctx.stroke();
            }
            ctx.setLineDash([]);

            if (activeFilters.peaking && Math.abs(activeFilters.peaking.gain.value) > 0.1) {
                const f_c = activeFilters.peaking.frequency.value;
                const Q = activeFilters.peaking.Q.value;
                const term1 = Math.sqrt(1 + 1 / (4 * Q * Q));
                const term2 = 1 / (2 * Q);
                const f1 = f_c * (term1 - term2);
                const f2 = f_c * (term1 + term2);
                const x1 = freqToX(f1);
                const x2 = freqToX(f2);
                ctx.fillStyle = 'rgba(255, 255, 0, 0.15)';
                ctx.fillRect(x1, 0, x2 - x1, h);
            }
        }

        // 3. Auto Notch (Red)
        if (is_autonotch_enabled && activeFilters.notches) {
            let effectiveNotchRange = (override_settings.notchRange !== null && override_settings.notchRange !== undefined) ? override_settings.notchRange : 4000;
            let effectiveNotchCenter = (override_settings.notchCenter !== null && override_settings.notchCenter !== undefined) ? override_settings.notchCenter : (effectiveNotchRange / 2);

            let halfWidth = effectiveNotchRange / 2;
            let startFreq = Math.max(50, effectiveNotchCenter - halfWidth);
            let endFreq = effectiveNotchCenter + halfWidth;
            const x1 = freqToX(startFreq);
            const x2 = freqToX(endFreq);
            ctx.fillStyle = 'rgba(255, 50, 50, 0.1)';
            ctx.fillRect(x1, 0, x2 - x1, h);

            const activeNotches = activeFilters.notches.filter(n => n.frequency.value > 10);
            if (activeNotches.length > 0) {
                drawCurve('rgba(255, 50, 50, 0.8)', null, activeNotches);

                ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
                activeNotches.forEach(n => {
                    const bw = n.frequency.value / n.Q.value;
                    const xStart = freqToX(n.frequency.value - bw / 2);
                    const xEnd = freqToX(n.frequency.value + bw / 2);
                    const wBar = Math.max(2, xEnd - xStart);
                    ctx.fillRect(xStart, 0, wBar, 6);
                });
            }
        }

        // 4. Spectrum (Input & Output)
        const drawSpectrum = (analyser, color) => {
            if (!analyser) return;
            const bufferLength = analyser.frequencyBinCount;
            if (!viz_cache.spectrumData || viz_cache.spectrumData.length !== bufferLength) {
                viz_cache.spectrumData = new Uint8Array(bufferLength);
            }
            const dataArray = viz_cache.spectrumData;
            analyser.getByteFrequencyData(dataArray);
            const sampleRate = analyser.context.sampleRate;

            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            let started = false;
            for (let x = 0; x < w; x++) {
                let f = viz_cache.freqArray[x];
                
                let bin = Math.floor(f / (sampleRate / 2) * bufferLength);
                if (bin < 0) bin = 0; if (bin >= bufferLength) bin = bufferLength - 1;
                
                let y = h - (dataArray[bin] / 255) * h;
                if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
            }
            ctx.stroke();
        };

        if (show_input_spectrum) {
            drawSpectrum(activeFilters.analyser, 'rgba(255, 255, 0, 0.6)');
        }
        
        if (show_output_spectrum) {
            drawSpectrum(activeFilters.outputAnalyser, 'rgba(0, 255, 255, 0.8)');
        }

        // 5. Legend
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        
        ctx.fillStyle = show_input_spectrum ? 'rgba(255, 255, 0, 0.8)' : 'rgba(100, 100, 0, 0.6)';
        ctx.fillRect(5, 5, 6, 6);
        ctx.fillStyle = show_input_spectrum ? '#ddd' : '#666';
        ctx.fillText('In', 14, 8);

        ctx.fillStyle = show_output_spectrum ? 'rgba(0, 255, 255, 0.8)' : 'rgba(0, 100, 100, 0.6)';
        ctx.fillRect(32, 5, 6, 6);
        ctx.fillStyle = show_output_spectrum ? '#ddd' : '#666';
        ctx.fillText('Out', 41, 8);

        // 6. Frequency Axis
        ctx.fillStyle = '#fff';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        
        const axisFreqs = [100, 200, 500, 1000, 2000, 4000];
        ctx.beginPath();
        axisFreqs.forEach(f => {
            const x = freqToX(f);
            ctx.moveTo(x, h);
            ctx.lineTo(x, h - 4);
            let txt = (f >= 1000) ? (f/1000) + 'k' : f;
            ctx.fillText(txt, x, h - 4);
        });
        ctx.strokeStyle = '#555';
        ctx.stroke();

        // Tooltip
        if (mouseX && mouseX > 0) {
            let hovered = null;

            if (is_autonotch_enabled) {
                let effectiveNotchRange = (override_settings.notchRange !== null && override_settings.notchRange !== undefined) ? override_settings.notchRange : 4000;
                let effectiveNotchCenter = (override_settings.notchCenter !== null && override_settings.notchCenter !== undefined) ? override_settings.notchCenter : (effectiveNotchRange / 2);
                let halfWidth = effectiveNotchRange / 2;
                let startFreq = Math.max(50, effectiveNotchCenter - halfWidth);
                let endFreq = effectiveNotchCenter + halfWidth;
                const x1 = freqToX(startFreq);
                const x2 = freqToX(endFreq);
                if (mouseX >= x1 && mouseX <= x2) hovered = "Notch Range";
            }

            if (is_filter_enabled && activeFilters.peaking && Math.abs(activeFilters.peaking.gain.value) > 0.1) {
                const f_c = activeFilters.peaking.frequency.value;
                const Q = activeFilters.peaking.Q.value;
                const term1 = Math.sqrt(1 + 1 / (4 * Q * Q));
                const term2 = 1 / (2 * Q);
                const f1 = f_c * (term1 - term2);
                const f2 = f_c * (term1 + term2);
                const x1 = freqToX(f1);
                const x2 = freqToX(f2);
                if (mouseX >= x1 && mouseX <= x2) {
                    hovered = "Presence Range";
                }
            }

            const check = (x, label) => {
                if (Math.abs(x - mouseX) < 5) hovered = label;
            };

            if (is_compressor_enabled) {
                let modKey = get_config_mode(last_modulation);
                let base = CONFIG[modKey];
                const compHPF = (override_settings.compHPF !== null && override_settings.compHPF !== undefined) ? override_settings.compHPF : (base.compHPF || 300);
                const compLPF = (override_settings.compLPF !== null && override_settings.compLPF !== undefined) ? override_settings.compLPF : (base.compLPF || 3000);
                const xHPF = freqToX(compHPF);
                const xLPF = freqToX(compLPF);
                if (mouseX >= xHPF && mouseX <= xLPF) hovered = "Comp Range";
            }

            if (is_filter_enabled && activeFilters.highpass && activeFilters.lowpass) {
                check(freqToX(activeFilters.highpass.frequency.value), `EQ Highpass: ${Math.round(activeFilters.highpass.frequency.value)}Hz`);
                check(freqToX(activeFilters.lowpass.frequency.value), `EQ Lowpass: ${Math.round(activeFilters.lowpass.frequency.value)}Hz`);
            }

            if (hovered) {
                ctx.font = '10px sans-serif';
                const tw = ctx.measureText(hovered).width;
                const tx = Math.min(Math.max(mouseX - tw / 2, 0), w - tw - 4);
                const ty = 20;
                
                ctx.fillStyle = 'rgba(0,0,0,0.8)';
                ctx.fillRect(tx - 2, ty - 10, tw + 4, 14);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'left';
                ctx.fillText(hovered, tx, ty);
            }
        }
    }

    function create_ui() {
        var container = document.querySelector('#openwebrx-panel-receiver');
        if (!container) return false;

        if (!document.getElementById('audio-filter-toggle-btn')) {
            var toggleBtn = document.createElement('div');
            toggleBtn.id = 'audio-filter-toggle-btn';
            toggleBtn.textContent = 'FI';
            toggleBtn.title = 'Open Audio Filter Controls';
            toggleBtn.style.cssText = 'position: absolute; bottom: 3px; left: 4px; z-index: 99; font-size: 12px; font-weight: bold; color: #aaa; cursor: pointer; background: rgba(0,0,0,0.5); padding: 0px 4px; border-radius: 3px; border: 1px solid #666; user-select: none; line-height: 12px; transition: left 0.2s;';
            
            toggleBtn.onclick = function() {
                var panel = document.getElementById('audio-filter-floating-panel');
                if (panel.style.display === 'none') {
                    panel.style.display = 'block';
                } else {
                    panel.style.display = 'none';
                }
                update_fil_button_state();
                if (panel.style.display !== 'none' && document.getElementById('audio-filter-graph-check').checked) {
                    startMainGraphLoop();
                }
            };
            
            container.appendChild(toggleBtn);

            var af_update_pos = function() {
                var btn = document.getElementById('audio-filter-toggle-btn');
                if (!btn) return;
                var cont = document.querySelector('#openwebrx-panel-receiver');
                if (!cont) return;

                var allButtons = Array.from(cont.querySelectorAll('div[id$="-toggle-btn"], div[id$="-btn"], div[id="openwebrx-clock-utc"]'))
                    .filter(b => b.offsetParent !== null);

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
            setInterval(af_update_pos, 1000);
            af_update_pos();
        }

        if (!document.getElementById('audio-filter-floating-panel')) {
            var panel = document.createElement('div');
            panel.id = 'audio-filter-floating-panel';
            panel.style.cssText = 'display: none; position: fixed; top: 200px; left: 10px; background: rgba(30,30,30,0.95); border: 1px solid #666; border-radius: 5px; padding: 0; z-index: 10000; box-shadow: 0 0 10px rgba(0,0,0,0.5); font-family: sans-serif;';
            
            var dragHandle = document.createElement('div');
            dragHandle.textContent = 'Audio Filter';
            dragHandle.style.cssText = 'height: 18px; line-height: 18px; font-size: 11px; color: #ddd; text-align: center; background: #444; cursor: move; border-radius: 5px 5px 0 0; width: 100%; border-bottom: 1px solid #555; user-select: none;';
            dragHandle.title = 'Drag to move';
            panel.appendChild(dragHandle);

            var isDragging = false;
            var dragOffsetX = 0;
            var dragOffsetY = 0;

            var startDrag = function(e) {
                isDragging = true;
                var clientX = e.clientX;
                var clientY = e.clientY;
                if (e.touches && e.touches.length > 0) {
                    clientX = e.touches[0].clientX;
                    clientY = e.touches[0].clientY;
                }
                dragOffsetX = clientX - panel.offsetLeft;
                dragOffsetY = clientY - panel.offsetTop;
                e.preventDefault();
            };

            var doDrag = function(e) {
                if (isDragging) {
                    var clientX = e.clientX;
                    var clientY = e.clientY;
                    if (e.touches && e.touches.length > 0) {
                        clientX = e.touches[0].clientX;
                        clientY = e.touches[0].clientY;
                    }
                    panel.style.left = (clientX - dragOffsetX) + 'px';
                    panel.style.top = (clientY - dragOffsetY) + 'px';
                    if (e.type === 'touchmove') e.preventDefault();
                }
            };

            var stopDrag = function() { isDragging = false; };

            dragHandle.addEventListener('mousedown', startDrag);
            document.addEventListener('mousemove', doDrag);
            document.addEventListener('mouseup', stopDrag);

            dragHandle.addEventListener('touchstart', startDrag, {passive: false});
            document.addEventListener('touchmove', doDrag, {passive: false});
            document.addEventListener('touchend', stopDrag);

            var content = document.createElement('div');
            content.style.padding = '5px';

            var btnContainer = document.createElement('div');
            btnContainer.style.cssText = 'display: flex; gap: 5px; flex-wrap: nowrap;';

            function createBtn(label, title, hasMenu, isActiveFn, onClick, onLongPress) {
                var btn = document.createElement('button');
                btn.style.cssText = 'position: relative; width: 45px; height: 32px; padding: 0; line-height: 32px; font-size: 11px; font-weight: 600; border: none; border-radius: 5px; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: all 0.3s ease; background: #444; color: #fff; user-select: none; -webkit-user-select: none;';
                btn.title = title;

                function update() {
                    var active = isActiveFn ? isActiveFn() : false;
                    var html = label;
                    if (hasMenu) html += '<span style="position: absolute; right: 3px; bottom: 2px; font-size: 9px; opacity: 0.7;">&#9698;</span>';
                    btn.innerHTML = html;
                    if (active) {
                        btn.style.background = '#39FF14';
                        btn.style.color = 'black';
                    } else {
                        btn.style.background = '#444';
                        btn.style.color = '#fff';
                    }
                }
                update();

                if (onLongPress) {
                    var pressTimer;
                    var longPressTriggered = false;
                    var start = function(e) {
                        if (e.type === 'mousedown' && e.button !== 0) return;
                        longPressTriggered = false;
                        pressTimer = setTimeout(function() {
                            longPressTriggered = true;
                            onLongPress(btn.getBoundingClientRect());
                        }, 600);
                    };
                    var end = function(e) {
                        if (pressTimer) clearTimeout(pressTimer);
                        if (!longPressTriggered) {
                            if (e.type === 'touchend') e.preventDefault();
                            onClick();
                            update();
                            update_fil_button_state();
                        }
                    };
                    btn.addEventListener('mousedown', start);
                    btn.addEventListener('mouseup', end);
                    btn.addEventListener('mouseleave', function() { if (pressTimer) clearTimeout(pressTimer); });
                    btn.addEventListener('touchstart', start, {passive: true});
                    btn.addEventListener('touchend', end);
                } else {
                    btn.onclick = function() {
                        onClick();
                        update();
                        update_fil_button_state();
                    };
                }
                return { element: btn, update: update };
            }

            var btnNB = createBtn('NB', 'Enable/Disable Noise Blanker.', false, () => is_nb_enabled, () => {
                is_nb_enabled = !is_nb_enabled;
                localStorage.setItem('openwebrx-audio-filter-declick', is_nb_enabled);
                apply_filter_settings();
            }).element;

            var btnNotch = createBtn('Notch', 'Enable/Disable Auto Notch. Long press for settings.', true, () => is_autonotch_enabled, () => {
                is_autonotch_enabled = !is_autonotch_enabled;
                localStorage.setItem('openwebrx-audio-filter-autonotch', is_autonotch_enabled);
                if (!is_autonotch_enabled) activeFilters.notches.forEach(n => n.frequency.value = 0);
            }, (rect) => show_notch_menu(rect)).element;

            var btnNR = createBtn('NR', 'Enable/Disable Noise Reduction. Long press for settings.', true, () => is_nr_enabled, () => {
                is_nr_enabled = !is_nr_enabled;
                localStorage.setItem('openwebrx-audio-filter-nr', is_nr_enabled);
                apply_filter_settings();
            }, (rect) => show_nr_menu(rect)).element;

            var btnEq = createBtn('EQ', 'Enable/Disable Equalizer. Long press for settings.', true, () => is_filter_enabled, () => {
                    is_filter_enabled = !is_filter_enabled;
                    localStorage.setItem('openwebrx-audio-filter-enabled', is_filter_enabled);
                    apply_filter_settings();
            }, (rect) => show_eq_menu(rect)).element;

            var btnComp = createBtn('Comp', 'Enable/Disable Compressor. Long press for settings.', true, () => is_compressor_enabled, () => {
                is_compressor_enabled = !is_compressor_enabled;
                localStorage.setItem('openwebrx-audio-filter-compressor', is_compressor_enabled);
                apply_filter_settings();
            }, (rect) => show_comp_menu(rect)).element;

            btnContainer.appendChild(btnNB);
            btnContainer.appendChild(btnNotch);
            btnContainer.appendChild(btnNR);
            btnContainer.appendChild(btnEq);
            btnContainer.appendChild(btnComp);

            var btnSet = document.createElement('button');
            btnSet.style.cssText = 'position: relative; width: 45px; height: 32px; padding: 0; line-height: 32px; font-size: 11px; font-weight: 600; border: none; border-radius: 5px; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2); transition: all 0.3s ease; background: #444; color: #fff; user-select: none; -webkit-user-select: none;';
            btnSet.title = 'Plugin Settings (Import/Export)';
            btnSet.innerHTML = 'Set<span style="position: absolute; right: 3px; bottom: 2px; font-size: 9px; opacity: 0.7;">&#9698;</span>';
            btnSet.onclick = function() {
                show_settings_menu(btnSet.getBoundingClientRect());
            };
            btnContainer.appendChild(btnSet);

            var divGraph = document.createElement('div');
            divGraph.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; width: 36px; cursor: pointer; background: #222; border-radius: 4px; border: 1px solid #444; height: 32px; user-select: none; -webkit-user-select: none;';
            divGraph.title = 'Show Visualizer';

            var lblGraph = document.createElement('span');
            lblGraph.textContent = 'Graph';
            lblGraph.style.cssText = 'font-size: 9px; color: #ccc; line-height: 10px; margin-bottom: 1px;';

            var chkGraph = document.createElement('input');
            chkGraph.type = 'checkbox';
            chkGraph.id = 'audio-filter-graph-check';
            chkGraph.style.cursor = 'pointer';
            chkGraph.style.margin = '0';
            
            if (localStorage.getItem('openwebrx-audio-filter-show-graph') === 'true') {
                chkGraph.checked = true;
            }

            divGraph.appendChild(lblGraph);
            divGraph.appendChild(chkGraph);
            
            divGraph.onclick = function(e) {
                if (e.target !== chkGraph) {
                    chkGraph.checked = !chkGraph.checked;
                    if (chkGraph.onchange) chkGraph.onchange();
                }
            };

            btnContainer.appendChild(divGraph);

            content.appendChild(btnContainer);

            var graphContainer = document.createElement('div');
            graphContainer.id = 'audio-filter-main-graph';
            graphContainer.style.cssText = 'display: none; margin-top: 5px; border-top: 1px solid #444; padding-top: 5px;';
            
            var mainCanvas = document.createElement('canvas');
            mainCanvas.width = 286;
            mainCanvas.height = 100;
            mainCanvas.style.cssText = 'background: #181818; border-radius: 3px; border: 1px solid #333; display: block; width: 100%; box-sizing: border-box;';
            graphContainer.appendChild(mainCanvas);
            content.appendChild(graphContainer);

            var mainCtx = mainCanvas.getContext('2d');
            var mainLoopId;
            var mouseX = -1, mouseY = -1;

            mainCanvas.addEventListener('click', function(e) {
                var rect = mainCanvas.getBoundingClientRect();
                var clickX = e.clientX - rect.left;
                var clickY = e.clientY - rect.top;

                if (clickX >= 5 && clickX <= 30 && clickY >= 2 && clickY <= 14) {
                    show_input_spectrum = !show_input_spectrum;
                    localStorage.setItem('openwebrx-audio-filter-show-in-spec', show_input_spectrum);
                }

                if (clickX >= 32 && clickX <= 60 && clickY >= 2 && clickY <= 14) {
                    show_output_spectrum = !show_output_spectrum;
                    localStorage.setItem('openwebrx-audio-filter-show-out-spec', show_output_spectrum);
                }
            });

            mainCanvas.addEventListener('mousemove', function(e) {
                var rect = mainCanvas.getBoundingClientRect();
                mouseX = e.clientX - rect.left;
                mouseY = e.clientY - rect.top;
                if ((mouseX >= 5 && mouseX <= 30 && mouseY >= 2 && mouseY <= 14) ||
                    (mouseX >= 32 && mouseX <= 60 && mouseY >= 2 && mouseY <= 14)) {
                    mainCanvas.style.cursor = 'pointer';
                } else {
                    mainCanvas.style.cursor = 'default';
                }
            });
            mainCanvas.addEventListener('mouseleave', function() {
                mouseX = -1; mouseY = -1;
                mainCanvas.style.cursor = 'default';
            });

            window.startMainGraphLoop = function() {
                if (mainLoopId) cancelAnimationFrame(mainLoopId);
                let lastDraw = 0;
                const interval = 40; // ~25 FPS

                function loop(timestamp) {
                    if (!chkGraph.checked || panel.style.display === 'none') return;
                    if (document.hidden) return;
                    mainLoopId = requestAnimationFrame(loop);
                    if (timestamp - lastDraw >= interval) {
                        lastDraw = timestamp;
                        draw_comp_visualization(mainCtx, mainCanvas.width, mainCanvas.height, mouseX, mouseY);
                    }
                }
                requestAnimationFrame(loop);
            };

            document.addEventListener('visibilitychange', function() {
                if (!document.hidden && chkGraph.checked && panel.style.display !== 'none') {
                    startMainGraphLoop();
                }
            });

            chkGraph.onchange = function() {
                localStorage.setItem('openwebrx-audio-filter-show-graph', chkGraph.checked);
                if (chkGraph.checked) {
                    graphContainer.style.display = 'block';
                    startMainGraphLoop();
                } else {
                    graphContainer.style.display = 'none';
                    if (mainLoopId) cancelAnimationFrame(mainLoopId);
                }
            };

            if (chkGraph.checked) {
                graphContainer.style.display = 'block';
            }

            panel.appendChild(content);
            document.body.appendChild(panel);
        }
        
        update_fil_button_state();
        return true;
    }

    function get_modulation() {
        // Pattern from freq_scanner.js
        if (typeof UI !== 'undefined' && UI.getDemodulator) {
            var demod = UI.getDemodulator();
            if (demod && typeof demod.get_modulation === 'function') {
                return demod.get_modulation();
            }
        }
        return 'ssb'; // Fallback
    }

    function check_modulation_loop() {
        let current_mod = get_modulation();
        
        if (current_mod && current_mod !== last_modulation) {
            // Save current settings to store before switching
            let oldKey = get_config_mode(last_modulation);
            settings_store[oldKey] = JSON.parse(JSON.stringify(override_settings));

            last_modulation = current_mod;
            
            // Reset NR state before applying new settings for the new mode
            if (is_nr_enabled && activeFilters.reset_nr) {
                activeFilters.reset_nr();
            }

            // Load settings for new mode
            let newKey = get_config_mode(current_mod);
            if (settings_store[newKey]) {
                override_settings = JSON.parse(JSON.stringify(settings_store[newKey]));
            } else {
                override_settings = create_empty_settings();
            }
            apply_filter_settings();
            saveSettings();
        }
    }

    function apply_filter_settings() {
        let settings;
        let effectiveHP, effectiveLP, effectivePeakGain, effectivePeakFreq, effectivePeakQ, effectiveGain, effectiveNotchQ, effectiveCompHPF, effectiveCompLPF;
        let dynSettings = {};

        let modKey = get_config_mode(last_modulation);
        let baseSettings = CONFIG[modKey];
        effectiveNotchQ = (override_settings.notchQ !== null && override_settings.notchQ !== undefined) ? override_settings.notchQ : (baseSettings.notchQ || 30);

        let effectiveAirGain = (override_settings.airGain !== null && override_settings.airGain !== undefined) ? override_settings.airGain : (baseSettings.airGain !== undefined ? baseSettings.airGain : 0);
        let effectiveAirFreq = (override_settings.airFreq !== null && override_settings.airFreq !== undefined) ? override_settings.airFreq : (baseSettings.airFreq !== undefined ? baseSettings.airFreq : 12000);

        effectiveCompHPF = (override_settings.compHPF !== null && override_settings.compHPF !== undefined) ? override_settings.compHPF : (baseSettings.compHPF || 300);
        effectiveCompLPF = (override_settings.compLPF !== null && override_settings.compLPF !== undefined) ? override_settings.compLPF : (baseSettings.compLPF || 3000);
        
        // NR Settings
        let nrSettings = {
            enabled: is_nr_enabled,
            gain: (override_settings.nr_gain !== null && override_settings.nr_gain !== undefined) ? override_settings.nr_gain : (baseSettings.nr_gain || 0),
            alpha: (override_settings.nr_alpha !== null && override_settings.nr_alpha !== undefined) ? override_settings.nr_alpha : (baseSettings.nr_alpha || 0.95),
            snr: (override_settings.nr_snr !== null && override_settings.nr_snr !== undefined) ? override_settings.nr_snr : (baseSettings.nr_snr || 10),
            comb: (override_settings.nr_comb !== null && override_settings.nr_comb !== undefined) ? override_settings.nr_comb : (baseSettings.nr_comb !== undefined ? baseSettings.nr_comb : 0.5),
            speech_mode: (override_settings.nr_speech_mode !== null && override_settings.nr_speech_mode !== undefined) ? override_settings.nr_speech_mode : (baseSettings.nr_speech_mode !== undefined ? baseSettings.nr_speech_mode : false)
        };

        // --- DYNAMICS SETTINGS (NB & Comp) - ALWAYS CALCULATED ---
        dynSettings = {
            nb_enabled: is_nb_enabled,
            comp_enabled: is_compressor_enabled,
            agcTarget: baseSettings.agcTarget,
            maxBoost: (override_settings.maxBoost !== null && override_settings.maxBoost !== undefined) ? override_settings.maxBoost : baseSettings.maxBoost,
            gateThresh: (override_settings.gateThresh !== null && override_settings.gateThresh !== undefined) ? override_settings.gateThresh : 0.004,
            hangTime: (override_settings.hangTime !== null && override_settings.hangTime !== undefined) ? override_settings.hangTime : 0.2,
            recoveryTime: (override_settings.recoveryTime !== null && override_settings.recoveryTime !== undefined) ? override_settings.recoveryTime : 0.5,
            compGain: (override_settings.compGain !== null && override_settings.compGain !== undefined) ? override_settings.compGain : 0.10,
            sampleRate: activeFilters.gain ? activeFilters.gain.context.sampleRate : 48000
        };

        if (!is_filter_enabled) {
            // Bypass / Neutral (Filter disabled)
            let maxFreq = 22000;
            if (activeFilters.lowpass && activeFilters.lowpass.context) {
                maxFreq = (activeFilters.lowpass.context.sampleRate / 2) - 100;
            }
            settings = { gain: 1.0 };
            effectiveHP = 0;
            effectiveLP = maxFreq;
            effectivePeakGain = 0;
            effectiveGain = 1.0;
            effectivePeakFreq = 2000;
            effectivePeakQ = 1.0;

            // Emphasize speech in AM when NR is active
            if (is_nr_enabled && get_config_mode(last_modulation) === 'am') {
                effectivePeakGain = 6.0; // Boost Warmth
                effectivePeakFreq = 500; // "big wood radio" body
                effectivePeakQ = 1.0;
            }
        } else {
            settings = baseSettings;
            effectiveHP = (override_settings.highpassFreq !== null) ? override_settings.highpassFreq : settings.highpassFreq;
            effectiveLP = (override_settings.lowpassFreq !== null) ? override_settings.lowpassFreq : settings.lowpassFreq;
            effectivePeakGain = (override_settings.peakingGain !== null) ? override_settings.peakingGain : (settings.peakingGain || 0);
            effectivePeakFreq = (override_settings.peakingFreq !== null && override_settings.peakingFreq !== undefined) ? override_settings.peakingFreq : (settings.peakingFreq || 2000);
            effectivePeakQ = (override_settings.peakingQ !== null && override_settings.peakingQ !== undefined) ? override_settings.peakingQ : (settings.peakingQ || 1.0);
            effectiveGain = settings.gain; // Fixed gain
        }

        // Update settings object for ScriptProcessor
        activeFilters.dynamicsSettings = dynSettings;
        activeFilters.nrSettings = nrSettings;

        if (activeFilters.highpass) activeFilters.highpass.frequency.value = effectiveHP;
        if (activeFilters.lowpass) activeFilters.lowpass.frequency.value = effectiveLP;
        if (activeFilters.gain) activeFilters.gain.gain.value = effectiveGain;
        
        if (activeFilters.compHighpass && activeFilters.compLowpass) {
            if (is_compressor_enabled) {
                activeFilters.compHighpass.frequency.value = effectiveCompHPF;
                activeFilters.compLowpass.frequency.value = effectiveCompLPF;
            } else {
                activeFilters.compHighpass.frequency.value = 0;
                activeFilters.compLowpass.frequency.value = (activeFilters.compLowpass.context.sampleRate / 2) - 100;
            }
        }

        if (activeFilters.loudness) {
            activeFilters.loudness.gain.value = ((is_filter_enabled && is_loudness_enabled) || (is_nr_enabled && get_config_mode(last_modulation) === 'am')) ? 12 : 0;
        }
        
        if (activeFilters.notches) {
            activeFilters.notches.forEach(n => {
                if (n) n.Q.value = effectiveNotchQ;
            });
        }

        if (activeFilters.peaking) {
            if (is_filter_enabled || (is_nr_enabled && get_config_mode(last_modulation) === 'am')) {
                activeFilters.peaking.frequency.value = effectivePeakFreq;
                activeFilters.peaking.Q.value = effectivePeakQ;
            }
            activeFilters.peaking.gain.value = effectivePeakGain;
        }

        if (activeFilters.air) {
            let finalAirGain = is_compressor_enabled ? effectiveAirGain : 0;
            // In AM "Tube Mode" (Only NR), restore some high frequencies to balance the heavy bass boost
            if (!is_filter_enabled && is_nr_enabled && get_config_mode(last_modulation) === 'am') {
                finalAirGain = 5.0;
            }
            activeFilters.air.gain.value = finalAirGain;
            activeFilters.air.frequency.value = effectiveAirFreq;
        }
    }

    function process_audio_analysis() {
        if (!activeFilters.analyser || !is_autonotch_enabled) return;

        const bufferLength = activeFilters.analyser.frequencyBinCount;
        
        if (!analysisBuffer || analysisBuffer.length !== bufferLength) {
            analysisBuffer = new Float32Array(bufferLength);
        }
        const dataArray = analysisBuffer;
        activeFilters.analyser.getFloatFrequencyData(dataArray);

        const sampleRate = activeFilters.analyser.context.sampleRate;
        const binSize = sampleRate / activeFilters.analyser.fftSize;

        let sum = 0;
        let count = 0;
        // Only look at relevant frequencies (Window defined by Center and Width)
        let effectiveNotchRange = (override_settings.notchRange !== null && override_settings.notchRange !== undefined) ? override_settings.notchRange : 4000;
        let effectiveNotchCenter = (override_settings.notchCenter !== null && override_settings.notchCenter !== undefined) ? override_settings.notchCenter : (effectiveNotchRange / 2);

        let halfWidth = effectiveNotchRange / 2;
        let startFreq = Math.max(50, effectiveNotchCenter - halfWidth);
        let endFreq = effectiveNotchCenter + halfWidth;
        const startBin = Math.floor(startFreq / binSize);
        const endBin = Math.floor(endFreq / binSize);

        for (let i = startBin; i < endBin; i++) {
            if (dataArray[i] > -150) {
                sum += dataArray[i];
                count++;
            }
        }
        const currentNoiseFloor = (count > 0) ? (sum / count) : -100;

        // Smooth noise floor to prevent threshold jumping during speech
        if (typeof activeFilters.smoothedNoiseFloor === 'undefined') activeFilters.smoothedNoiseFloor = currentNoiseFloor;
        // Slow attack (rise), fast decay (fall)
        if (currentNoiseFloor > activeFilters.smoothedNoiseFloor) {
            activeFilters.smoothedNoiseFloor = activeFilters.smoothedNoiseFloor * 0.98 + currentNoiseFloor * 0.02;
        } else {
            activeFilters.smoothedNoiseFloor = activeFilters.smoothedNoiseFloor * 0.8 + currentNoiseFloor * 0.2;
        }

        // --- Auto Notch Logic ---
        if (!is_autonotch_enabled) return;

        const threshold = activeFilters.smoothedNoiseFloor + 4; // 4dB above smoothed floor

        let peaks = [];
        for (let i = startBin + 1; i < endBin - 1; i++) {
            const v = dataArray[i];
            if (v > threshold) {
                if (v > dataArray[i-1] && v > dataArray[i+1]) {
                    peaks.push({ freq: i * binSize, mag: v });
                }
            }
        }

        peaks.sort((a, b) => b.mag - a.mag);

        let effectiveMaxNotches = (override_settings.maxNotches !== null && override_settings.maxNotches !== undefined) ? override_settings.maxNotches : 4;

        // Initialize state if needed
        activeFilters.notches.forEach(n => {
            if (typeof n.notchConfidence === 'undefined') n.notchConfidence = 0;
            if (typeof n.notchLastFreq === 'undefined') n.notchLastFreq = 0;
            if (typeof n.notchLastMag === 'undefined') n.notchLastMag = -100;
        });

        // 1. Update existing active notches (Tracking & Persistence)
        activeFilters.notches.forEach(n => {
            if (n.notchConfidence > 0) {
                let bestMatchIndex = -1;
                let minDiff = 60; // Search window +/- 60Hz

                for (let i = 0; i < peaks.length; i++) {
                    let diff = Math.abs(peaks[i].freq - n.notchLastFreq);
                    if (diff < minDiff) {
                        minDiff = diff;
                        bestMatchIndex = i;
                    }
                }

                if (bestMatchIndex !== -1) {
                    n.notchLastFreq = peaks[bestMatchIndex].freq;
                    n.notchLastMag = peaks[bestMatchIndex].mag;
                    n.notchConfidence = Math.min(n.notchConfidence + 10, 100);
                    peaks.splice(bestMatchIndex, 1);
                } else {
                    // No match, decay confidence (Hold)
                    n.notchConfidence -= 1;
                    n.notchLastMag = -100;
                }
            }
        });

        // 1.5. Enforce Max Notches limit (if reduced by user)
        let activeCandidates = activeFilters.notches.filter(n => n.notchConfidence > 0);
        if (activeCandidates.length > effectiveMaxNotches) {
            activeCandidates.sort((a, b) => a.notchConfidence - b.notchConfidence);
            while (activeCandidates.length > effectiveMaxNotches) {
                let victim = activeCandidates.shift();
                victim.notchConfidence = 0;
                victim.notchLastMag = -100;
            }
        }

        // 2. Assign new notches from remaining peaks (Priority: Fill Empty -> Replace Weakest)
        while (peaks.length > 0) {
            let p = peaks.shift();
            
            let activeNotches = activeFilters.notches.filter(n => n.notchConfidence > 0);
            
            if (activeNotches.length < effectiveMaxNotches) {
                let freeFilter = activeFilters.notches.find(n => n.notchConfidence <= 0);
                if (freeFilter) {
                    freeFilter.notchLastFreq = p.freq;
                    freeFilter.notchLastMag = p.mag;
                    freeFilter.notchConfidence = 50;
                    continue;
                }
            }
            
            // If full, check if we should replace the weakest active notch
            if (activeNotches.length > 0) {
                activeNotches.sort((a, b) => a.notchLastMag - b.notchLastMag);
                let weakest = activeNotches[0];
                
                // If new peak is significantly stronger (e.g. > 6dB) than the weakest existing lock
                if (p.mag > weakest.notchLastMag + 6) {
                    weakest.notchLastFreq = p.freq;
                    weakest.notchLastMag = p.mag;
                    weakest.notchConfidence = 50;
                    continue;
                }
            }
        }

        // 3. Apply to filters
        activeFilters.notches.forEach(n => {
            if (n.notchConfidence > 0) {
                // Smooth transition
                let current = n.frequency.value;
                let target = n.notchLastFreq;
                if (current < 10) n.frequency.value = target;
                else n.frequency.value = current + (target - current) * 0.5;
            } else {
                n.frequency.value = 0;
                n.notchLastFreq = 0;
            }
        });
    }

    // Start initialization
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(initAudioFilter, 100);
    } else {
        window.addEventListener('load', initAudioFilter);
    }

    // Plugin registration
    if (typeof Plugins !== 'undefined') {
        Plugins.audio_filter = { no_css: true };
    }

    // Helper for creating floating menus
    function createFloatingMenu(id, titleText, rect, width, buildContentFn) {
        var existing = document.getElementById(id);
        if (existing) existing.remove();

        var menu = document.createElement('div');
        menu.id = id;
        menu.style.cssText = 'position: fixed; background: #222; border: 1px solid #444; color: #eee; z-index: 10001; border-radius: 4px; padding: 10px; font-family: sans-serif; font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.5); width: ' + width + 'px; visibility: hidden;';

        if (titleText) {
            var title = document.createElement('div');
            title.textContent = titleText;
            title.style.cssText = 'font-weight: bold; margin-bottom: 10px; border-bottom: 1px solid #444; padding-bottom: 5px;';
            menu.appendChild(title);
        }

        buildContentFn(menu);

        var closeHandler = function(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('mousedown', closeHandler);
                document.removeEventListener('touchstart', closeHandler);
            }
        };
        
        setTimeout(function() { 
            document.addEventListener('mousedown', closeHandler); 
            document.addEventListener('touchstart', closeHandler);
        }, 10);

        document.body.appendChild(menu);

        var menuHeight = menu.offsetHeight;
        var menuWidth = menu.offsetWidth;
        var left = rect.left;
        if (left + menuWidth > window.innerWidth - 5) left = rect.right - menuWidth;
        if (left < 5) left = 5;

        if (rect.top < menuHeight + 10) menu.style.top = rect.bottom + 5 + 'px';
        else menu.style.bottom = (window.innerHeight - rect.top) + 5 + 'px';

        menu.style.left = left + 'px';
        menu.style.visibility = 'visible';
    }

    function show_eq_menu(rect) {
        createFloatingMenu('audio-filter-eq-menu', null, rect, 200, function(menu) {
        let modKey = get_config_mode(last_modulation);
        let base = CONFIG[modKey];
        let currentHP = (override_settings.highpassFreq !== null) ? override_settings.highpassFreq : base.highpassFreq;
        let currentLP = (override_settings.lowpassFreq !== null) ? override_settings.lowpassFreq : base.lowpassFreq;
        let currentPeak = (override_settings.peakingGain !== null) ? override_settings.peakingGain : base.peakingGain;
        let currentPeakFreq = (override_settings.peakingFreq !== null && override_settings.peakingFreq !== undefined) ? override_settings.peakingFreq : base.peakingFreq;
        let currentPeakQ = (override_settings.peakingQ !== null && override_settings.peakingQ !== undefined) ? override_settings.peakingQ : (base.peakingQ || 1.0);

        var sliders = []; // Store update functions for reset

        function createMappedSlider(label, value0to100, onChange, formatFn) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';
            
            var getLabelText = function(val) {
                if (formatFn) return label + ': ' + formatFn(val);
                return label + ': ' + Math.round(val) + '%';
            };

            var lbl = document.createElement('div');
            lbl.textContent = getLabelText(value0to100);
            lbl.style.marginBottom = '2px';
            
            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = 0;
            inp.max = 100;
            inp.value = value0to100;
            inp.style.width = '100%';
            
            var updateUI = function(val) {
                inp.value = val;
                lbl.textContent = getLabelText(val);
            };
            sliders.push(updateUI);

            inp.oninput = function() {
                lbl.textContent = getLabelText(parseFloat(inp.value));
                onChange(parseFloat(inp.value));
            };

            inp.onchange = function() {
                saveSettings();
            };
            
            container.appendChild(lbl);
            container.appendChild(inp);

            return container;
        }

        // Bass (Highpass)
        var minBassFreq = 50, maxBassFreq = 1350;
        var bassPercent = 100 * (maxBassFreq - currentHP) / (maxBassFreq - minBassFreq);
        if (bassPercent < 0) bassPercent = 0; if (bassPercent > 100) bassPercent = 100;

        menu.appendChild(createMappedSlider('Bass', bassPercent, function(val) {
            var freq = maxBassFreq - (val / 100) * (maxBassFreq - minBassFreq);
            override_settings.highpassFreq = freq;
            apply_filter_settings();
        }));

        // Treble (Lowpass)
        var minTrebFreq = 1500, maxTrebFreq = 13500;
        var trebPercent = 100 * Math.log(currentLP / minTrebFreq) / Math.log(maxTrebFreq / minTrebFreq);
        if (trebPercent < 0) trebPercent = 0; if (trebPercent > 100) trebPercent = 100;

        menu.appendChild(createMappedSlider('Treble', trebPercent, function(val) {
            var freq = minTrebFreq * Math.pow(maxTrebFreq / minTrebFreq, val / 100);
            override_settings.lowpassFreq = freq;
            apply_filter_settings();
        }));

        // Presence (Peaking Gain)
        var presPercent = 100 * currentPeak / 33;
        if (presPercent < 0) presPercent = 0; if (presPercent > 100) presPercent = 100;

        menu.appendChild(createMappedSlider('Presence', presPercent, function(val) {
            override_settings.peakingGain = val * 33 / 100;
            apply_filter_settings();
        }));

        // Presence Freq
        var minPresFreq = 200, maxPresFreq = 8000;
        var presFreqPercent = 100 * Math.log(currentPeakFreq / minPresFreq) / Math.log(maxPresFreq / minPresFreq);
        if (presFreqPercent < 0) presFreqPercent = 0; if (presFreqPercent > 100) presFreqPercent = 100;

        // Define Q limits early for cross-referencing
        var minQ = 0.5, maxQ = 4.0;

        menu.appendChild(createMappedSlider('Presence Freq', presFreqPercent, function(val) {
            var freq = minPresFreq * Math.pow(maxPresFreq / minPresFreq, val / 100);
            override_settings.peakingFreq = freq;
            apply_filter_settings();
            
            // Update Width label to reflect new Hz bandwidth
            if (sliders[4]) {
                var q = (override_settings.peakingQ !== null && override_settings.peakingQ !== undefined) ? override_settings.peakingQ : currentPeakQ;
                var wPct = 100 * (maxQ - q) / (maxQ - minQ);
                if (wPct < 0) wPct = 0; if (wPct > 100) wPct = 100;
                sliders[4](wPct);
            }
        }, function(val) {
            var freq = minPresFreq * Math.pow(maxPresFreq / minPresFreq, val / 100);
            return Math.round(freq) + 'Hz';
        }));

        // Presence Width (Q)
        var widthPercent = 100 * (maxQ - currentPeakQ) / (maxQ - minQ);
        if (widthPercent < 0) widthPercent = 0; if (widthPercent > 100) widthPercent = 100;

        menu.appendChild(createMappedSlider('Presence Width', widthPercent, function(val) {
            var q = maxQ - (val / 100) * (maxQ - minQ);
            override_settings.peakingQ = q;
            apply_filter_settings();
        }, function(val) {
            var q = maxQ - (val / 100) * (maxQ - minQ);
            var freq = (override_settings.peakingFreq !== null && override_settings.peakingFreq !== undefined) ? override_settings.peakingFreq : currentPeakFreq;
            var bw = freq / q;
            return Math.round(bw) + 'Hz (Q: ' + q.toFixed(1) + ')';
        }));

        // Loudness Checkbox
        var loudDiv = document.createElement('div');
        loudDiv.style.marginTop = '10px';
        loudDiv.style.borderTop = '1px solid #444';
        loudDiv.style.paddingTop = '5px';
        
        var loudLbl = document.createElement('label');
        loudLbl.style.display = 'flex';
        loudLbl.style.alignItems = 'center';
        loudLbl.style.cursor = 'pointer';
        
        var loudChk = document.createElement('input');
        loudChk.type = 'checkbox';
        loudChk.checked = is_loudness_enabled;
        loudChk.style.marginRight = '8px';
        loudChk.onchange = function() {
            is_loudness_enabled = loudChk.checked;
            localStorage.setItem('openwebrx-audio-filter-loudness', is_loudness_enabled);
            apply_filter_settings();
            update_fil_button_state();
        };
        
        loudLbl.appendChild(loudChk);
        loudLbl.appendChild(document.createTextNode('Loudness'));
        loudDiv.appendChild(loudLbl);
        menu.appendChild(loudDiv);

        var btnDef = document.createElement('button');
        btnDef.textContent = 'Default';
        btnDef.style.cssText = 'margin-top: 10px; width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; user-select: none; -webkit-user-select: none;';
        btnDef.onclick = function() {
            let modKey = get_config_mode(last_modulation);
            let def = CONFIG[modKey];
            
            override_settings.highpassFreq = null;
            override_settings.lowpassFreq = null;
            override_settings.peakingGain = null;
            override_settings.peakingFreq = null;
            override_settings.peakingQ = null;
            override_settings.nr_gain = null;
            override_settings.nr_alpha = null;
            override_settings.nr_snr = null;
            override_settings.nr_speech_mode = null;
            if (settings_store[modKey]) {
                settings_store[modKey].highpassFreq = null;
                settings_store[modKey].lowpassFreq = null;
                settings_store[modKey].peakingGain = null;
                settings_store[modKey].peakingFreq = null;
                settings_store[modKey].peakingQ = null;
                settings_store[modKey].nr_gain = null;
                settings_store[modKey].nr_alpha = null;
                settings_store[modKey].nr_snr = null;
                settings_store[modKey].nr_speech_mode = null;
            }
            
            is_loudness_enabled = false;
            localStorage.setItem('openwebrx-audio-filter-loudness', 'false');
            loudChk.checked = false;

            saveSettings();
            apply_filter_settings();
            update_fil_button_state();

            // Update Sliders UI
            var bassPercent = 100 * (maxBassFreq - def.highpassFreq) / (maxBassFreq - minBassFreq);
            if (bassPercent < 0) bassPercent = 0; if (bassPercent > 100) bassPercent = 100;
            sliders[0](bassPercent);
            
            var trebPercent = 100 * Math.log(def.lowpassFreq / minTrebFreq) / Math.log(maxTrebFreq / minTrebFreq);
            if (trebPercent < 0) trebPercent = 0; if (trebPercent > 100) trebPercent = 100;
            sliders[1](trebPercent);
            
            var presPercent = 100 * (def.peakingGain || 0) / 33;
            if (presPercent < 0) presPercent = 0; if (presPercent > 100) presPercent = 100;
            sliders[2](presPercent);

            var presFreqPercent = 100 * Math.log((def.peakingFreq || 2000) / minPresFreq) / Math.log(maxPresFreq / minPresFreq);
            if (presFreqPercent < 0) presFreqPercent = 0; if (presFreqPercent > 100) presFreqPercent = 100;
            sliders[3](presFreqPercent);

            var defQ = def.peakingQ || 1.0;
            var defWidthPercent = 100 * (maxQ - defQ) / (maxQ - minQ);
            if (defWidthPercent < 0) defWidthPercent = 0; if (defWidthPercent > 100) defWidthPercent = 100;
            sliders[4](defWidthPercent);
        };
        menu.appendChild(btnDef);
        });
    }

    function show_comp_menu(rect) {
        createFloatingMenu('audio-filter-comp-menu', 'Compressor Settings', rect, 220, function(menu) {

        function createSlider(label, key, min, max, step, scale, precision) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';
            
            var baseSettings = CONFIG[get_config_mode(last_modulation)];
            var defVal = baseSettings[key];
            if (defVal === undefined) {
                 switch(key) {
                    case 'gateThresh': defVal = 0.004; break;
                    case 'hangTime': defVal = 0.2; break;
                    case 'recoveryTime': defVal = 0.5; break;
                    case 'compGain': defVal = 0.10; break;
                    case 'airGain': defVal = 0; break;
                    case 'airFreq': defVal = 12000; break;
                    default: defVal = 0;
                }
            }
            var val = (override_settings[key] !== null && override_settings[key] !== undefined) ? override_settings[key] : defVal;

            var lbl = document.createElement('div');
            var decimals = (precision !== undefined) ? precision : (scale ? 0 : 2);
            lbl.textContent = label + ': ' + (val * (scale || 1)).toFixed(decimals);
            lbl.style.marginBottom = '2px';
            
            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = min;
            inp.max = max;
            inp.step = step;
            inp.value = val;
            inp.style.width = '100%';
            
            inp.oninput = function() {
                var v = parseFloat(inp.value);
                lbl.textContent = label + ': ' + (v * (scale || 1)).toFixed(decimals);
                override_settings[key] = v;
                apply_filter_settings();
            };
            
            inp.onchange = function() {
                saveSettings();
            };
            
            container.appendChild(lbl);
            container.appendChild(inp);
            return container;
        }

        function createCustomSlider(label, min, max, step, initialVal, onChange) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';
            
            var lbl = document.createElement('div');
            lbl.textContent = label + ': ' + Math.round(initialVal) + 'Hz';
            lbl.style.marginBottom = '2px';
            
            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = min;
            inp.max = max;
            inp.step = step;
            inp.value = initialVal;
            inp.style.width = '100%';
            
            inp.oninput = function() {
                var v = parseFloat(inp.value);
                lbl.textContent = label + ': ' + Math.round(v) + 'Hz';
                onChange(v);
            };
            
            inp.onchange = function() {
                saveSettings();
            };
            
            container.appendChild(lbl);
            container.appendChild(inp);
            return container;
        }

        var eqHint = document.createElement('div');
        eqHint.textContent = 'Equalizer (Air)';
        eqHint.style.cssText = 'font-size: 10px; color: #aaa; margin-bottom: 5px; font-weight: 600;';
        menu.appendChild(eqHint);

        menu.appendChild(createSlider('Air Gain (dB)', 'airGain', 0, 20, 0.5));

        var sep = document.createElement('div');
        sep.style.cssText = 'border-bottom: 1px solid #444; margin: 8px 0;';
        menu.appendChild(sep);

        menu.appendChild(createSlider('Max Boost', 'maxBoost', 1.0, 50.0, 1.0));
        menu.appendChild(createSlider('Gate Threshold', 'gateThresh', 0.000, 0.020, 0.0005, null, 4));
        menu.appendChild(createSlider('Hang Time (s)', 'hangTime', 0.0, 2.0, 0.1));
        menu.appendChild(createSlider('Recovery (s)', 'recoveryTime', 0.1, 5.0, 0.1));
        menu.appendChild(createSlider('Comp Volume', 'compGain', 0.05, 1.0, 0.01));

        // Calculate current Center/Width
        let modKey = get_config_mode(last_modulation);
        let base = CONFIG[modKey];
        let currHPF = (override_settings.compHPF !== null && override_settings.compHPF !== undefined) ? override_settings.compHPF : (base.compHPF || 300);
        let currLPF = (override_settings.compLPF !== null && override_settings.compLPF !== undefined) ? override_settings.compLPF : (base.compLPF || 3000);
        let currCenter = (currHPF + currLPF) / 2;
        let currWidth = currLPF - currHPF;

        menu.appendChild(createCustomSlider('Comp Center', 200, 6000, 50, currCenter, function(val) {
            let h = (override_settings.compHPF !== null && override_settings.compHPF !== undefined) ? override_settings.compHPF : (base.compHPF || 300);
            let l = (override_settings.compLPF !== null && override_settings.compLPF !== undefined) ? override_settings.compLPF : (base.compLPF || 3000);
            let w = l - h;
            let newH = val - w / 2;
            let newL = val + w / 2;
            if (newH < 50) newH = 50;
            if (newL > 8000) newL = 8000;
            override_settings.compHPF = newH;
            override_settings.compLPF = newL;

            override_settings.airFreq = newL;

            apply_filter_settings();
        }));

        menu.appendChild(createCustomSlider('Comp Width', 100, 7500, 50, currWidth, function(val) {
            let h = (override_settings.compHPF !== null && override_settings.compHPF !== undefined) ? override_settings.compHPF : (base.compHPF || 300);
            let l = (override_settings.compLPF !== null && override_settings.compLPF !== undefined) ? override_settings.compLPF : (base.compLPF || 3000);
            let c = (h + l) / 2;
            let newH = c - val / 2;
            let newL = c + val / 2;
            if (newH < 50) newH = 50;
            if (newL > 8000) newL = 8000;
            override_settings.compHPF = newH;
            override_settings.compLPF = newL;

            override_settings.airFreq = newL;

            apply_filter_settings();
        }));

        var btnDef = document.createElement('button');
        btnDef.textContent = 'Default';
        btnDef.style.cssText = 'margin-top: 5px; width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; user-select: none; -webkit-user-select: none;';
        btnDef.onclick = function() {
            override_settings.maxBoost = null;
            override_settings.gateThresh = null;
            override_settings.hangTime = null;
            override_settings.recoveryTime = null;
            override_settings.compGain = null;
            override_settings.compHPF = null;
            override_settings.compLPF = null;
            override_settings.airGain = null;
            override_settings.airFreq = null;
            saveSettings();
            apply_filter_settings();
            menu.remove();
            show_comp_menu(rect);
        };
        menu.appendChild(btnDef);
        });
    }

    function show_settings_menu(rect) {
        createFloatingMenu('audio-filter-settings-menu', 'Plugin Settings', rect, 150, function(menu) {

        var btnExport = document.createElement('button');
        btnExport.textContent = 'Export Settings';
        btnExport.style.cssText = 'width: 100%; margin-bottom: 5px; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; user-select: none; -webkit-user-select: none;';
        btnExport.onclick = function() {
            var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings_store));
            var downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "audio_filter_settings.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            menu.remove();
        };
        menu.appendChild(btnExport);

        var btnImport = document.createElement('button');
        btnImport.textContent = 'Import Settings';
        btnImport.style.cssText = 'width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; user-select: none; -webkit-user-select: none;';
        btnImport.onclick = function() {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = function(e) {
                var file = e.target.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function(e) {
                    try {
                        var s = JSON.parse(e.target.result);
                        if (s && (s.ssb || s.am)) {
                            settings_store = s;
                            localStorage.setItem('openwebrx-audio-filter-settings', JSON.stringify(settings_store));
                            // Apply current
                            let modKey = get_config_mode(last_modulation);
                            if (settings_store[modKey]) {
                                override_settings = JSON.parse(JSON.stringify(settings_store[modKey]));
                            }
                            apply_filter_settings();
                            update_fil_button_state();
                        } else {
                            alert('Invalid settings file.');
                        }
                    } catch(err) {
                        console.error(`[${PLUGIN_ID}] Error importing settings:`, err);
                        alert('Error importing settings: ' + err.message);
                    }
                };
                reader.readAsText(file);
            };
            input.click();
            menu.remove();
        };
        menu.appendChild(btnImport);
        });
    }

    function show_notch_menu(rect) {
        createFloatingMenu('audio-filter-notch-menu', 'Notch Settings', rect, 200, function(menu) {

        function createSlider(label, key, min, max, step) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';
            
            var defVal = CONFIG[get_config_mode(last_modulation)][key];
            if (defVal === undefined) {
                if (key === 'maxNotches') defVal = 4;
                else if (key === 'notchRange') defVal = 4000;
                else if (key === 'notchCenter') {
                    let nr = (override_settings.notchRange !== null && override_settings.notchRange !== undefined) ? override_settings.notchRange : 4000;
                    defVal = nr / 2;
                }
                else defVal = 30;
            }

            var val = (override_settings[key] !== null && override_settings[key] !== undefined) ? override_settings[key] : defVal;

            var lbl = document.createElement('div');
            lbl.textContent = label + ': ' + val;
            lbl.style.marginBottom = '2px';
            
            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = min;
            inp.max = max;
            inp.step = step;
            inp.value = val;
            inp.style.width = '100%';
            
            inp.oninput = function() {
                var v = parseFloat(inp.value);
                lbl.textContent = label + ': ' + v;
                override_settings[key] = v;
                apply_filter_settings();
            };
            
            inp.onchange = function() {
                saveSettings();
            };
            
            container.appendChild(lbl);
            container.appendChild(inp);
            return container;
        }

        menu.appendChild(createSlider('Notch Q (Sharpness)', 'notchQ', 1, 50, 1));
        menu.appendChild(createSlider('Max Notches', 'maxNotches', 1, 4, 1));
        menu.appendChild(createSlider('Detection Center (Hz)', 'notchCenter', 250, 8000, 50));
        menu.appendChild(createSlider('Detection Width (Hz)', 'notchRange', 500, 8000, 100));
        
        var btnDef = document.createElement('button');
        btnDef.textContent = 'Default';
        btnDef.style.cssText = 'margin-top: 5px; width: 100%; height: 24px; background: #444; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 11px; user-select: none; -webkit-user-select: none;';
        btnDef.onclick = function() {
            override_settings.notchQ = null;
            override_settings.maxNotches = null;
            override_settings.notchRange = null;
            override_settings.notchCenter = null;
            saveSettings();
            menu.remove();
            show_notch_menu(rect);
            apply_filter_settings();
        };
        menu.appendChild(btnDef);
        });
    }

    function show_nr_menu(rect) {
        createFloatingMenu('audio-filter-nr-menu', 'Spectral Noise Reduction', rect, 200, function(menu) {

        function createSlider(label, key, min, max, step, scale) {
            var container = document.createElement('div');
            container.style.marginBottom = '8px';
            
            var defVal = CONFIG[get_config_mode(last_modulation)][key];
            if (defVal === undefined) {
                if (key === 'nr_gain') defVal = 0;
                else if (key === 'nr_alpha') defVal = 0.95;
                else if (key === 'nr_snr') defVal = 10;
                else if (key === 'nr_comb') defVal = 0.5;
            }
            var val = (override_settings[key] !== null && override_settings[key] !== undefined) ? override_settings[key] : defVal;

            var lbl = document.createElement('div');
            lbl.textContent = label + ': ' + (val * (scale || 1)).toFixed(scale ? 0 : 4);
            lbl.style.marginBottom = '2px';
            
            var inp = document.createElement('input');
            inp.type = 'range';
            inp.min = min;
            inp.max = max;
            inp.step = step;
            inp.value = val;
            inp.style.width = '100%';
            
            inp.oninput = function() {
                var v = parseFloat(inp.value);
                lbl.textContent = label + ': ' + (v * (scale || 1)).toFixed(scale ? 0 : 4);
                override_settings[key] = v;
                apply_filter_settings();
            };
            inp.onchange = function() { saveSettings(); };
            
            container.appendChild(lbl);
            container.appendChild(inp);
            return container;
        }

        menu.appendChild(createSlider('Gain (dB)', 'nr_gain', -60, 60, 1, 1));
        menu.appendChild(createSlider('Alpha (Smooth)', 'nr_alpha', 0.90, 0.9999, 0.0001));
        menu.appendChild(createSlider('Active SNR (dB)', 'nr_snr', -10, 40, 1, 1));

        menu.appendChild(createSlider('Comb Strength', 'nr_comb', 0.0, 1.0, 0.05));

        var speechDiv = document.createElement('div');
        speechDiv.style.marginTop = '10px';
        speechDiv.style.borderTop = '1px solid #444';
        speechDiv.style.paddingTop = '5px';
        
        var speechLbl = document.createElement('label');
        speechLbl.style.display = 'flex';
        speechLbl.style.alignItems = 'center';
        speechLbl.style.cursor = 'pointer';
        
        var speechChk = document.createElement('input');
        speechChk.type = 'checkbox';
        
        let modKey = get_config_mode(last_modulation);
        let base = CONFIG[modKey];
        speechChk.checked = (override_settings.nr_speech_mode !== null && override_settings.nr_speech_mode !== undefined) ? override_settings.nr_speech_mode : (base.nr_speech_mode !== undefined ? base.nr_speech_mode : false);

        speechChk.style.marginRight = '8px';
        speechChk.onchange = function() {
            override_settings.nr_speech_mode = speechChk.checked;
            apply_filter_settings();
            saveSettings();
        };
        
        speechLbl.appendChild(speechChk);
        speechLbl.appendChild(document.createTextNode('Speech Mode (Fast Adapt)'));
        speechDiv.appendChild(speechLbl);
        menu.appendChild(speechDiv);
        });
    }

    function update_fil_button_state() {
        var btn = document.getElementById('audio-filter-toggle-btn');
        var panel = document.getElementById('audio-filter-floating-panel');
        if (!btn || !panel) return;

        if (panel.style.display !== 'none') {
            btn.style.color = '#39FF14';
            btn.style.borderColor = '#39FF14';
        } else {
            var active = is_filter_enabled || is_autonotch_enabled || is_nb_enabled || is_compressor_enabled || is_nr_enabled;
            if (active) {
                btn.style.color = 'yellow';
                btn.style.borderColor = 'yellow';
            } else {
                btn.style.color = '#aaa';
                btn.style.borderColor = '#666';
            }
        }
    }

})();
