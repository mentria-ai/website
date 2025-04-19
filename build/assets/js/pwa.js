// PWA functionality for Mentria.AI

// Initialize PWA features when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Register service worker
  registerServiceWorker();
  
  // Setup install prompt handling
  setupInstallPrompt();

  // Initialize offline support
  initOfflineSupport();
  
  // Listen for media loading to precache quotes
  setupPrecaching();
});

// Register service worker
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then(registration => {
          console.log('PWA: Service Worker registered successfully with scope:', registration.scope);
        })
        .catch(error => {
          console.error('PWA: Service Worker registration failed:', error);
        });
    });
  } else {
    console.log('PWA: Service workers not supported in this browser');
  }
}

// Install prompt handling
let deferredPrompt;
function setupInstallPrompt() {
  // Store the install prompt event for later use
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // Prevent automatic browser prompt
    deferredPrompt = e; // Save event for later use
    
    // Optionally show custom UI to suggest installation
    showInstallBanner();
  });
  
  // Listen for successful installation
  window.addEventListener('appinstalled', () => {
    console.log('PWA: App was installed');
    hideInstallBanner(); // Hide install banner if shown
    deferredPrompt = null; // Clear the saved prompt
    
    // Send analytics
    if (typeof gtag === 'function') {
      gtag('event', 'pwa_installed');
    }
  });
}

// Show installation banner for 30 seconds
function showInstallBanner() {
  // Check if user has previously dismissed the banner
  const hasUserDismissedBanner = localStorage.getItem('installBannerDismissed');
  if (hasUserDismissedBanner === 'true') {
    return;
  }
  
  // Wait 30 seconds before showing the banner to avoid interrupting initial experience
  setTimeout(() => {
    // Create banner element if it doesn't exist
    if (!document.getElementById('install-banner')) {
      const banner = document.createElement('div');
      banner.id = 'install-banner';
      banner.className = 'install-banner';
      banner.innerHTML = `
        <div class="install-banner-content">
          <div class="install-banner-text">
            <strong>Install Mentria.AI</strong>
            <span>Add to your home screen for offline access</span>
          </div>
          <div class="install-banner-actions">
            <button id="install-button">Install</button>
            <button id="dismiss-button">Not Now</button>
          </div>
        </div>
      `;
      
      // Add banner to the page
      document.body.appendChild(banner);
      
      // Show the banner with animation
      setTimeout(() => {
        banner.classList.add('show');
      }, 100);
      
      // Set up event listeners
      document.getElementById('install-button').addEventListener('click', promptInstall);
      document.getElementById('dismiss-button').addEventListener('click', dismissInstallBanner);
    }
  }, 30000); // Show after 30 seconds
}

// Hide installation banner
function hideInstallBanner() {
  const banner = document.getElementById('install-banner');
  if (banner) {
    banner.classList.remove('show');
    setTimeout(() => {
      banner.remove();
    }, 300); // Wait for animation to complete
  }
}

// User dismissed the install banner
function dismissInstallBanner() {
  localStorage.setItem('installBannerDismissed', 'true');
  hideInstallBanner();
}

// Show the install prompt
function promptInstall() {
  if (!deferredPrompt) {
    console.log('PWA: No installation prompt available');
    return;
  }
  
  // Show the browser install prompt
  deferredPrompt.prompt();
  
  // Wait for user's choice
  deferredPrompt.userChoice.then(choiceResult => {
    if (choiceResult.outcome === 'accepted') {
      console.log('PWA: User accepted the installation');
    } else {
      console.log('PWA: User dismissed the installation');
    }
    
    // Clear the deferred prompt variable
    deferredPrompt = null;
  });
  
  // Hide custom banner
  hideInstallBanner();
}

// Initialize offline support
function initOfflineSupport() {
  // Create IndexedDB for offline likes if needed
  setupOfflineLikes();
  
  // Register sync event listener for offline likes
  registerBackgroundSync();
  
  // Listen for online/offline events
  window.addEventListener('online', handleOnlineStatus);
  window.addEventListener('offline', handleOfflineStatus);
  
  // Initial check
  if (!navigator.onLine) {
    handleOfflineStatus();
  }
}

