# GitHub Actions Workflow Tests

This directory contains tests for the GitHub Actions workflows in this repository, focusing on ensuring that our workflows handle edge cases properly and follow best practices.

## Test Structure

There are two main test scripts:

1. **workflow-content-tests.js** - Tests the content generation for PRs, issues, and discussions, ensuring proper escaping and handling of special characters.

2. **github-api-tests.js** - Tests GitHub API interactions used in our workflows, particularly for creating PRs, commenting on issues, and creating discussions.

## Running the Tests

You can run the tests using the npm scripts defined in the root `package.json`:

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suites
npm run test:workflow-content
npm run test:github-api

# Validate workflows
npm run lint:workflows
```

## What the Tests Validate

### Workflow Content Tests

- **PR Content Generation** - Tests generating PR descriptions with template variables, ensuring proper escaping.
- **Template Strings in JavaScript** - Tests using template strings in JavaScript context for GitHub Actions.
- **JSON Payload Creation** - Tests creating properly escaped JSON payloads for API calls.
- **Bash Script Generation** - Tests generating bash scripts with proper variable handling.

### GitHub API Tests

- **Creating a PR** - Tests the process of creating a PR with proper content formatting.
- **Commenting on an Issue** - Tests adding comments to GitHub issues with markdown content.
- **Creating a Discussion** - Tests creating GitHub discussions via the GraphQL API.
- **Error Handling** - Tests proper error handling in API calls.

## Test Output

Each test generates output files in the `test-output` directory that can be inspected for correctness. The tests will also output their status to the console.

## Workflow Validation

In addition to these tests, we have GitHub Actions workflows that validate:

1. **Workflow Syntax** - Ensures all workflow files have valid YAML and GitHub Actions syntax.
2. **Commit Standards** - Ensures commits follow the repository's conventions.

These can be run manually from GitHub's Actions tab or via the GitHub CLI:

```bash
# Validate workflows
gh workflow run workflow-validation.yml

# Validate commits
gh workflow run commit-validation.yml
```

## Adding New Tests

When adding new tests:

1. Create a test function that returns `true` on success and `false` on failure
2. Add your function to the `tests` array at the bottom of the test file
3. Make sure to handle errors properly with try/catch blocks

Example:

```javascript
function myNewTest() {
  console.log('\n--- Test: My New Feature ---');
  
  try {
    // Test code here
    assert.strictEqual(actualValue, expectedValue);
    console.log('✅ My New Feature test passed');
    return true;
  } catch (error) {
    console.error('❌ My New Feature test failed:', error);
    return false;
  }
}

// Add to tests array
const tests = [
  // Existing tests
  myNewTest
]; 