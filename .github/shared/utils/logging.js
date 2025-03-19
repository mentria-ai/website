/**
 * Logging utilities for GitHub Actions workflows
 */
const fs = require('fs');

/**
 * Initialize workflow log file
 * @param {string} workflowName - The name of the workflow
 * @param {object} context - GitHub context object
 * @returns {string} Path to the log file
 */
function initLogFile(workflowName, context) {
  const logFile = `workflow_${workflowName.toLowerCase().replace(/\s+/g, '_')}_debug.log`;
  
  // Create a log file with initial details
  fs.writeFileSync(logFile, 
    `# Workflow Execution Log - ${new Date().toISOString()}\n` +
    `## Run ID: ${context.runId}\n` +
    `## Event: ${context.eventName}\n` +
    `## Repository: ${context.repository}\n` +
    `## Workflow: ${workflowName}\n` +
    `## Run Number: ${context.runNumber}\n` +
    `## Actor: ${context.actor}\n` +
    `## Start Time: ${new Date().toISOString()}\n\n` +
    `## Step Logs:\n`
  );
  
  return logFile;
}

/**
 * Append message to log file
 * @param {string} logFile - Path to log file
 * @param {string} message - Message to log
 */
function logMessage(logFile, message) {
  if (!logFile) return;
  
  try {
    fs.appendFileSync(logFile, `${message}\n`);
  } catch (error) {
    console.error(`Error writing to log file: ${error.message}`);
  }
}

/**
 * Log section header
 * @param {string} logFile - Path to log file
 * @param {string} sectionName - Section name
 */
function logSection(logFile, sectionName) {
  logMessage(logFile, `\n### ${sectionName} at ${new Date().toISOString()}\n`);
}

/**
 * Log success message
 * @param {string} logFile - Path to log file
 * @param {string} message - Success message
 */
function logSuccess(logFile, message) {
  logMessage(logFile, `- ✅ ${message}`);
}

/**
 * Log warning message
 * @param {string} logFile - Path to log file
 * @param {string} message - Warning message
 */
function logWarning(logFile, message) {
  logMessage(logFile, `- ⚠️ ${message}`);
}

/**
 * Log error message
 * @param {string} logFile - Path to log file
 * @param {string} message - Error message
 */
function logError(logFile, message) {
  logMessage(logFile, `- ❌ ${message}`);
}

/**
 * Log detailed error info
 * @param {string} logFile - Path to log file
 * @param {Error} error - Error object
 * @param {string} context - Context where error occurred
 */
function logErrorDetails(logFile, error, context) {
  logError(logFile, `${context}: ${error.message}`);
  logMessage(logFile, `  - Error stack: ${error.stack || 'No stack trace available'}`);
}

/**
 * Log process completion with timing
 * @param {string} logFile - Path to log file
 * @param {number} startTime - Start time in ms
 * @param {string} processName - Name of the process
 */
function logProcessCompletion(logFile, startTime, processName) {
  const endTime = Date.now();
  const elapsedTime = (endTime - startTime) / 1000; // Convert to seconds
  logMessage(logFile, `- ${processName} completed in ${elapsedTime} seconds`);
}

/**
 * Finalize log with summary
 * @param {string} logFile - Path to log file
 * @param {object} context - GitHub context object
 * @param {object} outcomes - Key outcomes from the workflow
 */
function finalizeLog(logFile, context, outcomes = {}) {
  if (!logFile) return;
  
  try {
    fs.appendFileSync(logFile, 
      `\n## Workflow Execution Summary\n` +
      `- End Time: ${new Date().toISOString()}\n` +
      `- Run URL: https://github.com/${context.owner}/${context.repo}/actions/runs/${context.runId}\n` +
      `- Workflow File: https://github.com/${context.owner}/${context.repo}/blob/main/.github/workflows/${context.workflow}\n`
    );
    
    if (Object.keys(outcomes).length > 0) {
      fs.appendFileSync(logFile, `\n### Outcomes:\n`);
      for (const [key, value] of Object.entries(outcomes)) {
        fs.appendFileSync(logFile, `- ${key}: ${value}\n`);
      }
    }
  } catch (error) {
    console.error(`Error finalizing log file: ${error.message}`);
  }
}

module.exports = {
  initLogFile,
  logMessage,
  logSection,
  logSuccess,
  logWarning,
  logError,
  logErrorDetails,
  logProcessCompletion,
  finalizeLog
}; 