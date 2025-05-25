/**
 * Radio App - Main application controller
 */
class RadioApp {
    constructor() {
        this.isInitialized = false;
        this.keyboardShortcuts = {
            'Space': 'togglePlayPause',
            'ArrowRight': 'nextTrack',
            'ArrowLeft': 'previousTrack',
            'ArrowUp': 'volumeUp',
            'ArrowDown': 'volumeDown',
            'KeyM': 'toggleMute',
            'KeyS': 'toggleShuffle',
            'KeyR': 'toggleRepeat',
            'KeyF': 'refreshPlaylist'
        };
        
        this.init();
    }
    
    async init() {
        try {
            // Wait for all components to be ready
            await this.waitForComponents();
            
            // Initialize keyboard shortcuts
            this.initKeyboardShortcuts();
            
            // Initialize media session API
            this.initMediaSession();
            
            // Initialize PWA features
            this.initPWA();
            
            // Performance monitoring disabled for better performance
            
            // Mark as initialized
            this.isInitialized = true;
            
            console.log('🎵 OctoBeats Radio initialized successfully');
            
            // Show welcome message if no tracks
            this.checkForWelcomeMessage();
            
        } catch (error) {
            console.error('Failed to initialize Radio App:', error);
            this.showError('Failed to initialize application');
        }
    }
    
    async waitForComponents() {
        // Wait for all components to be available
        const maxWait = 5000; // 5 seconds
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWait) {
            if (window.audioEngine && window.equalizer && window.playlist) {
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        throw new Error('Components failed to initialize within timeout');
    }
    
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            // Don't handle shortcuts if user is typing in an input
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }
            
            const action = this.keyboardShortcuts[event.code];
            if (action && this[action]) {
                event.preventDefault();
                this[action]();
            }
        });
        
        console.log('⌨️ Keyboard shortcuts initialized');
    }
    
    initMediaSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => {
                if (window.audioEngine) {
                    window.audioEngine.play();
                }
            });
            
            navigator.mediaSession.setActionHandler('pause', () => {
                if (window.audioEngine) {
                    window.audioEngine.pause();
                }
            });
            
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                this.previousTrack();
            });
            
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                this.nextTrack();
            });
            
            navigator.mediaSession.setActionHandler('seekto', (details) => {
                if (window.audioEngine && details.seekTime) {
                    window.audioEngine.audio.currentTime = details.seekTime;
                }
            });
            
            console.log('📱 Media Session API initialized');
        }
    }
    
    initPWA() {
        // Handle install prompt
        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            this.deferredPrompt = event;
            this.showInstallButton();
        });
        
        // Handle app installed
        window.addEventListener('appinstalled', () => {
            console.log('📱 OctoBeats Radio installed as PWA');
            this.hideInstallButton();
        });
        
        // Handle online/offline status
        window.addEventListener('online', () => {
            this.updateConnectionStatus(true);
        });
        
        window.addEventListener('offline', () => {
            this.updateConnectionStatus(false);
        });
        
        console.log('📱 PWA features initialized');
    }
    

    
    // Keyboard shortcut handlers
    togglePlayPause() {
        if (window.audioEngine) {
            window.audioEngine.togglePlayPause();
        }
    }
    
    nextTrack() {
        if (window.playlist) {
            window.playlist.nextTrack();
        }
    }
    
    previousTrack() {
        if (window.playlist) {
            window.playlist.previousTrack();
        }
    }
    
    volumeUp() {
        if (window.audioEngine) {
            const currentVolume = window.audioEngine.getVolume();
            window.audioEngine.setVolume(Math.min(1, currentVolume + 0.1));
        }
    }
    
    volumeDown() {
        if (window.audioEngine) {
            const currentVolume = window.audioEngine.getVolume();
            window.audioEngine.setVolume(Math.max(0, currentVolume - 0.1));
        }
    }
    
    toggleMute() {
        if (window.audioEngine) {
            window.audioEngine.toggleMute();
        }
    }
    
    toggleShuffle() {
        if (window.audioEngine) {
            window.audioEngine.toggleShuffle();
        }
    }
    
    toggleRepeat() {
        if (window.audioEngine) {
            window.audioEngine.toggleRepeat();
        }
    }
    
    refreshPlaylist() {
        if (window.playlist) {
            window.playlist.refreshPlaylist();
        }
    }
    
    // PWA methods
    showInstallButton() {
        // Create install button if it doesn't exist
        if (!document.getElementById('installBtn')) {
            const installBtn = document.createElement('button');
            installBtn.id = 'installBtn';
            installBtn.className = 'install-btn';
            installBtn.innerHTML = '<i class="fas fa-download"></i> Install App';
            installBtn.title = 'Install OctoBeats Radio';
            
            installBtn.addEventListener('click', () => {
                this.installApp();
            });
            
            document.querySelector('.radio-header').appendChild(installBtn);
        }
    }
    
    hideInstallButton() {
        const installBtn = document.getElementById('installBtn');
        if (installBtn) {
            installBtn.remove();
        }
    }
    
    async installApp() {
        if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            const { outcome } = await this.deferredPrompt.userChoice;
            
            if (outcome === 'accepted') {
                console.log('📱 User accepted the install prompt');
            } else {
                console.log('📱 User dismissed the install prompt');
            }
            
            this.deferredPrompt = null;
        }
    }
    
    updateConnectionStatus(isOnline) {
        const statusText = document.querySelector('.status-text');
        const statusDot = document.querySelector('.status-dot');
        
        if (statusText && statusDot) {
            if (isOnline) {
                statusText.textContent = 'Online';
                statusDot.style.backgroundColor = 'var(--success-color)';
            } else {
                statusText.textContent = 'Offline';
                statusDot.style.backgroundColor = 'var(--warning-color)';
            }
        }
    }
    
    // Media Session updates
    updateMediaSession(track) {
        if ('mediaSession' in navigator && track) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: track.title || 'Unknown Track',
                artist: track.artist || 'mentria.ai',
                album: 'Generated Music',
                artwork: [
                    { src: '/favicon.ico', sizes: '96x96', type: 'image/x-icon' }
                ]
            });
        }
    }
    
    // Welcome and help
    checkForWelcomeMessage() {
        setTimeout(() => {
            if (window.playlist && window.playlist.getTrackCount() === 0) {
                this.showWelcomeMessage();
            }
        }, 2000);
    }
    
    showWelcomeMessage() {
        const welcomeHtml = `
            <div class="welcome-message">
                <h3>🎵 Welcome to OctoBeats Radio!</h3>
                <p>Generate music using the OctoBeats workflow to see tracks here.</p>
                <div class="keyboard-shortcuts">
                    <h4>Keyboard Shortcuts:</h4>
                    <div class="shortcuts-grid">
                        <span><kbd>Space</kbd> Play/Pause</span>
                        <span><kbd>←</kbd> Previous</span>
                        <span><kbd>→</kbd> Next</span>
                        <span><kbd>↑</kbd> Volume Up</span>
                        <span><kbd>↓</kbd> Volume Down</span>
                        <span><kbd>M</kbd> Mute</span>
                        <span><kbd>S</kbd> Shuffle</span>
                        <span><kbd>R</kbd> Repeat</span>
                        <span><kbd>F</kbd> Refresh</span>
                    </div>
                </div>
                <button class="close-welcome" onclick="this.parentElement.remove()">
                    <i class="fas fa-times"></i> Got it
                </button>
            </div>
        `;
        
        const welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'welcome-overlay';
        welcomeDiv.innerHTML = welcomeHtml;
        
        document.body.appendChild(welcomeDiv);
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            if (welcomeDiv.parentElement) {
                welcomeDiv.remove();
            }
        }, 10000);
    }
    
    // Error handling
    showError(message) {
        if (window.audioEngine) {
            window.audioEngine.showError(message);
        } else {
            console.error(message);
        }
    }
    
    // Analytics and tracking (privacy-friendly)
    trackEvent(event, data = {}) {
        // Simple console logging for now
        // In production, you might want to use a privacy-friendly analytics service
        console.log(`📊 Event: ${event}`, data);
    }
    
    // Cleanup
    destroy() {
        // Remove event listeners
        document.removeEventListener('keydown', this.keyboardShortcuts);
        
        // Cleanup components
        if (window.equalizer) {
            window.equalizer.destroy();
        }
        
        console.log('🧹 Radio App cleaned up');
    }
}