// Handle device coming online
function handleOnlineStatus() {
  console.log('PWA: Device is online');
  
  // Remove offline notification if present
  const offlineNotice = document.getElementById('offline-notice');
  if (offlineNotice) {
    offlineNotice.classList.remove('show');
    setTimeout(() => offlineNotice.remove(), 300);
  }
  
  // Trigger sync for pending operations
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(registration => {
      registration.sync.register('sync-likes');
    });
  }
}

// Handle device going offline
function handleOfflineStatus() {
  console.log('PWA: Device is offline');
  
  // Show offline notification if not already present
  if (!document.getElementById('offline-notice')) {
    const notice = document.createElement('div');
    notice.id = 'offline-notice';
    notice.className = 'offline-notice';
    notice.textContent = 'You are currently offline. Some features may be limited.';
    
    document.body.appendChild(notice);
    setTimeout(() => notice.classList.add('show'), 10);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      notice.classList.remove('show');
      setTimeout(() => notice.remove(), 300);
    }, 5000);
  }
}

// Setup IndexedDB for storing likes offline
function setupOfflineLikes() {
  // This is a simplified version - in a real app, use proper IndexedDB implementation
  // For now, we'll just use localStorage as a mock
  if (!localStorage.getItem('pendingLikes')) {
    localStorage.setItem('pendingLikes', JSON.stringify([]));
  }
}

// Register background sync for offline operations
function registerBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(registration => {
      // Register sync
      registration.sync.register('sync-likes').catch(error => {
        console.error('PWA: Background sync registration failed:', error);
      });
    });
  }
}

// Add a like to offline storage when offline
function addOfflineLike(quoteId, action) {
  if (!navigator.onLine) {
    // Store in pending likes
    const pendingLikes = JSON.parse(localStorage.getItem('pendingLikes') || '[]');
    pendingLikes.push({
      id: Date.now().toString(), // Simple unique ID
      quoteId: quoteId,
      action: action, // 'add' or 'remove'
      timestamp: Date.now()
    });
    localStorage.setItem('pendingLikes', JSON.stringify(pendingLikes));
    
    // Register sync if possible
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then(registration => {
        registration.sync.register('sync-likes');
      });
    }
  }
}

// Setup precaching for quotes
function setupPrecaching() {
  // Wait for quotes to load
  document.addEventListener('quotesLoaded', function(e) {
    if ('serviceWorker' in navigator) {
      // Get all quotes
      const quotes = e.detail.quotes || [];
      
      // Extract image and audio URLs
      const imageUrls = quotes.map(quote => quote.image ? `/assets/img/quotes/${quote.image}` : null).filter(Boolean);
      const audioUrls = quotes.map(quote => quote.audio ? `/assets/audio/quotes/${quote.audio}` : null).filter(Boolean);
      
      // Combine all URLs
      const urlsToCache = [...imageUrls, ...audioUrls];
      
      // Send message to service worker to cache these URLs
      navigator.serviceWorker.ready.then(registration => {
        if (registration.active) {
          registration.active.postMessage({
            type: 'CACHE_QUOTES',
            urls: urlsToCache
          });
        }
      });
    }
  });
}

// Add custom event to notify when like button is clicked
document.addEventListener('DOMContentLoaded', function() {
  const likeBtn = document.getElementById('likeBtn');
  if (likeBtn) {
    // Store original click handler
    const originalClickHandler = likeBtn.onclick;
    
    // Override with new handler
    likeBtn.onclick = function(e) {
      // Get current quote ID from the page
      const currentQuoteId = window.quoteNavigation ? window.quoteNavigation.getCurrentQuoteId() : null;
      
      if (currentQuoteId) {
        // Determine if we're liking or unliking
        const isLiked = likeBtn.querySelector('i').classList.contains('fas');
        const action = isLiked ? 'remove' : 'add';
        
        // If offline, handle specially
        if (!navigator.onLine) {
          addOfflineLike(currentQuoteId, action);
        }
      }
      
      // Call original handler if it exists
      if (typeof originalClickHandler === 'function') {
        originalClickHandler.call(this, e);
      }
    };
  }
}); 