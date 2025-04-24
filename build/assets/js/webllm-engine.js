/**
 * WebLLM Engine
 * 
 * Handles integration with WebLLM library to run LLMs directly in the browser.
 * Supports both the official WebLLM library and a simplified fallback.
 */

class WebLLMEngine {
    constructor() {
        this.modelId = null;
        this.model = null;
        this.chat = null;
        this.isModelLoaded = false;
        this.localFiles = null;
        this.usingOfficialLibrary = false;
        this.debugMode = false;
        
        // Define default models
        this.customAppConfig = {
            "model_list": [
                {
                    "model_url": "https://huggingface.co/mlc-ai/phi-2-q4f32_1-MLC/resolve/main/",
                    "model_id": "Phi-2",
                    "model_lib_url": "https://raw.githubusercontent.com/mlc-ai/web-llm/main/lib/",
                    "required_features": ["shader-f16"],
                    "local_id": "Phi-2-GPTQ",
                    "model_size_in_b": 2.7,
                    "context_size": 2048,
                    "description": "A lightweight 2.7B model from Microsoft."
                },
                {
                    "model_url": "https://huggingface.co/mlc-ai/gemma-2b-it-GPTQ/resolve/main/",
                    "model_id": "Gemma-2b-it-GPTQ",
                    "model_lib_url": "https://raw.githubusercontent.com/mlc-ai/web-llm/main/lib/",
                    "required_features": ["shader-f16"],
                    "local_id": "Gemma-2b-it-GPTQ",
                    "model_size_in_b": 2,
                    "context_size": 8192,
                    "description": "A lightweight 2B instruction-tuned model from Google."
                },
                {
                    "model_url": "https://huggingface.co/mlc-ai/Llama-3.1-8B-Instruct-q4f32_1-MLC/resolve/main/",
                    "model_id": "Llama-3.1-8B-Instruct-q4f32_1-MLC",
                    "model_lib_url": "https://raw.githubusercontent.com/mlc-ai/web-llm/main/lib/",
                    "required_features": ["shader-f16"],
                    "local_id": "Llama-3.1-8B-Instruct-q4f32_1-MLC",
                    "model_size_in_b": 8,
                    "context_size": 8192,
                    "description": "Llama 3.1 8B instruction-tuned model from Meta."
                }
            ]
        };
    }

    // Enable debug mode
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    // Log debug messages
    log(...args) {
        if (this.debugMode) {
            console.log('[WebLLM]', ...args);
        }
    }

    // Set local model files
    setLocalFiles(files) {
        this.localFiles = files;
    }

    // Method to set WebLLM library as available globally
    setLibraryAvailable() {
        if (typeof WebLLM !== 'undefined') {
            this.usingOfficialLibrary = true;
            this.log('Found global WebLLM library, marking as available');
        }
    }

    // Check if a model is loaded
    isLoaded() {
        return this.isModelLoaded && this.chat !== null;
    }

    // Initialize the engine with a specific model
    async initialize(modelId, callbacks = {}) {
        this.modelId = modelId;
        this.isModelLoaded = false;
        
        // Default callbacks
        const defaultCallbacks = {
            onInit: (msg) => this.log('Initializing:', msg),
            onProgress: (report) => this.log('Progress:', report),
            onLoad: (msg) => this.log('Loaded:', msg),
            onError: (error) => console.error('[WebLLM Error]', error)
        };
        
        // Merge default callbacks with provided callbacks
        const mergedCallbacks = { ...defaultCallbacks, ...callbacks };
        
        try {
            // Check if we have local files
            if (modelId === 'local-model' && this.localFiles) {
                return await this.initializeWithLocalFiles(mergedCallbacks);
            }
            
            // Check if the WebLLM library is available
            if (typeof WebLLM !== 'undefined') {
                return await this.initializeWithOfficialLibrary(modelId, mergedCallbacks);
            } else {
                return await this.initializeWithSimplifiedLibrary(modelId, mergedCallbacks);
            }
        } catch (error) {
            mergedCallbacks.onError(error.message || 'Failed to initialize WebLLM');
            throw error;
        }
    }
    
    // Initialize with local model files
    async initializeWithLocalFiles(callbacks) {
        if (!this.localFiles || this.localFiles.length === 0) {
            throw new Error('No local files provided');
        }
        
        callbacks.onInit('Initializing with local model files');
        
        try {
            // Check if WebLLM library is available
            if (typeof WebLLM === 'undefined') {
                throw new Error('WebLLM library is not available for local file loading');
            }
            
            this.usingOfficialLibrary = true;
            
            // Create a chat instance and initialize it with local files
            this.chat = new WebLLM.ChatModule();

            // Initialize with progress reporting
            await this.chat.reload({
                model_list: this.customAppConfig.model_list,
                local_files: Array.from(this.localFiles)
            }, {
                use_web_worker: true,
                progress_callback: (report) => {
                    callbacks.onProgress(report);
                }
            });
            
            this.isModelLoaded = true;
            callbacks.onLoad('Local model loaded successfully');
            return true;
        } catch (error) {
            callbacks.onError(`Error loading local model: ${error.message}`);
            throw error;
        }
    }

