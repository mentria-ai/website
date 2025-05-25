/**
 * Equalizer - Handles visual equalizer animation
 */
class Equalizer {
    constructor() {
        this.container = document.querySelector('.equalizer');
        this.bars = document.querySelectorAll('.eq-bar');
        this.isActive = false;
        this.animationId = null;
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.source = null;
        
        this.initializeAudioContext();
        this.setupBars();
    }
    
    initializeAudioContext() {
        try {
            // Create audio context for frequency analysis
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 128; // Increased for better frequency resolution
            this.analyser.smoothingTimeConstant = 0.6; // Reduced for more responsive animation
            this.analyser.minDecibels = -90;
            this.analyser.maxDecibels = -10;
            
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength);
            
            // Connect to audio element when available
            this.connectToAudio();
            console.log('🎵 Audio context initialized for equalizer');
        } catch (error) {
            console.warn('Web Audio API not supported, using fallback animation');
            this.useSimpleAnimation = true;
        }
    }
    
    connectToAudio() {
        const audio = document.getElementById('audioPlayer');
        if (audio && this.audioContext && !this.source) {
            try {
                this.source = this.audioContext.createMediaElementSource(audio);
                this.source.connect(this.analyser);
                this.analyser.connect(this.audioContext.destination);
                console.log('🎵 Audio context connected to equalizer');
            } catch (error) {
                console.warn('Could not connect to audio source:', error);
                this.useSimpleAnimation = true;
            }
        }
    }
    
    setupBars() {
        // Set initial random delays for more organic animation
        this.bars.forEach((bar, index) => {
            bar.style.setProperty('--delay', `${index * 0.1}s`);
            bar.style.setProperty('--random-factor', Math.random());
        });
    }
    
    start() {
        if (this.isActive) return;
        
        this.isActive = true;
        this.container.classList.add('active');
        
        // Resume audio context if suspended
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log('🎵 Audio context resumed for equalizer');
            });
        }
        
        // Try to connect to audio if not already connected
        if (!this.source && !this.useSimpleAnimation) {
            this.connectToAudio();
        }
        
        if (this.useSimpleAnimation || !this.source) {
            console.log('🎵 Using fallback animation for equalizer');
            this.startSimpleAnimation();
        } else {
            console.log('🎵 Starting real-time audio analysis for equalizer');
            this.startAudioAnalysis();
        }
    }
    
    stop() {
        if (!this.isActive) return;
        
        this.isActive = false;
        this.container.classList.remove('active');
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // Reset bars to minimum height
        this.bars.forEach(bar => {
            bar.style.height = '15%';
            bar.style.opacity = '0.3';
        });
    }
    
    startAudioAnalysis() {
        if (!this.isActive || !this.analyser) return;
        
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Map frequency data to bars with better frequency distribution
        const barCount = this.bars.length;
        const nyquist = this.audioContext.sampleRate / 2;
        const frequencyBinWidth = nyquist / this.dataArray.length;
        
        this.bars.forEach((bar, index) => {
            // Use logarithmic frequency distribution for better visual representation
            const startFreq = Math.pow(2, (index / barCount) * 10) * 20; // 20Hz to ~20kHz
            const endFreq = Math.pow(2, ((index + 1) / barCount) * 10) * 20;
            
            const startBin = Math.floor(startFreq / frequencyBinWidth);
            const endBin = Math.floor(endFreq / frequencyBinWidth);
            
            // Get average frequency data for this frequency range
            let sum = 0;
            let count = 0;
            
            for (let i = startBin; i <= endBin && i < this.dataArray.length; i++) {
                sum += this.dataArray[i];
                count++;
            }
            
            const average = count > 0 ? sum / count : 0;
            let normalizedValue = average / 255; // Normalize to 0-1
            
            // Apply frequency-based weighting (boost mid frequencies)
            const midFreq = Math.sqrt(startFreq * endFreq);
            let frequencyWeight = 1.0;
            
            if (midFreq < 200) {
                // Bass frequencies - slight boost
                frequencyWeight = 1.2;
            } else if (midFreq < 2000) {
                // Mid frequencies - significant boost
                frequencyWeight = 1.5;
            } else if (midFreq < 8000) {
                // High-mid frequencies - moderate boost
                frequencyWeight = 1.3;
            } else {
                // High frequencies - normal
                frequencyWeight = 1.0;
            }
            
            normalizedValue *= frequencyWeight;
            normalizedValue = Math.min(normalizedValue, 1.0);
            
            // Apply exponential scaling for better visual dynamics
            normalizedValue = Math.pow(normalizedValue, 0.7);
            
            // Set minimum and maximum heights
            const minHeight = 0.15;
            const maxHeight = 0.95;
            const height = minHeight + (normalizedValue * (maxHeight - minHeight));
            
            // Smooth the animation with CSS transitions
            bar.style.height = `${height * 100}%`;
            
            // Add subtle opacity variation based on intensity
            const opacity = 0.6 + (normalizedValue * 0.4);
            bar.style.opacity = opacity;
        });
        
        this.animationId = requestAnimationFrame(() => this.startAudioAnalysis());
    }
    
    startSimpleAnimation() {
        if (!this.isActive) return;
        
        // Simple sine wave animation as fallback
        const time = Date.now() * 0.001;
        
        this.bars.forEach((bar, index) => {
            const randomFactor = parseFloat(bar.style.getPropertyValue('--random-factor')) || 0.5;
            const frequency = 0.5 + randomFactor * 2; // Vary frequency per bar
            const phase = index * 0.5; // Phase offset
            const amplitude = 0.3 + randomFactor * 0.5; // Vary amplitude
            
            const height = 0.15 + amplitude * (0.5 + 0.5 * Math.sin(time * frequency + phase));
            bar.style.height = `${height * 100}%`;
        });
        
        this.animationId = requestAnimationFrame(() => this.startSimpleAnimation());
    }
    
    // Preset animations for different moods
    setMood(mood) {
        this.bars.forEach((bar, index) => {
            switch (mood) {
                case 'calm':
                    bar.style.animationDuration = '2s';
                    bar.style.setProperty('--max-height', '60%');
                    break;
                case 'energetic':
                    bar.style.animationDuration = '0.8s';
                    bar.style.setProperty('--max-height', '100%');
                    break;
                case 'ambient':
                    bar.style.animationDuration = '3s';
                    bar.style.setProperty('--max-height', '40%');
                    break;
                default:
                    bar.style.animationDuration = '1.5s';
                    bar.style.setProperty('--max-height', '80%');
            }
        });
    }
    
    // Manual control for testing
    setBarsHeight(heights) {
        if (!Array.isArray(heights)) return;
        
        this.bars.forEach((bar, index) => {
            if (index < heights.length) {
                const height = Math.max(0.2, Math.min(1, heights[index]));
                bar.style.height = `${height * 100}%`;
            }
        });
    }
    
    // Pulse effect for beats
    pulse() {
        this.container.style.transform = 'scale(1.05)';
        setTimeout(() => {
            this.container.style.transform = 'scale(1)';
        }, 100);
    }
    
    // Responsive design adjustments
    updateForScreenSize() {
        const isMobile = window.innerWidth <= 768;
        const barCount = isMobile ? 12 : 20;
        
        // This would require recreating bars, for now just adjust existing ones
        this.bars.forEach((bar, index) => {
            if (isMobile && index >= 12) {
                bar.style.display = 'none';
            } else {
                bar.style.display = 'block';
            }
        });
    }
    
    // Cleanup
    destroy() {
        this.stop();
        
        if (this.audioContext) {
            this.audioContext.close();
        }
        
        if (this.source) {
            this.source.disconnect();
        }
    }
}

// Initialize equalizer when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.equalizer = new Equalizer();
    
    // Handle window resize
    window.addEventListener('resize', () => {
        if (window.equalizer) {
            window.equalizer.updateForScreenSize();
        }
    });
    
    // Handle visibility change to pause/resume animation
    document.addEventListener('visibilitychange', () => {
        if (window.equalizer && window.audioEngine) {
            if (document.hidden && window.audioEngine.getIsPlaying()) {
                // Keep playing but reduce animation intensity
                window.equalizer.setMood('calm');
            } else if (!document.hidden && window.audioEngine.getIsPlaying()) {
                // Resume normal animation
                window.equalizer.setMood('normal');
            }
        }
    });
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Equalizer;
} 