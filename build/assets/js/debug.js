/**
 * Simple debug logging utility
 */
window.debug = (function() {
    const DEBUG_ENABLED = true;
    
    // Create a logger with a specific namespace
    function createLogger(namespace) {
        return {
            info: function(message, ...args) {
                if (!DEBUG_ENABLED) return;
                console.info(`[${namespace}]`, message, ...args);
            },
            warn: function(message, ...args) {
                if (!DEBUG_ENABLED) return;
                console.warn(`[${namespace}]`, message, ...args);
            },
            error: function(message, ...args) {
                if (!DEBUG_ENABLED) return;
                console.error(`[${namespace}]`, message, ...args);
            }
        };
    }
    
    return {
        createLogger: createLogger
    };
})(); 