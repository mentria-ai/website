/**
 * Together AI API integration for GitHub Actions assistants
 */
const { execSync } = require('child_process');
const fs = require('fs');

/**
 * Call Together AI API with retry logic
 * @param {object} options - API call options
 * @param {string} options.model - The Together AI model to use
 * @param {array} options.messages - Array of message objects
 * @param {string} options.apiKey - Together AI API key
 * @param {string} options.logFile - Path to log file
 * @param {object} options.logger - Logger object
 * @param {boolean} options.useBase64 - Whether to use base64 encoding for payload
 * @returns {object} - Response object with content, success flag, and stats
 */
async function callTogetherAI(options) {
  const {
    model = "deepseek-ai/DeepSeek-R1",
    messages,
    apiKey,
    logFile,
    logger,
    useBase64 = false
  } = options;
  
  if (!apiKey) {
    logger.logError(logFile, "Missing Together API key");
    return { success: false, content: null, error: "Missing API key" };
  }
  
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    logger.logError(logFile, "Invalid messages format");
    return { success: false, content: null, error: "Invalid messages format" };
  }
  
  // Create response directories
  if (!fs.existsSync('response_files')) {
    fs.mkdirSync('response_files', { recursive: true });
  }
  
  // Prepare the payload
  const payload = {
    model,
    messages
  };
  
  // Write payload to file for curl
  const payloadFile = 'response_files/payload.json';
  fs.writeFileSync(payloadFile, JSON.stringify(payload, null, 2));
  logger.logSuccess(logFile, `Payload written to ${payloadFile}`);
  logger.logMessage(logFile, `- Payload size: ${fs.statSync(payloadFile).size} bytes`);
  
  // Add retry logic
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let success = false;
  let content = null;
  let error = null;
  let responseStats = {};
  
  // Main API calling loop
  while (retryCount < MAX_RETRIES && !success) {
    if (retryCount > 0) {
      const backoff = Math.pow(2, retryCount) + Math.floor(Math.random() * 5);
      logger.logMessage(logFile, `- 🔄 Retry attempt ${retryCount}... (waiting ${backoff}s)`);
      await new Promise(resolve => setTimeout(resolve, backoff * 1000));
    }
    
    logger.logMessage(logFile, `- Sending API request (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
    const startTime = Date.now();
    const responseFile = `response_files/api_response_${retryCount}.json`;
    const statsFile = `response_files/stats_${retryCount}.txt`;
    
    try {
      // Execute curl command with appropriate timeout
      const timeout = 30 + (retryCount * 30); // Increase timeout for retries
      
      execSync(
        `curl -s -X POST "https://api.together.xyz/v1/chat/completions" ` +
        `-H "Authorization: Bearer ${apiKey}" ` +
        `-H "Content-Type: application/json" ` +
        `-H "User-Agent: GitHub-Actions-Assistant" ` +
        `--retry 2 --retry-delay 2 --max-time ${timeout} ` +
        `-d @${payloadFile} ` +
        `-o ${responseFile} ` +
        `-w "%{http_code}|%{time_total}|%{size_download}" > ${statsFile}`
      );
      
      // Parse stats
      const stats = fs.readFileSync(statsFile, 'utf8').split('|');
      const httpStatus = stats[0];
      const timeTotal = stats[1];
      const sizeDownload = stats[2];
      
      responseStats = {
        httpStatus,
        timeTotal,
        sizeDownload,
        attempt: retryCount + 1
      };
      
      logger.logMessage(logFile, `- API request completed:`);
      logger.logMessage(logFile, `  - HTTP status: ${httpStatus}`);
      logger.logMessage(logFile, `  - Response time: ${timeTotal}s`);
      logger.logMessage(logFile, `  - Response size: ${sizeDownload} bytes`);
      
      // Check HTTP status
      if (httpStatus.startsWith('2')) {
        // Validate response
        if (fs.existsSync(responseFile) && fs.statSync(responseFile).size > 0) {
          const responseData = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
          
          // Check for valid response structure
          if (responseData.choices && 
              responseData.choices.length > 0 && 
              responseData.choices[0].message && 
              responseData.choices[0].message.content) {
            
            content = responseData.choices[0].message.content;
            success = true;
            
            // Save full response metadata
            const metadata = {
              model: responseData.model,
              usage: responseData.usage,
              created: responseData.created,
              finish_reason: responseData.choices[0].finish_reason,
              response_time: timeTotal,
              timestamp: new Date().toISOString()
            };
            
            fs.writeFileSync('response_files/metadata.json', JSON.stringify(metadata, null, 2));
            logger.logSuccess(logFile, `Response validated successfully (${content.length} bytes)`);
            
            // Create base64 version for safe passing between steps
            const base64Content = Buffer.from(content).toString('base64');
            fs.writeFileSync('response_files/content_base64.txt', base64Content);
            logger.logSuccess(logFile, `Created base64 encoded response (${base64Content.length} bytes)`);
            
            // Also save plain content to file
            fs.writeFileSync('response_files/content.txt', content);
          } else {
            // Invalid response structure
            const errorType = responseData.error?.type || 'unknown';
            const errorMsg = responseData.error?.message || 'Invalid response structure';
            error = `${errorType}: ${errorMsg}`;
            logger.logError(logFile, `Invalid response structure: ${error}`);
            
            // Log response for debugging
            logger.logMessage(logFile, `- Response structure: ${JSON.stringify(Object.keys(responseData))}`);
            
            if (responseData.error) {
              fs.writeFileSync('error_logs/error_response.json', JSON.stringify(responseData.error, null, 2));
            }
          }
        } else {
          error = "Empty response received";
          logger.logError(logFile, error);
        }
      } else {
        // Handle HTTP errors
        error = `HTTP error ${httpStatus}`;
        logger.logError(logFile, error);
        
        // Check for error details in response
        if (fs.existsSync(responseFile) && fs.statSync(responseFile).size > 0) {
          try {
            const errorData = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
            if (errorData.error) {
              error = `${errorData.error.type || 'API Error'}: ${errorData.error.message || 'Unknown error'}`;
              logger.logError(logFile, `Error details: ${error}`);
            }
          } catch (parseError) {
            logger.logError(logFile, `Error parsing error response: ${parseError.message}`);
          }
        }
      }
    } catch (error) {
      logger.logError(logFile, `Exception during API call: ${error.message}`);
      error = `API call failed: ${error.message}`;
    }
    
    retryCount++;
  }
  
  // Process content if successful to handle thinking blocks
  if (success && content) {
    // Process <think>...</think> blocks to convert to markdown quotes
    const processedContent = processThinkingBlocks(content);
    
    if (processedContent && processedContent !== content) {
      // Save the processed content
      fs.writeFileSync('response_files/processed_content.txt', processedContent);
      logger.logSuccess(logFile, "Processed thinking blocks in content");
      content = processedContent;
    }
  }
  
  return { 
    success, 
    content, 
    error, 
    stats: responseStats,
    contentFile: success ? 'response_files/content.txt' : null,
    base64ContentFile: success ? 'response_files/content_base64.txt' : null 
  };
}

/**
 * Process thinking blocks in content
 * @param {string} content - Content with <think>...</think> blocks
 * @returns {string} - Processed content with thinking blocks as markdown quotes
 */
function processThinkingBlocks(content) {
  if (!content.includes('<think>')) {
    return content;
  }
  
  let processed = '';
  let inThinkBlock = false;
  let thinkingContent = '';
  
  // Split by lines to process
  const lines = content.split('\n');
  
  for (const line of lines) {
    if (line.includes('<think>')) {
      inThinkBlock = true;
      // Handle case where <think> is not at the start of the line
      const parts = line.split('<think>');
      if (parts[0].trim()) {
        processed += parts[0] + '\n';
      }
      // Capture any content after the <think> tag
      if (parts[1] && parts[1].trim()) {
        thinkingContent += parts[1] + '\n';
      }
    } else if (line.includes('</think>')) {
      inThinkBlock = false;
      // Handle case where </think> is not at the end of the line
      const parts = line.split('</think>');
      if (parts[0].trim()) {
        thinkingContent += parts[0] + '\n';
      }
      
      // Format thinking content as markdown quote
      if (thinkingContent.trim()) {
        processed += '\n\n> **Thinking process:**\n';
        thinkingContent.split('\n').forEach(thinkLine => {
          if (thinkLine.trim()) {
            processed += '> ' + thinkLine + '\n';
          } else {
            processed += '>\n';
          }
        });
        processed += '\n';
      }
      
      thinkingContent = '';
      
      // Capture any content after the </think> tag
      if (parts[1] && parts[1].trim()) {
        processed += parts[1] + '\n';
      }
    } else if (inThinkBlock) {
      thinkingContent += line + '\n';
    } else {
      processed += line + '\n';
    }
  }
  
  return processed;
}

/**
 * Create an emergency payload for fallback
 * @param {string} model - Model name
 * @returns {object} - Emergency payload object
 */
function createEmergencyPayload(model = "deepseek-ai/DeepSeek-R1") {
  return {
    model,
    messages: [
      {
        role: "user",
        content: "Please provide a helpful response to a GitHub issue or discussion."
      }
    ]
  };
}

module.exports = {
  callTogetherAI,
  processThinkingBlocks,
  createEmergencyPayload
}; 