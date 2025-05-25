#!/usr/bin/env node

// Test script for issue filtering logic
console.log('🧪 Testing Issue Assistant Filtering Logic\n');

// Test cases
const testCases = [
  {
    name: "Music Generation Issue with Labels",
    issue: {
      number: 1,
      title: "[MUSIC] Generate electronic music",
      labels: [{ name: "audio" }, { name: "octobeats" }],
      user: { login: "user123" }
    },
    eventName: "issues",
    expectedResult: false,
    expectedReason: "Music generation issue"
  },
  {
    name: "Music Generation Issue with Title Pattern",
    issue: {
      number: 2,
      title: "Request for audio generation",
      labels: [],
      user: { login: "user123" }
    },
    eventName: "issues",
    expectedResult: false,
    expectedReason: "Music generation issue"
  },
  {
    name: "Regular Issue",
    issue: {
      number: 3,
      title: "Bug in website navigation",
      labels: [{ name: "bug" }],
      user: { login: "user123" }
    },
    eventName: "issues",
    expectedResult: true,
    expectedReason: "Regular issue"
  },
  {
    name: "Bot Issue",
    issue: {
      number: 4,
      title: "Dependency update",
      labels: [{ name: "dependencies" }],
      user: { login: "dependabot[bot]" }
    },
    eventName: "issues",
    expectedResult: false,
    expectedReason: "Bot issue"
  },
  {
    name: "Comment on Music Issue",
    issue: {
      number: 5,
      title: "[MUSIC] Test",
      labels: [{ name: "audio" }],
      user: { login: "user123" }
    },
    comment: {
      body: "Audio Generated Successfully! Your audio has been generated using OctoBeats",
      user: { login: "github-actions[bot]" }
    },
    eventName: "issue_comment",
    expectedResult: false,
    expectedReason: "OctoBeats workflow comment"
  },
  {
    name: "Regular Comment",
    issue: {
      number: 6,
      title: "Help with CSS styling",
      labels: [{ name: "question" }],
      user: { login: "user123" }
    },
    comment: {
      body: "Can you help me with this CSS issue?",
      user: { login: "user456" }
    },
    eventName: "issue_comment",
    expectedResult: true,
    expectedReason: "Regular comment"
  }
];

// Filtering logic (copied from workflow)
function shouldProcessIssue(testCase) {
  const { issue, comment, eventName } = testCase;
  
  if (!issue) {
    return { shouldProcess: false, reason: 'No issue in payload' };
  }
  
  // For issue_comment events, check if comment is from OctoBeats workflow
  if (eventName === 'issue_comment' && comment) {
    const commentBody = comment.body.toLowerCase();
    const commentAuthor = comment.user.login.toLowerCase();
    
    if (commentAuthor.includes('github-actions') || 
        commentBody.includes('octobeats') || 
        commentBody.includes('audio generated successfully') ||
        commentBody.includes('music generator')) {
      return { shouldProcess: false, reason: 'Comment from OctoBeats workflow' };
    }
  }
  
  // Check for OctoBeats/music generation labels
  const labels = issue.labels.map(label => label.name.toLowerCase());
  const musicLabels = ['audio', 'octobeats', 'music-generation', 'music'];
  const hasMusicLabel = labels.some(label => musicLabels.includes(label));
  
  // Check for music generation title patterns
  const title = issue.title.toLowerCase();
  const musicTitlePatterns = ['[music]', '[audio]', 'music generation', 'audio generation', 'octobeats'];
  const hasMusicTitle = musicTitlePatterns.some(pattern => title.includes(pattern));
  
  // Skip if this is a music generation issue
  if (hasMusicLabel || hasMusicTitle) {
    return { shouldProcess: false, reason: 'Music generation issue - handled by OctoBeats workflow' };
  }
  
  // Check if the issue author is a bot
  const author = issue.user.login.toLowerCase();
  const botPatterns = ['bot', 'github-actions', 'dependabot', 'renovate'];
  const isBot = botPatterns.some(pattern => author.includes(pattern));
  
  if (isBot) {
    return { shouldProcess: false, reason: 'Issue created by bot' };
  }
  
  return { shouldProcess: true, reason: 'Regular issue requiring assistance' };
}

// Test each case
console.log('🔍 Testing Issue Filtering Logic:');
console.log('─'.repeat(60));

let passedTests = 0;
let totalTests = testCases.length;

testCases.forEach((testCase, index) => {
  console.log(`\n📋 Test ${index + 1}: ${testCase.name}`);
  
  const result = shouldProcessIssue(testCase);
  const passed = result.shouldProcess === testCase.expectedResult;
  
  console.log(`  Issue: #${testCase.issue.number} - "${testCase.issue.title}"`);
  console.log(`  Labels: [${testCase.issue.labels.map(l => l.name).join(', ')}]`);
  console.log(`  Author: ${testCase.issue.user.login}`);
  
  if (testCase.comment) {
    console.log(`  Comment by: ${testCase.comment.user.login}`);
    console.log(`  Comment: "${testCase.comment.body.substring(0, 50)}..."`);
  }
  
  console.log(`  Expected: ${testCase.expectedResult ? 'PROCESS' : 'SKIP'}`);
  console.log(`  Actual: ${result.shouldProcess ? 'PROCESS' : 'SKIP'}`);
  console.log(`  Reason: ${result.reason}`);
  console.log(`  Result: ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  if (passed) passedTests++;
});

console.log('\n' + '─'.repeat(60));
console.log(`🎯 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('✅ All tests passed! Issue filtering logic is working correctly.');
} else {
  console.log('❌ Some tests failed. Please review the filtering logic.');
  process.exit(1);
}

console.log('\n💡 Usage: node .github/scripts/test-issue-filtering.js'); 