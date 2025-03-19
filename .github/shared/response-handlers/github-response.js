/**
 * GitHub response handler for posting to issues and discussions
 */
const fs = require('fs');

/**
 * Post a response to a GitHub discussion
 * @param {object} options - Response options
 * @param {object} options.github - GitHub API client
 * @param {string} options.discussionId - Discussion node ID
 * @param {string} options.commentId - Comment node ID (optional)
 * @param {string} options.responseContent - Response content
 * @param {string} options.logFile - Path to log file
 * @param {object} options.logger - Logger utility
 * @param {object} options.context - GitHub context
 * @returns {Promise<object>} - Result of the posting operation
 */
async function postToDiscussion(options) {
  const {
    github,
    discussionId,
    commentId,
    responseContent,
    logFile,
    logger,
    context
  } = options;
  
  if (!discussionId) {
    logger.logError(logFile, "Missing discussion ID");
    return { success: false, error: "Missing discussion ID" };
  }
  
  // Add enhanced error handling and retry logic with exponential backoff
  async function executeGraphQLWithRetry(query, variables, retries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.logMessage(logFile, `- Executing GraphQL query (attempt ${attempt}/${retries})`);
        return await github.graphql(query, variables);
      } catch (error) {
        lastError = error;
        
        // Log detailed error information
        logger.logWarning(logFile, `GraphQL error on attempt ${attempt}: ${error.message}`);
        
        // Check for rate limit errors
        if (error.message && error.message.includes('rate limit')) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.logMessage(logFile, `- Rate limit hit, waiting ${waitTime}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } 
        // Check for auth errors - no point retrying
        else if (error.message && (error.message.includes('authentication') || error.message.includes('permission'))) {
          logger.logError(logFile, `Authentication or permission error, not retrying`);
          throw error; // Don't retry auth errors
        }
        // Check for validation errors that won't be fixed by retrying
        else if (error.message && (error.message.includes('syntax') || error.message.includes('validation'))) {
          logger.logError(logFile, `GraphQL syntax or validation error, not retrying`);
          throw error; // Don't retry syntax errors
        }
        // For other errors, retry with backoff
        else if (attempt < retries) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.logMessage(logFile, `- Waiting ${waitTime}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // If we've exhausted all retries, throw the last error
    throw lastError;
  }
  
  try {
    // Add a comment with the AI response
    if (!commentId) {
      // Add a new comment to the discussion
      logger.logMessage(logFile, `- Posting new comment to discussion`);
      
      function createDiscussionCommentMutation() {
        return `
          mutation($discussionId: ID!, $body: String!) {
            addDiscussionComment(input: {discussionId: $discussionId, body: $body}) {
              comment {
                id
              }
            }
          }
        `;
      }
      
      const result = await executeGraphQLWithRetry(createDiscussionCommentMutation(), {
        discussionId: discussionId,
        body: responseContent
      });
      
      logger.logSuccess(logFile, 
        `Successfully posted comment to discussion\n` +
        `- Comment ID: ${result.addDiscussionComment.comment.id}`
      );
      
      return { 
        success: true, 
        commentId: result.addDiscussionComment.comment.id 
      };
    } else {
      // Try to reply directly to a comment
      try {
        logger.logMessage(logFile, `- Attempting to reply directly to comment`);
        
        function createReplyMutation() {
          return `
            mutation($discussionId: ID!, $body: String!, $replyToId: ID) {
              addDiscussionComment(input: {discussionId: $discussionId, body: $body, replyToId: $replyToId}) {
                comment {
                  id
                }
              }
            }
          `;
        }
        
        const result = await executeGraphQLWithRetry(createReplyMutation(), {
          discussionId: discussionId,
          body: responseContent,
          replyToId: commentId
        });
        
        logger.logSuccess(logFile, 
          `Successfully posted reply to comment\n` +
          `- Reply ID: ${result.addDiscussionComment.comment.id}`
        );
        
        return { 
          success: true, 
          commentId: result.addDiscussionComment.comment.id 
        };
      } catch (replyError) {
        logger.logWarning(logFile, 
          `Error replying directly: ${replyError.message}\n` +
          `- Will try to find parent comment or fallback to a new comment`
        );
        
        // Check if this is a "already in thread" error
        const alreadyInThreadError = replyError.message.includes("Parent comment is already in a thread");
        logger.logMessage(logFile, `- Is "already in thread" error: ${alreadyInThreadError}`);
        
        if (alreadyInThreadError) {
          try {
            // Get the discussion to find the parent comment of the thread
            const { repository } = context.payload;
            const discussionNumber = context.payload.discussion.number;
            
            logger.logMessage(logFile, `- Looking for parent comment in discussion #${discussionNumber}`);
            
            // First, get the discussion and all its comments and replies
            function createCommentsQuery() {
              return `
                query($owner: String!, $repo: String!, $number: Int!) {
                  repository(owner: $owner, name: $repo) {
                    discussion(number: $number) {
                      comments(first: 100) {
                        nodes {
                          id
                          replies(first: 50) {
                            nodes {
                              id
                            }
                          }
                        }
                      }
                    }
                  }
                }
              `;
            }
            
            const variables = {
              owner: repository.owner.login,
              repo: repository.name,
              number: discussionNumber
            };
            
            logger.logMessage(logFile, `- Querying discussion with variables: ${JSON.stringify(variables)}`);
            
            const discussionData = await executeGraphQLWithRetry(createCommentsQuery(), variables);
            
            if (!discussionData || !discussionData.repository || !discussionData.repository.discussion) {
              throw new Error("Failed to retrieve discussion data");
            }
            
            const comments = discussionData.repository.discussion.comments.nodes;
            logger.logMessage(logFile, `- Found ${comments.length} top-level comments`);
            
            // Find a parent comment that contains our comment ID in its replies
            let parentCommentId = null;
            
            // Debug log the comment we're looking for
            logger.logMessage(logFile, `- Looking for comment with ID: ${commentId}`);
            
            for (const comment of comments) {
              const replies = comment.replies.nodes;
              logger.logMessage(logFile, `- Checking comment ${comment.id} with ${replies.length} replies`);
              
              for (const reply of replies) {
                if (reply.id === commentId) {
                  parentCommentId = comment.id;
                  logger.logSuccess(logFile, `Match found! Comment ${commentId} is a reply to ${parentCommentId}`);
                  break;
                }
              }
              
              if (parentCommentId) break;
            }
            
            if (parentCommentId) {
              logger.logMessage(logFile, `- Found parent comment ID: ${parentCommentId}`);
              
              // Reply to the parent comment
              function createParentReplyMutation() {
                return `
                  mutation($discussionId: ID!, $body: String!, $replyToId: ID!) {
                    addDiscussionComment(input: {discussionId: $discussionId, body: $body, replyToId: $replyToId}) {
                      comment {
                        id
                      }
                    }
                  }
                `;
              }
              
              const parentResult = await executeGraphQLWithRetry(createParentReplyMutation(), {
                discussionId: discussionId,
                body: responseContent,
                replyToId: parentCommentId
              });
              
              logger.logSuccess(logFile, 
                `Successfully posted reply to parent comment\n` +
                `- Reply ID: ${parentResult.addDiscussionComment.comment.id}`
              );
              
              return { 
                success: true, 
                commentId: parentResult.addDiscussionComment.comment.id 
              };
            } else {
              throw new Error("Could not find parent comment for this reply");
            }
          } catch (parentError) {
            logger.logError(logFile, 
              `Error finding parent: ${parentError.message}\n` +
              `- Falling back to posting a new top-level comment`
            );
            
            // Fall through to creating a new comment
          }
        }
        
        // For any error case, post a new comment
        function createCommentMutation() {
          return `
            mutation($discussionId: ID!, $body: String!) {
              addDiscussionComment(input: {discussionId: $discussionId, body: $body}) {
                comment {
                  id
                }
              }
            }
          `;
        }
        
        const fallbackResult = await executeGraphQLWithRetry(createCommentMutation(), {
          discussionId: discussionId,
          body: responseContent
        });
        
        logger.logSuccess(logFile, 
          `Successfully posted fallback top-level comment\n` +
          `- Comment ID: ${fallbackResult.addDiscussionComment.comment.id}`
        );
        
        return { 
          success: true, 
          commentId: fallbackResult.addDiscussionComment.comment.id,
          fallback: true
        };
      }
    }
  } catch (error) {
    logger.logError(logFile, `Error posting response: ${error.message}`);
    logger.logMessage(logFile, `- Full error: ${JSON.stringify(error)}`);
    
    // Special handling for common GitHub API errors
    const errorMessage = error.message || '';
    let userFacingError = `Error posting response: ${error.message}`;
    
    if (errorMessage.includes('rate limit')) {
      userFacingError = "GitHub API rate limit exceeded. Please try again later.";
      logger.logMessage(logFile, `- Rate limit error detected`);
    } else if (errorMessage.includes('permission') || errorMessage.includes('authorization')) {
      userFacingError = "Permission denied when posting to discussion. Please check the workflow permissions.";
      logger.logMessage(logFile, `- Permission error detected`);
    } else if (errorMessage.includes('not found')) {
      userFacingError = "Discussion or comment not found. It may have been deleted.";
      logger.logMessage(logFile, `- Not found error detected`);
    }
    
    return { success: false, error: userFacingError };
  }
}

/**
 * Post a response to a GitHub issue
 * @param {object} options - Response options
 * @param {object} options.github - GitHub API client
 * @param {number} options.issueNumber - Issue number
 * @param {string} options.responseContent - Response content
 * @param {string} options.logFile - Path to log file
 * @param {object} options.logger - Logger utility
 * @param {object} options.context - GitHub context
 * @returns {Promise<object>} - Result of the posting operation
 */
async function postToIssue(options) {
  const {
    github,
    issueNumber,
    responseContent,
    logFile,
    logger,
    context
  } = options;
  
  if (!issueNumber) {
    logger.logError(logFile, "Missing issue number");
    return { success: false, error: "Missing issue number" };
  }
  
  try {
    // Create a comment on the issue
    const { owner, repo } = context.repo;
    logger.logMessage(logFile, `Posting comment to issue #${issueNumber}`);
    
    const result = await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: responseContent
    });
    
    logger.logSuccess(logFile, 
      `Successfully posted comment to issue #${issueNumber}\n` +
      `- Comment ID: ${result.data.id}`
    );
    
    return {
      success: true,
      commentId: result.data.id
    };
  } catch (error) {
    logger.logError(logFile, `Error posting response to issue: ${error.message}`);
    
    // Special handling for common GitHub API errors
    const errorMessage = error.message || '';
    let userFacingError = `Error posting response: ${error.message}`;
    
    if (errorMessage.includes('rate limit')) {
      userFacingError = "GitHub API rate limit exceeded. Please try again later.";
    } else if (errorMessage.includes('permission') || errorMessage.includes('authorization')) {
      userFacingError = "Permission denied when posting to issue. Please check the workflow permissions.";
    } else if (errorMessage.includes('not found')) {
      userFacingError = "Issue not found. It may have been deleted.";
    }
    
    return { success: false, error: userFacingError };
  }
}

module.exports = {
  postToDiscussion,
  postToIssue
}; 