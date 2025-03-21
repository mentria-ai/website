/**
 * Event extraction utilities for GitHub event payloads
 */
const fs = require('fs');

/**
 * Extract content from a discussion or discussion comment event
 * @param {object} payload - Event payload
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {object} Extracted content and metadata
 */
function extractDiscussionContent(payload, logFile, logger) {
  try {
    logger.logMessage(logFile, "Extracting content from payload");
    
    // Log the payload structure to help debug
    logger.logMessage(logFile, `Payload event type: ${payload.action || 'unknown'}`);
    logger.logMessage(logFile, `Has discussion: ${!!payload.discussion}`);
    logger.logMessage(logFile, `Has comment: ${!!payload.comment}`);
    
    if (!payload) {
      return {
        success: false,
        error: "Empty payload"
      };
    }
    
    // Get content from payload
    let content, eventType, discussionId, commentId;
    
    // Check for discussion presence
    if (!payload.discussion) {
      logger.logError(logFile, "No discussion data in payload");
      return {
        success: false,
        error: "No discussion data in payload"
      };
    }
    
    // For discussion events
    if (payload.action === 'created' && !payload.comment) {
      logger.logMessage(logFile, "Processing new discussion event");
      
      if (!payload.discussion.body) {
        logger.logError(logFile, "Discussion body is undefined or empty");
        return {
          success: false,
          error: "Discussion body is undefined or empty"
        };
      }
      
      content = payload.discussion.body;
      eventType = 'Discussion';
      discussionId = payload.discussion.node_id;
    } 
    // For discussion comment events
    else if (payload.comment) {
      logger.logMessage(logFile, "Processing discussion comment event");
      
      if (!payload.comment.body) {
        logger.logError(logFile, "Comment body is undefined or empty");
        return {
          success: false,
          error: "Comment body is undefined or empty"
        };
      }
      
      content = payload.comment.body;
      eventType = 'Comment';
      discussionId = payload.discussion.node_id;
      commentId = payload.comment.node_id;
    } 
    // Unsupported event
    else {
      logger.logError(logFile, "Unsupported event type");
      return {
        success: false,
        error: "Unsupported event type"
      };
    }
    
    // Write content to files for use in other steps
    const contentDir = 'content_files';
    
    if (!fs.existsSync(contentDir)) {
      fs.mkdirSync(contentDir);
    }
    
    const contentFile = `${contentDir}/content.txt`;
    fs.writeFileSync(contentFile, content);
    
    // Also create a base64 version for API calls
    const base64Content = Buffer.from(content).toString('base64');
    const base64File = `${contentDir}/content_base64.txt`;
    fs.writeFileSync(base64File, base64Content);
    
    logger.logSuccess(logFile, `Content extracted successfully (${content.length} characters)`);
    
    return {
      success: true,
      content,
      eventType,
      discussionId,
      commentId,
      contentFile,
      base64File
    };
  } catch (error) {
    logger.logError(logFile, `Error extracting content: ${error.message}`);
    return {
      success: false,
      error: `Error extracting content: ${error.message}`
    };
  }
}

/**
 * Extract content from an issue event
 * @param {object} eventPayload - GitHub event payload
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {object} - Extracted content and metadata
 */
function extractIssueContent(eventPayload, logFile, logger) {
  if (!eventPayload) {
    logger.logError(logFile, "Missing event payload");
    return { success: false, error: "Missing event payload" };
  }
  
  const eventName = eventPayload.comment ? 'issue_comment' : 'issues';
  const action = eventPayload.action || '';
  logger.logMessage(logFile, `Extracting content from ${eventName} ${action} event`);
  
  try {
    let issueContent = '';
    let issueId = '';
    let issueNumber = 0;
    let commentId = null;
    let issueTitle = '';
    let issueBody = '';
    
    // Create a directory for content files
    if (!fs.existsSync('content_files')) {
      fs.mkdirSync('content_files', { recursive: true });
    }
    
    // Helper function for sanitizing content
    function sanitizeContent(content) {
      if (!content) return '';
      // Replace any potentially troublesome characters
      return content
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$')
        .replace(/\\/g, '\\\\');
    }
    
    if (eventName === 'issues') {
      const issue = eventPayload.issue;
      // Sanitize issue content
      issueTitle = issue.title || '';
      issueBody = issue.body || '';
      const sanitizedTitle = sanitizeContent(issueTitle);
      const sanitizedBody = sanitizeContent(issueBody);
      issueContent = sanitizedTitle + '\n\n' + sanitizedBody;
      issueId = issue.node_id;
      issueNumber = issue.number;
      
      // Log issue details
      logger.logMessage(logFile,
        `Retrieved Issue\n` +
        `- Title: ${sanitizedTitle.substring(0, 100)}${sanitizedTitle.length > 100 ? '...' : ''}\n` +
        `- Issue ID: ${issueId}\n` +
        `- Issue Number: ${issueNumber}\n` +
        `- Content length: ${issueContent.length} characters`
      );
    } else if (eventName === 'issue_comment') {
      const comment = eventPayload.comment;
      const issue = eventPayload.issue;
      // Sanitize comment content
      issueTitle = issue.title || '';
      issueBody = issue.body || '';
      const commentBody = comment.body || '';
      const sanitizedTitle = sanitizeContent(issueTitle);
      const sanitizedBody = sanitizeContent(commentBody);
      issueContent = sanitizedTitle + '\n\n' + sanitizedBody;
      issueId = issue.node_id;
      issueNumber = issue.number;
      commentId = comment.id;
      
      // Log comment details
      logger.logMessage(logFile,
        `Retrieved Issue Comment\n` +
        `- Issue Title: ${sanitizedTitle.substring(0, 100)}${sanitizedTitle.length > 100 ? '...' : ''}\n` +
        `- Issue ID: ${issueId}\n` +
        `- Issue Number: ${issueNumber}\n` +
        `- Comment ID: ${commentId}\n` +
        `- Content length: ${issueContent.length} characters\n` +
        `- Comment body preview: ${sanitizedBody.substring(0, 100)}...`
      );
    }
    
    // Create a metadata file with key information
    const metadata = {
      event_type: eventName,
      issue_id: issueId,
      issue_number: issueNumber,
      comment_id: commentId,
      title: issueTitle,
      issue_body: issueBody,
      content_length: issueContent.length,
      timestamp: new Date().toISOString(),
      sanitized: true,
      action: action
    };
    
    fs.writeFileSync('content_files/metadata.json', JSON.stringify(metadata, null, 2));
    
    // Write the full content to a file to preserve all characters exactly
    fs.writeFileSync('content_files/full_content.txt', issueContent);
    
    // Also create a base64 version for safe passing
    const base64Content = Buffer.from(issueContent).toString('base64');
    fs.writeFileSync('content_files/base64_content.txt', base64Content);
    
    logger.logSuccess(logFile, "Content extraction completed successfully");
    
    return {
      success: true,
      content: issueContent,
      base64Content: base64Content,
      issueId: issueId,
      issueNumber: issueNumber,
      commentId: commentId,
      title: issueTitle,
      issueBody: issueBody,
      eventType: eventName,
      action: action,
      contentFile: 'content_files/full_content.txt',
      base64File: 'content_files/base64_content.txt',
      metadataFile: 'content_files/metadata.json'
    };
  } catch (error) {
    logger.logError(logFile, `Error extracting issue content: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = {
  extractDiscussionContent,
  extractIssueContent
}; 