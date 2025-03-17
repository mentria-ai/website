require('dotenv').config();
const app = require('../src/index');
const request = require('supertest');
const { Octokit } = require('octokit');

// Mocked user data for authentication tests
const mockUser = {
  username: 'testuser',
  token: 'mock-token'
};

// Mock Octokit's getAuthenticated method
jest.mock('octokit', () => {
  return {
    Octokit: jest.fn().mockImplementation(() => {
      return {
        rest: {
          users: {
            getAuthenticated: jest.fn().mockResolvedValue({
              data: {
                login: 'testuser',
                avatar_url: 'https://avatar.url',
                name: 'Test User'
              }
            })
          }
        }
      };
    })
  };
});

// Mock JWT to always return a fixed token
jest.mock('jsonwebtoken', () => {
  return {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn().mockReturnValue({ username: 'testuser' })
  };
});

describe('GitHub MCP Server', () => {
  describe('Health Check', () => {
    it('should respond with healthy status', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'healthy' });
    });
  });

  describe('Authentication', () => {
    it('should authenticate a user with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth')
        .send(mockUser);
        
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('token', 'mock-jwt-token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('username', 'testuser');
    });

    it('should reject authentication without username or token', async () => {
      const response = await request(app)
        .post('/api/auth')
        .send({ username: 'testuser' });
        
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('MCP Endpoint', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({ action: 'search_repositories', params: { query: 'test' } });
        
      expect(response.status).toBe(401);
    });

    it('should handle valid MCP requests', async () => {
      // This test would require more extensive mocking of all Octokit methods
      // Just a placeholder for now
      const response = await request(app)
        .post('/mcp')
        .set('Authorization', 'Bearer mock-jwt-token')
        .send({ action: 'unknown_action', params: {} });
        
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });
}); 