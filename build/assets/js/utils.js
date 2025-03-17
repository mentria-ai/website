// Shared utilities
window.debug = {
    isDevEnvironment: () => {
        return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    },
    createLogger: (prefix) => ({
        log: (...args) => {
            if (window.debug.isDevEnvironment()) {
                console.log(`[${prefix}]`, ...args);
            }
        },
        error: (...args) => {
            if (window.debug.isDevEnvironment()) {
                console.error(`[${prefix}]`, ...args);
            }
        }
    })
}; 