// CSS for welcome message and install button
const additionalStyles = `
.install-btn {
    padding: 0.5rem 1rem;
    background: var(--accent-primary);
    color: var(--text-primary);
    border: none;
    border-radius: var(--radius-md);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all var(--transition-normal);
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.install-btn:hover {
    background: var(--accent-secondary);
    transform: translateY(-1px);
}

.welcome-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(10, 10, 10, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
    animation: fadeIn 0.3s ease;
}

.welcome-message {
    background: var(--bg-secondary);
    border-radius: var(--radius-xl);
    padding: var(--spacing-2xl);
    max-width: 500px;
    text-align: center;
    border: 1px solid var(--border-color);
}

.welcome-message h3 {
    margin-bottom: var(--spacing-lg);
    color: var(--accent-primary);
}

.welcome-message p {
    margin-bottom: var(--spacing-xl);
    color: var(--text-secondary);
}

.keyboard-shortcuts {
    margin-bottom: var(--spacing-xl);
    text-align: left;
}

.keyboard-shortcuts h4 {
    margin-bottom: var(--spacing-md);
    color: var(--text-primary);
}

.shortcuts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-sm);
    font-size: 0.875rem;
}

.shortcuts-grid span {
    color: var(--text-secondary);
}

.shortcuts-grid kbd {
    background: var(--bg-tertiary);
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--text-primary);
    margin-right: 0.5rem;
}

.close-welcome {
    background: var(--accent-primary);
    color: var(--text-primary);
    border: none;
    padding: var(--spacing-md) var(--spacing-lg);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-normal);
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    margin: 0 auto;
}

.close-welcome:hover {
    background: var(--accent-secondary);
    transform: translateY(-1px);
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@media (max-width: 480px) {
    .welcome-message {
        margin: var(--spacing-lg);
        padding: var(--spacing-lg);
    }
    
    .shortcuts-grid {
        grid-template-columns: 1fr;
    }
}
`;

// Inject additional styles
const styleSheet = document.createElement('style');
styleSheet.textContent = additionalStyles;
document.head.appendChild(styleSheet);

// Initialize the radio app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.radioApp = new RadioApp();
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (window.radioApp) {
        window.radioApp.destroy();
    }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RadioApp;
} 