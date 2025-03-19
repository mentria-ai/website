/**
 * Event extraction utilities for GitHub event payloads
 */
const fs = require('fs');

/**
 * Extract content from a discussion event
 * @param {object} eventPayload - GitHub event payload
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {object} - Extracted content and metadata
 */
function extractDiscussionContent(eventPayload, logFile, logger) {
  if (!eventPayload) {
    logger.logError(logFile, "Missing event payload");
    return { success: false, error: "Missing event payload" };
  }
  
  const eventName = eventPayload.action ? 'discussion_comment' : 'discussion';
  logger.logMessage(logFile, `Extracting content from ${eventName} event`);
  
  try {
    let discussionContent = '';
    let discussionId = '';
    let commentId = null;
    let discussionTitle = '';
    
    // Create a directory for content files
    if (!fs.existsSync('content_files')) {
      fs.mkdirSync('content_files', { recursive: true });
    }
    
    // Helper function for sanitizing content
    function sanitizeContent(content) {
      // Replace any potentially troublesome characters
      return content
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$')
        .replace(/\\/g, '\\\\');
    }
    
    if (eventName === 'discussion') {
      const discussion = eventPayload.discussion;
      // Sanitize discussion content
      discussionTitle = discussion.title || '';
      const sanitizedTitle = sanitizeContent(discussionTitle);
      const sanitizedBody = sanitizeContent(discussion.body || '');
      discussionContent = sanitizedTitle + '\n\n' + sanitizedBody;
      discussionId = discussion.node_id;
      
      // Log discussion details
      logger.logMessage(logFile,
        `Retrieved Discussion\n` +
        `- Title: ${sanitizedTitle.substring(0, 100)}${sanitizedTitle.length > 100 ? '...' : ''}\n` +
        `- Discussion ID: ${discussionId}\n` +
        `- Content length: ${discussionContent.length} characters`
      );
    } else if (eventName === 'discussion_comment') {
      const comment = eventPayload.comment;
      const discussion = eventPayload.discussion;
      // Sanitize comment content
      discussionTitle = discussion.title || '';
      const sanitizedTitle = sanitizeContent(discussionTitle);
      const sanitizedBody = sanitizeContent(comment.body || '');
      discussionContent = sanitizedTitle + '\n\n' + sanitizedBody;
      discussionId = discussion.node_id;
      commentId = comment.node_id;
      
      // Log comment details
      logger.logMessage(logFile,
        `Retrieved Discussion Comment\n` +
        `- Discussion Title: ${sanitizedTitle.substring(0, 100)}${sanitizedTitle.length > 100 ? '...' : ''}\n` +
        `- Discussion ID: ${discussionId}\n` +
        `- Comment ID: ${commentId}\n` +
        `- Content length: ${discussionContent.length} characters\n` +
        `- Comment body preview: ${sanitizedBody.substring(0, 100)}...`
      );
    }
    
    // Create a metadata file with key information
    const metadata = {
      event_type: eventName,
      discussion_id: discussionId,
      comment_id: commentId,
      title: discussionTitle,
      content_length: discussionContent.length,
      timestamp: new Date().toISOString(),
      sanitized: true
    };
    
    fs.writeFileSync('content_files/metadata.json', JSON.stringify(metadata, null, 2));
    
    // Write the full content to a file to preserve all characters exactly
    fs.writeFileSync('content_files/full_content.txt', discussionContent);
    
    // Also create a base64 version for safe passing
    const base64Content = Buffer.from(discussionContent).toString('base64');
    fs.writeFileSync('content_files/base64_content.txt', base64Content);
    
    logger.logSuccess(logFile, "Content extraction completed successfully");
    
    return {
      success: true,
      content: discussionContent,
      base64Content: base64Content,
      discussionId: discussionId,
      commentId: commentId,
      title: discussionTitle,
      eventType: eventName,
      contentFile: 'content_files/full_content.txt',
      base64File: 'content_files/base64_content.txt',
      metadataFile: 'content_files/metadata.json'
    };
  } catch (error) {
    logger.logError(logFile, `Error extracting discussion content: ${error.message}`);
    return { success: false, error: error.message };
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