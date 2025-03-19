/**
 * Prompt building utilities for GitHub Actions assistants
 */
const fs = require('fs');

/**
 * Build a prompt for discussion assistant
 * @param {object} options - Prompt options
 * @param {string} options.content - The content to respond to
 * @param {string} options.eventType - The type of event (discussion, discussion_comment)
 * @param {array} options.previousComments - Array of previous comments (optional)
 * @returns {object} - Prepared prompt messages array
 */
function buildDiscussionPrompt(options) {
  const {
    content,
    eventType,
    previousComments = []
  } = options;
  
  const systemPrompt = `You are an AI assistant that helps with GitHub discussions. You provide helpful, accurate, and concise responses to technical questions.

When responding, follow these guidelines:
1. Be direct and get straight to the point
2. Use markdown formatting to structure your responses
3. When code is needed, use proper syntax highlighting with markdown code blocks
4. If you're uncertain, acknowledge limitations rather than making things up
5. You may include a brief thinking process in <think></think> tags - this will be formatted as a quote block in the final response
6. For complex technical questions, break down your approach step by step

Remember that you're in a GitHub discussion context. Your goal is to be helpful, accurate, and clear.`;

  // Create the user prompt
  let userPrompt = `Please respond to this ${eventType === 'discussion_comment' ? 'comment' : 'discussion'}:\n\n${content}`;
  
  // Add previous comments context if available
  if (previousComments && previousComments.length > 0) {
    userPrompt += "\n\nHere's the conversation history for context:\n";
    
    // Add up to 5 most recent comments
    previousComments.slice(-5).forEach((comment, index) => {
      userPrompt += `\n[${comment.author}]: ${comment.body.substring(0, 500)}${comment.body.length > 500 ? '...' : ''}\n`;
    });
  }
  
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

/**
 * Build a prompt for issue assistant
 * @param {object} options - Prompt options
 * @param {string} options.content - The content to respond to
 * @param {string} options.eventType - The type of event (issues, issue_comment)
 * @param {string} options.action - The action type (created, edited, etc.)
 * @param {array} options.previousComments - Array of previous comments (optional)
 * @param {string} options.repositoryContext - Repository context string (optional)
 * @returns {object} - Prepared prompt messages array
 */
function buildIssuePrompt(options) {
  const {
    content,
    eventType,
    action,
    previousComments = [],
    repositoryContext = ''
  } = options;
  
  const systemPrompt = `You are an AI assistant that helps with GitHub issues. You provide helpful, accurate, and concise responses to technical questions and issues.

When responding, follow these guidelines:
1. Be direct and get straight to the point
2. Use markdown formatting to structure your responses
3. When code is needed, use proper syntax highlighting with markdown code blocks (e.g., \`\`\`javascript\`\`\`)
4. If you're uncertain, acknowledge limitations rather than making things up
5. You may include your reasoning process in <think></think> tags - this will be formatted as a quote block in the final response
6. For complex technical questions, break down your approach step by step
7. If you reference specific parts of code files, cite the file path and line numbers
8. Keep your responses focused on the technical issue at hand

Remember that you're responding in a GitHub issue context. Your goal is to be helpful, accurate, and drive toward issue resolution.`;

  // Create the user prompt
  let userPrompt = `Please respond to this ${eventType === 'issue_comment' ? 'issue comment' : 'issue'}:\n\n${content}`;
  
  // Add previous comments context if available
  if (previousComments && previousComments.length > 0) {
    userPrompt += "\n\nHere's the conversation history for context:\n";
    
    // Add up to 5 most recent comments
    previousComments.slice(-5).forEach((comment, index) => {
      userPrompt += `\n[${comment.author}]: ${comment.body.substring(0, 500)}${comment.body.length > 500 ? '...' : ''}\n`;
    });
  }
  
  // Add repository context if available
  if (repositoryContext && repositoryContext.trim().length > 0) {
    userPrompt += `\n\n${repositoryContext}`;
  }
  
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}

/**
 * Build a prompt to determine if repository context is needed
 * @param {string} content - The issue/discussion content
 * @returns {object} - Prepared prompt messages array
 */
function buildContextNeedsPrompt(content) {
  return [
    {
      role: "system",
      content: "You are a tool that analyzes GitHub issue or discussion messages to determine if repository context would be helpful to answer the query. Respond with only a JSON object containing two fields: 'needsContext' (boolean) and 'reason' (string)."
    },
    {
      role: "user",
      content: `Analyze this GitHub issue/discussion text and determine if repository code context would be helpful to answer it properly:\n\n${content}\n\nRespond with JSON only, format: {"needsContext": boolean, "reason": "your explanation"}`
    }
  ];
}

module.exports = {
  buildDiscussionPrompt,
  buildIssuePrompt,
  buildContextNeedsPrompt
}; 