    // Initialize with the official WebLLM library
    async initializeWithOfficialLibrary(modelId, callbacks) {
        try {
            callbacks.onInit(`Initializing WebLLM with model: ${modelId}`);
            this.usingOfficialLibrary = true;
            
            // Create chat instance
            this.chat = new WebLLM.ChatModule();

            // Configure custom model list
            const initOptions = {
                model_list: this.customAppConfig.model_list
            };
            
            // Initialize with progress reporting
            await this.chat.reload(initOptions, {
                model: modelId,
                use_web_worker: true,
                progress_callback: (report) => {
                    callbacks.onProgress(report);
                }
            });
            
            this.isModelLoaded = true;
            callbacks.onLoad(`Model "${modelId}" loaded successfully`);
            return true;
        } catch (error) {
            callbacks.onError(`Failed to initialize WebLLM with model "${modelId}": ${error.message}`);
            this.isModelLoaded = false;
            throw error;
        }
    }

    // Initialize with a simplified library (fallback)
    async initializeWithSimplifiedLibrary(modelId, callbacks) {
        try {
            callbacks.onInit(`Initializing simplified WebLLM with model: ${modelId}`);
            this.usingOfficialLibrary = false;
            
            // Create a very basic chat implementation
            this.chat = {
                generate: async (prompt) => {
                    // Simple mock implementation
                    const responsePrefixes = {
                        'Phi-2': 'As a helpful AI assistant based on Microsoft Phi-2, I can tell you that ',
                        'Gemma-2b-it-GPTQ': 'Based on my training as Gemma 2B, ',
                        'Llama-3.1-8B-Instruct-q4f32_1-MLC': 'I\'m Llama 3, a helpful AI assistant. ',
                        'local-model': 'As your custom loaded AI model, '
                    };
                    
                    // Return a mock response based on model ID
                    return responsePrefixes[modelId] || 'As an AI assistant, ' + 
                        'I notice the WebLLM library isn\'t available in your browser. ' +
                        'You might need to include the library script or try using a supported browser. ' +
                        'For compatibility, using Chrome or Edge is recommended for WebGPU support.';
                }
            };
            
            // Simulate loading time for UX
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Report progress a few times to simulate loading
            for (let i = 1; i <= 3; i++) {
                callbacks.onProgress({
                    progress: i * 30,
                    total_size_bytes: 100,
                    status: 'Simulating model load'
                });
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            this.isModelLoaded = true;
            
            callbacks.onLoad(
                `Simplified implementation loaded (WebLLM library not detected). ` +
                `This is a limited simulation and won't provide actual model responses.`
            );
            
            return true;
        } catch (error) {
            callbacks.onError(`Failed to initialize simplified WebLLM: ${error.message}`);
            this.isModelLoaded = false;
            throw error;
        }
    }

    // Generate a response to user input
    async generateResponse(userMessage, streamCallback = null) {
        if (!this.isLoaded()) {
            throw new Error('Model not loaded. Please initialize a model first.');
        }

        try {
            // If using the official library
            if (this.usingOfficialLibrary) {
                // Prepare the chat message
                const chatOpts = { 
                    // system prompt to make it behave properly
                    system: "You are a helpful AI assistant. Provide accurate, concise, and helpful responses.",
                    temperature: 0.7,
                    max_gen_len: 512
                };
                
                // Handle streaming
                if (streamCallback) {
                    let fullResponse = '';
                    
                    await this.chat.generate(userMessage, {
                        ...chatOpts,
                        callback: (response) => {
                            const newToken = response.substring(fullResponse.length);
                            fullResponse = response;
                            if (newToken && streamCallback) {
                                streamCallback(newToken);
                            }
                        }
                    });
                    
                    return fullResponse;
                } else {
                    // Non-streaming response
                    const response = await this.chat.generate(userMessage, chatOpts);
                    return response;
                }
            } else {
                // For simplified library
                const response = await this.chat.generate(userMessage);
                
                // If streaming callback provided, simulate streaming
                if (streamCallback) {
                    const words = response.split(' ');
                    let fullText = '';
                    
                    // Simulate token-by-token streaming
                    for (const word of words) {
                        await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 70));
                        fullText += (fullText ? ' ' : '') + word;
                        streamCallback(word + (word === words[words.length - 1] ? '' : ' '));
                    }
                    
                    return fullText;
                }
                
                return response;
            }
        } catch (error) {
            console.error('Error generating response:', error);
            throw new Error(`Failed to generate response: ${error.message}`);
        }
    }
}

// Create and expose the engine globally
window.webLLMEngine = new WebLLMEngine(); 