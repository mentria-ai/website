/**
 * GitHub API Interaction Tests
 * 
 * This script tests the GitHub API interactions used in our workflows,
 * focusing on PR creation, issue commenting, and proper API call formatting.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert').strict;

// Create test output directory
const testOutputDir = path.join(__dirname, 'test-output');
if (!fs.existsSync(testOutputDir)) {
  fs.mkdirSync(testOutputDir, { recursive: true });
}

console.log('Running GitHub API Interaction Tests...');

/**
 * Mock GitHub context and core modules
 */
const github = {
  rest: {
    issues: {
      createComment: async ({ owner, repo, issue_number, body }) => {
        console.log(`Mock: Creating comment on issue #${issue_number} in ${owner}/${repo}`);
        fs.writeFileSync(
          path.join(testOutputDir, `issue-${issue_number}-comment.md`), 
          body
        );
        return { data: { id: 12345, html_url: `https://github.com/${owner}/${repo}/issues/${issue_number}#issuecomment-12345` } };
      }
    },
    pulls: {
      create: async ({ owner, repo, title, body, head, base }) => {
        console.log(`Mock: Creating PR from ${head} to ${base} in ${owner}/${repo}`);
        fs.writeFileSync(
          path.join(testOutputDir, `pr-${head}-to-${base}.md`), 
          `# ${title}\n\n${body}`
        );
        return { data: { number: 42, html_url: `https://github.com/${owner}/${repo}/pull/42` } };
      }
    }
  },
  graphql: async (query, variables) => {
    console.log(`Mock: Executing GraphQL query with variables:`, variables);
    // Write the query to a file for inspection
    fs.writeFileSync(
      path.join(testOutputDir, 'graphql-query.txt'), 
      `Query:\n${query}\n\nVariables:\n${JSON.stringify(variables, null, 2)}`
    );
    
    // Return mock response based on query type
    if (query.includes('createDiscussion')) {
      return { 
        createDiscussion: { 
          discussion: { 
            id: 'D_123456', 
            url: `https://github.com/${variables.input.repositoryId.split('/')[0]}/discussions/123` 
          } 
        } 
      };
    } else if (query.includes('addDiscussionComment')) {
      return { 
        addDiscussionComment: { 
          comment: { 
            id: 'DC_123456' 
          } 
        } 
      };
    }
    
    return { mock: 'response' };
  }
};

const core = {
  setOutput: (name, value) => {
    console.log(`Mock: Setting output ${name}=${value.length > 50 ? value.substring(0, 50) + '...' : value}`);
  },
  setFailed: (message) => {
    console.error(`Mock: Setting job as failed: ${message}`);
    throw new Error(message);
  }
};

/**
 * Test 1: Test creating a PR
 */
function testCreatePR() {
  console.log('\n--- Test: Creating a PR ---');
  
  try {
    // Define test data
    const context = {
      repo: { owner: 'testowner', repo: 'testrepo' }
    };
    
    const issueNumber = 123;
    const fixRecommendation = `# Fix Recommendation\n\nThis is a test recommendation with code:\n\`\`\`js\nconsole.log('test');\n\`\`\``;
    const branchName = `fix-issue-${issueNumber}`;
    const defaultBranch = 'main';
    
    // Define our PR creation function (from the workflow)
    async function createPR() {
      try {
        // Create PR
        const { data: pullRequest } = await github.rest.pulls.create({
          owner: context.repo.owner,
          repo: context.repo.repo,
          title: `Fix for issue #${issueNumber}`,
          body: `This PR contains an automatically generated fix recommendation for issue #${issueNumber}.
          
## Fix Details

${fixRecommendation.substring(0, 1500)}${fixRecommendation.length > 1500 ? '...(truncated)' : ''}

## Note
This PR was automatically created by the Issue Assistant.
Please review the changes and modify as needed.

Closes #${issueNumber}`,
          head: branchName,
          base: defaultBranch
        });
        
        // Comment on the issue
        await github.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          body: `I've created PR #${pullRequest.number} with a proposed fix for this issue.
          
The PR includes a markdown file with detailed fix recommendations. Please review and implement the suggested changes, or modify the PR as needed.

[View PR #${pullRequest.number}](${pullRequest.html_url})`
        });
        
        return {
          pr_number: pullRequest.number,
          pr_url: pullRequest.html_url
        };
      } catch (error) {
        core.setFailed(`Error creating PR: ${error.message}`);
        return null;
      }
    }
    
    // Execute the function
    createPR().then(result => {
      assert.strictEqual(result.pr_number, 42);
      console.log('✅ Create PR test passed');
    });
    
    return true;
  } catch (error) {
    console.error('❌ Create PR test failed:', error);
    return false;
  }
}

/**
 * Test 2: Test commenting on an issue
 */
function testCommentOnIssue() {
  console.log('\n--- Test: Commenting on an Issue ---');
  
  try {
    // Define test data
    const context = {
      repo: { owner: 'testowner', repo: 'testrepo' }
    };
    
    const issueNumber = 123;
    const analysis = "This is a test analysis with special characters: ${{ variable }} and ${interpolation}";
    const needsChanges = 'false';
    
    // Define our comment function (from the workflow)
    async function commentOnIssue() {
      try {
        let commentBody = '';
        
        if (needsChanges === 'false') {
          // No code changes needed - suggest closing
          commentBody = `Based on my analysis, this issue doesn't require code changes:
          
---

${analysis}

---

If you agree with this assessment, this issue can be closed. If you believe code changes are still needed, please provide additional details.`;
        } else {
          // Either needs changes but couldn't generate a fix, or analysis was inconclusive
          commentBody = `I've analyzed this issue and here are my findings:
          
---

${analysis}

---

I wasn't able to automatically generate a specific fix recommendation. This issue likely requires additional input or manual review by a developer.`;
        }
        
        // Post the comment
        const { data: comment } = await github.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: issueNumber,
          body: commentBody
        });
        
        return {
          comment_id: comment.id,
          comment_url: comment.html_url
        };
      } catch (error) {
        core.setFailed(`Error posting comment: ${error.message}`);
        return null;
      }
    }
    
    // Execute the function
    commentOnIssue().then(result => {
      assert.strictEqual(result.comment_id, 12345);
      console.log('✅ Comment on Issue test passed');
    });
    
    return true;
  } catch (error) {
    console.error('❌ Comment on Issue test failed:', error);
    return false;
  }
}

/**
 * Test 3: Test creating a discussion
 */
function testCreateDiscussion() {
  console.log('\n--- Test: Creating a Discussion ---');
  
  try {
    // Define test data
    const context = {
      repo: { owner: 'testowner', repo: 'testrepo' },
      payload: {
        repository: {
          node_id: 'R_123456',
          discussion_category_node_id: 'DIC_123456'
        }
      }
    };
    
    const issueNumber = 123;
    const logContent = "This is a test log content with special characters: ${{ variable }} and ${interpolation}";
    
    // Define our create discussion function (from the workflow)
    async function createDiscussion() {
      try {
        // Create a new discussion with the logs
        const result = await github.graphql(`
          mutation($input: CreateDiscussionInput!) {
            createDiscussion(input: $input) {
              discussion {
                id
                url
              }
            }
          }
        `, {
          input: {
            repositoryId: context.payload.repository.node_id,
            categoryId: context.payload.repository.discussion_category_node_id,
            body: logContent,
            title: `Issue Assistant Log: Issue #${issueNumber} - ${new Date().toISOString().split('T')[0]}`
          }
        });
        
        return result.createDiscussion.discussion.url;
      } catch (error) {
        core.setFailed(`Error creating discussion: ${error.message}`);
        return null;
      }
    }
    
    // Execute the function
    createDiscussion().then(result => {
      assert.ok(result.includes('discussions'));
      console.log('✅ Create Discussion test passed');
    });
    
    return true;
  } catch (error) {
    console.error('❌ Create Discussion test failed:', error);
    return false;
  }
}

/**
 * Test 4: Test error handling in API calls
 */
function testErrorHandling() {
  console.log('\n--- Test: Error Handling in API Calls ---');
  
  try {
    // Create a mock that throws an error
    const errorMock = {
      rest: {
        issues: {
          createComment: async () => {
            throw new Error('Test error');
          }
        }
      }
    };
    
    // Define test data
    const context = {
      repo: { owner: 'testowner', repo: 'testrepo' }
    };
    
    // Define a function with error handling
    async function commentWithErrorHandling() {
      try {
        await errorMock.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: 123,
          body: 'Test comment'
        });
        return true;
      } catch (error) {
        // This should properly catch and handle the error
        console.log(`Caught error: ${error.message}`);
        return false;
      }
    }
    
    // Execute the function
    commentWithErrorHandling().then(result => {
      assert.strictEqual(result, false);
      console.log('✅ Error Handling test passed');
    });
    
    return true;
  } catch (error) {
    console.error('❌ Error Handling test failed:', error);
    return false;
  }
}

// Run all tests
const tests = [
  testCreatePR,
  testCommentOnIssue,
  testCreateDiscussion,
  testErrorHandling
];

const results = tests.map(test => test());
const allPassed = results.every(result => result === true);

console.log('\n--- Test Summary ---');
console.log(`Total tests: ${tests.length}`);
console.log(`Passed: ${results.filter(r => r).length}`);
console.log(`Failed: ${results.filter(r => !r).length}`);
console.log(`Overall status: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);

// Output test artifacts location
console.log(`\nTest output files are in: ${testOutputDir}`);

// Exit with appropriate code
process.exit(allPassed ? 0 : 1); 